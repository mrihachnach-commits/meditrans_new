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

const LABEL_RE = /^(\d{1,3}(\.\d{1,3})*\.?|[a-zA-Z][.)]|\(?[ivxIVX]{1,4}[.)]|[•●▪■◦–\-*])$/;
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
  bins.forEach(e => { if (e.n > mode.n) mode = e; });
  const bg: RGB = mode.n ? { r: mode.r / mode.n, g: mode.g / mode.n, b: mode.b / mode.n } : { r: 255, g: 255, b: 255 };

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
      bold: st.bold, italic: st.italic, serif: st.serif, color: null,
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
  return out;
}

/* ------------------------------------------------------------------ */
/* 2. Item → đoạn dòng (segment) → khối                                */
/* ------------------------------------------------------------------ */

function buildSegments(items: NormItem[]): Segment[] {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: NormItem[][] = [];
  for (const it of sorted) {
    let placed = false;
    for (let r = rows.length - 1; r >= 0 && r >= rows.length - 4; r--) {
      const row = rows[r];
      const ref = row.reduce((a, b) => (b.size > a.size ? b : a));
      if (Math.abs(it.y - ref.y) < 0.5 * Math.max(ref.size, it.size)) {
        row.push(it);
        placed = true;
        break;
      }
    }
    if (!placed) rows.push([it]);
  }

  const segments: Segment[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    const mainSize = median(row.map(r => r.size));
    let cur: NormItem[] = [];
    const flush = () => { if (cur.length) { segments.push(makeSegment(cur)); cur = []; } };
    for (const it of row) {
      if (cur.length) {
        const prev = cur[cur.length - 1];
        const gap = it.x - (prev.x + prev.w);
        const curText = cur.map(c => c.str).join('').trim();
        // Số mục / ký hiệu đầu dòng ("10", "1.2", "•", "a)") đứng tách khỏi chữ → khối riêng
        const labelBreak = cur.length === 1 && LABEL_RE.test(curText) && gap > 0.25 * mainSize && /\p{L}/u.test(it.str);
        if (gap > 1.2 * mainSize || labelBreak) flush();
      }
      cur.push(it);
    }
    flush();
  }
  return attachOrphanSuperscripts(segments);
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

export function buildBlocks(items: NormItem[], pageWidth: number): LayoutBlock[] {
  const segments = buildSegments(items).filter(s => s.text.length > 0);
  segments.sort((a, b) => a.y - b.y || a.x0 - b.x0);

  const work: WorkBlock[] = [];
  for (const seg of segments) {
    let bestBlock: WorkBlock | null = null;
    let bestGap = Infinity;
    for (const b of work) {
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
      const prevShort = b.lines.length >= 2 && last.x1 < b.x1 - Math.max(3 * b.size, 0.15 * blockWidth);
      const indentStart = seg.x0 > b.x0 + 0.8 * b.size && seg.x1 > b.x1 - 1.5 * b.size && b.lines.length >= 2;
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
  for (const b of blocks) {
    if (b.lineCount === 1 && b.align === 'left' && !b.leader &&
        b.x0 > pageWidth * 0.4 && Math.abs(b.x1 - rightEdge) < 0.8 * b.size) b.align = 'right';
  }
  return orderForReading(blocks, pageWidth);
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
  };
}

function orderForReading(blocks: LayoutBlock[], pageWidth: number): LayoutBlock[] {
  const isFull = (b: LayoutBlock) => b.x1 - b.x0 > 0.6 * pageWidth;
  const byTop = [...blocks].sort((a, b) => a.top - b.top);
  const result: LayoutBlock[] = [];
  let band: LayoutBlock[] = [];
  const flushBand = () => {
    const left = band.filter(b => (b.x0 + b.x1) / 2 < pageWidth / 2).sort((a, b) => a.top - b.top);
    const right = band.filter(b => (b.x0 + b.x1) / 2 >= pageWidth / 2).sort((a, b) => a.top - b.top);
    result.push(...left, ...right);
    band = [];
  };
  for (const b of byTop) {
    if (isFull(b)) { flushBand(); result.push(b); } else band.push(b);
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

function wordWidth(m: Measurer, w: Word, serif: boolean, size: number) {
  return w.reduce((s, p) => s + m.width(p.text, fontCss(p.style, serif, size)), 0);
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
  const space = m.width(' ', fontCss(base, serif, size));
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
    const ww = wordWidth(m, w, serif, size);
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
    const numW = b.leader.num ? m.width(b.leader.num, fontCss(base, serif, size)) : 0;
    const reserve = numW + m.width(' . . . ', fontCss(base, serif, size));
    const lastIdx = lines.length - 1;
    const lastW = lines[lastIdx].reduce((s, w, i) => s + wordWidth(m, w, serif, size) + (i ? space : 0), 0);
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
  const space = m.width(' ', fontCss(base, serif, size));
  ctx.textBaseline = 'alphabetic';
  let y = top + size * 0.93;
  lo.lines.forEach((line, i) => {
    const isLast = i === lo.lines.length - 1;
    const offset = (i === 0 ? b.firstOffset : b.restOffset) * scale;
    const avail = width - offset;
    const widths = line.map(w => wordWidth(m, w, serif, size));
    const natural = widths.reduce((s, w) => s + w, 0) + space * Math.max(0, line.length - 1);
    let x = x0 + offset;
    let gap = space;
    if (b.align === 'center') {
      x += Math.max(0, (avail - natural) / 2);
    } else if (b.align === 'right') {
      x += Math.max(0, avail - natural);
    } else if (b.align === 'justify' && !isLast && line.length > 1) {
      const g = (avail - widths.reduce((s, w) => s + w, 0)) / (line.length - 1);
      if (g > space * 0.8 && g < size * 0.9) gap = g;
    }
    line.forEach((w, wi) => {
      for (const p of w) {
        const font = fontCss(p.style, serif, size);
        ctx.font = font;
        ctx.fillStyle = p.style.color ? rgbCss(p.style.color) : '#1a1a1a';
        ctx.fillText(p.text, x, y);
        x += m.width(p.text, font);
      }
      if (wi < line.length - 1) x += gap;
    });
    if (isLast && b.leader) {
      const font = fontCss(base, serif, size);
      ctx.font = font;
      ctx.fillStyle = base.color ? rgbCss(base.color) : '#1a1a1a';
      const right = b.leader.right;
      const numW = b.leader.num ? m.width(b.leader.num, font) : 0;
      const dot = m.width('.', font);
      const step = dot + m.width(' ', font) * 0.6;
      let dx = x + space;
      const stopX = right - numW - (b.leader.num ? space : 0);
      while (dx + dot <= stopX) { ctx.fillText('.', dx, y); dx += step; }
      if (b.leader.num) ctx.fillText(b.leader.num, right - numW, y);
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
  base: RunStyle;
  words: Word[];
}

/**
 * Vẽ bản dịch lên canvas đã render trang gốc.
 * translations: id khối → bản dịch (có thể chứa thẻ <n>…</n>). Khối không có bản dịch giữ nguyên.
 */
export function paintTranslatedPage(
  ctx: CanvasRenderingContext2D,
  blocks: LayoutBlock[],
  translations: Record<string, string>,
): PaintReport {
  const report: PaintReport = { painted: 0, overflowIds: [], shrunkIds: [] };
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const m = new Measurer(ctx);
  const norm = (t: string) => t.replace(/<\/?\d+>/g, '').replace(/\s+/g, ' ').trim();

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

    let extLeft = 0, extRight = 0;
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
      }
    }

    const base: RunStyle = { ...b.baseStyle, color: b.baseStyle.color && !isDark(b.baseStyle.color) ? b.baseStyle.color : (stats.fg ?? b.baseStyle.color) };
    info.set(b.id, { stats, free, extLeft, extRight, base, words: parseRich(translations[b.id], b, base) });
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
      const between = blocks.some(o => o !== L && o !== b && o.top >= L.bottom - 1 && o.bottom <= b.top + 1 &&
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
    o !== b && !g.includes(o) &&
    (o.x1 <= b.x0 + 1 || o.x0 >= b.x1 - 1) &&
    Math.abs(o.top - b.top) < 0.6 * Math.min(o.size, b.size));

  const plans: { b: LayoutBlock; lo: LaidOut; top: number; x0: number; width: number }[] = [];
  for (const g of groups) {
    const lastI = info.get(g[g.length - 1].id)!;
    const availBottom = g[g.length - 1].bottom + lastI.free;
    const gaps = g.slice(1).map((b, i) => Math.max(0, b.top - g[i].bottom));
    const cascade = g.length > 1 && !g.some(b => hasRowMate(b, g));
    const widthOf = (b: LayoutBlock) => { const inf = info.get(b.id)!; return Math.max(b.x1 - b.x0 + inf.extLeft + inf.extRight, b.size * 2); };

    const tryFit = (s: number, tight: number) => {
      const los: LaidOut[] = [];
      const tops: number[] = [];
      let y = g[0].top;
      let fits = true;
      g.forEach((b, i) => {
        const inf = info.get(b.id)!;
        const ratio = Math.min(1.6, Math.max(1.05, (b.leading / b.size) * tight));
        const lo = layoutWords(m, inf.words, b, inf.base, widthOf(b), b.size * s, ratio);
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
    for (let s = 1; s >= 0.72 - 1e-6; s -= 0.02) {
      for (const tight of [1, 0.93]) {
        const r = tryFit(s, tight);
        if (r.fits) { chosen = { s, ...r }; break outer; }
      }
    }
    if (!chosen) {
      const r = tryFit(0.72, 0.93);
      chosen = { s: 0.72, ...r };
      report.overflowIds.push(...g.map(b => b.id));
    } else if (chosen.s < 0.985) {
      report.shrunkIds.push(...g.map(b => b.id));
    }
    g.forEach((b, i) => {
      const inf = info.get(b.id)!;
      plans.push({ b, lo: chosen!.los[i], top: chosen!.tops[i], x0: b.x0 - inf.extLeft, width: widthOf(b) });
    });
  }

  /* --- Xoá chữ gốc (cả khoảng giữa các khối trong nhóm và phần giãn) --- */
  for (const b of targets) {
    const inf = info.get(b.id)!;
    const g = groupOf.get(b.id)!;
    const idx = g.indexOf(b);
    const padX = 0.15 * b.size;
    const plan = plans.find(p => p.b === b)!;
    let bottom = b.bottom + 0.1 * b.size;
    if (idx < g.length - 1) bottom = Math.max(bottom, g[idx + 1].top);
    bottom = Math.max(bottom, plan.top + plan.lo.height + 0.15 * b.size);
    ctx.fillStyle = rgbCss(inf.stats.bg, inf.stats.uniform >= 0.45 ? 1 : 0.93);
    ctx.fillRect(Math.min(b.x0, plan.x0) - padX, b.top - 0.05 * b.size, Math.max(b.x1 - b.x0, plan.width) + 2 * padX, bottom - b.top + 0.05 * b.size);
  }

  /* --- Vẽ --- */
  for (const p of plans) {
    const inf = info.get(p.b.id)!;
    ctx.save();
    drawLaidOut(ctx, m, p.lo, p.b, inf.base, p.x0, p.width, p.top);
    ctx.restore();
    report.painted++;
  }
  return report;
}
