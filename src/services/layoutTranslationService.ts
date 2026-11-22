/**
 * MediTrans AI — Dịch giữ định dạng (xuất ảnh)
 * Kết nối pdf.js ↔ layoutEngine ↔ GeminiService, lưu đệm IndexedDB và xuất PDF dạng ảnh.
 */
import { isReferenceLine } from '../utils/translateBoost';
import { glossaryExact } from './medicalGlossary';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { OPS } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import {
  analyzeColumns,
  detectDropCaps,
  annotateItemColors,
  blocksFromOcr,
  refineOcrBoxes,
  maskPhotosCanvas,
  rotatedBlocksFromItems,
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
  /** v9.5: lần đọc lại sau khi AI trả rỗng cho trang có hình */
  retryEmpty?: boolean;
  /** Vùng ảnh trên trang, box_2d [ymin, xmin, ymax, xmax] 0..1000. */
  regions?: number[][];
}

/** Khoá đặc biệt trong danh sách cặp câu: lưu kết quả OCR (vị trí khối) để dựng lại trang không cần gọi AI. */
export const OCR_PAIR_KEY = '__ocr__';
/** OCR bổ sung (chữ trong ảnh / chữ xoay) trên trang có lớp chữ. */
export const OCR_EXTRA_KEY = '__ocr_extra__';
/** Đánh dấu trang trắng trong dữ liệu lưu đám mây (mở lại không gọi AI, không cảnh báo). */
export const BLANK_PAIR_KEY = '__blank__';
/** v9.5: AI không tìm thấy chữ trên trang CÓ hình/mực (không phải trang trắng) → giữ trang gốc nhưng cho phép dịch lại. */
export const NOTEXT_PAIR_KEY = '__notext__';
export const isOcrKey = (s: string) => s === OCR_PAIR_KEY || s === OCR_EXTRA_KEY || s === BLANK_PAIR_KEY || s === NOTEXT_PAIR_KEY;

/* ------------------------------------------------------------------ */
/* Nhận diện số cột (tự động; AI hỗ trợ khi mơ hồ)                     */
/* ------------------------------------------------------------------ */

// v2: bỏ các câu trả lời cũ (AI có thể đã trả lời sai "1 cột" cho trang mà cột trái toàn hình)
const COLUMN_CACHE_KEY = 'meditrans_layout_columns_v2';
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

  // Sách thường dùng chung một bố cục cho mọi trang: trang khác của CÙNG tài liệu đã được AI xác nhận khe cột
  // trùng vị trí với các khe yếu ở đây → dùng lại, không gọi AI (mỗi lần gọi gửi kèm ảnh trang → chậm, tốn token)
  const prefix = key.slice(0, key.lastIndexOf('::') + 2);
  const cands = [...strong, ...weak];
  for (const [k, fr] of [...columnMemo.entries()].reverse()) {
    if (!k.startsWith(prefix) || !fr.length) continue;
    const xs = fr.map(f => f * W);
    const explains = weak.every(w => xs.some(x => Math.abs(x - w) < 0.02 * W)) && xs.every(x => cands.some(c => Math.abs(c - x) < 0.03 * W));
    if (explains) {
      saveColumnMemo(key, fr);
      return xs;
    }
  }

  try {
    const ans = await advisor.detectColumns(thumbnail(canvas), signal);
    if (!ans || !Number.isFinite(ans.columns)) return undefined;
    let gutters: number[];
    if (ans.columns <= 1) {
      gutters = strong; // AI nói 1 cột → chỉ bỏ các khe yếu; khe có bằng chứng rõ trên lớp chữ luôn được giữ
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
      for (const x of strong) if (!gutters.some(g => Math.abs(g - x) < 0.03 * W)) gutters.push(x); // không bao giờ bỏ khe chắc chắn
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
  /** Trang trắng / không có chữ: ảnh trang gốc, không cảnh báo. */
  blank?: boolean;
  /** v9.5: trang có hình nhưng AI không tìm thấy chữ (đã thử 2 lần) → giữ trang gốc, hiện ghi chú nhẹ, cho dịch lại */
  noText?: boolean;
  /** v9.4: lớp chữ ẩn (đơn vị point, y tính từ mép trên) → PDF xuất ra tìm kiếm / sao chép được. */
  textLayer?: { x: number; y: number; w: number; s: number; t: string }[];
  createdAt: number;
  pairs?: LayoutPair[]; // dữ liệu bản dịch để lưu đám mây / dựng lại ảnh
}

// v9.4: 2100 px ≈ 270–300 dpi với khổ sách 7–7,7 inch (trước 1700 px ≈ 220 dpi, in kém nét)
const TARGET_WIDTH_PX = 2100;
const JPEG_QUALITY = 0.86; // độ phân giải cao hơn → nén nhẹ hơn một chút để dung lượng PDF không tăng vọt

/* ------------------------------------------------------------------ */
/* Font                                                                */
/* ------------------------------------------------------------------ */

let fontsReady: Promise<void> | null = null;
let fontAttempts = 0;
/**
 * Nạp font Tinos/Arimo (kèm bộ chữ tiếng Việt + ký hiệu) trước khi vẽ.
 * Lỗi trước đây: mạng chậm > 4 giây → hết giờ chờ nhưng vẫn coi là "đã nạp" suốt phiên → các trang dịch sau đó bị vẽ
 * bằng font dự phòng (chữ to nhỏ, khác dáng) và ảnh lỗi bị lưu vĩnh viễn vào đệm. Nay chỉ ghi nhớ khi font đã sẵn sàng
 * thật; chưa sẵn sàng thì lần vẽ sau chờ tiếp.
 */
export function ensureLayoutFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  const specs = [
    '400 20px "Tinos"', '700 20px "Tinos"', 'italic 400 20px "Tinos"', 'italic 700 20px "Tinos"',
    '400 20px "Arimo"', '700 20px "Arimo"', 'italic 400 20px "Arimo"', 'italic 700 20px "Arimo"',
  ];
  const sample = 'Tiếng Việt ắằẳẵặ ếềểễệ ốồổỗộ ướừửữự µ ± ≤ ≥ × → ° –';
  const attempt = (async () => {
    if (typeof document === 'undefined' || !(document as any).fonts) return;
    const fonts = (document as any).fonts;
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 8000));
    await Promise.race([
      Promise.all(specs.map(s => fonts.load(s, sample).catch(() => null))).then(() => undefined),
      timeout,
    ]);
    let ok = true;
    try { ok = specs.every(s => fonts.check(s, sample)); } catch { ok = true; }
    // Thử tối đa 3 lần (mạng chặn hẳn Google Fonts thì không bắt mỗi trang chờ mãi)
    if (!ok && ++fontAttempts < 3) {
      console.warn('[Layout] Font Tinos/Arimo chưa tải xong — lần vẽ sau sẽ chờ tiếp.');
      fontsReady = null;
    }
  })();
  fontsReady = attempt;
  return attempt;
}

/* ------------------------------------------------------------------ */
/* Đọc trang                                                           */
/* ------------------------------------------------------------------ */

const KNOWN_SANS_RE = /sans|arial|helvet|avenir|myriad|frutiger|univers|futura|gill|segoe|calibri|verdana|tahoma|lato|roboto|gotham|\bdin|optima|franklin|trebuchet|gothic|corbel|candara|syntax|rotis|interstate|akzidenz|grotesk|grotesque|montserrat|nunito|raleway|poppins|inter\b|ubuntu|fira|noto ?sans|source ?sans|pt ?sans|lucida ?sans|myriadpro|officina|thesans|meta(?:plus|pro|normal|bold)?\b/i;

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
      // pdf.js đoán "serif" theo cờ font, nhiều font không chân (Avenir, Myriad, Frutiger…) bị gắn nhầm → loại trừ theo tên
      serif: nameLooksSerif || (family === 'serif' && !KNOWN_SANS_RE.test(name)),
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

/* ------------------------------------------------------------------ */
/* Điều phối CPU / huỷ                                                 */
/* ------------------------------------------------------------------ */

const abortError = () => new Error('Translation aborted');
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) throw abortError(); }
/** Nhường luồng chính cho trình duyệt vẽ giao diện / nhận thao tác (chống đơ khi dịch nhiều trang). */
const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0));

/**
 * Khoá CPU: phần nặng (vẽ trang, đọc điểm ảnh, dàn chữ) chạy LẦN LƯỢT từng trang, trong khi phần gọi AI của
 * các trang khác vẫn chạy song song. Trước đây 2–3 trang cùng vẽ/đọc điểm ảnh một lúc → đơ máy, trình xem PDF
 * bên trái bị nghẽn (dùng chung worker pdf.js).
 */
let cpuChain: Promise<void> = Promise.resolve();
async function withCpu<T>(fn: () => Promise<T> | T, signal?: AbortSignal): Promise<T> {
  const prev = cpuChain;
  let release!: () => void;
  cpuChain = new Promise<void>(r => { release = r; });
  try {
    await prev;
    checkAbort(signal);
    await yieldToUI();
    checkAbort(signal);
    return await fn();
  } finally {
    release();
  }
}

/** Vẽ trang bằng pdf.js, huỷ ngay khi bấm Dừng. */
async function renderPage(page: any, ctx: CanvasRenderingContext2D, viewport: any, signal?: AbortSignal) {
  checkAbort(signal);
  const task = page.render({ canvasContext: ctx, viewport });
  const onAbort = () => { try { task.cancel(); } catch { /* ignore */ } };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await task.promise;
  } catch (e) {
    if (signal?.aborted) throw abortError();
    throw e;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Giải phóng bộ nhớ của trang đã phân tích (canvas 1700px ≈ 15 MB mỗi cái). */
function releaseAnalyzed(a: { canvas?: HTMLCanvasElement; page?: any } | null | undefined) {
  if (!a) return;
  try { if (a.canvas) { a.canvas.width = 0; a.canvas.height = 0; } } catch { /* ignore */ }
  try { a.page?.cleanup?.(); } catch { /* ignore */ }
}

/** Phần nặng CPU: vẽ trang, đọc lớp chữ, lấy màu/cỡ chữ thật. */
async function rasterizePage(pdfDoc: PDFDocumentProxy, pageNumber: number, signal?: AbortSignal) {
  const page: any = await pdfDoc.getPage(pageNumber);
  checkAbort(signal);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(3, Math.max(1.5, TARGET_WIDTH_PX / base.width));
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const textContent = await page.getTextContent();
    checkAbort(signal);
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

    await renderPage(page, ctx, viewport, signal);
    await yieldToUI();
    checkAbort(signal);

    const ops = scanned ? { regions: [], vector: false } : await findImageRegions(page, viewport, canvas.width, canvas.height);
    const figures = ops.regions;

    // Bản vẽ trang KHÔNG có chữ (bỏ lệnh vẽ chữ) → nền thật dưới chữ: dùng để xoá chữ gốc mà vẫn giữ nguyên ảnh,
    // khung viền, đường kẻ bảng, nền màu, và để lấy đúng màu chữ trên nền ảnh/gradient.
    // Chỉ vẽ khi trang có hình / đường kẻ / mảng màu (trang chữ thuần trên nền trắng không cần → nhanh gấp đôi).
    let clean: ImageData | null = null;
    if (!scanned && (figures.length > 0 || ops.vector)) {
      const bgCanvas = document.createElement('canvas');
      bgCanvas.width = canvas.width;
      bgCanvas.height = canvas.height;
      try {
        const bctx = bgCanvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
        bctx.fillStyle = '#ffffff';
        bctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
        const noop = () => { /* bỏ vẽ chữ */ };
        (bctx as any).fillText = noop;
        (bctx as any).strokeText = noop;
        await renderPage(page, bctx, viewport, signal);
        clean = bctx.getImageData(0, 0, bgCanvas.width, bgCanvas.height);
      } catch (e) {
        if (signal?.aborted) throw e;
        clean = null;
      } finally {
        bgCanvas.width = 0; bgCanvas.height = 0;
      }
      await yieldToUI();
      checkAbort(signal);
    }

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let items = normalizeItems(rawItems, viewport.transform, styleResolver(page, textContent.styles));
    // v9.6: chữ xoay 90° trong lớp chữ (tab dọc "MAMMOGRAPHY") → khối riêng, dịch và vẽ lại dọc đúng chỗ
    const rotBlocks = !scanned && rotatedLetters >= 3 ? rotatedBlocksFromItems(rawItems, viewport.transform, styleResolver(page, textContent.styles)) : [];
    // Lớp chữ hỏng bảng mã vẫn cho đúng VỊ TRÍ, CỠ CHỮ, FONT (có chân/không chân, đậm, nghiêng), MÀU
    // → giữ lại để định dạng các khối OCR chuẩn như bản gốc.
    if (items.length) items = annotateItemColors(ctx, items, clean, img);
    return { page, canvas, ctx, scanned, widthPt: base.width, heightPt: base.height, figures, rotatedLetters, clean, items, img, rotBlocks };
  } catch (e) {
    releaseAnalyzed({ canvas, page });
    throw e;
  }
}

export async function analyzePage(
  pdfDoc: PDFDocumentProxy, pageNumber: number, advisor?: LayoutBlockTranslator, signal?: AbortSignal,
) {
  const r = await withCpu(() => rasterizePage(pdfDoc, pageNumber, signal), signal);
  try {
    // Hỏi AI số cột (nếu cần) nằm NGOÀI khoá CPU để trang khác vẫn xử lý được trong lúc chờ mạng
    const gutters = r.scanned ? undefined : await resolveGutters(pdfDoc, pageNumber, r.canvas, r.items, advisor, signal);
    checkAbort(signal);
    const blocks: LayoutBlock[] = r.scanned ? [] : [...buildBlocks(r.items, r.canvas.width, r.canvas.height, gutters), ...r.rotBlocks];
    return { ...r, blocks };
  } catch (e) {
    releaseAnalyzed(r);
    throw e;
  }
}

/**
 * Vị trí các ảnh raster vẽ trên trang (toạ độ canvas), đọc từ danh sách lệnh vẽ của pdf.js.
 * Bỏ ảnh quá nhỏ (biểu tượng) và ảnh phủ gần hết trang (nền).
 */
async function findImageRegions(page: any, viewport: any, W: number, H: number): Promise<{ regions: { x0: number; y0: number; x1: number; y1: number }[]; vector: boolean }> {
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
    // Có hình vẽ vector (đường kẻ bảng, khung, mảng màu nền) → cần bản vẽ "không chữ" để xoá chữ mà giữ nền
    const vectorOps = new Set([OPS.stroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeStroke,
      OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.shadingFill].filter(v => v !== undefined));
    let vectorCount = 0;
    const imageOps = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageXObjectRepeat, (OPS as any).paintJpegXObject].filter(v => v !== undefined));
    for (let i = 0; i < fn.length; i++) {
      const op = fn[i];
      if (op === OPS.save) stack.push(ctm);
      else if (op === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (op === OPS.transform) ctm = mulM(ctm, args[i]);
      else if (op === OPS.paintFormXObjectBegin) { stack.push(ctm); if (Array.isArray(args[i]?.[0]) && args[i][0].length === 6) ctm = mulM(ctm, args[i][0]); }
      else if (op === OPS.paintFormXObjectEnd) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
      else if (vectorOps.has(op)) vectorCount++;
      else if (imageOps.has(op)) {
        const m = mulM(viewport.transform, ctm);
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
        const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
        const r = { x0: Math.max(0, Math.min(...xs)), y0: Math.max(0, Math.min(...ys)), x1: Math.min(W, Math.max(...xs)), y1: Math.min(H, Math.max(...ys)) };
        const area = (r.x1 - r.x0) * (r.y1 - r.y0);
        if (area >= 0.01 * W * H && area <= 0.85 * W * H && r.x1 - r.x0 > 0.06 * W && r.y1 - r.y0 > 0.04 * H) out.push(r);
      }
    }
    return { regions: out, vector: vectorCount > 0 };
  } catch {
    return { regions: [], vector: true };
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
  const blocks = blocksFromOcr(analyzed.ctx, refineOcrBoxes(analyzed.ctx, ocr), 'b', analyzed.items);
  return { ...analyzed, blocks, scanned: false };
}

/**
 * Thêm khối OCR (chữ trong ảnh / chữ xoay) vào trang có lớp chữ.
 * Bỏ khối trùng với chữ đã có trong lớp chữ (AI đôi khi trả cả chữ thường).
 */
function addExtraOcr(analyzed: Analyzed, extra: OcrBlock[]): { analyzed: Analyzed; kept: OcrBlock[] } {
  const cand = blocksFromOcr(analyzed.ctx, extra, 'o', analyzed.items);
  const keptIdx = new Set<number>();
  const blocks = [...analyzed.blocks];
  // So khớp theo NỘI DUNG: AI hay trả lại cả chữ thường của trang (tiêu đề, phụ đề trên ảnh bìa) với khung lệch chỗ
  // → trước đây không trùng vị trí nên bị vẽ thêm lần nữa (vd. phụ đề bìa xếp dọc từng chữ ở đầu trang)
  const norm = (t: string) => (t.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).join(' ');
  const layerTexts = analyzed.blocks.filter(t => !t.fromOcr).map(t => norm(t.plain)).filter(t => t.length >= 3);
  const layerAll = ' ' + layerTexts.join(' ') + ' ';
  // v9.8: cỡ chữ nhãn trong hình KHÔNG được lớn hơn chữ gốc. Cỡ ước theo chiều cao khung AI dễ phóng to (chữ viết
  // chéo "FAST TRACK" → khung vuông lớn → "ĐƯỜNG NHANH" khổng lồ đè lên hình). Ước thêm cỡ theo chiều rộng khung và số
  // ký tự; khung cao bất thường so với độ dài chữ (chữ chéo / khung sai) → giữ nguyên bản gốc, không xoá-vẽ.
  const bodySizes = analyzed.blocks.filter(t => !t.fromOcr && t.translatable && t.lineCount >= 2).map(t => t.size).sort((a, b) => a - b);
  const bodySize = bodySizes.length ? bodySizes[Math.floor(bodySizes.length / 2)] : 0;
  const sized: LayoutBlock[] = [];
  const W = analyzed.canvas.width, H = analyzed.canvas.height;
  for (let b of cand) {
    if (b.rotate) { sized.push(b); continue; }
    // Trên ảnh/hình vẽ, việc dò mực để chỉnh khung hay sai (khung phình ra cả hình, hoặc co còn cỡ chữ 5px) →
    // khung ước theo mực không khớp khung AI thì dùng khung AI.
    const o = b.srcIndex !== undefined ? extra[b.srcIndex] : undefined;
    if (o?.box_2d) {
      const [y0, x0, y1, x1] = o.box_2d;
      const bx0 = x0 / 1000 * W, bx1 = x1 / 1000 * W, by0 = y0 / 1000 * H, by1 = y1 / 1000 * H;
      const nL0 = Math.max(1, o.lines || 1);
      const sizeH = (by1 - by0) / nL0 / 1.15;
      const tol = 0.25 * (by1 - by0) + 4;
      const inside = b.x0 >= bx0 - tol && b.x1 <= bx1 + tol && b.top >= by0 - tol && b.bottom <= by1 + tol;
      if (!inside || b.size < 0.5 * sizeH || b.size > 1.25 * sizeH) {
        b = { ...b, x0: bx0, x1: bx1, top: by0, bottom: by1, size: sizeH, leading: 1.15 * sizeH, lineCount: nL0, firstOffset: 0, restOffset: 0 };
      }
    }
    b = { ...b, figLabel: true };
    const lines = b.plain.split(/\n/).length > 1 ? b.plain.split(/\n/) : [b.plain];
    const nL = Math.max(1, b.lineCount || lines.length);
    const chars = Math.max(1, Math.ceil(b.plain.replace(/\s+/g, ' ').trim().length / nL));
    const capsShare = (b.plain.match(/\p{Lu}/gu) || []).length / Math.max(1, (b.plain.match(/\p{L}/gu) || []).length);
    const sizeW = (b.x1 - b.x0) / (chars * (capsShare > 0.6 ? 0.68 : 0.52));
    const boxH = b.bottom - b.top;
    if (boxH > 2.6 * nL * Math.max(sizeW, 4) && chars >= 4) continue; // chữ chéo / khung sai → giữ bản gốc
    let size = Math.min(b.size, 1.1 * sizeW);
    if (bodySize > 0) size = Math.min(size, 1.15 * bodySize);
    sized.push(size < b.size ? { ...b, size, leading: b.leading * (size / b.size) } : b);
  }
  const labelSizes = sized.filter(b => !b.rotate).map(b => b.size).sort((a, b) => a - b);
  const labelMed = labelSizes.length >= 3 ? labelSizes[Math.floor(labelSizes.length / 2)] : 0;
  cand.length = 0;
  for (const b of sized) cand.push(labelMed && !b.rotate && b.size > 1.35 * labelMed ? { ...b, size: 1.35 * labelMed, leading: b.leading * (1.35 * labelMed / b.size) } : b);
  cand.forEach(b => {
    const area = Math.max(1, (b.x1 - b.x0) * (b.bottom - b.top));
    // Chồng lên khối chữ thường HOẶC nhãn trong hình đã nhận (trước đây chỉ so với chữ thường → hai nhãn đè nhau)
    const overlap = blocks.some(t => {
      const ix = Math.min(t.x1, b.x1) - Math.max(t.x0, b.x0), iy = Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top);
      return ix > 0 && iy > 0 && (ix * iy) / area > 0.3;
    });
    if (overlap) return;
    // Chữ trong hình không thể chồng lên khối chữ thường của trang: khung lấn vào chữ thường = AI đoán sai vị trí → bỏ
    const intrudes = analyzed.blocks.some(t => {
      if (t.fromOcr || !t.translatable) return false;
      const ix = Math.min(t.x1, b.x1) - Math.max(t.x0, b.x0), iy = Math.min(t.bottom, b.bottom) - Math.max(t.top, b.top);
      return ix > 0.5 * t.size && iy > 0.5 * t.size;
    });
    if (intrudes) return;
    const nt = norm(b.plain);
    if (nt.length >= 4 && (layerAll.includes(' ' + nt + ' ') || layerTexts.some(t => nt.includes(t) && t.length > 0.6 * nt.length))) return;
    // Khung vô lý: chữ nhiều từ mà khung hẹp hơn ~3 cỡ chữ (chữ ngang) → AI đoán sai vị trí, bỏ
    const words = b.plain.trim().split(/\s+/).length;
    if (!b.rotate && words >= 3 && b.x1 - b.x0 < 3 * b.size) return;
    blocks.push(b);
    const k = extra.findIndex((o, i) => !keptIdx.has(i) && o.text.replace(/\s+/g, ' ').trim() === b.text);
    if (k >= 0) keptIdx.add(k);
  });
  return { analyzed: { ...analyzed, blocks }, kept: extra.filter((_, i) => keptIdx.has(i)) };
}

/** Bản dịch AI trả kèm khối OCR (bỏ phần "…… 123" của dòng mục lục, vì dấu chấm dẫn & số trang được vẽ riêng). */
function ocrTranslation(ocr: OcrBlock[], b: LayoutBlock): string | undefined {
  const o = b.srcIndex !== undefined ? ocr[b.srcIndex] : undefined;
  let v = o?.v?.trim();
  if (!v) return undefined;
  if (b.leader) v = v.replace(/\s*(?:[.·…]\s*){3,}\s*(\d{1,4}|[ivxlcdm]{1,6})?\s*$/i, '').trim();
  return v || undefined;
}

const OCR_FIGURES_KEY = 'meditrans_layout_ocr_figures';
/** Có dịch chữ nằm trong hình / chữ xoay dọc không (chậm, tốn token). Mặc định: không. */
export function getLayoutOcrFigures(): boolean {
  try { return localStorage.getItem(OCR_FIGURES_KEY) === '1'; } catch { return false; }
}
export function setLayoutOcrFigures(on: boolean) {
  try { localStorage.setItem(OCR_FIGURES_KEY, on ? '1' : '0'); } catch { /* ignore */ }
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
  signal?: AbortSignal,
): Promise<LayoutPageResult> {
  try {
    return await withCpu(async () => {
      const { canvas, ctx, blocks, scanned, widthPt, heightPt } = analyzed;
      let report: PaintReport = { painted: 0, overflowIds: [], shrunkIds: [] };
      const pairs: LayoutPair[] = [];
      if (ocr?.length) pairs.push({ s: OCR_PAIR_KEY, v: JSON.stringify(slimOcr(ocr)) });
      if (extraOcr?.length) pairs.push({ s: OCR_EXTRA_KEY, v: JSON.stringify(slimOcr(extraOcr)) });
      if (!scanned) {
        report = paintTranslatedPage(ctx, blocks, translations, analyzed.clean, analyzed.img);
        const seen = new Set<string>();
        for (const b of blocks) {
          const v = translations[b.id];
          const key = normKey(b.text);
          if (!b.translatable || !v || seen.has(key)) continue;
          seen.add(key);
          pairs.push({ s: key, v: normKey(v) });
        }
      }
      await yieldToUI();
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error('Không tạo được ảnh trang'))), 'image/jpeg', JPEG_QUALITY),
      );
      return {
        pageNumber,
        blob,
        widthPt,
        heightPt,
        overflowCount: report.overflowIds.length,
        shrunkCount: report.shrunkIds.length,
        blockCount: blocks.filter(b => b.translatable).length,
        textLayer: (() => {
          const k = widthPt / canvas.width;
          return (report.textRuns || []).map(r => ({
            x: +(r.x * k).toFixed(2), y: +(r.y * k).toFixed(2), w: +(r.w * k).toFixed(2), s: +(r.size * k).toFixed(2), t: r.text,
          }));
        })(),
        scanned,
        createdAt: Date.now(),
        pairs,
        ocr: !!ocr?.length || !!extraOcr?.length,
      };
    }, signal);
  } finally {
    releaseAnalyzed(analyzed);
  }
}

/**
 * Tiêu đề mục thông dụng → dịch ngay trên máy (không tốn token, không bao giờ sót).
 * Lỗi trước đây: AI hiểu quy tắc "giữ nguyên tài liệu tham khảo" áp dụng cả cho TIÊU ĐỀ "References" → để nguyên
 * tiếng Anh; bước dịch bù chỉ bắt khối ≥ 4 từ nên tiêu đề 1 từ lọt qua.
 */
const HEADING_VI: Record<string, string> = {
  'references': 'Tài liệu tham khảo', 'reference': 'Tài liệu tham khảo', 'bibliography': 'Tài liệu tham khảo',
  'selected references': 'Tài liệu tham khảo chọn lọc', 'suggested reading': 'Tài liệu đọc thêm',
  'suggested readings': 'Tài liệu đọc thêm', 'further reading': 'Tài liệu đọc thêm', 'further readings': 'Tài liệu đọc thêm',
  'recommended reading': 'Tài liệu đọc thêm', 'references and further reading': 'Tài liệu tham khảo và đọc thêm',
  'conclusion': 'Kết luận', 'conclusions': 'Kết luận', 'summary': 'Tóm tắt', 'abstract': 'Tóm tắt',
  'introduction': 'Giới thiệu', 'background': 'Bối cảnh', 'discussion': 'Bàn luận', 'results': 'Kết quả',
  'methods': 'Phương pháp', 'materials and methods': 'Vật liệu và phương pháp', 'contents': 'Mục lục',
  'table of contents': 'Mục lục', 'preface': 'Lời nói đầu', 'foreword': 'Lời tựa', 'acknowledgments': 'Lời cảm ơn',
  'acknowledgements': 'Lời cảm ơn', 'index': 'Chỉ mục', 'subject index': 'Chỉ mục', 'glossary': 'Thuật ngữ',
  'abbreviations': 'Chữ viết tắt', 'key points': 'Điểm chính', 'learning objectives': 'Mục tiêu học tập',
  'objectives': 'Mục tiêu', 'case report': 'Báo cáo ca bệnh', 'case reports': 'Báo cáo ca bệnh', 'appendix': 'Phụ lục',
  'contributors': 'Danh sách tác giả', 'technique': 'Kỹ thuật', 'diagnosis': 'Chẩn đoán', 'treatment': 'Điều trị',
  'pitfalls': 'Cạm bẫy', 'pearls': 'Kinh nghiệm', 'pearls and pitfalls': 'Kinh nghiệm và cạm bẫy',
};
/** Bản dịch trên máy cho tiêu đề mục thông dụng (giữ VIẾT HOA nếu bản gốc viết hoa). */
export function localHeading(text: string): string | undefined {
  const t = text.replace(/<\/?\d+>/g, '').replace(/\s+/g, ' ').trim().replace(/[:.]$/, '').trim();
  const v = HEADING_VI[t.toLowerCase()];
  if (!v) return undefined;
  return t === t.toUpperCase() && /[A-Z]/.test(t) ? v.toUpperCase() : v;
}

/** Từ tiếng Anh thông dụng: khối ngắn (1–3 từ) chỉ gồm các từ này mà AI trả nguyên văn → coi là sót. */
const COMMON_EN = new Set(('the and of with for in on to by from or not see also figure table chapter section part case ' +
  'cases patient patients normal abnormal benign malignant left right upper lower anterior posterior lateral medial ' +
  'breast liver kidney heart lung brain bone image images imaging view views anatomy technique techniques findings ' +
  'diagnosis treatment introduction conclusion conclusions summary references reference discussion results methods ' +
  'background overview definition definitions history advantages disadvantages limitations indications ' +
  'contraindications complications examination examples example features feature type types appearance ' +
  'management follow up note notes key points general principles clinical differential lesion lesions mass masses ' +
  'cyst cysts tumor tumors cancer disease diseases signs sign symptoms pathology physiology development').split(' '));

/** Bản dịch trùng nguyên văn câu gốc tiếng Anh (AI bỏ quên) — không tính tên riêng, số, tài liệu tham khảo. */
function isUntranslated(src: string, v: string): boolean {
  const plain = (t: string) => t.replace(/<\/?\d+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const a = plain(src);
  if (a !== plain(v)) return false;
  const words = a.match(/[a-z]{2,}/g) || [];
  if (words.length === 0) return false;
  // Khối ngắn (tiêu đề 1–3 từ): sót nếu toàn là từ tiếng Anh thông dụng (tên riêng, thuốc, viết tắt không bị bắt)
  if (words.length < 4) return words.every(w => COMMON_EN.has(w)) && words.some(w => w.length >= 4);
  if (/\bet al\.|\bdoi\b|\b(19|20)\d{2}[;:,]\s*\d/.test(a)) return false;
  const stop = words.filter(w => /^(the|and|of|with|is|are|was|were|for|in|on|to|by|from|as|or|that|this|which|be|may|can|not|has|have)$/.test(w)).length;
  return stop >= 2;
}

/**
 * Dịch danh sách khối: các phần (chunk) của một trang gửi SONG SONG; khối AI bỏ sót được dịch bù một lần
 * (trước đây khối bị sót giữ nguyên tiếng Anh).
 */
async function translateBlocks(
  translator: LayoutBlockTranslator, blocks: LayoutBlock[], signal?: AbortSignal,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!blocks.length) return out;
  // Tiêu đề mục thông dụng (References, Conclusions…) dịch ngay trên máy, không gửi AI
  const local: Record<string, string> = {};
  let inRefs = false;
  for (const b of blocks) {
    const h = localHeading(b.text);
    if (h) { local[b.id] = h; inRefs = /tham khảo|đọc thêm/i.test(h); continue; }
    // v9.4: mục TÀI LIỆU THAM KHẢO giữ nguyên bản gốc (chuẩn trích dẫn) — không gửi AI, không dịch nửa vời
    if (isReferenceBlock(b.plain, inRefs)) { local[b.id] = b.text; continue; }
    // v9.4: bộ nhớ dịch — chuỗi lặp lại (tiêu đề đầu trang, tên sách, tên mục) dùng lại đúng bản dịch đã có
    const tm = tmGet(b.text);
    if (tm) { local[b.id] = tm; continue; }
    // v9.6: khối chỉ là một thuật ngữ trong bảng ("MAMMOGRAPHY" ở tab dọc) → dịch trên máy theo bảng thuật ngữ
    const g = glossaryExact(b.text);
    if (g) local[b.id] = g;
  }
  blocks = blocks.filter(b => !local[b.id]);
  if (!blocks.length) return local;
  Object.assign(out, local);
  // Phần ~3500 ký tự (ít lặp hướng dẫn hệ thống → ít token) gửi song song tối đa 3 phần: thời gian chờ AI ≈ phần dài nhất thay vì cả trang
  // (AI viết ra càng dài càng lâu; một trang chữ dày gửi một lần mất 20–40 giây)
  // v8.4: model nhanh không "suy nghĩ" (gpt-4.1-mini) → phần nhỏ hơn, 4 phần song song (≈ nhanh gấp đôi mỗi trang)
  const plan = (translator as any).layoutChunkPlan?.() || { chars: 3500, blocks: 40, parallel: 3 };
  const chunks = chunkBlocks(blocks, plan.blocks, plan.chars);
  const queue = [...chunks];
  let lastError: any = null;
  const runOne = async () => {
    while (queue.length) {
      checkAbort(signal);
      const chunk = queue.shift()!;
      try {
        Object.assign(out, await translator.translateLayoutBlocks(chunk.map(b => ({ id: b.id, text: b.text })), signal));
      } catch (e) {
        // Một phần lỗi (JSON hỏng / proxy bận nhiều lần) KHÔNG làm hỏng cả trang như trước: các phần khác vẫn giữ,
        // khối của phần lỗi sẽ được dịch bù ở bước dưới.
        if (signal?.aborted || /aborted|level 2|đăng nhập|api key|key khả dụng/i.test(String((e as any)?.message))) throw e;
        lastError = e;
        console.warn('[Layout] Một phần dịch lỗi, sẽ dịch bù:', e);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(plan.parallel, chunks.length) }, runOne));
  checkAbort(signal);
  // Khối AI bỏ sót HOẶC trả nguyên văn tiếng Anh (thỉnh thoảng xảy ra) → dịch bù một lần
  const missing = blocks.filter(b => !out[b.id] || isUntranslated(b.text, out[b.id]));
  if (missing.length) {
    try {
      const again = await Promise.all(chunkBlocks(missing, plan.blocks, plan.chars).map(chunk =>
        translator.translateLayoutBlocks(chunk.map(b => ({ id: b.id, text: b.text })), signal)));
      again.forEach(r => {
        for (const [id, v] of Object.entries(r)) {
          const b = missing.find(x => x.id === id);
          if (!out[id] || (b && !isUntranslated(b.text, v))) out[id] = v;
        }
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      console.warn('[Layout] Dịch bù khối bị sót thất bại:', e);
    }
  }
  // Không dịch được khối nào → báo lỗi thật (trước đây trang vẫn được lưu như "đã dịch" nhưng toàn chữ gốc)
  if (Object.keys(out).length === Object.keys(local).length) throw lastError || new Error('AI không trả về bản dịch nào cho trang này.');
  // Ghi nhớ bản dịch của các chuỗi ngắn (tiêu đề, đầu trang) để các trang sau dùng lại y hệt
  for (const b of blocks) { const v = out[b.id]; if (v && !isUntranslated(b.text, v)) tmPut(b, v); }
  tmSave();
  return out;
}

/** Kết quả trang trắng: giữ ảnh gốc, không cảnh báo "trang scan", lưu dấu để mở lại không gọi AI. */
function blankResult(r: LayoutPageResult): LayoutPageResult {
  return { ...r, scanned: false, blank: true, blockCount: 0, overflowCount: 0, shrunkCount: 0, pairs: [{ s: BLANK_PAIR_KEY, v: '1' }] };
}

function noTextResult(r: LayoutPageResult): LayoutPageResult {
  return { ...r, scanned: false, blank: true, noText: true, blockCount: 0, overflowCount: 0, shrunkCount: 0, pairs: [{ s: NOTEXT_PAIR_KEY, v: '1' }] };
}

/**
 * v9.5: AI đôi khi trả khung theo PIXEL của ảnh gửi đi (vd. 0–1600) thay vì thang 0–1000 → chữ bị đặt sai chỗ / bị bỏ.
 * Nếu có toạ độ vượt 1000 → quy đổi theo kích thước ảnh OCR.
 */
function normalizeOcrBoxes(ocr: OcrBlock[], canvas: HTMLCanvasElement): OcrBlock[] {
  const k = Math.min(1, 1600 / canvas.width);
  const w = Math.round(canvas.width * k), h = Math.round(canvas.height * k);
  const max = Math.max(0, ...ocr.flatMap(o => (o.box_2d || []).map(Number).filter(Number.isFinite)));
  if (max <= 1000.5) return ocr;
  return ocr.map(o => {
    const [y0, x0, y1, x1] = o.box_2d.map(Number);
    return { ...o, box_2d: [y0 / h * 1000, x0 / w * 1000, y1 / h * 1000, x1 / w * 1000].map(v => Math.max(0, Math.min(1000, Math.round(v)))) };
  });
}

/** Tỉ lệ điểm ảnh tối của trang (để phân biệt trang trắng với trang có hình/chữ). */
function inkRatio(canvas: HTMLCanvasElement): number {
  try {
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
    if (!ctx || !w || !h) return 0;
    const { data } = ctx.getImageData(0, 0, w, h);
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250000)));
    let dark = 0, total = 0;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      if (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2] < 200) dark++;
      total++;
    }
    return total ? dark / total : 0;
  } catch { return 0; }
}

/** Trang gần như trắng hoàn toàn (ít hơn 0,3% điểm ảnh tối) → không có gì để OCR / dịch. */
function isBlankCanvas(canvas: HTMLCanvasElement): boolean {
  try {
    const w = canvas.width, h = canvas.height;
    if (!w || !h) return true;
    const ctx = canvas.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
    if (!ctx) return false;
    const { data } = ctx.getImageData(0, 0, w, h);
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 250000))); // lấy mẫu ~250k điểm
    let dark = 0, total = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4;
        const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (lum < 200) dark++;
        total++;
      }
    }
    return total > 0 && dark / total < 0.003;
  } catch {
    return false;
  }
}

/* ---------------- v9.4: tài liệu tham khảo & bộ nhớ dịch ---------------- */

/**
 * Khối là mục tài liệu tham khảo? (tác giả + năm + dấu hiệu trích dẫn; hoặc nằm sau tiêu đề "References" và có năm /
 * DOI / đường link). Giữ nguyên bản gốc theo chuẩn trích dẫn.
 */
export function isReferenceBlock(plain: string, afterRefHeading: boolean): boolean {
  const t = (plain || '').replace(/\s+/g, ' ').trim();
  if (t.length < 12) return false;
  if (isReferenceLine(t)) return true;
  if (!afterRefHeading) return false;
  if (/\bdoi\b|https?:\/\/|www\./i.test(t)) return true;
  return /\b(19|20)\d{2}[a-z]?\b/.test(t) && /^(\[?\d{1,3}[.)\]]?\s+)?[A-ZÀ-Ý][\p{L}'’-]+,?\s+[A-Z]/u.test(t);
}

const TM_KEY = 'mediTrans_layoutTM';
const TM_MAX = 4000;
let tm: Map<string, string> | null = null;
let tmDirty = false;
const tmNorm = (t: string) => t.replace(/\s+/g, ' ').trim();
function tmLoad(): Map<string, string> {
  if (tm) return tm;
  try { tm = new Map(JSON.parse(localStorage.getItem(TM_KEY) || '[]')); } catch { tm = new Map(); }
  return tm!;
}
/** Chuỗi được ghi nhớ: ngắn (≤ 160 ký tự, ≤ 2 dòng), có chữ cái, không phải câu dài. */
function tmEligible(b: LayoutBlock): boolean {
  const t = tmNorm(b.text);
  return t.length >= 3 && t.length <= 160 && b.lineCount <= 2 && /\p{L}{3}/u.test(t) && t.split(' ').length <= 20;
}
function tmGet(text: string): string | undefined {
  const t = tmNorm(text);
  if (t.length > 160) return undefined;
  return tmLoad().get(t);
}
function tmPut(b: LayoutBlock, v: string) {
  if (!tmEligible(b)) return;
  const m = tmLoad(), k = tmNorm(b.text);
  if (m.get(k) === v) return;
  m.delete(k); m.set(k, v); tmDirty = true;
  while (m.size > TM_MAX) m.delete(m.keys().next().value as string);
}
function tmSave() {
  if (!tmDirty || !tm) return;
  tmDirty = false;
  try { localStorage.setItem(TM_KEY, JSON.stringify([...tm])); } catch { /* đầy bộ nhớ → bỏ qua */ }
}
/** Người dùng sửa bản dịch một khối → cập nhật bộ nhớ dịch để các trang sau theo bản sửa. */
export function rememberLayoutTranslation(b: LayoutBlock, v: string) { tmPut(b, v); tmSave(); }
/** Xoá bộ nhớ dịch (Cài đặt). */
export function clearLayoutTranslationMemory() { tm = new Map(); try { localStorage.removeItem(TM_KEY); } catch { /* */ } }
export function layoutTranslationMemorySize(): number { return tmLoad().size; }

/** Dịch 1 trang bằng AI rồi vẽ lại giữ định dạng. */
export async function translatePageWithLayout(
  pdfDoc: PDFDocumentProxy,
  pageNumber: number,
  translator: LayoutBlockTranslator,
  signal?: AbortSignal,
  opts: { forceOcr?: boolean; ocrFigures?: boolean } = {},
): Promise<LayoutPageResult> {
  await ensureLayoutFonts();
  let analyzed = await analyzePage(pdfDoc, pageNumber, translator, signal);
  const ocrFigures = opts.ocrFigures ?? getLayoutOcrFigures();
  try {
    // Trang scan (không có lớp chữ) hoặc người dùng chọn OCR → AI đọc ảnh, nhận diện khối chữ và dịch luôn
    if ((analyzed.scanned || opts.forceOcr) && translator.ocrLayoutBlocks) {
      // Trang trắng / gần như không có chữ (trang lót, trang chỉ có ảnh) → không gọi AI, giữ nguyên trang gốc.
      // Trước đây AI trả về {"blocks":[]} → báo lỗi "OCR không trả về khối chữ hợp lệ" và trang bị đánh dấu lỗi.
      if (analyzed.scanned && isBlankCanvas(analyzed.canvas)) {
        return blankResult(await finishPage({ ...analyzed, blocks: [] }, pageNumber, {}, undefined, undefined, signal));
      }
      let ocr: OcrBlock[];
      try {
        ocr = normalizeOcrBoxes(await translator.ocrLayoutBlocks(ocrImage(analyzed.canvas), signal), analyzed.canvas);
      } catch (e: any) {
        // Bộ lọc nội dung của model chặn ảnh y khoa (ảnh vú, cơ thể) → thử lại với ảnh đã che hình
        if (signal?.aborted || !/safety|content.?(filter|policy|management)|blocked|prohibited|moderation|policy/i.test(String(e?.message))) throw e;
        console.warn(`[Layout] Trang ${pageNumber}: model chặn ảnh trang → che hình rồi đọc lại.`, e);
        ocr = [];
      }
      checkAbort(signal);
      // v9.5: trang scan có ảnh lớn + chú thích (vd. BI-RADS tr.28: 2 ảnh nhũ ảnh + "Figure 1 – Breast Density…" + tab dọc
      // "MAMMOGRAPHY") → AI đôi khi trả {"blocks":[]}. Trước đây bị coi là trang trắng và lưu lại vĩnh viễn → bản dịch
      // giống hệt bản gốc, nút dịch bị khoá. Nay: trang có mực → hỏi lại AI một lần, nhấn mạnh phải đọc chú thích.
      if (!ocr.length && inkRatio(analyzed.canvas) >= 0.003) {
        console.info(`[Layout] Trang ${pageNumber}: AI chưa thấy chữ trên trang có hình → đọc lại lần 2.`);
        // Lần 2: che các ảnh lớn (nhũ ảnh/siêu âm) — model hay bỏ qua hoặc bị bộ lọc chặn khi trang toàn ảnh y khoa
        const masked = maskPhotosCanvas(analyzed.canvas);
        try {
          ocr = normalizeOcrBoxes(await translator.ocrLayoutBlocks(ocrImage(masked || analyzed.canvas), signal, { mode: 'full', retryEmpty: true }), analyzed.canvas);
        } finally {
          if (masked) { masked.width = 0; masked.height = 0; }
        }
        checkAbort(signal);
      }
      if (!ocr.length) {
        // Vẫn không có chữ: trang chỉ có hình → giữ nguyên trang gốc, ghi chú nhẹ, vẫn cho dịch lại (không khoá như trang trắng)
        console.info(`[Layout] Trang ${pageNumber}: không có chữ để dịch → giữ nguyên trang gốc.`);
        return noTextResult(await finishPage({ ...analyzed, blocks: [], scanned: true }, pageNumber, {}, undefined, undefined, signal));
      }
      analyzed = applyOcr(analyzed, ocr);
      const translations: Record<string, string> = {};
      const missing: LayoutBlock[] = [];
      for (const b of analyzed.blocks) {
        const v = ocrTranslation(ocr, b);
        const g = glossaryExact(b.plain);
        // AI để nguyên tiếng Anh (thường gặp với chữ IN HOA / chữ dọc như "MAMMOGRAPHY") → bảng thuật ngữ hoặc dịch bù
        if (g && (!v || normKey(v).toLowerCase() === normKey(b.plain).toLowerCase())) translations[b.id] = g;
        else if (v && !(b.translatable && isUntranslated(b.text, v))) translations[b.id] = v;
        else if (b.translatable) missing.push(b);
      }
      Object.assign(translations, await translateBlocks(translator, missing, signal)); // khối AI quên dịch → dịch bù
      checkAbort(signal);
      return await finishPage(analyzed, pageNumber, translations, ocr, undefined, signal);
    }

    // Trang có lớp chữ nhưng có ẢNH (chữ trong hình) hoặc CHỮ XOAY → OCR bổ sung riêng các vùng đó.
    // Chạy SONG SONG với việc dịch chữ thường (trước đây chạy tuần tự → mỗi trang có hình chậm gấp đôi).
    // Mặc định TẮT: gửi ảnh trang 1600px cho AI đọc chữ trong hình mất 20–60 giây mỗi trang có hình, trong khi chữ
    // trong ảnh y khoa (thang đo, nhãn ST, L, R…) hầu như không cần dịch. Bật trong thanh công cụ khi cần.
    const needExtra = ocrFigures && !analyzed.scanned && !!translator.ocrLayoutBlocks && (analyzed.figures.length > 0 || analyzed.rotatedLetters >= 3);
    const W = analyzed.canvas.width, H = analyzed.canvas.height;
    const regions = analyzed.figures.map(f => [f.y0 / H, f.x0 / W, f.y1 / H, f.x1 / W].map(v => Math.round(v * 1000)));
    const extraPromise: Promise<OcrBlock[]> = needExtra
      ? translator.ocrLayoutBlocks!(ocrImage(analyzed.canvas), signal, { mode: 'extra', regions }).catch(e => {
        if (signal?.aborted) throw e;
        console.warn('[Layout] OCR chữ trong ảnh / chữ xoay lỗi, bỏ qua phần này:', e);
        return [];
      })
      : Promise.resolve([]);
    const textTargets = analyzed.scanned ? [] : analyzed.blocks.filter(b => b.translatable);
    const [textTr, extra] = await Promise.all([translateBlocks(translator, textTargets, signal), extraPromise]);
    checkAbort(signal);

    const translations: Record<string, string> = { ...textTr };
    let extraKept: OcrBlock[] | undefined;
    if (extra.length) {
      const inRegion = (o: OcrBlock) => {
        const [y0, x0, y1, x1] = o.box_2d, cy = (y0 + y1) / 2, cx = (x0 + x1) / 2;
        return regions.some(r => cy >= r[0] - 5 && cy <= r[2] + 5 && cx >= r[1] - 5 && cx <= r[3] + 5);
      };
      const wanted = extra.filter(o => o.dir === 'up' || o.dir === 'down' || inRegion(o));
      if (wanted.length) {
        const r = addExtraOcr(analyzed, wanted);
        analyzed = r.analyzed;
        extraKept = r.kept;
        for (const b of analyzed.blocks) if (b.fromOcr) { const v = ocrTranslation(wanted, b); if (v) translations[b.id] = v; }
      }
    }
    return await finishPage(analyzed, pageNumber, translations, undefined, extraKept, signal);
  } catch (e) {
    releaseAnalyzed(analyzed);
    throw e;
  }
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
  try {
    const parseOcr = (key: string): OcrBlock[] | undefined => {
      const e = pairs.find(p => p.s === key);
      if (!e) return undefined;
      try { const v = JSON.parse(e.v); return Array.isArray(v) && v.length ? v : undefined; } catch { return undefined; }
    };
    if (analyzed.scanned && isBlankCanvas(analyzed.canvas)) {
      return blankResult(await finishPage({ ...analyzed, blocks: [] }, pageNumber, {}, undefined, undefined, signal));
    }
    // v9.5: bản lưu cũ đánh dấu "trang trắng" / "không có chữ" cho trang thật ra có hình + chữ (lỗi AI trả rỗng)
    // → dịch lại trang bằng OCR (nếu có bộ dịch), không còn hiện bản gốc y nguyên mãi mãi.
    if (analyzed.scanned && pairs.some(p => p.s === BLANK_PAIR_KEY || p.s === NOTEXT_PAIR_KEY)) {
      const wasNoText = pairs.some(p => p.s === NOTEXT_PAIR_KEY);
      if (translator?.ocrLayoutBlocks && !wasNoText) {
        releaseAnalyzed(analyzed);
        const fresh = await translatePageWithLayout(pdfDoc, pageNumber, translator, signal);
        return { ...fresh, retranslated: Math.max(1, fresh.blockCount) };
      }
      return noTextResult(await finishPage({ ...analyzed, blocks: [] }, pageNumber, {}, undefined, undefined, signal));
    }
    const ocr = parseOcr(OCR_PAIR_KEY);
    let extraOcr = parseOcr(OCR_EXTRA_KEY);
    if (ocr) analyzed = applyOcr(analyzed, ocr);
    else if (extraOcr) { const r = addExtraOcr(analyzed, extraOcr); analyzed = r.analyzed; extraOcr = r.kept; }
    const lookup = new Map(pairs.filter(p => !isOcrKey(p.s)).map(p => [normKey(p.s), p.v]));
    // Bản lưu trước khi nhận diện chữ hoa đầu đoạn: câu gốc thiếu chữ cái đầu ("he ACR…") → vẫn ghép được
    const lookupLoose = (b: LayoutBlock) => {
      if (!b.dropCap) return undefined;
      const tail = normKey(b.text).replace(/^\p{L}\s?/u, '');
      return lookup.get(tail);
    };
    const translations: Record<string, string> = {};
    const missing: LayoutBlock[] = [];
    for (const b of analyzed.blocks) {
      // Bản lưu cũ (trước khi có thẻ màu) được ghép theo câu gốc không thẻ
      let v = lookup.get(normKey(b.text)) ?? lookup.get(normKey(b.plain)) ?? lookupLoose(b);
      // Bản lưu cũ để nguyên tiêu đề "References"… → dịch trên máy (không tốn token)
      const h = localHeading(b.text) ?? glossaryExact(b.text);
      if (h && (!v || isUntranslated(b.text, v) || normKey(v).toLowerCase() === normKey(b.plain).toLowerCase())) v = h;
      if (v) translations[b.id] = v;
      else if (b.translatable) missing.push(b);
    }
    // Bản lưu cũ được tạo khi bộ máy còn tách khối khác → các khối mới không khớp: chỉ dịch bù những khối này
    let retranslated = 0;
    if (translator && missing.length && !analyzed.scanned) {
      try {
        Object.assign(translations, await translateBlocks(translator, missing, signal));
        retranslated = missing.length;
      } catch (e) {
        if (signal?.aborted) throw e;
        console.warn('[Layout] Không dịch bù được khối thiếu:', e);
      }
    }
    checkAbort(signal);
    const res = await finishPage(analyzed, pageNumber, translations, ocr, ocr ? undefined : extraOcr, signal);
    return { ...res, retranslated };
  } catch (e) {
    releaseAnalyzed(analyzed);
    throw e;
  }
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
/**
 * Phân tích NHẸ cho dịch thường: chỉ đọc lớp chữ (vị trí, cỡ, đậm/nghiêng theo tên font), KHÔNG vẽ trang.
 * Trước đây dùng chung bước phân tích của "giữ định dạng" (vẽ trang 1700px hai lần, đọc điểm ảnh, xếp hàng
 * chung khoá CPU) → mỗi trang dịch thường tốn thêm 0,5–1 giây và tranh tài nguyên với trình xem PDF.
 */
async function analyzeTextOnly(pdfDoc: PDFDocumentProxy, pageNumber: number) {
  const page: any = await pdfDoc.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(1.5, TARGET_WIDTH_PX / base.width));
    const viewport = page.getViewport({ scale });
    const W = Math.floor(viewport.width), H = Math.floor(viewport.height);
    const textContent = await page.getTextContent();
    const rawItems: RawTextItem[] = (textContent.items as any[])
      .filter(it => typeof it.str === 'string')
      .map(it => ({ str: it.str, transform: it.transform, width: it.width, fontName: it.fontName }));
    const letters = rawItems.reduce((s, it) => s + (it.str.match(/\p{L}/gu)?.length ?? 0), 0);
    const scanned = letters < 20 || isGarbledText(rawItems.map(it => it.str).join(' '));
    if (scanned) return { scanned, blocks: [] as LayoutBlock[], W, H };
    const items = normalizeItems(rawItems, viewport.transform, styleResolver(page, textContent.styles));
    detectDropCaps(items);
    const { strong } = analyzeColumns(items);
    const blocks = buildBlocks(items, W, H, strong.length ? strong : undefined);
    return { scanned, blocks, W, H };
  } finally {
    try { page.cleanup?.(); } catch { /* ignore */ }
  }
}

export async function buildPageMarkdown(pdfDoc: PDFDocumentProxy, pageNumber: number): Promise<PageMarkdown> {
  const a = await analyzeTextOnly(pdfDoc, pageNumber);
  const W = a.W, H = a.H;
  if (a.scanned) return { eligible: false, markdown: '', reason: 'scanned' };
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
      // Giữ số chương/mục: "1", "1.1", "2.2.1" (trước đây bị đổi thành "-" → mất số chương ở mục lục)
      const marker = /^\d{1,3}[.)]$/.test(lab) ? `${lab.replace(')', '.')}`
        : /^[a-zA-Z][.)]$|^\(?[ivxIVX]+[.)]$|^\d{1,3}(\.\d{1,3})+\.?$|^\d{1,3}$/.test(lab) ? `- ${lab}` : '-';
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

// Mở kết nối MỘT lần và dùng lại (trước đây mỗi lần đọc/ghi trang lại mở một kết nối mới, không đóng)
let layoutDbPromise: Promise<IDBDatabase> | null = null;
function openLayoutDB(): Promise<IDBDatabase> {
  if (!layoutDbPromise) {
    layoutDbPromise = openLayoutDBOnce().then(db => {
      db.onversionchange = () => { db.close(); layoutDbPromise = null; };
      db.onclose = () => { layoutDbPromise = null; };
      return db;
    }).catch(e => { layoutDbPromise = null; throw e; });
  }
  return layoutDbPromise;
}

function openLayoutDBOnce(): Promise<IDBDatabase> {
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
const ENGINE_VERSION = 'v27'; // v27: màu chữ chỉ theo đúng đoạn có màu ở bản gốc, nhãn trong hình theo khung AI + xoá sạch nền ảnh, chú thích giữ số dòng; // v26: chú thích sát ảnh, nhãn Hình đậm, chữ dọc đo theo mực; // v25: toạ độ OCR kiểm tra theo vùng chữ thật, chữ dọc, mực đen; // v24: trang scan có hình bị lưu nhầm là trang trắng → dịch lại; // v18: thụt treo, cỡ chữ chung theo đa số; v17: tiêu đề References… dịch trên máy; v16: tách cột theo cỡ chữ (chú thích ↔ thân bài), xoá theo mực thật hai bên; v15: không chép trả dải chữ gốc từ khối OCR, OCR hình mặc định tắt; v14: khe cột không bị AI xoá nhầm, bỏ khối OCR trùng chữ; v13: chữ hoa đầu đoạn, giữ đường kẻ bảng, màu chữ trên nền ảnh, căn giữa nhầm
const cacheKey = (docKey: string, page: number) => `${ENGINE_VERSION}::${docKey}::${page}`;

// Cặp câu gốc → câu dịch lưu trên máy theo khoá KHÔNG phụ thuộc phiên bản bộ máy → nâng cấp không mất bản dịch
const pairsKey = (docKey: string, page: number) => `pairs::${docKey}::${page}`;

/**
 * Bản dịch giữ định dạng đã lưu trên máy (giống bản dịch chữ được lưu đệm):
 * gồm khoá cặp câu hiện tại và cặp câu nằm trong ảnh đệm của mọi phiên bản cũ (v1…v6).
 */
export async function loadLocalLayoutPairs(docKey: string): Promise<Record<number, LayoutPair[]>> {
  const out: Record<number, LayoutPair[]> = {};
  // Chỉ đọc khoá của tài liệu này (trước đây duyệt toàn bộ kho, kể cả ảnh của mọi tài liệu khác → mở file chậm)
  const current = parseInt(ENGINE_VERSION.slice(1), 10) || 1;
  const prefixes = ['pairs', ENGINE_VERSION, ...Array.from({ length: current - 1 }, (_, i) => `v${current - 1 - i}`)];
  try {
    const db = await openLayoutDB();
    for (const prefix of prefixes) {
      const lower = `${prefix}::${docKey}::`;
      await new Promise<void>(resolve => {
        const range = IDBKeyRange.bound(lower, lower + '\uffff');
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor(range);
        req.onsuccess = () => {
          const cur = req.result;
          if (!cur) return resolve();
          const tail = String(cur.key).slice(lower.length);
          if (/^\d+$/.test(tail)) {
            const page = parseInt(tail, 10);
            const pairs: LayoutPair[] | undefined = (cur.value as any)?.pairs;
            if (!out[page] && Array.isArray(pairs) && pairs.length) out[page] = pairs;
          }
          cur.continue();
        };
        req.onerror = () => resolve();
      });
    }
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
    // Một con trỏ theo khoảng khoá của tài liệu (trước đây mở 1 giao dịch cho MỖI trang, kể cả trang chưa dịch)
    const lower = `${ENGINE_VERSION}::${docKey}::`;
    await new Promise<void>(resolve => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).openCursor(IDBKeyRange.bound(lower, lower + '\uffff'));
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        const tail = String(cur.key).slice(lower.length);
        if (/^\d+$/.test(tail)) {
          const p = parseInt(tail, 10);
          if (p >= 1 && p <= numPages && cur.value) out[p] = cur.value as LayoutPageResult;
        }
        cur.continue();
      };
      req.onerror = () => resolve();
    });
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
  pdf.setLanguage('vi');
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  // v9.4: lớp chữ ẩn (font Tinos nhúng dạng rút gọn) → tìm kiếm, bôi đen, sao chép chữ tiếng Việt trong PDF
  let font: any = null;
  if (sorted.some(p => p.textLayer?.length)) {
    try {
      const fontkit = (await import('@pdf-lib/fontkit')).default;
      pdf.registerFontkit(fontkit);
      const fontBytes = await (await fetch('/fonts/Tinos-Regular.ttf')).arrayBuffer();
      font = await pdf.embedFont(fontBytes, { subset: true });
    } catch (e) {
      console.warn('[Layout] Không nạp được font cho lớp chữ ẩn → PDF chỉ có ảnh:', e);
      font = null;
    }
  }
  let n = 0;
  for (const p of sorted) {
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    const img = await pdf.embedJpg(bytes);
    const page = pdf.addPage([p.widthPt, p.heightPt]);
    page.drawImage(img, { x: 0, y: 0, width: p.widthPt, height: p.heightPt });
    if (font && p.textLayer?.length) {
      for (const r of p.textLayer) {
        const t = r.t.replace(/[\u0000-\u001f\u200b-\u200f\ufeff]/g, ' ').trim();
        if (!t || r.s <= 0) continue;
        try {
          // Co giãn cỡ chữ ẩn cho khớp đúng bề rộng dòng đã vẽ → bôi đen trùng vị trí chữ trên ảnh
          const natural = font.widthOfTextAtSize(t, r.s);
          const size = natural > 0 ? Math.max(1, Math.min(r.s * 1.6, r.s * (r.w / natural))) : r.s;
          page.drawText(t, { x: r.x, y: p.heightPt - r.y, size, font, opacity: 0 });
        } catch { /* ký tự font không có → bỏ dòng này */ }
      }
    }
    if (++n % 20 === 0) await new Promise(r => setTimeout(r, 0)); // nhường giao diện khi ghép tài liệu dài
  }
  // Không nén object stream: ảnh JPEG đã nén sẵn → ghi nhanh hơn nhiều với tài liệu hàng trăm trang
  const bytes = await pdf.save({ useObjectStreams: false, objectsPerTick: 200 });
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
