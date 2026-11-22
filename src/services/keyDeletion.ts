/**
 * Xoá API Key chắc chắn (v9.3).
 * Khi Firestore hết hạn mức ghi miễn phí trong ngày, lệnh xoá chỉ được áp dụng trên máy (key biến mất ngay) nhưng máy chủ
 * không nhận → tải lại trang key hiện lại dù đã báo "xoá thành công". Nay: chỉ báo thành công khi máy chủ xác nhận;
 * chưa xác nhận được thì ẩn key trên máy, không dùng để dịch, và tự xoá lại khi Firestore nhận ghi trở lại.
 */
import { db, doc, deleteDoc } from '../firebase';
import { isQuotaError, noteFirestoreError, isFirestoreQuotaBlocked } from './firestoreQuota';

const LS_KEY = 'mediTrans_pendingKeyDeletes';
export const PENDING_DELETES_EVENT = 'meditrans:pending-key-deletes';

export function getPendingKeyDeletes(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_KEY) || '[]')); } catch { return new Set(); }
}
function setPending(ids: Set<string>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify([...ids])); } catch { /* */ }
  try { window.dispatchEvent(new Event(PENDING_DELETES_EVENT)); } catch { /* */ }
}

export type DeleteOutcome = 'deleted' | 'pending' | 'error';

export async function deleteApiKeyReliably(keyId: string, timeoutMs = 10000): Promise<{ outcome: DeleteOutcome; error?: any }> {
  const pending = getPendingKeyDeletes();
  pending.add(keyId);
  setPending(pending);
  try {
    const result = await Promise.race([
      deleteDoc(doc(db, 'apiKeys', keyId)).then(() => 'ok' as const),
      new Promise<'timeout'>(r => setTimeout(() => r('timeout'), timeoutMs)),
    ]);
    if (result === 'ok') {
      const p = getPendingKeyDeletes(); p.delete(keyId); setPending(p);
      return { outcome: 'deleted' };
    }
    return { outcome: 'pending' }; // máy chủ chưa xác nhận (thường do hết hạn mức) → giữ ẩn, thử lại sau
  } catch (e: any) {
    if (isQuotaError(e)) { noteFirestoreError(e); return { outcome: 'pending', error: e }; }
    const p = getPendingKeyDeletes(); p.delete(keyId); setPending(p); // lỗi thật (không có quyền…) → không ẩn
    return { outcome: 'error', error: e };
  }
}

/** Thử xoá lại các key đã xoá trên máy nhưng máy chủ chưa xác nhận. */
export async function retryPendingKeyDeletes(): Promise<void> {
  if (isFirestoreQuotaBlocked()) return;
  const ids = [...getPendingKeyDeletes()];
  for (const id of ids) {
    const r = await deleteApiKeyReliably(id, 15000);
    if (r.outcome === 'pending') break; // vẫn chưa ghi được → để lần sau
  }
}
