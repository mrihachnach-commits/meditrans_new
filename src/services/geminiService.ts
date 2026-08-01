import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { TranslationService, TranslationOptions } from "./translationService";

export class GeminiService implements TranslationService {
  private apiKeys: string[] = [];
  private modelName: string;
  private exhaustedKeys: Set<string> = new Set();
  private static globalKeyLastUsed: Map<string, number> = new Map();
  private static lastSuccessfulKey: string | null = null;

  constructor(apiKeys?: string | string[], modelName: string = "gemini-flash-lite-latest") {
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

  private async acquireKeyAndInstance(): Promise<{ ai: any, key: string }> {
    const key = this.getBestAvailableKey();
    if (!key) {
      console.error("[MediTrans] No available API keys for GeminiService.");
      throw new Error("Không có API Key khả dụng (Tất cả đang bảo trì hoặc hết hạn mức).");
    }

    await this.waitForKeyRateLimit(key);
    
    try {
      console.log(`[MediTrans] Using key: ...${key.substring(key.length - 4)} for ${this.modelName}`);
      if (key.startsWith('sk-')) {
        return { ai: null, key };
      }
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

  private mapModelForOpenAI(modelName: string): string {
    const customNormal = typeof window !== 'undefined' ? localStorage.getItem('mediTrans_customOpenAIModelNormal') : null;
    const customDeep = typeof window !== 'undefined' ? localStorage.getItem('mediTrans_customOpenAIModelDeep') : null;
    const legacyCustom = typeof window !== 'undefined' ? localStorage.getItem('mediTrans_customOpenAIModel') : null;

    const isDeepMode = modelName === 'gemini-3.6-flash' || modelName === 'gemini-3-flash-preview' || modelName.toLowerCase().includes('deep') || modelName.toLowerCase().includes('pro');

    if (isDeepMode) {
      if (customDeep && customDeep.trim()) {
        return customDeep.trim();
      }
      if (customNormal && customNormal.trim()) {
        return customNormal.trim();
      }
    } else {
      if (customNormal && customNormal.trim()) {
        return customNormal.trim();
      }
    }

    if (legacyCustom && legacyCustom.trim()) {
      return legacyCustom.trim();
    }

    if (modelName === 'gemini-flash-lite-latest' || modelName === 'gemini-flash') {
      return 'gemini-1.5-flash';
    }
    if (modelName === 'gemini-3.6-flash' || modelName === 'gemini-3-flash-preview') {
      return 'gemini-1.5-flash';
    }
    return modelName;
  }

  private async *callOpenAIStream(
    key: string,
    model: string,
    systemInstruction: string,
    prompt: string,
    imageBase64: string,
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    const baseUrl = (typeof window !== 'undefined' ? localStorage.getItem('mediTrans_customBaseUrl') : null) || 'https://api.shopaikey.com/v1';
    let cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    if (!cleanBaseUrl.endsWith('/chat/completions')) {
      cleanBaseUrl = `${cleanBaseUrl}/chat/completions`;
    }

    const mappedModel = this.mapModelForOpenAI(model);

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: "system", content: systemInstruction });
    }

    const userContent: any[] = [{ type: "text", text: prompt }];
    if (imageBase64) {
      const formattedImage = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64.split(',')[1] || imageBase64}`;
      userContent.push({
        type: "image_url",
        image_url: { 
          url: formattedImage
        }
      });
    }

    messages.push({ role: "user", content: userContent });

    const body: any = {
      model: mappedModel,
      temperature: 0,
      max_tokens: 8192,
      stream: true,
      messages
    };

    console.log(`[MediTrans] Calling ShopAIKey/Proxy Stream (${cleanBaseUrl}) using model: ${mappedModel}`);

    const response = await fetch(cleanBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ShopAIKey/Proxy Error (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error("Response body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
          return;
        }
        if (trimmed.startsWith("data:")) {
          const jsonStr = trimmed.slice(5).trim();
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              yield content;
            }
          } catch (e) {
            // silent parse ignore
          }
        }
      }
    }

    if (buffer.trim().startsWith("data:")) {
      const jsonStr = buffer.trim().slice(5).trim();
      if (jsonStr && jsonStr !== "[DONE]") {
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) yield content;
        } catch (e) {}
      }
    }
  }

  private async callOpenAINonStream(
    key: string,
    model: string,
    systemInstruction: string,
    prompt: string,
    imageBase64: string,
    signal?: AbortSignal
  ): Promise<string> {
    const baseUrl = (typeof window !== 'undefined' ? localStorage.getItem('mediTrans_customBaseUrl') : null) || 'https://api.shopaikey.com/v1';
    let cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    if (!cleanBaseUrl.endsWith('/chat/completions')) {
      cleanBaseUrl = `${cleanBaseUrl}/chat/completions`;
    }

    const mappedModel = this.mapModelForOpenAI(model);

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: "system", content: systemInstruction });
    }

    const userContent: any[] = [{ type: "text", text: prompt }];
    if (imageBase64) {
      const formattedImage = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64.split(',')[1] || imageBase64}`;
      userContent.push({
        type: "image_url",
        image_url: { 
          url: formattedImage
        }
      });
    }

    messages.push({ role: "user", content: userContent });

    const body: any = {
      model: mappedModel,
      temperature: 0,
      max_tokens: 8192,
      stream: false,
      messages
    };

    console.log(`[MediTrans] Calling ShopAIKey/Proxy Non-Stream (${cleanBaseUrl}) using model: ${mappedModel}`);

    const response = await fetch(cleanBaseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`ShopAIKey/Proxy Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  public async testSingleKeyTranslation(key: string, sampleText: string = "Hello world! Testing translation AI."): Promise<{ success: boolean; resultText?: string; error?: string; latencyMs?: number }> {
    if (!key || !key.trim()) return { success: false, error: "API Key trống" };
    const cleanKey = key.trim();
    const startTime = Date.now();
    const prompt = `Dịch câu sau sang tiếng Việt ngắn gọn: "${sampleText}"`;
    const systemInstruction = "Bạn là dịch giả y khoa. Dịch chính xác và ngắn gọn.";

    try {
      if (cleanKey.startsWith('sk-')) {
        const text = await this.callOpenAINonStream(cleanKey, this.modelName, systemInstruction, prompt, "", undefined);
        const latencyMs = Date.now() - startTime;
        return { success: true, resultText: text || "Thành công", latencyMs };
      } else {
        const ai = new GoogleGenerativeAI(cleanKey);
        const genModel = ai.getGenerativeModel({ model: this.modelName });
        const res = await genModel.generateContent(`${systemInstruction}\n${prompt}`);
        const response = await res.response;
        const text = response.text()?.trim();
        const latencyMs = Date.now() - startTime;
        return { success: true, resultText: text || "Thành công", latencyMs };
      }
    } catch (err: any) {
      return { success: false, error: err.message || "Lỗi không xác định" };
    }
  }

  public async testSingleKey(key: string): Promise<boolean> {
    if (!key || !key.trim()) return false;
    const cleanKey = key.trim();
    if (cleanKey.startsWith('sk-')) {
      try {
        const baseUrl = (typeof window !== 'undefined' ? localStorage.getItem('mediTrans_customBaseUrl') : null) || 'https://api.shopaikey.com/v1';
        let cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
        if (!cleanBaseUrl.endsWith('/chat/completions')) {
          cleanBaseUrl = `${cleanBaseUrl}/chat/completions`;
        }
        const response = await fetch(cleanBaseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cleanKey}`
          },
          body: JSON.stringify({
            model: this.mapModelForOpenAI(this.modelName),
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 5
          })
        });
        return response.ok;
      } catch (e) {
        return false;
      }
    } else {
      try {
        const ai = new GoogleGenerativeAI(cleanKey);
        const genModel = ai.getGenerativeModel({ model: this.modelName });
        const res = await genModel.generateContent('Hi');
        return !!res;
      } catch (e) {
        return false;
      }
    }
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
    if (!manualKey) return { manualKey: false };
    const isActive = await this.testSingleKey(manualKey);
    return { manualKey: isActive };
  }

  async openKeySelection(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).aistudio?.openSelectKey) {
      await (window as any).aistudio.openSelectKey();
    }
  }

  async *translateMedicalPageStream(options: TranslationOptions): AsyncGenerator<string> {
    const { imageBuffer, pageNumber, signal, model } = options;
    const requestModel = model || this.modelName;
    
    console.log(`[MediTrans] Starting stream translation for page: ${pageNumber} using model: ${requestModel}`);
    const totalStartTime = Date.now();

    if (signal?.aborted) {
      throw new Error("Translation aborted");
    }

    const systemInstruction = `BẠN LÀ CHUYÊN GIA DỊCH THUẬT Y KHOA CAO CẤP (ANH - VIỆT).
Nhiệm vụ tối quan trọng: Đọc hình ảnh trang tài liệu y khoa (trang ${pageNumber}) và DỊCH ĐẦY ĐỦ 100% TỪNG CÂU, TỪNG ĐOẠN, TỪNG CHÚ THÍCH HÌNH ẢNH (Figure 1, Figure 2...) TỪ ĐẦU ĐẾN CUỐI TRANG SANG TIẾNG VIỆT. TUYỆT ĐỐI KHÔNG TÓM TẮT, KHÔNG CẮT BỚT BẤT KỲ NỘI DUNG HAY CHI TIẾT NÀO.

QUY TẮC BẮT BUỘC VỀ ĐỊNH DẠNG VÀ CẤU TRÚC MARKDOWN (CỰC KỲ QUAN TRỌNG):
1. TRÌNH BÀY ĐẸP VÀ PHÂN CHIA RÕ RÀNG BẰNG MARKDOWN:
   - Dùng tiêu đề Markdown (#, ##, ###, ####) cho tiêu đề trang, tên chương, tiêu đề mục lớn/nhỏ (Ví dụ: ### GIỚI THIỆU, ### PHẦN I: ..., ### A. KHỐI U...).
   - ĐỊNH DẠNG PHÂN CẤP RÕ RÀNG: Các số thứ tự mục (1., 2., 3...) và các chữ cái phân cấp (a., b., c., d...) BẮT BUỘC phải nằm trên DÒNG RIÊNG BIỆT, in đậm (VD: **1. HÌNH DẠNG**, **d. Không đều**), cách nhau bằng xuống dòng kép (\n\n). TUYỆT ĐỐI KHÔNG gộp chung dính liền dòng (như "1. HÌNH DẠNG d. Không đều").
   - Các chú thích hình ảnh (Figure 1 - ..., Figure 2 - ...) phải được dịch đầy đủ và đặt thành mục riêng hoặc ngay dưới mô tả hình.
   - BẮT BUỘC phân chia các đoạn văn, tiêu đề và các item bằng dấu xuống dòng kép (\n\n) rõ ràng.
2. DỊCH ĐẦY ĐỦ 100% CÁC CỘT VÀ Ô TRONG BẢNG BỂU (CỰC KỲ QUAN TRỌNG - KHÔNG ĐƯỢC MẤT CỘT BẢNG):
   - GIỮ NGUYÊN ĐÚNG SỐ LƯỢNG CỘT CỦA BẢNG GỐC TRONG ẢNH. Bảng gốc có bao nhiêu cột (2, 3, 4, 5 hay nhiều cột hơn) PHẢI TẠO BẢNG MARKDOWN CÓ ĐỦ BẤY NHIÊU CỘT (| Cột 1 | Cột 2 | Cột 3 | ... |).
   - TUYỆT ĐỐI KHÔNG DỒN HOẶC GỘP NHIỀU CỘT CỦA BẢNG THÀNH 1 CỘT. MỖI CỘT TRONG BẢNG GỐC PHẢI LÀ MỘT CỘT RIÊNG TRONG BẢNG MARKDOWN.
   - Dịch toàn bộ tiêu đề cột, tiêu đề hàng và từng ô nhỏ trong bảng sang tiếng Việt 100%.
3. TUYỆT ĐỐI KHÔNG XUẤT VĂN BẢN GỐC TIẾNG ANH HOẶC OCR TIẾNG ANH:
   - Kết quả PHẢI LÀ BẢN DỊCH TIẾNG VIỆT 100%. Dịch tất cả thuật ngữ y khoa sang tiếng Việt chuyên ngành chuẩn xác.
4. KHÔNG LỜI DẪN / KHÔNG CHÚ THÍCH THÊM: Dịch trực tiếp nội dung từ dòng đầu tiên cho tới dòng cuối cùng ở cuối trang.`;

    const prompt = `YÊU CẦU DỊCH THUẬT VÀ TRÌNH BÀY MARKDOWN ĐẸP 100% SANG TIẾNG VIỆT (Trang ${pageNumber}):
- Dịch hoàn toàn toàn bộ văn bản, đoạn văn, chú thích hình ảnh và nội dung trong ảnh trang y khoa này sang tiếng Việt. KHÔNG ĐƯỢC BỎ SÓT BẤT KỲ CÂU NÀO.
- YÊU CẦU ĐỊNH DẠNG MARKDOWN CỰC KỲ NGUYÊN TẮC:
  + Dùng tiêu đề Markdown (###) cho các tiêu đề chính/phần.
  + Các mục đánh số (1., 2., 3...) và chữ cái (a., b., c., d...) PHẢI nằm trên dòng riêng, in đậm rõ ràng, phân tách bằng xuống dòng kép (\\n\\n).
  + BẮT BUỘC xuất tất cả các bảng biểu dưới dạng Bảng Markdown có ĐỦ SỐ CỘT NHƯ BẢNG GỐC (| Cột 1 | Cột 2 | Cột 3 | ... |). TUYỆT ĐỐI KHÔNG làm mất hay gộp các cột.
  + Phân tách rõ ràng giữa các đoạn văn và mục bằng xuống dòng kép (\\n\\n).`;

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

      // Handle ShopAIKey / OpenAI Proxy Key (sk-...)
      if (key.startsWith('sk-')) {
        try {
          let fullText = "";
          for await (const chunkText of this.callOpenAIStream(key, requestModel, systemInstruction, prompt, imageBuffer, signal)) {
            if (signal?.aborted) break;
            fullText += chunkText;
            yield chunkText;
          }
          GeminiService.lastSuccessfulKey = key;
          if (!fullText) {
            throw new Error("Proxy API returned no text.");
          }
          console.log(`[MediTrans] Translation for page: ${pageNumber} finished via ShopAIKey/Proxy in ${((Date.now() - totalStartTime) / 1000).toFixed(2)}s`);
          break;
        } catch (error: any) {
          if (signal?.aborted || error.message === "Translation aborted") {
            throw new Error("Translation aborted");
          }
          const isQuota = error.message?.includes("429") || error.message?.toLowerCase().includes("quota") || error.message?.includes("401");
          if (retryCount < MAX_RETRIES && this.rotateKey(key, isQuota)) {
            retryCount++;
            continue;
          }
          throw error;
        }
      }

      // Handle Standard Google Gemini Key (AIzaSy...)
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
              data: imageBuffer.split(",")[1] || imageBuffer,
            },
          },
        ]);

        console.log(`[MediTrans] API request sent. Model: ${requestModel}. Wait time for stream start...`);
        let fullText = "";
        let chunkCount = 0;
        for await (const chunk of response.stream) {
          if (signal?.aborted) {
            console.log("[MediTrans] Stream aborted by signal");
            break; 
          }
          if (chunkCount === 0) {
            console.log(`[MediTrans] Stream started after ${Date.now() - fetchStartTime}ms`);
          }
          chunkCount++;
          
          let chunkText = "";
          try {
             chunkText = chunk.text();
          } catch (e) {
             console.warn("[MediTrans] Error reading chunk text", e);
             continue;
          }

          if (chunkText) {
            fullText += chunkText;
            yield chunkText;
          }
        }

        GeminiService.lastSuccessfulKey = key;
        if (!fullText) {
          throw new Error("Model returned no text.");
        }
        
        console.log(`[MediTrans] Translation for page: ${pageNumber} finished in ${((Date.now() - totalStartTime) / 1000).toFixed(2)}s`);
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
            await new Promise(resolve => setTimeout(resolve, 200 + Math.random() * 300));
            continue;
          }
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
    
    console.log(`[MediTrans] Starting non-stream translation for page: ${pageNumber} using model: ${requestModel}`);
    const totalStartTime = Date.now();
    
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

      const systemInstruction = `BẠN LÀ CHUYÊN GIA DỊCH THUẬT Y KHOA CAO CẤP (ANH - VIỆT).
Nhiệm vụ tối quan trọng: Đọc hình ảnh trang tài liệu y khoa (trang ${pageNumber}) và DỊCH ĐẦY ĐỦ 100% TỪNG CÂU, TỪNG ĐOẠN, TỪNG CHÚ THÍCH HÌNH ẢNH (Figure 1, Figure 2...) TỪ ĐẦU ĐẾN CUỐI TRANG SANG TIẾNG VIỆT. TUYỆT ĐỐI KHÔNG TÓM TẮT, KHÔNG CẮT BỚT BẤT KỲ NỘI DUNG HAY CHI TIẾT NÀO.

QUY TẮC BẮT BUỘC VỀ ĐỊNH DẠNG VÀ CẤU TRÚC MARKDOWN (CỰC KỲ QUAN TRỌNG):
1. TRÌNH BÀY ĐẸP VÀ PHÂN CHIA RÕ RÀNG BẰNG MARKDOWN:
   - Dùng tiêu đề Markdown (#, ##, ###, ####) cho tiêu đề trang, tên chương, tiêu đề mục lớn/nhỏ (Ví dụ: ### GIỚI THIỆU, ### PHẦN I: ..., ### A. KHỐI U...).
   - ĐỊNH DẠNG PHÂN CẤP RÕ RÀNG: Các số thứ tự mục (1., 2., 3...) và các chữ cái phân cấp (a., b., c., d...) BẮT BUỘC phải nằm trên DÒNG RIÊNG BIỆT, in đậm (VD: **1. HÌNH DẠNG**, **d. Không đều**), cách nhau bằng xuống dòng kép (\n\n). TUYỆT ĐỐI KHÔNG gộp chung dính liền dòng (như "1. HÌNH DẠNG d. Không đều").
   - Các chú thích hình ảnh (Figure 1 - ..., Figure 2 - ...) phải được dịch đầy đủ và đặt thành mục riêng hoặc ngay dưới mô tả hình.
   - BẮT BUỘC phân chia các đoạn văn, tiêu đề và các item bằng dấu xuống dòng kép (\n\n) rõ ràng.
2. DỊCH ĐẦY ĐỦ 100% CÁC CỘT VÀ Ô TRONG BẢNG BỂU (CỰC KỲ QUAN TRỌNG - KHÔNG ĐƯỢC MẤT CỘT BẢNG):
   - GIỮ NGUYÊN ĐÚNG SỐ LƯỢNG CỘT CỦA BẢNG GỐC TRONG ẢNH. Bảng gốc có bao nhiêu cột (2, 3, 4, 5 hay nhiều cột hơn) PHẢI TẠO BẢNG MARKDOWN CÓ ĐỦ BẤY NHIÊU CỘT (| Cột 1 | Cột 2 | Cột 3 | ... |).
   - TUYỆT ĐỐI KHÔNG DỒN HOẶC GỘP NHIỀU CỘT CỦA BẢNG THÀNH 1 CỘT. MỖI CỘT TRONG BẢNG GỐC PHẢI LÀ MỘT CỘT RIÊNG TRONG BẢNG MARKDOWN.
   - Dịch toàn bộ tiêu đề cột, tiêu đề hàng và từng ô nhỏ trong bảng sang tiếng Việt 100%.
3. TUYỆT ĐỐI KHÔNG XUẤT VĂN BẢN GỐC TIẾNG ANH HOẶC OCR TIẾNG ANH:
   - Kết quả PHẢI LÀ BẢN DỊCH TIẾNG VIỆT 100%. Dịch tất cả thuật ngữ y khoa sang tiếng Việt chuyên ngành chuẩn xác.
4. KHÔNG LỜI DẪN / KHÔNG CHÚ THÍCH THÊM: Dịch trực tiếp nội dung từ dòng đầu tiên cho tới dòng cuối cùng ở cuối trang.`;

      const prompt = `YÊU CẦU DỊCH THUẬT VÀ TRÌNH BÀY MARKDOWN ĐẸP 100% SANG TIẾNG VIỆT (Trang ${pageNumber}):
- Dịch hoàn toàn toàn bộ văn bản, đoạn văn, chú thích hình ảnh và nội dung trong ảnh trang y khoa này sang tiếng Việt. KHÔNG ĐƯỢC BỎ SÓT BẤT KỲ CÂU NÀO.
- YÊU CẦU ĐỊNH DẠNG MARKDOWN CỰC KỲ NGUYÊN TẮC:
  + Dùng tiêu đề Markdown (###) cho các tiêu đề chính/phần.
  + Các mục đánh số (1., 2., 3...) và chữ cái (a., b., c., d...) PHẢI nằm trên dòng riêng, in đậm rõ ràng, phân tách bằng xuống dòng kép (\\n\\n).
  + BẮT BUỘC xuất tất cả các bảng biểu dưới dạng Bảng Markdown có ĐỦ SỐ CỘT NHƯ BẢNG GỐC (| Cột 1 | Cột 2 | Cột 3 | ... |). TUYỆT ĐỐI KHÔNG làm mất hay gộp các cột.
  + Phân tách rõ ràng giữa các đoạn văn và mục bằng xuống dòng kép (\\n\\n).`;

      if (key.startsWith('sk-')) {
        try {
          const text = await this.callOpenAINonStream(key, requestModel, systemInstruction, prompt, imageBuffer, signal);
          const resultText = text.replace(/(\s*\.\s*){4,}/g, ' ... ');
          GeminiService.lastSuccessfulKey = key;
          return resultText;
        } catch (error: any) {
          if (signal?.aborted) throw new Error("Translation aborted");
          const isQuota = error.message?.includes("429") || error.message?.toLowerCase().includes("quota") || error.message?.includes("401");
          if (retryCount < MAX_RETRIES && this.rotateKey(key, isQuota)) {
            retryCount++;
            continue;
          }
          throw error;
        }
      }

      try {
        const genModel = ai.getGenerativeModel({ 
          model: requestModel,
          systemInstruction: systemInstruction,
          generationConfig: { temperature: 0 }
        });

        const result = await genModel.generateContent([
          prompt, 
          { inlineData: { mimeType: "image/jpeg", data: imageBuffer.split(",")[1] || imageBuffer } }
        ]);

        const response = await result.response;
        let text = response.text() || "";
        const resultText = text.replace(/(\s*\.\s*){4,}/g, ' ... ');
        console.log(`[MediTrans] Translation for page: ${pageNumber} finished in ${((Date.now() - totalStartTime) / 1000).toFixed(2)}s`);
        return resultText;
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

    if (key.startsWith('sk-')) {
      const text = await this.callOpenAINonStream(key, this.modelName, systemInstruction, prompt, "", undefined);
      return JSON.parse(text.replace(/```json\n?|```/g, '').trim());
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

    if (key.startsWith('sk-')) {
      return await this.callOpenAINonStream(key, this.modelName, systemInstruction, prompt, imageBuffer, undefined);
    }

    try {
      const genModel = ai.getGenerativeModel({ 
        model: this.modelName,
        systemInstruction: systemInstruction,
        generationConfig: { temperature: 0.1 }
      });
      const result = await genModel.generateContent([
        prompt, 
        { inlineData: { mimeType: "image/jpeg", data: imageBuffer.split(",")[1] || imageBuffer } }
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

    if (key.startsWith('sk-')) {
      for await (const chunkText of this.callOpenAIStream(key, this.modelName, systemInstruction, prompt, "", signal)) {
        if (signal?.aborted) break;
        yield chunkText;
      }
      return;
    }

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

