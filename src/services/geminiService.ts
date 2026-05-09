import { GoogleGenAI, Type } from "@google/genai";
import { TranslationService, TranslationOptions } from "./translationService";

export class GeminiService implements TranslationService {
  private apiKeys: string[] = [];
  private modelName: string;
  private exhaustedKeys: Set<string> = new Set();
  private static globalKeyLastUsed: Map<string, number> = new Map();
  private static lastSuccessfulKey: string | null = null;

  constructor(apiKeys?: string | string[], modelName: string = "gemini-flash-latest") {
    // If user asked for gemini-flash-lite-latest, we can still use it, 
    // but the default is now gemini-flash-latest (1.5 Flash alias)
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
    const isFlash3 = this.modelName.includes('gemini-3');
    if (isFlash3) {
      return this.apiKeys.length > 5 ? 2000 : 3000;
    }
    return this.apiKeys.length > 5 ? 500 : 800;
  }

  private getBestAvailableKey(): string | null {
    if (this.apiKeys.length === 0) return null;

    const now = Date.now();
    const validKeys = this.apiKeys.filter(k => !this.exhaustedKeys.has(k));
    if (validKeys.length === 0) return null;

    if (GeminiService.lastSuccessfulKey && validKeys.includes(GeminiService.lastSuccessfulKey)) {
      const lastUsed = GeminiService.globalKeyLastUsed.get(GeminiService.lastSuccessfulKey) || 0;
      if (now - lastUsed >= this.getMIN_REQUEST_INTERVAL()) {
        return GeminiService.lastSuccessfulKey;
      }
    }

    validKeys.sort((a, b) => (GeminiService.globalKeyLastUsed.get(a) || 0) - (GeminiService.globalKeyLastUsed.get(b) || 0));
    return validKeys[0];
  }

  private async acquireKeyAndInstance(): Promise<{ ai: GoogleGenAI, key: string }> {
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
      const waitTime = isQuotaError ? 30000 : 5000; 
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
    return { manualKey: !!manualKey };
  }

  async openKeySelection(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).aistudio?.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
    }
  }

  async *translateMedicalPageStream(options: TranslationOptions): AsyncGenerator<string> {
    const { imageBuffer, pageNumber, signal, model, style = 'standard' } = options;
    const requestModel = model || this.modelName;
    
    console.log(`[MediTrans] Starting stream translation for page: ${pageNumber} using model: ${requestModel}, style: ${style}`);
    const totalStartTime = Date.now();

    if (signal?.aborted) throw new Error("Translation aborted");

    const stylePrompts = {
      standard: "Thuật ngữ y khoa chính xác, văn phong chuyên nghiệp.",
      simple: "Giải thích thuật ngữ khó bằng từ ngữ thông dụng, dễ hiểu cho người không chuyên.",
      academic: "Hàn lâm, bám sát cấu trúc câu gốc, phù hợp cho nghiên cứu.",
      expert: "Phân tích sâu, giữ các thuật ngữ gốc quan trọng bên cạnh bản dịch.",
      creative: "Trình bày trực quan, sử dụng các ký hiệu hoặc cấu trúc rõ ràng để tóm lược ý chính."
    };

    const systemInstruction = `BÁC SĨ DỊCH THUẬT: Dịch trang ${pageNumber} sang tiếng Việt. Markdown chuẩn. ${stylePrompts[style]} Cực kỳ súc tích. KHÔNG lời dẫn.`;
    const prompt = `Dịch trang y khoa này sang tiếng Việt.`;

    const MAX_RETRIES = 5;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) throw new Error("Translation aborted");
      
      let ai, key;
      try {
        ({ ai, key } = await this.acquireKeyAndInstance());
      } catch (e: any) {
        throw new Error("Không tìm thấy API Key khả dụng. Vui lòng kiểm tra lại Key trong Cài đặt.");
      }

      try {
        const fetchStartTime = Date.now();
        const response = await ai.models.generateContentStream({
          model: requestModel,
          contents: {
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
          config: {
            systemInstruction,
            temperature: 0,
          }
        });

        console.log(`[MediTrans] API request sent. Model: ${requestModel}. Wait time for stream start...`);
        let fullText = "";
        let chunkCount = 0;
        for await (const chunk of response) {
          if (signal?.aborted) break;
          if (chunkCount === 0) {
            console.log(`[MediTrans] Stream started after ${Date.now() - fetchStartTime}ms`);
          }
          chunkCount++;
          
          const chunkText = chunk.text;
          if (chunkText) {
            const cleaned = chunkText.replace(/\.{6,}/g, '.....');
            fullText += cleaned;
            yield cleaned;
          }
        }

        GeminiService.lastSuccessfulKey = key;
        if (!fullText && !signal?.aborted) throw new Error("Model returned no text.");
        
        console.log(`[MediTrans] Translation for page: ${pageNumber} finished in ${((Date.now() - totalStartTime) / 1000).toFixed(2)}s`);
        break;

      } catch (error: any) {
        if (signal?.aborted) throw new Error("Translation aborted");
        const isQuotaError = error.message?.toLowerCase().includes("quota") || error.message?.toLowerCase().includes("429");
        if (isQuotaError && retryCount < MAX_RETRIES) {
          this.rotateKey(key, true);
          retryCount++;
          continue;
        }
        throw error;
      }
    }
  }

  async translateMedicalPage(options: TranslationOptions): Promise<string> {
    const { imageBuffer, pageNumber, signal, model, style = 'standard' } = options;
    const requestModel = model || this.modelName;
    
    if (signal?.aborted) throw new Error("Translation aborted");

    const stylePrompts = {
      standard: "Thuật ngữ y khoa chính xác, văn phong chuyên nghiệp.",
      simple: "Giải thích thuật ngữ khó bằng từ ngữ thông dụng, dễ hiểu cho người không chuyên.",
      academic: "Hàn lâm, bám sát cấu trúc câu gốc, phù hợp cho nghiên cứu.",
      expert: "Phân tích sâu, giữ các thuật ngữ gốc quan trọng bên cạnh bản dịch.",
      creative: "Trình bày trực quan, sử dụng các ký hiệu hoặc cấu trúc rõ ràng để tóm lược ý chính."
    };

    let ai, key;
    try { ({ ai, key } = await this.acquireKeyAndInstance()); } catch (e) { throw new Error("API Key error."); }

    const systemInstruction = `Dịch y khoa chuẩn (OCR). Trang ${pageNumber}. Markdown. ${stylePrompts[style]} Cực kỳ súc tích.`;
    
    try {
      const result = await ai.models.generateContent({
        model: requestModel,
        contents: {
          parts: [
            { text: "Dịch văn bản trong ảnh sang tiếng Việt." },
            { inlineData: { mimeType: "image/jpeg", data: imageBuffer.split(",")[1] } }
          ]
        },
        config: { systemInstruction, temperature: 0 }
      });

      const text = result.text || "";
      GeminiService.lastSuccessfulKey = key;
      return text.replace(/\.{6,}/g, '.....');
    } catch (error: any) {
      throw error;
    }
  }

  async lookupMedicalTerm(term: string): Promise<any> {
    let ai, key;
    try { ({ ai, key } = await this.acquireKeyAndInstance()); } catch (e) { throw new Error("API Key error."); }

    try {
      const response = await ai.models.generateContent({
        model: this.modelName,
        contents: `Tra cứu thuật ngữ y khoa: "${term}"`,
        config: {
          systemInstruction: "Chuyên gia từ điển y khoa. Trả về JSON theo schema.",
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

      return JSON.parse(response.text.trim());
    } catch (error: any) {
      throw error;
    }
  }

  async performOCR(imageBuffer: string): Promise<string> {
    let ai, key;
    try { ({ ai, key } = await this.acquireKeyAndInstance()); } catch (e) { throw new Error("API Key error."); }

    try {
      const result = await ai.models.generateContent({
        model: this.modelName,
        contents: {
          parts: [
            { text: "Hãy trích xuất văn bản từ hình ảnh này." },
            { inlineData: { mimeType: "image/jpeg", data: imageBuffer.split(",")[1] } }
          ]
        },
        config: {
          systemInstruction: "OCR Y KHOA: Trích xuất văn bản chính xác.",
          temperature: 0.1
        }
      });
      return result.text?.trim() || "";
    } catch (error: any) {
      throw error;
    }
  }

  async *summarizeContent(content: string, type: 'page' | 'document' | 'chapter', signal?: AbortSignal): AsyncGenerator<string> {
    let ai, key;
    try { ({ ai, key } = await this.acquireKeyAndInstance()); } catch (e) { throw new Error("API Key error."); }

    try {
      const response = await ai.models.generateContentStream({
        model: this.modelName,
        contents: `Tóm tắt (${type}):\n\n${content}`,
        config: {
          systemInstruction: "BÁC SĨ CHUYÊN KHOA: Tóm tắt nội dung y khoa Markdown. Cực kỳ súc tích, giữ lại các thông tin lâm sàng quan trọng.",
          temperature: 0.2
        }
      });
      for await (const chunk of response) {
        if (signal?.aborted) break;
        if (chunk.text) yield chunk.text;
      }
    } catch (error: any) { throw error; }
  }
}
