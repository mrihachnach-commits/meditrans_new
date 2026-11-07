/**
 * MediTrans AI — Dịch giữ định dạng (xuất ảnh)
 * Kết nối pdf.js ↔ layoutEngine ↔ GeminiService, lưu đệm IndexedDB và xuất PDF dạng ảnh.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import {
  annotateItemColors,
  buildBlocks,
  normalizeItems,
  paintTranslatedPage,
  FontStyleInfo,
  LayoutBlock,
  PaintReport,
  RawTextItem,
} from './layoutEngine';

export interface LayoutBlockTranslator {
  translateLayoutBlocks(
    blocks: { id: string; text: string }[],
    signal?: AbortSignal,
  ): Promise<Record<string, string>>;
}

/** Cặp câu gốc → câu dịch của một khối chữ (được lưu lên đám mây). */
export interface LayoutPair {
  s: string;
  v: string;
}

export interface LayoutPageResult {
  pageNumber: number;
  blob: Blob;           // ảnh JPEG trang đã dịch
  widthPt: number;      // khổ trang gốc (point) để xuất PDF đúng kích thước
  heightPt: number;
  overflowCount: number;
  shrunkCount: number;
  blockCount: number;
  scanned: boolean;     // trang không có lớp chữ → không dịch được ở chế độ này
  createdAt: number;
  pairs?: LayoutPair[]; // dữ liệu bản dịch để lưu đám mây / dựng lại ảnh
}

const TARGET_WIDTH_PX = 1700;
const JPEG_QUALITY = 0.9;

/* ------------------------------------------------------------------ */
/* Font                                                                */
/* ------------------------------------------------------------------ */

let fontsReady: Promise<void> | null = null;
export function ensureLayoutFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  fontsReady = (async () => {
    if (typeof document === 'undefined' || !(document as any).fonts) return;
    const specs = [
      '400 20px "Tinos"', '700 20px "Tinos"', 'italic 400 20px "Tinos"',
      '400 20px "Arimo"', '700 20px "Arimo"', 'italic 400 20px "Arimo"',
    ];
    const sample = 'Tiếng Việt ắằẳẵặ ếềểễệ ốồổỗộ ướừửữự';
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 4000));
    await Promise.race([
      Promise.all(specs.map(s => (document as any).fonts.load(s, sample).catch(() => null))).then(() => undefined),
      timeout,
    ]);
  })();
  return fontsReady;
}

/* ------------------------------------------------------------------ */
/* Đọc trang                                                           */
/* ------------------------------------------------------------------ */

function styleResolver(page: any, styles: Record<string, any>) {
  const cache = new Map<string, FontStyleInfo>();
  return (fontName: string): FontStyleInfo => {
    const hit = cache.get(fontName);
    if (hit) return hit;
    let name = '';
    let boldFlag = false;
    let italicFlag = false;
    try {
      const f = page.commonObjs?.has?.(fontName) ? page.commonObjs.get(fontName) : null;
      if (f) {
        name = String(f.name || f.loadedName || '');
        boldFlag = Boolean(f.bold || f.black);
        italicFlag = Boolean(f.italic);
      }
    } catch {
      /* font chưa sẵn sàng — dùng thông tin từ styles */
    }
    const family = String(styles?.[fontName]?.fontFamily || '');
    const all = `${name} ${family}`;
    const nameLooksSerif =
      /times|serif|georgia|minion|garamond|cambria|palatino|charter|baskerville|mincho|stix|cmr\d/i.test(name) &&
      !/sans/i.test(name);
    const info: FontStyleInfo = {
      bold: boldFlag || /bold|black|heavy|semibold|demi/i.test(all),
      italic: italicFlag || /italic|oblique/i.test(all),
      serif: nameLooksSerif || (family === 'serif' && !/sans/i.test(name)),
    };
    cache.set(fontName, info);
    return info;
  };
}

export async function analyzePage(pdfDoc: PDFDocumentProxy, pageNumber: number) {
  const page: any = await pdfDoc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1.5, TARGET_WIDTH_PX / base.width));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;

  const textContent = await page.getTextContent();
  const rawItems: RawTextItem[] = (textContent.items as any[])
    .filter(it => typeof it.str === 'string')
    .map(it => ({ str: it.str, transform: it.transform, width: it.width, fontName: it.fontName }));

  const letters = rawItems.reduce((s, it) => s + (it.str.match(/\p{L}/gu)?.length ?? 0), 0);
  const scanned = letters < 20;

  let items = normalizeItems(rawItems, viewport.transform, styleResolver(page, textContent.styles));
  if (!scanned) items = annotateItemColors(ctx, items);
  const blocks = scanned ? [] : buildBlocks(items, canvas.width);

  return { page, canvas, ctx, blocks, scanned, widthPt: base.width, heightPt: base.height };
}

/* ------------------------------------------------------------------ */
/* Dịch 1 trang                                                        */
/* ------------------------------------------------------------------ */

function chunkBlocks(blocks: LayoutBlock[], maxBlocks = 40, maxChars = 6500) {
  const chunks: LayoutBlock[][] = [];
  let cur: LayoutBlock[] = [];
  let chars = 0;
  for (const b of blocks) {
    if (cur.length && (cur.length >= maxBlocks || chars + b.text.length > maxChars)) {
      chunks.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(b);
    chars += b.text.length;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const normKey = (t: string) => t.replace(/\s+/g, ' ').trim();

/** Vẽ bản dịch lên trang đã phân tích và đóng gói kết quả. */
async function finishPage(
  analyzed: Awaited<ReturnType<typeof analyzePage>>,
  pageNumber: number,
  translations: Record<string, string>,
): Promise<LayoutPageResult> {
  const { page, canvas, ctx, blocks, scanned, widthPt, heightPt } = analyzed;
  let report: PaintReport = { painted: 0, overflowIds: [], shrunkIds: [] };
  const pairs: LayoutPair[] = [];
  if (!scanned) {
    report = paintTranslatedPage(ctx, blocks, translations);
    const seen = new Set<string>();
    for (const b of blocks) {
      const v = translations[b.id];
      const key = normKey(b.text);
      if (!b.translatable || !v || seen.has(key)) continue;
      seen.add(key);
      pairs.push({ s: key, v: normKey(v) });
    }
  }

  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Không tạo được ảnh trang'))), 'image/jpeg', JPEG_QUALITY),
  );
  try { page.cleanup?.(); } catch { /* ignore */ }

  return {
    pageNumber,
    blob,
    widthPt,
    heightPt,
    overflowCount: report.overflowIds.length,
    shrunkCount: report.shrunkIds.length,
    blockCount: blocks.filter(b => b.translatable).length,
    scanned,
    createdAt: Date.now(),
    pairs,
  };
}

/** Dịch 1 trang bằng AI rồi vẽ lại giữ định dạng. */
export async function translatePageWithLayout(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  translator: LayoutBlockTranslator,
  signal?: AbortSignal,
): Promise<LayoutPageResult> {
  await ensureLayoutFonts();
  const analyzed = await analyzePage(pdfDoc, pageNumber);
  const translations: Record<string, string> = {};
  if (!analyzed.scanned) {
    const targets = analyzed.blocks.filter(b => b.translatable);
    for (const chunk of chunkBlocks(targets)) {
      if (signal?.aborted) throw new Error('Translation aborted');
      const res = await translator.translateLayoutBlocks(chunk.map(b => ({ id: b.id, text: b.text })), signal);
      Object.assign(translations, res);
    }
  }
  if (signal?.aborted) throw new Error('Translation aborted');
  return finishPage(analyzed, pageNumber, translations);
}

/**
 * Dựng lại ảnh trang từ bản dịch đã lưu (không gọi AI, không tốn token).
 * Ghép theo nội dung câu gốc nên vẫn đúng khi thứ tự/id khối thay đổi.
 */
export async function renderPageFromPairs(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  pairs: LayoutPair[],
): Promise<LayoutPageResult> {
  await ensureLayoutFonts();
  const analyzed = await analyzePage(pdfDoc, pageNumber);
  const lookup = new Map(pairs.map(p => [normKey(p.s), p.v]));
  const translations: Record<string, string> = {};
  for (const b of analyzed.blocks) {
    // Bản lưu cũ (trước khi có thẻ màu) được ghép theo câu gốc không thẻ
    const v = lookup.get(normKey(b.text)) ?? lookup.get(normKey(b.plain));
    if (v) translations[b.id] = v;
  }
  return finishPage(analyzed, pageNumber, translations);
}

/* ------------------------------------------------------------------ */
/* Lưu đệm IndexedDB                                                   */
/* ------------------------------------------------------------------ */

const DB_NAME = 'MediTransLayoutDB';
const STORE = 'pages';

function openLayoutDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB not supported'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Đổi phiên bản bộ máy dàn trang → ảnh cũ trong đệm tự bị bỏ qua và được dựng lại từ bản dịch đã lưu (không tốn token)
const ENGINE_VERSION = 'v4';
const cacheKey = (docKey: string, page: number) => `${ENGINE_VERSION}::${docKey}::${page}`;

export async function saveLayoutPage(docKey: string, result: LayoutPageResult): Promise<void> {
  try {
    const db = await openLayoutDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(result, cacheKey(docKey, result.pageNumber));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn('[Layout] Không lưu được đệm trang:', e);
  }
}

export async function loadLayoutPages(docKey: string, numPages: number): Promise<Record<number, LayoutPageResult>> {
  const out: Record<number, LayoutPageResult> = {};
  try {
    const db = await openLayoutDB();
    await Promise.all(
      Array.from({ length: numPages }, (_, i) => i + 1).map(
        p =>
          new Promise<void>(resolve => {
            const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(cacheKey(docKey, p));
            req.onsuccess = () => {
              if (req.result) out[p] = req.result as LayoutPageResult;
              resolve();
            };
            req.onerror = () => resolve();
          }),
      ),
    );
  } catch (e) {
    console.warn('[Layout] Không đọc được đệm:', e);
  }
  return out;
}

export async function deleteLayoutPages(docKey: string, pages: number[]): Promise<void> {
  try {
    const db = await openLayoutDB();
    await new Promise<void>(resolve => {
      const tx = db.transaction(STORE, 'readwrite');
      pages.forEach(p => tx.objectStore(STORE).delete(cacheKey(docKey, p)));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* Xuất PDF                                                            */
/* ------------------------------------------------------------------ */

export async function exportLayoutPdf(pages: LayoutPageResult[]): Promise<Blob> {
  const pdf = await PDFDocument.create();
  pdf.setProducer('MediTrans AI');
  pdf.setCreator('MediTrans AI - Dịch giữ định dạng');
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  for (const p of sorted) {
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    const img = await pdf.embedJpg(bytes);
    const page = pdf.addPage([p.widthPt, p.heightPt]);
    page.drawImage(img, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
  }
  const bytes = await pdf.save();
  return new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
}

/* ------------------------------------------------------------------ */
/* Khoảng trang                                                        */
/* ------------------------------------------------------------------ */

/** "1-3, 5, 8-10" → [1,2,3,5,8,9,10] (lọc theo 1..max). */
export function parsePageRange(input: string, max: number): number[] {
  const set = new Set<number>();
  for (const part of input.split(/[,;\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (m) {
      let a = parseInt(m[1], 10);
      let b = parseInt(m[2], 10);
      if (a > b) [a, b] = [b, a];
      for (let i = Math.max(1, a); i <= Math.min(max, b); i++) set.add(i);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n >= 1 && n <= max) set.add(n);
    }
  }
  return [...set].sort((a, b) => a - b);
}
