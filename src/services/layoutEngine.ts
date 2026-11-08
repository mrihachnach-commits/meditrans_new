/**
 * MediTrans AI — Layout Engine v2 (dịch giữ định dạng, xuất dạng ảnh)
 *
 * Module thuần (không phụ thuộc React / pdf.js / Firebase). Toạ độ = pixel canvas (gốc trên-trái).
 *
 *  1. normalizeItems() + annotateItemColors(): đọc text item của pdf.js, gắn đậm/nghiêng/serif/màu cho từng item.
 *  2. buildBlocks(): item → dòng → khối. Mỗi khối giữ các "run" có kiểu chữ riêng; những run khác kiểu
 *     chủ đạo (từ in đậm / in màu giữa câu) được bọc thẻ <1>…</1> để AI giữ lại quanh từ tương ứng.
 *     Nhận diện: số mục đầu dòng (tách riêng), dấu chấm dẫn + số trang (mục lục), thụt đầu dòng / thụt treo.
 *  3. paintTranslatedPage(): xoá chữ gốc bằng màu nền thật, gom các khối liền nhau trong cùng cột thành
 *     "nhóm chảy" và dàn lại đồng đều (cùng một tỉ lệ thu nhỏ nếu cần), vẽ chữ Việt nhiều kiểu chữ.
 */

export interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  fontName: string;
}

export interface FontStyleInfo {
  bold: boolean;
  italic: boolean;
  serif: boolean;
}

export interface RGB { r: number; g: number; b: number; }

export interface RunStyle {
  bold: boolean;
  italic: boolean;
  color: RGB | null;
}

interface NormItem {
  str: string;
  x: number;
  y: number;
  size: number;
  w: number;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  color: RGB | null;
  font: string;      // tên font pdf.js (để hiệu chỉnh theo từng font)
  hScale: number;    // co/giãn ngang để khớp độ rộng chữ gốc (font hẹp/rộng)
}

interface Run extends RunStyle { text: string; }

interface Segment {
  runs: Run[];
  text: string;
  x0: number;
  x1: number;
  y: number;
  size: number;
  bold: boolean;
  italic: boolean;
  serif: boolean;
  leader?: { num: string };
  hScale: number;
  /** Dòng mở đầu một mục danh sách (có ký hiệu/số thứ tự ngay bên trái). */
  itemStart?: boolean;
  isLabel?: boolean;
}

export type BlockAlign = 'left' | 'center' | 'right' | 'justify';

export interface LayoutBlock {
  id: string;
  /** Văn bản gửi đi dịch — có thể chứa thẻ <n>…</n> đánh dấu đoạn khác kiểu chữ. */
  text: string;
  /** Văn bản thuần (không thẻ). */
  plain: string;
  styles: RunStyle[];        // styles[n-1] ứng với thẻ <n>
  baseStyle: RunStyle;       // kiểu chữ chủ đạo
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  size: number;
  leading: number;
  lineCount: number;
  firstOffset: number;       // thụt dòng đầu (so với x0)
  restOffset: number;        // thụt các dòng sau (thụt treo)
  bold: boolean;
  italic: boolean;
  serif: boolean;
  align: BlockAlign;
  translatable: boolean;
  leader?: { num: string; right: number };
  /** Mục lục nhiều dòng: mép phải của các dòng trên (để ngắt dòng giống bản gốc). */
  bodyRight?: number;
  /** Co/giãn ngang khi vẽ để khớp độ rộng font gốc. */
  hScale: number;
  /** Chữ xoay 90°: 'up' = đọc từ dưới lên, 'down' = đọc từ trên xuống. */
  rotate?: 'up' | 'down';
  /** Khối lấy từ OCR (chữ trong ảnh / trang scan). */
  fromOcr?: boolean;
}

export interface PaintReport {
  painted: number;
  overflowIds: string[];
  shrunkIds: string[];
}

/* ------------------------------------------------------------------ */
/* Tiện ích                                                            */
/* ------------------------------------------------------------------ */

function mul(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const letterCount = (t: string) => t.match(/\p{L}/gu)?.length ?? 0;

function colorDist(a: RGB, b: RGB) {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

const isDark = (c: RGB | null) => !c || Math.max(c.r, c.g, c.b) < 95;

function sameColor(a: RGB | null, b: RGB | null): boolean {
  if (isDark(a) && isDark(b)) return true;
  if (!a || !b) return false;
  return colorDist(a, b) < 75;
}

function sameStyle(a: RunStyle, b: RunStyle): boolean {
  return a.bold === b.bold && a.italic === b.italic && sameColor(a.color, b.color);
}

const SUPERSCRIPT_MAP: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '–': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ',
};

function toSuperscript(s: string): string {
  const core = s.replace(/[,\s]/g, '');
  if (!core || [...core].some(ch => !SUPERSCRIPT_MAP[ch])) return s;
  return [...s].map(ch => SUPERSCRIPT_MAP[ch] ?? ch).join('');
}

const BULLET_CHARS = '•●▪■◦○‣►▸➢➤✓✔❖◆◇□▫·∙§\\-–—*o\uF0A7\uF0B7\uF0D8\uF076\uF0FC\uF0A8\uF06E\uF0E0';
const LABEL_RE = new RegExp(`^(\\d{1,3}(\\.\\d{1,3})*[.)]?|[a-zA-Z][.)]|\\(?[ivxIVX]{1,4}[.)]|[${BULLET_CHARS}])$`);
/** Ký hiệu đầu dòng dính liền chữ trong cùng một item: "• Breast", "o Conical…" */
const LEADING_BULLET_RE = new RegExp(`^(\\s*[${BULLET_CHARS}])(\\s+)(?=\\S)`);
const LEADER_RE = /^([\s\S]*?\S)\s*(?:[.·…]\s*){4,}\s*(\d{1,4}|[ivxlcdm]{1,6})?\s*$/i;

function isTranslatableText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (letterCount(t) < 2) return false;
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return false;
  if (/^(doi:?\s*)?10\.\d{4,}\/\S+$/i.test(t)) return false;
  if (/^\S+@\S+\.\S+$/.test(t)) return false;
  if (/^(page|trang)?\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(t)) return false;
  if (/^[ivxlcdm]{1,7}\.?$/i.test(t)) return false; // số trang La Mã
  return true;
}

/* ------------------------------------------------------------------ */
/* Màu vùng                                                            */
/* ------------------------------------------------------------------ */

interface RegionStats { bg: RGB; uniform: number; fg: RGB | null; }

/** Thống kê vùng ảnh: nền = màu phổ biến nhất; chữ = trung vị nhóm 25% điểm khác nền nhiều nhất. */
function regionStats(img: ImageData, x0: number, y0: number, x1: number, y1: number): RegionStats {
  const W = img.width, H = img.height, d = img.data;
  const xa = Math.max(0, Math.floor(x0)), xb = Math.min(W, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H, Math.ceil(y1));
  const area = Math.max(1, (xb - xa) * (yb - ya));
  const step = area > 60000 ? 2 : 1;
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = ya; y < yb; y += step) {
    for (let x = xa; x < xb; x += step) {
      const i = (y * W + x) * 4;
      const key = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      const e = bins.get(key) || { n: 0, r: 0, g: 0, b: 0 };
      e.n++; e.r += d[i]; e.g += d[i + 1]; e.b += d[i + 2];
      bins.set(key, e);
      total++;
    }
  }
  let mode = { n: 0, r: 255, g: 255, b: 255 };
  let modeKey = -1;
  bins.forEach((e, k) => { if (e.n > mode.n) { mode = e; modeKey = k; } });
  // Màu nền = màu chính xác xuất hiện nhiều nhất trong nhóm phổ biến (không lấy trung bình → không lệch sắc, không thành mảng xám mờ)
  const exact = new Map<number, number>();
  for (let y = ya; y < yb; y += step) {
    for (let x = xa; x < xb; x += step) {
      const i = (y * W + x) * 4;
      if ((((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)) !== modeKey) continue;
      const c = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      exact.set(c, (exact.get(c) || 0) + 1);
    }
  }
  let bestC = -1, bestN = 0;
  exact.forEach((n, c) => { if (n > bestN) { bestN = n; bestC = c; } });
  const bg: RGB = bestC >= 0
    ? { r: (bestC >> 16) & 255, g: (bestC >> 8) & 255, b: bestC & 255 }
    : mode.n ? { r: mode.r / mode.n, g: mode.g / mode.n, b: mode.b / mode.n } : { r: 255, g: 255, b: 255 };

  let near = 0;
  const far: { dist: number; r: number; g: number; b: number }[] = [];
  for (let y = ya; y < yb; y += step) {
    for (let x = xa; x < xb; x += step) {
      const i = (y * W + x) * 4;
      const p = { r: d[i], g: d[i + 1], b: d[i + 2] };
      const dist = colorDist(p, bg);
      if (dist < 40) near++;
      else if (dist > 120) far.push({ dist, ...p });
    }
  }
  let fg: RGB | null = null;
  if (far.length > Math.max(3, total * 0.01)) {
    far.sort((a, b) => b.dist - a.dist);
    const top = far.slice(0, Math.max(3, Math.ceil(far.length * 0.25)));
    fg = { r: median(top.map(p => p.r)), g: median(top.map(p => p.g)), b: median(top.map(p => p.b)) };
  }
  return { bg, uniform: near / Math.max(1, total), fg };
}

function rgbCss(c: RGB, a = 1) {
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
}

/* ------------------------------------------------------------------ */
/* 1. Chuẩn hoá item                                                   */
/* ------------------------------------------------------------------ */

export function normalizeItems(
  items: RawTextItem[],
  viewportTransform: number[],
  getStyle: (fontName: string) => FontStyleInfo,
): NormItem[] {
  const scale = Math.hypot(viewportTransform[0], viewportTransform[1]);
  const out: NormItem[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const m = mul(viewportTransform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    if (!isFinite(size) || size < 2) continue;
    if (Math.abs(m[1]) > 0.05 * Math.abs(m[0]) || m[0] <= 0) continue; // chữ xoay: giữ nguyên
    const st = getStyle(it.fontName);
    out.push({
      str: it.str, x: m[4], y: m[5], size, w: Math.max(0, it.width * scale),
      bold: st.bold, italic: st.italic, serif: st.serif, color: null, font: it.fontName, hScale: 1,
    });
  }
  return out;
}

/**
 * Gắn màu chữ thật cho từng item, lấy mẫu trên ảnh trang gốc.
 * pdf.js gộp cả câu nhiều màu vào một item → ước lượng vị trí từng ký tự (theo độ rộng đo bằng canvas)
 * rồi tách item tại chỗ đổi màu, để giữ được từ in màu giữa câu.
 */
export function annotateItemColors(ctx: CanvasRenderingContext2D, items: NormItem[]): NormItem[] {
  const img = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const out: NormItem[] = [];
  ctx.save();
  for (const it of items) {
    const chars = [...it.str];
    if (it.w < 1 || chars.length === 0) { out.push(it); continue; }
    const y0 = it.y - 0.75 * it.size, y1 = it.y + 0.15 * it.size;
    if (chars.length === 1 || letterCount(it.str) < 2) {
      it.color = regionStats(img, it.x, y0, it.x + it.w, y1).fg;
      out.push(it);
      continue;
    }
    ctx.font = `${it.italic ? 'italic ' : ''}${it.bold ? '700' : '400'} 100px ${it.serif ? SERIF_STACK : SANS_STACK}`;
    const adv = chars.map(ch => Math.max(1, ctx.measureText(ch).width));
    const total = adv.reduce((a, b) => a + b, 0);
    const k = it.w / total;
    const xs: number[] = [];
    let acc = it.x;
    for (const a of adv) { xs.push(acc); acc += a * k; }
    xs.push(acc);

    // Tách thành từ (chữ/số liền nhau) và phần xen giữa; lấy màu theo cả từ
    const tokens: { from: number; to: number; word: boolean; color: RGB | null }[] = [];
    const isW = (ch: string) => /[\p{L}\p{N}]/u.test(ch);
    for (let i = 0; i < chars.length;) {
      const w = isW(chars[i]);
      let j = i + 1;
      while (j < chars.length && isW(chars[j]) === w) j++;
      const color = w ? regionStats(img, xs[i] + 0.3, y0, xs[j] - 0.3, y1).fg : null;
      tokens.push({ from: i, to: j, word: w, color });
      i = j;
    }
    // Gom các từ liên tiếp cùng màu; phần xen giữa đi theo từ phía trước
    const parts: { from: number; to: number; color: RGB | null }[] = [];
    for (const t of tokens) {
      const last = parts[parts.length - 1];
      if (!last) { parts.push({ from: t.from, to: t.to, color: t.color }); continue; }
      if (!t.word || sameColor(t.color, last.color) || (last.color === null && !tokens.some(x => x.word && x.from < t.from))) {
        last.to = t.to;
        if (last.color === null && t.color) last.color = t.color;
      } else {
        parts.push({ from: t.from, to: t.to, color: t.color });
      }
    }
    for (const p of parts) {
      out.push({ ...it, str: chars.slice(p.from, p.to).join(''), x: xs[p.from], w: xs[p.to] - xs[p.from], color: p.color });
    }
  }
  ctx.restore();
  calibrateFonts(ctx, img, out);
  return out;
}

/**
 * Hiệu chỉnh theo từng font, đo trực tiếp trên ảnh trang gốc:
 *  - Cỡ chữ thật: chiều cao nét chữ hoa/chữ có nét cao so với cỡ ghi trong file (nhiều sách ghi cỡ lớn hơn thực tế).
 *  - Độ rộng: font gốc hẹp/rộng hơn font thay thế → co/giãn ngang khi vẽ.
 *  - Độ đậm: mật độ mực cao hơn hẳn mặt bằng trang → chữ đậm (khi tên font không ghi "Bold").
 */
function calibrateFonts(ctx: CanvasRenderingContext2D, img: ImageData, items: NormItem[]) {
  const W = img.width, H = img.height, d = img.data;
  type Probe = { v?: number; ink: number; letters: number };
  const probes = new Map<NormItem, Probe>();
  for (const it of items) {
    const letters = letterCount(it.str);
    if (letters < 2 || it.w < 2) continue;
    const st = regionStats(img, it.x, it.y - 0.75 * it.size, it.x + it.w, it.y + 0.15 * it.size);
    const bg = st.bg;
    const isInk = (x: number, y: number) => {
      const i = (y * W + x) * 4;
      return Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b) > 110;
    };
    const xa = Math.max(0, Math.floor(it.x + 0.05 * it.w)), xb = Math.min(W, Math.ceil(it.x + 0.95 * it.w));
    // mật độ mực trong vùng cao chữ thường
    let ink = 0, tot = 0;
    const ya = Math.max(0, Math.floor(it.y - 0.5 * it.size)), yb = Math.min(H, Math.ceil(it.y));
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { tot++; if (isInk(x, y)) ink++; }
    const probe: Probe = { ink: tot ? ink / tot : 0, letters };
    // chiều cao nét cao nhất liền mạch phía trên đường chân chữ
    if (/[A-Zbdfhkl0-9]/.test(it.str)) {
      const gapNeed = Math.max(2, Math.round(0.12 * it.size));
      let y = Math.floor(it.y - 0.1 * it.size), top = -1, empty = 0;
      const limit = Math.max(0, Math.floor(it.y - 1.4 * it.size));
      for (; y >= limit; y--) {
        let rowInk = false;
        for (let x = xa; x < xb; x += 1) if (isInk(x, y)) { rowInk = true; break; }
        if (rowInk) { top = y; empty = 0; } else if (++empty >= gapNeed && top >= 0) break;
      }
      if (top >= 0) probe.v = (it.y - top) / ((it.serif ? 0.68 : 0.72) * it.size);
    }
    probes.set(it, probe);
  }
  // gom theo font
  const byFont = new Map<string, NormItem[]>();
  for (const it of probes.keys()) {
    const k = `${it.font}|${it.bold}|${it.italic}`;
    (byFont.get(k) || byFont.set(k, []).get(k)!).push(it);
  }
  const allInk: number[] = [];
  probes.forEach(p => { for (let i = 0; i < Math.min(p.letters, 30); i++) allInk.push(p.ink); });
  const pageInk = median(allInk);

  const fontFix = new Map<string, { v: number; h: number; bold: boolean }>();
  byFont.forEach((list, k) => {
    const vs = list.map(it => probes.get(it)!.v).filter((v): v is number => v !== undefined && v > 0.4 && v < 1.6);
    let v = vs.length >= 2 ? median(vs) : 1;
    if (Math.abs(v - 1) < 0.08) v = 1;
    v = Math.min(1.25, Math.max(0.55, v));
    // độ rộng: chữ gốc so với font thay thế ở cỡ đã hiệu chỉnh
    const hs: number[] = [];
    for (const it of list) {
      if (it.str.length < 4) continue;
      ctx.font = `${it.italic ? 'italic ' : ''}${it.bold ? '700' : '400'} ${(it.size * v).toFixed(2)}px ${it.serif ? SERIF_STACK : SANS_STACK}`;
      const mw = ctx.measureText(it.str).width;
      if (mw > 4) hs.push(it.w / mw);
    }
    let h = hs.length ? median(hs) : 1;
    if (Math.abs(h - 1) < 0.06) h = 1;
    h = Math.min(1.12, Math.max(0.72, h));
    const inks = list.map(it => probes.get(it)!.ink);
    const bold = pageInk > 0 && median(inks) > 1.35 * pageInk && list.reduce((s, it) => s + probes.get(it)!.letters, 0) >= 4;
    fontFix.set(k, { v, h, bold });
  });
  for (const it of items) {
    const fx = fontFix.get(`${it.font}|${it.bold}|${it.italic}`);
    if (!fx) continue;
    it.size *= fx.v;
    it.hScale = fx.h;
    if (fx.bold) it.bold = true;
  }
}

/* ------------------------------------------------------------------ */
/* 2. Item → đoạn dòng (segment) → khối                                */
/* ------------------------------------------------------------------ */

function splitLeadingBullets(items: NormItem[]): NormItem[] {
  const out: NormItem[] = [];
  for (const it of items) {
    const m = it.str.match(LEADING_BULLET_RE);
    if (!m || it.str.length <= m[0].length) { 
      // Xử lý dấu gạch ngang hoặc ký hiệu đầu dòng đứng sát chữ không có khoảng trắng: "-Types", "•Anatomy"
      const tightMatch = it.str.match(/^(\s*[•●▪■◦○‣►▸➢➤✓✔❖◆◇□▫·∙§–—\uF0A7\uF0B7\uF0D8\uF076\uF0FC\uF0A8\uF06E\uF0E0]|\s*-(?=\p{Lu}))(\s*)(?=\S)/u);
      if (tightMatch && it.str.length > tightMatch[0].length) {
        const head = tightMatch[1].trim();
        const total = [...it.str].length;
        const headLen = [...tightMatch[0]].length;
        const wHead = it.w * (headLen / total);
        out.push({ ...it, str: head, w: wHead * 0.7 });
        out.push({ ...it, str: it.str.slice(tightMatch[0].length), x: it.x + wHead, w: it.w - wHead });
        continue;
      }
      out.push(it); 
      continue; 
    }
    const head = m[1].trim();
    // "o" chỉ là ký hiệu đầu dòng khi theo sau là chữ cái (tránh nhầm với từ thật)
    if (head === 'o' && !/^\p{L}/u.test(it.str.slice(m[0].length))) { out.push(it); continue; }
    const total = [...it.str].length;
    const headLen = [...m[0]].length;
    const wHead = it.w * (headLen / total);
    out.push({ ...it, str: head, w: wHead * 0.6 });
    out.push({ ...it, str: it.str.slice(m[0].length), x: it.x + wHead, w: it.w - wHead });
  }
  return out;
}

/**
 * Tìm khe giữa các cột văn bản (gutter). Nhiều sách (Springer…) có khe cột rất hẹp, chỉ ≈ 1 cỡ chữ,
 * nên ngưỡng khoảng cách chung không đủ để tách cột → hai dòng của hai cột bị ghép thành một.
 * Khe cột = dải x gần như không có chữ nào đi qua, đồng thời có nhiều dòng kết thúc sát bên trái
 * và nhiều dòng bắt đầu sát bên phải.
 */
export interface GutterCandidate { x: number; evidence: number; }

/** Kết quả nhận diện cột của một trang (toạ độ canvas). */
export interface ColumnAnalysis {
  /** Khe cột chắc chắn (dùng ngay). */
  strong: number[];
  /** Khe cột có bằng chứng yếu — nên hỏi AI xác nhận. */
  weak: number[];
}

export function analyzeColumns(items: NormItem[]): ColumnAnalysis {
  const c = detectGutterCandidates(splitLeadingBullets(items));
  return {
    strong: c.filter(g => g.evidence >= 10).map(g => g.x),
    weak: c.filter(g => g.evidence >= 3 && g.evidence < 10).map(g => g.x),
  };
}

/** Khe dùng mặc định khi không có AI: bằng chứng ≥ 5 dòng mỗi bên. */
function defaultGutters(items: NormItem[]): number[] {
  return detectGutterCandidates(items).filter(g => g.evidence >= 5).map(g => g.x);
}

function detectGutterCandidates(items: NormItem[]): GutterCandidate[] {
  const all = items.filter(i => letterCount(i.str) >= 1 && i.w > 0);
  if (all.length < 12) return [];
  // Chỉ xét chữ thân bài (cỡ chữ phổ biến): tiêu đề lớn / chú thích chân trang chạy ngang cả trang không che mất khe cột
  const bodySize = median(all.flatMap(i => Array(Math.min(30, letterCount(i.str))).fill(Math.round(i.size * 2) / 2)));
  const body = all.filter(i => Math.abs(i.size - bodySize) <= 0.15 * bodySize);
  if (body.length < 12) return [];
  const minX = Math.min(...body.map(i => i.x));
  const maxX = Math.max(...body.map(i => i.x + i.w));
  const span = maxX - minX;
  if (span < 100) return [];
  const size = median(body.map(i => i.size)) || 10;
  const step = Math.max(1, size / 6);
  const n = Math.ceil(span / step) + 1;
  const cover = new Array(n).fill(0);
  for (const it of body) {
    const a = Math.ceil((it.x + 0.5 - minX) / step), b = Math.floor((it.x + it.w - 0.5 - minX) / step);
    for (let k = Math.max(0, a); k <= Math.min(n - 1, b); k++) cover[k]++;
  }
  // Số "dòng" thực tế (hàng y khác nhau) để đặt ngưỡng
  const rowsY = new Set(body.map(i => Math.round(i.y / Math.max(2, size * 0.5))));
  const tol = Math.max(2, Math.floor(rowsY.size * 0.06));
  const gutters: GutterCandidate[] = [];
  let k = 0;
  while (k < n) {
    if (cover[k] > tol) { k++; continue; }
    let j = k;
    while (j + 1 < n && cover[j + 1] <= tol) j++;
    const gx0 = minX + k * step, gx1 = minX + j * step;
    const mid = (gx0 + gx1) / 2;
    k = j + 1;
    if (mid < minX + 0.2 * span || mid > maxX - 0.2 * span) continue;
    if (gx1 - gx0 > 6 * size) continue; // khoảng trống rộng (hình, lề) – để ngưỡng thường xử lý
    const leftEnds = body.filter(i => { const e = i.x + i.w; return e <= mid && e >= gx0 - 2.5 * size; }).length;
    const rightStarts = body.filter(i => i.x >= mid && i.x <= gx1 + 2.5 * size).length;
    const evidence = Math.min(leftEnds, rightStarts);
    if (evidence >= 3) gutters.push({ x: mid, evidence });
  }
  return gutters;
}

/** Hai item có nằm cùng một hàng chữ không (tránh để số chương cỡ lớn kéo nhiều dòng tiêu đề vào một hàng). */
function sameRow(a: NormItem, b: NormItem): boolean {
  const big = a.size >= b.size ? a : b;
  const small = big === a ? b : a;
  const dy = Math.abs(a.y - b.y);
  if (small.size >= 0.75 * big.size) return dy < 0.42 * big.size;
  // Khác cỡ nhiều (chỉ số trên/dưới, số chương lớn): chữ nhỏ phải nằm gọn trong chiều cao chữ lớn
  return small.y <= big.y + 0.2 * big.size && small.y >= big.y - 0.75 * big.size &&
    (small.y - 0.7 * small.size) >= big.y - 0.95 * big.size && dy < 0.6 * big.size;
}

function buildSegments(rawItems: NormItem[], gutterOverride?: number[]): Segment[] {
  const items = splitLeadingBullets(rawItems);
  const gutters = gutterOverride ?? defaultGutters(items);
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: NormItem[][] = [];
  for (const it of sorted) {
    let bestRow: NormItem[] | null = null;
    let bestDy = Infinity;
    for (let r = rows.length - 1; r >= 0 && r >= rows.length - 4; r--) {
      for (const o of rows[r]) {
        if (!sameRow(o, it)) continue;
        const dy = Math.abs(o.y - it.y);
        if (dy < bestDy) { bestDy = dy; bestRow = rows[r]; }
      }
    }
    if (bestRow) bestRow.push(it);
    else rows.push([it]);
  }

  for (const row of rows) row.sort((a, b) => a.x - b.x);
  const rowY = rows.map(r => median(r.map(i => i.y)));
  /**
   * Khoảng trắng rộng trong dòng căn đều (justify) hay khe giữa 2 ô bảng/2 cột?
   * → Xem các dòng ngay trên/dưới: nếu chữ của chúng phủ qua giữa khoảng trắng này (và không dòng nào có khe
   *   trùng vị trí như bảng) thì đây chỉ là khoảng trắng giãn chữ → vẫn là MỘT dòng.
   */
  const isJustifiedGap = (ri: number, a: number, b: number, size: number) => {
    const mid = (a + b) / 2;
    let covered = 0, aligned = 0;
    for (let rj = Math.max(0, ri - 3); rj <= Math.min(rows.length - 1, ri + 3); rj++) {
      if (rj === ri || Math.abs(rowY[rj] - rowY[ri]) > 2.6 * size) continue;
      const peers = rows[rj].filter(o => Math.abs(o.size - size) < 0.15 * size && letterCount(o.str) > 0);
      if (!peers.length) continue;
      if (peers.some(o => o.x < mid - 0.3 * size && o.x + o.w > mid + 0.3 * size)) { covered++; continue; }
      // Dòng bên cạnh cũng trống tại đây: khe RỘNG (≥ 1 cỡ chữ) → cột bảng; khe hẹp = khoảng cách giữa 2 từ → vẫn là chữ chạy
      const ends = peers.filter(o => o.x + o.w <= mid + 0.3 * size).map(o => o.x + o.w);
      const starts = peers.filter(o => o.x >= mid - 0.3 * size).map(o => o.x);
      if (!ends.length || !starts.length) continue;
      const nGap = Math.min(...starts) - Math.max(...ends);
      if (nGap >= Math.max(size, 0.5 * (b - a))) aligned++;
      else covered++;
    }
    return { covered, aligned };
  };

  const segments: Segment[] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const mainSize = median(row.map(r => r.size));
    let cur: NormItem[] = [];
    const flush = () => { if (cur.length) { segments.push(makeSegment(cur)); cur = []; } };
    for (const it of row) {
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const prevEnd = prev.x + prev.w;
        const gap = it.x - prevEnd;
        const curText = cur.map(c => c.str).join('').trim();
        // Số mục / ký hiệu đầu dòng ("10", "1.2", "•", "a)") đứng tách khỏi chữ → khối riêng
        const labelBreak = cur.length === 1 && LABEL_RE.test(curText) && gap > 0.2 * mainSize && /[\p{L}\p{N}(]/u.test(it.str);
        // Khoảng trống rơi vào khe cột → luôn tách (kể cả khi khe hẹp)
        const gutterBreak = gap > 0.35 * mainSize && gutters.some(g => g >= prevEnd - 1 && g <= it.x + 1);
        // Dòng căn đều có khoảng trắng giữa từ rất rộng: từ tiếp theo viết thường, cùng cỡ chữ → vẫn là một dòng
        const sameFont = Math.abs(it.size - prev.size) < 0.1 * mainSize && letterCount(prev.str) > 0 && !LABEL_RE.test(curText);
        const justifiedGap = !gutterBreak && sameFont && gap <= 4.5 * mainSize &&
          (() => {
            const j = isJustifiedGap(ri, prevEnd, it.x, mainSize);
            if (j.aligned > 0) return false; // khe trùng vị trí với dòng trên/dưới → cột bảng
            return /^\s*\p{Ll}/u.test(it.str) || j.covered >= 1;
          })();
        if (gutterBreak || labelBreak || (gap > 1.2 * mainSize && !justifiedGap)) flush();
      }
      cur.push(it);
    }
    flush();
  }
  let segs = attachOrphanSuperscripts(segments);
  for (const sg of segs) sg.isLabel = LABEL_RE.test(sg.text.trim());
  // "M. Teboul…", "A. Colan…", "2. …" ở đầu đoạn văn: nếu dòng dưới chạy lùi về dưới ký hiệu (không thụt treo)
  // thì đây là chữ của đoạn (tên viết tắt, số đầu câu), KHÔNG phải ký hiệu mục danh sách → ghép lại vào dòng.
  const absorbed = new Set<Segment>();
  for (const L of segs) {
    if (!L.isLabel || /^[^\p{L}\p{N}(]/u.test(L.text.trim())) continue; // ký hiệu •, – … giữ nguyên
    const S = segs.find(o => o !== L && !o.isLabel && Math.abs(o.y - L.y) < 0.4 * o.size && o.x0 >= L.x1 - 1 && o.x0 - L.x1 < 2 * o.size);
    if (!S) continue;
    const wrapsUnder = segs.some(n => n !== L && n !== S && n.y > S.y + 0.5 * S.size && n.y < S.y + 1.9 * S.size &&
      Math.abs(n.size - S.size) < 0.12 * S.size && n.x0 <= L.x0 + 0.5 * S.size && n.x1 > S.x0 + 2 * S.size);
    if (!wrapsUnder) continue;
    S.runs = [...L.runs.map(r => ({ ...r })), ...S.runs];
    S.runs[L.runs.length - 1].text = S.runs[L.runs.length - 1].text.replace(/\s*$/, ' ');
    S.text = `${L.text.trim()} ${S.text}`;
    S.x0 = L.x0;
    absorbed.add(L);
  }
  if (absorbed.size) segs = segs.filter(sg => !absorbed.has(sg));
  for (const sg of segs) {
    if (sg.isLabel) continue;
    sg.itemStart = segs.some(L => L.isLabel && L !== sg &&
      Math.abs(L.y - sg.y) < 0.4 * sg.size && L.x1 <= sg.x0 + 1 && sg.x0 - L.x1 < 3 * sg.size);
  }
  return segs;
}

function makeSegment(items: NormItem[]): Segment {
  const sizeWeight = new Map<number, number>();
  for (const it of items) {
    const k = Math.round(it.size * 2) / 2;
    sizeWeight.set(k, (sizeWeight.get(k) || 0) + Math.max(1, letterCount(it.str)));
  }
  let size = items[0].size;
  let best = -1;
  sizeWeight.forEach((w, k) => { if (w > best) { best = w; size = k; } });
  const main = items.filter(i => Math.abs(i.size - size) < 0.6);
  const baseline = median((main.length ? main : items).map(i => i.y));

  const runs: Run[] = [];
  let prevEnd = -Infinity;
  let lastStyle: RunStyle | null = null;
  for (const it of items) {
    const isSup = it.size < 0.82 * size && it.y < baseline - 0.15 * size;
    let piece = isSup ? toSuperscript(it.str) : it.str;
    const gap = it.x - prevEnd;
    const needSpace = runs.length > 0 && gap > 0.12 * size && !/\s$/.test(runs[runs.length - 1].text) && !/^\s/.test(piece) && !isSup;
    const style: RunStyle = isSup && lastStyle
      ? lastStyle
      : { bold: it.bold, italic: it.italic, color: it.color };
    // Item không có chữ cái (dấu câu, số) kế thừa kiểu chữ trước để tránh vỡ vụn
    const effective: RunStyle = letterCount(piece) === 0 && lastStyle ? lastStyle : style;
    if (needSpace) piece = ' ' + piece;
    const last = runs[runs.length - 1];
    if (last && sameStyle(last, effective)) last.text += piece;
    else runs.push({ ...effective, text: piece });
    lastStyle = effective;
    prevEnd = it.x + it.w;
  }
  for (const r of runs) r.text = r.text.replace(/\s+/g, ' ');

  const weight = (f: (i: NormItem) => boolean) =>
    items.filter(f).reduce((s, i) => s + letterCount(i.str), 0);
  const letters = Math.max(1, weight(() => true));
  const seg: Segment = {
    runs,
    text: runs.map(r => r.text).join('').trim(),
    x0: Math.min(...items.map(i => i.x)),
    x1: Math.max(...items.map(i => i.x + i.w)),
    y: baseline,
    size,
    bold: weight(i => i.bold) / letters > 0.5,
    italic: weight(i => i.italic) / letters > 0.5,
    serif: weight(i => i.serif) / letters >= 0.5,
    hScale: median(items.flatMap(i => Array(Math.max(1, Math.min(20, letterCount(i.str)))).fill(i.hScale))),
  };
  detectLeader(seg);
  return seg;
}

/** Bỏ phần "… 117" của dòng mục lục khỏi chữ cần dịch, ghi nhận lại để vẽ. */
function detectLeader(seg: Segment) {
  const m = seg.text.match(LEADER_RE);
  if (!m) return;
  const keep = m[1].length;
  let count = 0;
  const runs: Run[] = [];
  for (const r of seg.runs) {
    const t = r.text;
    const startTrim = runs.length === 0 ? t.length - t.trimStart().length : 0;
    const usable = t.length - startTrim;
    if (count + usable <= keep) { runs.push(r); count += usable; continue; }
    const take = keep - count;
    if (take > 0) runs.push({ ...r, text: t.slice(0, startTrim + take) });
    break;
  }
  seg.runs = runs;
  seg.text = m[1].trim();
  seg.leader = { num: m[2] || '' };
}

function attachOrphanSuperscripts(segments: Segment[]): Segment[] {
  const orphan = (s: Segment) => /^[\d,–\-\s]{1,8}$/.test(s.text) && !s.leader;
  const result = segments.filter(s => !orphan(s));
  for (const sup of segments.filter(orphan)) {
    const host = result.find(h =>
      sup.size < 0.88 * h.size &&
      Math.abs(sup.x0 - h.x1) < 0.6 * h.size &&
      sup.y < h.y - 0.1 * h.size &&
      sup.y > h.y - 0.8 * h.size,
    );
    if (host) {
      const t = toSuperscript(sup.text.replace(/\s+/g, ''));
      host.runs[host.runs.length - 1].text += t;
      host.text += t;
      host.x1 = Math.max(host.x1, sup.x1);
    } else {
      result.push(sup);
    }
  }
  return result;
}

interface WorkBlock { lines: Segment[]; x0: number; x1: number; size: number; bold: boolean; }

export function buildBlocks(
  items: NormItem[], pageWidth: number, pageHeight = pageWidth * 1.414, gutterOverride?: number[],
): LayoutBlock[] {
  const gutters = gutterOverride ?? defaultGutters(splitLeadingBullets(items));
  const segments = buildSegments(items, gutters).filter(s => s.text.length > 0);
  segments.sort((a, b) => a.y - b.y || a.x0 - b.x0);

  const work: WorkBlock[] = [];
  for (const seg of segments) {
    let bestBlock: WorkBlock | null = null;
    let bestGap = Infinity;
    for (const b of seg.itemStart || seg.isLabel ? [] : work) {
      const last = b.lines[b.lines.length - 1];
      if (last.leader) continue; // dòng mục lục có số trang = kết thúc mục
      if (Math.abs(seg.size - b.size) > 0.12 * b.size) continue;
      if (seg.bold !== b.bold) continue;
      const gap = seg.y - last.y;
      if (gap < 0.5 * b.size || gap > 1.75 * b.size) continue;
      if (b.lines.length >= 2) {
        const lead = b.lines[b.lines.length - 1].y - b.lines[b.lines.length - 2].y;
        if (Math.abs(gap - lead) > 0.3 * lead) continue;
      }
      const overlap = Math.min(seg.x1, b.x1) - Math.max(seg.x0, b.x0);
      const minW = Math.min(seg.x1 - seg.x0, b.x1 - b.x0);
      if (overlap < 0.5 * minW) continue;
      const leftAligned = Math.abs(seg.x0 - b.x0) < 2.5 * b.size;
      const centered = Math.abs((seg.x0 + seg.x1) / 2 - (b.x0 + b.x1) / 2) < b.size;
      if (!leftAligned && !centered) continue;
      const blockWidth = b.x1 - b.x0;
      const lastText = last.text.trim();
      const segText = seg.text.trim();
      const lastEndsPunct = /[.:;?!]$/.test(lastText);
      const segStartsUpper = /^[\p{Lu}\p{N}(]/u.test(segText);
      // Dòng trước ngắn bất thường (ngắt đoạn): hoặc khối >= 2 dòng, hoặc dòng trước kết thúc bằng dấu chấm và dòng sau viết hoa
      const prevShort = (b.lines.length >= 2 && last.x1 < b.x1 - Math.max(2.5 * b.size, 0.12 * blockWidth)) ||
        (lastEndsPunct && segStartsUpper && last.x1 < b.x1 - 1.5 * b.size);
      // Dòng sau thụt vào sâu hơn dòng đầu (mở đoạn mới):
      const indentStart = seg.x0 > b.x0 + 0.7 * b.size && seg.x1 > b.x1 - 1.5 * b.size;
      if ((prevShort && !centered) || indentStart) continue;
      if (gap < bestGap) { bestGap = gap; bestBlock = b; }
    }
    if (bestBlock) {
      bestBlock.lines.push(seg);
      bestBlock.x0 = Math.min(bestBlock.x0, seg.x0);
      bestBlock.x1 = Math.max(bestBlock.x1, seg.x1);
    } else {
      work.push({ lines: [seg], x0: seg.x0, x1: seg.x1, size: seg.size, bold: seg.bold });
    }
  }

  const blocks = work.map(b => finalizeBlock(b, pageWidth));
  // Khối 1 dòng nằm sát lề phải của vùng nội dung (tiêu đề chạy, số trang…) → căn phải
  const rightEdge = Math.max(...blocks.map(b => b.x1));
  const inHeaderFooter = (b: LayoutBlock) => b.bottom < pageHeight * 0.1 || b.top > pageHeight * 0.9;
  for (const b of blocks) {
    if (b.lineCount === 1 && b.align === 'left' && !b.leader && inHeaderFooter(b) &&
        b.x0 > pageWidth * 0.4 && Math.abs(b.x1 - rightEdge) < 0.8 * b.size) b.align = 'right';
  }
  // Khối 1 dòng nằm giữa trang (tiêu đề chạy, tên chương) → căn giữa
  for (const b of blocks) {
    if (b.align === 'left' && b.lineCount === 1 && !b.leader && b.x0 > pageWidth * 0.15 &&
        Math.abs((b.x0 + b.x1) / 2 - pageWidth / 2) < pageWidth * 0.015) b.align = 'center';
  }
  // Cột nhãn căn phải (nhãn hình nằm bên trái ảnh): ≥2 khối ngắn cùng cỡ, chung mép phải, khác mép trái
  for (const b of blocks) {
    if (b.align !== 'left' || b.leader || b.lineCount > 3) continue;
    const similar = (o: LayoutBlock) => o !== b && o.lineCount <= 3 && Math.abs(o.size - b.size) < 0.2 * b.size;
    const sameRight = blocks.filter(o => similar(o) && Math.abs(o.x1 - b.x1) < 0.4 * b.size);
    const ragged = sameRight.filter(o => Math.abs(o.x0 - b.x0) > 1.5 * b.size).length;
    const sameLeft = blocks.filter(o => similar(o) && Math.abs(o.x0 - b.x0) < 0.4 * b.size).length;
    // Mép phải trùng mép một cột văn bản (đoạn nhiều dòng) → đó là lề cột, không phải cột nhãn căn phải
    const columnEdge = blocks.some(o => o !== b && o.lineCount >= 2 && Math.abs(o.x1 - b.x1) < 0.6 * b.size &&
      (o.align === 'justify' || o.lineCount >= 3));
    if (!columnEdge && sameRight.length >= 2 && ragged >= 1 && sameRight.length > sameLeft) b.align = 'right';
  }
  return orderForReading(blocks, pageWidth, gutters);
}

function finalizeBlock(b: WorkBlock, pageWidth: number): LayoutBlock {
  const lines = b.lines;
  const first = lines[0];
  const last = lines[lines.length - 1];
  const gaps = lines.slice(1).map((l, i) => l.y - lines[i].y);
  const leading = gaps.length ? median(gaps) : b.size * 1.2;

  // Ghép run của các dòng
  const runs: Run[] = [];
  for (const l of lines) {
    const lr = l.runs.map(r => ({ ...r }));
    if (lr.length) lr[0].text = lr[0].text.trimStart();
    if (lr.length) lr[lr.length - 1].text = lr[lr.length - 1].text.trimEnd();
    if (runs.length && lr.length) {
      const prev = runs[runs.length - 1];
      if (/\p{L}-$/u.test(prev.text) && /^\p{Ll}/u.test(lr[0].text)) prev.text = prev.text.slice(0, -1);
      else prev.text += ' ';
    }
    for (const r of lr) {
      const p = runs[runs.length - 1];
      if (p && sameStyle(p, r)) p.text += r.text;
      else runs.push(r);
    }
  }

  // Kiểu chủ đạo theo số chữ cái
  const tally = new Map<string, { style: RunStyle; n: number }>();
  for (const r of runs) {
    const key = `${r.bold}|${r.italic}|${isDark(r.color) ? 'dark' : `${Math.round((r.color!.r) / 40)},${Math.round(r.color!.g / 40)},${Math.round(r.color!.b / 40)}`}`;
    const e = tally.get(key) || { style: { bold: r.bold, italic: r.italic, color: r.color }, n: 0 };
    e.n += Math.max(0.5, letterCount(r.text));
    tally.set(key, e);
  }
  let baseStyle: RunStyle = { bold: b.bold, italic: false, color: null };
  let bestN = -1;
  tally.forEach(e => { if (e.n > bestN) { bestN = e.n; baseStyle = e.style; } });

  // Văn bản có thẻ cho các run khác kiểu chủ đạo
  const styles: RunStyle[] = [];
  let text = '';
  let plain = '';
  for (const r of runs) {
    plain += r.text;
    if (sameStyle(r, baseStyle) || letterCount(r.text) === 0) { text += r.text; continue; }
    let k = styles.findIndex(s => sameStyle(s, r));
    if (k < 0) { styles.push({ bold: r.bold, italic: r.italic, color: r.color }); k = styles.length - 1; }
    // Dấu câu/khoảng trắng ở hai đầu để ngoài thẻ
    const mm = r.text.match(/^([^\p{L}\p{N}]*)([\s\S]*?[\p{L}\p{N}])([^\p{L}\p{N}]*)$/u);
    if (!mm) { text += r.text; continue; }
    text += `${mm[1]}<${k + 1}>${mm[2]}</${k + 1}>${mm[3]}`;
  }
  text = text.replace(/\s+/g, ' ').trim();
  plain = plain.replace(/\s+/g, ' ').trim();

  const width = b.x1 - b.x0;
  let align: BlockAlign = 'left';
  if (lines.length >= 3) {
    const body = lines.slice(0, -1);
    const full = body.filter(l => l.x1 >= b.x1 - 0.6 * b.size).length;
    if (full / body.length >= 0.7) align = 'justify';
  }
  if (align === 'left' && lines.length >= 2) {
    const center = (b.x0 + b.x1) / 2;
    const allCentered = lines.every(l => Math.abs((l.x0 + l.x1) / 2 - center) < 0.6 * b.size);
    const someShorter = lines.some(l => l.x1 - l.x0 < width - 2 * b.size);
    if (allCentered && someShorter) align = 'center';
  }
  if (align === 'left' && lines.length >= 2) {
    const allRight = lines.every(l => Math.abs(l.x1 - b.x1) < 0.6 * b.size);
    const ragged = lines.some(l => l.x0 > b.x0 + 2 * b.size);
    if (allRight && ragged) align = 'right';
  }
  if (align === 'left' && lines.length === 1 && b.bold && !last.leader) {
    const center = (b.x0 + b.x1) / 2;
    if (Math.abs(center - pageWidth / 2) < 0.02 * pageWidth && width < 0.8 * pageWidth) align = 'center';
  }

  const firstOffset = Math.max(0, first.x0 - b.x0);
  const restOffset = lines.length > 1 ? Math.max(0, median(lines.slice(1).map(l => l.x0)) - b.x0) : 0;

  const count = (f: (s: Segment) => boolean) => lines.filter(f).length / lines.length;
  return {
    id: '',
    text,
    plain,
    styles,
    baseStyle,
    x0: b.x0,
    x1: b.x1,
    top: first.y - 0.9 * b.size,
    bottom: last.y + 0.28 * b.size,
    size: b.size,
    leading,
    lineCount: lines.length,
    firstOffset: firstOffset > 0.4 * b.size ? firstOffset : 0,
    restOffset: restOffset > 0.4 * b.size ? restOffset : 0,
    bold: baseStyle.bold,
    italic: baseStyle.italic || count(s => s.italic) > 0.5,
    serif: count(s => s.serif) >= 0.5,
    align,
    translatable: isTranslatableText(plain),
    leader: last.leader ? { num: last.leader.num, right: last.x1 } : undefined,
    bodyRight: last.leader && lines.length > 1 ? Math.max(...lines.slice(0, -1).map(l => l.x1)) : undefined,
    hScale: median(lines.map(l => l.hScale)) || 1,
  };
}

/** Đường chia cột: vị trí x mà nhiều khối nằm gọn bên trái/bên phải nhất (null nếu trang 1 cột). */
function findColumnSplit(blocks: LayoutBlock[], pageWidth: number): number | null {
  const body = blocks.filter(b => b.translatable && b.lineCount >= 2);
  if (body.length < 2) return null;
  const cands = new Set<number>();
  for (const b of blocks) { cands.add(b.x1 + 1); cands.add(b.x0 - 1); }
  let best: number | null = null, bestScore = 0;
  for (const x of cands) {
    if (x < 0.3 * pageWidth || x > 0.7 * pageWidth) continue;
    const left = body.filter(b => b.x1 <= x).length;
    const right = body.filter(b => b.x0 >= x).length;
    const cross = body.filter(b => b.x0 < x && b.x1 > x).length;
    if (!left || !right) continue;
    const score = left + right - 2 * cross;
    if (score > bestScore) { bestScore = score; best = x; }
  }
  return best;
}

function orderForReading(blocks: LayoutBlock[], pageWidth: number, gutters: number[] = []): LayoutBlock[] {
  // Trang nhiều cột: đọc hết cột trái (trên → dưới) rồi mới sang cột kế bên phải.
  // Khối vắt qua khe cột (tiêu đề ngang trang, hình rộng) chia trang thành các dải.
  const splits = gutters.length ? [...gutters].sort((a, b) => a - b) : [findColumnSplit(blocks, pageWidth) ?? pageWidth / 2];
  const crosses = (b: LayoutBlock) => splits.some(x => b.x0 < x - 2 && b.x1 > x + 2 &&
    (b.x1 - b.x0 > 0.3 * pageWidth || Math.min(x - b.x0, b.x1 - x) > 0.15 * (b.x1 - b.x0)));
  const colOf = (b: LayoutBlock) => splits.filter(x => (b.x0 + b.x1) / 2 >= x).length;
  const byTop = [...blocks].sort((a, b) => a.top - b.top);
  const result: LayoutBlock[] = [];
  let band: LayoutBlock[] = [];
  const flushBand = () => {
    for (let c = 0; c <= splits.length; c++) {
      result.push(...band.filter(b => colOf(b) === c).sort((a, b) => a.top - b.top || a.x0 - b.x0));
    }
    band = [];
  };
  for (const b of byTop) {
    if (crosses(b)) { flushBand(); result.push(b); } else band.push(b);
  }
  flushBand();
  return result.map((b, i) => ({ ...b, id: `b${i + 1}` }));
}

/* ------------------------------------------------------------------ */
/* 3. Vẽ chữ nhiều kiểu                                                */
/* ------------------------------------------------------------------ */

export const SERIF_STACK = '"Tinos", "Liberation Serif", "Times New Roman", Times, serif';
export const SANS_STACK = '"Arimo", "Liberation Sans", Arial, Helvetica, sans-serif';

function fontCss(style: RunStyle, serif: boolean, sizePx: number): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700' : '400'} ${sizePx.toFixed(2)}px ${serif ? SERIF_STACK : SANS_STACK}`;
}

interface Piece { text: string; style: RunStyle; }
type Word = Piece[];

/** Bản dịch có thẻ <n>…</n> → danh sách từ, mỗi từ gồm các mảnh có kiểu chữ riêng. */
function parseRich(translated: string, b: LayoutBlock, base: RunStyle): Word[] {
  const pieces: Piece[] = [];
  const re = /<(\d+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  translated = translated.replace(/<\/?(?!\d+>)[a-zA-Z][^>]*>/g, ''); // thẻ HTML lạ AI tự thêm (<i>, <b>, <sup>…)
  const clean = (t: string) => t.replace(/<\/?\d+>/g, '');
  while ((m = re.exec(translated))) {
    if (m.index > last) pieces.push({ text: clean(translated.slice(last, m.index)), style: base });
    const st = b.styles[parseInt(m[1], 10) - 1];
    pieces.push({ text: clean(m[2]), style: st ? { ...st, color: st.color ?? base.color } : base });
    last = re.lastIndex;
  }
  if (last < translated.length) pieces.push({ text: clean(translated.slice(last)), style: base });

  const words: Word[] = [];
  let cur: Word = [];
  for (const p of pieces) {
    const parts = p.text.split(/(\s+)/);
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        if (cur.length) { words.push(cur); cur = []; }
      } else {
        cur.push({ text: part, style: p.style });
      }
    }
  }
  if (cur.length) words.push(cur);
  return words;
}

class Measurer {
  private cache = new Map<string, number>();
  constructor(private ctx: CanvasRenderingContext2D) {}
  width(text: string, font: string): number {
    const key = font + '\u0000' + text;
    let w = this.cache.get(key);
    if (w === undefined) {
      this.ctx.font = font;
      w = this.ctx.measureText(text).width;
      this.cache.set(key, w);
    }
    return w;
  }
}

interface LaidOut {
  lines: Word[][];
  size: number;
  lineH: number;
  height: number;
}

function wordWidth(m: Measurer, w: Word, serif: boolean, size: number, hs = 1) {
  return w.reduce((s, p) => s + m.width(p.text, fontCss(p.style, serif, size)), 0) * hs;
}

function layoutWords(
  m: Measurer, words: Word[], b: LayoutBlock, base: RunStyle, width: number, size: number, lineRatio: number,
  useBodyRight = true,
): LaidOut {
  if (useBodyRight && b.bodyRight) {
    // Ưu tiên ngắt dòng giống bản gốc; nếu vì thế mà thêm dòng thì dùng hết chiều rộng
    const a = layoutWords(m, words, b, base, width, size, lineRatio, false);
    const c = layoutWordsInner(m, words, b, base, width, size, lineRatio, true);
    return c.lines.length <= Math.max(a.lines.length, b.lineCount) ? c : a;
  }
  return layoutWordsInner(m, words, b, base, width, size, lineRatio, useBodyRight);
}

function layoutWordsInner(
  m: Measurer, words: Word[], b: LayoutBlock, base: RunStyle, width: number, size: number, lineRatio: number,
  useBodyRight: boolean,
): LaidOut {
  const serif = b.serif;
  const hs = b.hScale || 1;
  const space = m.width(' ', fontCss(base, serif, size)) * hs;
  const scale = size / b.size;
  const lineWidth = (i: number) => {
    const w = width - (i === 0 ? b.firstOffset : b.restOffset) * scale;
    // Mục lục nhiều dòng: các dòng trên ngắt như bản gốc (chừa khoảng cho số trang)
    return useBodyRight && b.bodyRight ? Math.min(w, b.bodyRight + 0.5 * b.size - b.x0) : w;
  };
  const lines: Word[][] = [];
  let line: Word[] = [];
  let lw = 0;
  for (const w of words) {
    const ww = wordWidth(m, w, serif, size, hs);
    const limit = lineWidth(lines.length);
    if (line.length && lw + space + ww > limit) {
      lines.push(line);
      line = [w];
      lw = ww;
    } else {
      lw += (line.length ? space : 0) + ww;
      line.push(w);
    }
  }
  if (line.length) lines.push(line);

  // Dòng mục lục: chừa chỗ cho dấu chấm dẫn + số trang ở dòng cuối
  if (b.leader && lines.length) {
    const numW = (b.leader.num ? m.width(b.leader.num, fontCss(base, serif, size)) : 0) * hs;
    const reserve = numW + m.width(' . . . ', fontCss(base, serif, size)) * hs;
    const lastIdx = lines.length - 1;
    const lastW = lines[lastIdx].reduce((s, w, i) => s + wordWidth(m, w, serif, size, hs) + (i ? space : 0), 0);
    if (lastW + reserve > lineWidth(lastIdx) && lines[lastIdx].length > 1) {
      const moved = lines[lastIdx].pop()!;
      lines.push([moved]);
    }
  }

  const lineH = size * lineRatio;
  return { lines, size, lineH, height: (lines.length - 1) * lineH + size * 1.2 };
}

function drawLaidOut(
  ctx: CanvasRenderingContext2D, m: Measurer, lo: LaidOut, b: LayoutBlock, base: RunStyle,
  x0: number, width: number, top: number,
) {
  const serif = b.serif;
  const size = lo.size;
  const scale = size / b.size;
  const hs = b.hScale || 1;
  const space = m.width(' ', fontCss(base, serif, size)) * hs;
  ctx.textBaseline = 'alphabetic';
  const put = (text: string, x: number, y: number) => {
    if (hs === 1) { ctx.fillText(text, x, y); return; }
    ctx.save(); ctx.translate(x, y); ctx.scale(hs, 1); ctx.fillText(text, 0, 0); ctx.restore();
  };
  let y = top + size * 0.93;
  lo.lines.forEach((line, i) => {
    const isLast = i === lo.lines.length - 1;
    const offset = (i === 0 ? b.firstOffset : b.restOffset) * scale;
    const avail = width - offset;
    const widths = line.map(w => wordWidth(m, w, serif, size, hs));
    const natural = widths.reduce((s, w) => s + w, 0) + space * Math.max(0, line.length - 1);
    let x = x0 + offset;
    let gap = space;
    if (b.align === 'center') {
      x += Math.max(0, (avail - natural) / 2);
    } else if (b.align === 'right') {
      x += Math.max(0, avail - natural);
    } else if (b.align === 'justify' && !isLast && line.length > 1) {
      const g = (avail - widths.reduce((s, w) => s + w, 0)) / (line.length - 1);
      if (g > space * 0.8 && g < size * 2.2) gap = g; // căn đều mọi dòng trừ dòng cuối, như bản in
    }
    line.forEach((w, wi) => {
      for (const p of w) {
        const font = fontCss(p.style, serif, size);
        ctx.font = font;
        ctx.fillStyle = p.style.color ? rgbCss(p.style.color) : '#1a1a1a';
        put(p.text, x, y);
        x += m.width(p.text, font) * hs;
      }
      if (wi < line.length - 1) x += gap;
    });
    if (isLast && b.leader) {
      const font = fontCss(base, serif, size);
      ctx.font = font;
      ctx.fillStyle = base.color ? rgbCss(base.color) : '#1a1a1a';
      const right = b.leader.right;
      const numW = (b.leader.num ? m.width(b.leader.num, font) : 0) * hs;
      const dot = m.width('.', font) * hs;
      const step = dot + m.width(' ', font) * 0.6 * hs;
      let dx = x + space;
      const stopX = right - numW - (b.leader.num ? space : 0);
      while (dx + dot <= stopX) { put('.', dx, y); dx += step; }
      if (b.leader.num) put(b.leader.num, right - numW, y);
    }
    y += lo.lineH;
  });
}

/* ------------------------------------------------------------------ */
/* 4. Dàn trang                                                        */
/* ------------------------------------------------------------------ */

function freeBelow(img: ImageData, b: LayoutBlock, bg: RGB, limitY: number): number {
  const W = img.width, d = img.data;
  const xa = Math.max(0, Math.floor(b.x0)), xb = Math.min(W, Math.ceil(b.x1));
  const startY = Math.ceil(b.bottom + 1);
  const maxY = Math.min(Math.floor(limitY), img.height - 1);
  if (startY >= maxY) return 0;
  for (let y = startY; y < maxY; y++) {
    for (let x = xa; x < xb; x += 2) {
      const i = (y * W + x) * 4;
      if (Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b) > 45) {
        return Math.max(0, y - startY - 3);
      }
    }
  }
  return maxY - startY;
}

function freeSide(img: ImageData, b: LayoutBlock, bg: RGB, fromX: number, toX: number): number {
  const W = img.width, d = img.data;
  const ya = Math.max(0, Math.floor(b.top)), yb = Math.min(img.height, Math.ceil(b.bottom));
  const dir = toX >= fromX ? 1 : -1;
  const span = Math.floor(Math.abs(toX - fromX));
  for (let k = 0; k < span; k++) {
    const x = Math.round(fromX + dir * k);
    if (x < 0 || x >= W) return Math.max(0, k - 0.5 * b.size);
    for (let y = ya; y < yb; y += 2) {
      const i = (y * W + x) * 4;
      if (Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b) > 45) {
        return Math.max(0, k - 0.5 * b.size);
      }
    }
  }
  return span;
}

interface BlockInfo {
  stats: RegionStats;
  free: number;
  extLeft: number;
  extRight: number;
  extLeftAvail: number; // chỗ trống bên trái (dùng khi bên phải hết chỗ)
  base: RunStyle;
  words: Word[];
}

/**
 * Vẽ bản dịch lên canvas đã render trang gốc.
 * translations: id khối → bản dịch (có thể chứa thẻ <n>…</n>). Khối không có bản dịch giữ nguyên.
 */
export function paintTranslatedPage(
  ctx: CanvasRenderingContext2D,
  allBlocks: LayoutBlock[],
  translations: Record<string, string>,
): PaintReport {
  const report: PaintReport = { painted: 0, overflowIds: [], shrunkIds: [] };
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const m = new Measurer(ctx);
  const norm = (t: string) => t.replace(/<\/?[a-zA-Z0-9][^>]*>/g, '').replace(/\s+/g, ' ').trim();
  // Chữ xoay 90° được vẽ riêng ở cuối; phần dàn trang bên dưới chỉ xử lý chữ ngang
  const blocks = allBlocks.filter(b => !b.rotate);
  const rotatedTargets = allBlocks.filter(b => {
    const t = translations[b.id];
    return b.rotate && b.translatable && t && norm(t) && norm(t) !== b.plain;
  });

  const targets = blocks.filter(b => {
    const t = translations[b.id];
    return b.translatable && t && norm(t) && norm(t) !== b.plain;
  });

  /* --- Phân tích trước khi xoá --- */
  const info = new Map<string, BlockInfo>();
  for (const b of targets) {
    const padX = 0.15 * b.size;
    const stats = regionStats(img, b.x0 - padX, b.top - 0.05 * b.size, b.x1 + padX, b.bottom + 0.1 * b.size);
    let limit = H * 0.985;
    for (const o of blocks) {
      if (o === b || o.top <= b.bottom - 1) continue;
      if (Math.min(o.x1, b.x1) - Math.max(o.x0, b.x0) > 0 && o.top < limit) limit = o.top - 0.15 * o.size;
    }
    const free = freeBelow(img, b, stats.bg, limit);

    let extLeft = 0, extRight = 0, extLeftAvail = 0;
    if (b.lineCount === 1 && !b.leader) {
      let right = W * 0.96, left = W * 0.04;
      const col = blocks.filter(o => o !== b && o.lineCount >= 2 && o.x0 < b.x1 && o.x1 > b.x0);
      if (col.length) {
        right = Math.min(right, Math.max(...col.map(o => o.x1)));
        left = Math.max(left, Math.min(...col.map(o => o.x0)));
      }
      for (const o of blocks) {
        if (o === b || o.top >= b.bottom || o.bottom <= b.top) continue;
        if (o.x0 >= b.x1 - 1) right = Math.min(right, o.x0 - 0.8 * b.size);
        if (o.x1 <= b.x0 + 1) left = Math.max(left, o.x1 + 0.8 * b.size);
      }
      extRight = right > b.x1 ? freeSide(img, b, stats.bg, b.x1 + 0.15 * b.size, right) : 0;
      if (b.align === 'center') {
        const extL = left < b.x0 ? freeSide(img, b, stats.bg, b.x0 - 0.15 * b.size, left) : 0;
        extLeft = extRight = Math.min(extL, extRight);
      } else if (b.align === 'right') {
        extLeft = left < b.x0 ? freeSide(img, b, stats.bg, b.x0 - 0.15 * b.size, left) : 0;
        extRight = 0;
      } else {
        extLeftAvail = left < b.x0 ? freeSide(img, b, stats.bg, b.x0 - 0.15 * b.size, left) : 0;
      }
    }

    const base: RunStyle = { ...b.baseStyle, color: b.baseStyle.color && !isDark(b.baseStyle.color) ? b.baseStyle.color : (stats.fg ?? b.baseStyle.color) };
    info.set(b.id, { stats, free, extLeft, extRight, extLeftAvail, base, words: parseRich(translations[b.id], b, base) });
  }

  /* --- Ký hiệu đầu dòng / số thứ tự đi kèm mỗi mục: di chuyển cùng mục khi mục bị đẩy xuống --- */
  const companion = new Map<string, { L: LayoutBlock; patch: ImageData; x: number; y: number; bg: RGB }>();
  const companionIds = new Set<string>();
  for (const b of targets) {
    let best: LayoutBlock | null = null;
    for (const L of blocks) {
      if (L === b || L.lineCount !== 1 || !LABEL_RE.test(L.plain)) continue;
      if (L.x1 > b.x0 + 1 || b.x0 - L.x1 > 3 * b.size || Math.abs(L.top - b.top) > 0.5 * b.size) continue;
      if (!best || L.x1 > best.x1) best = L;
    }
    if (!best) continue;
    const x = Math.max(0, Math.floor(best.x0 - 0.1 * best.size));
    const y = Math.max(0, Math.floor(best.top - 0.05 * best.size));
    const w = Math.min(W - x, Math.ceil(best.x1 - best.x0 + 0.2 * best.size));
    const h = Math.min(H - y, Math.ceil(best.bottom - best.top + 0.15 * best.size));
    if (w <= 0 || h <= 0) continue;
    companion.set(b.id, { L: best, patch: ctx.getImageData(x, y, w, h), x, y, bg: regionStats(img, x, y, x + w, y + h).bg });
    companionIds.add(best.id);
  }

  /* --- Nhóm chảy: các khối liền nhau trong cùng cột --- */
  const groups: LayoutBlock[][] = [];
  const byTop = [...targets].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  const groupOf = new Map<string, LayoutBlock[]>();
  for (const b of byTop) {
    let joined = false;
    for (const g of groups) {
      const L = g[g.length - 1];
      const li = info.get(L.id)!, bi = info.get(b.id)!;
      const overlap = Math.min(L.x1, b.x1) - Math.max(L.x0, b.x0);
      if (overlap < 0.6 * Math.min(L.x1 - L.x0, b.x1 - b.x0)) continue;
      const gap = b.top - L.bottom;
      if (gap < -0.3 * Math.min(L.size, b.size) || gap > 2.6 * Math.max(L.size, b.size)) continue;
      if (colorDist(li.stats.bg, bi.stats.bg) > 30) continue;
      if (li.free < gap - 0.2 * b.size - 4) continue; // giữa hai khối có hình/đường kẻ
      const between = blocks.some(o => o !== L && o !== b && !companionIds.has(o.id) && o.top >= L.bottom - 1 && o.bottom <= b.top + 1 &&
        Math.min(o.x1, b.x1) - Math.max(o.x0, b.x0) > 0);
      if (between) continue;
      g.push(b);
      groupOf.set(b.id, g);
      joined = true;
      break;
    }
    if (!joined) {
      const g = [b];
      groups.push(g);
      groupOf.set(b.id, g);
    }
  }

  /* --- Dàn từng nhóm --- */
  // "Bạn cùng hàng": khối khác nằm ngang hàng (số mục, số trang, ô bảng bên cạnh) → không được đẩy dòng xuống
  const hasRowMate = (b: LayoutBlock, g: LayoutBlock[]) => blocks.some(o =>
    o !== b && !g.includes(o) && !companionIds.has(o.id) &&
    (o.x1 <= b.x0 + 1 || o.x0 >= b.x1 - 1) &&
    Math.abs(o.top - b.top) < 0.6 * Math.min(o.size, b.size));

  const plans: { b: LayoutBlock; lo: LaidOut; top: number; x0: number; width: number; orig: LayoutBlock }[] = [];
  const rowMate = new Set(targets.filter(b => hasRowMate(b, [b])).map(b => b.id)); // ô bảng, mục có bạn cùng hàng
  const fitGroup = (g: LayoutBlock[], sMax: number) => {
    const lastI = info.get(g[g.length - 1].id)!;
    const availBottom = g[g.length - 1].bottom + lastI.free;
    const gaps = g.slice(1).map((b, i) => Math.max(0, b.top - g[i].bottom));
    const cascade = g.length > 1 && !g.some(b => hasRowMate(b, g));
    const widthOf = (b: LayoutBlock) => { const inf = info.get(b.id)!; return Math.max(b.x1 - b.x0 + inf.extLeft + inf.extRight, b.size * 2); };

    let overrides: ({ x0: number; width: number } | null)[] = [];
    const tryFit = (s: number, tight: number) => {
      overrides = g.map(() => null);
      const los: LaidOut[] = [];
      const tops: number[] = [];
      let y = g[0].top;
      let fits = true;
      g.forEach((b, i) => {
        const inf = info.get(b.id)!;
        const ratio = Math.min(1.6, Math.max(1.05, (b.leading / b.size) * tight));
        let lo = layoutWords(m, inf.words, b, inf.base, widthOf(b), b.size * s, ratio);
        overrides[i] = null;
        if (b.lineCount === 1 && b.align === 'left' && lo.lines.length > 1 && inf.extLeftAvail > b.size && !rowMate.has(b.id)) {
          // Bên phải hết chỗ → mượn chỗ bên trái, giữ mép phải (giống tiêu đề/nhãn căn phải)
          const wide = layoutWords(m, inf.words, { ...b, align: 'right' }, inf.base, widthOf(b) + inf.extLeftAvail, b.size * s, ratio);
          if (wide.lines.length < lo.lines.length) {
            lo = wide;
            overrides[i] = { x0: b.x0 - inf.extLeft - inf.extLeftAvail, width: widthOf(b) + inf.extLeftAvail };
          }
        }
        if (b.lineCount === 1 && lo.lines.length > 1 && inf.free < 0.6 * b.size) {
          // Không còn chỗ bên dưới (tiêu đề trên thanh màu, nhãn sát hình) → thu nhỏ riêng khối này để giữ 1 dòng
          for (let s2 = s - 0.03; s2 >= 0.6 - 1e-6; s2 -= 0.03) {
            const ov = overrides[i];
            const one = layoutWords(m, inf.words, ov ? { ...b, align: 'right' } : b, inf.base, ov ? ov.width : widthOf(b), b.size * s2, ratio);
            if (one.lines.length === 1) { lo = one; break; }
          }
        }
        los.push(lo);
        if (cascade) {
          // Giữ đúng vị trí gốc để dễ đối chiếu; chỉ đẩy xuống khi khối phía trên dài hơn chỗ của nó
          const top = Math.max(b.top, y);
          tops.push(top);
          y = top + lo.height + (i < gaps.length ? gaps[i] * Math.max(0.6, s) : 0);
        } else {
          // Giữ nguyên vị trí: mỗi khối chỉ được dùng tới đầu khối kế tiếp (hoặc khoảng trống thật bên dưới)
          tops.push(b.top);
          const limit = i < g.length - 1 ? g[i + 1].top - 0.1 * b.size : b.bottom + inf.free;
          if (b.top + lo.height > limit + 0.5) fits = false;
        }
      });
      if (cascade && y > availBottom + 0.5) fits = false;
      return { fits, los, tops };
    };

    let chosen: { s: number; los: LaidOut[]; tops: number[] } | null = null;
    outer:
    for (let s = sMax; s >= 0.68 - 1e-6; s -= 0.02) {
      for (const tight of [1, 0.93, 0.88]) {
        const r = tryFit(s, tight);
        if (r.fits) { chosen = { s, ...r }; break outer; }
      }
    }
    let overflow = false;
    if (!chosen) {
      const r = tryFit(0.68, 0.88);
      chosen = { s: 0.68, ...r };
      overflow = true;
    }
    return { ...chosen, overrides: chosen.los.length ? overrides.slice() : g.map(() => null), overflow, widthOf };
  };

  // Lượt 1: mỗi nhóm tự tìm cỡ chữ lớn nhất vừa khung
  const fitted = groups.map(g => fitGroup(g, 1));

  // Lượt 2: cỡ chữ đồng đều — các đoạn thân bài cùng cỡ gốc dùng chung một tỉ lệ (giống bản in),
  // trừ nhóm nào buộc phải nhỏ hơn hẳn mặt bằng chung.
  const letters = (g: LayoutBlock[]) => g.reduce((n, b) => n + b.plain.length, 0);
  const groupSize = (g: LayoutBlock[]) => median(g.map(b => b.size));
  const sizeVotes: number[] = [];
  groups.forEach(g => { for (let i = 0; i < Math.min(60, letters(g) / 20); i++) sizeVotes.push(Math.round(groupSize(g) * 2) / 2); });
  const bodySize = median(sizeVotes);
  const isBody = (g: LayoutBlock[]) => Math.abs(groupSize(g) - bodySize) <= 0.06 * bodySize && letters(g) > 60 &&
    !g.some(b => rowMate.has(b.id));
  const bodyIdx = groups.map((g, i) => i).filter(i => isBody(groups[i]) && !fitted[i].overflow);
  if (bodyIdx.length >= 2) {
    const ss = bodyIdx.map(i => fitted[i].s);
    const shared = Math.max(Math.min(...ss), median(ss) - 0.15);
    for (const i of bodyIdx) {
      if (fitted[i].s > shared + 0.005) fitted[i] = fitGroup(groups[i], shared);
    }
  }

  groups.forEach((g, gi) => {
    const chosen = fitted[gi];
    if (chosen.overflow) report.overflowIds.push(...g.map(b => b.id));
    else if (chosen.s < 0.985) report.shrunkIds.push(...g.map(b => b.id));
    g.forEach((b, i) => {
      const inf = info.get(b.id)!;
      const ov = chosen.overrides[i];
      plans.push(ov
        ? { b: { ...b, align: 'right' }, lo: chosen.los[i], top: chosen.tops[i], x0: ov.x0, width: ov.width, orig: b }
        : { b, lo: chosen.los[i], top: chosen.tops[i], x0: b.x0 - inf.extLeft, width: chosen.widthOf(b), orig: b });
    });
  });

  /* --- Giữ lại các khối không dịch (số mục "1.1", số trang, ký hiệu…) nằm lọt trong vùng sẽ xoá --- */
  const targetIds = new Set(targets.map(t => t.id));
  const keepPatches: { patch: ImageData; x: number; y: number }[] = [];
  for (const o of blocks) {
    if (targetIds.has(o.id) || companionIds.has(o.id)) continue;
    const hit = targets.some(b => {
      const plan = plans.find(p => p.orig === b);
      const x0 = Math.min(b.x0, plan ? plan.x0 : b.x0), x1 = Math.max(b.x1, plan ? plan.x0 + plan.width : b.x1);
      const bottom = Math.max(b.bottom, plan ? plan.top + plan.lo.height : b.bottom);
      return o.x0 < x1 && o.x1 > x0 && o.top < bottom && o.bottom > b.top;
    });
    if (!hit) continue;
    const x = Math.max(0, Math.floor(o.x0 - 0.05 * o.size));
    const y = Math.max(0, Math.floor(o.top));
    const w = Math.min(W - x, Math.ceil(o.x1 - o.x0 + 0.1 * o.size));
    const h = Math.min(H - y, Math.ceil(o.bottom - o.top + 0.05 * o.size));
    if (w > 0 && h > 0) keepPatches.push({ patch: ctx.getImageData(x, y, w, h), x, y });
  }

  /* --- Xoá chữ gốc (cả khoảng giữa các khối trong nhóm và phần giãn) --- */
  for (const b of targets) {
    const inf = info.get(b.id)!;
    const g = groupOf.get(b.id)!;
    const idx = g.indexOf(b);
    const padX = 0.15 * b.size;
    const plan = plans.find(p => p.orig === b)!;
    let bottom = b.bottom + 0.1 * b.size;
    if (idx < g.length - 1) bottom = Math.max(bottom, g[idx + 1].top);
    bottom = Math.max(bottom, plan.top + plan.lo.height + 0.15 * b.size);
    // Mép trên theo mực thật: cỡ chữ ước lượng có thể thấp hơn chữ in (tiêu đề font đặc biệt) → còn sót đầu chữ gốc
    let top = b.top - 0.05 * b.size;
    {
      const bg = inf.stats.bg, d = img.data;
      const xa = Math.max(0, Math.floor(b.x0)), xb = Math.min(W, Math.ceil(b.x1));
      let ceiling = Math.max(0, b.top - 0.6 * b.size);
      for (const o of blocks) { // không lấn vào khối khác phía trên
        if (o === b || o.bottom > b.top + 1 || o.x1 <= b.x0 || o.x0 >= b.x1) continue;
        ceiling = Math.max(ceiling, o.bottom + 1);
      }
      for (let y = Math.floor(top) - 1; y >= ceiling; y--) {
        let ink = 0;
        for (let x = xa; x < xb; x += 2) {
          const i = (y * W + x) * 4;
          if (Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b) > 90) ink++;
        }
        if (ink === 0 || ink > 0.6 * (xb - xa) / 2) break; // hết mực, hoặc gặp đường kẻ ngang → dừng
        top = y - 1;
      }
    }
    ctx.fillStyle = rgbCss(inf.stats.bg);
    ctx.fillRect(Math.min(b.x0, plan.x0) - padX, top, Math.max(b.x1 - b.x0, plan.width) + 2 * padX, bottom - top);
  }
  for (const k of keepPatches) ctx.putImageData(k.patch, k.x, k.y);

  /* --- Dời ký hiệu đầu dòng theo mục (sao chép nguyên điểm ảnh gốc) --- */
  const moves = plans
    .map(p => ({ c: companion.get(p.b.id), shift: Math.round(p.top - p.b.top) }))
    .filter((m): m is { c: NonNullable<typeof m.c>; shift: number } => !!m.c && Math.abs(m.shift) >= 1);
  for (const m of moves) { // lượt 1: xoá hết vị trí cũ
    ctx.fillStyle = rgbCss(m.c.bg);
    ctx.fillRect(m.c.x, m.c.y, m.c.patch.width, m.c.patch.height);
  }
  for (const m of moves) ctx.putImageData(m.c.patch, m.c.x, m.c.y + m.shift); // lượt 2: đặt vào vị trí mới

  /* --- Vẽ --- */
  for (const p of plans) {
    const inf = info.get(p.b.id)!;
    ctx.save();
    drawLaidOut(ctx, m, p.lo, p.b, inf.base, p.x0, p.width, p.top);
    ctx.restore();
    report.painted++;
  }

  /* --- Chữ xoay 90° (nhãn dọc trên hình, chữ dọc lề trang) --- */
  for (const b of rotatedTargets) {
    const len = b.bottom - b.top;          // chiều dài dòng (theo chiều dọc trang)
    const thick = b.x1 - b.x0;             // độ dày khối (theo chiều ngang trang)
    if (len < 4 || thick < 3) continue;
    const pad = 0.12 * b.size;
    const stats = regionStats(img, b.x0 - pad, b.top - pad, b.x1 + pad, b.bottom + pad);
    const base: RunStyle = { ...b.baseStyle, color: stats.fg ?? b.baseStyle.color };
    const words = parseRich(translations[b.id], b, base);
    // Khối ảo nằm ngang: rộng = chiều dài, cao = độ dày
    const vb: LayoutBlock = { ...b, x0: 0, x1: len, top: 0, bottom: thick, rotate: undefined, leader: undefined, bodyRight: undefined };
    let lo: LaidOut | null = null;
    let fitted = false;
    for (let sc = 1; sc >= 0.5 - 1e-6; sc -= 0.03) {
      lo = layoutWords(m, words, vb, base, len, b.size * sc, 1.12);
      if (lo.height <= thick + 0.5 && lo.lines.every(line => line.reduce((w, wd) => w + wordWidth(m, wd, b.serif, b.size * sc), 0) <= len + 0.5)) { fitted = true; break; }
    }
    if (!lo) continue;
    if (!fitted) report.overflowIds.push(b.id);
    ctx.fillStyle = rgbCss(stats.bg);
    ctx.fillRect(b.x0 - pad, b.top - pad, thick + 2 * pad, len + 2 * pad);
    ctx.save();
    if (b.rotate === 'up') { ctx.translate(b.x0, b.bottom); ctx.rotate(-Math.PI / 2); }
    else { ctx.translate(b.x1, b.top); ctx.rotate(Math.PI / 2); }
    const offset = Math.max(0, (thick - lo.height) / 2); // canh giữa theo độ dày
    drawLaidOut(ctx, m, lo, vb, base, 0, len, offset);
    ctx.restore();
    report.painted++;
  }
  return report;
}

/* ------------------------------------------------------------------ */
/* 5. Trang scan: khối chữ từ OCR (AI đọc ảnh)                         */
/* ------------------------------------------------------------------ */

/** Khối chữ AI nhận diện trên ảnh trang. box_2d = [ymin, xmin, ymax, xmax] theo thang 0..1000. */
export interface OcrBlock {
  box_2d: number[];
  text: string;
  v?: string;
  lines?: number;
  bold?: boolean;
  italic?: boolean;
  serif?: boolean;
  align?: string;
  /** Chữ xoay: 'up' (đọc từ dưới lên) | 'down' (từ trên xuống). */
  dir?: string;
}

/**
 * Khối OCR → LayoutBlock. Khung AI trả về chỉ gần đúng → tinh chỉnh theo mực thật trên ảnh
 * (chỉ trong phạm vi nhỏ quanh khung, không lấn sang cột / tiêu đề bên cạnh):
 * mép trên/dưới sát chữ; số dòng và khoảng cách dòng đo bằng hình chiếu ngang (tách dòng tại "thung lũng" mực).
 */
export function blocksFromOcr(ctx: CanvasRenderingContext2D, ocr: OcrBlock[], idPrefix = 'b'): LayoutBlock[] {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const out: LayoutBlock[] = [];

  // Khung AI (pixel)
  type Pre = { o: OcrBlock; X0: number; X1: number; Y0: number; Y1: number; rotate?: 'up' | 'down'; pitch: number };
  const pre: Pre[] = [];
  for (const o of ocr) {
    if (!o || !Array.isArray(o.box_2d) || o.box_2d.length !== 4 || !o.text?.trim()) continue;
    let [ymin, xmin, ymax, xmax] = o.box_2d.map(Number);
    if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) continue;
    if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
    if (xmin > xmax) [xmin, xmax] = [xmax, xmin];
    const X0 = Math.max(0, xmin / 1000 * W), X1 = Math.min(W, xmax / 1000 * W);
    const Y0 = Math.max(0, ymin / 1000 * H), Y1 = Math.min(H, ymax / 1000 * H);
    if (X1 - X0 < 3 || Y1 - Y0 < 3) continue;
    const dir = String(o.dir || '').toLowerCase();
    const rotate = dir === 'up' ? 'up' : dir === 'down' ? 'down' : undefined;
    const n = Math.max(1, Math.round(o.lines || 1));
    pre.push({ o, X0, X1, Y0, Y1, rotate, pitch: (rotate ? X1 - X0 : Y1 - Y0) / n });
  }
  const horiz = pre.filter(p => !p.rotate);
  const xOverlap = (a: Pre, b: Pre) => Math.min(a.X1, b.X1) - Math.max(a.X0, b.X0) > 0.3 * Math.min(a.X1 - a.X0, b.X1 - b.X0);

  for (const P of pre) {
    const { o, X0, X1, Y0, Y1, rotate } = P;
    const text = o.text.replace(/\s+/g, ' ').trim();
    const al = String(o.align || '').toLowerCase();
    const base = {
      id: '', text, plain: text, styles: [] as RunStyle[],
      baseStyle: { bold: !!o.bold, italic: !!o.italic, color: null } as RunStyle,
      firstOffset: 0, restOffset: 0, bold: !!o.bold, italic: !!o.italic, serif: o.serif !== false,
      translatable: isTranslatableText(text), hScale: 1, fromOcr: true,
    };
    if (rotate) {
      const n = Math.max(1, Math.round(o.lines || 1));
      const size = Math.max(5, (X1 - X0) / (1.2 * n - 0.15));
      out.push({ ...base, x0: X0, x1: X1, top: Y0, bottom: Y1, size, leading: size * 1.2, lineCount: n,
        align: (al === 'left' || al === 'right' || al === 'justify') ? al as BlockAlign : 'center', rotate });
      continue;
    }
    const st = regionStats(img, X0, Y0, X1, Y1);
    // Mực = đậm hơn nền rõ rệt (chữ tối trên nền sáng) hoặc sáng hơn hẳn (chữ sáng trên nền tối).
    // Không dùng "khác màu nền" vì vùng nền khác màu bên cạnh (lề trắng cạnh hình) sẽ bị nhầm là chữ.
    const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
    const bgL = lum(st.bg.r, st.bg.g, st.bg.b);
    const darkText = bgL >= 110;
    const ink = (x: number, y: number) => {
      const i = (y * W + x) * 4;
      const L = lum(d[i], d[i + 1], d[i + 2]);
      return darkText ? bgL - L > 70 : L - bgL > 70;
    };
    // 1) Dòng chữ thật quanh khung (nới ±1,5 dòng để bắt dòng bị khung AI cắt hụt)
    const reach = Math.max(6, 2.5 * P.pitch);
    const xa = Math.max(0, Math.floor(X0)), xb = Math.min(W, Math.ceil(X1));
    const ya = Math.max(0, Math.floor(Y0 - reach)), yb = Math.min(H, Math.ceil(Y1 + reach));
    const prof: number[] = [];
    for (let y = ya; y < yb; y++) { let c = 0; for (let x = xa; x < xb; x++) if (ink(x, y)) c++; prof.push(c); }
    // Ngưỡng thấp: dòng cuối rất ngắn ("etc.).") và chân chữ g/p/y vẫn được tính là dòng
    const lowThr = Math.max(1, 0.004 * (xb - xa));
    let runs: { a: number; b: number }[] = [];
    prof.forEach((c, i) => {
      if (c < lowThr) return;
      const y = ya + i, last = runs[runs.length - 1];
      if (last && y - last.b <= 1) last.b = y; else runs.push({ a: y, b: y });
    });
    // Dòng dính nhau (chân chữ dòng trên chạm đầu chữ dòng dưới) → tách tại "thung lũng" mực
    const expectH = Math.max(3, 0.8 * P.pitch);
    runs = runs.flatMap(r => {
      if (r.b - r.a + 1 < 1.6 * expectH) return [r];
      const seg = prof.slice(r.a - ya, r.b - ya + 1);
      const pk = Math.max(...seg);
      const cuts: number[] = [];
      let k = 0;
      while (k < seg.length) {
        if (seg[k] < 0.15 * pk) {
          let j = k; while (j + 1 < seg.length && seg[j + 1] < 0.15 * pk) j++;
          let mi = k; for (let t = k; t <= j; t++) if (seg[t] < seg[mi]) mi = t;
          if (mi > 0.4 * expectH && seg.length - mi > 0.4 * expectH) cuts.push(r.a + mi);
          k = j + 1;
        } else k++;
      }
      const parts: { a: number; b: number }[] = [];
      let start = r.a;
      for (const c of cuts) { if (c - start >= 2) parts.push({ a: start, b: c }); start = c + 1; }
      parts.push({ a: start, b: r.b });
      return parts;
    });
    // Dòng chạm mép vùng dò là dòng bị cắt dở (thuộc khối bên cạnh) → bỏ
    runs = runs.filter(r => (r.a > ya || ya === 0) && (r.b < yb - 1 || yb === H));
    if (runs.length) {
      const hMed = median(runs.map(r => r.b - r.a + 1));
      const merged: { a: number; b: number }[] = [];
      for (const r of runs) { // dấu thanh, chấm chữ i → gộp vào dòng gần nhất
        const last = merged[merged.length - 1];
        if (last && (r.b - r.a + 1 < 0.45 * hMed || last.b - last.a + 1 < 0.45 * hMed) && r.a - last.b < 0.6 * hMed) last.b = r.b;
        else merged.push({ ...r });
      }
      runs = merged.filter(r => r.b - r.a + 1 >= 0.4 * hMed);
    }
    // 2) Gán mỗi dòng cho khối OCR chồng lên nó nhiều nhất (khung lệch vẫn lấy đủ dòng, không lấy dòng của khối khác)
    const owner = (r: { a: number; b: number }): Pre | null => {
      let best: Pre | null = null, bestOv = 0;
      for (const Q of horiz) {
        if (Q !== P && !xOverlap(P, Q)) continue;
        const ov = Math.min(r.b, Q.Y1) - Math.max(r.a, Q.Y0);
        if (ov > bestOv) { bestOv = ov; best = Q; }
      }
      if (best) return best;
      let near: Pre | null = null, dist = Infinity; // dòng nằm ngoài mọi khung → khối gần nhất
      for (const Q of horiz) {
        if (Q !== P && !xOverlap(P, Q)) continue;
        const dd = r.b < Q.Y0 ? Q.Y0 - r.b : r.a > Q.Y1 ? r.a - Q.Y1 : 0;
        if (dd < dist && dd < 1.2 * Q.pitch) { dist = dd; near = Q; }
      }
      return near;
    };
    const lines = runs.filter(r => owner(r) === P);
    const aiLines = Math.max(1, Math.round(o.lines || 1));
    let top = lines.length ? lines[0].a : Y0;
    let bottom = lines.length ? lines[lines.length - 1].b : Y1;
    let n = lines.length || aiLines;
    if (aiLines > 1 && (n < aiLines * 0.6 || n > aiLines * 1.6)) { n = aiLines; top = Math.min(top, Y0); bottom = Math.max(bottom, Y1); }
    // 3) Mép trái/phải theo mực thật: nới ra ngoài khung tới khi gặp khe trống (khe cột) hoặc khối khác
    const lineH = lines.length ? median(lines.map(l => l.b - l.a + 1)) : (bottom - top) / n;
    const gapMax = Math.max(3, 0.7 * lineH);
    let limL = Math.max(0, X0 - 0.04 * W), limR = Math.min(W - 1, X1 + 0.04 * W);
    for (const Q of horiz) {
      if (Q === P || Math.min(Q.Y1, bottom) - Math.max(Q.Y0, top) <= 0) continue;
      if (Q.X1 <= X0 + 2) limL = Math.max(limL, Q.X1 + 1);
      if (Q.X0 >= X1 - 2) limR = Math.min(limR, Q.X0 - 1);
    }
    const colInk = (x: number) => { for (let y = Math.floor(top); y <= bottom; y += 1) if (ink(x, y)) return true; return false; };
    let x0 = X0, x1 = X1;
    { // co vào mực thật bên trong khung
      let l = xa; while (l < xb && !colInk(l)) l++;
      let r = xb - 1; while (r > l && !colInk(r)) r--;
      if (r > l) { x0 = l; x1 = r + 1; }
    }
    for (let x = Math.floor(x0) - 1, blank = 0; x >= limL; x--) { if (colInk(x)) { x0 = x; blank = 0; } else if (++blank >= gapMax) break; }
    for (let x = Math.ceil(x1), blank = 0; x <= limR; x++) { if (colInk(x)) { x1 = x + 1; blank = 0; } else if (++blank >= gapMax) break; }

    // Thụt đầu dòng: dòng đầu bắt đầu lùi vào so với các dòng sau
    let firstIndent = 0;
    if (lines.length >= 2) {
      const startOf = (l: { a: number; b: number }) => {
        for (let x = Math.floor(x0); x < x1; x++) for (let y = l.a; y <= l.b; y++) if (ink(x, y)) return x;
        return x1;
      };
      firstIndent = Math.max(0, startOf(lines[0]) - median(lines.slice(1, 4).map(startOf)));
    }
    const h = Math.max(4, bottom - top);
    let size: number, leading: number;
    if (n >= 2) {
      leading = lines.length === n ? median(lines.slice(1).map((l, i) => l.a - lines[i].a)) : h / (n - 1 + 0.82);
      size = leading / 1.18;
    } else {
      size = lineH / 0.95;
      leading = size * 1.2;
    }
    size = Math.max(5, size);
    out.push({
      ...base,
      x0, x1,
      top: top - 0.05 * size,
      bottom: bottom + 0.05 * size,
      size,
      leading: Math.max(size * 1.02, leading),
      lineCount: n,
      firstOffset: firstIndent > 0.6 * size && firstIndent < 4 * size ? firstIndent : 0,
      align: (al === 'center' || al === 'right' || al === 'justify') ? al as BlockAlign : (n >= 3 ? 'justify' : 'left'),
    });
  }
  // Cỡ chữ thân bài đồng đều: các đoạn nhiều dòng có cỡ ước lượng gần nhau (±20%) → dùng chung trung vị
  const body = out.filter(b => !b.rotate && b.lineCount >= 2);
  if (body.length >= 2) {
    const ms = median(body.map(b => b.size));
    const ml = median(body.map(b => b.leading));
    for (const b of body) if (Math.abs(b.size - ms) <= 0.12 * ms) { b.size = ms; b.leading = Math.max(ms * 1.02, ml); }
  }
  return orderForReading(out, W, []).map((b, i) => ({ ...b, id: `${idPrefix}${i + 1}` }));
}
