/**
 * Lưu bản dịch "Giữ định dạng" lên Firestore, giống bản dịch chữ của trang.
 * Đường dẫn: users/{ownerId}/documents/{fileId}/layoutPages/{pageNumber}
 *
 * Chỉ lưu cặp {s: câu gốc, v: câu dịch} của từng khối (vài KB/trang), KHÔNG lưu ảnh.
 * Khi mở lại, ảnh được dựng lại trên máy từ PDF gốc + các cặp này → không tốn token.
 */
import { db, collection, doc, getDocs, setDoc, serverTimestamp } from '../firebase';
import type { LayoutPair } from './layoutTranslationService';

export interface LayoutCloudTarget {
  ownerId: string;
  fileId: string;
  canWrite: boolean;
}

export async function loadCloudLayoutPages(target: LayoutCloudTarget): Promise<Record<number, LayoutPair[]>> {
  const out: Record<number, LayoutPair[]> = {};
  const snap = await getDocs(collection(db, 'users', target.ownerId, 'documents', target.fileId, 'layoutPages'));
  snap.forEach(d => {
    const page = parseInt(d.id, 10);
    const pairs = (d.data() as any)?.pairs;
    if (page > 0 && Array.isArray(pairs)) {
      out[page] = pairs
        .filter((p: any) => p && typeof p.s === 'string' && typeof p.v === 'string')
        .map((p: any) => ({ s: p.s, v: p.v }));
    }
  });
  return out;
}

export async function saveCloudLayoutPage(target: LayoutCloudTarget, page: number, pairs: LayoutPair[]): Promise<void> {
  if (!target.canWrite || pairs.length === 0) return;
  await setDoc(doc(db, 'users', target.ownerId, 'documents', target.fileId, 'layoutPages', String(page)), {
    pairs: pairs.slice(0, 3000),
    version: 1,
    updatedAt: serverTimestamp(),
  });
}
