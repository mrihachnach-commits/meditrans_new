import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { TranslationService, TranslationOptions } from "./translationService";
import { cleanLatex } from "../utils/textFormatting";
import { auth } from "../firebase";

export class GeminiService implements TranslationService {
  private apiKeys: string[] = [];
  private modelName: string;
  private exhaustedKeys: Set<string> = new Set();
  private static globalKeyLastUsed: Map<string, number> = new Map();
  private static lastSuccessfulKey: string | null = null;
  private static requestDispatchLock: Promise<void> = Promise.resolve();
  /** Model không chấp nhận tham số thinking → không gửi nữa. */
  private static thinkingUnsupported = new Set<string>();
  /** Model không nhận mức "minimal" → lùi về "low" trước khi bỏ hẳn tham số. */
  private static thinkingLowOnly = new Set<string>();
  private static reasoningUnsupported = false;

  /**
   * Dịch thuật không cần "suy nghĩ" dài: Gemini 3 mặc định thinking mức CAO (tốn token đầu ra + chậm).
   * Gemini 3.x Flash → thinkingLevel "minimal", 3.x Pro → "low"; 2.5 Flash/Flash-Lite → thinkingBudget 0.
   */
  private static thinkingConfigFor(model: string, prefer: 'minimal' | 'low' = 'minimal'): Record<string, any> | undefined {
    const m = (model || '').toLowerCase();
    if (GeminiService.thinkingUnsupported.has(m)) return undefined;
    const ver = m.match(/gemini-(\d+(?:\.\d+)?)/);
    if (!ver) return undefined;
    const v = parseFloat(ver[1]);
    if (v >= 3) return { thinkingLevel: m.includes('pro') || prefer === 'low' || GeminiService.thinkingLowOnly.has(m) ? 'low' : 'minimal' };
    if (v >= 2.5) return m.includes('pro') ? { thinkingBudget: 128 } : { thinkingBudget: 0 };
    return undefined;
  }

  private static genConfig(model: string, base: Record<string, any>, prefer: 'minimal' | 'low' = 'minimal'): Record<string, any> {
    const thinking = GeminiService.thinkingConfigFor(model, prefer);
    return thinking ? { ...base, thinkingConfig: thinking } : base;
  }

  /** Lỗi do tham số thinking/reasoning không được hỗ trợ → ghi nhớ để lần sau bỏ, trả về true để thử lại ngay. */
  private static handleThinkingError(model: string, error: any): boolean {
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('reasoning') && !GeminiService.reasoningUnsupported) {
      GeminiService.reasoningUnsupported = true;
      console.warn('[MediTrans] Proxy không hỗ trợ reasoning_effort → bỏ tham số này.');
      return true;
    }
    const m = (model || '').toLowerCase();
    if (/thinking/.test(msg) && !GeminiService.thinkingUnsupported.has(m)) {
      const ver = m.match(/gemini-(\d+(?:\.\d+)?)/);
      if (ver && parseFloat(ver[1]) >= 3 && !m.includes('pro') && !GeminiService.thinkingLowOnly.has(m)) {
        GeminiService.thinkingLowOnly.add(m);
        console.warn(`[MediTrans] Model ${model} không nhận thinkingLevel "minimal" → dùng "low".`);
        return true;
      }
      GeminiService.thinkingUnsupported.add(m);
      console.warn(`[MediTrans] Model ${model} không nhận thinkingConfig → bỏ tham số này.`);
      return true;
    }
    return false;
  }

  /** reasoning_effort cho proxy kiểu OpenAI (chỉ với model Gemini có thinking). */
  private static reasoningFor(model: string): string | undefined {
    if (GeminiService.reasoningUnsupported) return undefined;
    const m = (model || '').toLowerCase();
    if (/gemini-2\.5-flash(?!-lite)/.test(m)) return 'none';
    const ver = m.match(/gemini-(\d+(?:\.\d+)?)/);
    if (ver && parseFloat(ver[1]) >= 3) return m.includes('pro') ? 'low' : 'minimal';
    return undefined;
  }

  constructor(apiKeys?: string | string[], modelName: string = "gemini-2.5-flash-lite") {
    const cleanModel = (modelName || '').trim();
    if (!cleanModel || cleanModel === 'gemini' || cleanModel === 'shopaikey' || cleanModel === 'openai') {
      this.modelName = "gemini-2.5-flash-lite";
    } else {
      this.modelName = cleanModel;
    }
    
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
    
    console.log(`[MediTrans] GeminiService: ${this.apiKeys.length} keys loaded. Model: ${this.modelName}`);
  }

  public static isProxyKey(key: string, engineOrModel?: string): boolean {
    if (!key) return false;
    const clean = key.trim();
    if (clean === 'system_proxy') return true;
    const eng = (engineOrModel || '').toLowerCase();
    if (clean.startsWith('sk-') || clean.startsWith('sh-') || clean.startsWith('sai-')) return true;
    if (eng === 'shopaikey' || eng.includes('openai') || eng.includes('proxy')) return true;
    if (!clean.startsWith('AIzaSy') && clean.length >= 16 && (eng === 'shopaikey' || eng.includes('proxy'))) return true;
    return false;
  }

  private isCurrentKeyProxy(key: string): boolean {
    return GeminiService.isProxyKey(key, this.modelName);
  }

  private getMIN_REQUEST_INTERVAL(key: string): number {
    if (this.isCurrentKeyProxy(key)) {
      // Stagger spacing for proxy multithreading
      return this.apiKeys.length > 1 ? 100 : 200;
    }
    return this.apiKeys.length > 5 ? 400 : 700;
  }

  private getBestAvailableKey(): string | null {
    if (this.apiKeys.length === 0) return null;

    const now = Date.now();
    const validKeys = this.apiKeys.filter(k => !this.exhaustedKeys.has(k));
    
    // If all keys are marked exhausted, use any key to avoid starving
    const candidateKeys = validKeys.length > 0 ? validKeys : this.apiKeys;

    if (GeminiService.lastSuccessfulKey && candidateKeys.includes(GeminiService.lastSuccessfulKey)) {
      const lastUsed = GeminiService.globalKeyLastUsed.get(GeminiService.lastSuccessfulKey) || 0;
      if (now - lastUsed >= this.getMIN_REQUEST_INTERVAL(GeminiService.lastSuccessfulKey)) {
        return GeminiService.lastSuccessfulKey;
      }
    }

    candidateKeys.sort((a, b) => (GeminiService.globalKeyLastUsed.get(a) || 0) - (GeminiService.globalKeyLastUsed.get(b) || 0));

    return candidateKeys[0];
  }

  private async acquireKeyAndInstance(): Promise<{ ai: any, key: string }> {
    const key = this.getBestAvailableKey();
    if (!key) {
      console.error("[MediTrans] No available API keys for GeminiService.");
      throw new Error("Không có API Key khả dụng (Tất cả đang bảo trì hoặc hết hạn mức).");
    }

    await this.waitForKeyRateLimit(key);
    
    try {
      const isProxy = this.isCurrentKeyProxy(key);
      console.log(`[MediTrans] Using key: ...${key.substring(key.length - 4)} (${isProxy ? 'ShopAIKey/Proxy' : 'Google Gemini'}) for ${this.modelName}`);
      if (isProxy) {
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
    const interval = this.getMIN_REQUEST_INTERVAL(key);
    
    if (now - lastUsed < interval) {
      const waitTime = interval - (now - lastUsed);
      if (waitTime > 30) {
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
    
    GeminiService.globalKeyLastUsed.set(key, Date.now());
  }

  private rotateKey(exhaustedKey: string, isQuotaError: boolean = true): boolean {
    if (this.apiKeys.length <= 1) {
      // Single Key mode: Never permanently ban the single key!
      // Return true so exponential backoff will retry with the single key without crashing multithreading.
      console.warn(`[MediTrans] Single key ${isQuotaError ? 'quota/rate-limit' : 'temporary error'}. Will retry with exponential backoff.`);
      return true;
    }

    if (exhaustedKey) {
      const waitTime = isQuotaError ? 20000 : 5000;
      console.warn(`[MediTrans] Key ...${exhaustedKey.slice(-4)} ${isQuotaError ? 'QUOTA EXHAUSTED' : 'ERROR'}. Cooldown: ${waitTime}ms`);
      this.exhaustedKeys.add(exhaustedKey);
      
      setTimeout(() => {
        this.exhaustedKeys.delete(exhaustedKey);
        console.log(`[MediTrans] Key ...${exhaustedKey.slice(-4)} recovered.`);
      }, waitTime);
    }
    
    return true;
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

    if (modelName === 'gemini-flash-lite-latest' || modelName === 'gemini-flash' || modelName === 'gemini-2.5-flash-lite') {
      return 'gemini-2.5-flash-lite';
    }
    if (modelName === 'gemini-3.6-flash' || modelName === 'gemini-3-flash-preview') {
      return 'gemini-2.5-flash-lite';
    }
    return modelName;
  }

  public mapModelForGoogle(modelName?: string): string {
    const clean = (modelName || '').toLowerCase().trim();
    if (!clean || clean === 'gemini' || clean === 'shopaikey' || clean === 'openai') {
      return 'gemini-3.6-flash';
    }
    // If it is already an active modern Google Generative AI model name
    if (clean === 'gemini-3.6-flash' || clean === 'gemini-3-flash-preview' || clean === 'gemini-flash-latest') {
      return clean;
    }
    // Deep / Pro modes
    if (clean.includes('3.6') || clean.includes('pro') || clean.includes('deep')) {
      return 'gemini-3.6-flash';
    }
    // Default to active modern flash model
    return 'gemini-3.6-flash';
  }

  private getProxyBaseUrl(): string {
    const baseUrl = (typeof window !== 'undefined' ? localStorage.getItem('mediTrans_customBaseUrl') : null) || 'https://api.shopaikey.com/v1';
    let cleanBaseUrl = baseUrl.trim().replace(/\/+$/, '');
    if (!cleanBaseUrl.endsWith('/chat/completions')) {
      cleanBaseUrl = `${cleanBaseUrl}/chat/completions`;
    }
    return cleanBaseUrl;
  }

  private async *callOpenAIStream(
    key: string,
    model: string,
    systemInstruction: string,
    prompt: string,
    imageBase64: string,
    signal?: AbortSignal
  ): AsyncGenerator<string> {
    const cleanBaseUrl = this.getProxyBaseUrl();
    const mappedModel = this.mapModelForOpenAI(model);

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: "system", content: systemInstruction });
    }

    const userContent: any[] = [];
    if (imageBase64) {
      const formattedImage = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64.split(',')[1] || imageBase64}`;
      userContent.push({
        type: "image_url",
        image_url: { 
          url: formattedImage,
          detail: "high"
        }
      });
    }
    userContent.push({ type: "text", text: prompt });

    messages.push({ role: "user", content: userContent });

    const body: any = {
      model: mappedModel,
      temperature: 0,
      max_tokens: 8192,
      stream: true,
      messages
    };
    const reasoning = GeminiService.reasoningFor(mappedModel);
    if (reasoning) body.reasoning_effort = reasoning;

    let requestUrl = cleanBaseUrl;
    let authHeaderValue = `Bearer ${key.trim()}`;

    if (key.trim() === 'system_proxy') {
      requestUrl = '/api/ai/chat';
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Vui lòng đăng nhập để sử dụng Key hệ thống.");
      }
      const token = await currentUser.getIdToken();
      authHeaderValue = `Bearer ${token}`;
    }

    console.log(`[MediTrans] Calling Stream (${requestUrl}) using model: ${mappedModel}`);

    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeaderValue
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      if (response.status === 403 && key.trim() === 'system_proxy') {
        throw new Error("Tài khoản của bạn chưa đủ Level 2 hoặc đã hết hạn.");
      }
      const errText = await response.text();
      throw new Error(`ShopAIKey/Proxy Error (${response.status}): ${errText}`);
    }

    if (!response.body) {
      throw new Error("Response body is empty");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let yieldedAny = false;

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
            const content = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content;
            if (content) {
              yieldedAny = true;
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
          const content = parsed.choices?.[0]?.delta?.content || parsed.choices?.[0]?.message?.content;
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
    signal?: AbortSignal,
    maxTokens = 8192
  ): Promise<string> {
    const cleanBaseUrl = this.getProxyBaseUrl();
    const mappedModel = this.mapModelForOpenAI(model);

    const messages: any[] = [];
    if (systemInstruction) {
      messages.push({ role: "system", content: systemInstruction });
    }

    const userContent: any[] = [];
    if (imageBase64) {
      const formattedImage = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64.split(',')[1] || imageBase64}`;
      userContent.push({
        type: "image_url",
        image_url: { 
          url: formattedImage,
          detail: "high"
        }
      });
    }
    userContent.push({ type: "text", text: prompt });

    messages.push({ role: "user", content: userContent });

    const body: any = {
      model: mappedModel,
      temperature: 0,
      max_tokens: maxTokens,
      stream: false,
      messages
    };
    const reasoning = GeminiService.reasoningFor(mappedModel);
    if (reasoning) body.reasoning_effort = reasoning;

    let requestUrl = cleanBaseUrl;
    let authHeaderValue = `Bearer ${key.trim()}`;

    if (key.trim() === 'system_proxy') {
      requestUrl = '/api/ai/chat';
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error("Vui lòng đăng nhập để sử dụng Key hệ thống.");
      }
      const token = await currentUser.getIdToken();
      authHeaderValue = `Bearer ${token}`;
    }

    console.log(`[MediTrans] Calling Non-Stream (${requestUrl}) using model: ${mappedModel}`);

    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeaderValue
      },
      body: JSON.stringify(body),
      signal
    });

    if (!response.ok) {
      if (response.status === 403 && key.trim() === 'system_proxy') {
        throw new Error("Tài khoản của bạn chưa đủ Level 2 hoặc đã hết hạn.");
      }
      const errText = await response.text();
      throw new Error(`ShopAIKey/Proxy Error (${response.status}): ${errText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }

  public async testSingleKeyTranslation(key: string, sampleText: string = "Hello world! Testing translation AI."): Promise<{ success: boolean; resultText?: string; error?: string; latencyMs?: number }> {
    if (!key || !key.trim()) return { success: false, error: "API Key trống" };
    const cleanKey = key.trim();
    if (cleanKey === 'system_proxy' || cleanKey.startsWith('system_')) {
      return { success: true, resultText: "Key hệ thống sẵn sàng", latencyMs: 0 };
    }
    const startTime = Date.now();
    const prompt = `Dịch câu sau sang tiếng Việt ngắn gọn: "${sampleText}"`;
    const systemInstruction = "Bạn là dịch giả y khoa. Dịch chính xác và ngắn gọn.";

    try {
      if (this.isCurrentKeyProxy(cleanKey)) {
        const text = await this.callOpenAINonStream(cleanKey, this.modelName, systemInstruction, prompt, "", undefined);
        const latencyMs = Date.now() - startTime;
        return { success: true, resultText: text || "Thành công", latencyMs };
      } else {
        const ai = new GoogleGenerativeAI(cleanKey);
        const candidates = Array.from(new Set([
          this.mapModelForGoogle(this.modelName),
          'gemini-3.6-flash',
          'gemini-3-flash-preview',
          'gemini-flash-latest'
        ]));
        
        let lastError: any = null;
        for (const modelCandidate of candidates) {
          try {
            const genModel = ai.getGenerativeModel({ model: modelCandidate });
            const res = await genModel.generateContent(`${systemInstruction}\n${prompt}`);
            const response = await res.response;
            const text = response.text()?.trim();
            const latencyMs = Date.now() - startTime;
            return { success: true, resultText: text || "Thành công", latencyMs };
          } catch (modelErr: any) {
            lastError = modelErr;
            if (modelErr?.message?.includes('404') || modelErr?.message?.toLowerCase().includes('not found')) {
              console.warn(`[GeminiService] Model ${modelCandidate} not available for key ...${cleanKey.slice(-4)}, trying next candidate...`);
              continue;
            }
            throw modelErr;
          }
        }
        throw lastError || new Error("Không thể kết nối với mô hình Gemini khả dụng.");
      }
    } catch (err: any) {
      return { success: false, error: err.message || "Lỗi không xác định" };
    }
  }

  public async testSingleKey(key: string): Promise<boolean> {
    if (!key || !key.trim()) return false;
    const cleanKey = key.trim();
    if (cleanKey === 'system_proxy' || cleanKey.startsWith('system_')) {
      return true;
    }
    if (this.isCurrentKeyProxy(cleanKey)) {
      try {
        const cleanBaseUrl = this.getProxyBaseUrl();
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
        const candidates = Array.from(new Set([
          this.mapModelForGoogle(this.modelName),
          'gemini-3.6-flash',
          'gemini-3-flash-preview'
        ]));
        for (const modelCandidate of candidates) {
          try {
            const genModel = ai.getGenerativeModel({ model: modelCandidate });
            const res = await genModel.generateContent('Hi');
            if (res) return true;
          } catch (e: any) {
            if (e?.message?.includes('404') || e?.message?.toLowerCase().includes('not found')) {
              continue;
            }
            return false;
          }
        }
        return false;
      } catch (e: any) {
        console.warn(`[GeminiService] testSingleKey error for ...${cleanKey.slice(-4)}:`, e?.message || e);
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

  /**
   * Prompt dịch trang (dùng chung cho stream & non-stream).
   * Viết bằng tiếng Anh, ngắn gọn: tiếng Việt có dấu tốn 2–3 lần token so với tiếng Anh,
   * prompt cũ (~7.700 ký tự, lặp 2 lần) tốn ~3.000+ token/trang — nhiều hơn cả ảnh trang.
   * Giữ nguyên mọi quy tắc trình bày; đầu ra vẫn 100% tiếng Việt.
   */
  public static buildPagePrompt(pageNumber: number): { systemInstruction: string; prompt: string } {
    const systemInstruction = `You are an expert English→Vietnamese medical translator. Translate the page image into Vietnamese Markdown.
Rules:
1. Translate EVERYTHING into Vietnamese: page title, section headings, subheadings, list items, paragraphs, table cells, captions, in-figure labels (Figure n → **Hình n**, Table n → **Bảng n**). Never leave an English heading or sentence untranslated; keep only abbreviations, drug/gene names, numbers and units as written (CT, MRI, TDLU, BI-RADS, mg).
2. Omit page furniture entirely — running header/footer lines, chapter name in side tabs, page numbers. Do not output them in any language.
3. No preamble, notes or code fences.
4. Structure: page title → "## "; section headings (often in a colored/boxed band, e.g. EMBRYOLOGY) → "### " in CAPITALS; subheadings (e.g. Embryologic Events) → "**bold text**" alone on its line, never as a bullet. Bullets: "- " level 1, "  - " level 2, "    - " level 3; keep every level, never flatten. Blank line between blocks.
5. Reading order: multi-column pages column by column (left column top→bottom, then the next); never mix lines across columns; text continued from the previous page first.
6. Tables: GFM with the original number of columns, leading and trailing pipes, |---| separator row, one row per line, blank line before and after.
7. Symbols as plain Unicode (> < ≤ ≥ ± × ↑ ↓ µm °C %), never LaTeX or $. Abbreviation boxes: "- **RV**: Thất phải (Right ventricle)".
Example of the expected shape:
### PHÔI THAI HỌC
**Các sự kiện phôi thai**
- Tuần 4–6
  - Dải ngoại bì phát triển từ nách đến bẹn của thai nhi`;
    return { systemInstruction, prompt: `Page ${pageNumber}. Translate the whole page.` };
  }

  async *translateMedicalPageStream(options: TranslationOptions): AsyncGenerator<string> {
    const { imageBuffer, pageNumber, signal, model } = options;
    const requestModel = model || this.modelName;
    
    console.log(`[MediTrans] Starting stream translation for page: ${pageNumber} using model: ${requestModel}`);
    const totalStartTime = Date.now();

    if (signal?.aborted) {
      throw new Error("Translation aborted");
    }

    const { systemInstruction, prompt } = GeminiService.buildPagePrompt(pageNumber);

    const MAX_RETRIES = 6;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) {
        throw new Error("Translation aborted");
      }
      
      let ai, key: string;
      try {
        ({ ai, key } = await this.acquireKeyAndInstance());
      } catch (e: any) {
        throw new Error("Không tìm thấy API Key khả dụng. Vui lòng kiểm tra lại Key trong Cài đặt.");
      }

      const isProxy = this.isCurrentKeyProxy(key);

      // Handle ShopAIKey / OpenAI Proxy Key
      if (isProxy) {
        try {
          let fullText = "";
          for await (const chunkText of this.callOpenAIStream(key, requestModel, systemInstruction, prompt, imageBuffer, signal)) {
            if (signal?.aborted) break;
            fullText += chunkText;
            yield chunkText;
          }
          GeminiService.lastSuccessfulKey = key;
          
          if (!fullText) {
            // Auto fallback to non-stream if stream ended with 0 text
            console.warn(`[MediTrans] Stream returned empty for page ${pageNumber}. Retrying non-stream...`);
            const fallbackText = await this.callOpenAINonStream(key, requestModel, systemInstruction, prompt, imageBuffer, signal);
            if (fallbackText) {
              fullText = fallbackText;
              yield fallbackText;
            } else {
              throw new Error("Proxy API returned empty response.");
            }
          }
          
          console.log(`[MediTrans] Translation for page: ${pageNumber} finished via ShopAIKey/Proxy in ${((Date.now() - totalStartTime) / 1000).toFixed(2)}s`);
          return;
        } catch (error: any) {
          if (signal?.aborted || error.message === "Translation aborted") {
            throw new Error("Translation aborted");
          }
          if (GeminiService.handleThinkingError(this.mapModelForGoogle(requestModel), error)) continue;
          const isQuota = error.message?.includes("429") || error.message?.toLowerCase().includes("quota") || error.message?.includes("401");
          const isServerErr = error.message?.includes("500") || error.message?.includes("502") || error.message?.includes("503") || error.message?.includes("504") || error.message?.toLowerCase().includes("fetch");
          
          if (retryCount < MAX_RETRIES && this.rotateKey(key, isQuota)) {
            retryCount++;
            const delay = Math.min(8000, Math.pow(1.5, retryCount) * 800 + Math.random() * 500);
            console.warn(`[MediTrans] Retrying page ${pageNumber} (attempt ${retryCount}/${MAX_RETRIES}) after ${delay.toFixed(0)}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw error;
        }
      }

      // Handle Standard Google Gemini Key (AIzaSy...)
      try {
        const fetchStartTime = Date.now();
        const googleModel = this.mapModelForGoogle(requestModel);
        const genModel = ai.getGenerativeModel({ 
          model: googleModel,
          systemInstruction: systemInstruction,
          generationConfig: GeminiService.genConfig(googleModel, { temperature: 0, maxOutputTokens: 8192 }, 'low')
        });

        const response = await genModel.generateContentStream([
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageBuffer.split(",")[1] || imageBuffer,
            },
          },
          prompt,
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
          if (GeminiService.handleThinkingError(this.mapModelForGoogle(requestModel), error)) continue;
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
          if (canRotate && this.apiKeys.length > 1) {
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

    const MAX_RETRIES = 6;
    let retryCount = 0;

    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) throw new Error("Translation aborted");
      let ai, key: string;
      try {
        ({ ai, key } = await this.acquireKeyAndInstance());
      } catch (e) {
        throw new Error("Không tìm thấy API Key khả dụng.");
      }

      const { systemInstruction, prompt } = GeminiService.buildPagePrompt(pageNumber);

      const isProxy = this.isCurrentKeyProxy(key);

      if (isProxy) {
        try {
          const text = await this.callOpenAINonStream(key, requestModel, systemInstruction, prompt, imageBuffer, signal);
          const resultText = text.replace(/(\s*\.\s*){4,}/g, ' ... ');
          GeminiService.lastSuccessfulKey = key;
          return resultText;
        } catch (error: any) {
          if (signal?.aborted) throw new Error("Translation aborted");
          if (GeminiService.handleThinkingError(this.mapModelForGoogle(requestModel), error)) continue;
          const isQuota = error.message?.includes("429") || error.message?.toLowerCase().includes("quota") || error.message?.includes("401");
          if (retryCount < MAX_RETRIES && this.rotateKey(key, isQuota)) {
            retryCount++;
            const delay = Math.min(8000, Math.pow(1.5, retryCount) * 800 + Math.random() * 500);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }
          throw error;
        }
      }

      try {
        const googleModel = this.mapModelForGoogle(requestModel);
        const genModel = ai.getGenerativeModel({ 
          model: googleModel,
          systemInstruction: systemInstruction,
          generationConfig: GeminiService.genConfig(googleModel, { temperature: 0, maxOutputTokens: 8192 }, 'low')
        });

        const result = await genModel.generateContent([
          { inlineData: { mimeType: "image/jpeg", data: imageBuffer.split(",")[1] || imageBuffer } },
          prompt
        ]);

        const response = await result.response;
        let text = response.text() || "";
        const resultText = text.replace(/(\s*\.\s*){4,}/g, ' ... ');
        console.log(`[MediTrans] Translation for page: ${pageNumber} finished in ${((Date.now() - totalStartTime) / 1000).toFixed(2)}s`);
        return resultText;
      } catch (error: any) {
        if (signal?.aborted) throw new Error("Translation aborted");
        
          if (GeminiService.handleThinkingError(this.mapModelForGoogle(requestModel), error)) continue;
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
          retryCount++;
          const delay = Math.pow(1.5, retryCount) * 1000 + Math.random() * 500;
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    return "Lỗi: Quá số lần thử lại.";
  }

  async lookupMedicalTerm(term: string): Promise<any> {
    const systemInstruction = `Chuyên gia từ điển y khoa. Trả về JSON.`;
    const prompt = `Tra cứu: "${term}"`;

    let ai, key: string;
    try {
      ({ ai, key } = await this.acquireKeyAndInstance());
    } catch (e) {
      throw new Error("Không tìm thấy API Key.");
    }

    if (this.isCurrentKeyProxy(key)) {
      const text = await this.callOpenAINonStream(key, this.modelName, systemInstruction, prompt, "", undefined);
      return JSON.parse(text.replace(/```json\n?|```/g, '').trim());
    }

    try {
      const googleModel = this.mapModelForGoogle(this.modelName);
      const genModel = ai.getGenerativeModel({ 
        model: googleModel,
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
    let ai, key: string;
    try {
       ({ ai, key } = await this.acquireKeyAndInstance());
    } catch (e) {
       throw new Error("Không có API Key khả dụng.");
    }

    const systemInstruction = `OCR Y KHOA: Trích xuất văn bản chính xác.`;
    const prompt = "Hãy trích xuất văn bản từ hình ảnh này.";

    if (this.isCurrentKeyProxy(key)) {
      return await this.callOpenAINonStream(key, this.modelName, systemInstruction, prompt, imageBuffer, undefined);
    }

    try {
      const googleModel = this.mapModelForGoogle(this.modelName);
      const genModel = ai.getGenerativeModel({ 
        model: googleModel,
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

    let ai, key: string;
    try { ({ ai, key } = await this.acquireKeyAndInstance()); } catch (e) { throw new Error("API Key error."); }

    if (this.isCurrentKeyProxy(key)) {
      for await (const chunkText of this.callOpenAIStream(key, this.modelName, systemInstruction, prompt, "", signal)) {
        if (signal?.aborted) break;
        yield chunkText;
      }
      return;
    }

    try {
      const googleModel = this.mapModelForGoogle(this.modelName);
      const genModel = ai.getGenerativeModel({ 
        model: googleModel,
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
  /**
   * Dịch thường theo lớp chữ: nhận Markdown đã dựng sẵn từ lớp chữ PDF (cấu trúc chuẩn), chỉ dịch chữ.
   * Không gửi ảnh → nhanh hơn, ít token hơn, không lỗi đọc nhầm chữ.
   */
  async *translateMarkdownPageStream(markdown: string, pageNumber: number, signal?: AbortSignal, model?: string): AsyncGenerator<string> {
    const requestModel = model || this.modelName;
    const systemInstruction = `You are an expert English→Vietnamese medical translator. The user sends one page of a medical document as Markdown extracted from the PDF text layer; its structure is already correct.
Rules:
1. Translate ALL text into accurate, natural Vietnamese medical language. Keep only abbreviations, drug/gene names, numbers and units as written. "Figure n" → "Hình n", "Table n" → "Bảng n".
2. Keep the Markdown EXACTLY: same headings (#), list markers and indentation, **bold**/*italic* markers, line breaks, blank lines and order. Do not merge, split, add or drop lines. ALL-CAPS headings stay ALL-CAPS.
3. Output only the translated Markdown — no preamble, notes or code fences. Symbols as plain Unicode, never LaTeX.`;
    const prompt = markdown;
    const MAX_RETRIES = 5;
    let retryCount = 0;
    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) throw new Error('Translation aborted');
      let ai: any, key: string;
      try {
        ({ ai, key } = await this.acquireKeyAndInstance());
      } catch {
        throw new Error('Không tìm thấy API Key khả dụng. Vui lòng kiểm tra lại Key trong Cài đặt.');
      }
      let emitted = false;
      try {
        if (this.isCurrentKeyProxy(key)) {
          for await (const chunk of this.callOpenAIStream(key, requestModel, systemInstruction, prompt, '', signal)) {
            if (signal?.aborted) break;
            emitted = true;
            yield chunk;
          }
        } else {
          const gm = this.mapModelForGoogle(requestModel);
          const genModel = ai.getGenerativeModel({
            model: gm,
            systemInstruction,
            generationConfig: GeminiService.genConfig(gm, { temperature: 0, maxOutputTokens: 8192 }),
          });
          const response = await genModel.generateContentStream(prompt, signal ? ({ signal } as any) : undefined);
          for await (const chunk of response.stream) {
            if (signal?.aborted) throw new Error('Translation aborted');
            const t = chunk.text();
            if (t) { emitted = true; yield t; }
          }
        }
        if (!emitted && !signal?.aborted) throw new Error('Phản hồi rỗng.');
        GeminiService.lastSuccessfulKey = key;
        return;
      } catch (error: any) {
        if (signal?.aborted) throw new Error('Translation aborted');
        if (emitted) throw error; // đã hiển thị một phần → để lớp trên xử lý, tránh lặp nội dung
        if (GeminiService.handleThinkingError(this.mapModelForGoogle(requestModel), error)) continue;
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('level 2') || msg.includes('đăng nhập')) throw error;
        const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('401');
        if (retryCount < MAX_RETRIES && this.rotateKey(key, isQuota)) {
          retryCount++;
          await new Promise(r => setTimeout(r, Math.min(8000, Math.pow(1.5, retryCount) * 800 + Math.random() * 500)));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Quá số lần thử lại.');
  }

  /**
   * Dịch giữ định dạng: dịch danh sách khối chữ (đã trích từ PDF) sang tiếng Việt.
   * Trả về map id → bản dịch. Khối nào model bỏ sót sẽ không có trong map (giữ nguyên chữ gốc).
   */
  /**
   * OCR + dịch giữ định dạng cho trang scan (MỘT lần gọi): trả về từng khối chữ với vị trí trên ảnh,
   * chữ gốc và bản dịch tiếng Việt. Dùng chung hệ thống key / xoay key / key hệ thống của web.
   */
  async ocrLayoutBlocks(imageDataUrl: string, signal?: AbortSignal, opts: { mode?: 'full' | 'extra'; regions?: number[][] } = {}): Promise<any[]> {
    const extra = opts.mode === 'extra';
    const scope = extra
      ? `This page already has a normal text layer. Return ONLY: (1) text that is part of the IMAGES/photos/scans/diagrams inside these regions (box_2d [ymin,xmin,ymax,xmax] 0-1000): ${JSON.stringify(opts.regions || [])} — e.g. labels, annotations, measurements, words burned into ultrasound/X-ray/CT images, legends inside figures; and (2) any text rotated 90° (vertical text) anywhere on the page. Do NOT return the normal horizontal page text (paragraphs, headings, captions outside the images). If there is no such text, return {"blocks":[]}.`
      : `Detect EVERY text block on the page image: titles, headings, paragraphs, each list item (separately), figure/table captions, each table cell (separately), labels and text inside images/figures, vertical (rotated) text, running headers, footers, page numbers. Treat each text column separately. Do NOT merge blocks from different columns.`;
    const systemInstruction = `You are an OCR engine and an English→Vietnamese medical translator for book/journal pages (often scanned).
${scope}
For each block return:
- "box_2d": [ymin, xmin, ymax, xmax] integers 0-1000 (relative to image height/width) tightly enclosing the block's text
- "text": the exact original text (join lines with single spaces, remove end-of-line hyphenation)
- "v": natural, accurate Vietnamese medical translation of "text" (keep numbers, units, symbols, drug/gene names, abbreviations, person names, journal names, URLs, DOIs unchanged; Figure n → Hình n, Table n → Bảng n; ALL-CAPS stays ALL-CAPS; reference-list entries and page numbers: return unchanged; no Markdown, no line breaks)
- "lines": number of text lines of the block on the image
- "bold", "italic": true if most of the block is bold / italic
- "serif": true if the font is serif (Times-like), false if sans-serif
- "align": "left" | "center" | "right" | "justify"
- "dir": "up" if the text is rotated and reads bottom-to-top, "down" if it reads top-to-bottom; omit for normal horizontal text. For rotated text, "lines" counts the lines across the block.
Return ONLY JSON: {"blocks":[...]} in reading order (column by column, top to bottom).`;
    const prompt = extra
      ? 'Return only text inside the given image regions and rotated text, with boxes and Vietnamese translations. JSON only.'
      : 'OCR this page into text blocks with boxes and Vietnamese translations. JSON only.';
    const parse = (raw: string): any[] => {
      let txt = (raw || '').replace(/```json|```/gi, '').trim();
      const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
      const a2 = txt.indexOf('[');
      if (a2 >= 0 && (a < 0 || a2 < a)) txt = txt.slice(a2, txt.lastIndexOf(']') + 1);
      else if (a >= 0 && b > a) txt = txt.slice(a, b + 1);
      const d = JSON.parse(txt);
      const arr: any[] = Array.isArray(d) ? d : (d.blocks || d.t || []);
      const out = arr
        .filter(o => o && Array.isArray(o.box_2d || o.box) && typeof o.text === 'string' && o.text.trim())
        .map(o => ({
          box_2d: (o.box_2d || o.box).map(Number),
          text: String(o.text),
          v: typeof o.v === 'string' ? cleanLatex(o.v).replace(/\*\*/g, '').replace(/\s*\n\s*/g, ' ').trim() : undefined,
          lines: Number(o.lines) || undefined,
          bold: !!o.bold, italic: !!o.italic, serif: o.serif !== false,
          align: typeof o.align === 'string' ? o.align : undefined,
          dir: o.dir === 'up' || o.dir === 'down' ? o.dir : undefined,
        }));
      if (!out.length && !extra) throw new Error('OCR không trả về khối chữ hợp lệ.');
      return out;
    };

    const MAX_RETRIES = 4;
    for (let retry = 0; retry <= MAX_RETRIES; retry++) {
      if (signal?.aborted) throw new Error('Translation aborted');
      let ai: any, key: string;
      try {
        ({ ai, key } = await this.acquireKeyAndInstance());
      } catch {
        throw new Error('Không tìm thấy API Key khả dụng. Vui lòng kiểm tra lại Key trong Cài đặt.');
      }
      try {
        let raw = '';
        if (this.isCurrentKeyProxy(key)) {
          raw = await this.callOpenAINonStream(key, this.modelName, systemInstruction, prompt, imageDataUrl, signal, 16384);
        } else {
          const gm = this.mapModelForGoogle(this.modelName);
          const genModel = ai.getGenerativeModel({
            model: gm,
            systemInstruction,
            generationConfig: GeminiService.genConfig(gm, { temperature: 0.1, responseMimeType: 'application/json', maxOutputTokens: 16384 }, 'low'),
          });
          const result = await genModel.generateContent([
            prompt,
            { inlineData: { mimeType: 'image/jpeg', data: imageDataUrl.split(',')[1] || imageDataUrl } },
          ], signal ? ({ signal } as any) : undefined);
          raw = (await result.response).text() || '';
        }
        const parsed = parse(raw);
        GeminiService.lastSuccessfulKey = key;
        return parsed;
      } catch (error: any) {
        if (signal?.aborted) throw new Error('Translation aborted');
        if (GeminiService.handleThinkingError(this.mapModelForGoogle(this.modelName), error)) continue;
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('level 2') || msg.includes('đăng nhập')) throw error;
        const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('401');
        if (retry < MAX_RETRIES && this.rotateKey(key, isQuota)) {
          await new Promise(r => setTimeout(r, Math.min(8000, Math.pow(1.5, retry + 1) * 800)));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Quá số lần thử lại khi OCR trang.');
  }

  /**
   * Nhận diện bố cục cột của trang sách (dùng khi bộ nhận diện tự động không chắc chắn).
   * Trả về số cột văn bản thân bài và vị trí khe giữa các cột (tỉ lệ 0..1 theo chiều rộng trang).
   */
  async detectColumns(imageDataUrl: string, signal?: AbortSignal): Promise<{ columns: number; splits: number[] } | null> {
    const systemInstruction = `You analyze the page layout of a book/journal page image. Count the columns of the MAIN BODY TEXT only (ignore running headers, footers, page numbers, figures, tables, captions, side tabs). A full-width title above two text columns still means 2 columns.
Return ONLY JSON: {"columns":N,"splits":[...]} where N is 1, 2 or 3 and splits are the x-positions of the vertical white gaps between body-text columns, as fractions of the page width (0..1). For 1 column, splits is [].`;
    const prompt = 'How many body-text columns does this page have? JSON only.';
    const parse = (raw: string) => {
      let txt = (raw || '').replace(/```json|```/gi, '').trim();
      const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
      if (a >= 0 && b > a) txt = txt.slice(a, b + 1);
      const d = JSON.parse(txt);
      const columns = Math.round(Number(d?.columns));
      if (!Number.isFinite(columns) || columns < 1 || columns > 4) return null;
      const splits = (Array.isArray(d?.splits) ? d.splits : []).map(Number).filter((x: number) => Number.isFinite(x) && x > 0 && x < 1);
      return { columns, splits };
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) throw new Error('Translation aborted');
      let ai: any, key: string;
      try {
        ({ ai, key } = await this.acquireKeyAndInstance());
      } catch {
        return null;
      }
      try {
        let raw = '';
        if (this.isCurrentKeyProxy(key)) {
          raw = await this.callOpenAINonStream(key, this.modelName, systemInstruction, prompt, imageDataUrl, signal);
        } else {
          const gm = this.mapModelForGoogle(this.modelName);
          const genModel = ai.getGenerativeModel({
            model: gm,
            systemInstruction,
            generationConfig: GeminiService.genConfig(gm, { temperature: 0, responseMimeType: 'application/json' }),
          });
          const result = await genModel.generateContent([
            prompt,
            { inlineData: { mimeType: 'image/jpeg', data: imageDataUrl.split(',')[1] || imageDataUrl } },
          ], signal ? ({ signal } as any) : undefined);
          raw = (await result.response).text() || '';
        }
        const parsed = parse(raw);
        if (parsed) GeminiService.lastSuccessfulKey = key;
        return parsed;
      } catch (error: any) {
        if (signal?.aborted) throw new Error('Translation aborted');
        if (GeminiService.handleThinkingError(this.mapModelForGoogle(this.modelName), error)) continue;
        const msg = String(error?.message || '').toLowerCase();
        const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('401');
        if (attempt === 0 && this.rotateKey(key, isQuota)) continue;
        console.warn('[Layout] detectColumns lỗi:', error);
        return null;
      }
    }
    return null;
  }

  async translateLayoutBlocks(
    blocks: { id: string; text: string }[],
    signal?: AbortSignal
  ): Promise<Record<string, string>> {
    if (!blocks.length) return {};

    const systemInstruction = `English→Vietnamese medical translator. Input: JSON text blocks extracted from one PDF page (reading order). Translate each block into natural, accurate Vietnamese medical language, consistent across blocks; it will be redrawn in the same box, so keep it concise and add nothing.
Keep unchanged: numbers, units, symbols (± ≤ ≥ × µ °), drug/gene names, abbreviations, superscripts (¹²³), person names, journal names, URLs, DOIs, emails. Reference-list entries: return unchanged.
Some blocks mark differently-styled words (bold/colored) with tags like <1>Right Ventricle</1>: put the same tag pair around the corresponding Vietnamese words (e.g. <1>Tâm thất phải</1>); keep every tag, add no new ones.
Figure n → Hình n, Table n → Bảng n. ALL-CAPS headings stay ALL-CAPS. No Markdown, no LaTeX, no line breaks.
Return ONLY JSON: {"t":[{"id":"b1","v":"..."}]} containing every id.`;

    const prompt = `${JSON.stringify(blocks.map(b => ({ id: b.id, text: b.text })))}`;

    const parse = (raw: string): Record<string, string> => {
      let txt = (raw || '').replace(/```json|```/gi, '').trim();
      const start = txt.indexOf('{');
      const end = txt.lastIndexOf('}');
      if (start >= 0 && end > start) txt = txt.slice(start, end + 1);
      const data = JSON.parse(txt);
      const arr: any[] = Array.isArray(data) ? data : (data.t || data.translations || []);
      const out: Record<string, string> = {};
      for (const item of arr) {
        const id = String(item?.id ?? '');
        const v = item?.v ?? item?.text ?? item?.translation;
        if (id && typeof v === 'string' && v.trim()) out[id] = cleanLatex(v).replace(/\*\*/g, '').replace(/\s*\n\s*/g, ' ').trim();
      }
      if (Object.keys(out).length === 0) throw new Error('Phản hồi dịch không có khối nào hợp lệ.');
      return out;
    };

    const MAX_RETRIES = 5;
    let retryCount = 0;
    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) throw new Error('Translation aborted');
      let ai: any, key: string;
      try {
        ({ ai, key } = await this.acquireKeyAndInstance());
      } catch {
        throw new Error('Không tìm thấy API Key khả dụng. Vui lòng kiểm tra lại Key trong Cài đặt.');
      }

      try {
        let raw = '';
        if (this.isCurrentKeyProxy(key)) {
          raw = await this.callOpenAINonStream(key, this.modelName, systemInstruction, prompt, '', signal);
        } else {
          const gm = this.mapModelForGoogle(this.modelName);
          const genModel = ai.getGenerativeModel({
            model: gm,
            systemInstruction,
            generationConfig: GeminiService.genConfig(gm, { temperature: 0.1, responseMimeType: 'application/json' }),
          });
          const result = await genModel.generateContent(prompt, signal ? ({ signal } as any) : undefined);
          raw = (await result.response).text() || '';
        }
        const parsed = parse(raw);
        GeminiService.lastSuccessfulKey = key;
        return parsed;
      } catch (error: any) {
        if (signal?.aborted) throw new Error('Translation aborted');
        if (GeminiService.handleThinkingError(this.mapModelForGoogle(this.modelName), error)) continue;
        const msg = String(error?.message || '').toLowerCase();
        // Lỗi phân quyền (Level) không nên thử lại
        if (msg.includes('level 2') || msg.includes('đăng nhập')) throw error;
        const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('401');
        if (retryCount < MAX_RETRIES && this.rotateKey(key, isQuota)) {
          retryCount++;
          const delay = Math.min(8000, Math.pow(1.5, retryCount) * 800 + Math.random() * 500);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        throw error;
      }
    }
    throw new Error('Quá số lần thử lại khi dịch khối chữ.');
  }
}


