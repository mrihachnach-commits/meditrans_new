/**
 * Lưu bản dịch "Giữ định dạng" lên Firestore — CÙNG CHỖ với bản dịch chữ thường:
 *   users/{ownerId}/documents/{fileId}/pages/layout-{pageNumber}
 * (collection `pages` đã có quyền ghi sẵn nên không cần triển khai thêm Firestore rules).
 *
 * Tài liệu: { content: JSON các cặp {s: câu gốc, v: câu dịch}, status: 'success', kind: 'layout', updatedAt }
 * Chỉ lưu chữ (vài KB/trang), KHÔNG lưu ảnh. Mở lại → ảnh dựng lại trên máy từ PDF gốc + các cặp này (không tốn token).
 *
 * Vẫn đọc bản lưu cũ ở users/{ownerId}/documents/{fileId}/layoutPages/{page} (nếu có).
 */
import { db, collection, doc, getDocs, setDoc, serverTimestamp } from '../firebase';
import type { LayoutPair } from './layoutTranslationService';

export interface LayoutCloudTarget {
  ownerId: string;
  fileId: string;
  canWrite: boolean;
}

export const LAYOUT_DOC_PREFIX = 'layout-';

function cleanPairs(raw: any): LayoutPair[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p: any) => p && typeof p.s === 'string' && typeof p.v === 'string')
    .map((p: any) => ({ s: p.s, v: p.v }));
}

export async function loadCloudLayoutPages(target: LayoutCloudTarget): Promise<Record<number, LayoutPair[]>> {
  const out: Record<number, LayoutPair[]> = {};
  // 1. Bản lưu cũ (collection riêng) — có thể không đọc được nếu rules chưa triển khai
  try {
    const legacy = await getDocs(collection(db, 'users', target.ownerId, 'documents', target.fileId, 'layoutPages'));
    legacy.forEach(d => {
      const page = parseInt(d.id, 10);
      const pairs = cleanPairs((d.data() as any)?.pairs);
      if (page > 0 && pairs.length) out[page] = pairs;
    });
  } catch { /* bỏ qua */ }
  // 2. Bản lưu hiện tại, nằm chung với bản dịch chữ (ưu tiên)
  const snap = await getDocs(collection(db, 'users', target.ownerId, 'documents', target.fileId, 'pages'));
  snap.forEach(d => {
    if (!d.id.startsWith(LAYOUT_DOC_PREFIX)) return;
    const page = parseInt(d.id.slice(LAYOUT_DOC_PREFIX.length), 10);
    if (!(page > 0)) return;
    try {
      const pairs = cleanPairs(JSON.parse((d.data() as any)?.content || '[]'));
      if (pairs.length) out[page] = pairs;
    } catch { /* dữ liệu hỏng → bỏ qua */ }
  });
  return out;
}

export async function saveCloudLayoutPage(target: LayoutCloudTarget, page: number, pairs: LayoutPair[]): Promise<void> {
  if (!target.canWrite || pairs.length === 0) return;
  let list = pairs.slice(0, 3000);
  let content = JSON.stringify(list);
  while (content.length > 1_000_000 && list.length > 1) { // giới hạn 1 MB của rules
    list = list.slice(0, Math.floor(list.length * 0.8));
    content = JSON.stringify(list);
  }
  await setDoc(doc(db, 'users', target.ownerId, 'documents', target.fileId, 'pages', `${LAYOUT_DOC_PREFIX}${page}`), {
    content,
    status: 'success',
    kind: 'layout',
    version: 2,
    updatedAt: serverTimestamp(),
  });
}
