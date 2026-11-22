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
// v10.3: chỉ truy vấn tài liệu layout-* (theo khoảng ID) thay vì đọc mọi trang bản dịch chữ
import { query, where, documentId } from 'firebase/firestore';
import { guardedWrite, isFirestoreQuotaBlocked } from './firestoreQuota';
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
  // v10.3: trước đây đọc TOÀN BỘ collection pages (mọi trang bản dịch chữ, mỗi trang tới ~1 MB) mỗi lần mở bảng.
  // Nay chỉ lấy các tài liệu có ID trong khoảng ['layout-', 'layout.') — '.' là ký tự liền sau '-' → đúng mọi 'layout-N'
  // (kể cả bản lưu cũ không có trường kind).
  const pagesCol = collection(db, 'users', target.ownerId, 'documents', target.fileId, 'pages');
  const snap = await getDocs(query(pagesCol,
    where(documentId(), '>=', LAYOUT_DOC_PREFIX),
    where(documentId(), '<', LAYOUT_DOC_PREFIX.slice(0, -1) + String.fromCharCode(LAYOUT_DOC_PREFIX.charCodeAt(LAYOUT_DOC_PREFIX.length - 1) + 1))));
  // v10.4: trang lớn được lưu thành nhiều phần: layout-N (phần 0, có trường parts = số phần) + layout-N~1, layout-N~2…
  const main = new Map<number, { content: string; parts: number }>();
  const extra = new Map<string, string>();
  snap.forEach(d => {
    if (!d.id.startsWith(LAYOUT_DOC_PREFIX)) return;
    const rest = d.id.slice(LAYOUT_DOC_PREFIX.length);
    const data = d.data() as any;
    if (rest.includes('~')) { if (typeof data?.content === 'string') extra.set(rest, data.content); return; }
    const page = parseInt(rest, 10);
    if (!(page > 0) || String(page) !== rest) return;
    main.set(page, { content: data?.content || '[]', parts: Math.max(1, Number(data?.parts) || 1) });
  });
  for (const [page, m] of main) {
    try {
      let pairs = cleanPairs(JSON.parse(m.content));
      for (let k = 1; k < m.parts; k++) {
        const c = extra.get(`${page}~${k}`);
        if (c === undefined) { console.warn(`[Layout] Bản lưu trang ${page} thiếu phần ${k + 1}/${m.parts}: các khối thuộc phần này sẽ hiện là "chưa dịch".`); continue; }
        try { pairs = pairs.concat(cleanPairs(JSON.parse(c))); } catch { console.warn(`[Layout] Phần ${k + 1} của trang ${page} bị hỏng.`); }
      }
      if (pairs.length) out[page] = pairs;
    } catch { /* dữ liệu hỏng → bỏ qua */ }
  }
  return out;
}

/** Giới hạn mỗi tài liệu Firestore 1 MiB (tính theo byte UTF-8, tiếng Việt 2–3 byte/ký tự) → mỗi phần ≤ ~900 KB. */
const PART_MAX_BYTES = 900_000;
const utf8Len = (t: string) => new TextEncoder().encode(t).length;

/** Chia danh sách cặp thành các phần JSON, mỗi phần ≤ PART_MAX_BYTES. KHÔNG bỏ cặp nào. */
export function splitPairsForCloud(pairs: LayoutPair[]): string[] {
  const parts: string[] = [];
  let cur: LayoutPair[] = [];
  let curBytes = 2;
  for (const p of pairs) {
    const b = utf8Len(JSON.stringify(p)) + 1;
    if (b + 2 > PART_MAX_BYTES) {
      // Một cặp đơn lẻ quá lớn (không thực tế: một khối chữ > 900 KB) → cắt bản dịch, ghi rõ trong log
      console.warn('[Layout] Một khối chữ quá lớn để lưu đám mây, bản dịch bị rút gọn.');
      const v = p.v.slice(0, 200_000);
      if (cur.length) { parts.push(JSON.stringify(cur)); cur = []; curBytes = 2; }
      parts.push(JSON.stringify([{ s: p.s.slice(0, 200_000), v }]));
      continue;
    }
    if (curBytes + b > PART_MAX_BYTES && cur.length) { parts.push(JSON.stringify(cur)); cur = []; curBytes = 2; }
    cur.push(p); curBytes += b;
  }
  if (cur.length || !parts.length) parts.push(JSON.stringify(cur));
  return parts;
}

export async function saveCloudLayoutPage(target: LayoutCloudTarget, page: number, pairs: LayoutPair[]): Promise<void> {
  if (!target.canWrite || pairs.length === 0) return;
  // v10.4: không cắt bớt cặp dịch nữa (trước đây cắt còn 3000 cặp / dưới 1 MB → mất bản dịch không báo). Trang lớn được
  // chia nhiều phần; phần phụ ghi TRƯỚC, phần chính (mang số phần) ghi SAU CÙNG → đọc lại không bao giờ ghép nửa vời.
  const parts = splitPairsForCloud(pairs);
  const pagesPath = ['users', target.ownerId, 'documents', target.fileId, 'pages'] as const;
  for (let k = 1; k < parts.length; k++) {
    await guardedWrite(() => setDoc(doc(db, ...pagesPath, `${LAYOUT_DOC_PREFIX}${page}~${k}`), {
      content: parts[k],
      status: 'success',
      kind: 'layout-part',
      updatedAt: serverTimestamp(),
    }), `layout/${target.ownerId}/${target.fileId}/${page}~${k}`, parts[k]);
  }
  // Phần phụ chưa ghi được (hết hạn mức) → KHÔNG ghi phần chính, để bản trên đám mây giữ nguyên bản đầy đủ cũ
  if (parts.length > 1 && isFirestoreQuotaBlocked()) return;
  // Bỏ qua khi nội dung y hệt lần đã lưu; hết hạn mức thì im lặng bỏ qua (trang vẫn lưu trên máy)
  await guardedWrite(() => setDoc(doc(db, ...pagesPath, `${LAYOUT_DOC_PREFIX}${page}`), {
    content: parts[0],
    status: 'success',
    kind: 'layout',
    version: 3,
    parts: parts.length,
    updatedAt: serverTimestamp(),
  }), `layout/${target.ownerId}/${target.fileId}/${page}`, parts.join('\u0001'));
}
