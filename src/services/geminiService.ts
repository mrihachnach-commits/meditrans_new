import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { dlog } from '../utils/dlog';
import { TranslationService, TranslationOptions } from "./translationService";
import { cleanLatex } from "../utils/textFormatting";
import { auth } from "../firebase";
import { glossaryPrompt, glossaryCompact } from "./medicalGlossary";

/** Chờ có thể huỷ: bấm Dừng là thoát ngay, không phải đợi hết thời gian chờ thử lại (tới 8 giây). */
function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Translation aborted'));
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('Translation aborted')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Bộ điều tiết chung cho MỌI yêu cầu gửi qua proxy (ShopAIKey / key hệ thống /api/ai/chat):
 *  - Giới hạn số yêu cầu chạy cùng lúc (mặc định 2, chỉnh bằng localStorage "mediTrans_proxyMaxConcurrent")
 *    và giãn nhịp giữa các lần bắt đầu gửi — dịch nhiều trang/nhiều phần song song không dồn cục lên proxy.
 *  - Proxy báo quá tải (429, 5xx, "overload"…) → hạ xuống 1 yêu cầu/lần và TẠM DỪNG mọi yêu cầu theo Retry-After
 *    (hoặc lùi dần 4 → 8 → 16 → 30 giây), sau đó tăng dần trở lại khi gửi thành công liên tục.
 */
class ProxyGate {
  private active = 0;
  private waiters: (() => void)[] = [];
  private limit = 3;              // v8.4: bắt đầu 3 yêu cầu cùng lúc, tăng dần khi proxy trả lời tốt
  private pauseUntil = 0;
  private lastStart = 0;
  private okStreak = 0;
  private overloads = 0;
  /** Ngưỡng an toàn học được: số yêu cầu cùng lúc vừa gây quá tải − 1 (giữ 10 phút, không thử vượt lại). */
  private learnedCap = Infinity;
  private learnedUntil = 0;
  constructor(private readonly spacingMs = 150) {}
  /** Trần số yêu cầu cùng lúc (mặc định 6; chỉnh bằng localStorage "mediTrans_proxyMaxConcurrent", 1–10). */
  get max(): number {
    try {
      const v = parseInt((typeof window !== 'undefined' && localStorage.getItem('mediTrans_proxyMaxConcurrent')) || '', 10);
      if (v >= 1 && v <= 12) return v;
    } catch { /* ignore */ }
    return 8; // v8.4: mặc định 8 (gpt-4.1-mini trả lời nhanh, proxy chịu tốt); tự hạ khi bị 429
  }
  private get cap(): number {
    if (Date.now() > this.learnedUntil) this.learnedCap = Infinity;
    return Math.min(this.max, this.learnedCap);
  }
  get current(): number { return Math.min(this.limit, this.cap); }
  private wakeAll() { const w = this.waiters; this.waiters = []; w.forEach(f => f()); }
  async acquire(signal?: AbortSignal): Promise<void> {
    for (;;) {
      if (signal?.aborted) throw new Error('Translation aborted');
      const now = Date.now();
      const lim = this.current;
      const wait = Math.max(this.pauseUntil - now, this.active < lim ? this.lastStart + this.spacingMs - now : 0);
      if (this.active < lim && wait <= 0) {
        this.active++;
        this.lastStart = now;
        return;
      }
      if (this.active < lim || this.pauseUntil > now) {
        await sleepAbortable(Math.max(20, wait), signal);
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        const onAbort = () => { this.waiters = this.waiters.filter(f => f !== done); reject(new Error('Translation aborted')); };
        const done = () => { signal?.removeEventListener('abort', onAbort); resolve(); };
        this.waiters.push(done);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }
  release() {
    this.active = Math.max(0, this.active - 1);
    const w = this.waiters.shift();
    if (w) w();
  }
  /** Thành công liên tục → tăng dần số yêu cầu cùng lúc (tới trần). */
  onSuccess() {
    this.overloads = 0;
    if (++this.okStreak >= 3 && this.limit < this.cap) { this.limit++; this.okStreak = 0; this.wakeAll(); }
  }
  /** Quá tải → giảm một nửa số yêu cầu cùng lúc và tạm dừng theo Retry-After / lùi dần 3 → 6 → 12 → 24 giây. */
  /** Proxy lỗi tạm thời (5xx, rớt mạng) — không phải do gửi quá nhiều → chỉ dừng ngắn, không hạ ngưỡng. */
  onServerError() {
    this.okStreak = 0;
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + 800);
  }
  onOverload(retryAfterMs?: number) {
    this.okStreak = 0;
    // Quá tải khi đang chạy N yêu cầu → ngưỡng an toàn là N−1 (tối thiểu 1); không thử vượt lại trong 10 phút
    const atLoad = Math.max(1, this.active);
    this.learnedCap = Math.max(1, Math.min(this.learnedCap, atLoad - 1 || 1));
    this.learnedUntil = Date.now() + 10 * 60 * 1000;
    // Đã biết ngưỡng an toàn (N−1) → dùng luôn ngưỡng đó, không chia đôi rồi phải tăng lại từ từ
    this.limit = Math.max(1, this.learnedCap);
    const backoff = retryAfterMs && retryAfterMs > 0 ? Math.min(60000, retryAfterMs) : Math.min(16000, 1500 * 2 ** this.overloads);
    this.overloads++;
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + backoff);
    console.warn(`[MediTrans] Proxy quá tải → tạm dừng ${Math.round(backoff / 1000)} giây, giảm còn ${this.limit} yêu cầu/lần.`);
  }
}
const proxyGate = new ProxyGate();
/** Số yêu cầu tối đa gửi proxy cùng lúc (để các màn dịch hàng loạt đặt số luồng phù hợp). */
export function getProxyMaxConcurrent(): number { return proxyGate.max; }
/** Số yêu cầu proxy đang được phép chạy cùng lúc (tự điều chỉnh theo tình trạng proxy). */
export function getProxyCurrentConcurrent(): number { return proxyGate.current; }
/** Đặt trần số yêu cầu đồng thời qua proxy (Cài đặt). */
export function setProxyMaxConcurrent(n: number) {
  try { localStorage.setItem('mediTrans_proxyMaxConcurrent', String(Math.max(1, Math.min(12, Math.round(n))))); } catch { /* ignore */ }
}

/** Phản hồi proxy có phải do quá tải / giới hạn tốc độ không. */
function isOverloadStatus(status: number, text = ''): boolean {
  return status === 429 || status === 408 || (status >= 500 && status !== 501) ||
    /overload|rate.?limit|too many|quá tải|capacity|try again later/i.test(text);
}
/** Bị từ chối vì gửi quá nhiều / quá nhanh (khác lỗi máy chủ tạm thời). */
function isRateLimit(status: number, text = ''): boolean {
  return status === 429 || /rate.?limit|too many|overload|quá tải|capacity|concurren/i.test(text);
}
function retryAfterMs(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  const sec = Number(h);
  if (Number.isFinite(sec)) return sec * 1000;
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : undefined;
}

/**
 * Đọc phản hồi JSON của dịch khối chữ ({"t":[{"id","v"}]}) một cách chịu lỗi.
 * Lỗi "thỉnh thoảng" trước đây:
 *  - Xuống dòng thật bên trong chuỗi → JSON.parse hỏng → cả phần bị dịch lại (tốn token) hoặc mất khối.
 *  - Bản dịch chứa dấu " chưa thoát (vd. dấu hiệu "bánh vòng") → cách đọc dự phòng cũ CẮT CỤT bản dịch tại dấu "
 *    mà vẫn coi là thành công → chữ trên trang bị thiếu nửa câu.
 *  - Phản hồi bị cắt giữa chừng → mục cuối dở dang bị bỏ (để dịch bù), không lấy nửa câu.
 */
export function parseLayoutJson(raw: string): any[] {
  let txt = (raw || '').replace(/```json|```/gi, '').replace(/[\u0000-\u001F]+/g, ' ').trim();
  const start = txt.indexOf('{');
  const end = txt.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const body = txt.slice(start, end + 1);
    try {
      const data = JSON.parse(body);
      const arr = Array.isArray(data) ? data : (data?.t || data?.translations || data?.blocks);
      if (Array.isArray(arr)) return arr;
    } catch { /* đọc dự phòng bên dưới */ }
    txt = body;
  }
  const heads: { id: string; start: number; valStart: number }[] = [];
  const re = /\{\s*"id"\s*:\s*"([^"]+)"\s*,\s*"(?:v|text|translation)"\s*:\s*"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(txt))) heads.push({ id: m[1], start: m.index, valStart: re.lastIndex });
  const out: { id: string; v: string }[] = [];
  heads.forEach((h, i) => {
    const seg = txt.slice(h.valStart, i + 1 < heads.length ? heads[i + 1].start : txt.length);
    const close = seg.match(/"\s*\}\s*,?\s*(?:\]\s*\}?\s*)?$/);
    if (!close) return; // mục bị cắt giữa chừng → để dịch bù
    const v = seg.slice(0, close.index);
    let fixed = '';
    for (let k = 0; k < v.length; k++) {
      const ch = v[k];
      if (ch === '\\') { fixed += ch + (v[k + 1] ?? ''); k++; }
      else if (ch === '"') fixed += '\\"';
      else fixed += ch;
    }
    let val: string;
    try { val = JSON.parse(`"${fixed}"`); } catch { val = v.replace(/\\"/g, '"'); }
    out.push({ id: h.id, v: val });
  });
  if (!out.length) throw new Error('Phản hồi dịch không phải JSON hợp lệ.');
  return out;
}

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
  /** Proxy không nhận response_format {type:"json_object"} → không gửi nữa. */
  private static jsonModeUnsupported = false;

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
    // Proxy không có model → đã ghi nhớ, gọi lại ngay với model kế tiếp (không chờ, không đổi key)
    if (msg.startsWith('proxy_model_unavailable')) return true;
    if (msg.includes('reasoning') && !msg.includes('proxy error') && !GeminiService.reasoningUnsupported) {
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

  /**
   * Thời gian chờ trước khi thử lại. Proxy báo 429: bộ điều tiết chung đã tạm dừng đúng mức → chỉ chờ ngắn
   * (trước đây chờ thêm 1–8 giây nữa → chờ hai lần, chậm gấp đôi khi proxy yếu).
   */
  private static retryDelay(error: any, normal: number): number {
    return /proxy error \(429\)/i.test(String(error?.message || '')) ? 150 : normal;
  }

  /**
   * Mức "suy nghĩ" đã thương lượng được với proxy cho từng model (null = proxy không nhận tham số này).
   * Gemini 3 KHÔNG tắt được suy nghĩ; nếu bỏ trống tham số, model suy nghĩ ở mức MẶC ĐỊNH (cao) → tốn rất nhiều
   * token đầu ra và chậm. Vì vậy khi proxy từ chối một giá trị, thử giá trị thấp kế tiếp chứ không bỏ trống.
   */
  private static reasoningChoice = new Map<string, string | null>();

  /** Proxy từ chối reasoning_effort → chọn mức thấp nhất còn lại. Trả về true nếu đã đổi (gọi lại ngay). */
  private static negotiateReasoning(model: string, tried: string | undefined, errText: string): boolean {
    if (!tried || !/reasoning/i.test(errText)) return false;
    const listed = (errText.match(/valid values are:?\s*([a-z ,|]+)/i)?.[1] || '').toLowerCase().split(/[\s,|]+/).filter(Boolean);
    const order = tried === 'none' ? ['none', 'minimal', 'low'] : ['minimal', 'none', 'low'];
    const pos = order.indexOf(tried);
    const next = order.slice(pos + 1).find(v => !listed.length || listed.includes(v))
      ?? (listed.includes('low') && tried !== 'low' ? 'low' : null);
    GeminiService.reasoningChoice.set(model, next);
    console.warn(`[MediTrans] Proxy không nhận reasoning_effort="${tried}" cho ${model} → ${next ? `dùng "${next}"` : 'bỏ tham số'}.`);
    return true;
  }

  /** v10.4: model OpenAI có "suy nghĩ" (gpt-5.x, gpt-6.x, o-series) — không nhận temperature, dùng max_completion_tokens. */
  public static isOpenAIReasoningModel(model: string): boolean {
    return /^(gpt-5|gpt-6|o\d)/i.test((model || '').trim());
  }
  /** v10.4: chỉnh body gửi proxy cho model OpenAI có suy nghĩ (bỏ temperature, max_tokens → max_completion_tokens). */
  private static adaptOpenAIBody(body: any): any {
    if (!GeminiService.isOpenAIReasoningModel(body.model)) return body;
    delete body.temperature;
    if (body.max_tokens != null) { body.max_completion_tokens = body.max_tokens; delete body.max_tokens; }
    return body;
  }

  /** reasoning_effort cho proxy kiểu OpenAI (model Gemini có thinking + model OpenAI có suy nghĩ). */
  private static reasoningFor(model: string): string | undefined {
    const chosen = GeminiService.reasoningChoice.get(model);
    if (chosen !== undefined) return chosen ?? undefined;
    if (GeminiService.reasoningUnsupported) return undefined;
    const m = (model || '').toLowerCase();
    // v10.4: TẮT suy nghĩ cho gpt-6.x / gpt-5.1+ ("none"); gpt-5 / gpt-5-mini đời đầu chỉ có "minimal".
    // Proxy từ chối → negotiateReasoning tự lùi none → low.
    if (/^gpt-6/.test(m) || /^gpt-5\.\d/.test(m)) return 'none';
    if (/^gpt-5/.test(m)) return 'minimal';
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
    
    dlog(`[MediTrans] GeminiService: ${this.apiKeys.length} keys loaded. Model: ${this.modelName}`);
  }

  /** Loại key theo kho key của người dùng (nhãn "Google Gemini" / "ShopAIKey" lúc thêm key). */
  private static keyTypes = new Map<string, 'proxy' | 'google'>();
  /** Ghi nhận loại key từ kho key (gọi mỗi khi danh sách key thay đổi) → mọi nơi nhận diện key thống nhất. */
  public static registerKeyTypes(list: { value?: string; isProxy: boolean }[]) {
    for (const k of list) {
      const v = (k.value || '').trim();
      if (v) GeminiService.keyTypes.set(v, k.isProxy ? 'proxy' : 'google');
    }
  }

  public static isProxyKey(key: string, engineOrModel?: string): boolean {
    if (!key) return false;
    const clean = key.trim();
    if (clean === 'system_proxy') return true;
    // Key Google (AIzaSy…) LUÔN gọi thẳng Google, kể cả khi lỡ gắn nhãn ShopAIKey
    if (clean.startsWith('AIzaSy')) return false;
    // v8.5: web chỉ dùng ShopAIKey → mọi key không phải AIzaSy… đều gọi qua ShopAIKey (không phụ thuộc tiền tố sk-)
    return true;
  }

  /** Câu báo lỗi 403 từ máy chủ key hệ thống (đọc lý do trong JSON trả về). */
  private static systemProxyError(errText: string): string {
    let msg = '';
    try { msg = String(JSON.parse(errText)?.error || ''); } catch { msg = errText || ''; }
    msg = msg.trim();
    if (!msg) return "Tài khoản của bạn chưa đủ Level 2 hoặc đã hết hạn.";
    return msg.slice(0, 200);
  }

  /** Phân loại lỗi ShopAIKey: key sai/bị khoá, hết lượt/bận, model không có, hay lỗi khác. */
  public static classifyProxyError(msg: string): { kind: 'key' | 'quota' | 'model' | 'level' | 'other'; text: string } {
    const m = String(msg || '');
    const code = Number((m.match(/\((\d{3})\)/) || [])[1] || 0);
    if (/Level 2|bị khóa|đăng nhập/i.test(m)) return { kind: 'level', text: m.slice(0, 200) };
    if (/Token xác thực|Thiếu token/i.test(m)) return { kind: 'level', text: 'Phiên đăng nhập đã hết hạn — hãy đăng xuất rồi đăng nhập lại.' };
    if (/chưa có API Key khả dụng/i.test(m)) { try { window.dispatchEvent(new Event('meditrans:system-pool-changed')); } catch { /* */ } }
    if (/chưa có API Key khả dụng/i.test(m)) return { kind: 'other', text: 'Kho key hệ thống chưa có key ShopAIKey nào đang bật (Quản trị viên cần thêm/bật key).' };
    if (/bị ShopAIKey từ chối/i.test(m)) return { kind: 'other', text: 'Tất cả key trong kho key hệ thống bị ShopAIKey từ chối (sai key / hết số dư) — Quản trị viên cần kiểm tra.' };
    if (/Firebase Admin|Service Account/i.test(m)) return { kind: 'other', text: 'Máy chủ chưa cấu hình Firebase Admin — key hệ thống chưa chạy được.' };
    if (code === 401 || code === 403 || /invalid.{0,20}(api.?key|token)|incorrect api key|unauthori[sz]ed|api key.{0,20}(invalid|disabled|expired)/i.test(m))
      return { kind: 'key', text: `Key sai, đã bị khoá hoặc hết hạn trên ShopAIKey (${code || 'từ chối'}).` };
    if (code === 402 || /insufficient|quota|balance|credit|số dư/i.test(m))
      return { kind: 'quota', text: 'Key hợp lệ nhưng đã hết số dư / hạn mức trên ShopAIKey.' };
    if (code === 429 || code >= 500 || /bận|quá tải|overload|rate.?limit/i.test(m))
      return { kind: 'quota', text: 'Key hợp lệ nhưng ShopAIKey đang bận / hết lượt tạm thời. Thử lại sau ít phút.' };
    if (code === 404 || /model.{0,40}(not.?found|not exist|unavailable|không có)|PROXY_MODEL_UNAVAILABLE/i.test(m))
      return { kind: 'model', text: `Key hợp lệ nhưng model dịch không dùng được với key này (${m.slice(0, 120)}).` };
    if (/Failed to fetch|NetworkError|network/i.test(m)) return { kind: 'other', text: 'Không kết nối được ShopAIKey (lỗi mạng hoặc sai Base URL).' };
    return { kind: 'other', text: m.slice(0, 200) || 'Lỗi không xác định' };
  }

  /**
   * Model qua proxy trả lời nhanh và KHÔNG có phần "suy nghĩ" (vd. gpt-4.1-mini) → chia nhỏ & chạy nhiều luồng hơn
   * gần như không tốn thêm token (chỉ lặp lại hướng dẫn hệ thống ngắn), thời gian chờ giảm rõ.
   */
  public isFastProxyModel(engine?: string): boolean {
    if (!this.usesProxy()) return false;
    const m = this.mapModelForOpenAI(engine || this.modelName);
    const r = GeminiService.reasoningFor(m);
    return !r || r === 'none'; // v10.4: gpt-6-luna tắt suy nghĩ = model nhanh
  }
  /** Cách chia trang dịch thường thành các phần chạy song song. */
  public parallelPlan(engine?: string): { minChars: number; maxParts: number; targetChars: number } {
    return this.isFastProxyModel(engine)
      ? { minChars: 2200, maxParts: 4, targetChars: 1600 }
      : { minChars: 5000, maxParts: 2, targetChars: 3500 };
  }
  /** Cách chia khối chữ (giữ định dạng) thành các phần gửi song song trong một trang. */
  public layoutChunkPlan(): { chars: number; blocks: number; parallel: number } {
    return this.isFastProxyModel(GeminiService.LAYOUT_MODEL)
      ? { chars: 2000, blocks: 25, parallel: 4 }
      : { chars: 3500, blocks: 40, parallel: 3 };
  }

  /** Có key nào đi qua proxy (ShopAIKey / key hệ thống) không → dịch hàng loạt phải giới hạn số luồng. */
  public usesProxy(): boolean {
    return this.apiKeys.some(k => this.isCurrentKeyProxy(k));
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
    const validKeys = this.apiKeys.filter(k => !this.exhaustedKeys.has(k) && !this.isKeyDead(k));
    
    // If all keys are marked exhausted, use any key to avoid starving (trừ key đã bị Google từ chối hẳn)
    const notDead = this.apiKeys.filter(k => !this.isKeyDead(k));
    const candidateKeys = validKeys.length > 0 ? validKeys : (notDead.length ? notDead : this.apiKeys);

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
      // Ghi đúng model THỰC SỰ được gửi (trước đây in tên engine lưu trong máy, vd. "gemini-flash-lite-latest", gây hiểu nhầm)
      dlog(`[MediTrans] Using key: ...${key.substring(key.length - 4)} (${isProxy ? 'ShopAIKey/Proxy' : 'Google Gemini'}) — engine "${this.modelName}" → model ${isProxy ? this.mapModelForOpenAI(this.modelName) : this.googleModel(key)}`);
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
        dlog(`[MediTrans] Key ...${exhaustedKey.slice(-4)} recovered.`);
      }, waitTime);
    }
    
    return true;
  }

  /* ---------------- ShopAIKey / proxy: chọn model ---------------- */

  /**
   * v8.0 — model cho ShopAIKey / key hệ thống, chọn theo CHỨC NĂNG (không theo tên engine cũ lưu trong máy):
   *  - Dịch thường + dịch giữ định dạng: gpt-4.1-mini
   *  - OCR (đọc ảnh trang scan / chữ trong hình / nhận diện cột): gemini-3.1-flash-lite
   * Ô "Model Proxy" trong Cài đặt: ô Dịch thường ghi đè cho dịch thường, ô Chuyên sâu ghi đè cho chuyên sâu.
   * Dịch giữ định dạng và OCR luôn cố định (JSON / toạ độ khung ổn định, không bị cài đặt cũ làm hỏng).
   */
  
  public static readonly PROXY_NORMAL_MODEL = 'gpt-4.1-mini';
  // v10.4: gpt-6-luna (tắt suy nghĩ) là lựa chọn trong Cài đặt; thử thật chậm hơn gpt-4.1-mini 2–3 lần → mặc định giữ như cũ.
  public static readonly PROXY_DEEP_MODEL = 'gemini-3.1-flash-lite';
  public static readonly PROXY_OCR_MODEL = 'gemini-3.1-flash-lite';
  /** Model chọn được cho dịch giữ định dạng / OCR (phải nằm trong danh sách cho phép của api/ai/chat.ts). */
  public static readonly PROXY_MODEL_CHOICES = ['gpt-4.1-mini', 'gpt-6-luna', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gpt-4o-mini', 'gpt-4.1'];
  public static currentOcrModel(): string {
    const v = (typeof window !== 'undefined' ? localStorage.getItem('mediTrans_proxyModelOcr') : null)?.trim() || '';
    return GeminiService.PROXY_MODEL_CHOICES.includes(v) ? v : GeminiService.PROXY_OCR_MODEL;
  }
  /** Mã chức năng nội bộ (truyền thay cho tên model). */
  private static readonly LAYOUT_MODEL = '__layout_fixed__';
  private static readonly OCR_MODEL = '__ocr_fixed__';
  /** Engine "Chuyên sâu" (nút Dịch chuyên sâu / Chế độ dịch = Chuyên sâu). */
  public static isDeepEngine(engine?: string): boolean {
    return (engine || '').trim() === 'gemini-3.6-flash';
  }

  private mapModelForOpenAI(modelName: string): string {
    const ls = (k: string) => (typeof window !== 'undefined' ? localStorage.getItem(k) : null)?.trim() || '';
    // v10.4: dịch giữ định dạng / OCR giữ định dạng có ô chọn model riêng trong Cài đặt (chỉ các model được phép)
    const pick = (k: string, def: string) => { const v = ls(k); return GeminiService.PROXY_MODEL_CHOICES.includes(v) ? v : def; };
    if (modelName === GeminiService.LAYOUT_MODEL) return pick('mediTrans_proxyModelLayout', GeminiService.PROXY_NORMAL_MODEL);
    if (modelName === GeminiService.OCR_MODEL) return pick('mediTrans_proxyModelOcr', GeminiService.PROXY_OCR_MODEL);
    if (GeminiService.isDeepEngine(modelName)) return ls('mediTrans_customOpenAIModelDeep') || GeminiService.PROXY_DEEP_MODEL;
    return ls('mediTrans_customOpenAIModelNormal') || ls('mediTrans_customOpenAIModel') || GeminiService.PROXY_NORMAL_MODEL;
  }

  /** Model cố định → không tự đổi model khi proxy báo lỗi model (lỗi được báo thẳng cho người dùng). */
  private static noteProxyModelError(_model: string, _status: number, _text: string): boolean {
    return false;
  }

  /**
   * Tên model gửi cho Google. Trước đây MỌI lựa chọn đều bị đổi thành "gemini-3.6-flash" → key Google không có
   * quyền dùng model này (403 PERMISSION_DENIED) thì hỏng hết, kể cả khi người dùng chọn Flash-Lite.
   * Nay giữ đúng model đã chọn; model không dùng được với key thì tự chuyển sang model dự phòng (xem googleModel()).
   */
  public mapModelForGoogle(modelName?: string): string {
    const clean = (modelName || '').toLowerCase().trim();
    if (!clean || clean === 'gemini' || clean === 'shopaikey' || clean === 'openai' || clean === 'gemini-flash') {
      return 'gemini-2.5-flash-lite';
    }
    if (clean.startsWith('gemini-') || clean.startsWith('models/gemini-')) return clean.replace(/^models\//, '');
    return 'gemini-2.5-flash-lite';
  }

  /* ---------------- Key Google: chọn model theo từng key, tự chuyển model khi bị từ chối ---------------- */

  /** Model dự phòng khi model đã chọn không dùng được với key (403/404): ổn định, có ở gói miễn phí. */
  private static readonly GOOGLE_FALLBACK_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest', 'gemini-flash-lite-latest'];
  /** key|model đã chọn → model thực sự dùng được với key đó (ghi nhớ trong phiên và localStorage). */
  private static googleModelOverride: Map<string, string> = (() => {
    const m = new Map<string, string>();
    try {
      const raw = typeof window !== 'undefined' ? localStorage.getItem('mediTrans_googleModelOverride') : null;
      if (raw) Object.entries(JSON.parse(raw) as Record<string, string>).forEach(([k, v]) => m.set(k, v));
    } catch { /* ignore */ }
    return m;
  })();
  private static googleModelDenied = new Map<string, Set<string>>();
  /** Key bị Google từ chối hẳn (key sai / hết hiệu lực / mọi model đều bị từ chối) → bỏ qua lâu. */
  private static deadKeys = new Map<string, number>();

  private static overrideKey(key: string, base: string) { return `${key.slice(-12)}|${base}`; }

  private static saveOverrides() {
    try {
      const obj: Record<string, string> = {};
      GeminiService.googleModelOverride.forEach((v, k) => { obj[k] = v; });
      if (typeof window !== 'undefined') localStorage.setItem('mediTrans_googleModelOverride', JSON.stringify(obj));
    } catch { /* ignore */ }
  }

  /** Model sẽ dùng cho key Google này (model đã chọn, hoặc model dự phòng đã xác nhận dùng được). */
  public googleModel(key: string, requested?: string): string {
    const base = this.mapModelForGoogle(requested || this.modelName);
    return GeminiService.googleModelOverride.get(GeminiService.overrideKey(key, base)) ?? base;
  }

  /** Phân loại lỗi Google: model không dùng được / key hỏng / hết hạn mức / khác. */
  public static classifyGoogleError(error: any): 'model' | 'key' | 'quota' | 'other' {
    const msg = String(error?.message || error || '').toLowerCase();
    if (/api_key_invalid|api key not valid|api key expired|key expired|reported as leaked|api_key_service_blocked|consumer_suspended|billing/.test(msg)) return 'key';
    if (/429|quota|resource_exhausted|rate limit/.test(msg)) return 'quota';
    if (/\b404\b|not found|is not supported|not supported for|unsupported model|not available|permission_denied|\b403\b|denied access|does not have access|no access/.test(msg)) return 'model';
    return 'other';
  }

  /**
   * Lỗi do model không dùng được với key → chuyển sang model dự phòng kế tiếp, trả về true để gọi lại ngay.
   * Hết model dự phòng → false (để xử lý như key hỏng).
   */
  private handleGoogleModelError(key: string, requested: string | undefined, error: any): boolean {
    if (GeminiService.classifyGoogleError(error) !== 'model') return false;
    const base = this.mapModelForGoogle(requested || this.modelName);
    const cur = this.googleModel(key, requested);
    const denied = GeminiService.googleModelDenied.get(key) || new Set<string>();
    denied.add(cur);
    GeminiService.googleModelDenied.set(key, denied);
    const next = [base, ...GeminiService.GOOGLE_FALLBACK_MODELS].find(m => !denied.has(m));
    if (!next) return false;
    GeminiService.googleModelOverride.set(GeminiService.overrideKey(key, base), next);
    GeminiService.saveOverrides();
    console.warn(`[MediTrans] Key ...${key.slice(-4)} không dùng được model ${cur} → chuyển sang ${next}.`);
    return true;
  }

  /**
   * Key Google bị từ chối hẳn (key sai/hết hiệu lực, hoặc mọi model đều bị từ chối): bỏ qua 10 phút.
   * Không còn key nào khác → báo lỗi rõ ràng ngay (trước đây thử lại 6 lần vô ích rồi mới báo lỗi khó hiểu).
   */
  private failGoogleKey(key: string, error: any): void {
    GeminiService.deadKeys.set(key, Date.now() + 10 * 60 * 1000);
    const alive = this.apiKeys.filter(k => !this.isKeyDead(k));
    if (alive.length === 0) {
      const raw = String(error?.message || error || '');
      const code = GeminiService.shortGoogleError(raw);
      throw new Error(`Key Google ...${key.slice(-4)} bị Google từ chối (${code}). Hãy kiểm tra: key còn hiệu lực, dự án của key đã bật "Generative Language API", hoặc dùng key khác / ShopAIKey.`);
    }
    console.warn(`[MediTrans] Key ...${key.slice(-4)} bị Google từ chối → tạm bỏ qua 10 phút, dùng key khác.`);
  }

  private isKeyDead(key: string): boolean {
    const until = GeminiService.deadKeys.get(key);
    if (!until) return false;
    if (Date.now() > until) { GeminiService.deadKeys.delete(key); return false; }
    return true;
  }

  /**
   * Xử lý chung lỗi của lệnh gọi Google: trả về 'retry' (gọi lại ngay, không tính lượt), hoặc 'continue'
   * (đã xử lý key hỏng, chuyển key khác), hoặc 'default' (để vòng thử lại xử lý như cũ: hạn mức, mạng…).
   */
  private onGoogleError(key: string, requested: string | undefined, error: any): 'retry' | 'continue' | 'default' {
    if (this.handleGoogleModelError(key, requested, error)) return 'retry';
    const kind = GeminiService.classifyGoogleError(error);
    if (kind === 'key' || kind === 'model') { this.failGoogleKey(key, error); return 'continue'; }
    return 'default';
  }

  /** Gọi Google một lần với tự chuyển model khi bị từ chối (dùng cho các lệnh không có vòng thử lại riêng). */
  private async withGoogleModel<T>(key: string, requested: string | undefined, fn: (model: string) => Promise<T>): Promise<T> {
    for (let i = 0; i < 6; i++) {
      const model = this.googleModel(key, requested);
      try {
        return await fn(model);
      } catch (e) {
        if (GeminiService.handleThinkingError(model, e)) continue;
        if (this.handleGoogleModelError(key, requested, e)) continue;
        const kind = GeminiService.classifyGoogleError(e);
        if (kind === 'key' || kind === 'model') this.failGoogleKey(key, e);
        throw e;
      }
    }
    throw new Error('Không tìm được model Gemini dùng được với key này.');
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
    GeminiService.adaptOpenAIBody(body);

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

    dlog(`[MediTrans] Calling Stream (${requestUrl}) using model: ${mappedModel}`);

    await proxyGate.acquire(signal);
    try {
    let response: Response;
    try {
      response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": authHeaderValue
        },
        body: JSON.stringify(body),
        signal
      });
    } catch (e) {
      if (!signal?.aborted) proxyGate.onServerError(); // lỗi mạng / proxy cắt kết nối
      throw e;
    }

    if (!response.ok) {
      const errText = await response.text();
      // Kho key hệ thống trống / đã bị tắt → báo giao diện cập nhật trạng thái "[Hệ thống] ShopAIKey"
      if (response.status === 503 && key.trim() === 'system_proxy') { try { window.dispatchEvent(new Event('meditrans:system-pool-changed')); } catch { /* */ } }
      if (response.status === 403 && key.trim() === 'system_proxy') {
        throw new Error(GeminiService.systemProxyError(errText));
      }
      if (response.status === 400 && GeminiService.negotiateReasoning(mappedModel, body.reasoning_effort, errText)) throw new Error(`PROXY_MODEL_UNAVAILABLE (400): đổi mức suy nghĩ`);
        if (GeminiService.noteProxyModelError(mappedModel, response.status, errText)) throw new Error(`PROXY_MODEL_UNAVAILABLE (${response.status}): ${errText.slice(0, 200)}`);
      if (isRateLimit(response.status, errText)) proxyGate.onOverload(retryAfterMs(response));
        else if (isOverloadStatus(response.status, errText)) proxyGate.onServerError();
      throw new Error(`ShopAIKey/Proxy Error (${response.status}): ${errText}`);
    }
    proxyGate.onSuccess();

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
    } finally {
      proxyGate.release();
    }
  }

  private async callOpenAINonStream(
    key: string,
    model: string,
    systemInstruction: string,
    prompt: string,
    imageBase64: string,
    signal?: AbortSignal,
    maxTokens = 8192,
    /** Yêu cầu proxy trả JSON hợp lệ (response_format json_object) — giảm lỗi JSON hỏng ở dịch giữ định dạng. */
    jsonMode = false
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
    GeminiService.adaptOpenAIBody(body);
    if (jsonMode && !GeminiService.jsonModeUnsupported) body.response_format = { type: 'json_object' };

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

    dlog(`[MediTrans] Calling Non-Stream (${requestUrl}) using model: ${mappedModel}`);

    await proxyGate.acquire(signal);
    let data: any;
    try {
      let response: Response;
      try {
        response = await fetch(requestUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": authHeaderValue
          },
          body: JSON.stringify(body),
          signal
        });
      } catch (e) {
        if (!signal?.aborted) proxyGate.onServerError(); // lỗi mạng / proxy cắt kết nối
        throw e;
      }

      if (!response.ok) {
        const errText = await response.text();
        // Kho key hệ thống trống / đã bị tắt → báo giao diện cập nhật trạng thái "[Hệ thống] ShopAIKey"
        if (response.status === 503 && key.trim() === 'system_proxy') { try { window.dispatchEvent(new Event('meditrans:system-pool-changed')); } catch { /* */ } }
        if (response.status === 403 && key.trim() === 'system_proxy') {
          // Báo đúng lý do máy chủ trả về (chưa đủ Level / bị khoá / key ShopAIKey bị từ chối) thay vì luôn báo "chưa đủ Level"
          throw new Error(GeminiService.systemProxyError(errText));
        }
        if (response.status === 400 && GeminiService.negotiateReasoning(mappedModel, body.reasoning_effort, errText)) throw new Error(`PROXY_MODEL_UNAVAILABLE (400): đổi mức suy nghĩ`);
        // Proxy không nhận response_format → ghi nhớ, gửi lại ngay không kèm tham số này (chỉ mất 1 yêu cầu mỗi phiên)
        if (response.status === 400 && body.response_format && !/api.?key|unauthor|invalid.*key/i.test(errText)) {
          GeminiService.jsonModeUnsupported = true;
          console.warn('[MediTrans] Proxy không nhận response_format → bỏ tham số này.');
          throw new Error('PROXY_MODEL_UNAVAILABLE (400): bỏ response_format');
        }
        if (GeminiService.noteProxyModelError(mappedModel, response.status, errText)) throw new Error(`PROXY_MODEL_UNAVAILABLE (${response.status}): ${errText.slice(0, 200)}`);
        if (isRateLimit(response.status, errText)) proxyGate.onOverload(retryAfterMs(response));
        else if (isOverloadStatus(response.status, errText)) proxyGate.onServerError();
        throw new Error(`ShopAIKey/Proxy Error (${response.status}): ${errText}`);
      }
      data = await response.json();
      proxyGate.onSuccess();
      const u = data?.usage;
      if (u) console.log(`[MediTrans] Token (${mappedModel}): vào ${u.prompt_tokens ?? '?'}, ra ${u.completion_tokens ?? '?'}${u.completion_tokens_details?.reasoning_tokens ? ` (trong đó suy nghĩ ${u.completion_tokens_details.reasoning_tokens})` : ''}.`);
    } finally {
      proxyGate.release();
    }
    return data.choices?.[0]?.message?.content || "";
  }

  /**
   * Thử một key Google lần lượt với model đã chọn rồi các model dự phòng. Ghi nhớ model dùng được cho key
   * (để dịch thật dùng đúng model đó). Trả về loại kết quả để phân biệt key hỏng với key chỉ tạm hết lượt.
   */
  private async probeGoogleKey(cleanKey: string, prompt: string): Promise<{ ok: boolean; model?: string; text?: string; kind?: string; error?: string }> {
    const ai = new GoogleGenerativeAI(cleanKey);
    const base = this.mapModelForGoogle(this.modelName);
    const candidates = Array.from(new Set([base, ...GeminiService.GOOGLE_FALLBACK_MODELS]));
    let lastErr: any = null;
    let sawQuota = false;
    for (const model of candidates) {
      try {
        const genModel = ai.getGenerativeModel({ model, generationConfig: GeminiService.genConfig(model, { temperature: 0, maxOutputTokens: 256 }) });
        const res = await genModel.generateContent(prompt);
        const text = (await res.response).text()?.trim();
        const ok = GeminiService.overrideKey(cleanKey, base);
        if (model !== base) GeminiService.googleModelOverride.set(ok, model); else GeminiService.googleModelOverride.delete(ok);
        GeminiService.saveOverrides();
        GeminiService.deadKeys.delete(cleanKey);
        GeminiService.googleModelDenied.delete(cleanKey);
        return { ok: true, model, text };
      } catch (e: any) {
        lastErr = e;
        if (GeminiService.handleThinkingError(model, e)) {
          try { // thử lại ngay một lần không kèm tham số thinking
            const genModel = ai.getGenerativeModel({ model, generationConfig: { temperature: 0, maxOutputTokens: 256 } });
            const text = (await (await genModel.generateContent(prompt)).response).text()?.trim();
            return { ok: true, model, text };
          } catch (e2) { lastErr = e2; }
        }
        const kind = GeminiService.classifyGoogleError(lastErr);
        if (kind === 'quota') { sawQuota = true; continue; } // model này hết lượt → thử model khác
        if (kind === 'model') continue;
        return { ok: false, kind, error: String(lastErr?.message || lastErr) };
      }
    }
    return { ok: false, kind: sawQuota ? 'quota' : GeminiService.classifyGoogleError(lastErr), error: String(lastErr?.message || lastErr || '') };
  }

  /** "[GoogleGenerativeAI Error]: … [403 Forbidden] Permission denied…" → "403 Forbidden: Permission denied…" */
  private static shortGoogleError(raw: string): string {
    const m = raw.match(/\[(\d{3})\s*([^\]]*)\]\s*([^\[]{0,140})/);
    if (!m) return raw.slice(0, 140);
    return `${m[1]}${m[2] ? ' ' + m[2].trim() : ''}${m[3].trim() ? ': ' + m[3].trim() : ''}`;
  }

  /** Lỗi key → câu tiếng Việt dễ hiểu. */
  private static friendlyKeyError(kind: string | undefined, raw: string): string {
    const code = GeminiService.shortGoogleError(raw);
    if (kind === 'key') return `Key không hợp lệ hoặc đã bị khoá (${code}).`;
    if (kind === 'quota') return `Key hợp lệ nhưng đang hết lượt / hết hạn mức (429). Thử lại sau ít phút.`;
    if (kind === 'model') return `Key bị Google từ chối với mọi model (${code}). Kiểm tra dự án của key đã bật "Generative Language API" và key không bị giới hạn (API restrictions / HTTP referrer).`;
    return raw.slice(0, 200) || 'Lỗi không xác định';
  }

  /**
   * Dịch thử bằng một key. type: loại key theo kho key ('proxy' = ShopAIKey/OpenAI, 'google' = Gemini API);
   * bỏ trống thì đoán theo tiền tố key.
   */
  public async testSingleKeyTranslation(key: string, sampleText: string = "Hello world! Testing translation AI.", _type?: 'proxy' | 'google'): Promise<{ success: boolean; resultText?: string; error?: string; latencyMs?: number; model?: string; errorKind?: string }> {
    if (!key || !key.trim()) return { success: false, error: "API Key trống" };
    const cleanKey = key.trim();
    if (cleanKey.startsWith('AIzaSy')) {
      return { success: false, error: 'Đây là key Google Gemini — web chỉ còn dùng key ShopAIKey. Hãy xoá key này và thêm key ShopAIKey.', errorKind: 'key' };
    }
    const isSystem = cleanKey === 'system_proxy' || cleanKey.startsWith('system_');
    const startTime = Date.now();
    const prompt = `Dịch câu sau sang tiếng Việt ngắn gọn: "${sampleText}"`;
    const systemInstruction = "Bạn là dịch giả y khoa. Dịch chính xác và ngắn gọn.";
    // v8.5: dịch thử THẬT qua ShopAIKey (kể cả key hệ thống — trước đây key hệ thống luôn báo "sẵn sàng" mà không thử)
    const k = isSystem ? 'system_proxy' : cleanKey;
    const model = this.mapModelForOpenAI(this.modelName);
    let lastMsg = '';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await this.callOpenAINonStream(k, this.modelName, systemInstruction, prompt, "", undefined, 256);
        if (!text || !text.trim()) { lastMsg = 'ShopAIKey trả về nội dung trống'; continue; }
        GeminiService.lastSuccessfulKey = k;
        return { success: true, resultText: text.trim(), latencyMs: Date.now() - startTime, model: this.mapModelForOpenAI(this.modelName) };
      } catch (err: any) {
        lastMsg = String(err?.message || '');
        // Lần đầu có thể chỉ là dò mức "suy nghĩ"/tham số của model → gửi lại ngay
        if (/PROXY_MODEL_UNAVAILABLE \(400\)/.test(lastMsg) && attempt < 2) continue;
        break;
      }
    }
    const c = GeminiService.classifyProxyError(lastMsg);
    return { success: false, error: c.text, errorKind: c.kind, latencyMs: Date.now() - startTime, model };
  }

  /**
   * Kiểm tra key còn dùng được không (để đánh dấu "error" trong kho key).
   * Chỉ key bị ShopAIKey từ chối (401/403) mới là hỏng; hết lượt (429) / máy chủ bận (5xx) / lỗi mạng vẫn coi là tốt.
   */
  public async testSingleKey(key: string): Promise<boolean> {
    if (!key || !key.trim()) return false;
    const cleanKey = key.trim();
    if (cleanKey.startsWith('AIzaSy')) return false; // key Google không còn dùng
    if (cleanKey === 'system_proxy' || cleanKey.startsWith('system_')) return true;
    try {
      const response = await fetch(this.getProxyBaseUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cleanKey}` },
        body: JSON.stringify(GeminiService.adaptOpenAIBody({
          model: this.mapModelForOpenAI(this.modelName),
          messages: [{ role: 'user', content: 'hi' }],
          max_tokens: 16
        }))
      });
      return !(response.status === 401 || response.status === 403);
    } catch (e) {
      return true; // lỗi mạng: không kết luận key hỏng
    }
  }

  /** Key vừa dịch thành công gần nhất (để giao diện hiển thị "key đang hoạt động"). */
  public static getLastSuccessfulKey(): string | null { return GeminiService.lastSuccessfulKey; }

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
    
    dlog(`[MediTrans] Starting stream translation for page: ${pageNumber} using model: ${requestModel}`);
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
      // Đã hiển thị một phần bản dịch → KHÔNG thử lại từ đầu (trước đây thử lại thì nội dung bị lặp 2 lần trên màn hình
      // và tốn gấp đôi token); báo lỗi để người dùng bấm dịch lại.
      let streamed = false;

      // Handle ShopAIKey / OpenAI Proxy Key
      if (isProxy) {
        try {
          let fullText = "";
          for await (const chunkText of this.callOpenAIStream(key, requestModel, systemInstruction, prompt, imageBuffer, signal)) {
            if (signal?.aborted) break;
            fullText += chunkText;
            streamed = true;
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
          
          dlog(`[MediTrans] Translation for page: ${pageNumber} finished via ShopAIKey/Proxy in ${((Date.now() - totalStartTime) / 1000).toFixed(2)}s`);
          return;
        } catch (error: any) {
          if (signal?.aborted || error.message === "Translation aborted") {
            throw new Error("Translation aborted");
          }
          if (streamed) throw error;
          if (GeminiService.handleThinkingError(this.mapModelForGoogle(requestModel), error)) continue;
          const isQuota = error.message?.includes("429") || error.message?.toLowerCase().includes("quota") || error.message?.includes("401");
          const isServerErr = error.message?.includes("500") || error.message?.includes("502") || error.message?.includes("503") || error.message?.includes("504") || error.message?.toLowerCase().includes("fetch");
          
          if (retryCount < MAX_RETRIES && this.rotateKey(key, isQuota)) {
            retryCount++;
            const delay = Math.min(8000, Math.pow(1.5, retryCount) * 800 + Math.random() * 500);
            console.warn(`[MediTrans] Retrying page ${pageNumber} (attempt ${retryCount}/${MAX_RETRIES}) after ${delay.toFixed(0)}ms...`);
            await sleepAbortable(GeminiService.retryDelay(error, delay), signal);
            continue;
          }
          throw error;
        }
      }

      // Handle Standard Google Gemini Key (AIzaSy...)
      try {
        const fetchStartTime = Date.now();
        const googleModel = this.googleModel(key, requestModel);
        const genModel = ai.getGenerativeModel({ 
          model: googleModel,
          systemInstruction: systemInstruction,
          generationConfig: GeminiService.genConfig(googleModel, { temperature: 0, maxOutputTokens: 8192 })
        });

        const response = await genModel.generateContentStream([
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: imageBuffer.split(",")[1] || imageBuffer,
            },
          },
          prompt,
        ], signal ? ({ signal } as any) : undefined);

        dlog(`[MediTrans] API request sent. Model: ${requestModel}. Wait time for stream start...`);
        let fullText = "";
        let chunkCount = 0;
        for await (const chunk of response.stream) {
          if (signal?.aborted) {
            dlog("[MediTrans] Stream aborted by signal");
            break; 
          }
          if (chunkCount === 0) {
            dlog(`[MediTrans] Stream started after ${Date.now() - fetchStartTime}ms`);
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
            streamed = true;
            yield chunkText;
          }
        }

        GeminiService.lastSuccessfulKey = key;
        if (!fullText) {
          throw new Error("Model returned no text.");
        }
        
        dlog(`[MediTrans] Translation for page: ${pageNumber} finished in ${((Date.now() - totalStartTime) / 1000).toFixed(2)}s`);
        break;

      } catch (error: any) {
        if (signal?.aborted || error.message === "Translation aborted") {
          throw new Error("Translation aborted");
        }
        if (streamed) throw error;
        if (GeminiService.handleThinkingError(this.googleModel(key, requestModel), error)) continue;
        {
          const ge = this.onGoogleError(key, requestModel, error);
          if (ge === 'retry') continue;
          if (ge === 'continue') { retryCount++; continue; }
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
          if (canRotate && this.apiKeys.length > 1) {
            await sleepAbortable(200 + Math.random() * 300, signal);
            continue;
          }
          const delay = Math.pow(1.5, retryCount) * 1000 + Math.random() * 500;
          await sleepAbortable(delay, signal);
          continue;
        }
        throw error;
      }
    }
  }

  async translateMedicalPage(options: TranslationOptions): Promise<string> {
    const { imageBuffer, pageNumber, signal, model } = options;
    const requestModel = model || this.modelName;
    
    dlog(`[MediTrans] Starting non-stream translation for page: ${pageNumber} using model: ${requestModel}`);
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
            await sleepAbortable(GeminiService.retryDelay(error, delay), signal);
            continue;
          }
          throw error;
        }
      }

      try {
        const googleModel = this.googleModel(key, requestModel);
        const genModel = ai.getGenerativeModel({ 
          model: googleModel,
          systemInstruction: systemInstruction,
          generationConfig: GeminiService.genConfig(googleModel, { temperature: 0, maxOutputTokens: 8192 })
        });

        const result = await genModel.generateContent([
          { inlineData: { mimeType: "image/jpeg", data: imageBuffer.split(",")[1] || imageBuffer } },
          prompt
        ], signal ? ({ signal } as any) : undefined);

        const response = await result.response;
        let text = response.text() || "";
        const resultText = text.replace(/(\s*\.\s*){4,}/g, ' ... ');
        dlog(`[MediTrans] Translation for page: ${pageNumber} finished in ${((Date.now() - totalStartTime) / 1000).toFixed(2)}s`);
        return resultText;
      } catch (error: any) {
        if (signal?.aborted) throw new Error("Translation aborted");
        
        if (GeminiService.handleThinkingError(this.googleModel(key, requestModel), error)) continue;
        {
          const ge = this.onGoogleError(key, requestModel, error);
          if (ge === 'retry') continue;
          if (ge === 'continue') { retryCount++; continue; }
        }
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
          await sleepAbortable(delay, signal);
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

    return this.withGoogleModel(key, this.modelName, async (googleModel) => {
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
    });
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
      return await this.callOpenAINonStream(key, GeminiService.OCR_MODEL, systemInstruction, prompt, imageBuffer, undefined);
    }

    return this.withGoogleModel(key, this.modelName, async (googleModel) => {
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
    });
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

    // Mở luồng qua withGoogleModel (tự chuyển model nếu bị từ chối) rồi mới đọc từng phần
    const response = await this.withGoogleModel(key, this.modelName, async (googleModel) => {
      const genModel = ai.getGenerativeModel({ 
        model: googleModel,
        systemInstruction: systemInstruction,
        generationConfig: GeminiService.genConfig(googleModel, { temperature: 0.2 })
      });
      return genModel.generateContentStream(prompt, signal ? ({ signal } as any) : undefined);
    });
    for await (const chunk of response.stream) {
      if (signal?.aborted) throw new Error("Aborted");
      if (chunk.text()) yield chunk.text();
    }
  }
  /**
   * Dịch thường theo lớp chữ: nhận Markdown đã dựng sẵn từ lớp chữ PDF (cấu trúc chuẩn), chỉ dịch chữ.
   * Không gửi ảnh → nhanh hơn, ít token hơn, không lỗi đọc nhầm chữ.
   */
  async *translateMarkdownPageStream(markdown: string, pageNumber: number, signal?: AbortSignal, model?: string): AsyncGenerator<string> {
    const requestModel = model || this.modelName;
    let systemInstruction = `You are an expert English→Vietnamese medical translator. The user sends one page of a medical document as Markdown extracted from the PDF text layer; its structure is already correct.
Rules:
1. Translate ALL text into accurate, natural Vietnamese medical language. Keep only abbreviations, drug/gene names, numbers and units as written. "Figure n" → "Hình n", "Table n" → "Bảng n".
2. Keep the Markdown EXACTLY: same headings (#), list markers and indentation, **bold**/*italic* markers, line breaks, blank lines and order. Do not merge, split, add or drop lines. ALL-CAPS headings stay ALL-CAPS.
3. Output only the translated Markdown — no preamble, notes or code fences. Symbols as plain Unicode, never LaTeX.`;
    const prompt = markdown;
    systemInstruction += glossaryPrompt(markdown); // v9.4: thuật ngữ bắt buộc (chỉ những từ có trong trang)
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
          const gm = this.googleModel(key, requestModel);
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
        if (!this.isCurrentKeyProxy(key)) {
          if (GeminiService.handleThinkingError(this.googleModel(key, requestModel), error)) continue;
          const ge = this.onGoogleError(key, requestModel, error);
          if (ge === 'retry') continue;
          if (ge === 'continue') { retryCount++; continue; }
        } else if (GeminiService.handleThinkingError(this.mapModelForGoogle(requestModel), error)) continue;
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('level 2') || msg.includes('đăng nhập')) throw error;
        const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('401');
        if (retryCount < MAX_RETRIES && this.rotateKey(key, isQuota)) {
          retryCount++;
          await sleepAbortable(GeminiService.retryDelay(error, Math.min(8000, Math.pow(1.5, retryCount) * 800 + Math.random() * 500)), signal);
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
  async ocrLayoutBlocks(imageDataUrl: string, signal?: AbortSignal, opts: { mode?: 'full' | 'extra'; regions?: number[][]; retryEmpty?: boolean } = {}): Promise<any[]> {
    const extra = opts.mode === 'extra';
    // v10.4: model GPT không quen định dạng box_2d của Gemini → nhắc rõ thứ tự (y trước x) và thang 0–1000
    const gptBoxHint = /^(gpt|o\d)/i.test(GeminiService.currentOcrModel())
      ? `
COORDINATES: box_2d is [ymin, xmin, ymax, xmax] — the VERTICAL position (y, from the top edge) comes FIRST, then the horizontal position (x, from the left edge). Use a 0-1000 scale for both axes (0 = top/left edge, 1000 = bottom/right edge), NOT pixels. Measure each box carefully against the page: a block in the right column has xmin > 500; a footer near the bottom has ymin > 900.`
      : '';
    const scope = extra
      ? `This page already has a normal text layer. Return ONLY: (1) text that is part of the IMAGES/photos/scans/diagrams inside these regions (box_2d [ymin,xmin,ymax,xmax] 0-1000): ${JSON.stringify(opts.regions || [])} — e.g. labels, annotations, measurements, words burned into ultrasound/X-ray/CT images, legends inside figures. Return EVERY label of a diagram/drawing (hand-written labels included), each label as its own block with a tight box around only that label's letters (never merge neighbouring labels, never a box covering arrows or the drawing); text written diagonally/slanted: give \"dir\":\"diag\". And (2) any text rotated 90° (vertical text) anywhere on the page. Do NOT return the normal horizontal page text (paragraphs, headings, captions outside the images). If there is no such text, return {"blocks":[]}.`
      : `Detect EVERY text block on the page image: titles, headings, paragraphs, each list item (separately), figure/table captions, each table cell (separately), labels and text inside images/figures, vertical (rotated) text, running headers, footers, page numbers. Treat each text column separately. Do NOT merge blocks from different columns. Pages that are mostly images (X-ray, mammogram, ultrasound, photos) STILL have text: figure captions ("Figure 1 – …"), side tabs with vertical words, running headers/footers, page numbers — return all of them.${opts.retryEmpty ? ' IMPORTANT: a previous attempt wrongly returned no blocks for this page. Look carefully at the whole image, especially the small caption lines below each picture, the vertical tab on the left/right edge and the footer; return every readable text block.' : ''}`;
    const systemInstruction = `You are an OCR engine and an English→Vietnamese medical translator for book/journal pages (often scanned).
${scope}
For each block return:
- "box_2d": [ymin, xmin, ymax, xmax] integers 0-1000 (relative to image height/width) tightly enclosing the block's text
- "text": the exact original text (join lines with single spaces, remove end-of-line hyphenation). Table-of-contents entries: one block per entry, keep the leader dots as " ....... " followed by the page number (e.g. "V. GUIDANCE ....... 788")
- "v": natural, accurate Vietnamese medical translation of "text" (for table-of-contents entries end with " ....... " and the same page number) (keep numbers, units, symbols, drug/gene names, abbreviations, person names, journal names, URLs, DOIs unchanged; Figure n → Hình n, Table n → Bảng n; ALL-CAPS stays ALL-CAPS, but when only SOME words are capitalized for emphasis uppercase only their Vietnamese translation ("OVAL mass" → "Khối BẦU DỤC"); join words hyphenated at line ends ("Guid-ance" → "Guidance"); reference-list entries and page numbers: return unchanged; no Markdown, no line breaks)
- "lines": number of text lines of the block on the image
- "bold", "italic": true if most of the block is bold / italic
- "bold_lead": true if ONLY the leading label of the block is bold (e.g. "Figure 1" / "Table 2" at the start of a caption)
- "serif": true ONLY if the letters clearly have serifs (Times New Roman-like); modern sans fonts (Arial, Helvetica, Inter, Roboto, Calibri) → false. Use the same value for all blocks that share the same font
- "align": "left" | "center" | "right" | "justify"
- "dir": "up" if the text is rotated and reads bottom-to-top, "down" if it reads top-to-bottom; omit for normal horizontal text. For rotated text, "lines" counts the lines across the block.
Return ONLY JSON: {"blocks":[...]} in reading order (column by column, top to bottom).
Boxes must enclose the text itself: a caption below a picture gets the box of the caption lines, never a box on the picture. Grey/blank rectangles are hidden pictures: ignore them.${gptBoxHint}${extra ? '' : glossaryCompact()}`;
    const prompt = extra
      ? 'Return only text inside the given image regions and rotated text, with boxes and Vietnamese translations. JSON only.'
      : 'OCR this page into text blocks with boxes and Vietnamese translations. JSON only.';
    // v8.5: đọc JSON OCR chịu lỗi — bỏ ```json, chấp nhận tên trường khác (bbox/box, t/original, vi/translation),
    // toạ độ 0–1, JSON bị cắt cụt giữa chừng (lấy các khối còn nguyên). Trang không có chữ → [] (không còn là lỗi).
    const pickObjects = (txt: string): any[] => {
      const objs: any[] = [];
      let depth = 0, start = -1, inStr = false, esc = false;
      for (let k = 0; k < txt.length; k++) {
        const ch = txt[k];
        if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
        if (ch === '"') { inStr = true; continue; }
        if (ch === '{') { depth++; if (depth === 2) start = k; }
        else if (ch === '}') {
          if (depth === 2 && start >= 0) { try { objs.push(JSON.parse(txt.slice(start, k + 1))); } catch { /* bỏ khối hỏng */ } start = -1; }
          depth = Math.max(0, depth - 1);
        }
      }
      return objs;
    };
    const parse = (raw: string): any[] => {
      let txt = (raw || '').replace(/```(?:json)?/gi, '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ').trim();
      let arr: any[] | null = null;
      const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
      const a2 = txt.indexOf('[');
      try {
        let body = txt;
        if (a2 >= 0 && (a < 0 || a2 < a)) body = txt.slice(a2, txt.lastIndexOf(']') + 1);
        else if (a >= 0 && b > a) body = txt.slice(a, b + 1);
        const d = JSON.parse(body);
        arr = Array.isArray(d) ? d : (d.blocks || d.t || d.items || d.result || null);
        // v9.5: AI đặt tên mảng khác ("text_blocks", "data", "page": {"blocks": …}) → trước đây thành [] = "trang không có chữ"
        if (!Array.isArray(arr) && d && typeof d === 'object') {
          const findArr = (o: any, depth: number): any[] | null => {
            for (const v of Object.values(o)) {
              if (Array.isArray(v) && v.some(x => x && typeof x === 'object')) return v;
            }
            if (depth > 0) for (const v of Object.values(o)) if (v && typeof v === 'object' && !Array.isArray(v)) { const r = findArr(v, depth - 1); if (r) return r; }
            return null;
          };
          arr = findArr(d, 2) || (d.text && (d.box_2d || d.bbox || d.box) ? [d] : []);
        }
      } catch {
        // JSON hỏng / bị cắt cụt → nhặt từng khối {...} còn nguyên
        const wrapped = a2 >= 0 && (a < 0 || a2 < a) ? '{"x":' + txt.slice(a2) : txt.slice(Math.max(0, a));
        arr = pickObjects(wrapped);
        if (!arr.length && !/"blocks"\s*:\s*\[\s*\]/.test(txt)) throw new Error('OCR trả về dữ liệu không đọc được (JSON lỗi).');
      }
      const num4 = (o: any): number[] | null => {
        let bx = o.box_2d ?? o.box ?? o.bbox ?? o.box2d ?? o.bounding_box ?? o.bbox_2d ?? o.coordinates ?? o.position;
        if (typeof bx === 'string') bx = (bx.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
        if (bx && !Array.isArray(bx) && typeof bx === 'object') bx = [bx.ymin ?? bx.y0 ?? bx.top, bx.xmin ?? bx.x0 ?? bx.left, bx.ymax ?? bx.y1 ?? bx.bottom, bx.xmax ?? bx.x1 ?? bx.right];
        if (!Array.isArray(bx) || bx.length < 4) return null;
        let n = bx.slice(0, 4).map(Number);
        if (n.some(x => !Number.isFinite(x))) return null;
        if (n.every(x => x >= 0 && x <= 1.0001)) n = n.map(x => Math.round(x * 1000)); // toạ độ 0–1
        return n;
      };
      const strOf = (...vals: any[]) => { for (const v of vals) if (typeof v === 'string' && v.trim()) return v; return ''; };
      return (arr || [])
        .map(o => {
          if (!o || typeof o !== 'object') return null;
          const box = num4(o);
          const text = strOf(o.text, o.original, o.source, o.src, o.en, o.content, o.caption, o.label);
          if (!box || !text.trim()) return null;
          if (o.dir === 'diag') return null; // v9.8: chữ viết chéo → giữ bản gốc (vẽ ngang sẽ đè lên hình)
          const vRaw = strOf(o.v, o.vi, o.translation, o.translated, o.vietnamese, o.vietnamese_translation, o.text_vi, o.vi_text);
          return {
            box_2d: box,
            text: String(text),
            v: vRaw ? cleanLatex(vRaw).replace(/\*\*/g, '').replace(/\s*\n\s*/g, ' ').trim() : undefined,
            lines: Number(o.lines) || undefined,
            bold: !!o.bold, italic: !!o.italic, serif: o.serif === true || o.serif === 'true', bold_lead: !!o.bold_lead,
            align: typeof o.align === 'string' ? o.align : undefined,
            dir: o.dir === 'up' || o.dir === 'down' ? o.dir : undefined,
          };
        })
        .filter(Boolean) as any[];
    };

    const MAX_RETRIES = 4;
    let parseFails = 0;
    for (let retry = 0; retry <= MAX_RETRIES + 2; retry++) {
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
          raw = await this.callOpenAINonStream(key, GeminiService.OCR_MODEL, systemInstruction, prompt, imageDataUrl, signal, 16384, !GeminiService.jsonModeUnsupported);
        } else {
          const gm = this.googleModel(key, this.modelName);
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
        let parsed: any[];
        try {
          parsed = parse(raw);
        } catch (pe) {
          // AI trả JSON hỏng (thường do bị cắt cụt) → thử lại cùng key tối đa 2 lần trước khi bỏ cuộc
          if (parseFails++ < 2) { console.warn('[MediTrans] OCR trả JSON lỗi, thử lại…', String(raw).slice(0, 200)); continue; }
          throw pe;
        }
        GeminiService.lastSuccessfulKey = key;
        return parsed;
      } catch (error: any) {
        if (signal?.aborted) throw new Error('Translation aborted');
        if (/JSON lỗi/.test(String(error?.message))) throw error;
        if (!this.isCurrentKeyProxy(key)) {
          if (GeminiService.handleThinkingError(this.googleModel(key, this.modelName), error)) continue;
          const ge = this.onGoogleError(key, this.modelName, error);
          if (ge === 'retry' || ge === 'continue') continue;
        } else if (GeminiService.handleThinkingError(this.mapModelForGoogle(this.modelName), error)) continue;
        const msg = String(error?.message || '').toLowerCase();
        if (msg.includes('level 2') || msg.includes('đăng nhập')) throw error;
        const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('401');
        if (retry < MAX_RETRIES && this.rotateKey(key, isQuota)) {
          await sleepAbortable(GeminiService.retryDelay(error, Math.min(8000, Math.pow(1.5, retry + 1) * 800)), signal);
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
          raw = await this.callOpenAINonStream(key, GeminiService.OCR_MODEL, systemInstruction, prompt, imageDataUrl, signal);
        } else {
          const gm = this.googleModel(key, this.modelName);
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
        if (!this.isCurrentKeyProxy(key)) {
          if (GeminiService.handleThinkingError(this.googleModel(key, this.modelName), error)) continue;
          const ge = this.onGoogleError(key, this.modelName, error);
          if (ge === 'retry' || ge === 'continue') continue;
        } else if (GeminiService.handleThinkingError(this.mapModelForGoogle(this.modelName), error)) continue;
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

    let systemInstruction = `English→Vietnamese medical translator. Input: JSON text blocks extracted from one PDF page (reading order). A sentence may continue from one block into the next: translate each block's own words in its own "v" — never move, merge or repeat text across blocks. Translate each block into natural, accurate Vietnamese medical language, consistent across blocks; it will be redrawn in the same box, so keep it concise and add nothing.
Keep unchanged: numbers, units, symbols (± ≤ ≥ × µ °), drug/gene names, abbreviations, superscripts (¹²³), person names, journal names, names of organizations / departments / trials / study groups (e.g. Eastern Cooperative Oncology Group, Department of Motor Vehicles, Canadian National Breast Screening Study), URLs, DOIs, emails. Reference-list entries: return unchanged, but ALWAYS translate section headings (References → Tài liệu tham khảo, Conclusions → Kết luận).
Some blocks mark differently-styled words (bold/colored) with numbered tags <n>…</n>: put the same tag pair ONLY around the Vietnamese words that translate exactly the words inside that tag in the source — never around any other word, even if it is the same term elsewhere in the block (e.g. "the <1>bicuspid</1> valve" → "van <1>hai lá</1>"; colored figure numbers / citations: "(Figs. <1>3.2</1>, <1>3.3</1>) [<1>3</1>]" → "(Hình <1>3.2</1>, <1>3.3</1>) [<1>3</1>]"); keep EVERY tag exactly as many times as in the source, add no new ones; a block without tags gets no tags. Translate EVERY English word, including words outside the tags and in titles (e.g. "Atlas of <1>Full Breast Ultrasonography</1>" → "<1>Atlas Siêu âm Toàn bộ Vú</1>" or "Atlas <1>Siêu âm Toàn bộ Vú</1>"); only person names, journal names and the items listed above stay unchanged.
Figure n → Hình n, Table n → Bảng n. ALL-CAPS headings stay ALL-CAPS. When only SOME words are capitalized for emphasis, uppercase only the Vietnamese words that translate them ("OVAL mass" → "Khối BẦU DỤC", "LOBULATED mass" → "Khối DẠNG THÙY"), never the whole phrase. No Markdown, no LaTeX, no line breaks; inside "v" use “ ” instead of straight double quotes.
Return ONLY JSON: {"t":[{"id":"b1","v":"..."}]} containing every id.`;

    const prompt = `${JSON.stringify(blocks.map(b => ({ id: b.id, text: b.text })))}`;
    systemInstruction += glossaryPrompt(blocks.map(b => b.text).join('\n')); // v9.4: thuật ngữ bắt buộc

    const parse = (raw: string): Record<string, string> => {
      const arr = parseLayoutJson(raw);
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
          raw = await this.callOpenAINonStream(key, GeminiService.LAYOUT_MODEL, systemInstruction, prompt, '', signal, 8192, true);
        } else {
          const gm = this.googleModel(key, this.modelName);
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
        if (!this.isCurrentKeyProxy(key)) {
          if (GeminiService.handleThinkingError(this.googleModel(key, this.modelName), error)) continue;
          const ge = this.onGoogleError(key, this.modelName, error);
          if (ge === 'retry' || ge === 'continue') continue;
        } else if (GeminiService.handleThinkingError(this.mapModelForGoogle(this.modelName), error)) continue;
        const msg = String(error?.message || '').toLowerCase();
        // Lỗi phân quyền (Level) không nên thử lại
        if (msg.includes('level 2') || msg.includes('đăng nhập')) throw error;
        const isQuota = msg.includes('429') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('401');
        if (retryCount < MAX_RETRIES && this.rotateKey(key, isQuota)) {
          retryCount++;
          const delay = Math.min(8000, Math.pow(1.5, retryCount) * 800 + Math.random() * 500);
          await sleepAbortable(GeminiService.retryDelay(error, delay), signal);
          continue;
        }
        throw error;
      }
    }
    throw new Error('Quá số lần thử lại khi dịch khối chữ.');
  }
}


