/**
 * MediTrans AI — Dịch giữ định dạng (xuất ảnh)
 * Kết nối pdf.js ↔ layoutEngine ↔ GeminiService, lưu đệm IndexedDB và xuất PDF dạng ảnh.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { OPS } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import {
  analyzeColumns,
  annotateItemColors,
  blocksFromOcr,
  OcrBlock,
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
  /**
   * (Tuỳ chọn) Hỏi AI trang có mấy cột văn bản khi bộ nhận diện tự động không chắc chắn.
   * splits = vị trí khe giữa các cột, tính theo tỉ lệ chiều rộng trang (0..1).
   */
  detectColumns?(imageDataUrl: string, signal?: AbortSignal): Promise<{ columns: number; splits: number[] } | null>;
  /**
   * (Tuỳ chọn) OCR + dịch trong MỘT lần gọi: AI đọc ảnh trang scan, trả về từng khối chữ
   * (box_2d [ymin,xmin,ymax,xmax] 0..1000, text gốc, v = bản dịch, số dòng, kiểu chữ, căn lề).
   */
  ocrLayoutBlocks?(imageDataUrl: string, signal?: AbortSignal, opts?: OcrRequestOptions): Promise<OcrBlock[]>;
}

/**
 * mode 'full'  : OCR toàn trang (trang scan / lớp chữ hỏng).
 * mode 'extra' : trang có lớp chữ — chỉ lấy chữ NẰM TRONG ẢNH (regions) và chữ xoay 90°.
 */
export interface OcrRequestOptions {
  mode?: 'full' | 'extra';
  /** Vùng ảnh trên trang, box_2d [ymin, xmin, ymax, xmax] 0..1000. */
  regions?: number[][];
}

/** Khoá đặc biệt trong danh sách cặp câu: lưu kết quả OCR (vị trí khối) để dựng lại trang không cần gọi AI. */
export const OCR_PAIR_KEY = '__ocr__';
/** OCR bổ sung (chữ trong ảnh / chữ xoay) trên trang có lớp chữ. */
export const OCR_EXTRA_KEY = '__ocr_extra__';
export const isOcrKey = (s: string) => s === OCR_PAIR_KEY || s === OCR_EXTRA_KEY;

/* ------------------------------------------------------------------ */
/* Nhận diện số cột (tự động; AI hỗ trợ khi mơ hồ)                     */
/* ------------------------------------------------------------------ */

const COLUMN_CACHE_KEY = 'meditrans_layout_columns_v1';
const columnMemo = new Map<string, number[]>(); // khoá → khe cột theo tỉ lệ chiều rộng trang

function loadColumnMemo() {
  if (columnMemo.size) return;
  try {
    const raw = localStorage.getItem(COLUMN_CACHE_KEY);
    if (raw) Object.entries(JSON.parse(raw) as Record<string, number[]>).forEach(([k, v]) => columnMemo.set(k, v));
  } catch { /* ignore */ }
}

function saveColumnMemo(key: string, fractions: number[]) {
  columnMemo.set(key, fractions);
  try {
    const obj: Record<string, number[]> = {};
    const entries = [...columnMemo.entries()].slice(-3000); // giới hạn dung lượng
    entries.forEach(([k, v]) => { obj[k] = v; });
    localStorage.setItem(COLUMN_CACHE_KEY, JSON.stringify(obj));
  } catch { /* ignore */ }
}

function columnKey(pdfDoc: PDFDocumentProxy, pageNumber: number) {
  const fp = (pdfDoc as any).fingerprints?.[0] || (pdfDoc as any).fingerprint || `n${pdfDoc.numPages}`;
  return `${fp}::${pageNumber}`;
}

/** Ảnh trang thu nhỏ (JPEG) để gửi AI nhận diện bố cục — rẻ, chỉ cần nhìn khối chữ. */
function thumbnail(canvas: HTMLCanvasElement, maxW = 900): string {
  const k = Math.min(1, maxW / canvas.width);
  const c = document.createElement('canvas');
  c.width = Math.round(canvas.width * k);
  c.height = Math.round(canvas.height * k);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(canvas, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', maxW > 1000 ? 0.85 : 0.7);
}

/** Ảnh gửi OCR: đủ nét để đọc chữ nhỏ (chú thích, chỉ số) nhưng không quá nặng. */
function ocrImage(canvas: HTMLCanvasElement): string {
  return thumbnail(canvas, 1600);
}

/**
 * Quyết định khe cột của trang:
 *  - Bằng chứng rõ (nhiều dòng kết thúc/bắt đầu sát khe) → dùng ngay, không tốn token.
 *  - Không có khe nào → trang 1 cột.
 *  - Mơ hồ → hỏi AI (ảnh thu nhỏ), ghi nhớ kết quả theo trang để lần sau không hỏi lại.
 *  - Không có AI / AI lỗi → dùng ngưỡng mặc định của bộ máy.
 */
async function resolveGutters(
  pdfDoc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement,
  items: Parameters<typeof analyzeColumns>[0], advisor?: LayoutBlockTranslator, signal?: AbortSignal,
): Promise<number[] | undefined> {
  const W = canvas.width;
  const key = columnKey(pdfDoc, pageNumber);
  loadColumnMemo();
  const memo = columnMemo.get(key);
  if (memo) return memo.map(f => f * W);

  const { strong, weak } = analyzeColumns(items);
  if (!weak.length) return strong.length ? strong : undefined; // rõ ràng: chắc chắn nhiều cột hoặc 1 cột
  if (!advisor?.detectColumns) return undefined;             // không có AI → để bộ máy tự quyết theo ngưỡng mặc định

  try {
    const ans = await advisor.detectColumns(thumbnail(canvas), signal);
    if (!ans || !Number.isFinite(ans.columns)) return undefined;
    let gutters: number[];
    if (ans.columns <= 1) {
      gutters = strong; // AI nói 1 cột → bỏ các khe yếu
    } else {
      const cands = [...strong, ...weak];
      gutters = (ans.splits || [])
        .filter(f => f > 0.15 && f < 0.85)
        .map(f => {
          const x = f * W;
          const near = cands.reduce<number | null>((best, c) => (Math.abs(c - x) < 0.05 * W && (best === null || Math.abs(c - x) < Math.abs(best - x)) ? c : best), null);
          return near ?? x;
        });
      if (!gutters.length) gutters = cands; // AI nói nhiều cột nhưng không chỉ vị trí → dùng mọi ứng viên
    }
    gutters = [...new Set(gutters.map(x => Math.round(x)))].sort((a, b) => a - b);
    saveColumnMemo(key, gutters.map(x => x / W));
    return gutters;
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn('[Layout] AI không nhận diện được số cột, dùng nhận diện tự động:', e);
    return undefined;
  }
}

/** Cặp câu gốc → câu dịch của một khối chữ (được lưu lên đám mây). */
export interface LayoutPair {
  s: string;
  v: string;
}

export interface LayoutPageResult {
  /** Trang được dịch bằng OCR (ảnh scan / lớp chữ hỏng). */
  ocr?: boolean;
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

/**
 * Lớp chữ PDF bị hỏng? (font nhúng không có bảng mã Unicode → pdf.js trả về ký tự vùng riêng, ký tự thay thế,
 * ký tự điều khiển, hoặc chuỗi chữ cái vô nghĩa không có nguyên âm).
 */
export function isGarbledText(text: string): boolean {
  const chars = [...text.replace(/\s+/g, '')];
  if (chars.length < 40) return false;
  const bad = chars.filter(ch => /[\uE000-\uF8FF\uFFFD\u0000-\u0008\u000E-\u001F]/.test(ch)).length;
  if (bad / chars.length > 0.25) return true;
  const words = text.match(/\p{L}{3,}/gu) || [];
  const latin = words.filter(w => /^[A-Za-z]+$/.test(w));
  if (latin.length >= 30) {
    const noVowel = latin.filter(w => !/[aeiouyAEIOUY]/.test(w)).length;
    if (noVowel / latin.length > 0.35) return true;
  }
  return false;
}

export async function analyzePage(
  pdfDoc: PDFDocumentProxy, pageNumber: number, advisor?: LayoutBlockTranslator, signal?: AbortSignal,
) {
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
  // Trang scan (không có lớp chữ) HOẶC lớp chữ hỏng (font không có bảng mã → ký tự rác) → tự chuyển sang OCR
  const scanned = letters < 20 || isGarbledText(rawItems.map(it => it.str).join(' '));

  // Chữ xoay (dọc) không dàn lại được từ lớp chữ → sẽ được OCR bổ sung
  const rotatedLetters = rawItems.reduce((n, it) => {
    const t = it.transform;
    const rotated = Math.abs(t[1]) > 0.05 * Math.abs(t[0]) || t[0] <= 0;
    return rotated ? n + (it.str.match(/\p{L}/gu)?.length ?? 0) : n;
  }, 0);
  const figures = scanned ? [] : await findImageRegions(page, viewport, canvas.width, canvas.height);

  let items = normalizeItems(rawItems, viewport.transform, styleResolver(page, textContent.styles));
  if (!scanned) items = annotateItemColors(ctx, items);
  const gutters = scanned ? undefined : await resolveGutters(pdfDoc, pageNumber, canvas, items, advisor, signal);
  const blocks = scanned ? [] : buildBlocks(items, canvas.width, canvas.height, gutters);

  return { page, canvas, ctx, blocks, scanned, widthPt: base.width, heightPt: base.height, figures, rotatedLetters };
}

/**
 * Vị trí các ảnh raster vẽ trên trang (toạ độ canvas), đọc từ danh sách lệnh vẽ của pdf.js.
 * Bỏ ảnh quá nhỏ (biểu tượng) và ảnh phủ gần hết trang (nền).
 */
async function findImageRegions(page: any, viewport: any, W: number, H: number): Promise<{ x0: number; y0: number; x1: number; y1: number }[]> {
  try {
    const opList = await page.getOperatorList();
    const fn: number[] = opList.fnArray, args: any[] = opList.argsArray;
    const mulM = (a: number[], b: number[]) => [
      a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
    ];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack: number[][] = [];
    const out: { x0: number; y0: number; x1: number; y1: number }[] = [];
    const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, (OPS as any).paintJpegXObject].filter(v => v !== undefined));
    for (let i = 0; i < fn.length; i++) {
      const op = fn[i];
      if (op === OPS.save) stack.push(ctm);
      else if (op === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (op === OPS.transform) ctm = mulM(ctm, args[i]);
      else if (op === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args[i]?.[0]) && args[i][0].length === 6) ctm = mulM(ctm, args[i][0]); }
      else if (op === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (imageOps.has(op)) {
        const m = mulM(viewport.transform, ctm);
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const r = { x0: Math.max(0, Math.min(...xs)), y0: Math.max(0, Math.min(...ys)), x1: Math.min(W, Math.max(...xs)), y1: Math.min(H, Math.max(...ys)) };
        const area = (r.x1 - r.x0) * (r.y1 - r.y0);
        if (area >= 0.01 * W * H && area <= 0.85 * W * H && r.x1 - r.x0 > 0.06 * W && r.y1 - r.y0 > 0.04 * H) out.push(r);
      }
    }
    return out;
  } catch {
    return [];
  }
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
type Analyzed = Awaited<ReturnType<typeof analyzePage>>;

/** Thay khối chữ của trang bằng khối OCR (trang scan / lớp chữ hỏng). */
function applyOcr(analyzed: Analyzed, ocr: OcrBlock[]): Analyzed {
  const blocks = blocksFromOcr(analyzed.ctx, ocr);
  return { ...analyzed, blocks, scanned: false };
}

/**
 * Thêm khối OCR (chữ trong ảnh / chữ xoay) vào trang có lớp chữ.
 * Bỏ khối trùng với chữ đã có trong lớp chữ (AI đôi khi trả cả chữ thường).
 */
function addExtraOcr(analyzed: Analyzed, extra: OcrBlock[]): { analyzed: Analyzed; kept: OcrBlock[] } {
  const cand = blocksFromOcr(analyzed.ctx, extra, 'o');
  const keptIdx = new Set<number>();
  const blocks = [...analyzed.blocks];
  cand.forEach(b => {
    const area = Math.max(1, (b.x1 - b.x0) * (b.bottom - b.top));
    const overlap = analyzed.blocks.some(t => {
      const ix = Math.min(t.x1, b.x1) - Math.max(t.x0, b.x0), iy = Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top);
      return ix > 0 && iy > 0 && (ix * iy) / area > 0.3;
    });
    if (overlap) return;
    blocks.push(b);
    const k = extra.findIndex((o, i) => !keptIdx.has(i) && o.text.replace(/\s+/g, ' ').trim() === b.text);
    if (k >= 0) keptIdx.add(k);
  });
  return { analyzed: { ...analyzed, blocks }, kept: extra.filter((_, i) => keptIdx.has(i)) };
}

/** Lưu kết quả OCR gọn (vị trí + chữ gốc + kiểu chữ); bản dịch nằm trong các cặp câu. */
const slimOcr = (ocr: OcrBlock[]) => ocr.map(o => ({
  box_2d: o.box_2d, text: o.text, lines: o.lines, bold: o.bold || undefined, italic: o.italic || undefined,
  serif: o.serif, align: o.align, dir: o.dir || undefined,
}));

async function finishPage(
  analyzed: Analyzed,
  pageNumber: number,
  translations: Record<string, string>,
  ocr?: OcrBlock[],
  extraOcr?: OcrBlock[],
): Promise<LayoutPageResult> {
  const { page, canvas, ctx, blocks, scanned, widthPt, heightPt } = analyzed;
  let report: PaintReport = { painted: 0, overflowIds: [], shrunkIds: [] };
  const pairs: LayoutPair[] = [];
  if (ocr?.length) pairs.push({ s: OCR_PAIR_KEY, v: JSON.stringify(slimOcr(ocr)) });
  if (extraOcr?.length) pairs.push({ s: OCR_EXTRA_KEY, v: JSON.stringify(slimOcr(extraOcr)) });
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
    ocr: !!ocr?.length || !!extraOcr?.length,
  };
}

/** Dịch 1 trang bằng AI rồi vẽ lại giữ định dạng. */
export async function translatePageWithLayout(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  translator: LayoutBlockTranslator,
  signal?: AbortSignal,
  opts: { forceOcr?: boolean } = {},
): Promise<LayoutPageResult> {
  await ensureLayoutFonts();
  let analyzed = await analyzePage(pdfDoc, pageNumber, translator, signal);
  // Trang scan (không có lớp chữ) hoặc người dùng chọn OCR → AI đọc ảnh, nhận diện khối chữ và dịch luôn
  if ((analyzed.scanned || opts.forceOcr) && translator.ocrLayoutBlocks) {
    const ocr = await translator.ocrLayoutBlocks(ocrImage(analyzed.canvas), signal);
    if (signal?.aborted) throw new Error('Translation aborted');
    if (!ocr.length) throw new Error('OCR không nhận diện được chữ nào trên trang này.');
    analyzed = applyOcr(analyzed, ocr);
    const byText = new Map(ocr.map(o => [o.text.replace(/\s+/g, ' ').trim(), o.v]));
    const translations: Record<string, string> = {};
    const missing: LayoutBlock[] = [];
    for (const b of analyzed.blocks) {
      const v = byText.get(b.text);
      if (v && v.trim()) translations[b.id] = v; else if (b.translatable) missing.push(b);
    }
    for (const chunk of chunkBlocks(missing)) { // khối AI quên dịch → dịch bù
      if (signal?.aborted) throw new Error('Translation aborted');
      Object.assign(translations, await translator.translateLayoutBlocks(chunk.map(b => ({ id: b.id, text: b.text })), signal));
    }
    return finishPage(analyzed, pageNumber, translations, ocr);
  }
  // Trang có lớp chữ nhưng có ẢNH (chữ trong hình) hoặc CHỮ XOAY → OCR bổ sung riêng các vùng đó
  let extraKept: OcrBlock[] | undefined;
  const extraTr: Record<string, string> = {};
  if (!analyzed.scanned && translator.ocrLayoutBlocks && (analyzed.figures.length > 0 || analyzed.rotatedLetters >= 3)) {
    try {
      const W = analyzed.canvas.width, H = analyzed.canvas.height;
      const regions = analyzed.figures.map(f => [f.y0 / H, f.x0 / W, f.y1 / H, f.x1 / W].map(v => Math.round(v * 1000)));
      const extra = await translator.ocrLayoutBlocks(ocrImage(analyzed.canvas), signal, { mode: 'extra', regions });
      const inRegion = (o: OcrBlock) => {
        const [y0, x0, y1, x1] = o.box_2d, cy = (y0 + y1) / 2, cx = (x0 + x1) / 2;
        return regions.some(r => cy >= r[0] - 5 && cy <= r[2] + 5 && cx >= r[1] - 5 && cx <= r[3] + 5);
      };
      const wanted = extra.filter(o => o.dir === 'up' || o.dir === 'down' || inRegion(o));
      if (wanted.length) {
        const r = addExtraOcr(analyzed, wanted);
        analyzed = r.analyzed;
        extraKept = r.kept;
        const byText = new Map(wanted.map(o => [o.text.replace(/\s+/g, ' ').trim(), o.v]));
        for (const b of analyzed.blocks) if (b.fromOcr) { const v = byText.get(b.text); if (v?.trim()) extraTr[b.id] = v; }
      }
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn('[Layout] OCR chữ trong ảnh / chữ xoay lỗi, bỏ qua phần này:', e);
    }
  }
  const translations: Record<string, string> = { ...extraTr };
  if (!analyzed.scanned) {
    const targets = analyzed.blocks.filter(b => b.translatable && !translations[b.id]);
    for (const chunk of chunkBlocks(targets)) {
      if (signal?.aborted) throw new Error('Translation aborted');
      const res = await translator.translateLayoutBlocks(chunk.map(b => ({ id: b.id, text: b.text })), signal);
      Object.assign(translations, res);
    }
  }
  if (signal?.aborted) throw new Error('Translation aborted');
  return finishPage(analyzed, pageNumber, translations, undefined, extraKept);
}

/**
 * Dựng lại ảnh trang từ bản dịch đã lưu (không gọi AI, không tốn token).
 * Ghép theo nội dung câu gốc nên vẫn đúng khi thứ tự/id khối thay đổi.
 */
export async function renderPageFromPairs(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  pairs: LayoutPair[],
  translator?: LayoutBlockTranslator,
  signal?: AbortSignal,
): Promise<LayoutPageResult & { retranslated?: number }> {
  await ensureLayoutFonts();
  let analyzed = await analyzePage(pdfDoc, pageNumber, translator, signal);
  const parseOcr = (key: string): OcrBlock[] | undefined => {
    const e = pairs.find(p => p.s === key);
    if (!e) return undefined;
    try { const v = JSON.parse(e.v); return Array.isArray(v) && v.length ? v : undefined; } catch { return undefined; }
  };
  const ocr = parseOcr(OCR_PAIR_KEY);
  let extraOcr = parseOcr(OCR_EXTRA_KEY);
  if (ocr) analyzed = applyOcr(analyzed, ocr);
  else if (extraOcr) { const r = addExtraOcr(analyzed, extraOcr); analyzed = r.analyzed; extraOcr = r.kept; }
  const lookup = new Map(pairs.filter(p => !isOcrKey(p.s)).map(p => [normKey(p.s), p.v]));
  const translations: Record<string, string> = {};
  const missing: LayoutBlock[] = [];
  for (const b of analyzed.blocks) {
    // Bản lưu cũ (trước khi có thẻ màu) được ghép theo câu gốc không thẻ
    const v = lookup.get(normKey(b.text)) ?? lookup.get(normKey(b.plain));
    if (v) translations[b.id] = v;
    else if (b.translatable) missing.push(b);
  }
  // Bản lưu cũ được tạo khi bộ máy còn ghép nhầm 2 cột → các khối mới không khớp: chỉ dịch bù những khối này
  let retranslated = 0;
  if (translator && missing.length && !analyzed.scanned) {
    try {
      for (const chunk of chunkBlocks(missing)) {
        if (signal?.aborted) throw new Error('Translation aborted');
        Object.assign(translations, await translator.translateLayoutBlocks(chunk.map(b => ({ id: b.id, text: b.text })), signal));
      }
      retranslated = missing.length;
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn('[Layout] Không dịch bù được khối thiếu:', e);
    }
  }
  const res = await finishPage(analyzed, pageNumber, translations, ocr, ocr ? undefined : extraOcr);
  return { ...res, retranslated };
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
const ENGINE_VERSION = 'v9'; // v9: chữ viết tắt đầu đoạn, cỡ chữ đồng đều, OCR (trang scan, chữ trong ảnh, chữ xoay)
const cacheKey = (docKey: string, page: number) => `${ENGINE_VERSION}::${docKey}::${page}`;

// Cặp câu gốc → câu dịch lưu trên máy theo khoá KHÔNG phụ thuộc phiên bản bộ máy → nâng cấp không mất bản dịch
const pairsKey = (docKey: string, page: number) => `pairs::${docKey}::${page}`;

/**
 * Bản dịch giữ định dạng đã lưu trên máy (giống bản dịch chữ được lưu đệm):
 * gồm khoá cặp câu hiện tại và cặp câu nằm trong ảnh đệm của mọi phiên bản cũ (v1…v6).
 */
export async function loadLocalLayoutPairs(docKey: string): Promise<Record<number, LayoutPair[]>> {
  const out: Record<number, LayoutPair[]> = {};
  const fromCurrent = new Set<number>();
  try {
    const db = await openLayoutDB();
    await new Promise<void>(resolve => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const key = String(cur.key);
        const suffix = `::${docKey}::`;
        const at = key.indexOf(suffix);
        if (at > 0 && /^\d+$/.test(key.slice(at + suffix.length))) {
          const page = parseInt(key.slice(at + suffix.length), 10);
          const prefix = key.slice(0, at);
          const v: any = cur.value;
          const pairs: LayoutPair[] | undefined = v?.pairs;
          if (Array.isArray(pairs) && pairs.length) {
            if (prefix === 'pairs') { out[page] = pairs; fromCurrent.add(page); }
            else if (!fromCurrent.has(page) && (!out[page] || prefix === ENGINE_VERSION)) out[page] = pairs;
          }
        }
        cur.continue();
      };
      req.onerror = () => resolve();
    });
  } catch { /* ignore */ }
  return out;
}

export async function saveLayoutPage(docKey: string, result: LayoutPageResult): Promise<void> {
  try {
    const db = await openLayoutDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(result, cacheKey(docKey, result.pageNumber));
      if (result.pairs?.length) {
        tx.objectStore(STORE).put({ pairs: result.pairs, savedAt: Date.now() }, pairsKey(docKey, result.pageNumber));
      }
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
      pages.forEach(p => { tx.objectStore(STORE).delete(cacheKey(docKey, p)); tx.objectStore(STORE).delete(pairsKey(docKey, p)); });
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
