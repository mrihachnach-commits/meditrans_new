/**
 * v10.4: giới hạn dùng AI hệ thống theo người dùng, CHIA SẺ giữa mọi instance serverless (Firestore).
 *
 * Tài liệu aiUsage/{uid}:
 *   minuteStart, minuteCount         — số yêu cầu trong cửa sổ 60 giây
 *   day, dayRequests                 — ngày (giờ Việt Nam) và số yêu cầu trong ngày
 *   dayTokens                        — token trong ngày (vào + ra). Lúc bắt đầu cộng TẠM bằng ước tính tối đa (đặt chỗ),
 *                                      lúc xong trừ phần thừa theo số token thật → nhiều yêu cầu song song không vượt hạn mức
 *   dayInputTokens, dayOutputTokens  — token thật (khi nhà cung cấp trả usage; không có thì theo ước tính)
 *   inflight, inflightAt             — số yêu cầu đang chạy (giới hạn đồng thời); tự xoá khi treo quá 3 phút
 *
 * Cấp phép: runTransaction (đọc–kiểm tra–ghi nguyên tử, Firestore tự thử lại khi tranh chấp) → các yêu cầu đồng thời không
 * thể cùng lọt qua ngưỡng. Kết thúc: FieldValue.increment (nguyên tử, không cần transaction).
 *
 * Firestore lỗi / hết hạn mức Firestore: KHÔNG chặn người dùng, chuyển sang bộ đếm trong bộ nhớ của instance (như v10.3)
 * và ghi cảnh báo vào log.
 *
 * Biến môi trường (tuỳ chọn):
 *   SYSTEM_AI_RATE_PER_MIN       (mặc định 120)      yêu cầu / phút / người
 *   SYSTEM_AI_MAX_CONCURRENT     (mặc định 6)        yêu cầu đồng thời / người
 *   SYSTEM_AI_DAILY_TOKENS       (mặc định 5000000)  token / ngày / người (0 = không giới hạn). Admin chính không bị giới hạn ngày.
 */
import { FieldValue } from "firebase-admin/firestore";

const RATE_WINDOW_MS = 60_000;
const RATE_PER_MIN = Number(process.env.SYSTEM_AI_RATE_PER_MIN || 120);
const MAX_CONCURRENT = Number(process.env.SYSTEM_AI_MAX_CONCURRENT || 6);
const DAILY_TOKENS = Number(process.env.SYSTEM_AI_DAILY_TOKENS ?? 5_000_000);
const INFLIGHT_STALE_MS = 3 * 60_000;

export interface QuotaTicket {
  uid: string;
  reserved: number;
  mode: "firestore" | "memory";
}
export interface QuotaDenied {
  status: 429;
  retryAfter: number;
  error: string;
  reason: "rate" | "concurrency" | "daily";
}

/** Ngày theo giờ Việt Nam (UTC+7) — hạn mức ngày đặt lại lúc 0 giờ Việt Nam. */
export const vnDay = (now: number) => new Date(now + 7 * 3600_000).toISOString().slice(0, 10);
const secondsToVnMidnight = (now: number) => {
  const vn = now + 7 * 3600_000;
  const next = Math.floor(vn / 86_400_000 + 1) * 86_400_000;
  return Math.max(1, Math.ceil((next - vn) / 1000));
};

/** Ước tính token TỐI ĐA của một yêu cầu (đặt chỗ): chữ vào ÷ 3 + 1.500/ảnh + max_tokens ra. */
export function estimateTokens(messages: any[], maxTokens: number): { input: number; total: number } {
  let chars = 0, images = 0;
  for (const m of messages || []) {
    if (typeof m?.content === "string") chars += m.content.length;
    else if (Array.isArray(m?.content)) for (const p of m.content) {
      if (p?.type === "text") chars += String(p.text || "").length;
      else if (p?.type === "image_url") images++;
    }
  }
  const input = Math.ceil(chars / 3) + images * 1500;
  return { input, total: input + Math.max(0, maxTokens) };
}

/* ---------------- dự phòng trong bộ nhớ ---------------- */
const mem = new Map<string, { start: number; count: number; inflight: number }>();
function memAcquire(uid: string, now: number): QuotaDenied | null {
  if (mem.size > 5000) for (const [k, v] of mem) if (now - v.start > RATE_WINDOW_MS && v.inflight <= 0) mem.delete(k);
  let b = mem.get(uid);
  if (!b) { b = { start: now, count: 0, inflight: 0 }; mem.set(uid, b); }
  if (now - b.start > RATE_WINDOW_MS) { b.start = now; b.count = 0; }
  if (b.count >= RATE_PER_MIN) return deny("rate", Math.ceil((b.start + RATE_WINDOW_MS - now) / 1000));
  if (b.inflight >= MAX_CONCURRENT) return deny("concurrency", 3);
  b.count++; b.inflight++;
  return null;
}
function memRelease(uid: string) { const b = mem.get(uid); if (b) b.inflight = Math.max(0, b.inflight - 1); }

function deny(reason: QuotaDenied["reason"], retryAfter: number, extra = ""): QuotaDenied {
  const msg = reason === "rate" ? "Bạn gửi quá nhiều yêu cầu trong một phút. Vui lòng thử lại sau ít giây."
    : reason === "concurrency" ? "Đang có quá nhiều yêu cầu dịch chạy cùng lúc. Vui lòng chờ vài giây."
    : `Bạn đã dùng hết hạn mức AI hệ thống hôm nay${extra}. Hạn mức đặt lại lúc 0 giờ (giờ Việt Nam).`;
  return { status: 429, retryAfter: Math.max(1, retryAfter), error: msg, reason };
}

/**
 * Xin phép gửi một yêu cầu AI. Trả ticket (nhớ gọi releaseQuota khi xong, kể cả khi lỗi) hoặc lý do từ chối.
 */
export async function acquireQuota(db: any, uid: string, estTotal: number, opts: { unlimitedDaily?: boolean } = {}): Promise<QuotaTicket | QuotaDenied> {
  const now = Date.now();
  const today = vnDay(now);
  const ref = db.collection("aiUsage").doc(uid);
  // Tranh chấp (nhiều yêu cầu cùng người dùng một lúc) → Firestore trả ABORTED: thử lại vài lần, vẫn tranh chấp thì từ chối
  // tạm (429) chứ KHÔNG chuyển sang bộ đếm trong bộ nhớ (nếu không, các yêu cầu tranh chấp sẽ lọt qua giới hạn).
  for (let attempt = 0; ; attempt++) {
  try {
    const result: QuotaDenied | null = await db.runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() || {} : {};
      let minuteStart = Number(d.minuteStart) || 0;
      let minuteCount = Number(d.minuteCount) || 0;
      if (now - minuteStart >= RATE_WINDOW_MS) { minuteStart = now; minuteCount = 0; }
      const sameDay = d.day === today;
      const dayTokens = sameDay ? Number(d.dayTokens) || 0 : 0;
      let inflight = Number(d.inflight) || 0;
      if (inflight > 0 && now - (Number(d.inflightAt) || 0) > INFLIGHT_STALE_MS) inflight = 0; // yêu cầu treo / instance chết
      if (minuteCount >= RATE_PER_MIN) return deny("rate", Math.ceil((minuteStart + RATE_WINDOW_MS - now) / 1000));
      if (inflight >= MAX_CONCURRENT) return deny("concurrency", 3);
      if (!opts.unlimitedDaily && DAILY_TOKENS > 0 && dayTokens + estTotal > DAILY_TOKENS) {
        return deny("daily", secondsToVnMidnight(now), ` (${Math.round(dayTokens / 1000)}k/${Math.round(DAILY_TOKENS / 1000)}k token)`);
      }
      const update: any = {
        minuteStart, minuteCount: minuteCount + 1,
        inflight: inflight + 1, inflightAt: now,
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (sameDay) {
        update.dayRequests = FieldValue.increment(1);
        update.dayTokens = FieldValue.increment(estTotal);
      } else {
        Object.assign(update, { day: today, dayRequests: 1, dayTokens: estTotal, dayInputTokens: 0, dayOutputTokens: 0 });
      }
      tx.set(ref, update, { merge: true });
      return null;
    });
    if (result) return result;
    return { uid, reserved: estTotal, mode: "firestore" };
  } catch (e: any) {
    const code = String(e?.code ?? "");
    if (code === "10" || /ABORTED|contention|lock timeout/i.test(String(e?.message || ""))) {
      if (attempt < 4) { await new Promise(r => setTimeout(r, 50 + Math.random() * 150 * (attempt + 1))); continue; }
      return deny("concurrency", 2);
    }
    console.warn(`[aiQuota] Firestore không dùng được (${e?.code || ""} ${String(e?.message || e).slice(0, 120)}) → dùng bộ đếm trong bộ nhớ.`);
    const d = memAcquire(uid, now);
    if (d) return d;
    return { uid, reserved: 0, mode: "memory" };
  }
  }
}

/**
 * Kết thúc yêu cầu: giảm số yêu cầu đang chạy, thay token đặt chỗ bằng token thật (nếu biết).
 * usage = null → không biết số thật (lỗi giữa chừng): trả lại phần ra chưa dùng, giữ phần vào ước tính.
 */
export async function releaseQuota(db: any, ticket: QuotaTicket, usage: { input: number; output: number } | null, estInput: number): Promise<void> {
  if (ticket.mode === "memory") { memRelease(ticket.uid); return; }
  const used = usage ? usage.input + usage.output : estInput;
  const update: any = {
    inflight: FieldValue.increment(-1),
    dayTokens: FieldValue.increment(used - ticket.reserved),
    dayInputTokens: FieldValue.increment(usage ? usage.input : estInput),
    dayOutputTokens: FieldValue.increment(usage ? usage.output : 0),
  };
  try {
    await db.collection("aiUsage").doc(ticket.uid).set(update, { merge: true });
  } catch (e: any) {
    console.warn("[aiQuota] Không cập nhật được lượng dùng:", String(e?.message || e).slice(0, 120));
  }
}

export function isDenied(x: QuotaTicket | QuotaDenied): x is QuotaDenied {
  return (x as QuotaDenied).status === 429;
}

/** Đọc usage từ phản hồi OpenAI-compatible (không stream). */
export function usageFromJson(json: any): { input: number; output: number } | null {
  const u = json?.usage;
  if (!u) return null;
  const input = Number(u.prompt_tokens ?? u.input_tokens);
  const output = Number(u.completion_tokens ?? u.output_tokens);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { input, output };
}
