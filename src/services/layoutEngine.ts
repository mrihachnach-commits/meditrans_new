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
  /** Chữ hoa cỡ lớn đầu đoạn (drop cap) — tách khỏi dòng, gắn vào đoạn văn bên phải. */
  dropCap?: boolean;
  /** v11: cỡ chữ GHI TRONG PDF (trước khi hiệu chỉnh theo mực trên ảnh) */
  pdfSize?: number;
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
  /** v10.4: công thức toán — giữ nguyên điểm ảnh gốc, không dịch. */
  formula?: boolean;
  /** v10.4: ô thuộc bảng có đường kẻ (cùng mã = cùng bảng) → cả bảng vẽ một cỡ chữ. */
  tableId?: string;
  /** v10.8: khung chữ nhật (ô sơ đồ / hộp có viền) bao quanh khối — chữ dịch được dùng hết lòng khung. */
  box?: TextBox;
  /** khối là cụm chữ DUY NHẤT trong khung (được căn giữa / giãn dọc trong khung) */
  boxSolo?: boolean;
  leader?: { num: string; right: number };
  /** Mục lục nhiều dòng: mép phải của các dòng trên (để ngắt dòng giống bản gốc). */
  bodyRight?: number;
  /** Co/giãn ngang khi vẽ để khớp độ rộng font gốc. */
  hScale: number;
  /** Chữ xoay 90°: 'up' = đọc từ dưới lên, 'down' = đọc từ trên xuống. */
  rotate?: 'up' | 'down';
  /** Khối lấy từ OCR (chữ trong ảnh / trang scan). */
  fromOcr?: boolean;
  /** Vị trí khối trong danh sách OCR gốc (để lấy bản dịch AI trả kèm). */
  srcIndex?: number;
  /** Khối OCR đã lấy cỡ chữ/font từ lớp chữ PDF (chuẩn, không cần ước lượng). */
  guided?: boolean;
  /** v9.8: nhãn chữ trong hình (trang có lớp chữ): vị trí theo khung AI, xoá gọn trong khung, không nới theo mực. */
  figLabel?: boolean;
  /** v10.0: cột trang (theo khe cột thật đã dò được); -1 = vắt ngang khe cột; không có = trang 1 cột / không rõ. */
  col?: number;
  /** v10.0: mỗi lần đổi kiểu chữ trong bản gốc đều trùng chỗ xuống dòng (mục lục: tên bài / tác giả in nghiêng)
   *  → bản dịch cũng xuống dòng tại chỗ đổi kiểu chữ. */
  breakOnStyle?: boolean;
  /** v11: mỗi nhãn in nghiêng/đậm kết thúc bằng ":" ở đầu dòng gốc bắt đầu một dòng mới ("Form: … / Contour: …"). */
  labelLines?: boolean;
  /** Chữ hoa cỡ lớn đầu đoạn: vẽ lại chữ cái đầu của bản dịch ở cùng vị trí/cỡ, các dòng bên cạnh thụt vào. */
  dropCap?: DropCap;
  /** v9.6: nhãn đầu khối in đậm trên ảnh scan ("Figure 1", "Table 2") → in đậm nhãn tương ứng của bản dịch ("Hình 1"). */
  boldLead?: boolean;
}

export interface DropCap {
  x: number;          // mép trái chữ hoa
  w: number;          // độ thụt của các dòng nằm cạnh chữ hoa
  size: number;
  baseline: number;
  lines: number;      // số dòng nằm cạnh chữ hoa
  bold: boolean;
  serif: boolean;
  color: RGB | null;
}

export interface PaintReport {
  painted: number;
  overflowIds: string[];
  shrunkIds: string[];
  /** v9.4: các dòng chữ đã vẽ (toạ độ điểm ảnh của canvas) → lớp chữ ẩn trong PDF xuất ra (tìm kiếm / sao chép được). */
  textRuns?: TextRun[];
}

/** Một dòng chữ trên trang: x, y = điểm bắt đầu trên đường chân chữ (px), w = độ rộng (px), size = cỡ chữ (px). */
export interface TextRun { x: number; y: number; w: number; size: number; text: string; }

/** Nơi gom dòng chữ đang vẽ (chỉ bật trong paintTranslatedPage, tắt với chữ xoay). */
let textSink: TextRun[] | null = null;

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
// v10.4: chữ cái chỉ số trên (chú thích chân bảng "ᵃContrast-induced…", "thuốc cản quangᵇ") — trước đây thành chữ thường
const SUPERSCRIPT_LETTERS: Record<string, string> = {
  a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', o: 'ᵒ', p: 'ᵖ',
  r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', x: 'ˣ', y: 'ʸ', z: 'ᶻ',
};
/** Ký tự chỉ số trên đứng đầu dòng = dấu chú thích ("ᵃ…", "¹…", "*…", "†…") */
export const FOOTNOTE_MARK_RE = /^[ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹*†‡§¶]/u;

function toSuperscript(s: string): string {
  const core = s.replace(/[,\s]/g, '');
  // Dấu chú thích bằng chữ cái (1–2 chữ thường: a, b, ab) — chuỗi dài hơn có thể là chữ thật (mũ "-ing") → giữ nguyên
  if (/^[a-z]{1,2}$/.test(core) && [...core].every(ch => SUPERSCRIPT_LETTERS[ch])) return [...s].map(ch => SUPERSCRIPT_LETTERS[ch] ?? ch).join('');
  if (!core || [...core].some(ch => !SUPERSCRIPT_MAP[ch])) return s;
  return [...s].map(ch => SUPERSCRIPT_MAP[ch] ?? ch).join('');
}

const BULLET_CHARS = '•●▪■◦○‣►▸➢➤✓✔❖◆◇□▫·∙§\\-–—*o\uF0A7\uF0B7\uF0D8\uF076\uF0FC\uF0A8\uF06E\uF0E0';
const LABEL_RE = new RegExp(`^(\\d{1,3}(\\.\\d{1,3})*[.)]?|\\(\\d{1,2}\\)|\\(?[a-zA-Z][.)]|\\(?[ivxIVX]{1,4}[.)]|[${BULLET_CHARS}])$`);
/** Ký hiệu đầu dòng dính liền chữ trong cùng một item: "• Breast", "o Conical…" */
const LEADING_BULLET_RE = new RegExp(`^(\\s*[${BULLET_CHARS}])(\\s+)(?=\\S)`);
const LEADER_RE = /^([\s\S]*?\S)\s*(?:[.·…]\s*){4,}\s*(\d{1,4}|[ivxlcdm]{1,6})?\s*$/i;
/** v11.2: dòng mục lục OCR có chấm dẫn + SỐ TRANG chỉ trong bản dịch (text không có). */
function ocrLeaderInV(o: { text?: string; v?: string }): boolean {
  const v = (o.v || '').replace(/<\/?\d+>/g, '').replace(/\s+/g, ' ').trim();
  const m = v.match(LEADER_RE);
  return !!m && !!m[2] && /^\d{1,4}$/.test(m[2]) && !LEADER_RE.test((o.text || '').replace(/\s+/g, ' ').trim());
}

function isTranslatableText(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (letterCount(t) < 2) return false;
  if (/^(https?:\/\/|www\.)\S+$/i.test(t)) return false;
  if (/^(doi:?\s*)?10\.\d{4,}\/\S+$/i.test(t)) return false;
  if (/^\S+@\S+\.\S+$/.test(t)) return false;
  // v10.10: dòng tên tác giả kèm học vị ("Wendie A. Berg, MD, PhD and Wei Tse Yang, MBBS") → giữ nguyên (trước đây AI dịch
  // học vị thành "Bác sĩ đa khoa, Tiến sĩ", mục lục BI-RADS)
  {
    const DEG = /^(MD|PhD|MBBS|MBChB|DO|MSc|MS|MA|BSc|BA|MPH|MBA|CGC|RN|RT|RDMS|RVT|RDCS|FRCR|FRCP|FRANZCR|FACR|FSBI|FSRU|FAIUM|DMRD|DCR|DMU|PgCert|PgDip|MRCP|FRCS|Jr|Sr|II|III)\.?$/;
    const toks = t.replace(/[,;]/g, ' ').split(/\s+/).filter(Boolean);
    if (toks.some(w => DEG.test(w)) && /,\s*(MD|PhD|MBBS|DO|MSc|CGC|RN|FRCR|MPH|RDMS|DCR)\b/.test(t) &&
      toks.every(w => DEG.test(w) || /^(and|&|với|và)$/i.test(w) || /^\p{Lu}[\p{L}'’\-]*\.?$/u.test(w) || /^\p{Lu}\.(\p{Lu}\.)*$/u.test(w))) return false;
  }
  // v10.10: chữ rác của lớp chữ OCR trên bìa ("@SElr.fcSip" — logo nhà xuất bản đọc sai) → giữ nguyên
  if (/^@\S*$/.test(t) || (/@/.test(t) && !/\s\p{L}{3,}\s/u.test(t) && t.length < 25)) return false;
  if (/^(page|trang)?\s*\d+(\s*(of|\/)\s*\d+)?$/i.test(t)) return false;
  // số trang La Mã — v10.4: phải đúng cú pháp số La Mã và cùng kiểu hoa/thường ("Mild", "Civil", "Dim" từng bị coi là số
  // La Mã nên không được dịch)
  // v10.8: ô / nhãn chỉ gồm từ viết tắt ("CXR", "CACS", "CT PE", "PCI", "LAD/LCx") → giữ nguyên. Trước đây AI dịch bung
  // thành "X-quang ngực (CXR)", "Điểm vôi hóa động mạch vành (CACS)" → ô tiêu đề bảng 6.1 CT tim tràn xuống các hàng dưới
  {
    const toks = t.split(/\s+/);
    const ACRO_STOP = /^(THE|AND|FOR|NOT|YES|NO|KEY|NOTE|NOTES|STEP|AGE|SEX|MEN|MALE|TOTAL|NONE|HIGH|LOW|MILD|ALL|ANY|SEE|USE|TIP|TIPS|PART|CASE|DATA|TYPE|AREA|BODY|LEFT|RIGHT|ONLY|WITH|FROM|OR|OF|IN|ON|TO|BY|AT|AS|IS|IT|AN|A|I|ME|MY|WE|US|UP|DO|GO|SO|BE|IF|VS|PEARLS|PITFALL|SUMMARY|FINDING|IMAGING|REVIEW|METHODS|RESULTS|FIGURE|TABLE|CHAPTER|LESSON|ANSWER|CAUSES|SIGNS|NORMAL|WOMEN|FEMALE|ADULTS|DOSE|RISK|GRADE|SCORE|STAGE|LEVEL|SITE|SIZE|SHAPE|TIME|RATE|MEAN|RANGE|VALUE|OTHER|OTHERS|YEARS|HEART|LUNG|LIVER|BRAIN|BONE|CHEST|MASS|CYST|WALL|VEIN|LOBE|FAT|RIB|NECK|HEAD|ARM|LEG|FOOT|HAND|SKIN|ROOT|BASE|APEX|MID|TOP|END|NEW|OLD|BOTH|EACH|ZONE|FLOW|DOSE|SCAN|VIEW|PLAN|FORM|SIGN|PAIN|ACUTE|LATE|EARLY|GOOD|POOR|FAIR|BEST|BAD|FAST|SLOW|ONE|TWO|SIX|TEN)$/;
    // (từ tiếng Anh viết hoa toàn bộ — "ANATOMY", "FRANCE", "MASSES" — có ≥ 2 nguyên âm và > 4 chữ cái → vẫn dịch)
    const acroLike = (w: string) => /[a-z0-9\-\/+]/.test(w.slice(1)) || w.length <= 4 || (w.match(/[AEIOUY]/g) || []).length <= 1;
    if (toks.length <= 3 && toks.every(w => /^[A-Z][A-Za-z0-9\-\/+]{1,6}$/.test(w) && (w.match(/[A-Z]/g) || []).length >= 2 && (w.match(/[a-z]/g) || []).length <= 1 && !ACRO_STOP.test(w.toUpperCase()) && acroLike(w)) &&
      toks.some(w => (w.match(/[A-Z]/g) || []).length >= 2)) return false;
  }
  if ((/^[ivxlcdm]+\.?$/.test(t) || /^[IVXLCDM]+\.?$/.test(t)) && /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})\.?$/i.test(t)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Màu vùng                                                            */
/* ------------------------------------------------------------------ */

interface RegionStats { bg: RGB; uniform: number; fg: RGB | null; mixed?: boolean; }

// Bộ đệm dùng lại cho regionStats (không cấp phát mỗi lần gọi — hàm này được gọi hàng nghìn lần mỗi trang)
const RS_BIN = new Int32Array(4096);
const RS_EXACT = new Int32Array(4096);
const RS_DIST = new Int32Array(766);
const RS_CH = [new Int32Array(256), new Int32Array(256), new Int32Array(256)];

function histMedian(h: Int32Array, n: number): number {
  let acc = 0;
  const half = n / 2;
  for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= half) return v; }
  return 255;
}

/** Thống kê vùng ảnh: nền = màu phổ biến nhất; chữ = trung vị nhóm 25% điểm khác nền nhiều nhất. */
function regionStats(img: ImageData, x0: number, y0: number, x1: number, y1: number): RegionStats {
  const W = img.width, H = img.height, d = img.data;
  const xa = Math.max(0, Math.floor(x0)), xb = Math.min(W, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H, Math.ceil(y1));
  const area = Math.max(1, (xb - xa) * (yb - ya));
  const step = area > 60000 ? 2 : 1;
  RS_BIN.fill(0);
  let total = 0;
  for (let y = ya; y < yb; y += step) {
    for (let x = xa; x < xb; x += step) {
      const i = (y * W + x) * 4;
      RS_BIN[((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)]++;
      total++;
    }
  }
  if (!total) return { bg: { r: 255, g: 255, b: 255 }, uniform: 1, fg: null };
  let modeKey = 0;
  for (let k = 1; k < 4096; k++) if (RS_BIN[k] > RS_BIN[modeKey]) modeKey = k;
  // Màu nền = màu chính xác xuất hiện nhiều nhất trong nhóm phổ biến (không lấy trung bình → không lệch sắc)
  RS_EXACT.fill(0);
  for (let y = ya; y < yb; y += step) {
    for (let x = xa; x < xb; x += step) {
      const i = (y * W + x) * 4;
      if ((((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4)) !== modeKey) continue;
      RS_EXACT[((d[i] & 15) << 8) | ((d[i + 1] & 15) << 4) | (d[i + 2] & 15)]++;
    }
  }
  let lowKey = 0;
  for (let k = 1; k < 4096; k++) if (RS_EXACT[k] > RS_EXACT[lowKey]) lowKey = k;
  const bg: RGB = {
    r: ((modeKey >> 8) << 4) | (lowKey >> 8),
    g: (((modeKey >> 4) & 15) << 4) | ((lowKey >> 4) & 15),
    b: ((modeKey & 15) << 4) | (lowKey & 15),
  };

  // Điểm "xa nền": lập biểu đồ khoảng cách để lấy ngưỡng nhóm 25% xa nhất, không cần sắp xếp
  RS_DIST.fill(0);
  let near = 0, farN = 0, colored = 0;
  for (let y = ya; y < yb; y += step) {
    for (let x = xa; x < xb; x += step) {
      const i = (y * W + x) * 4;
      const dist = Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b);
      if (dist < 40) near++;
      else if (dist > 120) {
        RS_DIST[dist]++;
        farN++;
        if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 60) colored++;
      }
    }
  }
  let fg: RGB | null = null;
  let mixed = false;
  if (farN > Math.max(3, total * 0.01)) {
    const want = Math.max(3, Math.ceil(farN * 0.25));
    let thr = 765, acc = 0;
    for (; thr > 120; thr--) { acc += RS_DIST[thr]; if (acc >= want) break; }
    RS_CH[0].fill(0); RS_CH[1].fill(0); RS_CH[2].fill(0);
    let n = 0;
    for (let y = ya; y < yb; y += step) {
      for (let x = xa; x < xb; x += step) {
        const i = (y * W + x) * 4;
        const dist = Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b);
        if (dist < thr) continue;
        RS_CH[0][d[i]]++; RS_CH[1][d[i + 1]]++; RS_CH[2][d[i + 2]]++; n++;
      }
    }
    fg = { r: histMedian(RS_CH[0], n), g: histMedian(RS_CH[1], n), b: histMedian(RS_CH[2], n) };
    const cf = colored / farN;
    mixed = farN >= 6 && colored >= 3 && cf > 0.004 && cf < 0.96;
  }
  return { bg, uniform: near / total, fg, mixed };
}

/**
 * Màu chữ trên nền ảnh / chuyển màu (không có bản sạch): chữ thường là phần SÁNG NHẤT hoặc TỐI NHẤT của vùng.
 * Lấy trung vị 8% điểm sáng nhất và 8% điểm tối nhất, chọn nhóm khác hẳn màu giữa vùng hơn.
 */
function extremeColor(img: ImageData, x0: number, y0: number, x1: number, y1: number): RGB | null {
  const W = img.width, H = img.height, d = img.data;
  const xa = Math.max(0, Math.floor(x0)), xb = Math.min(W, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H, Math.ceil(y1));
  const step = (xb - xa) * (yb - ya) > 60000 ? 2 : 1;
  const L = new Int32Array(256);
  let n = 0;
  for (let y = ya; y < yb; y += step) for (let x = xa; x < xb; x += step) {
    const i = (y * W + x) * 4; L[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++; n++;
  }
  if (n < 20) return null;
  const k = Math.max(3, Math.round(0.08 * n));
  let lo = 0, acc = 0; for (; lo < 255; lo++) { acc += L[lo]; if (acc >= k) break; }
  let hi = 255; acc = 0; for (; hi > 0; hi--) { acc += L[hi]; if (acc >= k) break; }
  const mid = histMedian(L, n);
  const pickHigh = hi - mid >= mid - lo;
  if (Math.abs((pickHigh ? hi : lo) - mid) < 60) return null; // không có nét chữ tương phản rõ
  RS_CH[0].fill(0); RS_CH[1].fill(0); RS_CH[2].fill(0);
  let m = 0;
  for (let y = ya; y < yb; y += step) for (let x = xa; x < xb; x += step) {
    const i = (y * W + x) * 4; const l = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    if (pickHigh ? l < hi : l > lo) continue;
    RS_CH[0][d[i]]++; RS_CH[1][d[i + 1]]++; RS_CH[2][d[i + 2]]++; m++;
  }
  return m ? { r: histMedian(RS_CH[0], m), g: histMedian(RS_CH[1], m), b: histMedian(RS_CH[2], m) } : null;
}

/**
 * Màu chữ thật của một vùng, dựa vào bản vẽ "không chữ" (clean): điểm mực = điểm khác hẳn nền thật tại chỗ.
 * Không bị nền ảnh / gradient / khung màu đánh lừa như cách so với màu nền phổ biến nhất.
 * Trả về undefined khi không dùng được (không có bản sạch, hoặc chữ vẽ bằng đường nét nên bản sạch vẫn còn chữ).
 */
function glyphColor(img: ImageData, clean: ImageData | null | undefined, x0: number, y0: number, x1: number, y1: number): { fg: RGB; mixed: boolean } | undefined {
  if (!clean || clean.width !== img.width || clean.height !== img.height) return undefined;
  const W = img.width, H = img.height, d = img.data, c = clean.data;
  const xa = Math.max(0, Math.floor(x0)), xb = Math.min(W, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H, Math.ceil(y1));
  RS_DIST.fill(0);
  let total = 0, n = 0, colored = 0;
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * W + x) * 4;
      total++;
      const dist = Math.abs(d[i] - c[i]) + Math.abs(d[i + 1] - c[i + 1]) + Math.abs(d[i + 2] - c[i + 2]);
      if (dist <= 90) continue;
      RS_DIST[dist]++; n++;
      if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 60) colored++;
    }
  }
  if (n < Math.max(4, total * 0.01)) return undefined;
  const want = Math.max(3, Math.ceil(n * 0.4));
  let thr = 765, acc = 0;
  for (; thr > 90; thr--) { acc += RS_DIST[thr]; if (acc >= want) break; }
  RS_CH[0].fill(0); RS_CH[1].fill(0); RS_CH[2].fill(0);
  let m = 0;
  for (let y = ya; y < yb; y++) {
    for (let x = xa; x < xb; x++) {
      const i = (y * W + x) * 4;
      const dist = Math.abs(d[i] - c[i]) + Math.abs(d[i + 1] - c[i + 1]) + Math.abs(d[i + 2] - c[i + 2]);
      if (dist < thr) continue;
      RS_CH[0][d[i]]++; RS_CH[1][d[i + 1]]++; RS_CH[2][d[i + 2]]++; m++;
    }
  }
  const cf = colored / n;
  // Vài chữ số trích dẫn màu xanh ("[6, 7]") giữa dòng chữ đen chỉ chiếm ~1–3% mực → ngưỡng cũ 4% bỏ sót, cả dòng
  // thành một màu. Chữ đen khử răng cưa gần như không có điểm "có màu" → chỉ cần vài điểm màu là đủ tin.
  return { fg: { r: histMedian(RS_CH[0], m), g: histMedian(RS_CH[1], m), b: histMedian(RS_CH[2], m) }, mixed: n >= 6 && colored >= 3 && cf > 0.004 && cf < 0.96 };
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
      str: it.str, x: m[4], y: m[5], size, w: Math.max(0, it.width * scale), pdfSize: size,
      bold: st.bold, italic: st.italic, serif: st.serif, color: null, font: it.fontName, hScale: 1,
    });
  }
  return out;
}

/**
 * v9.6: chữ xoay 90° trong lớp chữ PDF (tab dọc lề trang "MAMMOGRAPHY", nhãn trục đồ thị) → khối chữ xoay để dịch
 * và vẽ lại dọc đúng chỗ (trước đây bị bỏ qua, chỉ dịch được khi bật OCR "Chữ trong hình").
 */
export function rotatedBlocksFromItems(
  items: RawTextItem[], viewportTransform: number[], getStyle: (fontName: string) => FontStyleInfo,
): LayoutBlock[] {
  type R = { str: string; x: number; y: number; size: number; len: number; dir: 'up' | 'down'; st: FontStyleInfo };
  const scale = Math.hypot(viewportTransform[0], viewportTransform[1]);
  const rs: R[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const m = mul(viewportTransform, it.transform);
    const size = Math.hypot(m[2], m[3]);
    if (!isFinite(size) || size < 3) continue;
    // chỉ xoay đúng 90° (hướng chữ dọc trục y của trang)
    if (Math.abs(m[0]) > 0.05 * Math.abs(m[1]) || Math.abs(m[1]) < 1e-6) continue;
    rs.push({ str: it.str, x: m[4], y: m[5], size, len: Math.max(0, it.width * scale), dir: m[1] < 0 ? 'up' : 'down', st: getStyle(it.fontName) });
  }
  // gom các mảnh cùng đường chân chữ (cùng x), liền nhau theo chiều dọc
  rs.sort((a, b) => a.dir.localeCompare(b.dir) || a.x - b.x || (a.dir === 'up' ? b.y - a.y : a.y - b.y));
  const groups: R[][] = [];
  for (const r of rs) {
    const g = groups.find(g => g[0].dir === r.dir && Math.abs(g[0].x - r.x) < 0.35 * r.size && Math.abs(g[0].size - r.size) < 0.25 * r.size &&
      g.some(q => {
        const qa = q.dir === 'up' ? q.y - q.len : q.y, qb = q.dir === 'up' ? q.y : q.y + q.len;
        const ra = r.dir === 'up' ? r.y - r.len : r.y, rb = r.dir === 'up' ? r.y : r.y + r.len;
        return Math.min(qb, rb) - Math.max(qa, ra) > -1.2 * r.size;
      }));
    if (g) g.push(r); else groups.push([r]);
  }
  const out: LayoutBlock[] = [];
  groups.forEach((g, i) => {
    const dir = g[0].dir;
    g.sort((a, b) => dir === 'up' ? b.y - a.y : a.y - b.y);
    const text = g.map(r => r.str).join('').replace(/\s+/g, ' ').trim();
    if ((text.match(/\p{L}/gu)?.length ?? 0) < 3) return;
    const size = median(g.map(r => r.size));
    const ys = g.flatMap(r => dir === 'up' ? [r.y - r.len, r.y] : [r.y, r.y + r.len]);
    const top = Math.min(...ys), bottom = Math.max(...ys);
    const xb = median(g.map(r => r.x));
    // 'up': thân chữ nằm bên TRÁI đường chân chữ; 'down': bên PHẢI
    const x0 = dir === 'up' ? xb - 0.92 * size : xb - 0.25 * size;
    const x1 = dir === 'up' ? xb + 0.25 * size : xb + 0.92 * size;
    const bold = g.filter(r => r.st.bold).length > g.length / 2;
    const italic = g.filter(r => r.st.italic).length > g.length / 2;
    const serif = g.filter(r => r.st.serif).length > g.length / 2;
    out.push({
      id: `rv${i + 1}`, text, plain: text, styles: [], baseStyle: { bold, italic, color: null },
      x0, x1, top, bottom, size, leading: size * 1.2, lineCount: 1, firstOffset: 0, restOffset: 0,
      bold, italic, serif, align: 'center', translatable: isTranslatableText(text), hScale: 1, rotate: dir,
    });
  });
  return out;
}

/** v9.6: màu mực trên ảnh scan bị nhoè (khử răng cưa, JPEG) → chữ đen ra xám. Đen/xám trung tính → đen; chữ màu → đậm lại. */
export function deepenScanInk(fg: RGB | null | undefined, bg: RGB): RGB | null {
  if (!fg) return null;
  const lum = (c: RGB) => 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
  const bgL = lum(bg);
  if (bgL < 150) return fg; // chữ sáng trên nền tối: giữ nguyên
  const chroma = Math.max(fg.r, fg.g, fg.b) - Math.min(fg.r, fg.g, fg.b);
  if (chroma < 48 && lum(fg) < 185) return { r: 26, g: 26, b: 26 };
  const k = 1.45, cl = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return { r: cl(bg.r + (fg.r - bg.r) * k), g: cl(bg.g + (fg.g - bg.g) * k), b: cl(bg.b + (fg.b - bg.b) * k) };
}

/** v9.6: in đậm nhãn đầu bản dịch ("Hình 1", "Bảng 2", "Figure 3"…) khi nhãn gốc in đậm. */
function applyBoldLead(words: Word[]) {
  const LEAD = /^(hình|bảng|hộp|biểu đồ|sơ đồ|ảnh|figure|fig\.?|table|box|chart)$/i;
  if (!words.length) return;
  const w0 = words[0].map(p => p.text).join('');
  let n = 0;
  if (LEAD.test(w0)) n = 2;
  else if (words.length > 1 && LEAD.test(w0 + ' ' + words[1].map(p => p.text).join(''))) n = 3;
  if (!n || words.length < n) return;
  const num = words[n - 1].map(p => p.text).join('');
  if (!/^[\dA-Z][\w.\-–]*[.:]?$/u.test(num)) return;
  for (let i = 0; i < n; i++) words[i] = words[i].map(p => ({ ...p, style: { ...p.style, bold: true } }));
}

/**
 * Gắn màu chữ thật cho từng item, lấy mẫu trên ảnh trang gốc.
 * pdf.js gộp cả câu nhiều màu vào một item → ước lượng vị trí từng ký tự (theo độ rộng đo bằng canvas)
 * rồi tách item tại chỗ đổi màu, để giữ được từ in màu giữa câu.
 */
export function annotateItemColors(
  ctx: CanvasRenderingContext2D, items: NormItem[], clean?: ImageData | null, pageImg?: ImageData,
): NormItem[] {
  const img = pageImg ?? ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const out: NormItem[] = [];
  // Bản "không chữ" chỉ dùng được khi chữ thật sự biến mất trong đó (font vẽ bằng đường nét thì không) → thử vài dòng
  if (clean) {
    const probe = items.filter(i => i.w > 4 && letterCount(i.str) >= 3).slice(0, 12);
    const ok = probe.filter(i => glyphColor(img, clean, i.x, i.y - 0.75 * i.size, i.x + i.w, i.y + 0.15 * i.size) !== undefined).length;
    if (probe.length && ok < 0.5 * probe.length) clean = null;
  }
  /** Màu chữ của vùng: ưu tiên so với nền thật; không có thì so với màu nền phổ biến (chỉ tin khi nền đồng đều). */
  const colorOf = (x0: number, y0: number, x1: number, y1: number, fallback: RGB | null): RGB | null => {
    const g = glyphColor(img, clean, x0, y0, x1, y1);
    if (g !== undefined) return g.fg;
    const st = regionStats(img, x0, y0, x1, y1);
    // Nền không đồng đều (ảnh, gradient): màu "khác nền" thường là nền chứ không phải chữ → dùng màu của cả dòng
    if (st.uniform < 0.45) return fallback;
    return st.fg ?? fallback;
  };
  ctx.save();
  for (const it of items) {
    const chars = [...it.str];
    if (it.w < 1 || chars.length === 0) { out.push(it); continue; }
    const y0 = it.y - 0.75 * it.size, y1 = it.y + 0.15 * it.size;
    // Một lượt quét: ưu tiên so với nền thật; không có thì so với màu nền phổ biến
    const glyph = glyphColor(img, clean, it.x, y0, it.x + it.w, y1);
    const whole = glyph ? null : regionStats(img, it.x, y0, it.x + it.w, y1);
    it.color = glyph ? glyph.fg : (whole!.uniform < 0.45 ? extremeColor(img, it.x, y0, it.x + it.w, y1) : null) ?? whole!.fg;
    // Chỉ tách theo từng từ khi vùng có hơn một màu mực (tiết kiệm nhiều thời gian: phần lớn dòng chỉ một màu)
    const multiColor = glyph ? glyph.mixed : (!!whole!.mixed && whole!.uniform >= 0.45);
    if (chars.length === 1 || letterCount(it.str) < 2 || !multiColor) {
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
      const color = w ? colorOf(xs[i] + 0.3, y0, xs[j] - 0.3, y1, it.color) : null;
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
  detectDropCaps(out);
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

/** Đánh dấu chữ hoa cỡ lớn đầu đoạn (drop cap): 1 chữ cái in hoa, cỡ ≥ 1,9 lần chữ thân bài, có dòng chữ nhỏ ngay bên phải ngang đỉnh. */
export function detectDropCaps(items: NormItem[]) {
  const sizes = items.filter(i => letterCount(i.str) >= 3).flatMap(i => Array(Math.min(20, letterCount(i.str))).fill(i.size));
  const body = median(sizes);
  if (!body) return;
  for (const it of items) {
    const t = it.str.trim();
    if (!/^["“‘(]?\p{Lu}\p{M}*$/u.test(t) || it.size < 1.9 * body) continue;
    const capTop = it.y - 0.72 * it.size, capX1 = it.x + it.w;
    const beside = items.filter(o => o !== it && letterCount(o.str) >= 1 && o.size < 0.6 * it.size &&
      o.x >= capX1 - 1 && o.x - capX1 < 2.5 * o.size && o.y > capTop && o.y - 0.7 * o.size < it.y + 0.2 * o.size);
    if (beside.some(o => o.y < capTop + 1.4 * o.size)) it.dropCap = true;
  }
}

const LEADING_NUM_RE = /^(\s*(?:\d{1,2}[.)]|\(\d{1,2}\)|\(?[a-z]\)|[ivx]{1,4}\.))(\s+)(?=\p{L})/u;

function splitLeadingBullets(items: NormItem[]): NormItem[] {
  const out: NormItem[] = [];
  for (const it of items) {
    // Số thứ tự dính liền chữ trong cùng một item: "3. Finally…", "(2) the related…" → tách ra (quy tắc chữ viết tắt
    // đầu đoạn sẽ ghép lại nếu thực ra là chữ của đoạn văn)
    const nm = it.str.match(LEADING_NUM_RE);
    if (nm && it.str.length > nm[0].length + 2) {
      const total = [...it.str].length;
      const headLen = [...nm[0]].length;
      const wHead = it.w * (headLen / total);
      out.push({ ...it, str: nm[1].trim(), w: wHead * 0.75 });
      out.push({ ...it, str: it.str.slice(nm[0].length), x: it.x + wHead, w: it.w - wHead });
      continue;
    }
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
    strong: c.filter(g => g.evidence >= 5).map(g => g.x),
    weak: c.filter(g => g.evidence >= 3 && g.evidence < 5).map(g => g.x),
  };
}

/** Khe dùng mặc định khi không có AI: bằng chứng ≥ 5 dòng mỗi bên. */
function defaultGutters(items: NormItem[]): number[] {
  return detectGutterCandidates(items).filter(g => g.evidence >= 5).map(g => g.x);
}

function detectGutterCandidates(items: NormItem[]): GutterCandidate[] {
  const all = items.filter(i => letterCount(i.str) >= 1 && i.w > 0);
  if (all.length < 12) return [];
  // Dò riêng cho từng cỡ chữ chiếm phần lớn trang (≥ 25% số chữ): trang có bảng chữ nhỏ nhiều ô ngắn từng làm
  // "cỡ phổ biến" lệch sang cỡ của bảng → bỏ sót khe giữa hai cột văn bản thân bài.
  const weight = new Map<number, number>();
  for (const i of all) { const k = Math.round(i.size * 2) / 2; weight.set(k, (weight.get(k) || 0) + letterCount(i.str)); }
  const totalW = [...weight.values()].reduce((a, b) => a + b, 0);
  const major = [...weight.entries()].filter(([, w]) => w >= 0.25 * totalW).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);
  const out: GutterCandidate[] = [];
  for (const size of major.length ? major : [median(all.map(i => i.size))]) {
    for (const g of gutterCandidatesForSize(all, size)) {
      const dup = out.find(o => Math.abs(o.x - g.x) < size);
      if (dup) dup.evidence = Math.max(dup.evidence, g.evidence); else out.push(g);
    }
  }
  return out;
}

function gutterCandidatesForSize(all: NormItem[], bodySize: number): GutterCandidate[] {
  const first = gutterCandidatesPass(all, bodySize, false);
  if (first.length) return first;
  // v10.3: vài dòng chạy ngang cả trang (khung "Sonographic findings" cuối trang 2 cột — Pitfalls tr.12) từng che mất khe cột
  // → không dò ra 2 cột, các dòng đầu hai cột bị nối thành một. Lượt 2 (chỉ khi lượt thường không thấy gì): bỏ các dòng rộng
  // (thiểu số < 30%) khỏi độ phủ, và chỉ nhận khe có bằng chứng rất rõ (≥ 8 hàng mỗi bên).
  return gutterCandidatesPass(all, bodySize, true).filter(g => g.evidence >= 8);
}

function gutterCandidatesPass(all: NormItem[], bodySize: number, dropWide: boolean): GutterCandidate[] {
  // Chỉ xét chữ thân bài (cỡ chữ này, ±10%): tiêu đề lớn / chú thích / chữ bảng chạy ngang trang không che mất khe cột
  const body = all.filter(i => Math.abs(i.size - bodySize) <= 0.1 * bodySize);
  if (body.length < 12) return [];
  const minX = Math.min(...body.map(i => i.x));
  const maxX = Math.max(...body.map(i => i.x + i.w));
  const span = maxX - minX;
  if (span < 100) return [];
  const size = median(body.map(i => i.size)) || 10;
  const step = Math.max(1, size / 6);
  const n = Math.ceil(span / step) + 1;
  const cover = new Array(n).fill(0);
  const wideItems = body.filter(i => i.w > 0.6 * span);
  const coverItems = dropWide && wideItems.length < 0.3 * body.length ? body.filter(i => i.w <= 0.6 * span) : body;
  for (const it of coverItems) {
    const a = Math.ceil((it.x + 0.5 - minX) / step), b = Math.floor((it.x + it.w - 0.5 - minX) / step);
    for (let k = Math.max(0, a); k <= Math.min(n - 1, b); k++) cover[k]++;
  }
  // Số "dòng" thực tế (hàng y khác nhau) để đặt ngưỡng
  const rowsY = new Set(coverItems.map(i => Math.round(i.y / Math.max(2, size * 0.5))));
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
    // Bằng chứng = số HÀNG chữ kết thúc sát bên trái / bắt đầu sát bên phải khe (tính cả chú thích hình cỡ nhỏ:
    // trang có cột trái phần lớn là hình thì chỉ còn chú thích + vài dòng thân bài làm bằng chứng)
    const rowKey = (i: NormItem) => Math.round(i.y / Math.max(2, 0.5 * size));
    const leftEnds = new Set(all.filter(i => { const e = i.x + i.w; return e <= mid && e >= gx0 - 2.5 * size; }).map(rowKey)).size;
    const rightStarts = new Set(all.filter(i => i.x >= mid && i.x <= gx1 + 2.5 * size).map(rowKey)).size;
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

function buildSegments(rawItems: NormItem[], gutterOverride?: number[], rules: HRule[] = []): Segment[] {
  const items = splitLeadingBullets(rawItems.filter(i => !i.dropCap));
  const gutters = gutterOverride ?? defaultGutters(items);
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: NormItem[][] = [];
  for (const it of sorted) {
    let bestRow: NormItem[] | null = null;
    let bestDy = Infinity;
    for (let r = rows.length - 1; r >= 0 && r >= rows.length - 4; r--) {
      // Hai item chồng nhau theo chiều ngang không thể cùng một hàng (vd. số chương cỡ lớn kéo 2 dòng tiêu đề vào một hàng)
      const clash = rows[r].some(o => Math.min(o.x + o.w, it.x + it.w) - Math.max(o.x, it.x) > 0.3 * Math.min(o.size, it.size) &&
        Math.abs(o.y - it.y) > 0.15 * Math.min(o.size, it.size) &&
        // v10.7: chỉ số trên/dưới nhỏ ("mL/m²" trong dòng căn đều) nằm chồng ngang lên chữ thường cùng hàng không phải là
        // "dòng khác" — trước đây đẩy nửa sau của dòng sang hàng riêng, đoạn có số liệu bị cắt vụn, số đè chữ (CT tim tr.207)
        Math.min(o.size, it.size) >= 0.75 * Math.max(o.size, it.size));
      if (clash) continue;
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
    let covered = 0, aligned = 0, exact = 0, covA = 0, covB = 0;
    for (let rj = Math.max(0, ri - 3); rj <= Math.min(rows.length - 1, ri + 3); rj++) {
      if (rj === ri || Math.abs(rowY[rj] - rowY[ri]) > 2.6 * size) continue;
      // v10.4: tính cả ô chỉ có số (bảng số: tiêu đề "Atypical  Nonanginal  Dyspnea" trên các hàng số từng bị nối thành 1 ô)
      const peers = rows[rj].filter(o => Math.abs(o.size - size) < 0.15 * size && (letterCount(o.str) > 0 || /\d/.test(o.str)));
      if (!peers.length) continue;
      if (peers.some(o => o.x < mid - 0.3 * size && o.x + o.w > mid + 0.3 * size)) { covered++; if (rj < ri) covA++; else covB++; continue; }
      // Dòng bên cạnh cũng trống tại đây: khe RỘNG (≥ 1 cỡ chữ) → cột bảng; khe hẹp = khoảng cách giữa 2 từ → vẫn là chữ chạy
      const ends = peers.filter(o => o.x + o.w <= mid + 0.3 * size).map(o => o.x + o.w);
      const starts = peers.filter(o => o.x >= mid - 0.3 * size).map(o => o.x);
      // v10.4: ô trống bên trái (bảng có ô gộp dọc: "Moderate | Diffuse urticarial…" mà hàng trên/dưới chỉ có cột phải)
      // nhưng chữ dòng lân cận bắt đầu đúng mép ô → cột bảng
      if (!ends.length && starts.length && Math.abs(Math.min(...starts) - b) < 0.15 * size && Math.min(...starts) - a > 0.8 * size) { aligned++; exact++; continue; }
      if (!ends.length || !starts.length) continue;
      const nGap = Math.min(...starts) - Math.max(...ends);
      // v10.4: cột bảng — chữ dòng lân cận bắt đầu ĐÚNG mép trái ô này (lệch < 0,15 cỡ chữ) và có khe ≥ 0,8 cỡ chữ.
      // (Danh mục viết tắt CT tim tr.48: "ALARA" dài làm khe dòng trên hẹp lại → "BMI  Body mass index" bị nối thành 1 dòng
      // rồi nhập vào khối ALARA, chữ đè nhau, mất dòng BMI.)
      const isExact = Math.abs(Math.min(...starts) - b) < 0.15 * size && nGap >= 0.8 * size;
      if (isExact) exact++;
      if (nGap >= Math.max(size, 0.5 * (b - a)) || isExact) aligned++;
      else { covered++; if (rj < ri) covA++; else covB++; }
    }
    // v10.4: hàng tiêu đề / hàng cuối của bảng: chữ chạy qua chỉ ở MỘT phía (chú thích bảng phía trên hoặc ghi chú phía dưới),
    // phía kia là các hàng bảng có ô bắt đầu đúng mép này → cột bảng ("Atypical  Nonanginal  Dyspnea", "Men  ≤52")
    const oneSided = covA === 0 || covB === 0;
    if (exact >= 1 && oneSided && aligned >= covered) aligned = covered + 1;
    return { covered, aligned, exact, oneSided };
  };

  // v10.3: dòng lân cận có chữ chạy LIỀN qua vị trí x (một từ vắt qua, hoặc chỉ cách một khoảng trắng giữa từ < 0,8 cỡ chữ)?
  // Khe cột trang thật: dòng lân cận luôn hở ở đó (≥ ~1 cỡ chữ).
  const flowsAcross = (ri: number, x: number, size: number) => {
    let cross = 0, open = 0;
    for (let rj = Math.max(0, ri - 3); rj <= Math.min(rows.length - 1, ri + 3); rj++) {
      if (rj === ri || Math.abs(rowY[rj] - rowY[ri]) > 2.6 * size) continue;
      const peers = rows[rj].filter(o => Math.abs(o.size - size) < 0.15 * size && letterCount(o.str) > 0);
      if (!peers.length) continue;
      if (peers.some(o => o.x < x - 0.3 * size && o.x + o.w > x + 0.3 * size)) { cross++; continue; }
      const ends = peers.filter(o => o.x + o.w <= x + 0.3 * size).map(o => o.x + o.w);
      const starts = peers.filter(o => o.x >= x - 0.3 * size).map(o => o.x);
      if (!ends.length || !starts.length) continue;
      if (Math.min(...starts) - Math.max(...ends) < 0.8 * size) cross++; else open++;
    }
    return cross >= 2 && cross > open;
  };

  const segments: Segment[] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri];
    const mainSize = median(row.map(r => r.size));
    let cur: NormItem[] = [];
    const flush = () => { if (cur.length) { segments.push(makeSegment(cur)); cur = []; } };
    for (const it of row) {
      if (cur.length) {
        // v10.4: mẩu trước = mẩu CÓ CHỮ cuối cùng (bỏ qua mẩu chỉ là khoảng trắng — bảng Springer ghi " " riêng sau mỗi ô:
        // "CACS" " " "Chest CT" → khe đo từ cuối " " nên tưởng chỉ là khoảng cách giữa 2 từ, cả hàng tiêu đề thành 1 ô)
        let pi = cur.length - 1;
        while (pi > 0 && !cur[pi].str.trim()) pi--;
        const prev = cur[pi];
        const prevEnd = cur[cur.length - 1].str.trim() ? prev.x + prev.w : Math.max(prev.x + prev.w, Math.min(it.x, prev.x + prev.w + 0.35 * prev.size));
        const gap = it.x - prevEnd;
        const curText = cur.map(c => c.str).join('').trim();
        // Số mục / ký hiệu đầu dòng ("10", "1.2", "•", "a)") đứng tách khỏi chữ → khối riêng
        const labelBreak = cur.length === 1 && LABEL_RE.test(curText) && gap > 0.2 * mainSize && /[\p{L}\p{N}(≥≤<>±~]/u.test(it.str);
        // Khoảng trống rơi vào khe cột → luôn tách (kể cả khi khe hẹp)
        // v10.3: khe cột chỉ có hiệu lực ở hàng này khi các dòng ngay trên/dưới KHÔNG có chữ chạy qua nó — khe giữa các cột
        // BẢNG bên dưới (CT tr.220: x=414) từng cắt đôi dòng thân bài cột trái phía trên bảng ("ularly in regions |
        // where drug costs are a") → mẩu câu thành khối riêng vẽ chồng lên đoạn văn
        // (mép phải THẬT của mẩu trước: bỏ khoảng trắng / gạch nối mềm cuối mẩu — "well-\u00ad " có bề rộng khai báo lấn qua
        // khe cột → trước đây hai dòng của hai cột bị nối thành một, vẽ tràn ngang trang)
        const visEnd = (() => { const t = prev.str.replace(/[\s\u00ad]+$/u, ''); return prev.str.length ? prev.x + prev.w * (t.length / prev.str.length) : prevEnd; })();
        // (khe dò được có thể lệch vào trong mép cột vài px: Parathyroid tr.137 khe 252,7pt, dòng trái kết thúc ở 253,7pt)
        // (v10.4: không cắt giữa dấu chấm dẫn mục lục ". . . ." và số trang ngay sau)
        const leaderNum = /(\.\s?){3,}\s*$|…\s*$/.test(curText) && /^\s*[\dxivlcXIVLC]/.test(it.str);
        const gutterBreak = !leaderNum && it.x - visEnd > 0.35 * mainSize && gutters.some(g => g >= visEnd - 0.5 * mainSize && g <= it.x + 0.3 * mainSize && !flowsAcross(ri, g, mainSize));
        // Dòng căn đều có khoảng trắng giữa từ rất rộng: từ tiếp theo viết thường, cùng cỡ chữ → vẫn là một dòng
        // v10.4: mẩu trước chỉ có số ("25–49%,  50–69%,  70–99%),  as" — CT tim tr.35) cũng tính: trước đây dòng căn đều
        // có dãy số bị cắt thành 4 mẩu → đoạn văn tách đôi, mẩu số lơ lửng lệch phải. Bảng số thật vẫn tách vì dòng lân cận
        // không có chữ chạy qua khe (covered = 0).
        // v10.7: so cỡ với mẩu chữ THƯỜNG cuối (bỏ chỉ số trên "m²" nhỏ) và tính cả mẩu chỉ có ký hiệu ("73 ±" | "22 mL") —
        // trước đây dòng căn đều có "mL/m²   (95%  CI," hay "± 22" bị cắt vụn (CT tim tr.207–208)
        let mi = pi;
        while (mi > 0 && (!cur[mi].str.trim() || cur[mi].size < 0.8 * mainSize)) mi--;
        const prevMain = cur[mi];
        const sameFont = Math.abs(it.size - prevMain.size) < 0.1 * mainSize && /[\p{L}\p{N}±×%<>=≤≥+\-–)\]]/u.test(prevMain.str) && !LABEL_RE.test(curText);
        const jg = !gutterBreak && sameFont && gap <= 4.5 * mainSize && gap > 0.6 * mainSize
          ? isJustifiedGap(ri, prevEnd, it.x, mainSize) : null;
        const justifiedGap = !gutterBreak && sameFont && (gap <= 4.5 * mainSize || (/^\s*\p{Ll}/u.test(it.str) && gap <= 6 * mainSize)) &&
          (() => {
            const j = jg || isJustifiedGap(ri, prevEnd, it.x, mainSize);
            // khe trùng vị trí với dòng trên/dưới → cột bảng. v10.3: chỉ khi số dòng lân cận có khe trùng NHIỀU HƠN số dòng
            // có chữ chạy qua — dòng căn đều giãn rộng ("the   thyroid   gland   laterally   and") cạnh một dòng giãn khác
            // từng bị cắt thành 2 ô bảng lơ lửng
            // v10.7: dòng căn đều rất thưa trong ô hẹp ("Computed          tomography" / "angiography" — danh mục viết tắt):
            // mẩu sau viết thường, là mẩu CUỐI hàng và chạm đúng mép phải cột chữ (mép phải xa nhất của các dòng bắt đầu
            // cùng mép trái với mẩu đang gom) → vẫn một dòng
            const nx = row[row.indexOf(it) + 1];
            // v11: KHÔNG áp dụng khi mẩu sau bắt đầu ĐÚNG mép cột định nghĩa của ≥ 2 dòng lân cận (danh mục viết tắt Clark's
            // tr.17: "cfNIPT" | "cell-free non-invasive…" — mép phải tình cờ trùng một dòng khác → bị nối thành 1 dòng, nhập
            // vào khối "CFA" ở trên, bản dịch đè lên "common femoral artery")
            if (j.exact < 2 && /^\s*\p{Ll}/u.test(it.str) && gap <= 6 * mainSize && !/[.!?:;]\W{0,2}$/.test(curText) && (!nx || nx.x - (it.x + it.w) > 1.5 * mainSize)) {
              const x0 = cur[0].x;
              let edge = -Infinity;
              for (let rj = Math.max(0, ri - 30); rj <= Math.min(rows.length - 1, ri + 30); rj++) {
                if (rj === ri || Math.abs(rowY[rj] - rowY[ri]) > 30 * mainSize) continue;
                const r = rows[rj];
                if (!r.some(o => Math.abs(o.x - x0) < 0.5 * mainSize && Math.abs(o.size - mainSize) < 0.15 * mainSize)) continue;
                for (const o of r) if (o.str.trim() && o.x >= x0 - 0.5 * mainSize && o.x < it.x + it.w && o.x + o.w <= it.x + it.w + 2 * mainSize && Math.abs(o.size - mainSize) < 0.15 * mainSize) edge = Math.max(edge, o.x + o.w);
              }
              if (Math.abs(it.x + it.w - edge) < 0.6 * mainSize) return true;
            }
            if (j.aligned > j.covered) return false;
            // v10.7: khe rất rộng (> 2,5 cỡ chữ) mà chỉ MỘT dòng lân cận có chữ chạy qua → ô bảng kế bên, không phải dòng
            // căn đều (Bảng 11.1 CT tim tr.125: "320 MDCT meta-analysis of 12" | "1592" bị nối thành một ô, số đè lên chữ)
            if (j.covered < 2 && gap > 2.5 * mainSize && !/^\s*\p{Ll}/u.test(it.str)) return false;
            // v10.4: khe rộng > 3 cỡ chữ mà không dòng lân cận nào có chữ chạy qua → không phải dòng dàn đều mà là sang ô
            // bảng bên cạnh, kể cả khi ô sau viết thường ("descending artery" | "artery (LCx)")
            // (v10.7: không khi dòng lân cận có ô bắt đầu đúng chỗ mẩu sau — "(<50%) in 1–2" | "modifications" bảng 25.8)
            if (/^\s*\p{Ll}/u.test(it.str) && gap <= 3 * mainSize && !(j.exact >= 1 && j.covered === 0)) return true;
            return j.covered >= 1;
          })();
        // Bảng 2 cột (danh mục chữ viết tắt "BRCA1 and BRCA2   Breast cancer gene…"): ô bên trái dài làm khe cột hẹp
        // lại (< 1,2 cỡ chữ) → trước đây 2 ô bị nối thành 1 dòng rồi nhập luôn vào hàng trên. Khe nằm đúng vị trí khe
        // cột của ≥2 dòng lân cận và không dòng nào có chữ chạy qua → tách ô.
        // v10.7: hàng nằm GIỮA các đường kẻ bảng (≥ 3 đường kẻ ngang cùng phủ vị trí này trong phạm vi ~25 cỡ chữ, có đường
        // trên và đường dưới) → bảng có kẻ: khe ≥ 0,6 cỡ chữ mà dòng lân cận có ô bắt đầu đúng mép = sang ô khác
        // ("I  Normal", "(<50%) in 1–2  modifications" bảng 25.8 CT tim tr.336 bị nối liền hai cột)
        const ruledRow = (() => {
          const hit = rules.filter(r => r.x0 < it.x + 0.5 * mainSize && r.x1 > prevEnd - 0.5 * mainSize && Math.abs(r.y - it.y) < 25 * mainSize);
          return hit.length >= 3 && hit.some(r => r.y < it.y - 0.5 * mainSize) && hit.some(r => r.y > it.y);
        })();
        const tableBreak = (ruledRow && !leaderNum && sameFont && gap <= 12 * mainSize && ((!!jg && jg.exact >= 1 && (jg.covered < 2 || gap > 2 * mainSize) && gap > 0.6 * mainSize) || (gap > 1.5 * mainSize && !(jg && jg.covered >= 2)) ||
          // cột bảng sát nhau ("Stage Definition" khe chỉ 0,4 cỡ chữ): ≥ 2 dòng dưới/trên có ô bắt đầu đúng mép này
          (it.x - (prev.x + prev.w) > 0.3 * mainSize && !jg && (() => { const j2 = isJustifiedGap(ri, prev.x + prev.w, it.x, mainSize); return (j2.exact >= 2 && j2.exact > j2.covered) || (j2.exact >= 1 && j2.aligned >= 2 && j2.aligned > j2.covered); })()))) ||
          !!jg && !leaderNum && ( (jg.aligned >= 2 && jg.covered === 0) ||
          // v10.6: cột bảng khít (khe chỉ ≈ 1 cỡ chữ, bảng 19.7 CT tim tr.245): ≥ 2 dòng lân cận có ô bắt đầu ĐÚNG mép này
          // → sang ô khác, kể cả khi ô sau viết thường ("…mass on valve or" | "lesion that is attached…")
          (jg.exact >= 2 && jg.exact >= jg.covered && gap > 0.85 * mainSize) ||
          (jg.exact >= 1 && jg.oneSided && jg.aligned > jg.covered && (jg.covered === 0 || gap > 1.0 * mainSize) && /^\s*[\p{Lu}\p{N}≤≥<>±(]/u.test(it.str)) ||
          // v10.4: khoảng trống rất rộng (≥ 3,5 cỡ chữ) mà mảnh sau thẳng mép trái với một mảnh ở dòng kề = sang cột bảng khác
          // ("descending artery" | "artery (LCx)" bảng 18 đoạn SCCT) — dòng dàn đều không bao giờ hở rộng như vậy
          ((jg.exact >= 1 || (jg.aligned >= 1 && jg.oneSided)) && gap > 3.5 * mainSize && /^\s*[\p{L}\p{N}≤≥<>±(]/u.test(it.str)));
        // Hai mảnh chữ khác cỡ hẳn (thân bài ↔ chú thích hình) đứng cách nhau trên cùng hàng = hai cột khác nhau
        // (sách Springer: khe cột chỉ ≈ 1,15 cỡ chữ, chỗ cột bên kia chỉ có hình + chú thích thì không dò ra khe)
        // (v10.2: so với cỡ chính của phần đã gom + cho phép mảnh sau là số mục "10." của cột tài liệu tham khảo bên cạnh —
        // trước đây dòng thân bài "…cause of onco-" bị nối với "10. Battisti F…" của cột phải → chữ đè lên nhau)
        // (v10.4: bỏ chỉ số trên / khoảng trắng nhỏ khi tính cỡ — "<6 mm²" + " for the left main" từng bị cắt đôi vì cỡ trung vị
        // rơi vào cỡ của chữ "2" mũ)
        const sizedCur = cur.filter(c => letterCount(c.str) > 0 && c.size > 0.75 * mainSize);
        const curSize = median((sizedCur.length ? sizedCur : cur).map(c => c.size));
        // v11: cỡ ghi trong PDF bằng nhau (chỉ khác do đo mực: từ in đậm ngắn "Doppler" đầu đoạn đo ra 28,5 so với 33,6) →
        // vẫn cùng dòng. Trước đây từ đậm bị tách thành khối riêng, giữ nguyên chữ gốc và đè lên dòng dịch (Clark's tr.8)
        const samePdfSize = !!it.pdfSize && !!prevMain.pdfSize && Math.abs(it.pdfSize - prevMain.pdfSize) < 0.03 * it.pdfSize;
        const sizeBreak = !samePdfSize && gap > 0.5 * Math.min(it.size, curSize) &&
          Math.abs(it.size - curSize) > 0.1 * Math.max(it.size, curSize) &&
          letterCount(curText) >= 2 && (letterCount(it.str) >= 2 || LABEL_RE.test(it.str.trim()));
        // v10.6: dòng đầu chú thích hình/bảng căn đều ("Fig. 19.11 Aortic   Dissection   Related   Aortic") có khe rộng
        // giữa các từ viết hoa trùng khe dòng dưới → từng bị cắt thành ô bảng, mẩu giữa vẽ chồng lên chú thích (CT tim tr.238)
        const captionRun = !gutterBreak && !(jg && jg.exact >= 2) && !(jg && jg.exact >= 1 && jg.covered === 0 && gap > 1.0 * mainSize) && sameFont && gap <= 2 * mainSize && /^(fig\.?|figure|table|tab\.)\s*\d/i.test(curText);
        // v10.7: mẩu cuối dòng cột trái chạm sát (thậm chí chồng) tiêu đề đậm của cột phải ("…57 ± 8%" | "17.8.3.1
        // Arrhythmogenic", CT tim tr.208): khác font đậm/thường + có khe cột ngay đó → hai cột khác nhau
        const fontJump = prev.bold !== it.bold && it.font !== prev.font && gap < 0.35 * mainSize && (/^\s*\d/.test(it.str) || it.size > 1.03 * prev.size) &&
          gutters.some(g => g > prev.x + 0.5 * mainSize && g < it.x + 1.5 * mainSize);
        // v10.10: dòng căn đều cột trái chạm sát dòng đầu cột phải (khe chỉ ≈ 1,1 cỡ chữ, cột phải chỉ có vài dòng nên không
        // dò ra khe cột): mẩu sau thẳng mép trái với dòng kề của cột phải và không dòng lân cận nào chạy qua khe → sang cột khác
        // ("…all breast masses, whether" | "completely excise small benign nodules", Interventional US tr.51)
        const colJump = !!jg && jg.exact >= 1 && jg.covered === 0 && gap > 1.0 * mainSize && sameFont && !leaderNum;
        if (colJump || gutterBreak || fontJump || labelBreak || sizeBreak || (tableBreak && !captionRun) || (gap > 1.2 * mainSize && !justifiedGap && !captionRun)) flush();
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
    if (S.leader) continue; // dòng mục lục ("… 71") — số mục là số mục thật
    const wrapsUnder = segs.some(n => n !== L && n !== S && !n.leader && !LABEL_RE.test(n.text.trim()) &&
      n.y > S.y + 0.5 * S.size && n.y < S.y + 1.9 * S.size &&
      Math.abs(n.size - S.size) < 0.12 * S.size && n.x0 <= L.x0 + 0.6 * S.size && n.x0 >= L.x0 - 2.5 * S.size && n.x1 > S.x0 + 2 * S.size);
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
    const needSpace = runs.length > 0 && gap > 0.12 * size && !/\s$/.test(runs[runs.length - 1].text) && !/^\s/.test(piece) && !isSup &&
      !/^[,.;:!?)\]}%]/.test(piece) && !/[([{]$/.test(runs[runs.length - 1].text);
    const style: RunStyle = isSup && lastStyle
      ? lastStyle
      : { bold: it.bold, italic: it.italic, color: it.color };
    // Item không có chữ cái (dấu câu, số) kế thừa kiểu chữ trước để tránh vỡ vụn
    // (số trích dẫn màu xanh "6, 7" có chữ số → giữ màu riêng; trước đây bị kế thừa màu đen của chữ trước)
    const effective: RunStyle = !/[\p{L}\p{N}]/u.test(piece) && lastStyle ? lastStyle : style;
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

/** Đường kẻ ngang mảnh (đường kẻ hàng bảng, gạch phân cách) trên bản vẽ trang KHÔNG có chữ. */
export interface HRule { y: number; x0: number; x1: number }
export function findHRules(img: ImageData): HRule[] {
  const { width: W, height: H, data: d } = img;
  const minLen = Math.max(40, 0.035 * W);
  // đường kẻ = hàng điểm ảnh mảnh khác màu hẳn với cả phía trên lẫn phía dưới 4px: đường kẻ tối trên nền trắng, hoặc
  // vạch trắng ngăn các hàng bảng tô nền (bảng Springer nền xanh nhạt)
  const diff = (x: number, y1: number, y2: number) => {
    const i = (y1 * W + x) * 4, j = (y2 * W + x) * 4;
    return Math.abs(d[i] - d[j]) + Math.abs(d[i + 1] - d[j + 1]) + Math.abs(d[i + 2] - d[j + 2]);
  };
  const segs: HRule[] = [];
  for (let y = 4; y < H - 4; y++) {
    let start = -1;
    for (let x = 0; x <= W; x++) {
      const on = x < W && diff(x, y, y - 4) > 45 && diff(x, y, y + 4) > 45;
      if (on) { if (start < 0) start = x; }
      else if (start >= 0) { if (x - start >= minLen) segs.push({ y, x0: start, x1: x }); start = -1; }
    }
  }
  // gộp các hàng điểm ảnh liền nhau của cùng một đường kẻ
  const out: HRule[] = [];
  for (const sg of segs) {
    const o = out.find(r => sg.y - r.y <= 3 && Math.min(r.x1, sg.x1) - Math.max(r.x0, sg.x0) > 0.5 * (sg.x1 - sg.x0));
    if (o) { o.x0 = Math.min(o.x0, sg.x0); o.x1 = Math.max(o.x1, sg.x1); o.y = sg.y; } else out.push({ ...sg });
  }
  return out.length > 400 ? [] : out; // quá nhiều = vùng ảnh / hoạ tiết, không phải đường kẻ
}

/** v10.8: khung chữ nhật có viền (ô của sơ đồ / lưu đồ, hộp ghi chú) trên bản vẽ không chữ. */
export interface TextBox { x0: number; x1: number; top: number; bottom: number; bullets?: { x: number; y: number }[] }
export function findBoxes(img: ImageData, rules: HRule[]): TextBox[] {
  const { width: W, height: H, data: d } = img;
  const lum = (x: number, y: number) => { const i = (y * W + x) * 4; return 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; };
  // cột x có nét viền dọc chạy suốt từ y0 tới y1 (≥ 85% điểm ảnh tối hơn hẳn nền bên trong)
  const vline = (x0: number, x1: number, y0: number, y1: number, inside: number) => {
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      let n = 0, on = 0;
      for (let y = y0; y <= y1; y++) { n++; if (Math.abs(lum(x, y) - inside) > 60) on++; }
      if (n > 0 && on >= 0.85 * n) return true;
    }
    return false;
  };
  const out: TextBox[] = [];
  const tol = Math.max(4, 0.006 * W);
  // đoạn kẻ cùng độ cao bị đường nối dọc cắt rời (cạnh trên ô lưu đồ chỗ mũi tên đi vào) → nối lại
  const joined: HRule[] = [];
  for (const r of [...rules].sort((p, q) => p.y - q.y || p.x0 - q.x0)) {
    const o = joined.find(j => Math.abs(j.y - r.y) <= 2 && r.x0 - j.x1 < 10 && r.x0 >= j.x0);
    if (o) o.x1 = Math.max(o.x1, r.x1); else joined.push({ ...r });
  }
  rules = joined;
  for (const t of rules) {
    const w = t.x1 - t.x0;
    if (w > 0.8 * W || w < 0.04 * W) continue;
    const b = rules.filter(r => r.y > t.y + 12 && r.y - t.y < 0.3 * H && Math.abs(r.x0 - t.x0) < tol && Math.abs(r.x1 - t.x1) < tol)
      .sort((p, q) => p.y - q.y)[0];
    if (!b) continue;
    // v10.10: cạnh trên/dưới chạy tiếp sang ô bên cạnh (đường kẻ hàng bảng dài hơn cùng độ cao) → ô bảng, không phải
    // khung lưu đồ (Bảng 19.2 CT tim tr.237: ô "Asymptomatic severe AS" bị coi là khung → căn giữa, mất cỡ chữ chung của bảng)
    const runsOn = (e: HRule) => rules.some(r => r !== e && Math.abs(r.y - e.y) <= 3 && (r.x0 < e.x0 - 2 * tol || r.x1 > e.x1 + 2 * tol) && Math.min(r.x1, e.x1) - Math.max(r.x0, e.x0) > -2 * tol);
    if (runsOn(t) || runsOn(b)) continue;
    // có đường kẻ khác cắt ngang giữa (hàng bảng) → không phải một khung
    if (rules.some(r => r !== t && r !== b && r.y > t.y + 3 && r.y < b.y - 3 && Math.min(r.x1, t.x1) - Math.max(r.x0, t.x0) > 0.5 * w)) continue;
    const y0 = Math.round(t.y + 3), y1 = Math.round(b.y - 3);
    if (y1 - y0 < 8) continue;
    const inside = lum(Math.round((t.x0 + t.x1) / 2), Math.round((y0 + y1) / 2));
    const x0 = Math.round(Math.min(t.x0, b.x0)), x1 = Math.round(Math.max(t.x1, b.x1));
    if (!vline(x0 - 3, x0 + 4, y0, y1, inside) || !vline(x1 - 5, x1 + 2, y0, y1, inside)) continue;
    // kẻ dọc bên trong (lưới bảng) → không phải khung đơn
    if (vline(x0 + 8, x1 - 9, y0, y1, inside)) continue;
    if (out.some(o => Math.abs(o.x0 - x0) < tol && Math.abs(o.top - t.y) < 4)) continue;
    // ký hiệu đầu dòng VẼ (không phải chữ) trong khung: đốm tối nhỏ gần vuông ở nửa trái khung
    const bullets: { x: number; y: number }[] = [];
    const bw = Math.min(x1 - x0 - 10, Math.round(0.5 * (x1 - x0)));
    const seen = new Uint8Array(bw * (y1 - y0 + 1));
    const dark = (x: number, y: number) => Math.abs(lum(x, y) - inside) > 80;
    for (let y = y0 + 2; y < y1 - 1; y++) for (let x = x0 + 6; x < x0 + 6 + bw - 6; x++) {
      const k = (y - y0) * bw + (x - x0 - 6);
      if (seen[k] || !dark(x, y)) continue;
      // tô loang trong ô 30×30
      const st = [[x, y]]; let n = 0, mx0 = x, mx1 = x, my0 = y, my1 = y;
      seen[k] = 1;
      while (st.length && n < 400) {
        const [cx, cy] = st.pop()!; n++;
        mx0 = Math.min(mx0, cx); mx1 = Math.max(mx1, cx); my0 = Math.min(my0, cy); my1 = Math.max(my1, cy);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < x0 + 6 || nx >= x0 + bw || ny < y0 || ny > y1) continue;
          const kk = (ny - y0) * bw + (nx - x0 - 6);
          if (!seen[kk] && dark(nx, ny)) { seen[kk] = 1; st.push([nx, ny]); }
        }
      }
      const w2 = mx1 - mx0 + 1, h2 = my1 - my0 + 1;
      if (w2 >= 3 && h2 >= 3 && w2 <= 16 && h2 <= 16 && Math.abs(w2 - h2) <= 3 && n >= 0.5 * w2 * h2) bullets.push({ x: (mx0 + mx1) / 2, y: (my0 + my1) / 2 });
    }
    out.push({ x0, x1, top: t.y, bottom: b.y, bullets });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* v10.4: Công thức toán → giữ nguyên xi bản gốc                        */
/* ------------------------------------------------------------------ */

// Ký tự điều khiển: font công thức (MathematicalPi, Symbol…) không có bảng mã Unicode → pdf.js trả mã thô
// Chữ Hy Lạp, toán tử, chữ toán học (𝑥, 𝜇…), dấu căn/tổng/tích phân
const MATH_RE = /[\u0370-\u03ff\u2200-\u22ff\u2061-\u2064\u27c0-\u27ef\u2980-\u2aff\u{1d400}-\u{1d7ff}]/gu;
const STRONG_MATH_RE = /[∑∏∫∮√∂∇∞≈≠≡∝]|[\u{1d400}-\u{1d7ff}]/u;

/** Một khối (thường 1 dòng) trông như công thức: có ký tự mã thô / ký hiệu toán và rất ít từ thường. */
export function isFormulaText(text: string): boolean {
  const t = text.replace(/<\/?\d+>/g, '').trim();
  if (!t) return false;
  // Từ thường (≥ 3 chữ cái Latin liền nhau, không dính ký hiệu toán)
  const words = t.split(/\s+/).filter(w => /^[(\[]?[A-Za-z]{3,}[)\].,;:]?$/.test(w)).length;
  // Ký tự mã thô KHÔNG đứng trước chữ thường: ký hiệu toán (μ, −, phân số…). Mã thô đứng trước chữ thường là chữ ghép
  // hỏng của font chữ thường ("calcifica\u001fons" = calcifications) → không phải công thức.
  const fctrl = (t.match(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f](?!\p{Ll})/gu) || []).length;
  if (words === 0 && t.replace(/\s/g, '').length >= 2 && (fctrl >= 2 || (fctrl >= 1 && /\d/.test(t)))) return true;
  const math = (t.match(MATH_RE) || []).length;
  const ops = (t.match(/[=+−×÷^]/g) || []).length;
  // "√ √ √" (dấu tích trong bảng) không phải công thức: cần thêm phép toán
  if (words <= 4 && STRONG_MATH_RE.test(t) && ops >= 1 && math + ops >= 2) return true;
  // "CT Number (HU) = (μ − μwater)/μwater × 1000", "v = f × λ": có "=", có ký hiệu toán, gần như không có câu chữ
  if (words <= 3 && /=/.test(t) && math >= 1 && ops >= 2) return true;
  return false;
}

/**
 * Đánh dấu khối công thức (không dịch, không xoá, không vẽ đè → giữ nguyên điểm ảnh gốc). Các mẩu nhỏ cùng hàng với công
 * thức (chỉ số dưới "water", mẫu số, "× 1000", số hiệu "(1.1)") được gộp vào vùng công thức.
 */
export function markFormulaBlocks(blocks: LayoutBlock[]): number {
  const isF = new Set<string>();
  for (const b of blocks) if (!b.rotate && b.lineCount <= 2 && isFormulaText(b.text)) isF.add(b.id);
  if (!isF.size) return 0;
  for (let pass = 0; pass < 3; pass++) {
    const fs = blocks.filter(b => isF.has(b.id));
    let grew = false;
    for (const b of blocks) {
      if (isF.has(b.id) || b.rotate || b.lineCount > 2) continue;
      const words = b.plain.trim().split(/\s+/).filter(Boolean).length;
      if (words > 4) continue;
      const near = fs.some(f => {
        const sz = Math.max(f.size, b.size);
        const vOverlap = Math.min(f.bottom, b.bottom) - Math.max(f.top, b.top);
        const vGap = Math.max(f.top - b.bottom, b.top - f.bottom);
        const hGap = Math.max(f.x0 - b.x1, b.x0 - f.x1);
        // cùng hàng (chồng dọc) và sát ngang, hoặc ngay trên/dưới (tử/mẫu số) và chồng ngang
        return (vOverlap > -0.2 * sz && hGap < 1.2 * sz && b.size <= 1.05 * f.size) ||
          (vGap < 0.8 * sz && Math.min(f.x1, b.x1) - Math.max(f.x0, b.x0) > 0 && b.size < 0.9 * f.size);
      });
      if (near) { isF.add(b.id); grew = true; }
    }
    if (!grew) break;
  }
  for (const b of blocks) if (isF.has(b.id)) { b.translatable = false; b.formula = true; }
  return isF.size;
}

/** Đường ngang là gạch chân chữ: nằm ngay dưới đường chân của các mẩu chữ cùng dòng và chữ phủ ≥ 85% chiều dài. */
export function isUnderlineRule(r: HRule, items: NormItem[]): boolean {
  const near = items.filter(it => it.str.trim() && it.size > 0 && r.y > it.y && r.y < it.y + 0.32 * it.size &&
    it.x < r.x1 && it.x + it.w > r.x0);
  if (!near.length) return false;
  const size = Math.max(...near.map(it => it.size));
  const iv = near.map(it => [Math.max(r.x0, it.x), Math.min(r.x1, it.x + it.w)] as [number, number]).sort((a, b) => a[0] - b[0]);
  let covered = 0, cs = iv[0][0], ce = iv[0][1], maxGap = 0;
  for (const [a, b] of iv.slice(1)) {
    maxGap = Math.max(maxGap, a - ce);
    if (a <= ce + 0.6 * size) ce = Math.max(ce, b);
    else { covered += ce - cs; cs = a; ce = b; }
  }
  covered += ce - cs;
  if (covered >= 0.85 * (r.x1 - r.x0)) return true;
  // dòng căn đều giãn rộng: gạch chân bắt đầu / kết thúc đúng ở đầu / cuối chữ, khoảng trống giữa các từ < 2,5 cỡ chữ
  const minX = Math.min(...near.map(it => it.x)), maxX = Math.max(...near.map(it => it.x + it.w));
  return near.length >= 2 && Math.abs(r.x0 - minX) < 0.5 * size && Math.abs(r.x1 - Math.min(maxX, r.x1)) < 0.5 * size &&
    r.x0 >= minX - 0.5 * size && maxGap < 2.5 * size;
}

export function buildBlocks(
  items: NormItem[], pageWidth: number, pageHeight = pageWidth * 1.414, gutterOverride?: number[], rules: HRule[] = [], boxes: TextBox[] = [],
): LayoutBlock[] {
  const gutters = gutterOverride ?? defaultGutters(splitLeadingBullets(items));
  // v10.6: gạch chân chữ (nằm sát dưới đường chân chữ, chữ phủ gần kín chiều dài) không phải đường kẻ bảng.
  // Trước đây gạch chân các mục "Selection of the best cardiac phase:" làm cả cột văn bản bị coi là bảng có kẻ.
  rules = rules.filter(r => !isUnderlineRule(r, items));
  const segments = buildSegments(items, gutters, rules).filter(s => s.text.length > 0);
  segments.sort((a, b) => a.y - b.y || a.x0 - b.x0);
  // v10.8: khung chữ (ô lưu đồ) chứa dòng — khung nhỏ nhất bao trọn dòng. Khung có ≥ 2 mẩu chữ đứng cạnh nhau cùng hàng
  // (không phải ký hiệu đầu dòng) là hàng bảng có kẻ viền → bỏ.
  const boxList = boxes.filter(bx => {
    const ins = segments.filter(sg => sg.x0 >= bx.x0 - 2 && sg.x1 <= bx.x1 + 2 && sg.y - 0.85 * sg.size >= bx.top - 2 && sg.y + 0.2 * sg.size <= bx.bottom + 2);
    if (!ins.length || ins.length > 14) return false;
    return !ins.some(a => !a.isLabel && ins.some(o => o !== a && !o.isLabel && Math.abs(o.y - a.y) < 0.4 * a.size && (o.x0 > a.x1 + 0.3 * a.size || o.x1 < a.x0 - 0.3 * a.size)));
  });
  const boxCache = new Map<Segment, TextBox | null>();
  const boxOf = (sg: Segment): TextBox | null => {
    if (!boxList.length) return null;
    let c = boxCache.get(sg);
    if (c !== undefined) return c;
    c = null;
    for (const bx of boxList) {
      if (sg.x0 >= bx.x0 - 2 && sg.x1 <= bx.x1 + 2 && sg.y - 0.85 * sg.size >= bx.top - 2 && sg.y + 0.2 * sg.size <= bx.bottom + 2 &&
        (!c || (bx.x1 - bx.x0) * (bx.bottom - bx.top) < (c.x1 - c.x0) * (c.bottom - c.top))) c = bx;
    }
    boxCache.set(sg, c);
    return c;
  };

  // Hàng bảng: dòng có "ô" chữ khác cùng hàng (cùng cột trang, không cách bởi khe cột).
  // Số trang / số thuần, ký hiệu đầu dòng không tính là ô (để mục lục, danh sách vẫn nối dòng được).
  const wide = (o: Segment) => o.x1 - o.x0 > 0.3 * pageWidth;
  const paraLine = (o: Segment) => wide(o) || segments.some(u => u !== o && wide(u) && Math.abs(u.x0 - o.x0) < 0.5 * o.size &&
    o.y - u.y > 0.5 * o.size && o.y - u.y < 1.8 * o.size && Math.abs(u.size - o.size) < 0.1 * o.size);
  // Ô chữ viết tắt ngắn có số ("E2", "T1", "H2O") cũng là ô bảng (trước đây cần ≥2 chữ cái → hàng "E2 | Estradiol"
  // không được coi là hàng bảng và bị nối vào hàng trên: "Digital radiography Estradiol")
  const isCellLike = (o: Segment) => !o.isLabel && !o.leader && !/^[\d\s.,–\-()%]+$/.test(o.text.trim()) &&
    (letterCount(o.text) >= 2 || (letterCount(o.text) >= 1 && o.text.trim().length >= 2));
  // v10.1: bảng định nghĩa "viết tắt | nghĩa" (CNS | central nervous system): ô trái ngắn, ô phải cách ít (< 6 cỡ chữ)
  // → luôn là một hàng bảng, kể cả khi bộ dò cột đặt nhầm một "khe cột" giữa hai ô (trước đây cả cột nghĩa bị gộp
  // thành một đoạn, bản dịch dồn liên tục, lệch hàng với cột viết tắt)
  const shortCell = (o: Segment) => o.text.trim().length <= 14 && o.x1 - o.x0 < 0.12 * pageWidth;
  const defPair = (a: Segment, b2: Segment) => {
    const [l, r] = a.x0 < b2.x0 ? [a, b2] : [b2, a];
    // v10.3: hai ô của bảng định nghĩa cùng cỡ chữ, cùng họ font — nhãn hình xếp chồng ("Superior / laryngeal / nerve",
    // chữ không chân cỡ nhỏ) cạnh dòng thân bài cột bên không phải "cột viết tắt" (trước đây bị tách vụn, dịch lặp)
    return shortCell(l) && r.x0 - l.x0 < 9 * Math.max(l.size, r.size) && r.x0 > l.x1 &&
      Math.abs(l.size - r.size) < 0.12 * Math.max(l.size, r.size) && l.serif === r.serif;
  };
  const hasRowMate = (sg: Segment) => segments.some(o => o !== sg && isCellLike(o) &&
    Math.abs(o.size - sg.size) < 0.1 * Math.max(o.size, sg.size) && // khác cỡ chữ = cột khác (chú thích hình), không phải ô bảng
    // v10.2: khác họ font (chú thích hình chữ có chân ↔ nhãn biểu đồ không chân "EU 27") = không cùng bảng → chú thích
    // không bị cắt thành nhiều khối theo từng nhãn đồ thị cùng hàng
    o.serif === sg.serif &&
    // Hai dòng cùng hàng đều thuộc đoạn văn (dòng rộng > 30% trang, hoặc dòng cuối ngắn nằm ngay dưới dòng rộng cùng
    // mép trái) = hai CỘT văn bản (chú thích hình chạy 2 cột), không phải ô bảng
    !(paraLine(o) && paraLine(sg)) &&
    Math.abs(o.y - sg.y) < 0.4 * Math.min(o.size, sg.size) &&
    (o.x1 <= sg.x0 + 1 || o.x0 >= sg.x1 - 1) &&
    (defPair(o, sg) || !gutters.some(g => (g > Math.min(o.x1, sg.x1) - 1 && g < Math.max(o.x0, sg.x0) + 1))));
  const mate = new Map(segments.map(sg => [sg, isCellLike(sg) && hasRowMate(sg)]));
  // v10.1: hàng của bảng định nghĩa (có ô "viết tắt" ngắn cùng hàng, sát bên trái/phải) → luôn mở khối mới
  const defRowSeg = new Set(segments.filter(sg => !sg.isLabel && segments.some(o => o !== sg && !o.isLabel &&
    Math.abs(o.y - sg.y) < 0.4 * Math.min(o.size, sg.size) && letterCount(o.text) >= 1 && letterCount(sg.text) >= 1 && defPair(o, sg) &&
    // ô viết tắt phải là "cột": có ≥ 2 ô ngắn khác thẳng mép trái với nó
    (() => { const l = o.x0 < sg.x0 ? o : sg; return segments.filter(u => u !== l && shortCell(u) && Math.abs(u.x0 - l.x0) < 0.5 * l.size).length >= 2; })())));
  for (const sg of defRowSeg) mate.set(sg, true);
  // v10.4: dòng nằm trong BẢNG CÓ ĐƯỜNG KẺ (có đường kẻ ngang phía trên và phía dưới, giữa hai đường kẻ có hàng nhiều ô).
  // Trong ô bảng, mỗi dòng viết hoa đầu thường là một mục riêng ("Diabetes" / "Previous urinary tract surgery" / "Proteinuria")
  // → chỉ nối dòng khi có dấu hiệu câu chạy tiếp (dòng sau viết thường, dòng trước kết thúc bằng dấu phẩy / giới từ…).
  const ruledCache = new Map<Segment, boolean>();
  const ruledTop = new Map<Segment, number>();
  const inRuledTable = (sg: Segment): boolean => {
    if (!rules.length || boxOf(sg)) return false;
    const c = ruledCache.get(sg);
    if (c !== undefined) return c;
    const hits = (r: HRule) => r.x0 < sg.x1 - 1 && r.x1 > sg.x0 + 1;
    const rs = rules.filter(hits).sort((p, q) => p.y - q.y);
    let ok = false;
    const ia = rs.map(r => r.y < sg.y - 0.6 * sg.size).lastIndexOf(true);
    const below = rs.find(r => r.y > sg.y);
    if (ia >= 0 && below && below.y - rs[ia].y <= 40 * sg.size) {
      // khung bảng: đi ngược lên theo chuỗi đường kẻ liền nhau, phải gặp cặp "đường kẻ trên + đường kẻ dưới hàng tiêu đề"
      // (cách nhau ≤ 3,5 cỡ chữ) — đường kẻ dưới tiêu đề trang / ngăn chú thích chân trang không tạo thành khung này
      let k = ia, header = false;
      // v10.8: chuỗi đường kẻ phải CÙNG BỀ NGANG với đường kẻ ngay trên dòng (cùng một bảng) — trước đây đường kẻ đầu
      // trang / khung tóm tắt cột bên kia cũng được nối vào chuỗi → danh mục viết tắt bị coi là bảng có kẻ, một số dòng
      // nghĩa bị giữ 1 dòng rồi co nhỏ (CT tim tr.31)
      const spanW = (y: number) => { const rr = rules.filter(r => Math.abs(r.y - y) < 0.5 * sg.size); return Math.max(...rr.map(r => r.x1)) - Math.min(...rr.map(r => r.x0)); };
      const w0 = spanW(rs[ia].y);
      while (k > 0 && rs[k].y - rs[k - 1].y <= 40 * sg.size && Math.abs(spanW(rs[k - 1].y) - w0) < 0.5 * w0) {
        if (rs[k].y - rs[k - 1].y > 0.5 * sg.size && rs[k].y - rs[k - 1].y <= 3.5 * sg.size) header = true;
        k--;
      }
      const top = rs[k];
      if (header) {
        ruledTop.set(sg, Math.round(top.y));
        // có hàng nhiều ô giữa khung (hai mẩu chữ cùng hàng, tách rời nhau)
        // v10.7: hàng nhiều ô phải nằm trong CHÍNH dải giữa đường kẻ ngay trên và ngay dưới dòng này — trước đây xét từ đỉnh
        // bảng nên thân bài ngay dưới bảng (giữa đường kẻ đáy bảng và đường kẻ tiêu đề mục) bị coi là ô bảng → chữ nhỏ,
        // đoạn vỡ (CT tim tr.221, 135)
        // (đường kẻ hàng có thể bị kẻ dọc cắt thành từng đoạn theo cột → bề ngang dải = mọi đoạn kẻ cùng độ cao)
        const span = (y: number) => { const rr = rules.filter(r => Math.abs(r.y - y) < 0.5 * sg.size); return { x0: Math.min(...rr.map(r => r.x0)), x1: Math.max(...rr.map(r => r.x1)) }; };
        const sa = span(rs[ia].y), sb = span(below.y);
        const band = { y: rs[ia].y, x0: Math.min(sa.x0, sb.x0), x1: Math.max(sa.x1, sb.x1) };
        ok = segments.some(m => !m.isLabel && m.y > band.y && m.y < below.y && m.x0 < band.x1 && m.x1 > band.x0 &&
          segments.some(o => o !== m && !o.isLabel && Math.abs(o.y - m.y) < 0.4 * Math.min(o.size, m.size) && (o.x1 < m.x0 - 0.5 * m.size || o.x0 > m.x1 + 0.5 * m.size) &&
            o.x0 < band.x1 && o.x1 > band.x0 &&
            // v10.7: hai dòng thân bài của HAI CỘT TRANG (cách bởi khe cột) không phải "hàng nhiều ô" — trước đây cả cột văn
            // bản nằm giữa hai đường kẻ bị coi là bảng: đoạn vỡ vụn, chữ nhỏ hẳn (CT tim tr.323)
            !(paraLine(o) && paraLine(m)) && !((paraLine(o) || paraLine(m)) && gutters.some(g => g > Math.min(o.x1, m.x1) - 1 && g < Math.max(o.x0, m.x0) + 1))));
      }
    }
    ruledCache.set(sg, ok);
    return ok;
  };

  // mép phải của ô = đầu mẩu chữ gần nhất bên phải (cột kế tiếp) trong các hàng lân cận, hoặc mép đường kẻ
  const cellRight = (last: Segment, seg: Segment): number => {
    const rightX = Math.max(last.x1, seg.x1);
    let colRight = Infinity;
    for (const m of segments) {
      if (m === last || m === seg || m.y < last.y - 6 * last.size || m.y > seg.y + 6 * seg.size) continue;
      if (m.x0 > rightX + 0.3 * last.size && m.x0 < colRight) colRight = m.x0;
    }
    if (colRight === Infinity) {
      const r = rules.filter(r => r.x0 < last.x1 && r.x1 > last.x0 && r.y > last.y - 8 * last.size && r.y < seg.y + 8 * seg.size);
      if (!r.length) return NaN;
      colRight = Math.max(...r.map(r => r.x1)) + 0.8 * last.size;
    }
    return colRight;
  };
  const firstWordNeed = (last: Segment, seg: Segment) => {
    const lt = last.text.trim();
    const charW = (last.x1 - last.x0) / Math.max(1, lt.length);
    return last.x1 + charW * (seg.text.trim().split(/\s+/)[0].length + 1);
  };
  // cột bảng dạng "mỗi dòng một mục": có ≥ 2 cặp dòng liền nhau mà dòng trên còn thừa chỗ rộng vẫn xuống dòng, dòng dưới
  // viết hoa đầu (CT tim tr.56 "Cutaneous edema" / "Limited itchy…") → ở cột này dòng viết hoa đầu luôn là mục mới
  const listColCache = new Map<number, boolean>();
  const isListColumn = (seg: Segment): boolean => {
    const key = Math.round(seg.x0 / 4);
    const c = listColCache.get(key);
    if (c !== undefined) return c;
    const col = segments.filter(m => Math.abs(m.x0 - seg.x0) < 0.5 * seg.size && Math.abs(m.size - seg.size) < 0.12 * seg.size).sort((p, q) => p.y - q.y);
    let n = 0;
    for (let k = 1; k < col.length; k++) {
      const a = col[k - 1], b = col[k], dy = b.y - a.y;
      if (dy < 0.8 * a.size || dy > 1.6 * a.size || !/^\p{Lu}/u.test(b.text.trim())) continue;
      if (rules.some(r => r.y > a.y + 0.3 * a.size && r.y < b.y - 0.6 * b.size && r.x0 < a.x1 && r.x1 > a.x0)) continue;
      const cr = cellRight(a, b);
      if (Number.isFinite(cr) && firstWordNeed(a, b) < cr - 2 * a.size) n++;
    }
    const ok = n >= 2;
    listColCache.set(key, ok);
    return ok;
  };
  // v10.4: dòng trước đã chạy kín ô — chữ đầu dòng sau không đủ chỗ ở cuối dòng trước nên mới xuống dòng
  const wrapsInCell = (last: Segment, seg: Segment): boolean => {
    const lt = last.text.trim(), st = seg.text.trim();
    if (!st || !lt) return false;
    // ô ngắn kiểu chữ viết tắt ("ALARA" / "BMI") không phải dòng chạy kín ô
    if (lt.split(/\s+/).length < 2 && lt.length < 10) return false;
    if (/^[\p{Lu}\d\-\/]+$/u.test(st)) return false;
    const colRight = cellRight(last, seg);
    if (!Number.isFinite(colRight)) return false;
    if (isListColumn(seg)) return false;
    return firstWordNeed(last, seg) > colRight - 0.8 * last.size;
  };

  const work: WorkBlock[] = [];
  const bodySz = (() => {
    const votes = new Map<number, number>();
    for (const sg of segments) { const k = Math.round(sg.size * 2) / 2; votes.set(k, (votes.get(k) || 0) + letterCount(sg.text)); }
    let best = 0, sz = 0;
    votes.forEach((v, k) => { if (v > best) { best = v; sz = k; } });
    return sz || 12;
  })();
  for (const seg of segments) {
    let bestBlock: WorkBlock | null = null;
    let bestGap = Infinity;
    const segBox = boxOf(seg);
    const segIsCell = mate.get(seg) && !segBox;
    for (const b of seg.itemStart || seg.isLabel ? [] : work) {
      const last = b.lines[b.lines.length - 1];
      // v10.8: dòng trong khung chỉ nối với dòng cùng khung; khung ≤ 3 dòng, không có ký hiệu đầu dòng (ô lưu đồ
      // "No/non-obstructive" / "CAD") → các dòng là MỘT cụm, dịch chung (trước đây mỗi dòng một khối, dịch rời, chữ tí hon)
      if (boxOf(last) !== segBox) continue;
      // (dòng có ký hiệu đầu dòng ngay bên trái, cùng khung = mục mới)
      if (segBox && segments.some(o => o.isLabel && boxOf(o) === segBox && Math.abs(o.y - seg.y) < 0.5 * seg.size && o.x1 <= seg.x0 + 1)) continue;
      if (segBox?.bullets?.some(p => p.x < seg.x0 && seg.x0 - p.x < 2.5 * seg.size && p.y > seg.y - 0.9 * seg.size && p.y < seg.y + 0.1 * seg.size)) continue;
      if (segBox && !last.isLabel && !b.lines[0].isLabel && Math.abs(seg.size - b.size) <= 0.12 * b.size && seg.y - last.y > 0.5 * b.size && seg.y - last.y < 2 * b.size) {
        const inBox = segments.filter(o => boxOf(o) === segBox);
        if (inBox.length <= 3 && !segBox.bullets?.length && !inBox.some(o => o.isLabel || o.itemStart)) { if (seg.y - last.y < bestGap) { bestGap = seg.y - last.y; bestBlock = b; } continue; }
      }
      if (last.leader) continue; // dòng mục lục có số trang = kết thúc mục
      if (b.lines[0].isLabel) continue; // khối số mục / ký hiệu đầu dòng chỉ có 1 dòng
      // ô bảng: mỗi hàng là một khối riêng, không nối dọc với hàng dưới — trừ dòng viết thường nối tiếp ngay dưới trong bảng
      // có đường kẻ, cùng mép trái ("<30 mL/min" / "within 7 days", "No contrast media or" / "lower contrast dosing")
      if (segIsCell && !(Math.abs(seg.x0 - b.x0) < 0.5 * b.size && Math.abs(seg.y - last.y) < 1.75 * b.size &&
        ((inRuledTable(seg) && /^\p{Ll}/u.test(seg.text.trim())) || (rules.length > 0 && !defRowSeg.has(seg) && wrapsInCell(last, seg))))) continue;
      if (Math.abs(seg.size - b.size) > 0.12 * b.size) continue;
      if (seg.bold !== b.bold) {
        // v10.2: dòng thân bài có cụm IN ĐẬM ("descriptive epidemiology, and the identification", câu nhấn mạnh in đậm
        // nghiêng) vẫn thuộc đoạn đang chạy — trước đây đổi đậm/thường là ngắt khối → đoạn vỡ thành nhiều mẩu, bản dịch
        // mỗi mẩu một cỡ chữ, hở khoảng lớn. Chỉ nối khi cùng cỡ, dòng trước chạy đủ khổ cột và câu chưa dứt.
        const lt = last.text.trim(), st = seg.text.trim();
        const fullW = last.x1 >= b.x1 - 1.2 * b.size && (last.x1 - last.x0) >= 0.8 * (b.x1 - b.x0) && (b.x1 - b.x0) > 12 * b.size;
        const cont = b.lines.length >= 2
          ? (/[\p{L}\p{N},;\-–)\]]$/u.test(lt) || /^\p{Ll}/u.test(st))
          : (/[,\-–]$/.test(lt) || /^\p{Ll}/u.test(st));
        if (!(Math.abs(seg.size - b.size) < 0.04 * b.size && fullW && cont && !last.isLabel)) continue;
      }
      // v10.0: tiêu đề mục IN HOA (thanh màu) + tiêu đề phụ thường ngay dưới ("TERMINOLOGY" / "Abbreviations",
      // "BREAST DEVELOPMENT" / "Neonatal") là HAI khối, không phải một đoạn: khác kiểu chữ hoa, hoặc khác cỡ
      // (tiêu đề đậm chênh > 6%), hoặc khác hẳn màu chữ (chữ trắng trên thanh màu ↔ chữ tối bên dưới)
      {
        const capsLine = (t: string) => { const L = t.match(/\p{L}/gu) || []; return L.length >= 3 && L.every(ch => ch === ch.toUpperCase()); };
        const lt = last.text.trim(), st = seg.text.trim();
        if (capsLine(lt) !== capsLine(st) && (b.bold || (capsLine(lt) && (lt.match(/\p{L}/gu) || []).length >= 6 && !seg.italic)) && b.lines.length <= 2 && lt.length < 60) continue;
        if (b.bold && Math.abs(seg.size - b.size) > 0.06 * b.size) continue;
        // v10.1: nhãn hình xếp chồng ("Pectoralis major muscle" / "Pectoralis minor muscle"): hai dòng ngắn, dòng sau viết
        // hoa đầu, dòng trước đã trọn nghĩa (không kết thúc bằng giới từ / dấu phẩy / ngoặc mở) → hai nhãn riêng
        // (v10.2: không áp cho tiêu đề mục — cỡ lớn hơn thân bài hoặc có số mục "1.4" bên trái: "Notes on Epidemiological" /
        // "Data on BC in Europe…" là MỘT tiêu đề 3 dòng)
        if (b.lines.length === 1 && lt.length <= 40 && st.length <= 40 && /^\p{Lu}[\p{Ll}\-]/u.test(st) && /^\p{Lu}/u.test(lt) &&
          !(b.size > 1.08 * bodySz) && !b.lines[0].itemStart &&
          !/[,(\-–&/]$|\b(of|and|or|the|with|to|in|for|a|an|by|from|at|on|vs\.?)$/i.test(lt) &&
          seg.italic === b.lines[0].italic && (last.runs[0]?.italic ?? false) === (seg.runs[0]?.italic ?? false)) {
          const wordsL = lt.split(/\s+/).length, wordsS = st.split(/\s+/).length;
          if (wordsL >= 2 && wordsS >= 2 && wordsL <= 5 && wordsS <= 5 && Math.abs(lt.length - st.length) < 0.5 * Math.max(lt.length, st.length) + 6 &&
            (Math.abs(seg.x1 - last.x1) < 0.6 * b.size || Math.abs(seg.x0 - last.x0) < 0.6 * b.size) &&
            !(rules.length && wrapsInCell(last, seg))) continue;
        }
        const colOf = (sg: Segment) => { const r = sg.runs.find(x => /\p{L}/u.test(x.text)) || sg.runs[0]; return r?.color ? 0.299 * r.color.r + 0.587 * r.color.g + 0.114 * r.color.b : 30; };
        if (Math.abs(colOf(last) - colOf(seg)) > 120) continue;
      }
      // v10.8: dòng vai trò "Editors" / "Edited by" dưới tên tác giả là dòng riêng (trước đây nhập vào dòng tên → "John Hoe
      // Biên tập viên" chung một dòng, chữ nhỏ lại — CT tim tr.3)
      if (/^(editors?|edited by|authors?|series editors?|section editors?)\.?$/i.test(seg.text.trim())) continue;
      // v10.8: dòng tên tác giả ở chân trang đầu chương ("B. B. Lima", "R. N. Cardoso (✉)", "J. Yu (✉) · J. Iwaz") đứng
      // riêng một dòng — trước đây nối với dòng địa chỉ bên dưới nên bản dịch dồn "B. B. Lima Khoa Tim mạch…" lên một dòng
      if (b.lines.length === 1 && /^((\p{Lu}\.\s?)+(-\p{Lu}\.\s?)*\s?\p{Lu}[\p{L}'’\-]+(\s[\p{Lu}][\p{L}'’\-]+)?\s*(\((✉|\*|\u2709)\))?\s*(·\s*)?)+$/u.test(last.text.trim())) continue;
      const gap = seg.y - last.y;
      if (gap < 0.5 * b.size || gap > 1.75 * b.size) continue;
      // v10.3: có đường kẻ ngang giữa hai dòng (hàng bảng "Scout | Chest" / "Scan range | To cover the myocardium")
      // → hai ô/hàng khác nhau, không nối thành một khối (trước đây cả cột bảng bị gộp, bản dịch tràn qua đường kẻ)
      if (rules.length && rules.some(r => r.y > last.y + 0.3 * b.size && r.y < seg.y - 0.75 * seg.size &&
        Math.min(r.x1, seg.x1) - Math.max(r.x0, seg.x0) > 0.5 * Math.min(seg.x1 - seg.x0, last.x1 - last.x0))) continue;
      // v10.4: hai dòng đều bắt đầu bằng dấu chú thích (ᵃ…, ᵇ…) = hai chú thích riêng
      if (FOOTNOTE_MARK_RE.test(seg.text.trim()) && FOOTNOTE_MARK_RE.test(b.lines[0].text.trim())) continue;
      // v10.4: danh sách lồng nhiều cấp — khối đã có ≥ 2 dòng thẳng mép mà dòng sau LÙI ra trái = mục cấp trên mới
      // (CT tim tr.133: "If MLA of the LM ≥6.0 to / 7.5 mm, PCI may be deferred." | "<4 mm² for proximal…"). Thụt dòng
      // đầu đoạn bình thường chỉ lùi sau dòng ĐẦU nên không bị ảnh hưởng.
      if (b.lines.length >= 2 && Math.abs(last.x0 - b.lines[b.lines.length - 2].x0) < 0.3 * b.size && seg.x0 < last.x0 - 0.6 * b.size) continue;
      if (inRuledTable(seg) && inRuledTable(last)) {
        const lt = last.text.trim(), st = seg.text.trim();
        const cont = /^[\p{Ll}(]/u.test(st) || /[,;:\-–/(&+]$/.test(lt) ||
          /\b(of|and|or|the|with|without|to|in|for|a|an|by|from|at|on|vs\.?|per|than|as|into|under|over|after|before|during|within)$/i.test(lt);
        // v10.4: hoặc dòng trước đã chạy kín ô — chữ đầu dòng sau không đủ chỗ ở cuối dòng trước nên mới xuống dòng
        // ("Proximal Right" / "Coronary Artery (pRCA)", "Borderline-intermediate" / "10-year ASCVD risk (5–20%)")
        if (!cont && !wrapsInCell(last, seg)) continue;
      }
      if (b.lines.length >= 2) {
        const lead = b.lines[b.lines.length - 1].y - b.lines[b.lines.length - 2].y;
        if (Math.abs(gap - lead) > 0.3 * lead) continue;
      }
      const overlap = Math.min(seg.x1, b.x1) - Math.max(seg.x0, b.x0);
      const minW = Math.min(seg.x1 - seg.x0, b.x1 - b.x0);
      if (overlap < 0.5 * minW) continue;
      const leftAligned = Math.abs(seg.x0 - b.x0) < 2.5 * b.size;
      const centered = Math.abs((seg.x0 + seg.x1) / 2 - (b.x0 + b.x1) / 2) < b.size;
      // v10.1: nhãn hình căn phải 2 dòng ("Anterior suspensory ligament (of" / "Cooper)") — chỉ nối khi dòng trước chưa
      // trọn nghĩa (kết thúc bằng giới từ / ngoặc mở / dấu phẩy) hoặc dòng sau viết thường
      const rightCont = Math.abs(seg.x1 - last.x1) < 0.6 * b.size &&
        (/[,(\-–&/]$|\b(of|and|or|the|with|to|in|for|a|an|by|from|at|on)$/i.test(last.text.trim()) || /^\p{Ll}/u.test(seg.text.trim()));
      if (!leftAligned && !centered && !rightCont) continue;
      const blockWidth = b.x1 - b.x0;
      const lastText = last.text.trim();
      const segText = seg.text.trim();
      // v10.10: ghi chú dưới bảng "Data from Ref. [2]" (kết thúc bằng trích dẫn) cũng là câu đã dứt
      const lastEndsPunct = /[.:;?!]$/.test(lastText) || /\[[\d,–\-\s]+\]$/.test(lastText);
      const segStartsUpper = /^[\p{Lu}\p{N}(]/u.test(segText);
      // Dòng trước ngắn bất thường (ngắt đoạn): hoặc khối >= 2 dòng, hoặc dòng trước kết thúc bằng dấu chấm và dòng sau viết hoa
      // v10.2: chữ căn trái không đều mép phải (chú thích hình "in dark green, age" / "standardized, per") — chỉ là ngắt
      // đoạn khi TỪ ĐẦU của dòng sau vừa chỗ trống cuối dòng trước (nếu vừa thì máy dàn trang đã đặt nó lên trên)
      const room = b.x1 - last.x1;
      const firstWord = segText.split(/\s+/)[0] || '';
      const firstWordW = segText.length ? (seg.x1 - seg.x0) * (firstWord.length / segText.length) : 0;
      const wordFits = room > firstWordW + 0.6 * b.size;
      // v10.3: khối mới 1 dòng chưa biết khổ cột → lấy mép phải của dòng sau ("First assess size, contour, and attenuation." /
      // "Most use 18–20 cm as the normal maximum…": câu đã dứt, dòng trước ngắn hẳn → đoạn mới, trước đây bị nối thành một)
      const edge1 = Math.max(b.x1, seg.x1);
      const wordFits1 = edge1 - last.x1 > firstWordW + 0.6 * b.size;
      const prevShort = (b.lines.length >= 2 && last.x1 < b.x1 - Math.max(2.5 * b.size, 0.12 * blockWidth) && wordFits) ||
        (lastEndsPunct && segStartsUpper && last.x1 < edge1 - 1.5 * b.size && wordFits1);
      // THỤT TREO (hanging indent: "ACR: Normal breast US, without any abnormalities such" / dòng sau thụt vào
      // "as masses, architectural distortions…"). Trước đây dòng thụt vào luôn bị coi là MỞ ĐOẠN MỚI → mỗi dòng tiếp
      // nối thành một khối riêng: AI dồn cả câu vào khối 1 dòng (chữ bị thu nhỏ, "khối chữ quá chật"), các khối sau
      // nhận mẩu câu lặp/lệch chỗ. Nhận diện: dòng trước chưa hết câu, hai dòng cùng mép phải (chữ chạy đủ khổ),
      // dòng sau thụt vào vừa phải; các dòng tiếp theo thẳng hàng với dòng thụt.
      const first = b.lines[0];
      const hangingSoFar = b.lines.length >= 2 && b.lines.slice(1).every(l => l.x0 > first.x0 + 0.5 * b.size);
      const lastNoStop = !/[.:;?!]["”’)\]]?$/.test(lastText);
      const sameRight = Math.abs(last.x1 - seg.x1) < 1.5 * b.size;
      const hangingNext = seg.x0 > b.x0 + 0.7 * b.size && seg.x0 - b.x0 < 4 * b.size && !prevShort &&
        (hangingSoFar
          ? Math.abs(seg.x0 - last.x0) < 0.5 * b.size
          : lastNoStop && sameRight && b.lines.length === 1);
      // Khối thụt treo: dòng quay về mép trái của dòng đầu = mục/đoạn mới ("FBU: …" sau "ACR: …")
      if (hangingSoFar && seg.x0 < last.x0 - 0.5 * b.size) continue;
      // Dòng sau thụt vào sâu hơn dòng đầu (mở đoạn mới):
      const indentStart = !hangingNext && seg.x0 > b.x0 + 0.7 * b.size && seg.x1 > b.x1 - 1.5 * b.size;
      // (căn giữa chỉ khi cả dòng trước cũng nằm giữa khối — dòng đoạn văn tình cờ có tâm trùng tâm khối không tính)
      const centeredPair = centered && Math.abs((last.x0 + last.x1) / 2 - (b.x0 + b.x1) / 2) < b.size;
      // v10.7: dòng "e-mail: …" ở chân trang tác giả thuộc khối địa chỉ ngay trên (trước đây tách riêng → bản dịch địa chỉ
      // ngắn lại, dòng e-mail đứng trơ cách xa — CT tim tr.187, 319)
      const emailLine = /^e-?mail\s*:/i.test(segText) && Math.abs(seg.x0 - b.x0) < 0.5 * b.size;
      // v10.10: dòng mục lục có số trang in thành cột riêng bên phải (không có dấu chấm dẫn): mỗi dòng có số trang cùng hàng
      // là một mục riêng — trước đây các mục liền nhau bị nhập thành đoạn, bản dịch ngắt dòng lệch số trang (mục lục Clark's)
      const pageNumOn = (l: Segment) => segments.some(n => n !== l && /^\d{1,4}$/.test(n.text.trim()) && Math.abs(n.y - l.y) < 0.4 * l.size && n.x0 > l.x1 + 0.8 * l.size && n.x0 - l.x1 < 40 * l.size);
      if (pageNumOn(last) && pageNumOn(seg)) continue;
      // v11: dòng TOÀN chữ đậm, ngắn hoặc kết thúc bằng ":" ngay dưới đoạn văn thường = nhãn / tiêu đề mới ("Lung-/pleura
      // window:" dưới đoạn hướng dẫn bài tập — CT Teaching Manual tr.45), không phải dòng tiếp của đoạn
      {
        const lettered = (l: Segment) => l.runs.filter(r => /\p{L}/u.test(r.text));
        const allBold = (l: Segment) => { const rs = lettered(l); return rs.length > 0 && rs.every(r => r.bold); };
        if (allBold(seg) && !b.lines.some(allBold) && (/:\s*$/.test(segText) || seg.x1 - seg.x0 < 0.6 * blockWidth)) continue;
      }
      if (((prevShort && !centeredPair) || indentStart) && !(rightCont && !leftAligned) && !emailLine) continue;
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

  const blocks = work.map(b => {
    const fb = finalizeBlock(b, pageWidth);
    // v10.4: khối thuộc bảng có đường kẻ → gắn mã bảng (vẽ cùng một cỡ chữ cho cả bảng)
    const seg = b.lines.find(l => inRuledTable(l));
    if (seg) fb.tableId = `r${ruledTop.get(seg)}`;
    const bx = boxOf(b.lines[0]);
    if (bx) {
      fb.box = bx;
      fb.boxSolo = !work.some(o => o !== b && o.lines.some(l => boxOf(l) === bx && /\p{L}/u.test(l.text)));
      // dòng nằm giữa khung → căn giữa
      if (fb.boxSolo && b.lines.every(l => Math.abs((l.x0 + l.x1) / 2 - (bx.x0 + bx.x1) / 2) < 1.2 * l.size) && (bx.x1 - bx.x0) > 1.15 * (fb.x1 - fb.x0)) fb.align = 'center';
    }
    return fb;
  });
  attachDropCaps(blocks, items);
  // Khối 1 dòng nằm sát lề phải của vùng nội dung (tiêu đề chạy, số trang…) → căn phải
  const rightEdge = Math.max(...blocks.map(b => b.x1));
  const inHeaderFooter = (b: LayoutBlock) => b.bottom < pageHeight * 0.1 || b.top > pageHeight * 0.9;
  for (const b of blocks) {
    if (b.lineCount === 1 && b.align === 'left' && !b.leader && inHeaderFooter(b) &&
        b.x0 > pageWidth * 0.4 && Math.abs(b.x1 - rightEdge) < 0.8 * b.size &&
        // mục danh sách cuối cột (có ký hiệu đầu dòng bên trái) không phải tiêu đề chạy / số trang
        !blocks.some(o => o !== b && o.lineCount === 1 && LABEL_RE.test(o.plain) && o.x1 <= b.x0 + 1 && b.x0 - o.x1 < 3 * b.size && Math.abs(o.top - b.top) < 0.5 * b.size)) b.align = 'right';
  }
  // Khối 1 dòng nằm giữa trang (tiêu đề chạy, tên chương) → căn giữa
  for (const b of blocks) {
    // (chỉ dòng ngắn: dòng đầu của đoạn văn dài gần hết khổ không phải tiêu đề căn giữa)
    if (b.align === 'left' && b.lineCount === 1 && !b.leader && !b.dropCap && b.x0 > pageWidth * 0.15 &&
        b.x1 - b.x0 < 0.6 * pageWidth &&
        Math.abs((b.x0 + b.x1) / 2 - pageWidth / 2) < pageWidth * 0.015) {
      // Ô bảng / mục trong cột thẳng hàng trái (≥2 khối khác cùng mép trái, hoặc có ô cùng hàng) chỉ TÌNH CỜ nằm giữa
      // trang → vẫn căn trái (trước đây "Ductal Echography", "Field of view"… bị căn giữa → bản dịch lệch khỏi cột)
      const sameLeftCol = blocks.filter(o => o !== b && Math.abs(o.x0 - b.x0) < 0.4 * b.size && Math.abs(o.size - b.size) < 0.15 * b.size).length;
      const rowPeer = blocks.some(o => o !== b && Math.abs(o.top - b.top) < 0.5 * b.size && (o.x1 <= b.x0 + 1 || o.x0 >= b.x1 - 1));
      if (sameLeftCol >= 2 || rowPeer) continue;
      b.align = 'center';
    }
  }
  // Cột nhãn căn phải (nhãn hình nằm bên trái ảnh): ≥2 khối ngắn cùng cỡ, chung mép phải, khác mép trái
  for (const b of blocks) {
    if (b.align !== 'left' || b.leader || b.lineCount > 3) continue;
    // Mục danh sách (có ký hiệu/số thứ tự bên trái) hoặc ô bảng (có khối khác cùng hàng) → không phải nhãn hình căn phải
    const rowPeer = blocks.some(o => o !== b && Math.abs(o.top - b.top) < 0.5 * b.size && (o.x1 <= b.x0 + 1 || o.x0 >= b.x1 - 1));
    if (rowPeer) continue;
    const similar = (o: LayoutBlock) => o !== b && o.lineCount <= 3 && Math.abs(o.size - b.size) < 0.2 * b.size;
    const sameRight = blocks.filter(o => similar(o) && Math.abs(o.x1 - b.x1) < 0.4 * b.size);
    const ragged = sameRight.filter(o => Math.abs(o.x0 - b.x0) > 1.5 * b.size).length;
    const sameLeft = blocks.filter(o => similar(o) && Math.abs(o.x0 - b.x0) < 0.4 * b.size).length;
    // Mép phải trùng mép một cột văn bản (đoạn nhiều dòng) → đó là lề cột, không phải cột nhãn căn phải
    const columnEdge = blocks.some(o => o !== b && o.lineCount >= 2 && Math.abs(o.x1 - b.x1) < 0.6 * b.size &&
      (o.align === 'justify' || o.lineCount >= 3));
    if (!columnEdge && sameRight.length >= 2 && ragged >= 1 && sameRight.length > sameLeft) b.align = 'right';
  }
  // v11: khối chữ ký / địa chỉ căn phải ở cuối bài ("A Stewart Whitley / Series Editor / ISRRT Director… / Preston, UK" —
  // Clark's tr.9): các dòng ngắn xếp chồng, chung mép phải với lề cột nhưng bắt đầu lùi xa vào giữa. Quy tắc cột nhãn ở trên
  // bỏ qua vì mép phải trùng lề cột (columnEdge) → trước đây căn trái, bản dịch xuống dòng bị dồn sang trái, lệch khỏi khối.
  {
    const near = (a: LayoutBlock, o: LayoutBlock) => Math.min(Math.abs(o.top - a.bottom), Math.abs(a.top - o.bottom)) < 1.6 * a.size;
    const colLeft = (a: LayoutBlock) => Math.min(...blocks.filter(o => o.lineCount >= 2 && o.x0 < a.x1 && o.x1 > a.x0 && Math.abs(o.x1 - a.x1) < 0.6 * a.size).map(o => o.x0), a.x0);
    const inset = (a: LayoutBlock) => a.x0 - colLeft(a) > 2.5 * a.size;
    const cands = blocks.filter(b => b.align === 'left' && !b.leader && !b.dropCap && !b.tableId && b.lineCount <= 3 && inset(b) &&
      !blocks.some(o => o !== b && Math.abs(o.top - b.top) < 0.5 * b.size && (o.x1 <= b.x0 + 1 || o.x0 >= b.x1 - 1)));
    const flip: LayoutBlock[] = [];
    for (const b of cands) {
      const mates = blocks.filter(o => o !== b && Math.abs(o.x1 - b.x1) < 0.5 * b.size && Math.abs(o.size - b.size) < 0.25 * b.size &&
        near(b, o) && o.lineCount <= 3 && Math.abs(o.x0 - b.x0) > 1.5 * b.size && inset(o));
      if (mates.length) flip.push(b);
    }
    for (const b of flip) b.align = 'right';
  }
  // v10.7: cột CHỮ VIẾT TẮT của bảng viết tắt ("CAD | Coronary artery disease", "PCI | Percutaneous…") giữ nguyên, không
  // gửi đi dịch — trước đây AI dịch luôn "CAD" thành "Bệnh động mạch vành" rồi nhét vào ô hẹp, chữ tí hon chồng lên hàng dưới
  const acro = (b: LayoutBlock) => b.lineCount === 1 && /^[\p{Lu}\d][\p{L}\d\-\/+]{1,7}$/u.test(b.plain.trim()) &&
    (b.plain.match(/\p{Lu}/gu) || []).length >= 2 && (b.plain.match(/\p{Ll}/gu) || []).length <= 1;
  for (const b of blocks) {
    if (!b.translatable || !acro(b)) continue;
    const def = (a: LayoutBlock) => blocks.some(o => o !== a && o.x0 > a.x1 && o.x0 - a.x0 < 9 * a.size &&
      Math.abs(o.top - a.top) < 0.4 * a.size && Math.abs(o.size - a.size) < 0.15 * a.size && letterCount(o.plain) >= 3);
    if (!def(b)) continue;
    const col = blocks.filter(o => o !== b && acro(o) && Math.abs(o.x0 - b.x0) < 0.5 * b.size && Math.abs(o.size - b.size) < 0.15 * b.size && def(o));
    if (col.length >= 2) b.translatable = false;
  }
  // v10.7: dòng TÊN TÁC GIẢ ("Muhammad Umair ⓘ, Julianna Czum ⓘ, and Stefan L. Zimmerman") giữ nguyên — dịch "and" → "và"
  // làm chữ dài/ngắn lệch, đè lên biểu tượng ORCID (hình) nằm giữa các tên (CT tim tr.195, 306)
  for (const b of blocks) {
    if (!b.translatable || b.bold || b.lineCount > 3 || b.size < 1.05 * bodySz) continue;
    const t = b.plain.trim();
    const toks = t.split(/[\s,]+/).filter(Boolean);
    if (toks.length < 2 || toks.length > 24 || !/,|\band\b|&/.test(t)) continue;
    const name = (w: string) => /^(\p{Lu}[\p{Ll}'’]*([.\-]\p{Lu}?[\p{Ll}'’]*)*\.?|and|&|van|von|de|da|del|der|di|du|la|le)$/u.test(w);
    // (phải có dấu hiệu tên người: dấu phẩy, chữ viết tắt tên "P.", tên ghép "Eun-Ju" — "Embryology and Normal Development" là tiêu đề)
    const nameSignal = /,/.test(t) || toks.some(w => /^\p{Lu}\.$/u.test(w) || /^\p{Lu}\p{Ll}+-\p{Lu}\p{Ll}+$/u.test(w));
    if (nameSignal && toks.every(name) && toks.filter(w => /^\p{Lu}/u.test(w)).length >= 2) b.translatable = false;
  }
  // …và mọi mục ngắn khác của CÙNG cột viết tắt ("Ao", "aAo", "dAo", "AV canal", "cHCD")
  const acroCols = blocks.filter(b => !b.translatable && acro(b));
  for (const b of blocks) {
    if (!b.translatable || b.lineCount !== 1 || b.plain.trim().length > 12 || b.plain.trim().split(/\s+/).length > 2) continue;
    if (acroCols.filter(o => Math.abs(o.x0 - b.x0) < 0.5 * b.size && Math.abs(o.size - b.size) < 0.15 * b.size).length < 3) continue;
    if (blocks.some(o => o !== b && o.x0 > b.x1 && o.x0 - b.x0 < 9 * b.size && Math.abs(o.top - b.top) < 0.4 * b.size && letterCount(o.plain) >= 3)) b.translatable = false;
  }
  return orderForReading(blocks, pageWidth, gutters);
}

function attachDropCaps(blocks: LayoutBlock[], items: NormItem[]) {
  for (const cap of items.filter(i => i.dropCap)) {
    const capTop = cap.y - 0.72 * cap.size, capX1 = cap.x + cap.w;
    let best: LayoutBlock | null = null, bestD = Infinity;
    for (const b of blocks) {
      if (!b.translatable || b.dropCap || b.leader) continue;
      if (b.x0 < capX1 - 1 || b.x0 - capX1 > 2.5 * b.size) continue;
      const firstBase = b.top + 0.9 * b.size;
      const d = Math.abs(firstBase - (capTop + 0.75 * b.size));
      if (firstBase < capTop - 0.3 * b.size || firstBase > capTop + 1.6 * b.size) continue;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) continue;
    const letter = cap.str.trim();
    const join = /^\p{Ll}/u.test(best.plain) ? '' : ' ';
    best.text = letter + join + best.text;
    best.plain = letter + join + best.plain;
    const firstBase = best.top + 0.9 * best.size;
    let k = 0;
    for (let i = 0; i < best.lineCount; i++) if (firstBase + i * best.leading <= cap.y + 0.35 * best.size) k++;
    best.dropCap = {
      x: cap.x, w: best.x0 - cap.x, size: cap.size, baseline: cap.y, lines: Math.max(1, k),
      bold: cap.bold, serif: cap.serif, color: cap.color,
    };
    best.x0 = cap.x;
    best.firstOffset = 0;
    best.restOffset = 0;
    best.bottom = Math.max(best.bottom, cap.y + 0.08 * cap.size);
    if (best.align === 'center' || best.align === 'right') best.align = best.lineCount >= 3 ? 'justify' : 'left';
  }
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
    if (sameStyle(r, baseStyle) || !/[\p{L}\p{N}]/u.test(r.text)) { text += r.text; continue; }
    let k = styles.findIndex(s => sameStyle(s, r));
    if (k < 0) { styles.push({ bold: r.bold, italic: r.italic, color: r.color }); k = styles.length - 1; }
    // Dấu câu/khoảng trắng ở hai đầu để ngoài thẻ
    const mm = r.text.match(/^([^\p{L}\p{N}]*)([\s\S]*?[\p{L}\p{N}])([^\p{L}\p{N}]*)$/u);
    if (!mm) { text += r.text; continue; }
    text += `${mm[1]}<${k + 1}>${mm[2]}</${k + 1}>${mm[3]}`;
  }
  // Không để khoảng trắng trước dấu đóng / sau dấu mở ("[6 , 7 ]" → "[6, 7]")
  const tidy = (t: string) => t.replace(/\s+/g, ' ').replace(/\s+((?:<\/?\d+>)*[,.;:!?)\]])/g, '$1').replace(/([(\[](?:<\/?\d+>)*)\s+/g, '$1').trim();
  text = tidy(text);
  plain = tidy(plain);

  let breakOnStyle = false;
  if (lines.length >= 2 && lines.length <= 4) {
    const key = (r: RunStyle) => `${r.bold}|${r.italic}`;
    const lettered = (l: Segment) => l.runs.filter(r => /[\p{L}\p{N}]/u.test(r.text));
    let B = 0, T = 0, fullBefore = 0, prevKey: string | null = null;
    const rightEdge = Math.max(...lines.map(l => l.x1));
    lines.forEach((l, li) => {
      lettered(l).forEach((r, ri) => {
        const k = key(r);
        if (prevKey !== null && k !== prevKey) {
          T++;
          if (ri === 0 && li > 0) { B++; if (lines[li - 1].x1 > rightEdge - 1.5 * lines[li - 1].size) fullBefore++; }
        }
        prevKey = k;
      });
    });
    // v10.3: chỉ một lần đổi kiểu chữ trùng chỗ xuống dòng mà dòng trước chạy ĐỦ khổ (chú thích "…of the tumor" /
    // "(white arrows)") là tình cờ, không phải ngắt dòng theo kiểu chữ → trước đây dòng 2 bị ép xuống dòng, giãn chữ rất thưa
    breakOnStyle = B >= 1 && B === T && !(B === 1 && fullBefore === 1);
  }
  // v11: khối "nhãn: giá trị" mỗi mục một dòng, nhãn in nghiêng/đậm ("Form: oval… / Contour: mostly sharp… / Density: …
  // / Size: 2×2 cm" — Atlas Giảng dạy X-quang tr.33) → bản dịch trước đây chảy thành một đoạn liền ("…dạng thùy Viền: chủ
  // yếu…"). Đánh dấu để khi dàn chữ, mỗi nhãn in nghiêng/đậm có dấu ":" bắt đầu một dòng mới.
  let labelLines = false;
  if (lines.length >= 2) {
    const labelStart = (l: Segment) => {
      const r0 = l.runs.find(r => /[\p{L}\p{N}]/u.test(r.text));
      if (!r0 || !(r0.bold || r0.italic) || (r0.bold === baseStyle.bold && r0.italic === baseStyle.italic)) return false;
      return /^\s*[\p{L}][\p{L}\s\-\/()]{0,30}:/u.test(l.text);
    };
    labelLines = lines.filter(labelStart).length >= 2;
  }
  const width = b.x1 - b.x0;
  let align: BlockAlign = 'left';
  if (lines.length >= 3) {
    const body = lines.slice(0, -1);
    const full = body.filter(l => l.x1 >= b.x1 - 0.6 * b.size).length;
    // Tiêu đề (chữ đậm, ít dòng) không căn đều dù các dòng gần dài bằng nhau
    // (v10.8: chữ trưng bày cỡ lớn — tên sách trên bìa — không căn đều)
    if (full / body.length >= 0.7 && !(b.bold && lines.length <= 4) && b.size < 0.035 * pageWidth) align = 'justify';
  }
  if (align === 'left' && lines.length >= 2) {
    const center = (b.x0 + b.x1) / 2;
    const allCentered = lines.every(l => Math.abs((l.x0 + l.x1) / 2 - center) < 0.6 * b.size);
    const someShorter = lines.some(l => l.x1 - l.x0 < width - 2 * b.size);
    // Các dòng dài gần bằng nhau nhưng mép trái so le và cả khối nằm giữa trang → cũng là canh giữa
    const ragged = lines.some(l => Math.abs(l.x0 - b.x0) > 0.3 * b.size);
    if (allCentered && (someShorter || (ragged && Math.abs(center - pageWidth / 2) < 0.02 * pageWidth))) align = 'center';
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
    breakOnStyle: breakOnStyle || undefined,
    labelLines: labelLines || undefined,
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
  // v10.3: khe cột dò được có thể lệch vài chục px (Thyroid Ablation tr.17: khe 795 trong khi chú thích cột phải bắt đầu ở
  // 774) → khối cột phải chỉ "lấn" khe một chút từng bị coi là vắt ngang trang, xếp TRƯỚC chú thích cột trái. Nay phải lấn
  // thật sự sang cả hai bên (≥ 2 cỡ chữ với khối rộng, ≥ nửa cỡ chữ với khối hẹp).
  const crosses = (b: LayoutBlock) => splits.some(x => {
    const side = Math.min(x - b.x0, b.x1 - x);
    return b.x0 < x - 2 && b.x1 > x + 2 &&
      ((b.x1 - b.x0 > 0.3 * pageWidth && side > 2 * b.size) || (side > 0.15 * (b.x1 - b.x0) && side > 0.5 * b.size));
  });
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
  return result.map((b, i) => ({ ...b, id: `b${i + 1}`, col: gutters.length ? (crosses(b) ? -1 : colOf(b)) : undefined }));
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

/**
 * AI hay bỏ mất thẻ <n> quanh số hình / trích dẫn ("(Figs. <1>3.2</1>, <1>3.3</1>…)" → "(Hình 3.2, 3.3…)") →
 * chữ màu xanh / nghiêng của bản gốc thành chữ đen. Thẻ nào có trong câu gốc mà bản dịch thiếu hẳn: tìm lại đúng
 * đoạn chữ giữ nguyên (số, mã, tên) trong bản dịch theo thứ tự và bọc lại thẻ.
 */
export function restoreTags(src: string, v: string): string {
  if (!src || !v || !/<\d+>/.test(src)) return v;
  // v10.10: nhãn "<1>Fig. 2.20</1>" mà AI chỉ bọc thẻ quanh số ("Hình <1>2.20</1>") → chữ "Hình" mất màu/đậm: kéo thẻ ra cả nhãn
  {
    const ms = src.match(/^\s*<(\d+)>\s*(?:figs?\.?|figures?|tables?|tab\.)\s*[\d.\-–]+[a-z]?\s*<\/\1>/i);
    if (ms) v = v.replace(new RegExp(`^(\\s*)(hình|bảng|fig\\.?|figure|table)\\s*<${ms[1]}>\\s*([\\d.\\-–]+[a-z]?)\\s*<\\/${ms[1]}>`, 'iu'), (_m, sp, w, n) => `${sp}<${ms[1]}>${w} ${n}</${ms[1]}>`);
  }
  const spans: { k: string; inner: string }[] = [];
  const re = /<(\d+)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const inner = m[2].replace(/<\/?\d+>/g, '').trim();
    if (inner) spans.push({ k: m[1], inner });
  }
  const countIn = (t: string, k: string) => t.split(`<${k}>`).length - 1;
  const missing = new Set(spans.map(sp => sp.k).filter(k => countIn(v, k) < countIn(src, k)));
  if (!missing.size) return v;
  // Vùng đã nằm trong thẻ của bản dịch → không bọc chồng
  const taken: [number, number][] = [];
  const re2 = /<(\d+)>[\s\S]*?<\/\1>/g;
  while ((m = re2.exec(v))) taken.push([m.index, m.index + m[0].length]);
  const isWordCh = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);
  const ranges: { a: number; b: number; k: string }[] = [];
  const cursor = new Map<string, number>();
  const done = new Map<string, number>(); // số lần "<k>inner</k>" đã có sẵn trong bản dịch
  for (const sp of spans) {
    if (!missing.has(sp.k)) continue;
    const key = `${sp.k}|${sp.inner}`;
    const have = v.split(`<${sp.k}>${sp.inner}</${sp.k}>`).length - 1;
    if ((done.get(key) || 0) < have) { done.set(key, (done.get(key) || 0) + 1); continue; }
    let from = cursor.get(sp.k) ?? 0;
    let wrapped = false; // bản dịch có thể đổi thứ tự → hết chỗ phía sau thì tìm lại từ đầu
    // Khoảng trắng quanh dấu câu có thể khác ("6, 7" ↔ "6,7"), "and" ↔ "và"
    const pat = sp.inner.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*')
      .replace(/(,|;)/g, '\\s*$1\\s*').replace(/\\s\*and\\s\*/g, '\\s*(?:and|và|,)\\s*');
    // v10.9: nhãn chú thích "Fig. 4.12" được dịch thành "Hình 4.12" → tìm theo số hình (không thì nhãn mất chữ đậm)
    const capM = sp.inner.match(/^(?:figs?\.?|figures?|tables?|tab\.)\s*(\d+(?:[.\-–]\d+)*[a-z]?)$/i);
    const rx = capM ? new RegExp(`(?:hình|bảng|fig\\.?|figure|table)\\s*${capM[1].replace(/[.\-–]/g, m => '\\' + m)}`, 'giu') : new RegExp(pat, 'gu');
    const find = (f: number) => { rx.lastIndex = f; const mm = rx.exec(v); return mm ? { i: mm.index, j: mm.index + mm[0].length } : null; };
    while (true) {
      let hit = find(from);
      if (!hit && !wrapped && from > 0) { wrapped = true; from = 0; hit = find(0); }
      if (!hit) break;
      const i = hit.i, j = hit.j;
      const before = v[i - 1], after = v[j], after2 = v[j + 1];
      const boundary = !isWordCh(before) && !isWordCh(after) && !(/[.,]/.test(after || '') && /\d/.test(after2 || '') && /\d$/.test(sp.inner))
        && !(/[.,]/.test(before || '') && /\d/.test(v[i - 2] || '') && /^\d/.test(sp.inner));
      const clash = taken.some(([a, b]) => i < b && j > a) || ranges.some(r => i < r.b && j > r.a);
      if (boundary && !clash) { ranges.push({ a: i, b: j, k: sp.k }); cursor.set(sp.k, j); break; }
      from = i + 1;
    }
  }
  if (!ranges.length) return v;
  ranges.sort((x, y) => x.a - y.a);
  let out = '', pos = 0;
  for (const r of ranges) { out += v.slice(pos, r.a) + `<${r.k}>` + v.slice(r.a, r.b) + `</${r.k}>`; pos = r.b; }
  return out + v.slice(pos);
}

/**
 * v9.8: AI hay tự bọc thẻ màu quanh thuật ngữ không có màu ở bản gốc ("<1>Tâm thất phải</1>" khi bản gốc chỉ tô xanh
 * số hình "1.25") → chữ thường bị tô xanh. Mỗi thẻ trong bản dịch phải ứng với đúng một đoạn có thẻ đó trong câu gốc
 * (theo thứ tự): đoạn gốc có số → bản dịch phải có đúng các số đó; đoạn gốc không số → bản dịch không thêm số và độ dài
 * tương xứng; thừa số lần → bỏ thẻ (giữ chữ, màu thường). Thẻ không có trong câu gốc → bỏ.
 */
export function sanitizeTags(src: string, v: string): string {
  if (!v || !/<\/?\d+>/.test(v)) return v;
  const srcSpans = new Map<string, string[]>();
  const re = /<(\d+)>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src || ''))) {
    const inner = m[2].replace(/<\/?\d+>/g, '').trim();
    if (!inner) continue;
    const a = srcSpans.get(m[1]) || []; a.push(inner); srcSpans.set(m[1], a);
  }
  const nums = (t: string) => (t.match(/\d+(?:[.,]\d+)*/g) || []).join('|');
  const letters = (t: string) => (t.match(/\p{L}/gu) || []).length;
  const used = new Map<string, boolean[]>();
  const fits = (s: string, t: string) => {
    const ns = nums(s), nt = nums(t);
    if (ns !== nt) return false;
    if (ns) {
      // Đoạn gốc toàn số/trích dẫn ("1.25", "[3]", "Figs. 1.2") → bản dịch không được thêm nhiều chữ
      const ls = letters(s), lt = letters(t);
      return lt <= Math.max(ls * 2 + 4, 6);
    }
    const ls = letters(s), lt = letters(t);
    // Dịch Anh→Việt giữ độ dài chữ cái xấp xỉ (0,5–2 lần) → đoạn dịch quá ngắn/dài so với đoạn gốc là thẻ đặt sai chỗ
    return lt > 0 && lt <= ls * 2.5 + 8 && lt >= ls * 0.4 - 2;
  };
  const out = v.replace(/<(\d+)>([\s\S]*?)<\/\1>/g, (whole, k: string, inner: string) => {
    const cand = srcSpans.get(k);
    const plain = inner.replace(/<\/?\d+>/g, '');
    if (!cand || !plain.trim()) return plain;
    const u = used.get(k) || cand.map(() => false); used.set(k, u);
    // Ưu tiên đoạn gốc chưa dùng đầu tiên khớp (giữ thứ tự)
    for (let i = 0; i < cand.length; i++) {
      if (u[i]) continue;
      if (fits(cand[i], plain)) { u[i] = true; return `<${k}>${plain}</${k}>`; }
    }
    return plain;
  });
  // Thẻ lẻ (mở không đóng / đóng không mở) → bỏ
  return out.replace(/<(\d+)>[\s\S]*?<\/\1>|<\/?\d+>/g, (w, k) => (k ? w : ''));
}

/** Bản dịch có thẻ <n>…</n> → danh sách từ, mỗi từ gồm các mảnh có kiểu chữ riêng. */
function parseRich(translated: string, b: LayoutBlock, base: RunStyle): Word[] {
  const pieces: Piece[] = [];
  const re = /<(\d+)>([\s\S]*?)<\/\1>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  translated = translated.replace(/<\/?(?!\d+>)[a-zA-Z][^>]*>/g, ''); // thẻ HTML lạ AI tự thêm (<i>, <b>, <sup>…)
  translated = restoreTags(b.text, sanitizeTags(b.text, translated));
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

/**
 * v11: thụt đầu dòng / thụt treo chỉ có nghĩa với khối căn trái / căn đều. Khối căn giữa (trang tên sách: "Former Senior
 * Lecturer… / University of Salford, UK / Associate Professor") có mép trái các dòng so le chỉ vì canh giữa → trước đây
 * bị coi là thụt treo, các dòng sau bị đẩy lệch sang phải (Clark's tr.3).
 */
function lineIndent(b: LayoutBlock, i: number): number {
  if (b.align === 'center' || b.align === 'right') return 0;
  return i === 0 ? b.firstOffset : b.restOffset;
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
    const w = width - lineIndent(b, i) * scale - (b.dropCap && i < b.dropCap.lines ? b.dropCap.w : 0);
    // Mục lục nhiều dòng: các dòng trên ngắt như bản gốc (chừa khoảng cho số trang)
    return useBodyRight && b.bodyRight ? Math.min(w, b.bodyRight + 0.5 * b.size - b.x0) : w;
  };
  const lines: Word[][] = [];
  let line: Word[] = [];
  let lw = 0;
  // v9.4: từ dài hơn cả dòng (đường link, DOI) → ngắt tại "/", ".", "-", "_", "?", "&", "=" (hoặc giữa ký tự)
  // để không tràn ra ngoài cột (tr. 92 sách Atlas). Mỗi mảnh nằm trên một dòng riêng nên không chèn khoảng trắng.
  const splitLong = (w: Word, maxW: number): Word[] => {
    if (w.length !== 1 || w[0].text.length < 8) return [w];
    const p = w[0];
    const font = fontCss(p.style, serif, size);
    const tokens = p.text.match(/[^/.\-_?&=]+[/.\-_?&=]*|[/.\-_?&=]+/g) || [p.text];
    const out: Word[] = [];
    let cur = '';
    const push = () => { if (cur) { out.push([{ ...p, text: cur }]); cur = ''; } };
    for (let t of tokens) {
      while (m.width(t, font) * hs > maxW && t.length > 1) { // một mảnh vẫn quá dài → cắt theo ký tự
        let k = t.length - 1;
        while (k > 1 && m.width(t.slice(0, k), font) * hs > maxW) k--;
        if (cur && m.width(cur + t.slice(0, k), font) * hs > maxW) push();
        cur += t.slice(0, k); push(); t = t.slice(k);
      }
      if (cur && m.width(cur + t, font) * hs > maxW) push();
      cur += t;
    }
    push();
    return out.length ? out : [w];
  };
  const expanded: Word[] = [];
  for (const w of words) {
    const maxW = Math.max(size * 3, lineWidth(1));
    if (w.length === 1 && wordWidth(m, w, serif, size, hs) > maxW) expanded.push(...splitLong(w, maxW));
    else expanded.push(w);
  }
  const styleKey = (w: Word | undefined) => { const p = w?.find(q => /[\p{L}\p{N}]/u.test(q.text)) || w?.[0]; return p ? `${!!p.style.bold}|${!!p.style.italic}` : ''; };
  // v11: vị trí bắt đầu một nhãn in nghiêng/đậm kết thúc bằng ":" (khối labelLines) → xuống dòng trước nhãn
  const labelAt = new Set<number>();
  if (b.labelLines) {
    const styled = (w: Word | undefined) => { const p = w?.find(q => /[\p{L}\p{N}]/u.test(q.text)); return !!p && (!!p.style.bold || !!p.style.italic) && !(p.style.bold === base.bold && p.style.italic === base.italic); };
    for (let i = 1; i < expanded.length; i++) {
      if (!styled(expanded[i]) || styled(expanded[i - 1])) continue;
      for (let j = i; j < Math.min(expanded.length, i + 5) && styled(expanded[j]); j++) {
        const t = expanded[j].map(p => p.text).join('');
        if (/:\s*$/.test(t) || /^:/.test(expanded[j + 1]?.map(p => p.text).join('') || '')) { labelAt.add(i); break; }
      }
    }
  }
  for (let wi = 0; wi < expanded.length; wi++) {
    const w = expanded[wi];
    const ww = wordWidth(m, w, serif, size, hs);
    const limit = lineWidth(lines.length);
    const styleBreak = (!!b.breakOnStyle && line.length > 0 && styleKey(line[line.length - 1]) !== styleKey(w) && /[\p{L}\p{N}]/u.test(w.map(p => p.text).join(''))) ||
      (labelAt.has(wi) && line.length > 0);
    if (line.length && (styleBreak || lw + space + ww > limit)) {
      lines.push(line);
      line = [w];
      lw = ww;
    } else {
      lw += (line.length ? space : 0) + ww;
      line.push(w);
    }
  }
  if (line.length) lines.push(line);

  // v10.4: đoạn căn đều → ngắt dòng cân bằng cả đoạn (kiểu Knuth–Plass rút gọn): cùng số dòng như cách ngắt tham lam
  // nhưng chia đều khoảng trống cho các dòng → không còn dòng giãn rất rộng ("Ưu điểm của MLD đơn thuần, được")
  if (b.align === 'justify' && !b.leader && !b.breakOnStyle && !labelAt.size && !b.dropCap && lines.length >= 2 && expanded.length <= 1500) {
    const n = expanded.length;
    const ws = expanded.map(w => wordWidth(m, w, serif, size, hs));
    const LINE_PEN = 1e7;
    const cost = new Float64Array(n + 1).fill(Infinity);
    const nxt = new Int32Array(n + 1).fill(-1);
    cost[n] = 0;
    for (let i = n - 1; i >= 0; i--) {
      const limit = lineWidth(i === 0 ? 0 : 1);
      let lw = 0;
      for (let j = i + 1; j <= n; j++) {
        lw += ws[j - 1] + (j - 1 > i ? space : 0);
        if (lw > limit + 0.01 && j > i + 1) break;
        let bad = 0;
        if (j < n) {
          const gaps = j - i - 1;
          const slack = Math.max(0, limit - lw);
          bad = gaps > 0 ? Math.pow(slack / gaps / space, 3) * 100 : Math.pow(slack / Math.max(space, 1), 2) * 50;
        }
        const c = LINE_PEN + bad + cost[j];
        if (c < cost[i]) { cost[i] = c; nxt[i] = j; }
      }
    }
    const out: Word[][] = [];
    for (let i = 0; i < n && nxt[i] > i; i = nxt[i]) out.push(expanded.slice(i, nxt[i]));
    if (out.length === lines.length && out.reduce((k, l) => k + l.length, 0) === n) { lines.length = 0; lines.push(...out); }
  }

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
    const offset = lineIndent(b, i) * scale + (b.dropCap && i < b.dropCap.lines ? b.dropCap.w : 0);
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
      // căn đều mọi dòng trừ dòng cuối, như bản in. v10.4: dòng phải giãn quá 4 lần khoảng trắng thường (ít chữ, từ dài) → để căn trái thay vì
      // tạo lỗ trắng lớn giữa các chữ; nhờ ngắt dòng cân bằng cả đoạn nên rất hiếm
      if (g > space * 0.8 && g < size * 2.2 && g <= space * 4) gap = g;
    }
    const lineX0 = x;
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
    if (textSink && line.length) {
      const text = line.map(w => w.map(p => p.text).join('')).join(' ').trim();
      if (text) textSink.push({ x: lineX0, y, w: Math.max(1, x - lineX0), size, text });
    }
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
        // v9.8: chừa khoảng cách ~nửa dòng với hình / đường kẻ bên dưới (trước đây chú thích dịch dài thêm 1 dòng
        // chạm sát mép ảnh phía dưới)
        return Math.max(0, y - startY - 3 - 0.45 * b.size);
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
  /** Chữ cái đầu bản dịch vẽ thành chữ hoa cỡ lớn (drop cap). */
  capChar?: string;
}

/**
 * Vẽ bản dịch lên canvas đã render trang gốc.
 * translations: id khối → bản dịch (có thể chứa thẻ <n>…</n>). Khối không có bản dịch giữ nguyên.
 */
/**
 * v9.8: xoá nhãn chữ nằm trong ảnh / hình vẽ. Màu nền = trung vị màu viền khung; điểm khác màu nền rõ rệt (chữ tối,
 * chữ trắng viền màu…) + nới 2 điểm → lấp dần từ ngoài vào bằng trung bình các điểm nền lân cận (giữ vân ảnh,
 * không để lại vệt xám / bóng chữ). Đường kẻ dài cắt ngang khung (mũi tên, viền hình) chạm mép khung được giữ.
 */
function eraseLabel(ctx: CanvasRenderingContext2D, xa: number, ya: number, rw: number, rh: number) {
  if (rw < 3 || rh < 3) return;
  const part = ctx.getImageData(xa, ya, rw, rh);
  const p = part.data;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  const push = (k: number) => { rs.push(p[k * 4]); gs.push(p[k * 4 + 1]); bs.push(p[k * 4 + 2]); };
  for (let x = 0; x < rw; x++) { push(x); push((rh - 1) * rw + x); }
  for (let y = 1; y < rh - 1; y++) { push(y * rw); push(y * rw + rw - 1); }
  const med = (a: number[]) => { a.sort((u, v) => u - v); return a[a.length >> 1]; };
  const br = med(rs), bgc = med(gs), bb = med(bs);
  const n = rw * rh;
  const ink = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    const i = k * 4;
    if (Math.abs(p[i] - br) + Math.abs(p[i + 1] - bgc) + Math.abs(p[i + 2] - bb) > 75) ink[k] = 1;
  }
  // Giữ nét dài chạy xuyên mép khung (mũi tên, đường tròn, khung hình): thành phần liên thông chạm mép và trải dài
  // quá nửa khung nhưng mảnh → không phải chữ
  const comp = new Int32Array(n).fill(-1);
  const keep = new Uint8Array(n);
  const stack: number[] = [];
  let cid = 0;
  for (let k0 = 0; k0 < n; k0++) {
    if (!ink[k0] || comp[k0] >= 0) continue;
    const pts: number[] = [];
    comp[k0] = cid; stack.push(k0);
    let x0 = rw, x1 = 0, y0 = rh, y1 = 0, edge = 0;
    while (stack.length) {
      const k = stack.pop()!; pts.push(k);
      const x = k % rw, y = (k / rw) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === rw - 1 || y === rh - 1) edge++;
      for (const d of [-1, 1, -rw, rw]) {
        const q = k + d;
        if (q < 0 || q >= n || (d === -1 && x === 0) || (d === 1 && x === rw - 1)) continue;
        if (ink[q] && comp[q] < 0) { comp[q] = cid; stack.push(q); }
      }
    }
    const span = Math.max((x1 - x0 + 1) / rw, (y1 - y0 + 1) / rh);
    const thin = pts.length < 0.12 * (x1 - x0 + 1) * (y1 - y0 + 1);
    if (edge >= 2 && span > 0.6 && thin) for (const k of pts) keep[k] = 1;
    cid++;
  }
  const hole = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    if (!ink[k] || keep[k]) continue;
    const x = k % rw, y = (k / rw) | 0;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= rw || yy >= rh) continue;
      const q = yy * rw + xx;
      if (!keep[q]) hole[q] = 1;
    }
  }
  // Lấp từ ngoài vào (mỗi vòng lấp các điểm có láng giềng đã biết)
  let left = 0;
  for (let k = 0; k < n; k++) left += hole[k];
  for (let iter = 0; left > 0 && iter < Math.max(rw, rh); iter++) {
    const fill: [number, number, number, number][] = [];
    for (let k = 0; k < n; k++) {
      if (!hole[k]) continue;
      const x = k % rw, y = (k / rw) | 0;
      let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= rw || yy >= rh) continue;
        const q = yy * rw + xx;
        if (hole[q] || keep[q]) continue;
        r += p[q * 4]; g += p[q * 4 + 1]; b += p[q * 4 + 2]; c++;
      }
      if (c) fill.push([k, r / c, g / c, b / c]);
    }
    if (!fill.length) break;
    for (const [k, r, g, b] of fill) { p[k * 4] = r; p[k * 4 + 1] = g; p[k * 4 + 2] = b; p[k * 4 + 3] = 255; hole[k] = 0; left--; }
  }
  if (left > 0) for (let k = 0; k < n; k++) if (hole[k]) { p[k * 4] = br; p[k * 4 + 1] = bgc; p[k * 4 + 2] = bb; p[k * 4 + 3] = 255; }
  ctx.putImageData(part, xa, ya);
}

export function paintTranslatedPage(
  ctx: CanvasRenderingContext2D,
  allBlocks: LayoutBlock[],
  translations: Record<string, string>,
  /** Bản vẽ trang không có chữ (nền thật). null → xoá bằng màu nền. */
  clean?: ImageData | null,
  /** Ảnh trang gốc đã đọc sẵn lúc phân tích (tránh đọc lại toàn trang — tốn ~15 MB và thời gian). */
  pageImg?: ImageData | null,
): PaintReport {
  const report: PaintReport = { painted: 0, overflowIds: [], shrunkIds: [], textRuns: [] };
  textSink = null;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const img = pageImg && pageImg.width === W && pageImg.height === H ? pageImg : ctx.getImageData(0, 0, W, H);
  const cleanOk = !!clean && clean.width === W && clean.height === H;
  /**
   * Xoá một vùng: nếu bản "không chữ" thật sự đã mất chữ ở vùng này (chữ vector) → chép nền thật
   * (giữ ảnh, khung, đường kẻ, nền màu). Ngược lại (chữ nằm trong ảnh / trang scan) → tô màu nền.
   */
  const scrubUnderlines = (b: LayoutBlock, x0: number, y0: number, x1: number, y1: number, bg: RGB) => {
    const xa = Math.max(0, Math.floor(x0)), xb = Math.min(W, Math.ceil(x1));
    const ya = Math.max(0, Math.floor(y0)), yb = Math.min(H, Math.ceil(y1));
    const rw = xb - xa, rh = yb - ya;
    if (rw < 8 || rh < 6) return;
    const part = ctx.getImageData(xa, ya, rw, rh);
    const p = part.data;
    const inkP = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= rw || y >= rh) return false;
      const i = (y * rw + x) * 4;
      return Math.abs(p[i] - bg.r) + Math.abs(p[i + 1] - bg.g) + Math.abs(p[i + 2] - bg.b) > 90;
    };
    const od = img.data;
    const inkOrig = (gx: number, gy: number) => {
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return false;
      const i = (gy * W + gx) * 4;
      return Math.abs(od[i] - bg.r) + Math.abs(od[i + 1] - bg.g) + Math.abs(od[i + 2] - bg.b) > 90;
    };
    const minRun = Math.max(12, 1.5 * b.size);
    const gap = Math.max(3, Math.round(0.18 * b.size));
    let changed = false;
    for (let y = 0; y < rh; y++) {
      let run = 0;
      for (let x = 0; x <= rw; x++) {
        if (x < rw && inkP(x, y)) { run++; continue; }
        if (run >= minRun) {
          const a = x - run;
          let thick = 0;
          for (let t = a; t < x; t++) if (inkP(t, y - gap) || inkP(t, y + gap)) thick++;
          // đường kẻ thật (bảng, khung) chạy tiếp ra ngoài vùng → giữ
          let beyond = false;
          for (let k = 2; k <= 6 && !beyond; k++) beyond = inkOrig(xa + a - k, ya + y) || inkOrig(xa + x - 1 + k, ya + y);
          if (thick < 0.2 * run && !beyond) {
            for (let yy = Math.max(0, y - 1); yy <= Math.min(rh - 1, y + 2); yy++) {
              for (let t = a; t < x; t++) {
                if (!inkP(t, yy)) continue;
                const i = (yy * rw + t) * 4;
                p[i] = bg.r; p[i + 1] = bg.g; p[i + 2] = bg.b;
              }
            }
            changed = true;
          }
        }
        run = 0;
      }
    }
    if (changed) ctx.putImageData(part, xa, ya);
  };
  const erase = (x: number, y: number, w: number, h: number, bg: RGB, size = 0, both = false) => {
    const xa = Math.max(0, Math.floor(x)), ya = Math.max(0, Math.floor(y));
    const xb = Math.min(W, Math.ceil(x + w)), yb = Math.min(H, Math.ceil(y + h));
    if (xb <= xa || yb <= ya) return;
    if (cleanOk && !both) { // nhãn trong ảnh: bản không-chữ vẫn còn nguyên nhãn (chữ nằm trong ảnh) → không dùng
      const d = img.data, c = clean!.data;
      let inkOrig = 0, removed = 0, samples = 0;
      for (let yy = ya; yy < yb; yy += 2) {
        for (let xx = xa; xx < xb; xx += 2) {
          const i = (yy * W + xx) * 4;
          samples++;
          const ink = Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b) > 90;
          if (!ink) continue;
          inkOrig++;
          if (Math.abs(d[i] - c[i]) + Math.abs(d[i + 1] - c[i + 1]) + Math.abs(d[i + 2] - c[i + 2]) > 60) removed++;
        }
      }
      // Có chữ vector bị bỏ trong bản không-chữ → chép nền thật: chỉ chữ biến mất, logo/ảnh/khung trong vùng vẫn giữ
      // v10.2: chữ trên nền ảnh/gradient: "mực" đo theo màu nền phổ biến gồm cả vân ảnh → tỉ lệ cũ không đạt, rơi xuống
      // cách lấp từ viền → vệt chữ kéo dọc. Chữ thật sự biến mất trong bản không-chữ (≥ 1,5% vùng) là đủ tin.
      if (inkOrig === 0 || removed >= 0.15 * inkOrig || removed >= Math.max(4, 0.015 * samples)) {
        ctx.putImageData(clean!, 0, 0, xa, ya, xb - xa, yb - ya);
        return;
      }
    }
    if (both) { eraseLabel(ctx, xa, ya, xb - xa, yb - ya); return; }
    // Không có nền thật (trang scan, chữ trong ảnh): chỉ thay các điểm ảnh LÀ CHỮ (đậm hơn nền với chữ tối,
    // sáng hơn nền với chữ sáng) + 1 điểm viền → giữ vân giấy, nền ảnh, lề trắng; không để lại vệt chữ nhật.
    const rw = xb - xa, rh = yb - ya;
    const part = ctx.getImageData(xa, ya, rw, rh);
    const p = part.data;
    const lum = (i: number) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
    let bgL = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
    if (both && rw > 4 && rh > 4) {
      // Nhãn trong ảnh: màu nền = trung vị viền khung (màu "nền" đo trong khung dễ là chính màu chữ trắng của nhãn)
      const ring: number[] = [];
      for (let xx = 0; xx < rw; xx += 2) { ring.push(lum(xx * 4)); ring.push(lum(((rh - 1) * rw + xx) * 4)); }
      for (let yy = 0; yy < rh; yy += 2) { ring.push(lum(yy * rw * 4)); ring.push(lum((yy * rw + rw - 1) * 4)); }
      ring.sort((a, b) => a - b);
      bgL = ring[ring.length >> 1];
    }
    const dark = bgL >= 110;
    const mask = new Uint8Array(rw * rh);
    // v9.8: giấy trắng của trang scan: viền nhoè quanh nét chữ (JPEG, khử răng cưa) chỉ nhạt hơn nền ~10 → trước đây
    // còn sót thành vệt chữ xám mờ dưới đoạn dịch. Nền sáng → ngưỡng thấp + nới viền 2 điểm.
    const paper = dark && bgL > 200; // cả chữ trong hình trên trang có lớp chữ (bản không-chữ vẫn còn nét ảnh)
    const thrL = paper ? 9 : 18;
    for (let k = 0; k < rw * rh; k++) {
      const L = lum(k * 4);
      // Nhãn trong ảnh hay là chữ sáng viền tối (hoặc ngược lại) → xoá cả điểm sáng lẫn tối khác nền
      if (both ? Math.abs(L - bgL) > thrL + 10 : dark ? bgL - L > thrL : L - bgL > thrL) mask[k] = 1;
    }
    // Vùng mực đặc (logo, ảnh nhỏ chèn trong dòng) → giữ lại, không coi là chữ
    const integ = new Uint32Array((rw + 1) * (rh + 1));
    for (let yy = 0; yy < rh; yy++) {
      let row = 0;
      for (let xx = 0; xx < rw; xx++) { row += mask[yy * rw + xx]; integ[(yy + 1) * (rw + 1) + xx + 1] = integ[yy * (rw + 1) + xx + 1] + row; }
    }
    // Cửa sổ "mực đặc" theo cỡ chữ: nét chữ cỡ rất lớn (tiêu đề bìa) dày hơn cửa sổ cố định 21px → trước đây bị
    // coi là logo nên không xoá, để lại vệt nét chữ
    const R = Math.max(10, Math.round(0.45 * (size > 0 ? size : rh / 1.3)));
    const dense = (xx: number, yy: number) => {
      const xa2 = Math.max(0, xx - R), ya2 = Math.max(0, yy - R), xb2 = Math.min(rw, xx + R + 1), yb2 = Math.min(rh, yy + R + 1);
      const sum = integ[yb2 * (rw + 1) + xb2] - integ[ya2 * (rw + 1) + xb2] - integ[yb2 * (rw + 1) + xa2] + integ[ya2 * (rw + 1) + xa2];
      return sum > 0.9 * (xb2 - xa2) * (yb2 - ya2);
    };
    // Đường kẻ bảng / khung / gạch chân dài: chuỗi mực ngang rất dài hoặc chuỗi dọc chạy suốt chiều cao vùng → GIỮ
    // (trước đây bị xoá cùng chữ → đường kẻ bảng đứt đoạn, vạch "_" lẻ ở góc ô)
    const em = size > 0 ? size : Math.max(8, rh / 1.3);
    const hMin = Math.max(30, 4 * em);
    const vMin = rh >= 1.1 * em ? Math.max(6, Math.min(0.9 * rh, 2.5 * em)) : Infinity;
    // Đường kẻ thật chạy tiếp ra NGOÀI khung chữ; nét chữ (thân chữ F, l, gạch ngang chữ T…) thì không
    const od = img.data;
    const inkAt = (gx: number, gy: number) => {
      if (gx < 0 || gy < 0 || gx >= W || gy >= H) return false;
      const i = (gy * W + gx) * 4;
      const L = 0.299 * od[i] + 0.587 * od[i + 1] + 0.114 * od[i + 2];
      return dark ? bgL - L > 18 : L - bgL > 18;
    };
    const beyond = (gx: number, gy: number, dx: number, dy: number) => {
      for (let k = 1; k <= 4; k++) if (inkAt(gx + dx * k, gy + dy * k)) return true;
      return false;
    };
    for (let yy = 0; yy < rh; yy++) {
      let run = 0;
      for (let xx = 0; xx <= rw; xx++) {
        if (xx < rw && mask[yy * rw + xx]) { run++; continue; }
        if (run >= hMin) {
          const a = xx - run, gy = ya + yy;
          const cont = (a === 0 && beyond(xa, gy, -1, 0)) || (xx === rw && beyond(xa + rw - 1, gy, 1, 0)) || run >= 10 * em;
          if (cont) for (let t = a; t < xx; t++) mask[yy * rw + t] = 2;
        }
        run = 0;
      }
    }
    if (vMin !== Infinity) {
      for (let xx = 0; xx < rw; xx++) {
        let run = 0;
        for (let yy = 0; yy <= rh; yy++) {
          if (yy < rh && mask[yy * rw + xx]) { run++; continue; }
          if (run >= vMin) {
            const a = yy - run, gx = xa + xx;
            const cont = (a === 0 && beyond(gx, ya, 0, -1)) || (yy === rh && beyond(gx, ya + rh - 1, 0, 1));
            if (cont) for (let t = a; t < yy; t++) mask[t * rw + xx] = 2;
          }
          run = 0;
        }
      }
    }
    const isText = (k: number) => mask[k] === 1;
    // Tập điểm cần thay = điểm chữ + 1 điểm viền (bỏ vùng mực đặc và đường kẻ)
    const repl = new Uint8Array(rw * rh);
    for (let yy = 0; yy < rh; yy++) {
      for (let xx = 0; xx < rw; xx++) {
        const k = yy * rw + xx;
        if (mask[k] === 2) continue;
        if (mask[k] && dense(xx, yy)) continue;
        let near = isText(k) || (xx > 0 && isText(k - 1)) || (xx < rw - 1 && isText(k + 1)) || (yy > 0 && isText(k - rw)) || (yy < rh - 1 && isText(k + rw));
        if (!near && paper) near = (xx > 1 && isText(k - 2)) || (xx < rw - 2 && isText(k + 2)) || (yy > 1 && isText(k - 2 * rw)) || (yy < rh - 2 && isText(k + 2 * rw)) ||
          (xx > 0 && yy > 0 && isText(k - rw - 1)) || (xx < rw - 1 && yy < rh - 1 && isText(k + rw + 1)) || (xx > 0 && yy < rh - 1 && isText(k + rw - 1)) || (xx < rw - 1 && yy > 0 && isText(k - rw + 1));
        if (near) repl[k] = 1;
      }
    }
    // Nền đồng màu (đa số trang sách) → tô màu nền, nhanh
    let off = 0, seen = 0;
    for (let k = 0; k < rw * rh; k += 3) {
      if (repl[k] || mask[k] === 2) continue;
      seen++;
      const i = k * 4;
      if (Math.abs(p[i] - bg.r) + Math.abs(p[i + 1] - bg.g) + Math.abs(p[i + 2] - bg.b) > 30) off++;
    }
    if (off <= 0.004 * seen) {
      for (let k = 0; k < rw * rh; k++) {
        if (!repl[k]) continue;
        const i = k * 4;
        p[i] = bg.r; p[i + 1] = bg.g; p[i + 2] = bg.b; p[i + 3] = 255;
      }
      ctx.putImageData(part, xa, ya);
      return;
    }
    // Nền không đồng màu: lấp bằng NỘI SUY từ các điểm nền thật hai bên (ngang + dọc), không tô một màu phẳng
    // → nền ảnh / chuyển màu / vân giấy không còn "bóng" hình chữ cũ.
    const acc = new Float32Array(rw * rh * 3);
    const cnt = new Uint8Array(rw * rh);
    const src = new Uint8ClampedArray(p); // màu gốc để nội suy
    const good = (k: number) => !repl[k] && mask[k] !== 2;
    const fill = (k: number, a: number, b2: number, t: number) => { // a, b2: chỉ số điểm biên (-1 = không có)
      const o = k * 3;
      for (let c = 0; c < 3; c++) {
        const va = a >= 0 ? src[a * 4 + c] : -1, vb = b2 >= 0 ? src[b2 * 4 + c] : -1;
        const v = va >= 0 && vb >= 0 ? va + (vb - va) * t : va >= 0 ? va : vb >= 0 ? vb : (c === 0 ? bg.r : c === 1 ? bg.g : bg.b);
        acc[o + c] += v;
      }
      cnt[k]++;
    };
    for (let yy = 0; yy < rh; yy++) { // ngang
      let xx = 0;
      while (xx < rw) {
        if (!repl[yy * rw + xx]) { xx++; continue; }
        const s0 = xx;
        while (xx < rw && repl[yy * rw + xx]) xx++;
        let l = s0 - 1; while (l >= 0 && !good(yy * rw + l)) l--;
        let r = xx; while (r < rw && !good(yy * rw + r)) r++;
        const a = l >= 0 ? yy * rw + l : -1, b2 = r < rw ? yy * rw + r : -1;
        for (let t = s0; t < xx; t++) fill(yy * rw + t, a, b2, (l >= 0 && r < rw) ? (t - l) / (r - l) : 0);
      }
    }
    for (let xx = 0; xx < rw; xx++) { // dọc
      let yy = 0;
      while (yy < rh) {
        if (!repl[yy * rw + xx]) { yy++; continue; }
        const s0 = yy;
        while (yy < rh && repl[yy * rw + xx]) yy++;
        let u = s0 - 1; while (u >= 0 && !good(u * rw + xx)) u--;
        let dn = yy; while (dn < rh && !good(dn * rw + xx)) dn++;
        const a = u >= 0 ? u * rw + xx : -1, b2 = dn < rh ? dn * rw + xx : -1;
        for (let t = s0; t < yy; t++) fill(t * rw + xx, a, b2, (u >= 0 && dn < rh) ? (t - u) / (dn - u) : 0);
      }
    }
    for (let k = 0; k < rw * rh; k++) {
      if (!repl[k]) continue;
      const i = k * 4, o = k * 3, n = cnt[k] || 1;
      p[i] = acc[o] / n; p[i + 1] = acc[o + 1] / n; p[i + 2] = acc[o + 2] / n; p[i + 3] = 255;
    }
    ctx.putImageData(part, xa, ya);
  };
  const m = new Measurer(ctx);
  const norm = (t: string) => t.replace(/<\/?[a-zA-Z0-9][^>]*>/g, '').replace(/\s+/g, ' ').trim();
  // Chữ xoay 90° được vẽ riêng ở cuối; phần dàn trang bên dưới chỉ xử lý chữ ngang
  const blocks = allBlocks.filter(b => !b.rotate);
  const rotatedTargets = allBlocks.filter(b => {
    const t = translations[b.id];
    return b.rotate && b.translatable && t && norm(t) && norm(t) !== b.plain;
  });

  const changed = (b: LayoutBlock) => { const t = translations[b.id]; return b.translatable && !!t && !!norm(t) && norm(t) !== b.plain; };
  // v10.0: mục danh sách giữ nguyên chữ ("TDLUs", "ASL", "US", tên riêng) nằm GIỮA các mục được dịch cùng cột → cũng
  // vẽ lại (cùng chữ) để chảy theo danh sách; trước đây đứng yên tại chỗ cũ → danh sách bị hở / đè lên nhau
  const sameKept = new Set<string>();
  for (const b of blocks) {
    if (changed(b) || b.rotate || b.leader || b.lineCount > 2 || LABEL_RE.test(b.plain.trim()) || !/\p{L}/u.test(b.plain)) continue;
    const near = (o: LayoutBlock, below: boolean) => o !== b && changed(o) && Math.abs(o.size - b.size) < 0.15 * b.size &&
      Math.min(o.x1, b.x1) - Math.max(o.x0, b.x0) > 0 && Math.abs(o.x0 - b.x0) < 3.2 * b.size &&
      (below ? o.top - b.bottom : b.top - o.bottom) > -0.3 * b.size && (below ? o.top - b.bottom : b.top - o.bottom) < 1.2 * b.size;
    if (blocks.some(o => near(o, false)) && blocks.some(o => near(o, true))) sameKept.add(b.id);
  }
  for (const id of sameKept) { const b = blocks.find(x => x.id === id)!; if (!translations[id] || !norm(translations[id])) translations = { ...translations, [id]: b.text }; }
  let targets = blocks.filter(b => changed(b) || sameKept.has(b.id));

  /* --- Phân tích trước khi xoá --- */
  const info = new Map<string, BlockInfo>();
  // v9.4: lề dưới thật của trang = đáy khối chữ thấp nhất trong vùng nội dung (bỏ số trang / chân trang). Trước đây
  // chữ được phép tràn tới 98,5% chiều cao trang → lấn lề dưới, dễ bị xén khi in (tr. 17–27 sách Atlas).
  const contentBlocks = blocks.filter(o => o.bottom < H * 0.93);
  const contentBottom = contentBlocks.length ? Math.max(...contentBlocks.map(o => o.bottom)) : H * 0.93;
  for (const b of targets) {
    const padX = 0.15 * b.size;
    const stats = regionStats(img, b.x0 - padX, b.top - 0.05 * b.size, b.x1 + padX, b.bottom + 0.1 * b.size);
    let limit = b.bottom < H * 0.93 ? Math.min(H * 0.985, Math.max(b.bottom, contentBottom + 0.5 * b.size)) : H * 0.985;
    for (const o of blocks) {
      if (o === b || o.top <= b.bottom - 1) continue;
      if (Math.min(o.x1, b.x1) - Math.max(o.x0, b.x0) > 0 && o.top < limit) limit = o.top - 0.15 * o.size;
    }
    let free = freeBelow(img, b, stats.bg, limit);
    if (b.box && b.boxSolo) free = Math.max(0, b.box.bottom - 0.2 * b.size - b.bottom);
    else if (b.box) free = Math.min(free, Math.max(0, b.box.bottom - 0.2 * b.size - b.bottom)); // v10.8: ô lưu đồ: dùng tới đáy khung

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
      // v10.10: dòng mục lục có số trang ở cột phải → khoảng giữa chữ và số trang là chỗ trống của chính dòng đó
      // (trước đây "References" → "Tài liệu tham / khảo" bị ngắt 2 dòng lệch số trang, mục lục Clark's)
      const pn = blocks.find(o => o !== b && /^\d{1,4}$/.test(o.plain.trim()) && Math.abs(o.top - b.top) < 0.5 * b.size && o.x0 > b.x1 + 0.8 * b.size && o.x0 - b.x1 < 40 * b.size);
      if (pn && b.align === 'left') extRight = Math.max(extRight, pn.x0 - 1.0 * b.size - b.x1);
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
    const diffCol = (o: LayoutBlock) => o.col !== undefined && b.col !== undefined && o.col >= 0 && b.col >= 0 && o.col !== b.col;
    // (khối ở CỘT TRANG khác chỉ tình cờ cùng hàng — không phải ô bảng; thân bài 2 cột không được giãn sang khe cột)
    const cellLike = b.tableId || blocks.some(o => o !== b && !diffCol(o) && Math.abs(o.top - b.top) < 0.6 * Math.min(o.size, b.size) && (o.x1 <= b.x0 + 1 || o.x0 >= b.x1 - 1) &&
      Math.abs(o.x0 - b.x0) < 0.45 * W);
    if (cellLike && b.lineCount <= 6 && b.align !== 'right' && b.align !== 'center' && !b.leader && !LABEL_RE.test(b.plain.trim())) {
      // v10.4: ô bảng nhiều dòng được dùng hết bề ngang trống của ô (tới ô kế bên phải / mép bảng) — trước đây chỉ được
      // dùng đúng bề ngang dòng gốc dài nhất → bản dịch dài hơn phải thu nhỏ chữ cả bảng
      const same = b.tableId ? blocks.filter(o => o.tableId === b.tableId)
        : blocks.filter(o => o !== b && !diffCol(o) && o.top < b.bottom + 6 * b.size && o.bottom > b.top - 6 * b.size && Math.abs(o.size - b.size) < 0.15 * b.size);
      let right = b.tableId ? Math.max(...same.map(o => o.x1)) : Math.min(W * 0.96, Math.max(b.x1, ...same.map(o => o.x1)));
      for (const o of blocks) {
        if (o === b || o.x0 < b.x1 - 1 || o.bottom <= b.top || o.top >= b.bottom) continue;
        right = Math.min(right, o.x0 - 0.9 * b.size);
      }
      if (!b.tableId && b.col !== undefined && b.col >= 0) {
        // không vượt mép phải cột trang của chính nó
        const colBlocks = blocks.filter(o => o.col === b.col && o.lineCount >= 2);
        if (colBlocks.length) right = Math.min(right, Math.max(b.x1, ...colBlocks.map(o => o.x1)));
      }
      for (const o of same) {
        // ô của cột bên phải ở hàng khác: mép trái cột đó cũng là giới hạn
        if (o !== b && o.x0 > b.x1 + 0.5 * b.size) right = Math.min(right, o.x0 - 0.9 * b.size);
      }
      if (right > b.x1 + 0.5 * b.size) extRight = Math.max(extRight, freeSide(img, b, stats.bg, b.x1 + 0.15 * b.size, right));
      else if (b.lineCount >= 2) extRight = Math.min(extRight, Math.max(0, right - b.x1));
    }

    if (b.box) {
      // v10.8: chữ trong khung (ô lưu đồ) được dùng hết bề ngang lòng khung
      const pad = 0.35 * b.size, L = b.box.x0 + pad, R = b.box.x1 - pad;
      if (b.align === 'center') { const e = Math.max(0, Math.min(b.x0 - L, R - b.x1)); extLeft = extRight = e; }
      else { extLeft = 0; extRight = Math.max(0, R - b.x1); }
    }
    let fgc = b.baseStyle.color && !isDark(b.baseStyle.color) ? b.baseStyle.color : (stats.fg ?? b.baseStyle.color);
    if (b.fromOcr && !b.guided && !(b.baseStyle.color && !isDark(b.baseStyle.color))) fgc = deepenScanInk(fgc, stats.bg) ?? fgc;
    const base: RunStyle = { ...b.baseStyle, color: fgc };
    const words = parseRich(translations[b.id], b, base);
    if (b.lineCount === 1 && b.align === 'right' && !b.leader && words.length <= 4) {
      // v10.4: nhãn hình căn phải ngắn ("lumen" → "lòng mạch") mà bên trái là nét hình → được tràn sang vùng trắng bên phải
      // (trước đây không có chỗ → thu nhỏ còn 2 dòng tí hon trong khi các nhãn cùng loại giữ cỡ thường)
      const sp = m.width(' ', fontCss(base, b.serif, b.size));
      const need = words.reduce((acc, w) => acc + wordWidth(m, w, b.serif, b.size, b.hScale || 1), 0) + sp * (words.length - 1);
      const deficit = need - (b.x1 - b.x0) - extLeft + 0.15 * b.size;
      if (deficit > 0) {
        let right = W * 0.97;
        for (const o of blocks) {
          if (o === b || o.top >= b.bottom || o.bottom <= b.top || o.x0 < b.x1 - 1) continue;
          right = Math.min(right, o.x0 - 0.8 * b.size);
        }
        if (right > b.x1) extRight = Math.max(extRight, Math.min(deficit, freeSide(img, b, stats.bg, b.x1 + 0.15 * b.size, right)));
      }
    }
    if (b.boldLead && !b.bold) applyBoldLead(words);
    if (b.fromOcr && !b.guided && words.length) {
      // Đường link / email trong chữ scan giữ màu xanh/tím như bản gốc
      const urlRe = /(https?:\/\/|www\.|\.(org|com|net|gov|edu|vn)\b|@[\w-]+\.|doi\.org|^doi:)/i;
      if (words.some(w => urlRe.test(w.map(p => p.text).join('')))) {
        const acc = accentInk(img, b.x0, b.top, b.x1, b.bottom, stats.bg);
        if (acc) for (let k = 0; k < words.length; k++) if (urlRe.test(words[k].map(p => p.text).join(''))) words[k] = words[k].map(p => ({ ...p, style: { ...p.style, color: acc } }));
      }
    }
    let capChar: string | undefined;
    if (b.dropCap && words.length) {
      // Tách chữ cái đầu của bản dịch (kể cả dấu thanh) để vẽ to như bản gốc
      const w0 = words[0];
      const pi = w0.findIndex(p => /\p{L}/u.test(p.text));
      const mm = pi >= 0 ? w0[pi].text.match(/^(\P{L}*)(\p{L}\p{M}*)([\s\S]*)$/u) : null;
      if (mm) {
        capChar = mm[2].toUpperCase();
        w0[pi] = { ...w0[pi], text: mm[1] + mm[3] };
        const rest = w0.filter(p => p.text);
        if (rest.length) words[0] = rest; else words.shift();
        const dc = b.dropCap;
        const capW = m.width(capChar, fontCss({ bold: dc.bold, italic: false, color: null }, dc.serif, dc.size));
        dc.w = Math.max(dc.w, capW + 0.25 * b.size);
      } else {
        b.dropCap = undefined;
      }
    }
    info.set(b.id, { stats, free, extLeft, extRight, extLeftAvail, base, words, capChar });
  }

  /* --- Ký hiệu đầu dòng / số thứ tự đi kèm mỗi mục: di chuyển cùng mục khi mục bị đẩy xuống --- */
  const companion = new Map<string, { L: LayoutBlock; patch: ImageData; x: number; y: number; bg: RGB }>();
  const companionIds = new Set<string>();
  for (const b of targets) {
    let best: LayoutBlock | null = null;
    for (const L of blocks) {
      if (L === b || L.lineCount !== 1) continue;
      // v10.1: ô "viết tắt" của bảng định nghĩa (không dịch, ngắn, cùng hàng, cách ≤ 9 cỡ chữ) cũng đi theo hàng của nó
      const abbrCell = !changed(L) && !LABEL_RE.test(L.plain) && L.plain.trim().length <= 14 && L.plain.trim().split(/\s+/).filter(w => /\p{L}{2,}/u.test(w)).length <= 1 && /\p{L}/u.test(L.plain) &&
        L.x1 <= b.x0 + 1 && b.x0 - L.x0 < 9 * b.size && Math.abs(L.size - b.size) < 0.2 * b.size;
      if (!LABEL_RE.test(L.plain) && !abbrCell) continue;
      if (L.x1 > b.x0 + 1 || (!abbrCell && b.x0 - L.x1 > 3 * b.size) || Math.abs(L.top - b.top) > 0.5 * b.size) continue;
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
  // ô viết tắt đã nhận làm "bạn đi kèm" thì giữ nguyên chữ gốc (không dịch chữ viết tắt), di chuyển theo hàng
  if (targets.some(t => companionIds.has(t.id))) targets = targets.filter(t => !companionIds.has(t.id));

  /* --- Dàn từng nhóm --- */
  // "Bạn cùng hàng": khối khác nằm ngang hàng (số mục, số trang, ô bảng bên cạnh) → không được đẩy dòng xuống
  // (khối ở CỘT TRANG khác — bên kia khe cột — chỉ tình cờ cùng hàng, không phải ô bảng: trước đây làm cả danh sách
  // trang 2 cột không được đẩy dòng, từng mục tự thu nhỏ)
  const otherCol = (a: LayoutBlock, o: LayoutBlock) => {
    if (a.col === undefined || o.col === undefined || a.col < 0 || o.col < 0 || a.col === o.col) return false;
    // cặp "viết tắt | nghĩa" sát nhau vẫn là cùng hàng bảng
    const [l, r] = a.x0 < o.x0 ? [a, o] : [o, a];
    const defRow = l.plain.trim().length <= 14 && l.lineCount === 1 && r.x0 > l.x1 && r.x0 - l.x0 < 9 * Math.max(l.size, r.size);
    return !defRow;
  };
  const hasRowMate = (b: LayoutBlock, g: LayoutBlock[]) => blocks.some(o =>
    o !== b && !g.includes(o) && !companionIds.has(o.id) && !otherCol(b, o) &&
    (o.x1 <= b.x0 + 1 || o.x0 >= b.x1 - 1) &&
    // v10.8: khối cách rất xa (> 10 cỡ chữ, không cùng bảng có kẻ) — thường là cột trang bên kia khi trang không dò được
    // khe cột ("Abstract" cột trái ↔ "MESA" danh mục viết tắt cột phải, CT tim tr.31) → không phải bạn cùng hàng
    !(!b.tableId && !o.tableId && Math.max(o.x0 - b.x1, b.x0 - o.x1) > 10 * Math.max(o.size, b.size)) &&
    // (đoạn thân bài căn đều nhiều dòng không bao giờ là ô bảng cùng hàng)
    !(!b.tableId && !o.tableId && ((o.lineCount >= 3 && o.align === 'justify') || (b.lineCount >= 3 && b.align === 'justify'))) &&
    Math.abs(o.top - b.top) < 0.6 * Math.min(o.size, b.size));

  const rowMate = new Set(targets.filter(b => hasRowMate(b, [b])).map(b => b.id)); // ô bảng, mục có bạn cùng hàng

  /* --- Nhóm chảy: các khối liền nhau trong cùng cột --- */
  const groups: LayoutBlock[][] = [];
  const byTop = [...targets].sort((a, b) => a.top - b.top || a.x0 - b.x0);
  // v10.3: chú thích hình ("Fig. 2.3 …") và nhãn trong hình không chảy chung nhóm với thân bài — trước đây nhãn "nerve" +
  // chú thích + 3 đoạn thân bài cột trái thành MỘT nhóm, mất chế độ chảy liền → mỗi đoạn tự thu nhỏ còn 68%, hở lớn
  const CAPTION_RE = /^(fig\.?|figure|figs\.?|table|tab\.|box|chart|hình|bảng|biểu đồ|sơ đồ)\s*[\dA-Z]/i;
  const refSize = (() => { const v = targets.filter(t => t.lineCount >= 3).map(t => t.size); return v.length ? median(v) : median(targets.map(t => t.size)); })();
  const kindOf = (b: LayoutBlock) => CAPTION_RE.test(b.plain.trim()) ? 'cap'
    : (b.figLabel || (b.plain.length <= 45 && b.lineCount <= 3 && b.size < 0.92 * refSize && (b.x1 - b.x0) < 0.25 * W)) ? 'label' : 'text';
  const groupOf = new Map<string, LayoutBlock[]>();
  for (const b of byTop) {
    let joined = false;
    for (const g of groups) {
      const L = g[g.length - 1];
      const li = info.get(L.id)!, bi = info.get(b.id)!;
      const overlap = Math.min(L.x1, b.x1) - Math.max(L.x0, b.x0);
      // v10.0: mục danh sách nhiều cấp thụt khác nhau / mục ngắn ("Breast", "Weeks 4-6") vẫn cùng một cột chảy →
      // trước đây bị tách thành nhóm riêng, mỗi mục tự thu nhỏ → cỡ chữ to nhỏ xen kẽ trong cùng danh sách
      const sameCol = overlap > 0 && Math.abs(b.x0 - L.x0) < 3.2 * Math.max(L.size, b.size) && Math.abs(L.size - b.size) < 0.15 * Math.max(L.size, b.size);
      if (overlap < 0.6 * Math.min(L.x1 - L.x0, b.x1 - b.x0) && !sameCol) continue;
      { const kl = kindOf(L), kb = kindOf(b); if ((kl !== kb && (kl !== 'text' || kb !== 'text')) || kb === 'cap') continue; }
      // v10.3: hai ô bảng (có ô khác cùng hàng) chồng nhau trong một cột bảng là hai HÀNG khác nhau → không chảy chung:
      // trước đây cả cột bảng thành một nhóm, ô dài nhất kéo mọi ô xuống cùng cỡ nhỏ và đẩy lệch hàng
      if (rowMate.has(L.id) && rowMate.has(b.id) && !L.leader && !b.leader) continue;
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

  const plans: { b: LayoutBlock; lo: LaidOut; top: number; x0: number; width: number; orig: LayoutBlock }[] = [];
  const pageMedSize = median(targets.map(t => t.size));
  const fitGroup = (g: LayoutBlock[], sMax: number) => {
    const lastI = info.get(g[g.length - 1].id)!;
    const availBottom = g[g.length - 1].bottom + lastI.free;
    const gaps = g.slice(1).map((b, i) => Math.max(0, b.top - g[i].bottom));
    // (nhãn hình căn phải xếp chồng cạnh ảnh: giữ đúng vị trí đường chỉ, không đẩy nhau)
    const cascade = g.length > 1 && !g.some(b => hasRowMate(b, g)) && g.filter(b => b.align === 'right').length < Math.max(2, 0.5 * g.length);
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
        // Giãn dòng: theo bản gốc, chỉ nén khi cần; tối thiểu 1,08 cỡ chữ (đủ chỗ cho dấu tiếng Việt)
        const ratio = Math.min(2.2, Math.max(1.12, (b.leading / b.size) * tight));
        let lo = layoutWords(m, inf.words, b, inf.base, widthOf(b), b.size * s, ratio);
        overrides[i] = null;
        if (b.lineCount === 1 && b.align === 'left' && lo.lines.length > 1 && inf.extLeftAvail > b.size && !rowMate.has(b.id) && !companion.has(b.id) && !(cascade && g.length >= 3)) {
          // Bên phải hết chỗ → mượn chỗ bên trái, giữ mép phải (giống tiêu đề/nhãn căn phải)
          const wide = layoutWords(m, inf.words, { ...b, align: 'right' }, inf.base, widthOf(b) + inf.extLeftAvail, b.size * s, ratio);
          if (wide.lines.length < lo.lines.length) {
            lo = wide;
            overrides[i] = { x0: b.x0 - inf.extLeft - inf.extLeftAvail, width: widthOf(b) + inf.extLeftAvail };
          }
        }
        // (trong nhóm chảy, mục 1 dòng được xuống dòng và đẩy các mục sau xuống; cả nhóm thu nhỏ ĐỀU nếu thiếu chỗ —
        // trước đây từng mục tự thu nhỏ riêng → chữ to nhỏ xen kẽ trong cùng danh sách)
        // v10.6: ô bảng có kẻ 1 dòng (hàng "C", "D" chỉ cao 1 dòng) cũng vậy, kể cả khi nằm trong nhóm chảy — xuống dòng
        // sẽ tràn qua đường kẻ hàng
        const rowCell = !!b.tableId && i < g.length - 1 && g[i + 1].top - b.bottom < 1.2 * b.size;
        if (b.lineCount === 1 && lo.lines.length > 1 && inf.free < 0.6 * b.size && (!cascade || rowCell || (b.bold && b.size > 1.08 * pageMedSize))) {
          // Không còn chỗ bên dưới (tiêu đề trên thanh màu, nhãn sát hình) → thu nhỏ riêng khối này để giữ 1 dòng
          for (let s2 = s - 0.03; s2 >= 0.6 - 1e-6; s2 -= 0.03) {
            const ov = overrides[i];
            const one = layoutWords(m, inf.words, ov ? { ...b, align: 'right' } : b, inf.base, ov ? ov.width : widthOf(b), b.size * s2, ratio);
            if (one.lines.length === 1) { lo = one; break; }
          }
        }
        if (b.lineCount >= 2 && b.lineCount <= 3 && lo.lines.length === b.lineCount + 1 && b.fromOcr) {
          // v9.8: chú thích hình 2–3 dòng bị dư 1 dòng (chữ tràn xuống sát ảnh bên dưới) → thu nhỏ nhẹ (≤ 10%) để giữ
          // đúng số dòng như bản gốc
          for (let s2 = s - 0.02; s2 >= s - 0.1 - 1e-6; s2 -= 0.02) {
            const ov = overrides[i];
            const one = layoutWords(m, inf.words, ov ? { ...b, align: 'right' } : b, inf.base, ov ? ov.width : widthOf(b), b.size * s2, ratio);
            if (one.lines.length <= b.lineCount) { lo = one; break; }
          }
        }
        // v10.3: không bao giờ cắt đôi một từ ("Supêrio / r") khi còn thu nhỏ được — nhãn hình hẹp: thu nhỏ tới khi từ
        // dài nhất vừa bề ngang (chỉ cắt từ ở mức nhỏ nhất)
        if (s > minS + 1e-6) {
          const wW = widthOf(b) + 0.5;
          const ww = overrides[i] ? overrides[i]!.width + 0.5 : wW;
          if (inf.words.some(w => wordWidth(m, w, b.serif, b.size * s, b.hScale || 1) > ww)) fits = false;
        }
        los.push(lo);
        if (b.box && b.boxSolo && g.length === 1) {
          // v10.8: ô lưu đồ: chữ dịch dài hơn → giãn đều lên trên và xuống dưới (giữ giữa khung), không vượt viền khung
          const bx = b.box, h = lo.height;
          const top = Math.max(bx.top + 0.15 * b.size, Math.min(b.top, b.top - (h - (b.bottom - b.top)) / 2));
          tops.push(top);
          if (top + h > bx.bottom - 0.1 * b.size + 0.5) fits = false;
          y = top + h;
        } else if (cascade) {
          // Giữ đúng vị trí gốc để dễ đối chiếu; chỉ đẩy xuống khi khối phía trên dài hơn chỗ của nó
          // v10.0: danh sách (≥ 3 mục) chảy liền nhau theo khoảng cách gốc → khoảng cách giữa các mục đều nhau (trước đây
          // mục giữ vị trí gốc sau khi nhóm thu nhỏ → chỗ dồn sát, chỗ hở to)
          // v10.4: ô bảng giữ đúng đầu dòng gốc (không dồn lên khi cả bảng thu nhỏ đều)
          let top = g.length >= 3 && i > 0 && !b.tableId ? y : Math.max(b.top, y);
          // (nhưng nếu giữ đầu dòng gốc mà tràn qua đường kẻ hàng thì dồn lên vừa đủ, không lên quá mục trên)
          if (b.tableId && top > y && top + lo.height > availBottom + 0.5) top = Math.max(y, availBottom - lo.height);
          tops.push(top);
          y = top + lo.height + (i < gaps.length ? gaps[i] * Math.max(0.6, s) : 0);
        } else {
          // Giữ nguyên vị trí: mỗi khối chỉ được dùng tới đầu khối kế tiếp (hoặc khoảng trống thật bên dưới)
          tops.push(b.top);
          const limit = i < g.length - 1 ? g[i + 1].top - 0.1 * b.size : b.bottom + inf.free;
          if (b.top + lo.height > limit + 0.5) fits = false;
          // v10.2: chữ trưng bày (tên sách trên bìa) giữ đúng số dòng gốc khi không còn chỗ trống bên dưới — dòng thêm
          // nằm đè lên dải ảnh dù vẫn "lọt" trong khung chữ cũ (khung tính cả phần chân chữ g, p)
          if (b.size > 0.03 * H && b.lineCount >= 2 && lo.lines.length > b.lineCount && inf.free < b.size) fits = false;
        }
      });
      if (cascade && y > availBottom + 0.5) fits = false;
      return { fits, los, tops };
    };

    let chosen: { s: number; los: LaidOut[]; tops: number[] } | null = null;
    // v10.2: chữ trưng bày cỡ lớn (tên sách trên bìa, tiêu đề phần) được thu nhỏ sâu hơn thay vì tràn đè lên ảnh
    const minS = g.every(b => b.size > 0.03 * H) ? 0.45 : 0.68;
    outer:
    // Ưu tiên GIỮ CỠ CHỮ: nén giãn dòng trước, chỉ thu nhỏ chữ khi giãn dòng đã tối thiểu
    for (let s = sMax; s >= minS - 1e-6; s -= 0.02) {
      // nén giãn dòng vừa phải (tối đa ~12%) rồi mới thu nhỏ chữ — tránh đoạn bị dồn dòng sát nhau trông chật
      for (const tight of [1, 0.96, 0.92, 0.88]) {
        const r = tryFit(s, tight);
        if (r.fits) { chosen = { s, ...r }; break outer; }
      }
    }
    let overflow = false;
    if (!chosen) {
      const r = tryFit(minS, 0.88);
      chosen = { s: minS, ...r };
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
    // Cỡ chữ chung cho các đoạn thân bài (như bản in). v8.3: trước đây lấy cỡ NHỎ NHẤT trong mọi đoạn → chỉ một đoạn
    // chật (thường là đoạn bị tách sai) là kéo CẢ TRANG xuống 72% → chữ nhỏ khắp trang. Nay lấy mức chung của đa số
    // (phân vị 30%, không dưới 0.85); đoạn nào thật sự cần nhỏ hơn thì tự thu nhỏ riêng.
    const sorted = [...ss].sort((x, y) => x - y);
    // v10.0: các nhóm chênh nhau ít (≤ 0,16) → cùng MỘT cỡ (nhỏ nhất), như bản in; chênh nhiều mới dùng mức chung
    const spread = sorted[sorted.length - 1] - sorted[0];
    const shared = spread <= 0.16 ? sorted[0] : Math.max(0.85, sorted[Math.floor(0.3 * (sorted.length - 1))]);
    for (const i of bodyIdx) {
      if (fitted[i].s > shared + 0.005) fitted[i] = fitGroup(groups[i], shared);
    }
  }
  // Ô bảng (có "bạn cùng hàng"): mọi ô cùng cỡ gốc dùng chung một cỡ chữ
  // v10.4: bảng có đường kẻ → CẢ BẢNG một cỡ chữ (cỡ nhỏ nhất mà mọi ô vừa khung, không dưới 62%); trước đây mỗi ô tự co
  // nên ô dài chữ tí hon cạnh ô ngắn chữ to (CT tim tr.44, 56, 57)
  // v10.4: bảng không đường kẻ có cột ô dài (≥ 5 ô cùng mép trái, cùng cỡ — danh mục chữ viết tắt) cũng một cỡ chung cả cột
  const colKey = (g: LayoutBlock[]) => `rc${Math.round(g[0].x0 / (3 * g[0].size))}`;
  const colCount = new Map<string, number>();
  groups.forEach(g => { if (g.some(b => rowMate.has(b.id)) && !g.some(b => b.tableId) && g[0].align !== 'right') colCount.set(colKey(g), (colCount.get(colKey(g)) || 0) + 1); });
  const pseudoTid = (g: LayoutBlock[]) => g.some(b => rowMate.has(b.id)) && g[0].align !== 'right' && (colCount.get(colKey(g)) || 0) >= 5 ? colKey(g) : undefined;
  const cellIdx = groups.map((g, i) => i).filter(i => (groups[i].some(b => rowMate.has(b.id)) && (!fitted[i].overflow || pseudoTid(groups[i]))) || groups[i].some(b => b.tableId));
  const cellSizes = new Map<string, number[]>();
  for (const i of cellIdx) {
    const tid = groups[i].find(b => b.tableId)?.tableId ?? pseudoTid(groups[i]);
    // v10.6: bảng có kẻ → cỡ chung theo TỪNG CỘT (cột mô tả ngắn không bị kéo nhỏ theo cột số liệu dài; CT tim tr.237)
    const colOf = tid && tid.startsWith('r') ? `|c${Math.round(groups[i][0].x0 / (2 * groups[i][0].size))}` : '';
    const k = tid ? `${tid}${colOf}|${Math.round(groupSize(groups[i]))}` : String(Math.round(groupSize(groups[i])));
    (cellSizes.get(k) || cellSizes.set(k, []).get(k)!).push(i);
  }
  cellSizes.forEach((list, key) => {
    if (list.length < 2) return;
    // (ô tràn — không vừa ở cỡ nào — không quyết định cỡ chung nhưng vẫn vẽ cùng cỡ chung với cả bảng)
    // v10.8: hàng tiêu đề bảng (hàng trên cùng) không quyết định cỡ chung của cột (ô tiêu đề dài tự thu nhỏ riêng)
    const tid0 = groups[list[0]].find(b => b.tableId)?.tableId;
    const tTop = tid0 ? Math.min(...blocks.filter(b => b.tableId === tid0).map(b => b.top)) : -Infinity;
    const notHead = list.filter(i => groups[i][0].top > tTop + 0.5 * groups[i][0].size);
    const okList = (notHead.length >= 2 ? notHead : list).filter(i => !fitted[i].overflow);
    if (!okList.length) return;
    // v10.6: cỡ THỰC đã vẽ (khối 1 dòng hết chỗ bên dưới được thu nhỏ riêng → nhỏ hơn s của nhóm)
    const eff = (i: number) => Math.min(fitted[i].s, ...fitted[i].los.map((lo, k) => lo.size / groups[i][k].size));
    const cs = okList.map(eff).sort((x, y) => x - y);
    // (một ô quá dài không kéo cả bảng xuống: cỡ chung không thấp hơn mức của đa số ô quá 0,2 — ô đó tự thu nhỏ thêm)
    // v10.6: bảng có kẻ: tính cả ô tràn (đã ở cỡ nhỏ nhất) — trước đây cột toàn ô tràn chỉ còn vài nhóm vừa khung quyết
    // định cỡ chung → nhóm đó chữ to, các dòng cạnh bên chữ nhỏ (CT tim tr.237 "Aortic Vmax…")
    const csAll = (notHead.length >= 2 ? notHead : list).map(eff).sort((x, y) => x - y);
    const shared = key.startsWith('r')
      ? Math.max(0.68, Math.max(csAll[0], Math.min(cs[Math.floor(0.5 * (cs.length - 1))], csAll[Math.floor(0.5 * (csAll.length - 1))]) - 0.1))
      : Math.max(0.85, cs[Math.floor(0.3 * (cs.length - 1))]);
    for (const i of list) if (fitted[i].s > shared + 0.005 && (!key.startsWith('r') || Math.max(...fitted[i].los.map((lo, k) => lo.size / groups[i][k].size)) > shared + 0.005)) fitted[i] = fitGroup(groups[i], shared);
  });

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
  // v10.4: ô bảng không vừa chỗ dưới (bản dịch thêm dòng, sát đường kẻ hàng) → dồn lên chỗ trống phía trên trong cùng ô
  // (mục trên đã ngắn đi) thay vì tràn đè qua đường kẻ sang hàng dưới (CT tim tr.56 "Wheezing/bronchospasm…")
  let cellRules: HRule[] | null = null;
  for (const p of plans) {
    const b = p.orig;
    if (!b.tableId) continue;
    const inf = info.get(b.id)!;
    const limitBottom = b.bottom + inf.free;
    const h = p.lo.height;
    if (p.top + h <= limitBottom + 1) continue;
    let floor = -Infinity;
    for (const q of plans) {
      if (q === p || q.top >= p.top || Math.min(q.x0 + q.width, p.x0 + p.width) - Math.max(q.x0, p.x0) <= 0) continue;
      floor = Math.max(floor, q.top + q.lo.height + 0.2 * b.size);
    }
    for (const o of blocks) { // chữ giữ nguyên / đường kẻ phía trên trong cột
      if (o === b || o.bottom > b.top || plans.some(q => q.orig === o)) continue;
      if (Math.min(o.x1, p.x0 + p.width) - Math.max(o.x0, p.x0) > 0) floor = Math.max(floor, o.bottom + 0.2 * b.size);
    }
    // v10.7: không dồn lên qua ĐƯỜNG KẺ HÀNG phía trên ô (trước đây nội dung ô bị đẩy sang hàng trên — Bảng 22.3 CT tim tr.299)
    if (cleanOk) {
      if (!cellRules) cellRules = findHRules(clean!);
      for (const r of cellRules) if (r.y <= b.top + 0.1 * b.size && r.x0 < p.x0 + p.width && r.x1 > p.x0 && r.y > floor - 0.2 * b.size) floor = r.y + 0.2 * b.size;
    }
    if (floor === -Infinity) continue;
    const nt = Math.max(floor, limitBottom - h);
    if (nt < p.top - 0.5) p.top = nt;
  }

  /* --- Dòng mục lục / ô bảng phải thu nhỏ riêng để giữ 1 dòng → đồng bộ: cùng cỡ gốc thì cùng cỡ vẽ --- */
  {
    // v10.3: dòng đơn cùng cỡ + cùng kiểu chữ, không phải cỡ thân bài (tên tác giả in nghiêng dưới mỗi mục lục, nhãn
    // chú giải) → cùng cỡ vẽ; trước đây dòng dài bị thu nhỏ còn dòng ngắn giữ cỡ gốc, to nhỏ xen kẽ
    const lineClass = (p: typeof plans[number]) => p.orig.lineCount === 1 && !/^(<\d+>)?\s*(fig\.?|figure|table|tab\.|bảng|hình)\s*\d/i.test(p.orig.text) && (p.orig.italic || Math.abs(p.orig.size - bodySize) > 0.06 * bodySize) &&
      (info.get(p.orig.id)?.words.length ?? 99) <= 24 ? `line${p.orig.italic ? 'i' : ''}` : '';
    // v10.6: ô bảng có kẻ → theo bảng + cột (cả dòng in đậm "Mild AS:" và các dòng số liệu không có ô cùng hàng);
    // trước đây chỉ ô có "bạn cùng hàng" được đồng bộ → dòng số liệu chữ to cạnh dòng khác chữ nhỏ (CT tim tr.237)
    const classOf = (p: typeof plans[number]) => p.orig.leader ? 'toc'
      : p.orig.tableId ? `tbl${p.orig.tableId}c${Math.round(p.orig.x0 / (2 * p.orig.size))}`
      : rowMate.has(p.orig.id) ? 'cell' : lineClass(p);
    const buckets = new Map<string, typeof plans>();
    for (const p of plans) {
      const c = classOf(p);
      if (!c) continue;
      const k = `${c}|${Math.round(p.orig.size)}|${c.startsWith('tbl') ? '' : p.orig.bold}`;
      (buckets.get(k) || buckets.set(k, []).get(k)!).push(p);
    }
    // v10.8: hàng tiêu đề bảng (hàng trên cùng của bảng) không quyết định cỡ chung của cột — ô tiêu đề dịch dài ("Atypical
    // angina" → "Đau thắt ngực không điển hình") tự thu nhỏ riêng; trước đây kéo cả cột chữ nhỏ (CT tim tr.44)
    const tblTop = new Map<string, number>();
    for (const p of plans) if (p.orig.tableId) tblTop.set(p.orig.tableId, Math.min(tblTop.get(p.orig.tableId) ?? Infinity, p.orig.top));
    const targetOf = (list0: typeof plans, key: string) => {
      const body = key.startsWith('tbl') ? list0.filter(p => p.orig.top > (tblTop.get(p.orig.tableId!) ?? -Infinity) + 0.5 * p.orig.size) : list0;
      const list = body.length >= 2 ? body : list0;
      const scales = list.map(p => p.lo.size / p.orig.size);
      // cỡ chung gần mức phổ biến; dòng nào buộc phải nhỏ hơn hẳn giữ cỡ riêng (không kéo cả nhóm xuống)
      // Chênh lệch nhỏ (≤ 0,2) → mọi dòng cùng một cỡ (cỡ nhỏ nhất), như bản in; chỉ dòng nhỏ hơn hẳn mới giữ cỡ riêng
      const mn = Math.min(...scales), md = median(scales);
      // v10.7: bảng → ưu tiên cỡ gần bản gốc: cỡ chung theo mức của ĐA SỐ ô (phân vị 30%), ô chật hơn tự thu nhỏ riêng;
      // trước đây lấy cỡ nhỏ nhất nên một ô dài kéo cả bảng xuống chữ tí hon (CT tim tr.217, 236, 237)
      if (key.startsWith('tbl')) { const ss = [...scales].sort((x, y) => x - y); return Math.max(0.68, md - mn <= 0.1 ? mn : Math.max(mn, ss[Math.floor(0.5 * (ss.length - 1))] - 0.1)); }
      return Math.max(0.68, md - mn <= 0.2 ? mn : md - 0.08);
    };
    // v10.6: các cột của cùng một bảng không chênh nhau quá 0,12 (cột ngắn được to hơn chút, không to hẳn)
    // v10.10: 0,12 → 0,06: cột đầu chữ to hẳn cạnh cột thuốc chữ nhỏ trông lệch (Bảng 5.8 CT tim tr.57)
    const tblMin = new Map<string, number>();
    buckets.forEach((list, key) => {
      if (!key.startsWith('tbl') || list.length < 2) return;
      const t = key.slice(0, key.indexOf('c', 3));
      tblMin.set(t, Math.min(tblMin.get(t) ?? Infinity, targetOf(list, key)));
    });
    buckets.forEach((list, key) => {
      if (list.length < (key.startsWith('line') ? 4 : 2)) return;
      let target = targetOf(list, key);
      if (key.startsWith('tbl')) target = Math.min(target, (tblMin.get(key.slice(0, key.indexOf('c', 3))) ?? target) + 0.06);
      for (const p of list) {
        const sc = p.lo.size / p.orig.size;
        if (sc <= target + 0.01) continue;
        const inf = info.get(p.b.id)!;
        const lo = layoutWords(m, inf.words, p.b, inf.base, p.width, p.orig.size * target, p.lo.lineH / p.lo.size);
        if (lo.lines.length <= p.lo.lines.length) p.lo = lo;
      }
    });
  }

  /* --- v10.3: chú thích / đoạn chạy 2 cột cạnh nhau (cùng mép trên, cùng cỡ, hai cột kề nhau) → cùng cỡ vẽ: trước đây nửa
   *     phải chú thích "Fig. 17.4 …" thiếu chỗ bị thu nhỏ còn 75% trong khi nửa trái giữ nguyên cỡ --- */
  for (const p of plans) {
    if (p.orig.lineCount < 2 || p.orig.size >= 0.97 * bodySize) continue; // (chỉ chữ nhỏ hơn thân bài: chú thích, ghi chú)
    const sib = plans.find(q => q !== p && q.orig.lineCount >= 2 && Math.abs(q.orig.top - p.orig.top) < 0.4 * p.orig.size &&
      Math.abs(q.orig.size - p.orig.size) < 0.05 * p.orig.size && q.orig.serif === p.orig.serif &&
      (q.orig.x0 >= p.orig.x1 || q.orig.x1 <= p.orig.x0) && Math.min(Math.abs(q.orig.x0 - p.orig.x1), Math.abs(p.orig.x0 - q.orig.x1)) < 3 * p.orig.size);
    if (!sib) continue;
    const sp = p.lo.size / p.orig.size, sq = sib.lo.size / sib.orig.size;
    if (sp <= sq + 0.01) continue;
    const inf = info.get(p.b.id)!;
    const lo = layoutWords(m, inf.words, p.b, inf.base, p.width, p.orig.size * sq, p.lo.lineH / p.lo.size);
    if (lo.height <= p.lo.height + 0.5) p.lo = lo;
  }

  /* --- v10.3: hai khối KHÁC nhóm cùng giành một khoảng trống → chồng chữ (CT tr.220: chú thích bảng nới sang phải
   *     đúng chỗ cột phải bị đẩy xuống). Khối nới rộng quay về khổ gốc và thu nhỏ; còn chồng thì khối phía trên thu nhỏ. --- */
  {
    const rectOf = (p: typeof plans[number]) => {
      const inf = info.get(p.b.id)!;
      const sp = m.width(' ', fontCss(inf.base, p.b.serif, p.lo.size)) * (p.b.hScale || 1);
      const nat = Math.max(0, ...p.lo.lines.map(ln => ln.reduce((a, w) => a + wordWidth(m, w, p.b.serif, p.lo.size, p.b.hScale || 1), 0) + sp * Math.max(0, ln.length - 1)));
      const w = p.b.align === 'justify' && p.lo.lines.length > 1 ? p.width : Math.min(p.width, nat);
      const x0 = p.b.align === 'right' ? p.x0 + p.width - w : p.b.align === 'center' ? p.x0 + (p.width - w) / 2 : p.x0;
      return { x0, x1: x0 + w, y0: p.top, y1: p.top + p.lo.height };
    };
    const hitOf = (a: ReturnType<typeof rectOf>, b: ReturnType<typeof rectOf>, sz: number) =>
      Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) > 0.3 * sz && Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) > 0.25 * sz;
    const refit = (p: typeof plans[number], width: number, x0: number, maxH: number) => {
      const inf = info.get(p.b.id)!;
      const ratio = p.lo.lineH / p.lo.size;
      for (let sc = p.lo.size / p.orig.size; sc >= 0.6 - 1e-6; sc -= 0.03) {
        const lo = layoutWords(m, inf.words, p.b, inf.base, width, p.orig.size * sc, ratio);
        if (lo.height <= maxH + 0.5) { p.lo = lo; p.x0 = x0; p.width = width; return true; }
      }
      return false;
    };
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < plans.length; i++) for (let j = 0; j < plans.length; j++) {
        if (i === j) continue;
        const p = plans[i], q = plans[j];
        if (groupOf.get(p.orig.id) === groupOf.get(q.orig.id)) continue;
        const sz = Math.min(p.lo.size, q.lo.size);
        if (!hitOf(rectOf(p), rectOf(q), sz)) continue;
        const ow = p.orig.x1 - p.orig.x0;
        if (p.width > ow + 0.5 * p.orig.size) {
          // p được nới ngang → quay về khổ gốc
          refit(p, Math.max(ow, 2 * p.orig.size), p.orig.x0, Math.max(p.lo.height, p.orig.bottom - p.orig.top));
        } else if (p.top < q.top && p.top + p.lo.height > q.top) {
          // p nằm trên và dài xuống đè q → thu nhỏ p cho vừa tới đầu q
          refit(p, p.width, p.x0, q.top - 0.15 * q.lo.size - p.top);
        }
      }
    }
  }

  /* --- Giữ lại các khối không dịch (số mục "1.1", số trang, ký hiệu…) nằm lọt trong vùng sẽ xoá --- */
  const targetIds = new Set(targets.map(t => t.id));
  const keepPatches: { patch: ImageData; x: number; y: number }[] = [];
  for (const o of blocks) {
    if (targetIds.has(o.id) || companionIds.has(o.id)) continue;
    // Chỉ giữ số mục / số trang / ký hiệu nhỏ. KHÔNG giữ khối OCR (chữ trong hình — khung AI ước lượng, có thể
    // cao/rộng lấn sang chữ thường) và khối nhiều dòng: trước đây việc "giữ lại" chép trả cả dải chữ gốc tiếng Anh
    // đè lên bản dịch (vd. dải đầu dòng ở cột trái trang có ảnh siêu âm).
    if (o.fromOcr || o.rotate || o.bottom - o.top > 2.2 * o.size || o.x1 - o.x0 > 12 * o.size) continue;
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
  const scrubJobs: (() => void)[] = [];
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
      let ceiling = Math.max(0, b.top - 1.0 * b.size);
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
    if (cleanOk) top = Math.max(Math.min(top, b.top - 0.3 * b.size), 0); // nền thật → nới rộng an toàn (khối khác được khôi phục)
    // Mép trái/phải theo mực thật: chữ đậm / chữ nghiêng / khoảng cách chữ của font gốc có thể in tràn ra ngoài
    // độ rộng PDF khai báo → còn sót nét cuối chữ (vd. vệt "┌" của chữ T cuối tiêu đề)
    let left = Math.min(b.x0, plan.x0) - padX, right = Math.max(b.x1, plan.x0 + plan.width) + padX;
    {
      const bg = inf.stats.bg, d = img.data;
      const ya2 = Math.max(0, Math.floor(b.top)), yb2 = Math.min(H, Math.ceil(b.bottom));
      let limR = right + 0.8 * b.size, limL = left - 0.8 * b.size;
      for (const o of blocks) {
        if (o === b || o.bottom <= b.top || o.top >= b.bottom) continue;
        if (o.x0 >= b.x1 - 1) limR = Math.min(limR, o.x0 - 1);
        if (o.x1 <= b.x0 + 1) limL = Math.max(limL, o.x1 + 1);
      }
      const colInk = (x: number) => {
        if (x < 0 || x >= W) return false;
        for (let y = ya2; y < yb2; y++) {
          const i = (y * W + x) * 4;
          if (Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b) > 90) return true;
        }
        return false;
      };
      // chỉ nới khi mực liền với chữ (không vươn sang hình / đường kẻ cách xa). Nhãn trong hình: không nới (mực xung
      // quanh là nét vẽ / ảnh, nới ra sẽ xoá mất mũi tên, đường viền)
      if (!b.figLabel) {
        for (let x = Math.ceil(right); x < limR && colInk(x); x++) right = x + 2;
        for (let x = Math.floor(left); x > limL && colInk(x); x--) left = x - 1;
      }
    }
    erase(left, top, right - left, bottom - top, inf.stats.bg, b.size, !!b.figLabel);
    // v10.6: gạch chân của bản gốc (đường vector) còn nguyên trong nền "không chữ" → sau khi chữ dịch chảy lại, nét gạch
    // nằm giữa dòng mới trông như gạch ngang chữ. Xoá các nét ngang mảnh nằm gọn trong khối (không chạy ra ngoài như kẻ bảng).
    if (!b.tableId && !b.figLabel && !b.rotate && !b.fromOcr && b.translatable) {
      const bx = { b, x0: Math.max(left, b.x0 - 0.3 * b.size), y0: top, x1: Math.min(right, b.x1 + 0.3 * b.size), y1: Math.max(bottom, b.bottom + 0.35 * b.size), bg: inf.stats.bg };
      scrubJobs.push(() => scrubUnderlines(bx.b, bx.x0, bx.y0, bx.x1, bx.y1, bx.bg)); // chạy sau khi xoá hết (khối kề chép lại nền)
    }
    if (b.dropCap) {
      const dc = b.dropCap;
      erase(dc.x - 0.08 * dc.size, dc.baseline - 0.82 * dc.size, dc.w + 0.1 * dc.size, 0.92 * dc.size, inf.stats.bg, b.size);
    }
  }
  for (const f of scrubJobs) f();
  for (const k of keepPatches) ctx.putImageData(k.patch, k.x, k.y);

  /* --- Dời ký hiệu đầu dòng theo mục (sao chép nguyên điểm ảnh gốc) --- */
  const moves = plans
    // v10.0: canh theo GIỮA dòng đầu của mục (chữ dịch nhỏ hơn gốc → ký hiệu trước đây bị lệch xuống dưới dòng chữ)
    .map(p => ({ c: companion.get(p.b.id), shift: Math.round(p.top + 0.55 * p.lo.size - (p.b.top + 0.55 * p.b.size)) }))
    .filter((m): m is { c: NonNullable<typeof m.c>; shift: number } => !!m.c && Math.abs(m.shift) >= 1);
  for (const m of moves) { // lượt 1: xoá hết vị trí cũ
    erase(m.c.x, m.c.y, m.c.patch.width, m.c.patch.height, m.c.bg);
  }
  for (const m of moves) ctx.putImageData(m.c.patch, m.c.x, m.c.y + m.shift); // lượt 2: đặt vào vị trí mới

  /* --- Vẽ --- */
  textSink = report.textRuns!;
  // Khối giữ nguyên chữ gốc (tài liệu tham khảo, số, tên riêng…) cũng đưa vào lớp chữ ẩn để tìm kiếm được
  const paintedIds = new Set(plans.map(p => p.orig.id));
  for (const b of allBlocks) {
    if (paintedIds.has(b.id) || b.rotate || !b.plain?.trim()) continue;
    textSink.push({ x: b.x0, y: b.top + 0.9 * b.size, w: Math.max(1, b.x1 - b.x0), size: b.size, text: b.plain.replace(/\s+/g, ' ').trim() });
  }
  // Đầu dò kiểm thử tự động (chỉ khi bộ kiểm thử bật globalThis.__LAYOUT_PROBE; app thật không bật)
  const probe = (globalThis as any).__LAYOUT_PROBE as any[] | undefined;
  if (probe) {
    const sp = new Measurer(ctx);
    probe.push({
      W, H, groups: groups.map(g => g.map(b => b.id + (rowMate.has(b.id) ? '*' : '') + (companion.has(b.id) ? '+' : ''))),
      plans: plans.map(p => {
        const inf = info.get(p.b.id)!;
        const fills = p.lo.lines.map((ln, li) => {
          const ww = ln.reduce((a, wd) => a + wordWidth(sp, wd, p.b.serif, p.lo.size, p.b.hScale || 1), 0);
          return +(ww / Math.max(1, p.width - (li === 0 ? 0 : 0))).toFixed(3);
        });
        return {
          id: p.orig.id, t: p.orig.plain.slice(0, 50), os: +p.orig.size.toFixed(1), s: +p.lo.size.toFixed(1), ol: p.orig.lineCount, l: p.lo.lines.length,
          x: Math.round(p.x0), y: Math.round(p.top), w: Math.round(p.width), h: Math.round(p.lo.height), lh: +(p.lo.lineH / p.lo.size).toFixed(2),
          ox: Math.round(p.orig.x0), oy: Math.round(p.orig.top), ow: Math.round(p.orig.x1 - p.orig.x0), oh: Math.round(p.orig.bottom - p.orig.top),
          al: p.b.align, bold: p.orig.bold, fills, words: inf.words.length, split: inf.words.filter(wd => wordWidth(sp, wd, p.b.serif, p.lo.size, p.b.hScale || 1) > p.width + 0.5).length, cap: !!/^(fig\.?|figure|table|hình|bảng)\s*[\dA-Z]/i.test(p.orig.plain.trim()),
        };
      }),
      kept: allBlocks.filter(b => !plans.some(p => p.orig.id === b.id) && !b.rotate).map(b => ({ t: b.plain.slice(0, 30), x: Math.round(b.x0), y: Math.round(b.top), w: Math.round(b.x1 - b.x0), h: Math.round(b.bottom - b.top), s: +b.size.toFixed(1) })),
      overflow: report.overflowIds.length,
    });
  }
  try {
  for (const p of plans) {
    const inf = info.get(p.b.id)!;
    ctx.save();
    drawLaidOut(ctx, m, p.lo, p.b, inf.base, p.x0, p.width, p.top);
    if (inf.capChar && p.b.dropCap) {
      const dc = p.b.dropCap;
      ctx.font = fontCss({ bold: dc.bold, italic: false, color: null }, dc.serif, dc.size);
      const c = dc.color && !isDark(dc.color) ? dc.color : (inf.base.color ?? dc.color);
      ctx.fillStyle = c ? rgbCss(c) : '#1a1a1a';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(inf.capChar, dc.x, dc.baseline);
    }
    ctx.restore();
    report.painted++;
  }
  } finally {
    textSink = null; // chữ xoay không đưa vào lớp chữ (toạ độ đã bị xoay)
  }

  /* --- Chữ xoay 90° (nhãn dọc trên hình, chữ dọc lề trang) --- */
  for (const b0 of rotatedTargets) {
    // v9.6: bản dịch dài hơn chữ gốc (tab dọc "MAMMOGRAPHY") → dùng thêm phần nền trống liền màu phía trên/dưới
    // thay vì thu chữ nhỏ tới mức không đọc được
    let b = b0;
    {
      const st0 = regionStats(img, b0.x0, b0.top, b0.x1, b0.bottom);
      const len0 = b0.bottom - b0.top;
      const rowClear = (y: number) => {
        if (y < 0 || y >= img.height) return false;
        for (let x = Math.max(0, Math.floor(b0.x0)); x < Math.min(img.width, Math.ceil(b0.x1)); x++) {
          const i = (y * img.width + x) * 4;
          if (Math.abs(img.data[i] - st0.bg.r) + Math.abs(img.data[i + 1] - st0.bg.g) + Math.abs(img.data[i + 2] - st0.bg.b) > 36) return false;
        }
        return true;
      };
      const reachMax = 0.6 * len0;
      let up = 0, dn = 0;
      while (up < reachMax && rowClear(Math.floor(b0.top - 1 - up))) up++;
      while (dn < reachMax && rowClear(Math.ceil(b0.bottom + dn))) dn++;
      const ext = Math.max(0, Math.min(up, dn) - 0.4 * b0.size); // mở đều hai phía để chữ vẫn ở giữa
      if (ext > 0) b = { ...b0, top: b0.top - ext, bottom: b0.bottom + ext };
    }
    const len = b.bottom - b.top;          // chiều dài dòng (theo chiều dọc trang)
    const thick = b.x1 - b.x0;             // độ dày khối (theo chiều ngang trang)
    if (len < 4 || thick < 3) continue;
    const pad = 0.12 * b.size;
    const stats = regionStats(img, b.x0 - pad, b.top - pad, b.x1 + pad, b.bottom + pad);
    let rfg = stats.fg ?? b.baseStyle.color;
    if (b.fromOcr) rfg = deepenScanInk(rfg, stats.bg) ?? rfg;
    const base: RunStyle = { ...b.baseStyle, color: rfg };
    const words = parseRich(translations[b.id], b, base);
    // Khối ảo nằm ngang: rộng = chiều dài, cao = độ dày
    const vb: LayoutBlock = { ...b, x0: 0, x1: len, top: 0, bottom: thick, rotate: undefined, leader: undefined, bodyRight: undefined };
    let lo: LaidOut | null = null;
    let fitted = false;
    for (let sc = 1; sc >= 0.5 - 1e-6; sc -= 0.03) {
      lo = layoutWords(m, words, vb, base, len, b.size * sc, 1.12);
      if ((lo.height <= thick + 0.5 || (b.lineCount <= 1 && lo.lines.length === 1)) && lo.lines.every(line => line.reduce((w, wd) => w + wordWidth(m, wd, b.serif, b.size * sc), 0) <= len + 0.5)) { fitted = true; break; }
    }
    if (!lo) continue;
    if (!fitted) report.overflowIds.push(b.id);
    erase(b.x0 - pad, b.top - pad, thick + 2 * pad, len + 2 * pad, stats.bg);
    ctx.save();
    if (b.rotate === 'up') { ctx.translate(b.x0, b.bottom); ctx.rotate(-Math.PI / 2); }
    else { ctx.translate(b.x1, b.top); ctx.rotate(Math.PI / 2); }
    const offset = (thick - lo.height) / 2; // canh giữa theo độ dày (chữ dọc to hơn khung một chút vẫn cân giữa)
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
/**
 * v9.6.1: dải chữ dọc thật quanh khung AI (nới 60% bề ngang mỗi bên): cột có mực tối hơn nền rõ rệt → mép trái/phải
 * của chữ; hàng có mực → đầu/cuối dòng. Trả null nếu không thấy chữ.
 */
function inkStripVertical(img: ImageData, X0: number, Y0: number, X1: number, Y1: number) {
  const W = img.width, H = img.height, d = img.data;
  const w = X1 - X0;
  const xa = Math.max(0, Math.floor(X0 - 0.6 * w)), xb = Math.min(W, Math.ceil(X1 + 0.6 * w));
  const ya = Math.max(0, Math.floor(Y0 - 0.1 * (Y1 - Y0))), yb = Math.min(H, Math.ceil(Y1 + 0.1 * (Y1 - Y0)));
  if (xb - xa < 3 || yb - ya < 6) return null;
  const st = regionStats(img, xa, ya, xb, yb);
  const bgL = 0.299 * st.bg.r + 0.587 * st.bg.g + 0.114 * st.bg.b;
  const ink = (x: number, y: number) => { const i = (y * W + x) * 4; return bgL - (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) > 60; };
  const cols: number[] = [];
  for (let x = xa; x < xb; x++) { let c = 0; for (let y = ya; y < yb; y++) if (ink(x, y)) c++; cols.push(c); }
  // cột toàn mực (mép ảnh, đường kẻ) không phải chữ
  const thr = Math.max(2, 0.02 * (yb - ya));
  const isTxt = (c: number) => c >= thr && c < 0.85 * (yb - ya);
  // cụm cột chữ dài nhất gần tâm khung
  let best: { a: number; b: number; mass: number } | null = null;
  for (let i = 0; i < cols.length;) {
    if (!isTxt(cols[i])) { i++; continue; }
    let j = i, mass = 0, gap = 0;
    while (j < cols.length && (isTxt(cols[j]) || gap < 2)) { if (isTxt(cols[j])) { gap = 0; mass += cols[j]; } else gap++; j++; }
    const a = xa + i, b = xa + j - gap;
    const cx = (a + b) / 2, near = Math.abs(cx - (X0 + X1) / 2) < 0.6 * w + 4;
    if (near && (!best || mass > best.mass)) best = { a, b, mass };
    i = j;
  }
  if (!best || best.b - best.a < 3) return null;
  let top = yb, bottom = ya, runs = 0, runSum = 0;
  for (let y = ya; y < yb; y++) {
    let any = false, run = 0;
    for (let x = best.a; x <= best.b; x++) {
      if (ink(x, y)) { any = true; run++; } else { if (run >= 1) { runSum += run; runs++; } run = 0; }
    }
    if (run >= 1) { runSum += run; runs++; }
    if (any) { if (y < top) top = y; bottom = y; }
  }
  if (bottom <= top) return null;
  // độ dày nét theo chiều ngang của chữ dọc ≈ ước lượng nét dọc (để nhận chữ đậm)
  let vSum = 0, vN = 0;
  for (let x = best.a; x <= best.b; x += 1) {
    let run = 0;
    for (let y = top; y <= bottom + 1; y++) {
      if (y <= bottom && ink(x, y)) run++; else { if (run >= 1 && run < 0.6 * (best.b - best.a + 1)) { vSum += run; vN++; } run = 0; }
    }
  }
  return { x0: best.a, x1: best.b + 1, top, bottom: bottom + 1, stroke: vN ? vSum / vN : 0 };
}

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
  /** v9.6: chỉ nhãn đầu khối in đậm ("Figure 1"). */
  bold_lead?: boolean;
}

/**
 * Khối OCR → LayoutBlock. Khung AI trả về chỉ gần đúng → tinh chỉnh theo mực thật trên ảnh
 * (chỉ trong phạm vi nhỏ quanh khung, không lấn sang cột / tiêu đề bên cạnh):
 * mép trên/dưới sát chữ; số dòng và khoảng cách dòng đo bằng hình chiếu ngang (tách dòng tại "thung lũng" mực).
 */
export function blocksFromOcr(ctx: CanvasRenderingContext2D, ocr: OcrBlock[], idPrefix = 'b', items: NormItem[] = []): LayoutBlock[] {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  const out: LayoutBlock[] = [];

  // Khung AI (pixel)
  type Pre = { o: OcrBlock; X0: number; X1: number; Y0: number; Y1: number; rotate?: 'up' | 'down'; pitch: number; idx: number };
  const pre: Pre[] = [];
  const withText = ocr.filter(o => o?.text?.trim());
  const dirShare = withText.length >= 6 ? withText.filter(o => /^(up|down)$/i.test(String(o.dir || ''))).length / withText.length : 0;
  for (let idx = 0; idx < ocr.length; idx++) {
    const o = ocr[idx];
    if (!o || !Array.isArray(o.box_2d) || o.box_2d.length !== 4 || !o.text?.trim()) continue;
    let [ymin, xmin, ymax, xmax] = o.box_2d.map(Number);
    if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) continue;
    if (ymin > ymax) [ymin, ymax] = [ymax, ymin];
    if (xmin > xmax) [xmin, xmax] = [xmax, xmin];
    let X0 = Math.max(0, xmin / 1000 * W), X1 = Math.min(W, xmax / 1000 * W);
    let Y0 = Math.max(0, ymin / 1000 * H), Y1 = Math.min(H, ymax / 1000 * H);
    if (X1 - X0 < 3) continue;
    if (Y1 - Y0 < 0.012 * H) { // khung AI quá thấp → nới thành ít nhất một dòng chữ
      const c = (Y0 + Y1) / 2;
      Y0 = Math.max(0, c - 0.006 * H); Y1 = Math.min(H, c + 0.006 * H);
    }
    // v11: dòng mục lục ("C. ARCHITECTURAL DISTORTION ....107") mà khung AI chỉ bao phần chữ (không gồm chấm dẫn + số
    // trang) → chấm dẫn và số trang gốc không bị xoá, nằm cạnh chấm dẫn/số trang vẽ lại (BI-RADS tr.ix: ".....107" hai lần).
    // Nới khung sang phải (và trái) theo mực thật trên đúng dải dòng đó, dừng khi gặp khoảng trống dài.
    // v11.2: model chỉ ghi chấm dẫn + số trang trong BẢN DỊCH ("v"), không có trong "text" (BI-RADS tr.10, gemini-2.5-flash-lite)
    // → trước đây không nhận là dòng mục lục: chấm dẫn/số trang gốc không bị xoá, vẽ lại lần nữa ("…225 · · · 225"), chữ gốc
    // đầu dòng còn sót ("E. ASSOCIAT")
    if ((LEADER_RE.test(o.text.replace(/\s+/g, ' ').trim()) || ocrLeaderInV(o)) && (Y1 - Y0) < 0.05 * H) {
      const yA = Math.round(Y0 + 0.15 * (Y1 - Y0)), yB = Math.round(Y1 - 0.15 * (Y1 - Y0));
      const colInk = (x: number) => {
        for (let y = yA; y <= yB; y++) { const i = (y * W + x) * 4; if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 150) return true; }
        return false;
      };
      const maxGap = Math.max(8, 2.5 * (Y1 - Y0));
      let last = Math.round(X1), gap = 0;
      for (let x = Math.round(X1); x < Math.min(W - 1, X1 + 0.6 * W); x++) {
        if (colInk(x)) { last = x; gap = 0; } else if (++gap > maxGap) break;
      }
      X1 = Math.min(W, last + 2);
      let first = Math.round(X0); gap = 0;
      for (let x = Math.round(X0) - 1; x > Math.max(0, X0 - 0.3 * W); x--) {
        if (colInk(x)) { first = x; gap = 0; } else if (++gap > maxGap) break;
      }
      X0 = Math.max(0, first - 2);
    } else if ((o.lines || 1) <= 1 && (Y1 - Y0) < 0.04 * H && !/^(up|down)$/i.test(String(o.dir || ''))) {
      // v11: khối 1 dòng mà khung AI hụt cuối dòng ("Độ sâu và/hoặc khoảng cách từ núm vú" còn sót "ple" của "nipple" —
      // BI-RADS tr.10) → nới mép phải theo mực liền mạch (khoảng trống < 0,8 chiều cao dòng, tức trong cùng một cụm từ)
      const yA = Math.round(Y0 + 0.2 * (Y1 - Y0)), yB = Math.round(Y1 - 0.2 * (Y1 - Y0));
      const colInk = (x: number) => {
        for (let y = yA; y <= yB; y++) { const i = (y * W + x) * 4; if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 140) return true; }
        return false;
      };
      const maxGap = Math.max(4, 0.8 * (Y1 - Y0));
      const ruleAt = (x: number) => { // đường kẻ dọc: mực phủ gần kín cả chiều cao dải dòng
        let n = 0;
        for (let y = Math.round(Y0); y <= Math.round(Y1); y++) { const i = (y * W + x) * 4; if (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2] < 160) n++; }
        return n > 0.9 * (Y1 - Y0 + 1);
      };
      let last = Math.round(X1), gap = 0;
      for (let x = Math.round(X1); x < Math.min(W - 1, X1 + 0.15 * W); x++) {
        if (ruleAt(x)) break;
        if (colInk(x)) { last = x; gap = 0; } else if (++gap > maxGap) break;
      }
      // chỉ nới khi phần mực tiếp theo ngắn (đuôi từ), không phải cả một cột chữ khác
      if (last - X1 > 0 && last - X1 < 6 * (Y1 - Y0)) X1 = Math.min(W, last + 2);
      // v11.2: … và mép trái (khung bắt đầu giữa từ, chữ gốc đầu dòng còn sót)
      let first = Math.round(X0); gap = 0;
      for (let x = Math.round(X0) - 1; x > Math.max(0, X0 - 0.15 * W); x--) {
        if (ruleAt(x)) break;
        if (colInk(x)) { first = x; gap = 0; } else if (++gap > maxGap) break;
      }
      if (X0 - first > 0 && X0 - first < 6 * (Y1 - Y0)) X0 = Math.max(0, first - 2);
    }
    const dir = String(o.dir || '').toLowerCase();
    let rotate: 'up' | 'down' | undefined = dir === 'up' ? 'up' : dir === 'down' ? 'down' : undefined;
    // v11: AI gắn "dir" cho chữ NGANG (BI-RADS tr.xvi: mọi khối, kể cả "Major Indication", đều "dir":"down") → cả trang vẽ
    // xoay dọc, chữ khổng lồ. Chữ xoay thật có khung cao hơn rộng; khung bẹt ngang thì bỏ "dir". Quá nửa số khối có "dir"
    // cũng là dấu hiệu model trả sai → bỏ hết.
    if (rotate && ((X1 - X0) > 1.2 * (Y1 - Y0) || dirShare > 0.5)) rotate = undefined;
    // v9.6: AI quên báo "dir" cho tab chữ dọc (khung cao, hẹp, một từ/cụm ngắn) → coi là chữ đọc từ dưới lên
    if (!rotate && (Y1 - Y0) > 3 * (X1 - X0) && (X1 - X0) < 0.06 * W && o.text.trim().length >= 4 && !/\s\S+\s\S+\s\S+\s/.test(o.text.trim())) rotate = 'up';
    const n = Math.max(1, Math.round(o.lines || 1));
    pre.push({ o, X0, X1, Y0, Y1, rotate, pitch: (rotate ? X1 - X0 : Y1 - Y0) / n, idx });
  }
  const horiz = pre.filter(p => !p.rotate);
  // v9.6.1: bản đồ ẢNH (ô lưới gần như không có nền giấy, không phải mảng xám đều) — điểm ảnh trong ảnh không được
  // tính là "mực" của khối chữ nằm trên giấy (chú thích sát ngay trên/dưới/cạnh nhũ ảnh)
  const PG = Math.max(4, Math.round(W / 420));
  const pgr = bigPhotoGrid(d, W, H, PG);
  const pgw = pgr?.gw ?? 1;
  const photoGrid = pgr?.grid ?? new Uint8Array(1);
  const inPhoto = (x: number, y: number) => !!pgr && photoGrid[((y / PG) | 0) * pgw + ((x / PG) | 0)] === 1;
  const photoShare = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0, p = 0;
    for (let y = y0; y < y1; y += PG) for (let x = x0; x < x1; x += PG) { n++; if (inPhoto(x, y)) p++; }
    return n ? p / n : 0;
  };
  const inkDensity = new Map<number, number>();
  const xOverlap = (a: Pre, b: Pre) => Math.min(a.X1, b.X1) - Math.max(a.X0, b.X0) > 0.3 * Math.min(a.X1 - a.X0, b.X1 - b.X0);

  for (const P of pre) {
    const { o, X0, X1, Y0, Y1, rotate } = P;
    let text = o.text.replace(/\s+/g, ' ').trim();
    // Dòng mục lục "Tên mục …… 123": dấu chấm dẫn + số trang vẽ riêng, căn phải như bản gốc
    let leaderNum: string | undefined;
    const lm = text.match(LEADER_RE);
    if (lm && !rotate) { text = lm[1].trim(); leaderNum = lm[2] || ''; }
    else if (!rotate && ocrLeaderInV(o)) leaderNum = (o.v || '').replace(/<\/?\d+>/g, '').replace(/\s+/g, ' ').trim().match(LEADER_RE)?.[2] || '';
    const al = String(o.align || '').toLowerCase();
    const base = {
      id: '', text, plain: text, styles: [] as RunStyle[],
      baseStyle: { bold: !!o.bold, italic: !!o.italic, color: null } as RunStyle,
      firstOffset: 0, restOffset: 0, bold: !!o.bold, italic: !!o.italic, serif: o.serif !== false,
      translatable: isTranslatableText(text), hScale: 1, fromOcr: true, srcIndex: P.idx,
    };
    if (rotate) {
      const n = Math.max(1, Math.round(o.lines || 1));
      let size = Math.max(5, (X1 - X0) / (1.2 * n - 0.15));
      let rx0 = X0, rx1 = X1, rt = Y0, rb = Y1;
      // v9.6.1: khung AI cho chữ dọc thường lệch / quá hẹp → chữ dịch bé tí. Đo lại theo MỰC THẬT: dải cột có mực
      // = chiều cao chữ (chữ IN HOA ≈ 0,71 cỡ chữ), hàng có mực = chiều dài dòng.
      if (n === 1) {
        const r = inkStripVertical(img, X0, Y0, X1, Y1);
        if (r) {
          const capsT = text === text.toUpperCase() && /\p{Lu}/u.test(text);
          size = Math.max(5, (r.x1 - r.x0) / (capsT ? 0.72 : 0.95));
          rx0 = r.x0 - 0.16 * size; rx1 = r.x1 + 0.16 * size;
          rt = r.top - 0.1 * size; rb = r.bottom + 0.1 * size;
          if (!o.bold && r.stroke > 0.13 * size) { base.bold = true; base.baseStyle = { ...base.baseStyle, bold: true }; }
        }
      }
      out.push({ ...base, x0: rx0, x1: rx1, top: rt, bottom: rb, size, leading: size * 1.2, lineCount: n,
        align: (al === 'left' || al === 'right' || al === 'justify') ? al as BlockAlign : 'center', rotate });
      continue;
    }
    const st = regionStats(img, X0, Y0, X1, Y1);
    // Mực = đậm hơn nền rõ rệt (chữ tối trên nền sáng) hoặc sáng hơn hẳn (chữ sáng trên nền tối).
    // Không dùng "khác màu nền" vì vùng nền khác màu bên cạnh (lề trắng cạnh hình) sẽ bị nhầm là chữ.
    const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;
    const bgL = lum(st.bg.r, st.bg.g, st.bg.b);
    const darkText = bgL >= 110;
    const onPaper = darkText && photoShare(X0, Y0, X1, Y1) < 0.3;
    const ink = (x: number, y: number) => {
      if (onPaper && inPhoto(x, y)) return false;
      const i = (y * W + x) * 4;
      const L = lum(d[i], d[i + 1], d[i + 2]);
      return darkText ? bgL - L > 70 : L - bgL > 70;
    };
    // 1) Dòng chữ thật quanh khung (nới ±1,5 dòng để bắt dòng bị khung AI cắt hụt)
    const reach = Math.max(6, 2.5 * P.pitch);
    const xa = Math.max(0, Math.floor(X0)), xb = Math.min(W, Math.ceil(X1));
    // v9.6.1: vùng dò không được lấn vào ẢNH sát bên (chú thích ngay dưới nhũ ảnh): cột ảnh tối liền mạch bị coi là
    // "đường kẻ dọc" → gần hết cột bị loại → chữ dịch bị nhét vào cột hẹp tí hon, chữ gốc không được xoá.
    const rowPhoto = (y: number) => {
      let light = 0, n = 0;
      for (let x = xa; x < xb; x += 2) { const i = (y * W + x) * 4; if (lum(d[i], d[i + 1], d[i + 2]) >= bgL - 40) light++; n++; }
      return n > 0 && light < 0.3 * n;
    };
    let ya = Math.max(0, Math.floor(Y0 - reach)), yb = Math.min(H, Math.ceil(Y1 + reach));
    if (darkText) {
      let yy = Math.floor(Y0); while (yy > ya && !rowPhoto(yy - 1)) yy--; ya = yy;
      let yz = Math.ceil(Y1); while (yz < yb && !rowPhoto(yz)) yz++; yb = yz;
      while (ya < Y1 - 2 && rowPhoto(ya)) ya++; // khung AI đè lên mép ảnh
      while (yb > ya + 4 && yb > Y0 + 2 && rowPhoto(yb - 1)) yb--;
    }
    // Đường kẻ dọc của bảng nằm trong khung AI (khung OCR hay chạm/đè lên đường kẻ): cột mực chạy gần suốt vùng dò
    // → không phải chữ. Trước đây đường kẻ làm MỌI hàng đều "có mực" → tính sai vị trí dòng (chữ dịch dồn lên một
    // chỗ), mép trái dính vào đường kẻ, mật độ mực cao → bị nhận nhầm là chữ đậm.
    const ruleCols = new Set<number>();
    if (yb - ya > 1.5 * P.pitch) {
      // nét dọc liền mạch dài hơn 1,6 dòng chữ (nét chữ cao nhất chỉ ≈ 1 dòng) hoặc phủ gần hết vùng dò
      const minRun = Math.max(6, 1.6 * P.pitch);
      for (let x = xa; x < xb; x++) {
        let c = 0, run = 0, best = 0;
        for (let y = ya; y < yb; y++) {
          if (ink(x, y)) { c++; run++; if (run > best) best = run; } else run = 0;
        }
        if (best >= minRun || c > 0.85 * (yb - ya)) ruleCols.add(x);
      }
      // nét kẻ dày 1–3 px: bỏ cả điểm khử răng cưa sát bên
      for (const x of [...ruleCols]) for (let d = -2; d <= 2; d++) ruleCols.add(x + d);
    }
    const prof: number[] = [];
    for (let y = ya; y < yb; y++) { let c = 0; for (let x = xa; x < xb; x++) if (!ruleCols.has(x) && ink(x, y)) c++; prof.push(c); }
    // Đường kẻ ngang (khung viền, kẻ bảng): hàng gần như toàn mực → không phải chữ
    const hRules: number[] = [];
    for (let i = 0; i < prof.length; i++) if (prof[i] > 0.85 * (xb - xa - ruleCols.size)) { prof[i] = 0; hRules.push(ya + i); }
    // Ngưỡng thấp: dòng cuối rất ngắn ("etc.).") và chân chữ g/p/y vẫn được tính là dòng
    // (nhưng cao hơn nhiễu hạt trên ảnh siêu âm/scan: vài điểm lẻ mỗi hàng)
    const peakRow = Math.max(1, ...prof);
    const lowThr = Math.max(1, 0.004 * (xb - xa), 0.04 * peakRow);
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
      // Dòng nằm ngoài mọi khung → khối gần nhất
      const cands: { Q: Pre; dd: number }[] = [];
      for (const Q of horiz) {
        if (Q !== P && !xOverlap(P, Q)) continue;
        const dd = r.b < Q.Y0 ? Q.Y0 - r.b : r.a > Q.Y1 ? r.a - Q.Y1 : 0;
        // Có đường kẻ ngang ngăn giữa dòng chữ và khối (hàng khác của bảng) → không thuộc khối này
        const lo = Math.min(r.b, Q.Y0), hi = Math.max(r.a, Q.Y1);
        if (dd > 0 && hRules.some(y => y > Math.min(lo, hi) && y < Math.max(lo, hi) && (y < r.a || y > r.b) && (y < Q.Y0 || y > Q.Y1))) continue;
        // chỉ nhận dòng có chiều cao tương xứng cỡ chữ của khối (tiêu đề to không "ăn" dòng chữ nhỏ bên dưới)
        const rh = r.b - r.a + 1, qh = 0.8 * Q.pitch;
        if (dd < 1.2 * Q.pitch && rh >= 0.5 * qh && rh <= 1.8 * qh) cands.push({ Q, dd });
      }
      if (!cands.length) return null;
      cands.sort((p, q) => p.dd - q.dd);
      const above = cands.find(c => c.Q.Y1 <= r.a + 1), below = cands.find(c => c.Q.Y0 >= r.b - 1);
      if (above && below && Math.abs(above.dd - below.dd) <= 0.35 * Math.max(above.Q.pitch, below.Q.pitch)) {
        // Hoà: dòng thụt đầu → dòng đầu của đoạn dưới; còn lại → dòng cuối của đoạn trên
        let start = xb;
        for (let x = xa; x < xb && start === xb; x++) for (let y = r.a; y <= r.b; y++) if (ink(x, y)) { start = x; break; }
        const indent = start - Math.max(above.Q.X0, below.Q.X0);
        return indent > 0.8 * (r.b - r.a + 1) ? below.Q : above.Q;
      }
      return cands[0].Q;
    };
    const lines = runs.filter(r => owner(r) === P);
    const aiLines = Math.max(1, Math.round(o.lines || 1));
    let top = lines.length ? lines[0].a : Y0;
    let bottom = lines.length ? lines[lines.length - 1].b : Y1;
    let n = lines.length || aiLines;
    if (aiLines > 1 && (n < aiLines * 0.6 || n > aiLines * 1.6)) { n = aiLines; top = Math.min(top, Y0); bottom = Math.max(bottom, Y1); }
    // Đuôi chân chữ (g, p, y) và dấu thanh nhạt hơn ngưỡng dò dòng → nới mép dưới/trên tới hàng trống đầu tiên
    if (lines.length) {
      const rowHas = (y: number) => { for (let x = xa; x < xb; x++) if (!ruleCols.has(x) && ink(x, y)) return true; return false; };
      const lh = lines[lines.length - 1].b - lines[lines.length - 1].a + 1;
      for (let y = bottom + 1; y < Math.min(H, bottom + 0.45 * lh); y++) { if (rowHas(y)) bottom = y; else break; }
      const lh0 = lines[0].b - lines[0].a + 1;
      for (let y = top - 1; y > Math.max(0, top - 0.35 * lh0); y--) { if (rowHas(y)) top = y; else break; }
    }
    // 3) Mép trái/phải theo mực thật: nới ra ngoài khung tới khi gặp khe trống (khe cột) hoặc khối khác
    const lineH = lines.length ? median(lines.map(l => l.b - l.a + 1)) : (bottom - top) / n;
    const gapMax = Math.max(3, 0.7 * lineH);
    let limL = Math.max(0, X0 - 0.04 * W), limR = Math.min(W - 1, X1 + 0.04 * W);
    for (const Q of horiz) {
      if (Q === P || Math.min(Q.Y1, bottom) - Math.max(Q.Y0, top) <= 0) continue;
      if (Q.X1 <= X0 + 2) limL = Math.max(limL, Q.X1 + 1);
      if (Q.X0 >= X1 - 2) limR = Math.min(limR, Q.X0 - 1);
    }
    const span = Math.max(1, bottom - top + 1);
    const lhRef = lines.length ? median(lines.map(l => l.b - l.a + 1)) : span;
    const colInk = (x: number) => {
      if (ruleCols.has(x)) return false;
      let c = 0;
      for (let y = Math.floor(top); y <= bottom; y += 1) if (ink(x, y)) c++;
      // Cột toàn mực CAO HƠN HẲN một dòng chữ = đường kẻ dọc / khung → không phải chữ
      // (nét dọc của chữ I, D, B… chỉ cao bằng một dòng → vẫn là chữ)
      return c > 0 && !(span > 1.8 * lhRef && c > 0.9 * span);
    };
    let x0 = X0, x1 = X1;
    { // co vào mực thật bên trong khung
      let l = xa; while (l < xb && !colInk(l)) l++;
      let r = xb - 1; while (r > l && !colInk(r)) r--;
      if (r > l) { x0 = l; x1 = r + 1; }
    }
    // Nới ra ngoài khung chỉ theo cột có mực ở GIỮA dòng chữ (không nới vào chữ hoa đầu đoạn cỡ lớn, hình bên cạnh)
    // Cột ngoài khung: là đường kẻ nếu mực chạy tiếp lên trên và xuống dưới dòng chữ
    const isRuleOutside = (x: number) => {
      const t = Math.max(0, Math.floor(top) - 4), b = Math.min(H - 1, Math.ceil(bottom) + 4);
      return ink(x, t) && ink(x, b) && ink(x, Math.round((top + bottom) / 2));
    };
    const midInk = (x: number) => {
      if (!colInk(x) || isRuleOutside(x)) return false;
      for (const l of lines.length ? lines : [{ a: Math.floor(top), b: Math.ceil(bottom) }]) {
        const h = l.b - l.a + 1;
        for (let y = Math.round(l.a + 0.35 * h); y <= Math.round(l.b - 0.35 * h); y++) if (ink(x, y)) return true;
      }
      return false;
    };
    for (let x = Math.floor(x0) - 1, blank = 0; x >= limL; x--) { if (midInk(x)) { x0 = x; blank = 0; } else if (++blank >= gapMax) break; }
    for (let x = Math.ceil(x1), blank = 0; x <= limR; x++) { if (midInk(x)) { x1 = x + 1; blank = 0; } else if (++blank >= gapMax) break; }

    // Thụt đầu dòng: dòng đầu bắt đầu lùi vào so với các dòng sau
    let firstIndent = 0;
    if (lines.length >= 2) {
      const startOf = (l: { a: number; b: number }) => {
        for (let x = Math.floor(x0); x < x1; x++) { if (ruleCols.has(x)) continue; for (let y = l.a; y <= l.b; y++) if (ink(x, y)) return x; }
        return x1;
      };
      firstIndent = Math.max(0, startOf(lines[0]) - median(lines.slice(1, 4).map(startOf)));
    }
    const h = Math.max(4, bottom - top);
    let size: number;
    let leading: number;
    // Cỡ chữ theo chiều cao nét chữ thật (đầu chữ cao → chân chữ thấp ≈ 0,93 cỡ chữ); dùng các dòng
    // cao nhất (bách phân vị 75: dòng có cả chữ cao lẫn chữ có chân), rồi giới hạn theo giãn dòng thật
    // (sách in: giãn dòng ≈ 1,12–1,42 cỡ chữ) để các đoạn có cỡ chữ ổn định.
    const hs = lines.map(l => l.b - l.a + 1).sort((p, q) => p - q);
    const tall = hs.length ? hs[Math.min(hs.length - 1, Math.floor(hs.length * 0.75))] : lineH;
    // Cỡ chữ theo "dải lõi" của dòng (các hàng mực dày đặc): chữ thường → chiều cao chữ x (~0,52 cỡ, chữ có chân ~0,46);
    // chữ IN HOA → chiều cao chữ hoa (~0,71 cỡ). Ổn định hơn chiều cao toàn dòng (phụ thuộc có chữ g/p/y hay không).
    const letters = text.match(/\p{L}/gu) || [];
    const capsRatio = letters.length ? letters.filter(ch => ch === ch.toUpperCase() && ch !== ch.toLowerCase()).length / letters.length : 0;
    // Chiều cao mực theo từng cột trong dòng; bỏ cột thấp (dấu chấm dẫn, dấu câu) → trung vị = chiều cao chữ x / chữ hoa
    const cores: number[] = [];
    for (const l of lines) {
      const lh = l.b - l.a + 1;
      for (let x = Math.floor(X0); x < Math.min(W, Math.ceil(X1)); x += 1) {
        if (ruleCols.has(x)) continue;
        let f = -1, g = -1;
        for (let y = l.a; y <= l.b; y++) if (ink(x, y)) { if (f < 0) f = y; g = y; }
        if (f >= 0 && g - f + 1 >= 0.3 * lh) cores.push(g - f + 1);
      }
    }
    const coreH = cores.length >= 5 ? median(cores) : 0;
    const coreRatio = capsRatio > 0.7 ? 0.71 : (o.serif === false ? 0.52 : 0.47);
    size = coreH > 2 ? coreH / coreRatio : tall / 0.93;
    size = Math.min(tall / 0.68, Math.max(tall / 1.0, size));
    if (n >= 2) {
      leading = lines.length === n ? median(lines.slice(1).map((l, i) => l.a - lines[i].a)) : h / (n - 1 + 0.82);
      // Cỡ chữ theo chiều cao nét; giãn dòng chỉ dùng làm giới hạn trên (dòng thưa như mục lục không làm chữ to ra)
      size = Math.min(leading / 1.08, size);
    } else {
      leading = size * 1.2;
    }
    size = Math.max(5, size);
    // Mật độ mực (để nhận chữ đậm khi AI không báo)
    // Độ dày nét (độ dài trung bình các đoạn mực ngang, chỉ tính đoạn ≥ 2 điểm) chia cho chiều cao dòng
    // → không phụ thuộc dấu chấm dẫn / khoảng trắng như mật độ mực
    let runSum = 0, runN = 0;
    for (const l of lines.length ? lines : [{ a: Math.floor(top), b: Math.ceil(bottom) }]) {
      for (let y = l.a; y <= l.b; y += 2) {
        let run = 0;
        for (let x = Math.floor(x0); x <= x1; x++) {
          if (x < x1 && !ruleCols.has(x) && ink(x, y)) run++;
          else { if (run >= 2 && run < Math.min(0.5 * lhRef, 0.3 * size)) { runSum += run; runN++; } run = 0; }
        }
      }
    }
    inkDensity.set(out.length, runN >= 20 ? runSum / runN / Math.max(1, size) : 0);
    // v9.6: nhãn "Figure 1 –", "Table 2." in đậm ở đầu chú thích: so độ dày nét phần nhãn với phần còn lại của dòng đầu
    let boldLead = !!o.bold_lead;
    const leadM = !boldLead && !o.bold && lines.length ? text.match(/^((?:Figure|Fig\.?|Table|Box|Chart)\s*[\dA-Z][\w.\-]*)/i) : null;
    if (leadM) {
      // Tách dòng đầu thành từng TỪ theo khe trống, so độ phủ mực của nhãn ("Figure 7") với phần còn lại của dòng
      const l = lines[0], lh = l.b - l.a + 1;
      const colHas: boolean[] = [];
      for (let x = Math.floor(x0); x < Math.ceil(x1); x++) { let h = false; if (!ruleCols.has(x)) for (let y = l.a; y <= l.b; y++) if (ink(x, y)) { h = true; break; } colHas.push(h); }
      const words: { a: number; b: number }[] = [];
      let gap = 0, cur: { a: number; b: number } | null = null;
      colHas.forEach((h, k) => {
        if (h) { if (!cur || gap >= Math.max(3, 0.22 * lh)) { cur = { a: k, b: k }; words.push(cur); } else cur.b = k; gap = 0; }
        else gap++;
      });
      const kw = leadM[1].trim().split(/\s+/).length;
      if (words.length >= kw + 3) {
        const cover = (a: number, b: number) => {
          let c = 0, n = 0;
          for (let x = a; x <= b; x++) for (let y = l.a; y <= l.b; y++) { n++; if (ink(Math.floor(x0) + x, y)) c++; }
          return n ? c / n : 0;
        };
        // độ dày nét: các đoạn mực ngang ngắn (cắt ngang thân chữ) — chữ đậm có thân chữ dày hơn
        const stem = (a: number, b: number) => {
          let sm = 0, cn = 0;
          for (let y = l.a; y <= l.b; y++) {
            let run = 0;
            for (let x = a; x <= b + 1; x++) {
              if (x <= b && ink(Math.floor(x0) + x, y)) run++;
              else { if (run >= 1 && run < 0.45 * lh) { sm += run; cn++; } run = 0; }
            }
          }
          return cn >= 8 ? sm / cn : 0;
        };
        const lead = cover(words[0].a, words[kw - 1].b), rest = cover(words[kw + 1].a, words[words.length - 1].b);
        const sl = stem(words[0].a, words[kw - 1].b), sr = stem(words[kw + 1].a, words[words.length - 1].b);
        if (rest > 0 && sr > 0 && ((sl > 1.18 * sr) || (sl > 1.1 * sr && lead > 1.08 * rest) || lead > 1.25 * rest)) boldLead = true;
      }
    }
    // Lớp chữ PDF (kể cả hỏng bảng mã) nằm dưới khối → cỡ chữ, font, đậm/nghiêng, màu CHUẨN như bản gốc
    let guided = false;
    const under = items.filter(it => {
      const cx = it.x + it.w / 2, cy = it.y - 0.35 * it.size;
      return cx >= x0 - 2 && cx <= x1 + 2 && cy >= top - 2 && cy <= bottom + 2;
    });
    if (under.length) {
      const wsum = (f: (it: NormItem) => boolean) => under.filter(f).reduce((a, it) => a + Math.max(1, it.w), 0);
      const total = wsum(() => true);
      const sizes = under.flatMap(it => Array(Math.max(1, Math.min(40, Math.round(it.w / 10)))).fill(it.size));
      const ts = median(sizes);
      if (ts > 3 && ts < 3 * size) {
        size = ts;
        guided = true;
        base.serif = wsum(it => it.serif) >= 0.5 * total;
        base.bold = wsum(it => it.bold) > 0.5 * total;
        base.italic = wsum(it => it.italic) > 0.5 * total;
        base.baseStyle = { ...base.baseStyle, bold: base.bold, italic: base.italic };
        const colored = under.filter(it => it.color && !isDark(it.color));
        if (colored.length && wsum(it => !!it.color && !isDark(it.color)) > 0.5 * total) base.baseStyle.color = colored[0].color;
        base.hScale = median(under.map(it => it.hScale || 1)) || 1;
      }
    }
    if (n < 2) leading = size * 1.2;
    out.push({
      ...base,
      guided,
      leader: leaderNum !== undefined ? { num: leaderNum, right: x1 } : undefined,
      x0, x1,
      // Khung theo cùng quy ước với khối từ lớp chữ (đỉnh = đường chân chữ − 0,9 cỡ; đáy = chân chữ dòng cuối + 0,28 cỡ)
      // → bản dịch không bị coi là "tràn khung" chỉ vì khung OCR bó sát mực
      top: top - 0.18 * size,
      bottom: Math.max(bottom + 0.05 * size, top - 0.18 * size + (n - 1) * Math.max(size * 1.02, leading) + 1.18 * size),
      size,
      leading: Math.max(size * 1.02, leading),
      lineCount: n,
      boldLead: boldLead || undefined,
      firstOffset: firstIndent > 0.6 * size && firstIndent < 4 * size ? firstIndent : 0,
      // v10.8: chữ trưng bày cỡ lớn (tên sách trên bìa) không căn đều — trước đây "Hướng   Dẫn" bị giãn hở giữa các từ
      align: (al === 'center' || al === 'right' || (al === 'justify' && size < 0.025 * ctx.canvas.height)) ? al as BlockAlign : (n >= 3 && size < 0.025 * ctx.canvas.height ? 'justify' : 'left'),
    });
  }
  // Chữ đậm theo mật độ mực (so với mặt bằng các khối cùng cỡ) khi AI không báo
  const capsShare = (t: string) => { const L = t.match(/\p{L}/gu) || []; return L.length ? L.filter(c => c === c.toUpperCase() && c !== c.toLowerCase()).length / L.length : 0; };
  {
    const dens = out.map((b, i) => ({ b, d: inkDensity.get(i) ?? 0 })).filter(x => !x.b.guided && !x.b.rotate && x.d > 0);
    const paraSize = median(dens.filter(y => y.b.lineCount >= 2).map(y => y.b.size)) || 0;
    for (const x of dens) {
      // v11: chữ cỡ lớn (tiêu đề "IV. FINDINGS" gấp đôi thân bài) có mật độ mực khác hẳn chữ nhỏ → không so được với đoạn
      // văn; trước đây tiêu đề chữ thường bị vẽ ĐẬM (BI-RADS tr.19). Chỉ tự nhận đậm khi có khối cùng cỡ để so.
      if (paraSize > 0 && x.b.size > 1.5 * paraSize && !dens.some(y => y !== x && Math.abs(y.b.size - x.b.size) < 0.2 * x.b.size)) continue;
      // Mốc chữ thường = các đoạn văn nhiều dòng (hiếm khi in đậm); không có thì dùng bách phân vị 30 của trang
      const paras = dens.filter(y => y.b.lineCount >= 2).map(y => y.d);
      const all = dens.map(y => y.d).sort((p, q) => p - q);
      const ref = paras.length >= 2 ? median(paras) : all[Math.floor(all.length * 0.3)];
      // Ô ngắn (bảng) dao động mật độ mực nhiều hơn đoạn văn → cần chênh lệch lớn hơn mới coi là chữ đậm
      const need = (x.b.plain.length < 30 ? 1.35 : 1.2) + (capsShare(x.b.plain) > 0.6 ? 0.15 : 0); // chữ IN HOA dày mực hơn
      if (!x.b.bold && ref > 0 && x.d > need * ref && x.b.plain.length >= 3) { x.b.bold = true; x.b.baseStyle = { ...x.b.baseStyle, bold: true }; }
    }
  }
  // Gom cỡ chữ thành vài cỡ chuẩn (như bản in chỉ có vài cỡ chữ): cỡ ước lượng lệch nhau < 9% → dùng chung
  for (const capsGroup of [true, false]) {
    const capRe = /^(figure|fig\.?|table|box|chart)\s*[\dA-Z]/i;
    const free = out.filter(b => !b.guided && !b.rotate && capRe.test(b.plain.trim()) === capsGroup);
    const sorted = [...free].sort((a, b) => a.size - b.size);
    const clusters: LayoutBlock[][] = [];
    for (const b of sorted) {
      const c = clusters[clusters.length - 1];
      if (c && b.size <= c[0].size * 1.09) c.push(b); else clusters.push([b]);
    }
    for (const c of clusters) {
      const w = c.flatMap(b => Array(Math.max(1, Math.min(50, Math.round(b.plain.length / 20)))).fill(b.size));
      const ms = median(w);
      for (const b of c) { b.leading = Math.max(ms * 1.02, b.leading * (ms / b.size)); b.size = ms; }
    }
  }
  // Cùng một cột (bảng, danh sách): các ô 1–2 dòng thẳng mép trái, cỡ ước lượng gần nhau (±30%) → cùng một cỡ
  // (trước đây ô "2. Bờ viền" to hơn hẳn các ô khác trong cột)
  {
    const cells = out.filter(b => !b.rotate && !b.guided && b.lineCount <= 2);
    const used = new Set<LayoutBlock>();
    for (const c of cells) {
      if (used.has(c)) continue;
      const col = cells.filter(o => !used.has(o) && Math.abs(o.x0 - c.x0) < 0.8 * c.size && o.size < 1.3 * c.size && o.size > 0.77 * c.size);
      if (col.length < 3) continue;
      const ms = median(col.map(o => o.size));
      for (const o of col) {
        if (o.size > 1.3 * ms || o.size < 0.77 * ms) continue;
        o.leading = Math.max(ms * 1.02, o.leading * (ms / o.size));
        o.size = ms;
        used.add(o);
      }
    }
  }
  // Cỡ chữ thân bài đồng đều: các đoạn nhiều dòng có cỡ ước lượng gần nhau (±12%) → dùng chung trung vị
  const body = out.filter(b => !b.rotate && b.lineCount >= 2);
  if (body.length) {
    // Dòng thường (không đậm, không viết hoa toàn bộ) mà cỡ đo được quá lớn → do logo/hình nhỏ chèn trong dòng
    const ref = median(body.flatMap(b => Array(Math.min(30, Math.ceil(b.plain.length / 40))).fill(b.size)));
    for (const b of out) {
      if (b.guided || b.rotate || b.bold || b.lineCount >= 3) continue;
      const caps = b.plain === b.plain.toUpperCase() && /\p{Lu}/u.test(b.plain);
      if (!caps && b.size > 1.3 * ref && b.plain.length > 25) { b.size = ref; b.leading = Math.max(ref * 1.2, b.leading); }
    }
  }
  // v9.8: chú thích hình (cỡ chữ nhỏ hơn, giãn dòng chặt hơn) không được kéo cỡ chữ/giãn dòng của đoạn thân bài xuống
  // (trước đây 1 đoạn + 2 chú thích → trung vị = cỡ chú thích → thân bài bị nhỏ và nén). Trung vị theo độ dài chữ.
  const isCaption = (b: LayoutBlock) => /^(figure|fig\.?|table|box|chart|hình|bảng)\s*[\dA-Z]/i.test(b.plain.trim());
  const bodyText = body.filter(b => !isCaption(b));
  if (bodyText.length >= 2) {
    const wts = (f: (b: LayoutBlock) => number) => median(bodyText.flatMap(b => Array(Math.max(1, Math.min(40, Math.round(b.plain.length / 30)))).fill(f(b))));
    const ms = wts(b => b.size);
    const ml = wts(b => b.leading / b.size) * ms;
    for (const b of bodyText) if (!b.guided && Math.abs(b.size - ms) <= 0.15 * ms) { b.size = ms; b.leading = Math.max(ms * 1.02, ml); }
  }
  // v9.6.1: chú thích hình/bảng trên cùng trang in cùng một cỡ chữ → dùng chung (trước đây "Hình 3" to bất thường,
  // giãn dòng rộng vì khung AI cao quá)
  {
    const caps = out.filter(b => !b.rotate && !b.guided && /^(figure|fig\.?|table|box|chart)\s*[\dA-Z]/i.test(b.plain.trim()));
    if (caps.length >= 2) {
      const ms = median(caps.map(b => b.size));
      for (const b of caps) {
        if (Math.abs(b.size - ms) > 0.08 * ms) b.size = ms;
        b.leading = Math.min(Math.max(b.size * 1.12, b.leading), b.size * 1.35);
      }
    } else for (const b of caps) b.leading = Math.min(b.leading, b.size * 1.4);
  }
  // Kiểu chữ (có chân / không chân) thống nhất theo đa số trên trang — AI hay báo lẫn lộn từng khối
  {
    const hz = out.filter(b => !b.rotate && !b.guided);
    const wS = hz.filter(b => b.serif).reduce((a, b) => a + b.plain.length, 0);
    const wT = hz.reduce((a, b) => a + b.plain.length, 0);
    if (wT > 0) { const serif = wS > 0.6 * wT; for (const b of hz) b.serif = serif; }
  }
  return orderForReading(out, W, []).map((b, i) => ({ ...b, id: `${idPrefix}${i + 1}` }));
}

/** v9.6.1: màu "nổi" (xanh/tím của đường link, chữ màu) trong vùng chữ scan; null nếu không có. */
function accentInk(img: ImageData, x0: number, y0: number, x1: number, y1: number, bg: RGB): RGB | null {
  const W = img.width, H = img.height, d = img.data;
  const bgL = 0.299 * bg.r + 0.587 * bg.g + 0.114 * bg.b;
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  let inkN = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(H, Math.ceil(y1)); y++) for (let x = Math.max(0, Math.floor(x0)); x < Math.min(W, Math.ceil(x1)); x++) {
    const i = (y * W + x) * 4, r = d[i], g = d[i + 1], b = d[i + 2];
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    if (bgL - L < 45) continue;
    inkN++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 45) { rs.push(r); gs.push(g); bs.push(b); }
  }
  if (rs.length < 25 || rs.length < 0.03 * inkN) return null;
  const c = { r: median(rs), g: median(gs), b: median(bs) };
  return deepenScanInk(c, bg);
}


/** v9.6.1: lưới ô ẢNH LỚN (nhũ ảnh, siêu âm…): ô gần như không có nền giấy, thuộc cụm ô liền nhau đủ lớn.
 *  Bỏ cụm nhỏ (chữ in đậm cỡ lớn, logo) để không bị coi là ảnh. */
function bigPhotoGrid(d: Uint8ClampedArray, W: number, H: number, c: number): { grid: Uint8Array; gw: number; gh: number } | null {
  const gw = Math.ceil(W / c), gh = Math.ceil(H / c);
  const hist = new Int32Array(256);
  for (let i = 0; i < d.length; i += 4 * 7) hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++;
  let bgL = 0; for (let k = 1; k < 256; k++) if (hist[k] > hist[bgL]) bgL = k;
  if (bgL < 150) return null;
  const raw = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let light = 0, n = 0;
    for (let y = gy * c; y < Math.min(H, gy * c + c); y += 2) for (let x = gx * c; x < Math.min(W, gx * c + c); x += 2) {
      const i = (y * W + x) * 4; if (((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8) >= bgL - 40) light++; n++;
    }
    if (light < 0.25 * n && !uniformPanel(d, W, H, gx * c, gy * c, c)) raw[gy * gw + gx] = 1;
  }
  const grid = new Uint8Array(gw * gh), seen = new Uint8Array(gw * gh);
  const minSide = Math.max(6, Math.round(0.05 * gw));
  for (let s0 = 0; s0 < gw * gh; s0++) {
    if (!raw[s0] || seen[s0]) continue;
    const comp: number[] = [];
    const st = [s0]; seen[s0] = 1;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0;
    while (st.length) {
      const k = st.pop()!, gx = k % gw, gy = (k / gw) | 0;
      comp.push(k);
      if (gx < x0) x0 = gx; if (gx > x1) x1 = gx; if (gy < y0) y0 = gy; if (gy > y1) y1 = gy;
      for (const q of [gx > 0 ? k - 1 : -1, gx < gw - 1 ? k + 1 : -1, gy > 0 ? k - gw : -1, gy < gh - 1 ? k + gw : -1])
        if (q >= 0 && raw[q] && !seen[q]) { seen[q] = 1; st.push(q); }
    }
    if (x1 - x0 + 1 >= minSide && y1 - y0 + 1 >= minSide) for (const k of comp) grid[k] = 1;
  }
  return { grid, gw, gh };
}

/* ------------------------------------------------------------------ */
/* v9.6: kiểm tra & sửa toạ độ khối OCR trên trang scan nhiều ảnh      */
/* ------------------------------------------------------------------ */

interface TextRegion { x0: number; y0: number; x1: number; y1: number; }

/** Ô màu xám nhạt đều (nền tab, khung tô màu) → không phải ảnh chụp (tránh che mất chữ trên tab "MAMMOGRAPHY"). */
function uniformPanel(d: Uint8ClampedArray, W: number, H: number, x0: number, y0: number, c: number): boolean {
  let s = 0, s2 = 0, n = 0;
  for (let y = y0; y < Math.min(H, y0 + c); y++) for (let x = x0; x < Math.min(W, x0 + c); x++) {
    const i = (y * W + x) * 4, L = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
    s += L; s2 += L * L; n++;
  }
  if (!n) return false;
  const m = s / n, sd = Math.sqrt(Math.max(0, s2 / n - m * m));
  return m >= 140 && sd < 10;
}

/**
 * Tìm các vùng chữ in trên nền giấy (không tính ảnh chụp) bằng lưới ô nhỏ: ô có mực tối trên nền sáng = chữ;
 * ô gần như không có nền sáng = ảnh. Gộp ô chữ theo hàng (nới ngang ~3 ô) → dòng → đoạn.
 */
export function scanTextRegions(img: ImageData): { regions: TextRegion[]; photoFrac: (x0: number, y0: number, x1: number, y1: number) => number; bgL: number } | null {
  const W = img.width, H = img.height, d = img.data;
  const c = Math.max(4, Math.round(W / 420));
  const gw = Math.ceil(W / c), gh = Math.ceil(H / c);
  // nền giấy = độ sáng phổ biến nhất
  const hist = new Int32Array(256);
  for (let i = 0; i < d.length; i += 4 * 7) hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++;
  let bgL = 0; for (let k = 1; k < 256; k++) if (hist[k] > hist[bgL]) bgL = k;
  if (bgL < 150) return null;
  const lightT = bgL - 40, darkT = bgL - 90;
  const text = new Uint8Array(gw * gh), photo = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let light = 0, dark = 0, n = 0;
    for (let y = gy * c; y < Math.min(H, gy * c + c); y++) for (let x = gx * c; x < Math.min(W, gx * c + c); x++) {
      const i = (y * W + x) * 4, L = (d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8;
      if (L >= lightT) light++; else if (L < darkT) dark++;
      n++;
    }
    const k = gy * gw + gx;
    if (light < 0.25 * n && !uniformPanel(d, W, H, gx * c, gy * c, c)) photo[k] = 1;
    else if (dark >= Math.max(1, 0.04 * n) && light >= 0.45 * n) text[k] = 1;
  }
  // chỉ cụm ảnh LỚN là ảnh; cụm nhỏ (chữ đậm cỡ lớn) tính là chữ
  const big = bigPhotoGrid(d, W, H, c);
  if (big && big.gw === gw) for (let k = 0; k < gw * gh; k++) if (photo[k] && !big.grid[k]) { photo[k] = 0; text[k] = 1; }
  // ô chữ phải có ô nền sáng (không phải ảnh) xung quanh: bỏ ô chữ dính sát mép ảnh
  const dil = new Uint8Array(gw * gh);
  const R = 3;
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    if (!text[gy * gw + gx]) continue;
    for (let dx = -R; dx <= R; dx++) { const x = gx + dx; if (x >= 0 && x < gw && !photo[gy * gw + x]) dil[gy * gw + x] = 1; }
  }
  const seen = new Uint8Array(gw * gh);
  const comps: TextRegion[] = [];
  const stack: number[] = [];
  for (let s = 0; s < gw * gh; s++) {
    if (!dil[s] || seen[s]) continue;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, cnt = 0, txt = 0;
    stack.push(s); seen[s] = 1;
    while (stack.length) {
      const k = stack.pop()!, gx = k % gw, gy = (k / gw) | 0;
      cnt++; if (text[k]) txt++;
      if (gx < x0) x0 = gx; if (gx > x1) x1 = gx; if (gy < y0) y0 = gy; if (gy > y1) y1 = gy;
      const nb = [gx > 0 ? k - 1 : -1, gx < gw - 1 ? k + 1 : -1, gy > 0 ? k - gw : -1, gy < gh - 1 ? k + gw : -1];
      for (const q of nb) if (q >= 0 && dil[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
    }
    if (y1 - y0 + 1 < 2 || x1 - x0 + 1 < 5 || txt < 6) continue;
    comps.push({ x0: x0 * c, y0: y0 * c, x1: Math.min(W, (x1 + 1) * c), y1: Math.min(H, (y1 + 1) * c) });
  }
  const photoFrac = (x0: number, y0: number, x1: number, y1: number) => {
    let n = 0, p = 0;
    for (let gy = Math.max(0, Math.floor(y0 / c)); gy < Math.min(gh, Math.ceil(y1 / c)); gy++)
      for (let gx = Math.max(0, Math.floor(x0 / c)); gx < Math.min(gw, Math.ceil(x1 / c)); gx++) { n++; if (photo[gy * gw + gx]) p++; }
    return n ? p / n : 0;
  };
  // dòng → đoạn: gộp lặp các mảnh gần nhau (khe dọc < ~1 dòng, khe ngang < 1,5 dòng); bỏ mảnh nằm trên ảnh
  let parts = comps.filter(r => photoFrac(r.x0, r.y0, r.x1, r.y1) <= 0.3);
  const lhMed = parts.length ? median(parts.map(r => r.y1 - r.y0)) : 0;
  let changed = true;
  while (changed && parts.length > 1) {
    changed = false;
    outer: for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      const p = parts[i], q = parts[j];
      const gy = Math.max(p.y0, q.y0) - Math.min(p.y1, q.y1);
      const gx = Math.max(p.x0, q.x0) - Math.min(p.x1, q.x1);
      if (gy <= 0.9 * lhMed && gx <= 1.5 * lhMed) {
        const m = { x0: Math.min(p.x0, q.x0), y0: Math.min(p.y0, q.y0), x1: Math.max(p.x1, q.x1), y1: Math.max(p.y1, q.y1) };
        if (photoFrac(m.x0, m.y0, m.x1, m.y1) > 0.3) continue; // không gộp vắt qua ảnh
        parts[i] = m; parts.splice(j, 1); changed = true; break outer;
      }
    }
  }
  const regions = parts;
  return { regions, photoFrac, bgL };
}

/**
 * Khối OCR trên trang scan: AI đôi khi đặt khung sai chỗ (khung chú thích nằm đè lên ảnh) hoặc chỉ khoanh một phần
 * đoạn chữ (chú thích bị nhét vào cột hẹp ở giữa). Đối chiếu với vùng chữ thật trên ảnh:
 *  - khung nằm trên ảnh / không có chữ thật bên dưới → dời tới vùng chữ chưa có khối nào, hợp với độ dài chữ;
 *    không tìm được → bỏ khối (giữ chữ gốc, không vẽ bừa lên ảnh);
 *  - khung chỉ phủ một phần vùng chữ (không khối nào khác dùng) → nới ra cả vùng.
 * Nhãn ngắn trong ảnh (L, R, CC, MLO…) giữ nguyên. Trả về mảng CÙNG ĐỘ DÀI (khối bị bỏ có text rỗng).
 */
/** v11.2: tỉ lệ ô mực chữ (bỏ ảnh, bỏ đường kẻ mảnh) nằm ngoài mọi khung OCR. */
function uncoveredInk(ctx: CanvasRenderingContext2D, bgL: number, photoFrac: (x0: number, y0: number, x1: number, y1: number) => number,
  boxes: { x0: number; y0: number; x1: number; y1: number }[]): number {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const d = ctx.getImageData(0, 0, W, H).data;
  const c = Math.max(4, Math.round(W / 300));
  const darkT = bgL - 90;
  const padX = 0.006 * W, padY = 0.004 * H;
  let tot = 0, miss = 0;
  for (let y0 = 0; y0 < H; y0 += c) for (let x0 = 0; x0 < W; x0 += c) {
    const y1 = Math.min(H, y0 + c), x1 = Math.min(W, x0 + c);
    let n = 0, rows = 0, minC = 1e9, maxC = -1, minR = 1e9, maxR = -1;
    const colSeen = new Uint8Array(c);
    for (let y = y0; y < y1; y++) {
      let rowHas = false;
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        if (((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8) < darkT) { n++; rowHas = true; colSeen[x - x0] = 1; minC = Math.min(minC, x); maxC = Math.max(maxC, x); }
      }
      if (rowHas) { rows++; minR = Math.min(minR, y); maxR = Math.max(maxR, y); }
    }
    if (n < 2) continue;
    let cols = 0; for (let k = 0; k < c; k++) cols += colSeen[k];
    // đường kẻ ngang / dọc mảnh (bảng, biểu mẫu) không phải chữ
    if ((rows <= 3 && cols >= 0.8 * (x1 - x0)) || (cols <= 3 && rows >= 0.8 * (y1 - y0))) continue;
    if (photoFrac(x0, y0, x1, y1) > 0.3) continue;
    tot++;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (!boxes.some(B => cx >= B.x0 - padX && cx <= B.x1 + padX && cy >= B.y0 - padY && cy <= B.y1 + padY)) miss++;
  }
  return tot >= 30 ? miss / tot : 0;
}

export function refineOcrBoxes(ctx: CanvasRenderingContext2D, ocr: OcrBlock[]): OcrBlock[] {
  try {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    if (!W || !H || !ocr.length) return ocr;
    const scan = scanTextRegions(ctx.getImageData(0, 0, W, H));
    if (!scan || !scan.regions.length) return ocr;
    const { regions, photoFrac } = scan;
    type Bx = { x0: number; y0: number; x1: number; y1: number };
    const toPx = (o: OcrBlock): Bx | null => {
      if (!Array.isArray(o.box_2d) || o.box_2d.length !== 4) return null;
      const [a, b, c2, d2] = o.box_2d.map(Number);
      if (![a, b, c2, d2].every(Number.isFinite)) return null;
      return { y0: Math.min(a, c2) / 1000 * H, x0: Math.min(b, d2) / 1000 * W, y1: Math.max(a, c2) / 1000 * H, x1: Math.max(b, d2) / 1000 * W };
    };
    const area = (r: Bx) => Math.max(1, (r.x1 - r.x0) * (r.y1 - r.y0));
    const inter = (p: Bx, q: Bx) => Math.max(0, Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0)) * Math.max(0, Math.min(p.y1, q.y1) - Math.max(p.y0, q.y0));
    const isRot = (o: OcrBlock) => o.dir === 'up' || o.dir === 'down';
    const boxes = ocr.map(o => (o && o.text?.trim() && !isRot(o) ? toPx(o) : null));
    const bad = new Set<number>();
    boxes.forEach((B, i) => {
      if (!B) return;
      const len = ocr[i].text.trim().length;
      if (len < 25) return; // nhãn ngắn (có thể nằm trong ảnh thật)
      const pf = photoFrac(B.x0, B.y0, B.x1, B.y1);
      const hit = regions.some(R => { const s = inter(B, R); return s > 0.3 * area(B) || s > 0.3 * area(R); });
      if (pf > 0.4 || !hit) bad.add(i);
    });
    // diện tích mỗi ký tự theo các khối đúng chỗ (để ước lượng khối nào hợp vùng nào)
    const per: number[] = [];
    boxes.forEach((B, i) => { if (B && !bad.has(i) && ocr[i].text.trim().length >= 25) per.push(area(B) / ocr[i].text.trim().length); });
    const charArea = per.length ? median(per) : 0;
    const claimedBy = (R: TextRegion, skip: number) => boxes.some((B, j) => j !== skip && B && !bad.has(j) && inter(B, R) > 0.25 * Math.min(area(R), area(B)));
    const out = ocr.map(o => o);
    const setBox = (i: number, R: Bx) => {
      const pad = 0.002;
      out[i] = { ...ocr[i], box_2d: [R.y0 / H - pad, R.x0 / W - pad, R.y1 / H + pad, R.x1 / W + pad].map(v => Math.max(0, Math.min(1000, Math.round(v * 1000)))) };
    };
    const used = new Set<TextRegion>();
    // Dời khối sai chỗ
    const merged = new Set<number>();
    for (const i of [...bad]) {
      if (merged.has(i)) continue;
      const B = boxes[i]!;
      const len = ocr[i].text.trim().length;
      const expected = charArea ? len * charArea : area(B);
      let best: TextRegion | null = null, bestScore = Infinity, mate = -1;
      const xOv = (R: Bx) => Math.max(0, Math.min(R.x1, B.x1) - Math.max(R.x0, B.x0)) / Math.max(1, Math.min(R.x1 - R.x0, B.x1 - B.x0));
      for (const R of regions) {
        if (used.has(R) || photoFrac(R.x0, R.y0, R.x1, R.y1) > 0.3) continue;
        const dist = Math.hypot((R.x0 + R.x1 - B.x0 - B.x1) / 2 / W, (R.y0 + R.y1 - B.y0 - B.y1) / 2 / H);
        // v11: chỉ dời tới vùng chữ GẦN (khung AI lệch ít, thường lệch dọc 1–3 dòng) và cùng cột — trước đây chú thích
        // "Figure 2 – …" dưới nhũ ảnh bị dời lên tận góc trên bên phải (vùng tab "MAMMOGRAPHY"), chữ dịch tí hon (BI-RADS tr.31)
        if (dist > 0.08 || xOv(R) < 0.5) continue;
        // Vùng đã có khối khác (dòng tiếp theo của CÙNG chú thích, AI tách riêng "(SM). Pathology: Cyst.") → gộp hai khối
        const claimers = boxes.map((Bj, j) => (j !== i && Bj && !bad.has(j) && inter(Bj, R) > 0.25 * Math.min(area(R), area(Bj)) ? j : -1)).filter(j => j >= 0);
        if (claimers.length > 1) continue;
        const j = claimers.length ? claimers[0] : -1;
        if (j >= 0 && (Math.abs(j - i) !== 1 || ocr[j].text.trim().length > len)) continue;
        const ratio = Math.abs(Math.log(area(R) / (j >= 0 ? (len + ocr[j].text.trim().length) * (charArea || area(B) / len) : expected)));
        if (ratio > Math.log(2.8)) continue;
        const score = ratio + 2 * dist;
        if (score < bestScore) { bestScore = score; best = R; mate = j; }
      }
      if (best) {
        used.add(best); setBox(i, best);
        if (mate >= 0) {
          // gộp: khối đứng trước giữ cả hai phần chữ / bản dịch theo thứ tự đọc
          const [a, b] = mate < i ? [mate, i] : [i, mate];
          const joinT = (x?: string, y?: string) => [x, y].filter(s => s && s.trim()).join(' ');
          out[i] = { ...out[i], text: joinT(ocr[a].text, ocr[b].text), v: ocr[a].v || ocr[b].v ? joinT(ocr[a].v, ocr[b].v) : undefined, lines: (ocr[a].lines || 1) + (ocr[b].lines || 1) };
          out[mate] = { ...ocr[mate], text: '' };
          bad.add(mate); merged.add(mate); // không cho bước khớp vùng bên dưới gán lại khối đã gộp
        }
        console.info('[Layout] OCR: dời khối đặt sai chỗ →', ocr[i].text.slice(0, 40));
      } else { out[i] = { ...ocr[i], text: '' }; console.info('[Layout] OCR: bỏ khối nằm trên ảnh, không tìm được chỗ đúng →', ocr[i].text.slice(0, 40)); }
    }
    // Khớp khối với vùng chữ thật: khung AI chỉ phủ một phần (chú thích bị nhét vào cột hẹp ở giữa, chữ gốc hai bên
    // không được xoá) hoặc thòng xuống khoảng trắng → thay bằng đúng vùng chữ gốc, khi vùng đó không thuộc khối khác.
    boxes.forEach((B, i) => {
      if (!B || bad.has(i) || ocr[i].text.trim().length < 25) return;
      let best: TextRegion | null = null, bestS = 0;
      for (const R of regions) {
        const sI = inter(B, R);
        if (sI > bestS) { bestS = sI; best = R; }
      }
      if (!best || used.has(best) || bestS < 0.25 * Math.min(area(B), area(best))) return;
      if (claimedBy(best, i)) return;
      const R = best;
      const same = Math.abs(R.x0 - B.x0) < 0.01 * W && Math.abs(R.x1 - B.x1) < 0.01 * W && Math.abs(R.y0 - B.y0) < 0.006 * H && Math.abs(R.y1 - B.y1) < 0.006 * H;
      if (same) return;
      used.add(R);
      setBox(i, R);
    });
    // v11: tỉ lệ khối AI đặt sai chỗ (phải dời / bỏ) — cao = kết quả OCR không tin cậy (trang biểu mẫu dày đặc)
    const counted = boxes.filter(Boolean).length;
    (out as any).badRatio = counted ? bad.size / counted : 0;
    // … và tỉ lệ khối chồng lên khối khác (khung AI lệch → nhiều khung đè nhau)
    {
      const fin = out.map(o => (o && o.text?.trim() && !isRot(o) ? toPx(o) : null)).filter(Boolean) as Bx[];
      let ov = 0;
      for (let i = 0; i < fin.length; i++) {
        if (fin.some((q, j) => j !== i && inter(fin[i], q) > 0.3 * Math.min(area(fin[i]), area(q)))) ov++;
      }
      (out as any).overlapRatio = fin.length ? ov / fin.length : 0;
      // v11.2: tỉ lệ MỰC CHỮ (ngoài ảnh, không tính đường kẻ) KHÔNG có khối OCR nào phủ — model bỏ sót cả mảng trang
      // (BI-RADS tr.520: biểu mẫu chỉ đọc nửa trên, nửa dưới giữ tiếng Anh; trang chữ dày bị cắt cụt JSON)
      (out as any).uncoveredRatio = uncoveredInk(ctx, scan.bgL, photoFrac, out.map(o => (o && o.text?.trim() ? toPx(o) : null)).filter(Boolean) as Bx[]);
    }
    return out;
  } catch (e) {
    console.warn('[Layout] Không kiểm tra được toạ độ OCR:', e);
    return ocr;
  }
}

/**
 * v9.6: bản sao trang với các ẢNH LỚN (nhũ ảnh, siêu âm, ảnh chụp) được che bằng nền xám nhạt, chỉ còn chữ in.
 * Dùng khi AI OCR trả rỗng cho trang nhiều ảnh y khoa (bộ lọc nội dung của model hay chặn ảnh vú/cơ thể,
 * hoặc model "bỏ qua" trang toàn ảnh). Trả về null nếu trang không có ảnh lớn.
 */
export function maskPhotosCanvas(src: HTMLCanvasElement): HTMLCanvasElement | null {
  const W = src.width, H = src.height;
  if (!W || !H) return null;
  const sctx = src.getContext('2d', { willReadFrequently: true } as any) as CanvasRenderingContext2D | null;
  if (!sctx) return null;
  const d = sctx.getImageData(0, 0, W, H).data;
  const c = Math.max(4, Math.round(W / 300));
  const gw = Math.ceil(W / c), gh = Math.ceil(H / c);
  const hist = new Int32Array(256);
  for (let i = 0; i < d.length; i += 4 * 7) hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++;
  let bgL = 0; for (let k = 1; k < 256; k++) if (hist[k] > hist[bgL]) bgL = k;
  if (bgL < 150) return null;
  const photo = new Uint8Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let light = 0, n = 0;
    for (let y = gy * c; y < Math.min(H, gy * c + c); y += 2) for (let x = gx * c; x < Math.min(W, gx * c + c); x += 2) {
      const i = (y * W + x) * 4;
      if (((d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8) >= bgL - 40) light++;
      n++;
    }
    if (light < 0.25 * n && !uniformPanel(d, W, H, gx * c, gy * c, c)) photo[gy * gw + gx] = 1;
  }
  const seen = new Uint8Array(gw * gh);
  const boxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const minSide = Math.max(6, Math.round(0.06 * gw));
  for (let s = 0; s < gw * gh; s++) {
    if (!photo[s] || seen[s]) continue;
    let x0 = gw, y0 = gh, x1 = 0, y1 = 0, cnt = 0;
    const st = [s]; seen[s] = 1;
    while (st.length) {
      const k = st.pop()!, gx = k % gw, gy = (k / gw) | 0;
      cnt++;
      if (gx < x0) x0 = gx; if (gx > x1) x1 = gx; if (gy < y0) y0 = gy; if (gy > y1) y1 = gy;
      for (const q of [gx > 0 ? k - 1 : -1, gx < gw - 1 ? k + 1 : -1, gy > 0 ? k - gw : -1, gy < gh - 1 ? k + gw : -1])
        if (q >= 0 && photo[q] && !seen[q]) { seen[q] = 1; st.push(q); }
    }
    // chỉ ảnh lớn, đặc (không phải chữ đậm cỡ lớn hay đường kẻ)
    if (x1 - x0 + 1 >= minSide && y1 - y0 + 1 >= minSide && cnt > 0.35 * (x1 - x0 + 1) * (y1 - y0 + 1)) boxes.push({ x0, y0, x1, y1 });
  }
  if (!boxes.length) return null;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const o = out.getContext('2d')!;
  o.drawImage(src, 0, 0);
  o.fillStyle = '#e4e4e4';
  for (const b of boxes) o.fillRect(b.x0 * c, b.y0 * c, (b.x1 - b.x0 + 1) * c, (b.y1 - b.y0 + 1) * c);
  return out;
}
