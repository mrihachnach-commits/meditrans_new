/**
 * Bảo vệ hạn mức ghi miễn phí của Firestore (gói Spark: 20.000 lượt ghi / ngày).
 * Khi Firestore báo hết hạn mức (resource-exhausted): tạm ngừng mọi lượt ghi không bắt buộc trong 1 giờ
 * (bản dịch vẫn lưu trên máy), báo một lần duy nhất thay vì thử lại liên tục.
 */
let blockedUntil = 0;
let notified = false;
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
  blockedUntil = Date.now() + 60 * 60 * 1000;
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
