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
  const blocks = scanned ? [] : buildBlocks(items, canvas.width, canvas.height);

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
/* Dịch thường theo lớp chữ: dựng Markdown từ bố cục đã phân tích     */
/* ------------------------------------------------------------------ */

const MD_LABEL_RE = /^(\d{1,3}(\.\d{1,3})*[.)]?|[a-zA-Z][.)]|\(?[ivxIVX]{1,4}[.)]|[•●▪■◦○‣►▸➢➤✓✔❖◆◇□▫·∙§\-–—*o\uF0A7\uF0B7\uF0D8\uF076\uF0FC\uF0A8\uF06E\uF0E0])$/;

export interface PageMarkdown {
  eligible: boolean;
  markdown: string;
  reason?: 'scanned' | 'table' | 'figure' | 'empty';
}

/** Chữ có thẻ <n> → Markdown (đoạn in đậm/nghiêng giữa câu giữ dạng **…** / *…*). */
function blockToMarkdownText(b: LayoutBlock): string {
  let t = b.text.replace(/<(\d+)>([\s\S]*?)<\/\1>/g, (_m, k, inner) => {
    const st = b.styles[parseInt(k, 10) - 1];
    if (!st || !inner.trim()) return inner;
    if (st.bold && !b.baseStyle.bold) return `**${inner}**`;
    if (st.italic && !b.baseStyle.italic) return `*${inner}*`;
    return inner;
  });
  t = t.replace(/<\/?\d+>/g, '').replace(/\s+/g, ' ').trim();
  if (b.leader) t = `${t} … ${b.leader.num}`.trim();
  return t;
}

/**
 * Dựng Markdown chuẩn cấu trúc từ lớp chữ PDF (tiêu đề, tiêu đề phụ, danh sách nhiều cấp, đoạn văn, theo thứ tự cột).
 * Trang scan hoặc có bảng → không đủ điều kiện (dùng cách gửi ảnh như cũ).
 */
export async function buildPageMarkdown(pdfDoc: PDFDocumentProxy, pageNumber: number): Promise<PageMarkdown> {
  await ensureLayoutFonts();
  const a = await analyzePage(pdfDoc, pageNumber);
  try { a.page.cleanup?.(); } catch { /* ignore */ }
  if (a.scanned) return { eligible: false, markdown: '', reason: 'scanned' };
  const W = a.canvas.width, H = a.canvas.height;
  const blocks = a.blocks;

  // Bảng biểu: nhiều khối chữ có ≥2 khối khác nằm ngang hàng → để mô hình đọc ảnh dựng bảng
  const rowPeers = (b: LayoutBlock) => blocks.filter(o => o !== b && (o.translatable || /\d/.test(o.plain)) &&
    !MD_LABEL_RE.test(o.plain.trim()) && (o.x1 <= b.x0 + 1 || o.x0 >= b.x1 - 1) &&
    Math.abs(o.top - b.top) < 0.6 * Math.min(o.size, b.size)).length;
  const tableish = blocks.filter(b => b.translatable && rowPeers(b) >= 2).length;
  if (tableish >= 4) return { eligible: false, markdown: '', reason: 'table' };

  const sizes: number[] = [];
  for (const b of blocks) if (b.translatable) for (let i = 0; i < Math.min(40, b.plain.length); i++) sizes.push(b.size);
  sizes.sort((x, y) => x - y);
  const body = sizes[Math.floor(sizes.length / 2)] || 12;

  const furniture = (b: LayoutBlock) =>
    b.bottom < H * 0.065 || b.top > H * 0.94 ||                                         // sát mép trên/dưới
    ((b.bottom < H * 0.11 || b.top > H * 0.9) && b.lineCount === 1 && b.size < 0.97 * body) || // tiêu đề chạy chữ nhỏ
    b.x1 < W * 0.09 || b.x0 > W * 0.91;                                                  // dải chương bên lề
  const content = blocks.filter(b => b.translatable && !furniture(b));
  if (content.length === 0) return { eligible: false, markdown: '', reason: 'empty' };

  const labelOf = (b: LayoutBlock) => {
    let best: LayoutBlock | null = null;
    for (const L of blocks) {
      if (L === b || L.lineCount !== 1 || !MD_LABEL_RE.test(L.plain.trim())) continue;
      if (L.x1 > b.x0 + 1 || b.x0 - L.x1 > 3 * b.size || Math.abs(L.top - b.top) > 0.5 * b.size) continue;
      if (!best || L.x1 > best.x1) best = L;
    }
    return best;
  };

  // Trang hình nhiều nhãn ngắn rời rạc → để mô hình đọc ảnh (cần nhìn hình mới hiểu nhãn)
  const shortLabels = content.filter(b => !labelOf(b) && b.lineCount === 1 && b.plain.split(/\s+/).length <= 6 && !b.bold && b.size <= 1.05 * body).length;
  const paragraphs = content.filter(b => b.lineCount >= 3).length;
  if (shortLabels >= 5 && shortLabels > content.length * 0.5 && paragraphs <= 1) return { eligible: false, markdown: '', reason: 'figure' };

  // Cấp danh sách theo từng cột: gom vị trí ký hiệu đầu dòng thành cụm; cách nhau > 4 cỡ chữ = sang cột khác
  const labelXs = blocks.filter(L => L.lineCount === 1 && MD_LABEL_RE.test(L.plain.trim())).map(L => ({ x: L.x0, size: L.size }))
    .sort((p, q) => p.x - q.x);
  const clusters: { x: number; col: number; idx: number }[] = [];
  for (const { x, size } of labelXs) {
    const last = clusters[clusters.length - 1];
    if (last && x - last.x < 0.5 * size) continue;
    if (!last || x - last.x > 4 * size) clusters.push({ x, col: last ? last.col + 1 : 0, idx: 0 });
    else clusters.push({ x, col: last.col, idx: last.idx + 1 });
  }
  const levelOf = (x: number, size: number) => {
    let best = clusters[0], d = Infinity;
    for (const c of clusters) { const dd = Math.abs(c.x - x); if (dd < d) { d = dd; best = c; } }
    return best && d < 1.5 * size ? best.idx : 0;
  };

  const out: string[] = [];
  let prevWasItem = false;
  for (const b of content) {
    const text = blockToMarkdownText(b);
    if (!text) continue;
    const L = labelOf(b);
    if (L) {
      const level = levelOf(L.x0, L.size);
      const lab = L.plain.trim();
      const marker = /^\d{1,3}[.)]$/.test(lab) ? `${lab.replace(')', '.')}` : /^[a-zA-Z][.)]$|^\(?[ivxIVX]+[.)]$/.test(lab) ? `- ${lab}` : '-';
      out.push(`${prevWasItem ? '' : '\n'}${'  '.repeat(level)}${marker} ${text}`);
      prevWasItem = true;
      continue;
    }
    const caps = b.plain === b.plain.toUpperCase() && /\p{Lu}/u.test(b.plain);
    let line: string;
    if (b.size >= 1.35 * body) line = `## ${text}`;
    else if ((b.bold && (b.size >= 1.12 * body || caps)) || (b.lineCount <= 2 && b.size >= 1.12 * body)) line = `### ${text}`;
    else if (b.bold && b.lineCount === 1 && b.plain.length < 90) line = `**${text.replace(/\*\*/g, '')}**`;
    else line = text;
    out.push(`\n${line}`);
    prevWasItem = false;
  }
  const markdown = out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return markdown ? { eligible: true, markdown } : { eligible: false, markdown: '', reason: 'empty' };
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
const ENGINE_VERSION = 'v6';
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

/** Đọc lại 1 trang từ IndexedDB (ảnh trả về được trình duyệt lưu trên ổ đĩa, không chiếm RAM). */
export async function loadLayoutPage(docKey: string, page: number): Promise<LayoutPageResult | null> {
  try {
    const db = await openLayoutDB();
    return await new Promise(resolve => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(cacheKey(docKey, page));
      req.onsuccess = () => resolve((req.result as LayoutPageResult) || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
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
