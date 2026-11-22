/**
 * Bảo vệ hạn mức ghi miễn phí của Firestore (gói Spark: 20.000 lượt ghi / ngày).
 * Khi Firestore báo hết hạn mức (resource-exhausted): tạm ngừng mọi lượt ghi không bắt buộc tới khi hạn mức được đặt lại (0:00 giờ Thái Bình Dương)
 * (bản dịch vẫn lưu trên máy), báo một lần duy nhất thay vì thử lại liên tục.
 */
const LS_KEY = 'meditrans_firestore_quota_until';
/** Hạn mức miễn phí của Firestore đặt lại lúc 0:00 giờ Thái Bình Dương (≈ 14:00–15:00 giờ Việt Nam). */
export function nextQuotaReset(now = Date.now()): number {
  try {
    const la = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const shift = now - la.getTime();
    const next = new Date(la); next.setHours(24, 5, 0, 0); // +5 phút cho chắc
    return next.getTime() + shift;
  } catch { return now + 6 * 60 * 60 * 1000; }
}
// v9.9: nhớ trạng thái hết hạn mức qua các lần tải lại trang (trước đây chỉ nhớ 1 giờ trong bộ nhớ → mỗi lần F5 lại
// thử ghi, lại báo lỗi đỏ)
let blockedUntil = (() => { try { const v = Number(localStorage.getItem(LS_KEY)); return v > Date.now() ? v : 0; } catch { return 0; } })();
let notified = false;
const quotaListeners: (() => void)[] = [];
/** Gọi khi vừa phát hiện hết hạn mức (dùng để tắt log lỗi lặp của Firestore SDK). */
export function onFirestoreQuota(cb: () => void) { quotaListeners.push(cb); if (blockedUntil > Date.now()) cb(); }
const lastWritten = new Map<string, string>();

export const FIRESTORE_QUOTA_EVENT = 'meditrans:firestore-quota';

export function isFirestoreQuotaBlocked(): boolean {
  return Date.now() < blockedUntil;
}

export function isQuotaError(e: any): boolean {
  const s = `${e?.code || ''} ${e?.message || e || ''}`;
  return /resource-exhausted|quota (limit )?exceeded|Quota exceeded/i.test(s);
}

/** Ghi nhận lỗi Firestore; trả về true nếu là lỗi hết hạn mức (đã xử lý, không cần báo thêm). */
export function noteFirestoreError(e: any): boolean {
  if (!isQuotaError(e)) return false;
  const wasBlocked = blockedUntil > Date.now();
  blockedUntil = nextQuotaReset();
  try { localStorage.setItem(LS_KEY, String(blockedUntil)); } catch { /* */ }
  if (!wasBlocked) for (const cb of quotaListeners) { try { cb(); } catch { /* */ } }
  if (!notified) {
    notified = true;
    console.warn('[MediTrans] Firestore đã hết hạn mức ghi miễn phí trong ngày → tạm ngừng lưu lên đám mây, bản dịch vẫn lưu trên máy.');
    try { window.dispatchEvent(new CustomEvent(FIRESTORE_QUOTA_EVENT)); } catch { /* môi trường không có window */ }
  }
  return true;
}

/**
 * Ghi có bảo vệ: bỏ qua khi đang hết hạn mức, bỏ qua khi nội dung giống hệt lần ghi trước (dedupeKey + fingerprint),
 * nuốt lỗi hết hạn mức. Trả về true nếu đã ghi.
 */
export async function guardedWrite(fn: () => Promise<unknown>, dedupeKey?: string, fingerprint?: string): Promise<boolean> {
  if (isFirestoreQuotaBlocked()) return false;
  if (dedupeKey && fingerprint !== undefined && lastWritten.get(dedupeKey) === fingerprint) return false;
  try {
    await fn();
    if (dedupeKey && fingerprint !== undefined) lastWritten.set(dedupeKey, fingerprint);
    return true;
  } catch (e) {
    if (noteFirestoreError(e)) return false;
    throw e;
  }
}
