import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { TranslationService, TranslationOptions } from "./translationService";

export class GeminiService implements TranslationService {
  private apiKeys: string[] = [];
  private modelName: string;
  private exhaustedKeys: Set<string> = new Set();
  private static globalKeyLastUsed: Map<string, number> = new Map();
  private static lastSuccessfulKey: string | null = null;

  constructor(apiKeys?: string | string[], modelName: string = "gemini-1.5-flash") {
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
      const ai = new GoogleGenerativeAI(key);
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
    const { imageBuffer, pageNumber, signal, model } = options;
    const requestModel = model || this.modelName;
    
    if (signal?.aborted) {
      throw new Error("Translation aborted");
    }

    const systemInstruction = `BÁC SĨ DỊCH THUẬT: Dịch trang ${pageNumber} sang tiếng Việt. Markdown chuẩn. Thuật ngữ y khoa chính xác. Cực kỳ súc tích. KHÔNG lời dẫn.`;

    const prompt = `Dịch trang y khoa này sang tiếng Việt.`;

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
        const fetchStartTime = Date.now();
        const genModel = ai.getGenerativeModel({ 
          model: requestModel,
          systemInstruction: systemInstruction,
          generationConfig: {
            temperature: 0,
          }
        });

        const response = await genModel.generateContentStream([
          prompt,
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageBuffer.split(",")[1],
            },
          },
        ]);

        console.log(`[MediTrans] API request sent. Model: ${requestModel}. Wait time for stream start...`);
        let fullText = "";
        let chunkCount = 0;
        for await (const chunk of response.stream) {
          if (chunkCount === 0) {
            console.log(`[MediTrans] Stream started after ${Date.now() - fetchStartTime}ms`);
          }
          chunkCount++;
          if (signal?.aborted) {
            throw new Error("Translation aborted");
          }
          let chunkText = chunk.text();
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
    const { imageBuffer, pageNumber, signal, model } = options;
    const requestModel = model || this.modelName;
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

      const systemInstruction = `Dịch y khoa chuẩn (OCR). Trang ${pageNumber}. Markdown. Cực kỳ súc tích.`;
      const prompt = `Dịch văn bản trong ảnh sang tiếng Việt.`;

      try {
        const genModel = ai.getGenerativeModel({ 
          model: requestModel,
          systemInstruction: systemInstruction,
          generationConfig: { temperature: 0 }
        });

        const result = await genModel.generateContent([
          prompt, 
          { inlineData: { mimeType: "image/jpeg", data: imageBuffer.split(",")[1] } }
        ]);

        const response = await result.response;
        let text = response.text() || "";
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
      const genModel = ai.getGenerativeModel({ 
        model: this.modelName,
        systemInstruction: systemInstruction,
        generationConfig: {
          temperature: 0,
          responseMimeType: "application/json",
          responseSchema: {
            type: SchemaType.OBJECT,
            properties: {
              term: { type: SchemaType.STRING },
              definition: { type: SchemaType.STRING },
              synonyms: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
              relatedTerms: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
              source: { type: SchemaType.STRING }
            },
            required: ["term", "definition"]
          }
        }
      });

      const result = await genModel.generateContent(prompt);
      const response = await result.response;
      return JSON.parse(response.text().replace(/```json\n?|```/g, '').trim());
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
      const genModel = ai.getGenerativeModel({ 
        model: this.modelName,
        systemInstruction: systemInstruction,
        generationConfig: { temperature: 0.1 }
      });
      const result = await genModel.generateContent([
        prompt, 
        { inlineData: { mimeType: "image/jpeg", data: imageBuffer.split(",")[1] } }
      ]);
      const response = await result.response;
      return response.text()?.trim() || "";
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
      const genModel = ai.getGenerativeModel({ 
        model: this.modelName,
        systemInstruction: systemInstruction,
        generationConfig: { temperature: 0.2 }
      });
      const response = await genModel.generateContentStream(prompt);
      for await (const chunk of response.stream) {
        if (signal?.aborted) throw new Error("Aborted");
        if (chunk.text()) yield chunk.text();
      }
    } catch (error: any) { throw error; }
  }
}
