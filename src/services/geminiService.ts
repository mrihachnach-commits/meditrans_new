import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { dlog } from '../utils/dlog';
import { TranslationService, TranslationOptions } from "./translationService";
import { cleanLatex } from "../utils/textFormatting";
import { auth } from "../firebase";
import { glossaryPrompt, glossaryCompact, VI_MEDICAL_STYLE, VI_MEDICAL_STYLE_SHORT } from "./medicalGlossary";
import { recordAiCall, pageOfSignal } from "./aiTelemetry";

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
 * v10.6 — Bộ điều tiết chung cho MỌI yêu cầu gửi qua proxy (ShopAIKey / key hệ thống /api/ai/chat), kiểu AIMD:
 *  - Trần = giới hạn đồng thời server báo trong header "X-AI-Concurrency-Limit" (key hệ thống), không có thì 6.
 *    Ô "Số yêu cầu đồng thời" trong Cài đặt chỉ được hạ trần này, không vượt quá server.
 *  - Bắt đầu 3, tăng 1 sau mỗi 3 lần trả lời tốt (tăng nhanh khi chưa từng bị 429).
 *  - Bị 429 thật (hết lượt / quá nhiều yêu cầu): giảm còn ~70% MỘT LẦN cho cả đợt — các yêu cầu đã gửi trước lúc giảm
 *    mà nhận 429 không bị phạt thêm (v10.5 trừ dần 5 → 4 → 3 → 2 cho cùng một đợt nghẽn). Mức mới giữ 2,5 phút,
 *    sau đó thử tăng lại từng nấc, mỗi nấc cách nhau ≥ 20 giây trả lời tốt.
 *  - Lỗi 5xx / rớt mạng / server bận ghi sổ (reason "busy"): chỉ tạm dừng ngắn, KHÔNG hạ mức.
 *  - Độ trễ tăng mạnh (thời gian trả lời / token ra > 1,8 lần mức tốt nhất gần đây) → đứng yên, không tăng tiếp.
 */
class ProxyGate {
  private active = 0;
  private waiters: (() => void)[] = [];
  private limit = 3;
  private pauseUntil = 0;
  private lastStart = 0;
  private okStreak = 0;
  private overloads = 0;
  /** Mỗi lần hạ mức → epoch tăng; yêu cầu mang epoch cũ nhận 429 là cùng đợt nghẽn, không hạ thêm. */
  private epoch = 0;
  /** Mức đã hạ giữ trong một khoảng ngắn. */
  private holdCap = Infinity;
  private holdUntil = 0;
  /** Sau một lần 429: thời điểm còn phải tăng chậm (mỗi nấc cách nhau 20 giây). */
  private slowRampUntil = 0;
  private lastRaise = 0;
  /** Giới hạn đồng thời server báo (0 = chưa biết). */
  private serverMax = 0;
  /** Độ trễ (ms / token ra): mức tốt nhất (trôi chậm lên) và trung bình gần đây. */
  private latBest = 0;
  private latRecent = 0;
  constructor(private readonly spacingMs = 150) {}
  /** Ô trong Cài đặt (1–12), không đặt thì 0. */
  private get userMax(): number {
    try {
      const v = parseInt((typeof window !== 'undefined' && localStorage.getItem('mediTrans_proxyMaxConcurrent')) || '', 10);
      if (v >= 1 && v <= 12) return v;
    } catch { /* ignore */ }
    return 0;
  }
  /** Trần số yêu cầu cùng lúc: key hệ thống = min(Cài đặt, server báo); key riêng = Cài đặt; mặc định 6. */
  get max(): number {
    const user = this.userMax;
    if (this.serverMax) return user ? Math.min(user, this.serverMax) : this.serverMax; // key hệ thống: không vượt server
    return user || 6; // key ShopAIKey riêng: theo Cài đặt, mặc định 6
  }
  private get cap(): number {
    if (Date.now() > this.holdUntil) this.holdCap = Infinity;
    return Math.min(this.max, this.holdCap);
  }
  get current(): number { return Math.max(1, Math.min(this.limit, this.cap)); }
  private wakeAll() { const w = this.waiters; this.waiters = []; w.forEach(f => f()); }
  /** Xin một chỗ gửi; trả về epoch lúc gửi (đưa lại cho onOverload). */
  async acquire(signal?: AbortSignal): Promise<number> {
    for (;;) {
      if (signal?.aborted) throw new Error('Translation aborted');
      const now = Date.now();
      const lim = this.current;
      const wait = Math.max(this.pauseUntil - now, this.active < lim ? this.lastStart + this.spacingMs - now : 0);
      if (this.active < lim && wait <= 0) {
        this.active++;
        this.lastStart = now;
        return this.epoch;
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
  /** Đọc header giới hạn của server (key hệ thống). */
  noteHeaders(res: Response) {
    const v = parseInt(res.headers.get('x-ai-concurrency-limit') || '', 10);
    if (v >= 1 && v <= 50 && v !== this.serverMax) { this.serverMax = v; this.wakeAll(); }
  }
  /** Trả lời tốt → cập nhật độ trễ, tăng dần số yêu cầu cùng lúc (tới trần). */
  onSuccess(ms = 0, outTokens = 0) {
    this.overloads = 0;
    if (ms > 0 && outTokens >= 20) {
      const per = ms / outTokens;
      this.latRecent = this.latRecent ? this.latRecent * 0.7 + per * 0.3 : per;
      // mức tốt nhất trôi lên chậm (đổi model / trang dài hơn) để không kẹt mãi
      this.latBest = !this.latBest || per < this.latBest ? per : this.latBest * 1.01;
    }
    const slow = this.latBest > 0 && this.latRecent > 1.8 * this.latBest;
    const now = Date.now();
    const gap = now < this.slowRampUntil ? 20_000 : 0;
    if (++this.okStreak >= 3 && this.limit < this.cap && !slow && now - this.lastRaise >= gap) {
      this.limit++; this.okStreak = 0; this.lastRaise = now; this.wakeAll();
    }
  }
  /** Proxy lỗi tạm thời (5xx, rớt mạng, server bận ghi sổ) — không phải do gửi quá nhiều → chỉ dừng ngắn, không hạ mức. */
  onServerError(pauseMs = 800) {
    this.okStreak = 0;
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + pauseMs);
  }
  /** 429 thật → giảm còn ~70% một lần cho cả đợt và tạm dừng theo Retry-After / lùi dần. */
  onOverload(sentEpoch: number, retryAfterMs?: number) {
    this.okStreak = 0;
    const backoff = retryAfterMs && retryAfterMs > 0 ? Math.min(60000, retryAfterMs) : Math.min(16000, 1500 * 2 ** this.overloads);
    this.pauseUntil = Math.max(this.pauseUntil, Date.now() + backoff);
    if (sentEpoch < this.epoch) return; // cùng đợt nghẽn đã hạ rồi
    this.overloads++;
    this.epoch++;
    const now = Date.now();
    const level = Math.max(this.current, Math.min(this.active, this.cap));
    this.limit = Math.max(1, Math.floor(level * 0.7));
    this.holdCap = this.limit;
    this.holdUntil = now + 150_000;
    this.slowRampUntil = now + 10 * 60_000;
    this.lastRaise = now;
    console.warn(`[MediTrans] Proxy quá tải → tạm dừng ${Math.round(backoff / 1000)} giây, giảm còn ${this.limit} yêu cầu/lần (giữ 2,5 phút rồi tăng dần lại).`);
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
  // v10.6: chỉ 429 hoặc lỗi 4xx ghi rõ giới hạn tốc độ; 5xx (kể cả "overloaded") là lỗi tạm thời, không hạ mức
  return status === 429 || (status >= 400 && status < 500 && /rate.?limit|too many|concurren/i.test(text));
}
/** v10.6: phản ứng của bộ điều tiết với một phản hồi lỗi. */
function gateOnHttpError(sentEpoch: number, res: Response, errText: string) {
  let reason = '';
  try { reason = String(JSON.parse(errText)?.reason || ''); } catch { /* */ }
  if (res.status === 429 && reason === 'busy') proxyGate.onServerError(1000); // server bận ghi sổ, không phải quá tải
  else if (res.status === 429 && reason === 'daily') { /* hết hạn mức ngày — báo lỗi, không đổi mức */ }
  else if (isRateLimit(res.status, errText)) proxyGate.onOverload(sentEpoch, retryAfterMs(res));
  else if (isOverloadStatus(res.status, errText)) proxyGate.onServerError();
}
/** Loại lượt gọi cho bộ đếm. */
function callKind(model: string): string {
  return model === '__layout_fixed__' ? 'giu-dinh-dang' : model === '__ocr_fixed__' ? 'ocr' : 'dich-thuong';
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
    // v10.6: xếp theo TÊN model (đã đo), không theo tham số suy nghĩ: gpt-5.x / gpt-6 / o-series dù tắt suy nghĩ
    // vẫn chậm hơn gpt-4.1-mini 2–3 lần → chia phần to hơn, ít luồng hơn.
    if (/^(gpt-5|gpt-6|o\d)/i.test(m)) return false;
    const r = GeminiService.reasoningFor(m);
    return !r || r === 'none';
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
  /** v10.8: model mặc định của dịch giữ định dạng (người dùng nhập được model khác trong Cài đặt). */
  public static readonly PROXY_LAYOUT_MODEL = 'gpt-4.1-nano';
  public static readonly PROXY_MODEL_CHOICES = ['gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-6-luna', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gpt-4o-mini', 'gpt-4.1'];
  public static currentOcrModel(): string {
    const v = (typeof window !== 'undefined' ? localStorage.getItem('mediTrans_proxyModelOcr') : null)?.trim() || '';
    return /^[\w.\-:/]{2,80}$/.test(v) ? v : GeminiService.PROXY_OCR_MODEL; // v11.1: tự nhập tên model
  }
  /** v11.2: model OCR dự phòng — dùng khi model OCR đang chọn lỗi / trả rỗng / đặt sai khung trên một trang
   *  (gemini-2.5-flash-lite bỏ sót ~6% trang BI-RADS: trang chữ dày, mục lục, biểu mẫu). */
  public static ocrFallbackModel(): string {
    const cur = GeminiService.currentOcrModel().toLowerCase();
    return cur === GeminiService.PROXY_OCR_MODEL ? 'gemini-3.5-flash-lite' : GeminiService.PROXY_OCR_MODEL;
  }
  private static readonly OCR_AS = '__ocr_as__:';
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
    // v10.8: dịch giữ định dạng: người dùng tự nhập tên model (mặc định gpt-4.1-nano)
    if (modelName === GeminiService.LAYOUT_MODEL) { const v = ls('mediTrans_proxyModelLayout'); return /^[\w.\-:/]{2,80}$/.test(v) ? v : GeminiService.PROXY_LAYOUT_MODEL; }
    if (modelName === GeminiService.OCR_MODEL) return GeminiService.currentOcrModel(); // v11.1: tự nhập tên model
    if (modelName.startsWith(GeminiService.OCR_AS)) return modelName.slice(GeminiService.OCR_AS.length); // v11.2: model OCR dự phòng
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

    const sentEpoch = await proxyGate.acquire(signal);
    const t0 = Date.now();
    const rec = (status: number | string, extra: Partial<{ tin: number; tout: number; treason: number; finish: string }> = {}) =>
      recordAiCall({ t: t0, page: pageOfSignal(signal), kind: callKind(model), model: mappedModel, status, ms: Date.now() - t0, ...extra });
    let streamOk = false, sFinish = '', sUsage: any = null;
    const note = (parsed: any) => {
      const f = parsed?.choices?.[0]?.finish_reason;
      if (f) sFinish = String(f);
      if (parsed?.usage) sUsage = parsed.usage;
    };
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
      if (!signal?.aborted) { proxyGate.onServerError(); rec('mang'); } // lỗi mạng / proxy cắt kết nối
      throw e;
    }
    proxyGate.noteHeaders(response);

    if (!response.ok) {
      const errText = await response.text();
      rec(response.status);
      // Kho key hệ thống trống / đã bị tắt → báo giao diện cập nhật trạng thái "[Hệ thống] ShopAIKey"
      if (response.status === 503 && key.trim() === 'system_proxy') { try { window.dispatchEvent(new Event('meditrans:system-pool-changed')); } catch { /* */ } }
      if (response.status === 403 && key.trim() === 'system_proxy') {
        throw new Error(GeminiService.systemProxyError(errText));
      }
      if (response.status === 400 && GeminiService.negotiateReasoning(mappedModel, body.reasoning_effort, errText)) throw new Error(`PROXY_MODEL_UNAVAILABLE (400): đổi mức suy nghĩ`);
        if (GeminiService.noteProxyModelError(mappedModel, response.status, errText)) throw new Error(`PROXY_MODEL_UNAVAILABLE (${response.status}): ${errText.slice(0, 200)}`);
      gateOnHttpError(sentEpoch, response, errText);
      throw new Error(`ShopAIKey/Proxy Error (${response.status}): ${errText}`);
    }
    streamOk = true;

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
            note(parsed);
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
      if (streamOk) {
        const u = sUsage;
        proxyGate.onSuccess(Date.now() - t0, Number(u?.completion_tokens) || 0);
        rec(200, { tin: Number(u?.prompt_tokens) || 0, tout: Number(u?.completion_tokens) || 0, treason: Number(u?.completion_tokens_details?.reasoning_tokens) || 0, finish: sFinish });
      }
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
    jsonMode = false,
    /** v10.6: nhận lại lý do dừng của model (finish_reason; "length" = bị cắt cụt vì hết max_tokens). */
    meta?: { finish?: string }
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

    const sentEpoch = await proxyGate.acquire(signal);
    const t0 = Date.now();
    const rec = (status: number | string, extra: Partial<{ tin: number; tout: number; treason: number; finish: string }> = {}) =>
      recordAiCall({ t: t0, page: pageOfSignal(signal), kind: callKind(model), model: mappedModel, status, ms: Date.now() - t0, ...extra });
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
        if (!signal?.aborted) { proxyGate.onServerError(); rec('mang'); } // lỗi mạng / proxy cắt kết nối
        throw e;
      }
      proxyGate.noteHeaders(response);

      if (!response.ok) {
        const errText = await response.text();
        rec(response.status);
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
        gateOnHttpError(sentEpoch, response, errText);
        throw new Error(`ShopAIKey/Proxy Error (${response.status}): ${errText}`);
      }
      data = await response.json();
      const u = data?.usage;
      const finish = String(data?.choices?.[0]?.finish_reason || '');
      proxyGate.onSuccess(Date.now() - t0, Number(u?.completion_tokens) || 0);
      rec(200, { tin: Number(u?.prompt_tokens) || 0, tout: Number(u?.completion_tokens) || 0, treason: Number(u?.completion_tokens_details?.reasoning_tokens) || 0, finish });
      if (meta) meta.finish = finish;
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
  public static buildPagePrompt(pageNumber: number, sourceText?: string): { systemInstruction: string; prompt: string } {
    let systemInstruction = `You are an expert English→Vietnamese medical translator. Translate the page image into Vietnamese Markdown.
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
    // v11.4: văn phong y khoa + thuật ngữ bắt buộc. Trước đây chế độ đọc ảnh KHÔNG gửi bảng thuật ngữ; nay so khớp trên
    // lớp chữ của trang (App đã có sẵn, không tốn thêm gì). Trang scan không có lớp chữ → chỉ có hướng dẫn văn phong.
    systemInstruction += '\n' + VI_MEDICAL_STYLE + (sourceText ? glossaryPrompt(sourceText) : '');
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

    const { systemInstruction, prompt } = GeminiService.buildPagePrompt(pageNumber, options.textContent);

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

      const { systemInstruction, prompt } = GeminiService.buildPagePrompt(pageNumber, options.textContent);

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
    systemInstruction += '\n' + VI_MEDICAL_STYLE; // v11.4
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
   * v11.4: Lập bảng thuật ngữ RIÊNG cho một tài liệu (một lần cho cả sách): nhận danh sách cụm từ lặp lại trích từ lớp chữ
   * (chạy trên máy), AI chọn cụm là thuật ngữ chuyên môn và cho cách dịch tiếng Việt chuẩn. Các trang sau dùng đúng cách
   * dịch này (cả dịch thường lẫn giữ định dạng) → thuật ngữ thống nhất trong toàn sách, kể cả thuật ngữ không có trong bảng chung.
   * Chi phí: ~1 lượt gọi, khoảng 2–3 nghìn token vào + 3–5 nghìn token ra cho 350 cụm.
   */
  async buildDocumentGlossary(
    candidates: { term: string; count: number }[], context: string, model?: string, signal?: AbortSignal,
  ): Promise<{ en: string; vi: string }[]> {
    if (!candidates.length) return [];
    const requestModel = model || this.modelName;
    const systemInstruction = `You are a senior Vietnamese medical terminologist (radiology, ultrasound, oncology, cardiology, endocrinology).
The user sends numbered English phrases that recur in one medical book (with their frequency) and the book's title/first lines.
Select ONLY phrases that are medical, anatomical, imaging, procedural, device, statistical or other technical terms; skip ordinary English phrases, person names, place names, journal names, fragments that are not a complete term.
For each selected phrase give the standard Vietnamese term exactly as used in Vietnamese medical textbooks and Ministry of Health documents (Sino-Vietnamese where established: tăng sản, loạn sản, di căn, giảm âm, tăng âm, đậm độ, ngấm thuốc…). One concise term, lowercase unless it is a proper name, no explanation. Abbreviations/acronyms, drug and gene names, eponymous signs: keep the abbreviation or name, translate the generic part ("Cooper ligaments" → "dây chằng Cooper"). A term with no established Vietnamese equivalent: Vietnamese rendering + " (English term)".
Return ONLY JSON: {"t":[{"id":"1","v":"thuật ngữ tiếng Việt"}, ...]} — ids of the selected phrases only.`;
    const prompt = `Book: ${context.slice(0, 400)}\nPhrases (id|phrase|count):\n` + candidates.map((c, i) => `${i + 1}|${c.term}|${c.count}`).join('\n');
    const parse = (raw: string) => {
      const arr = parseLayoutJson(raw);
      const out: { en: string; vi: string }[] = [];
      for (const it of arr) {
        const i = Number(it?.id) - 1;
        const v = String(it?.v ?? '').replace(/\s+/g, ' ').trim();
        if (!(i >= 0 && i < candidates.length) || !v || v.includes('=') || v.length > 80) continue;
        if (v.toLowerCase() === candidates[i].term.toLowerCase()) continue;
        out.push({ en: candidates[i].term, vi: v });
      }
      return out;
    };
    const MAX_RETRIES = 4;
    let retryCount = 0;
    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) throw new Error('Translation aborted');
      let ai: any, key: string;
      try { ({ ai, key } = await this.acquireKeyAndInstance()); } catch { throw new Error('Không tìm thấy API Key khả dụng. Vui lòng kiểm tra lại Key trong Cài đặt.'); }
      try {
        let raw: string;
        if (this.isCurrentKeyProxy(key)) {
          raw = await this.callOpenAINonStream(key, requestModel, systemInstruction, prompt, '', signal, 8192, true);
        } else {
          const gm = this.googleModel(key, requestModel);
          const genModel = ai.getGenerativeModel({
            model: gm, systemInstruction,
            generationConfig: GeminiService.genConfig(gm, { temperature: 0, maxOutputTokens: 8192, responseMimeType: 'application/json' }),
          });
          const res = await genModel.generateContent(prompt, signal ? ({ signal } as any) : undefined);
          raw = res.response.text();
        }
        GeminiService.lastSuccessfulKey = key;
        return parse(raw);
      } catch (error: any) {
        if (signal?.aborted) throw new Error('Translation aborted');
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

  /* ---------------- v11.5: kiểm duyệt bản dịch bằng model mạnh hơn ---------------- */
  public static readonly REVIEW_MODEL_DEFAULT = 'gpt-4.1-mini';
  public static currentReviewModel(): string {
    const v = (typeof window !== 'undefined' ? localStorage.getItem('mediTrans_proxyModelReview') : null)?.trim() || '';
    return /^[\w.\-:/]{2,80}$/.test(v) ? v : GeminiService.REVIEW_MODEL_DEFAULT;
  }
  public reviewModelName(): string { return GeminiService.currentReviewModel(); }

  /** Gọi một model cụ thể, trả về chuỗi JSON thô (xoay key, thử lại như các lệnh khác). */
  private async callJsonWithModel(systemInstruction: string, prompt: string, model: string, signal?: AbortSignal, maxTokens = 8192): Promise<string> {
    const MAX_RETRIES = 4;
    let retryCount = 0;
    // key Google: model GPT không dùng được → gemini-2.5-flash (mạnh hơn bản lite dùng để dịch)
    const googleName = /^gemini-/i.test(model) ? model : 'gemini-2.5-flash';
    while (retryCount <= MAX_RETRIES) {
      if (signal?.aborted) throw new Error('Translation aborted');
      let ai: any, key: string;
      try { ({ ai, key } = await this.acquireKeyAndInstance()); } catch { throw new Error('Không tìm thấy API Key khả dụng. Vui lòng kiểm tra lại Key trong Cài đặt.'); }
      try {
        let raw: string;
        if (this.isCurrentKeyProxy(key)) {
          raw = await this.callOpenAINonStream(key, GeminiService.OCR_AS + model, systemInstruction, prompt, '', signal, maxTokens, !GeminiService.jsonModeUnsupported);
        } else {
          const gm = this.googleModel(key, googleName);
          const genModel = ai.getGenerativeModel({
            model: gm, systemInstruction,
            generationConfig: GeminiService.genConfig(gm, { temperature: 0, maxOutputTokens: maxTokens, responseMimeType: 'application/json' }),
          });
          const res = await genModel.generateContent(prompt, signal ? ({ signal } as any) : undefined);
          raw = res.response.text();
        }
        GeminiService.lastSuccessfulKey = key;
        return raw;
      } catch (error: any) {
        if (signal?.aborted) throw new Error('Translation aborted');
        if (!this.isCurrentKeyProxy(key)) {
          if (GeminiService.handleThinkingError(this.googleModel(key, googleName), error)) continue;
          const ge = this.onGoogleError(key, googleName, error);
          if (ge === 'retry') continue;
          if (ge === 'continue') { retryCount++; continue; }
        }
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
   * v11.5: Kiểm duyệt bản dịch: model đối chiếu từng khối gốc ↔ dịch, CHỈ báo lỗi nặng (sai nghĩa, sót/thêm ý, số liệu,
   * phủ định, trái/phải, thuật ngữ, sót tiếng Anh) kèm bản sửa. Không có lỗi → danh sách rỗng.
   */
  async reviewLayoutBlocks(
    items: { id: string; en: string; vi: string }[], signal?: AbortSignal,
  ): Promise<{ id: string; type: string; note: string; fix?: string; term_en?: string; term_vi?: string }[]> {
    if (!items.length) return [];
    const model = GeminiService.currentReviewModel();
    let systemInstruction = `You are a senior reviewer of English→Vietnamese medical translations (radiology, ultrasound, oncology, cardiology, endocrinology).
Input: JSON list of text blocks from ONE book page in reading order: {"id","en" (source),"vi" (translation)}. A sentence may continue from one block into the next; judge fragments together with their neighbours.
Report ONLY serious errors that change or lose medical information:
- meaning: wrong meaning, mistranslated term, reversed relation, wrong subject;
- omission / addition: information in "en" missing from "vi", or added in "vi";
- number: number, unit, sign, range, percentage, figure/table number differs;
- negation / laterality: lost or added negation, left↔right, upper↔lower, medial↔lateral swapped;
- term: a medical term translated against the mandatory glossary below or not as the established Vietnamese term;
- untranslated: an ordinary English word or phrase left in "vi" (names, abbreviations, drug/gene names, reference entries are fine).
Do NOT report: style, word order, synonyms that keep the meaning, punctuation, capitalization, tone-mark placement (hóa/hoá), concise wording, or anything acceptable to a Vietnamese doctor. When unsure, do not report.
For each error give "fix": the corrected FULL Vietnamese translation of that block, changing only what is needed, same length and style, keeping every <n>…</n> tag exactly as in "en" and the same capitalization (ALL-CAPS stays ALL-CAPS). For a term error also give "term_en" (the English term exactly as in "en") and "term_vi" (correct Vietnamese term). "note": the problem in short Vietnamese (≤ 15 words).
Return ONLY JSON: {"t":[{"id":"…","type":"meaning|omission|addition|number|negation|laterality|term|untranslated","note":"…","fix":"…","term_en":"…","term_vi":"…"}]} — {"t":[]} when every block is correct.`;
    systemInstruction += '\n' + VI_MEDICAL_STYLE_SHORT + glossaryPrompt(items.map(i => i.en).join('\n'));
    const prompt = JSON.stringify(items);
    const raw = await this.callJsonWithModel(systemInstruction, prompt, model, signal, Math.min(16000, 1500 + Math.round(prompt.length / 2)));
    let arr: any[] = [];
    try {
      const txt = (raw || '').replace(/```json|```/gi, '');
      const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
      const data = a >= 0 && b > a ? JSON.parse(txt.slice(a, b + 1)) : null;
      arr = Array.isArray(data) ? data : Array.isArray(data?.t) ? data.t : [];
    } catch {
      throw new Error('AI kiểm duyệt trả về dữ liệu không đúng định dạng.');
    }
    const ids = new Set(items.map(i => i.id));
    return arr.filter(x => x && ids.has(String(x.id))).map(x => ({
      id: String(x.id), type: String(x.type || 'other').toLowerCase(), note: String(x.note || '').slice(0, 200),
      fix: typeof x.fix === 'string' ? x.fix.replace(/\s+/g, ' ').trim() : undefined,
      term_en: typeof x.term_en === 'string' ? x.term_en.trim() : undefined,
      term_vi: typeof x.term_vi === 'string' ? x.term_vi.trim() : undefined,
    }));
  }

  /**
   * Dịch giữ định dạng: dịch danh sách khối chữ (đã trích từ PDF) sang tiếng Việt.
   * Trả về map id → bản dịch. Khối nào model bỏ sót sẽ không có trong map (giữ nguyên chữ gốc).
   */
  /**
   * OCR + dịch giữ định dạng cho trang scan (MỘT lần gọi): trả về từng khối chữ với vị trí trên ảnh,
   * chữ gốc và bản dịch tiếng Việt. Dùng chung hệ thống key / xoay key / key hệ thống của web.
   */
  ocrFallbackModel(): string { return GeminiService.ocrFallbackModel(); }

  async ocrLayoutBlocks(imageDataUrl: string, signal?: AbortSignal, opts: { mode?: 'full' | 'extra'; regions?: number[][]; retryEmpty?: boolean; fallback?: boolean } = {}): Promise<any[]> {
    const extra = opts.mode === 'extra';
    // v11.2: đọc lại bằng model OCR dự phòng (chỉ áp dụng khi dùng proxy; key Google dùng model của key)
    const ocrModelName = opts.fallback ? GeminiService.ocrFallbackModel() : GeminiService.currentOcrModel();
    const OCR_CALL = opts.fallback ? GeminiService.OCR_AS + ocrModelName : GeminiService.OCR_MODEL;
    // v10.4: model GPT không quen định dạng box_2d của Gemini → nhắc rõ thứ tự (y trước x) và thang 0–1000
    const gptBoxHint = /^(gpt|o\d)/i.test(ocrModelName)
      ? `
COORDINATES: box_2d is [ymin, xmin, ymax, xmax] — the VERTICAL position (y, from the top edge) comes FIRST, then the horizontal position (x, from the left edge). Use a 0-1000 scale for both axes (0 = top/left edge, 1000 = bottom/right edge), NOT pixels. Measure each box carefully against the page: a block in the right column has xmin > 500; a footer near the bottom has ymin > 900.`
      : '';
    const scope = extra
      ? `This page already has a normal text layer. Return ONLY: (1) text that is part of the IMAGES/photos/scans/diagrams inside these regions (box_2d [ymin,xmin,ymax,xmax] 0-1000): ${JSON.stringify(opts.regions || [])} — e.g. labels, annotations, measurements, words burned into ultrasound/X-ray/CT images, legends inside figures. Return EVERY label of a diagram/drawing (hand-written labels included), each label as its own block with a tight box around only that label's letters (never merge neighbouring labels, never a box covering arrows or the drawing); text written diagonally/slanted: give \"dir\":\"diag\". And (2) any text rotated 90° (vertical text) anywhere on the page. Do NOT return the normal horizontal page text (paragraphs, headings, captions outside the images). If there is no such text, return {"blocks":[]}.`
      : `Detect EVERY text block on the page image: titles, headings, paragraphs, each list item (separately), figure/table captions, each table cell (separately), labels and text inside images/figures, vertical (rotated) text, running headers, footers, page numbers. Treat each text column separately. Do NOT merge blocks from different columns. Pages that are mostly images (X-ray, mammogram, ultrasound, photos) STILL have text: figure captions ("Figure 1 – …"), side tabs with vertical words, running headers/footers, page numbers — return all of them.${opts.retryEmpty ? ' IMPORTANT: a previous attempt wrongly returned no blocks for this page. Look carefully at the whole image, especially the small caption lines below each picture, the vertical tab on the left/right edge and the footer; return every readable text block.' : ''}`;
    const systemInstruction = `You are an OCR engine and an English→Vietnamese medical translator for book/journal pages (often scanned).
${scope}
For each block return:
- "box_2d": ONE box [ymin, xmin, ymax, xmax] — exactly 4 integers 0-1000 (relative to image height/width) tightly enclosing the block's text; never a list of boxes: text in separate areas (a paragraph, then a heading, then a signature) = separate blocks
- "text": the exact original text (join lines with single spaces, remove end-of-line hyphenation). Table-of-contents entries: one block per entry, keep the leader dots as " ....... " followed by the page number (e.g. "V. GUIDANCE ....... 788")
- "v": natural, accurate Vietnamese medical translation of "text" (for table-of-contents entries end with " ....... " and the same page number) (keep numbers, units, symbols, drug/gene names, abbreviations, person names, journal names, URLs, DOIs unchanged; Figure n → Hình n, Table n → Bảng n; keep the original capitalization: ALL-CAPS text → ALL-CAPS Vietnamese, never mixed; keep person names and academic degrees (MD, PhD, MBBS…) exactly as written; ALL-CAPS stays ALL-CAPS, but when only SOME words are capitalized for emphasis uppercase only their Vietnamese translation ("OVAL mass" → "Khối BẦU DỤC"); join words hyphenated at line ends ("Guid-ance" → "Guidance"); reference-list entries and page numbers: return unchanged; in an abbreviation list the abbreviation itself stays as written but its expansion/definition ("Coronary artery disease", "Appropriate use criteria") MUST be translated; no Markdown, no line breaks)
- "lines": number of text lines of the block on the image
- "bold", "italic": true if most of the block is bold / italic
- "bold_lead": true if ONLY the leading label of the block is bold (e.g. "Figure 1" / "Table 2" at the start of a caption)
- "serif": true ONLY if the letters clearly have serifs (Times New Roman-like); modern sans fonts (Arial, Helvetica, Inter, Roboto, Calibri) → false. Use the same value for all blocks that share the same font
- "align": "left" | "center" | "right" | "justify"
- "dir": "up" if the text is rotated and reads bottom-to-top, "down" if it reads top-to-bottom; omit for normal horizontal text. For rotated text, "lines" counts the lines across the block.
Return ONLY JSON: {"blocks":[...]} in reading order (column by column, top to bottom).
Boxes must enclose the text itself: a caption below a picture gets the box of the caption lines, never a box on the picture. Grey/blank rectangles are hidden pictures: ignore them.${gptBoxHint}${VI_MEDICAL_STYLE_SHORT}${extra ? '' : glossaryCompact()}`;
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
    let nestedMismatch = 0;
    const parse = (raw: string): any[] => {
      nestedMismatch = 0;
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
      // v11: gemini-3.1-flash-lite (qua ShopAIKey) hay trả box_2d là DANH SÁCH khung (mỗi dòng / mỗi đoạn một khung):
      // [[91,221,106,826],[122,490,133,558]]. Trước đây num4 coi là khung hỏng → bỏ khối → cả trang "không có chữ", giữ
      // nguyên tiếng Anh mà không báo lỗi (BI-RADS tr.16), hoặc JSON hợp lệ nhưng không còn khối nào.
      const boxesOf = (o: any): number[][] | null => {
        const bx = o.box_2d ?? o.box ?? o.bbox ?? o.box2d ?? o.bounding_box ?? o.bbox_2d ?? o.coordinates ?? o.position;
        if (!Array.isArray(bx) || !bx.length || !Array.isArray(bx[0])) return null;
        const list = bx.map((b: any) => num4({ box_2d: b })).filter(Boolean) as number[][];
        return list.length ? list : null;
      };
      const union = (l: number[][]) => [Math.min(...l.map(b => b[0])), Math.min(...l.map(b => b[1])), Math.max(...l.map(b => b[2])), Math.max(...l.map(b => b[3]))];
      const cleanV = (s: string) => cleanLatex(s).replace(/\*\*/g, '').replace(/\s*\n\s*/g, ' ').trim();
      return (arr || [])
        .flatMap(o => {
          if (!o || typeof o !== 'object') return [];
          const text = strOf(o.text, o.original, o.source, o.src, o.en, o.content, o.caption, o.label);
          if (!text.trim()) return [];
          if (o.dir === 'diag') return []; // v9.8: chữ viết chéo → giữ bản gốc (vẽ ngang sẽ đè lên hình)
          const vRaw = strOf(o.v, o.vi, o.translation, o.translated, o.vietnamese, o.vietnamese_translation, o.text_vi, o.vi_text);
          const base = {
            bold: !!o.bold, italic: !!o.italic, serif: o.serif === true || o.serif === 'true', bold_lead: !!o.bold_lead,
            align: typeof o.align === 'string' ? o.align : undefined,
            dir: o.dir === 'up' || o.dir === 'down' ? o.dir : undefined,
          };
          const multi = boxesOf(o);
          if (multi && multi.length > 1) {
            // Nhiều khung: tách thành nhiều khối nếu chữ gốc + bản dịch chia đúng số đoạn; còn lại gộp một khung bao
            const split = (s: string) => s.split(/\n\s*\n/).map(x => x.trim()).filter(Boolean);
            const tp = split(text), vp = vRaw ? split(vRaw) : [];
            if (tp.length === multi.length && vp.length === multi.length) {
              return multi.map((b, k) => ({ ...base, box_2d: b, text: tp[k].replace(/\s*\n\s*/g, ' '), v: cleanV(vp[k]), lines: undefined }));
            }
            nestedMismatch++;
            return [{ ...base, box_2d: union(multi), text: String(text), v: vRaw ? cleanV(vRaw) : undefined, lines: Number(o.lines) || multi.length }];
          }
          const box = multi ? multi[0] : num4(o);
          if (!box) return [];
          return [{ ...base, box_2d: box, text: String(text), v: vRaw ? cleanV(vRaw) : undefined, lines: Number(o.lines) || undefined }];
        }) as any[];
    };

    const MAX_RETRIES = 4;
    let parseFails = 0;
    let nestedRetried = false;
    let firstParsed: any[] | null = null;
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
          raw = await this.callOpenAINonStream(key, OCR_CALL, systemInstruction, nestedRetried ? prompt + ' Each block must have exactly ONE box of 4 numbers; split text in separate areas into separate blocks.' : prompt, imageDataUrl, signal, 16384, !GeminiService.jsonModeUnsupported);
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
        // v11: khối có nhiều khung không tách được theo đoạn → gộp khung bao, chữ dịch dồn sai chỗ (BI-RADS tr.16) → đọc lại 1 lần
        if (nestedMismatch > 0 && !nestedRetried) {
          nestedRetried = true;
          console.warn(`[MediTrans] OCR trả ${nestedMismatch} khối có nhiều khung → đọc lại 1 lần.`);
          firstParsed = parsed;
          continue;
        }
        if (nestedRetried && nestedMismatch > 0 && firstParsed) return parsed.length >= firstParsed.length ? parsed : firstParsed;
        return parsed;
      } catch (error: any) {
        if (signal?.aborted) throw new Error('Translation aborted');
        if (firstParsed) return firstParsed; // lần đọc lại lỗi → dùng kết quả lần đầu
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

    let systemInstruction = `English→Vietnamese medical translator. Input: JSON text blocks extracted from one PDF page (reading order). A sentence may continue from one block into the next: translate each block's own words in its own "v" — never move, merge or repeat text across blocks (a title split over several blocks: each block translates only its own words; names, including possessives like \"Smith’s\", stay exactly as written). Strict rules: (1) keep the original capitalization — an ALL-CAPS block stays ALL-CAPS in Vietnamese, a Title Case heading stays a heading with a capital first letter, never mix lowercase and capitals inside one heading; (2) keep person names, academic degrees and credentials (MD, PhD, MBBS, CGC…), abbreviations and acronyms exactly as written — never translate them; (3) keep each block's own content in its own \"v\" in the same order — never reorder, merge or split lines between blocks. Translate each block into natural, accurate Vietnamese medical language, consistent across blocks; it will be redrawn in the same box, so keep it concise and add nothing.
Keep unchanged: numbers, units, symbols (± ≤ ≥ × µ °), drug/gene names, abbreviations, superscripts (¹²³), person names, journal names, names of organizations / departments / trials / study groups (e.g. Eastern Cooperative Oncology Group, Department of Motor Vehicles, Canadian National Breast Screening Study), URLs, DOIs, emails. Reference-list entries: return unchanged, but ALWAYS translate section headings (References → Tài liệu tham khảo, Conclusions → Kết luận).
Some blocks mark differently-styled words (bold/colored) with numbered tags <n>…</n>: put the same tag pair ONLY around the Vietnamese words that translate exactly the words inside that tag in the source — never around any other word, even if it is the same term elsewhere in the block (e.g. "the <1>bicuspid</1> valve" → "van <1>hai lá</1>"; colored figure numbers / citations: "(Figs. <1>3.2</1>, <1>3.3</1>) [<1>3</1>]" → "(Hình <1>3.2</1>, <1>3.3</1>) [<1>3</1>]"); keep EVERY tag exactly as many times as in the source, add no new ones; a block without tags gets no tags. Translate EVERY English word, including words outside the tags and in titles (e.g. "Review of <1>Renal Cysts</1>" → "Tổng quan về <1>nang thận</1>"); only person names, journal names and the items listed above stay unchanged.
Figure n → Hình n, Table n → Bảng n. ALL-CAPS headings stay ALL-CAPS. When only SOME words are capitalized for emphasis, uppercase only the Vietnamese words that translate them ("OVAL mass" → "Khối BẦU DỤC", "LOBULATED mass" → "Khối DẠNG THÙY"), never the whole phrase. No Markdown, no LaTeX, no line breaks; inside "v" use “ ” instead of straight double quotes.
Return ONLY JSON: {"t":[{"id":"b1","v":"..."}]} containing every id.`;

    // v11: phần hướng dẫn thẻ <n> chỉ gửi khi có khối mang thẻ. Model nhỏ (gpt-4.1-nano) thấy ví dụ thẻ thì tự bọc thẻ quanh
    // từ tiếng Anh rồi để nguyên không dịch ("thủ thuật <1>US-guided</1>", "<2>core-needle biopsy</2>" — Fornage tr.5,
    // tới <29> trong một đoạn không hề có thẻ), có khi còn thay nghĩa ("breast biopsy" → "chọc hút kim nhỏ").
    if (!blocks.some(b => /<\d+>/.test(b.text))) {
      systemInstruction = systemInstruction.replace(/\nSome blocks mark differently-styled words[\s\S]*?stay unchanged\.\n/,
        '\nTranslate EVERY English word (including words in titles); only person names, journal names and the items listed above stay unchanged. Output plain text only: never add tags, brackets or markup of any kind, and never leave an ordinary English word or phrase untranslated (e.g. "US-guided biopsy" → "sinh thiết dưới hướng dẫn siêu âm (US)", "monograph" → "chuyên khảo").\n');
    }
    const prompt = `${JSON.stringify(blocks.map(b => ({ id: b.id, text: b.text })))}`;
    systemInstruction += VI_MEDICAL_STYLE_SHORT; // v11.4: văn phong y khoa
    systemInstruction += glossaryPrompt(blocks.map(b => b.text).join('\n')); // v9.4: thuật ngữ bắt buộc

    // v11: nếu model tự trả thêm "k" (vài từ đầu câu gốc) thì dùng để kiểm chứng bản dịch thuộc đúng khối (trượt mã khối:
    // "parameters for images…" nhận "Trung tâm" — CT Teaching Manual tr.45). KHÔNG yêu cầu "k" trong prompt: thử nghiệm với
    // gpt-4.1-nano cho thấy model khi đó chỉ dịch đúng 3 từ của "k" ("Hình 1.2 Siêu âm") hoặc bỏ hẳn "v".
    const keyOf = (t: string) => (t.replace(/<\/?\d+>/g, ' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 3).join(' ');
    const srcKey = new Map(blocks.map(b => [b.id, keyOf(b.text)]));
    const keyMatches = (k: string, id: string) => {
      const s = srcKey.get(id) || '';
      if (!k || !s) return true;
      return s.startsWith(k) || k.startsWith(s) || s.split(' ')[0] === k.split(' ')[0] && s.split(' ')[1] === k.split(' ')[1];
    };
    const parse = (raw: string): Record<string, string> => {
      const arr = parseLayoutJson(raw);
      const out: Record<string, string> = {};
      const items: { id: string; k: string; v: string }[] = [];
      for (const item of arr) {
        const id = String(item?.id ?? '');
        const v = item?.v ?? item?.text ?? item?.translation;
        if (id && typeof v === 'string' && v.trim()) items.push({ id, k: typeof item?.k === 'string' ? keyOf(item.k) : '', v: cleanLatex(v).replace(/\*\*/g, '').replace(/\s*\n\s*/g, ' ').trim() });
      }
      let ok = items.filter(it => keyMatches(it.k, it.id));
      // quá nửa không khớp → model hiểu sai "k" (vd. chép bản dịch) chứ không phải trượt mã → bỏ qua kiểm tra k
      if (ok.length < 0.5 * items.length && items.length >= 3) ok = items;
      for (const it of ok) out[it.id] = it.v;
      let moved = 0, dropped = 0;
      for (const it of items) {
        if (ok.includes(it)) continue;
        const cand = blocks.filter(b => !out[b.id] && keyMatches(it.k, b.id) && (srcKey.get(b.id) || '').length > 0);
        if (cand.length === 1) { out[cand[0].id] = it.v; moved++; } else dropped++;
      }
      if (moved || dropped) console.warn(`[MediTrans] Bản dịch trượt mã khối: chuyển đúng chỗ ${moved}, bỏ ${dropped} (sẽ dịch bù).`);
      // model chỉ trả "k" mà quên "v" (gpt-4.1-nano thỉnh thoảng hiểu nhầm yêu cầu) → báo để gửi lại không kèm "k"
      if (!items.length && arr.some((it: any) => typeof it?.k === 'string')) throw new Error('LAYOUT_NO_V');
      if (Object.keys(out).length === 0) throw new Error('Phản hồi dịch không có khối nào hợp lệ.');
      return out;
    };
    const sysWithKey = systemInstruction;
    const sysNoKey = systemInstruction.replace(/\{"t":\[\{"id":"b1","k":"\.\.\.","v":"\.\.\."\}\]\} containing every id, where[^\n]*/, '{"t":[{"id":"b1","v":"..."}]} containing every id.');
    let useKey = true;
    let fullTokens = false;

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
        let truncated = false;
        if (this.isCurrentKeyProxy(key)) {
          const meta: { finish?: string } = {};
          // v11: giới hạn đầu ra theo độ dài đầu vào — model nhỏ đôi khi viết lặp vô tận tới 8192 token (~40 giây/lượt,
          // Clark's tr.17–18 chỉ 6 khối). Bản dịch tiếng Việt ≈ 1–2 lần số token gốc → trần 3 lần + 400 là đủ dư;
          // bị cắt thì nhánh "truncated" bên dưới chia đôi và dịch tiếp như cũ.
          const inTok = Math.ceil(prompt.length / 3);
          raw = await this.callOpenAINonStream(key, GeminiService.LAYOUT_MODEL, useKey ? sysWithKey : sysNoKey, prompt, '', signal, fullTokens ? 8192 : Math.min(8192, Math.max(1200, 400 + 3 * inTok)), true, meta);
          truncated = meta.finish === 'length';
          // v11: MỘT khối mà bị cắt cụt → bản dịch dở dang ("Một số nhà nghiên cứu đã" — Atlas tr.xix) không được nhận;
          // gửi lại với trần token đầy đủ (trước đây nhánh dưới chỉ xử lý khi có ≥ 2 khối)
          if (truncated && blocks.length === 1 && !fullTokens) { fullTokens = true; continue; }
          if (truncated && blocks.length === 1) throw new Error('Bản dịch khối bị cắt cụt.');
        } else {
          const gm = this.googleModel(key, this.modelName);
          const genModel = ai.getGenerativeModel({
            model: gm,
            systemInstruction: useKey ? sysWithKey : sysNoKey,
            generationConfig: GeminiService.genConfig(gm, { temperature: 0.1, responseMimeType: 'application/json' }),
          });
          const result = await genModel.generateContent(prompt, signal ? ({ signal } as any) : undefined);
          const resp = await result.response;
          raw = resp.text() || '';
          truncated = String((resp as any)?.candidates?.[0]?.finishReason || '') === 'MAX_TOKENS';
        }
        // v10.6: model dừng vì hết max_tokens (bản dịch bị cắt cụt) → giữ các khối đã đủ, khối cuối có thể dở dang
        // nên bỏ; phần còn lại chia đôi và dịch tiếp NGAY (trước đây chờ bước dịch bù của cả trang).
        if (truncated && blocks.length > 1) {
          let got: Record<string, string> = {};
          try { got = parse(raw); } catch { /* không đọc được gì */ }
          const lastDone = [...blocks].reverse().find(b => got[b.id]);
          if (lastDone) delete got[lastDone.id];
          const rest = blocks.filter(b => !got[b.id]);
          console.warn(`[MediTrans] Bản dịch bị cắt cụt (hết max_tokens) → dịch tiếp ${rest.length}/${blocks.length} khối thành 2 phần.`);
          if (rest.length) {
            const mid = Math.ceil(rest.length / 2);
            const parts = rest.length > 1 ? [rest.slice(0, mid), rest.slice(mid)] : [rest];
            const more = await Promise.all(parts.map(p => this.translateLayoutBlocks(p, signal).catch(e => {
              if (signal?.aborted) throw e;
              return {} as Record<string, string>; // phần lỗi → bước dịch bù của trang lo
            })));
            for (const m of more) Object.assign(got, m);
          }
          GeminiService.lastSuccessfulKey = key;
          return got;
        }
        const parsed = parse(raw);
        GeminiService.lastSuccessfulKey = key;
        return parsed;
      } catch (error: any) {
        if (signal?.aborted) throw new Error('Translation aborted');
        // v11: model trả "k" mà bỏ "v" → gửi lại ngay bằng định dạng cũ (không "k"), không tính là lỗi key
        if (String(error?.message) === 'LAYOUT_NO_V' && useKey) { useKey = false; console.info('[MediTrans] Model trả thiếu bản dịch ("k" không có "v") → gửi lại định dạng cũ.'); continue; }
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


