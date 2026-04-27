import { GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { TranslationService, TranslationOptions } from "./translationService";

export class GeminiService implements TranslationService {
  private apiKeys: string[] = [];
  private modelName: string;
  private exhaustedKeys: Set<string> = new Set();
  private static globalKeyLastUsed: Map<string, number> = new Map();
  private static lastSuccessfulKey: string | null = null;

  constructor(apiKeys?: string | string[], modelName: string = "gemini-3-flash-preview") {
    this.modelName = modelName;
    
    if (Array.isArray(apiKeys)) {
      this.apiKeys = Array.from(new Set(apiKeys.filter(k => k && k.trim() !== "")));
    } else if (apiKeys && apiKeys.trim() !== "") {
      this.apiKeys = Array.from(new Set(apiKeys.split(/[,\n]/).map(k => k.trim()).filter(k => k !== "")));
    }
    
    this.apiKeys.forEach(k => {
      if (!GeminiService.globalKeyLastUsed.has(k)) {
        GeminiService.globalKeyLastUsed.set(k, 0);
      }
    });
    
    console.log(`[MediTrans] GeminiService: ${this.apiKeys.length} keys loaded. Model: ${modelName}`);
  }

  private getMIN_REQUEST_INTERVAL(): number {
    // If we have many keys, we can be more aggressive with each key's individual interval
    // Default is usually 4s/RPM for free tier, but 1s is safe for most paid/high-tier keys.
    // We'll set a lower individual interval if we have many keys.
    return this.apiKeys.length > 5 ? 500 : 800;
  }

  private getBestAvailableKey(): string | null {
    if (this.apiKeys.length === 0) return null;

    const now = Date.now();
    const validKeys = this.apiKeys.filter(k => !this.exhaustedKeys.has(k));
    if (validKeys.length === 0) return null;

    // Prefer last successful key if it fulfills rate limit
    if (GeminiService.lastSuccessfulKey && validKeys.includes(GeminiService.lastSuccessfulKey)) {
      const lastUsed = GeminiService.globalKeyLastUsed.get(GeminiService.lastSuccessfulKey) || 0;
      if (now - lastUsed >= this.getMIN_REQUEST_INTERVAL()) {
        return GeminiService.lastSuccessfulKey;
      }
    }

    // Least recently used selection
    validKeys.sort((a, b) => (GeminiService.globalKeyLastUsed.get(a) || 0) - (GeminiService.globalKeyLastUsed.get(b) || 0));

    return validKeys[0];
  }

  private async acquireKeyAndInstance(): Promise<{ ai: any, key: string }> {
    const key = this.getBestAvailableKey();
    if (!key) {
      console.error("[MediTrans] No available API keys for GeminiService.");
      throw new Error("Không có API Key khả dụng (Tất cả đang bảo trì hoặc hết hạn mức).");
    }

    await this.waitForKeyRateLimit(key);
    
    try {
      console.log(`[MediTrans] Using key: ...${key.substring(key.length - 4)} (Vault) for ${this.modelName}`);
      const ai = new GoogleGenAI({ apiKey: key });
      return { ai, key };
    } catch (e) {
      console.error("[MediTrans] Failed to initialize GoogleGenAI with key:", key.substring(key.length - 4), e);
      throw e;
    }
  }

  private async waitForKeyRateLimit(key: string): Promise<void> {
    const now = Date.now();
    const lastUsed = GeminiService.globalKeyLastUsed.get(key) || 0;
    const interval = this.getMIN_REQUEST_INTERVAL();
    
    if (now - lastUsed < interval) {
      const waitTime = interval - (now - lastUsed);
      if (waitTime > 50) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    GeminiService.globalKeyLastUsed.set(key, Date.now());
  }

  private rotateKey(exhaustedKey: string, isQuotaError: boolean = true): boolean {
    if (exhaustedKey) {
      const waitTime = isQuotaError ? 30000 : 5000; // 30s for quota, 5s for other errors
      console.warn(`[MediTrans] Key ...${exhaustedKey.slice(-4)} ${isQuotaError ? 'QUOTA EXHAUSTED' : 'ERROR'}. Backoff: ${waitTime}ms`);
      this.exhaustedKeys.add(exhaustedKey);
      
      setTimeout(() => {
        this.exhaustedKeys.delete(exhaustedKey);
        console.log(`[MediTrans] Key ...${exhaustedKey.slice(-4)} recovered.`);
      }, waitTime);
    }
    
    return this.getBestAvailableKey() !== null;
  }

  public getStatusInfo() {
    const total = this.apiKeys.length;
    const active = this.apiKeys.filter(k => !this.exhaustedKeys.has(k)).length;
    return {
      model: this.modelName,
      totalKeys: total,
      activeKeys: active,
      lastUsedSuffix: GeminiService.lastSuccessfulKey ? GeminiService.lastSuccessfulKey.slice(-4) : '...'
    };
  }

  async hasApiKey(): Promise<boolean> {
    return this.getBestAvailableKey() !== null;
  }

  async checkAvailableKeys(): Promise<{ manualKey: boolean }> {
    const manualKey = this.apiKeys[0]; 
    
    return {
      manualKey: !!manualKey
    };
  }

  async openKeySelection(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).aistudio?.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
    }
  }

  async *translateMedicalPageStream(options: TranslationOptions): AsyncGenerator<string> {
    const { imageBuffer, pageNumber, signal } = options;
    
    if (signal?.aborted) {
      throw new Error("Translation aborted");
    }

    const systemInstruction = `BẠN LÀ CHUYÊN GIA DỊCH THUẬT Y KHOA (OCR + DỊCH).
NHIỆM VỤ: Dịch TRANG ${pageNumber} sang tiếng Việt.

YÊU CẦU:
1. Markdown: Giữ cấu trúc (bảng, tiêu đề).
2. Thuật ngữ y khoa chuẩn.
3. KHÔNG THÊM lời dẫn.
4. Rút gọn chuỗi dấu chấm dài (. . .) thành 3 chấm (...)`;

    const prompt = `Dịch trang ${pageNumber} (Medical PDF page) sang tiếng Việt (Professional Medical Vietnamese).`;

    const MAX_RETRIES = 5;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) {
        throw new Error("Translation aborted");
      }
      
      let ai, key;
      try {
        ({ ai, key } = await this.acquireKeyAndInstance());
      } catch (e: any) {
        throw new Error("Không tìm thấy API Key khả dụng. Vui lòng kiểm tra lại Key trong Cài đặt.");
      }

      try {
        const response = await ai.models.generateContentStream({
          model: this.modelName,
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: imageBuffer.split(",")[1],
                  },
                },
              ],
            },
          ],
          config: {
            systemInstruction: systemInstruction,
            temperature: 0
          }
        });

        let fullText = "";
        for await (const chunk of response) {
          if (signal?.aborted) {
            throw new Error("Translation aborted");
          }
          let chunkText = chunk.text;
          if (chunkText) {
            chunkText = chunkText.replace(/\.{6,}/g, '.....');
            fullText += chunkText;
            yield chunkText;
          }
        }

        GeminiService.lastSuccessfulKey = key;
        if (!fullText) {
          throw new Error("Model returned no text.");
        }
        
        break;

      } catch (error: any) {
        if (signal?.aborted || error.message === "Translation aborted") {
          throw new Error("Translation aborted");
        }
        const isQuotaError = error.message?.toLowerCase().includes("quota") || 
                           error.message?.toLowerCase().includes("429") ||
                           error.message?.toLowerCase().includes("resource_exhausted");
        const isUnavailableError = error.message?.toLowerCase().includes("unavailable") || 
                                 error.message?.toLowerCase().includes("503") ||
                                 error.message?.toLowerCase().includes("high demand");
        const isPermissionDeniedError = error.message?.toLowerCase().includes("permission_denied") || 
                                       error.message?.toLowerCase().includes("403") ||
                                       error.message?.toLowerCase().includes("denied access");
        const isNetworkError = error.message?.includes("status code: 0") || 
                              error.message?.includes("code: 0") ||
                              error.message?.toLowerCase().includes("fetch failed");
        
        if ((isQuotaError || isUnavailableError || isPermissionDeniedError || isNetworkError) && retryCount < MAX_RETRIES) {
          const canRotate = this.rotateKey(key, isQuotaError || isPermissionDeniedError);
          retryCount++;
          if (canRotate) {
            // Immediate retry with different key
            await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
            continue;
          }
          // Backoff if no keys left or fallback
          const delay = Math.pow(1.5, retryCount) * 1000 + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
  }

  async translateMedicalPage(options: TranslationOptions): Promise<string> {
    const { imageBuffer, pageNumber, signal } = options;
    if (signal?.aborted) throw new Error("Translation aborted");

    const MAX_RETRIES = 5;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) throw new Error("Translation aborted");
      let ai, key;
      try {
        ({ ai, key } = await this.acquireKeyAndInstance());
      } catch (e) {
        throw new Error("Không tìm thấy API Key khả dụng.");
      }

      const systemInstruction = `BẠN LÀ MỘT CHUYÊN GIA DỊCH THUẬT Y KHOA OCR. NHIỆM VỤ: Dịch Trang ${pageNumber} sang tiếng Việt.`;
      const prompt = `Dịch hình ảnh Trang ${pageNumber} sang tiếng Việt.`;

      try {
        const response = await ai.models.generateContent({
          model: this.modelName,
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: imageBuffer.split(",")[1] } }] }],
          config: { systemInstruction, temperature: 0 }
        });

        let text = response.text || "";
        return text.replace(/\.{6,}/g, '.....');
      } catch (error: any) {
        if (signal?.aborted) throw new Error("Translation aborted");
        
        const isPermissionDeniedError = error.message?.toLowerCase().includes("permission_denied") || 
                                       error.message?.toLowerCase().includes("403") ||
                                       error.message?.toLowerCase().includes("denied access");
        const isQuotaError = error.message?.toLowerCase().includes("quota") || 
                           error.message?.toLowerCase().includes("429") ||
                           error.message?.toLowerCase().includes("resource_exhausted");
        const isNetworkError = error.message?.includes("status code: 0") || 
                              error.message?.includes("code: 0") ||
                              error.message?.toLowerCase().includes("fetch failed");

        if (retryCount < MAX_RETRIES && this.rotateKey(key, isQuotaError || isPermissionDeniedError || isNetworkError)) {
          retryCount++; continue;
        }
        throw error;
      }
    }
    return "Lỗi: Quá số lần thử lại.";
  }

  async lookupMedicalTerm(term: string): Promise<any> {
    const systemInstruction = `Chuyên gia từ điển y khoa. Trả về JSON.`;
    const prompt = `Tra cứu: "${term}"`;

    let ai, key;
    try {
      ({ ai, key } = await this.acquireKeyAndInstance());
    } catch (e) {
      throw new Error("Không tìm thấy API Key.");
    }

    try {
      const response = await ai.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              term: { type: Type.STRING },
              definition: { type: Type.STRING },
              synonyms: { type: Type.ARRAY, items: { type: Type.STRING } },
              relatedTerms: { type: Type.ARRAY, items: { type: Type.STRING } },
              source: { type: Type.STRING }
            },
            required: ["term", "definition"]
          }
        }
      });
      return JSON.parse(response.text.replace(/```json\n?|```/g, '').trim());
    } catch (error: any) {
      throw error;
    }
  }

  async performOCR(imageBuffer: string): Promise<string> {
    let ai, key;
    try {
       ({ ai, key } = await this.acquireKeyAndInstance());
    } catch (e) {
       throw new Error("Không có API Key khả dụng.");
    }

    const systemInstruction = `OCR Y KHOA: Trích xuất văn bản chính xác.`;
    const prompt = "Hãy trích xuất văn bản từ hình ảnh này.";

    try {
      const response = await ai.models.generateContent({
        model: this.modelName,
        contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/jpeg", data: imageBuffer.split(",")[1] } }] }],
        config: { systemInstruction, temperature: 0.1 }
      });
      return response.text?.trim() || "";
    } catch (error: any) {
      throw error;
    }
  }

  async *summarizeContent(content: string, type: 'page' | 'document' | 'chapter', signal?: AbortSignal): AsyncGenerator<string> {
    const systemInstruction = `BÁC SĨ CHUYÊN KHOA: Tóm tắt nội dung y khoa Markdown.`;
    const prompt = `Tóm tắt (${type}):\n\n${content}`;

    let ai, key;
    try { ({ ai, key } = await this.acquireKeyAndInstance()); } catch (e) { throw new Error("API Key error."); }

    try {
      const response = await ai.models.generateContentStream({
        model: this.modelName,
        contents: [{ parts: [{ text: prompt }] }],
        config: { systemInstruction, temperature: 0.2 }
      });
      for await (const chunk of response) {
        if (signal?.aborted) throw new Error("Aborted");
        if (chunk.text) yield chunk.text;
      }
    } catch (error: any) { throw error; }
  }
}
