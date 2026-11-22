/**
 * v10.4: Đối chiếu số liệu y khoa giữa bản gốc và bản dịch (không gọi AI).
 *
 * Bắt các lỗi làm đổi nghĩa lâm sàng: số bị mất/đổi (5 mg → 50 mg, p < 0,05 → p < 0,5), dấu so sánh bị mất
 * (≤ ≥ < > ±), đơn vị bị mất/đổi (mg → g, mL → L). Không tự sửa — chỉ báo để dịch lại hoặc để người dùng duyệt.
 *
 * Quy ước để không báo nhầm:
 *  - Dấu thập phân / phân nghìn khác nhau giữa tiếng Anh và tiếng Việt (1.5 ↔ 1,5; 1,000 ↔ 1.000; 1000 ↔ 1.000;
 *    [1,2] ↔ [1, 2]) đều coi là khớp.
 *  - Chỉ báo số BỊ MẤT so với bản gốc; số thêm vào (AI viết "hai" thành "2") không báo.
 *  - Số thứ tự tiếng Anh (1st, 2nd, 19th…) được phép dịch thành chữ.
 */

export interface NumericIssue {
  /** Số có ở bản gốc nhưng không thấy trong bản dịch. */
  numbers: string[];
  /** Dấu so sánh / toán học bị thiếu. */
  symbols: string[];
  /** Đơn vị bị thiếu. */
  units: string[];
  /** Đại lượng (dấu + số + đơn vị đi liền nhau, vd "< 0.05", "5 mg/kg", "35%") không còn nguyên vẹn trong bản dịch. */
  quantities: string[];
}

const stripTags = (t: string) => t.replace(/<\/?\d+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Số: chữ số, có thể kèm dấu phân cách . , (không kèm khoảng trắng)
const NUM_RE = /\d+(?:[.,]\d+)*/g;
const ORDINAL_RE = /\b\d+(?:st|nd|rd|th)\b/gi;

function numberTokens(t: string, ordinalsOk: boolean): { canon: string[]; split: string[]; raw: string[] } {
  let s = t;
  if (ordinalsOk) s = s.replace(ORDINAL_RE, ' ');
  const raw = s.match(NUM_RE) || [];
  const norm = (d: string) => d; // giữ số 0 đầu: 0.05 ≠ 0,5
  return {
    raw,
    canon: raw.map(n => norm(n.replace(/[.,]/g, ''))),
    split: raw.flatMap(n => n.split(/[.,]/).map(norm)),
  };
}

/** Phần tử có trong a nhưng thiếu trong b (theo số lần xuất hiện). */
function missingFrom(a: string[], b: string[]): string[] {
  const cnt = new Map<string, number>();
  for (const x of b) cnt.set(x, (cnt.get(x) || 0) + 1);
  const out: string[] = [];
  for (const x of a) {
    const c = cnt.get(x) || 0;
    if (c > 0) cnt.set(x, c - 1); else out.push(x);
  }
  return out;
}

function normSymbols(t: string): string {
  return t
    .replace(/<=|=</g, '≤').replace(/>=|=>/g, '≥')
    .replace(/\+\/-|\+-/g, '±')
    // "×" hay bị viết thành "x" giữa hai số (3 x 4 cm)
    .replace(/(\d)\s*[xX]\s*(?=\d)/g, '$1×');
}
/** Cách viết bằng lời hợp lệ trong bản dịch tiếng Việt → ký hiệu (chỉ khi đứng ngay trước số). */
function normVerbalVi(t: string): string {
  const N = '\\s*(?=[-−]?\\d)';
  return t
    // "từ 4 cm trở lên" = ≥ 4 cm; "từ 2 mm trở xuống" = ≤ 2 mm
    .replace(/từ\s*(\d[\d.,]*(?:\s?[%\p{L}µμ/]+)?)\s*trở lên/giu, '≥$1')
    .replace(/từ\s*(\d[\d.,]*(?:\s?[%\p{L}µμ/]+)?)\s*trở xuống/giu, '≤$1')
    .replace(new RegExp('(nhỏ hơn hoặc bằng|thấp hơn hoặc bằng|bé hơn hoặc bằng|không quá|không vượt quá|tối đa là|tối đa)' + N, 'gi'), '≤')
    .replace(new RegExp('(lớn hơn hoặc bằng|cao hơn hoặc bằng|ít nhất là|ít nhất|tối thiểu là|tối thiểu|không dưới|không thấp hơn)' + N, 'gi'), '≥')
    .replace(new RegExp('(nhỏ hơn|thấp hơn|bé hơn|ít hơn|dưới)' + N, 'gi'), '<')
    .replace(new RegExp('(lớn hơn|cao hơn|nhiều hơn|trên|vượt quá)' + N, 'gi'), '>')
    .replace(/cộng\s*(?:\/\s*)?trừ\s*/gi, '±')
    .replace(/(\d)\s*phần trăm/gi, '$1%')
    .replace(/(\d)\s*mililít\b/gi, '$1 ml').replace(/(\d)\s*lít\b/gi, '$1 l')
    .replace(/(\d)\s*miligam\b/gi, '$1 mg').replace(/(\d)\s*kilôgam\b|(\d)\s*kilogam\b/gi, (_m, a, b) => `${a || b} kg`)
    .replace(/(\d)\s*gam\b/gi, '$1 g')
    .replace(/(\d)\s*milimét\b/gi, '$1 mm').replace(/(\d)\s*(?:centimét|xentimét)\b/gi, '$1 cm');
}
const SYMBOLS = ['≤', '≥', '<', '>', '±', '×', '%'];
const countOf = (t: string, ch: string) => t.split(ch).length - 1;

// Đơn vị y khoa hay gặp ngay sau số. Không xét đơn vị thời gian (h, min, s — AI dịch thành giờ/phút/giây).
const UNIT_ALIASES: Record<string, string> = {
  mcg: 'µg', ug: 'µg', 'μg': 'µg', 'µg': 'µg',
  'μmol': 'µmol', umol: 'µmol', 'µmol': 'µmol',
  cc: 'ml',
};
const UNIT_LIST = [
  'mg', 'kg', 'µg', 'μg', 'mcg', 'ug', 'ng', 'pg', 'g',
  'ml', 'dl', 'cc', 'l',
  'mmol', 'µmol', 'μmol', 'umol', 'nmol', 'pmol', 'meq', 'mosm',
  'iu', 'miu', 'u',
  'mm', 'cm', 'µm', 'nm',
  'gy', 'cgy', 'mgy', 'msv', 'sv', 'bq', 'kbq', 'mbq', 'gbq', 'mci', 'µci', 'ci',
  'mhz', 'khz', 'hz', 'mmhg', 'kpa', 'kev', 'mev', 'kv', 'kvp', 'mas', 'ma', 'w', 'kcal',
];
// Đơn vị dài trước để "mmol" không bị bắt thành "mm"
const UNIT_RE = new RegExp(
  '(\\d)\\s?(' + [...UNIT_LIST].sort((a, b) => b.length - a.length).map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?=$|[^\\p{L}])',
  'giu',
);
// Tên tiếng Việt AI có thể dùng cho đơn vị
const UNIT_VI: Record<string, RegExp> = {
  l: /\blít\b/i, ml: /\bmililít\b/i, g: /\bgam\b/i, kg: /\bkilôgam|kilogam\b/i, mm: /\bmilimét\b/i, cm: /\bcentimét|xentimét\b/i,
};

function unitTokens(t: string): string[] {
  const out: string[] = [];
  for (const m of t.matchAll(UNIT_RE)) {
    const u = m[2].toLowerCase();
    out.push(UNIT_ALIASES[u] || u);
  }
  return out;
}

const UNIT_ALT = [...UNIT_LIST].sort((a, b) => b.length - a.length).map(u => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const QTY_RE = new RegExp('([≤≥<>±])?\\s*(\\d+(?:(?:[.,]|[ \\u00a0\\u202f](?=\\d{3}(?!\\d)))\\d+)*)(?:\\s?(%|(?:' + UNIT_ALT + ')(?=$|[^\\p{L}])))?', 'giu');
/** Đại lượng có dấu so sánh hoặc đơn vị đi kèm — khoá "dấu|số|đơn vị". Số trần không xét ở đây. */
interface Qty { key: string; cmp: string; core: string; shown: string }
function quantityTokens(t: string): Qty[] {
  const out: Qty[] = [];
  for (const m of t.matchAll(QTY_RE)) {
    const cmp = m[1] || '';
    const unit = m[3] ? (UNIT_ALIASES[m[3].toLowerCase()] || m[3].toLowerCase()) : '';
    if (!cmp && !unit) continue;
    const core = `${m[2].replace(/[.,\s\u00a0\u202f]/g, '')}|${unit}`;
    out.push({ key: `${cmp}|${core}`, cmp, core, shown: m[0].trim() });
  }
  return out;
}

/** Không có chữ số nào → không cần kiểm tra (đa số khối). */
export function hasNumericContent(text: string): boolean {
  return /\d/.test(text);
}

/**
 * Đối chiếu một cặp gốc/dịch. Trả null nếu khớp (hoặc không có gì để kiểm tra).
 */
export function checkNumeric(source: string, translation: string): NumericIssue | null {
  const src = normSymbols(stripTags(source));
  const dst = normSymbols(normVerbalVi(stripTags(translation)));
  if (!/\d|[≤≥±]/.test(src)) return null;
  if (!dst.trim()) return null; // chưa dịch — việc của bước "dịch bù"

  // Số
  const a = numberTokens(src, true);
  const b = numberTokens(dst, false);
  let numbers: string[] = [];
  const missCanon = missingFrom(a.canon, b.canon);
  if (missCanon.length) {
    const missSplit = missingFrom(a.split, b.split);
    if (missSplit.length) {
      // Báo theo dạng viết của bản gốc cho dễ đọc
      const shown: string[] = [];
      const pool = [...missCanon];
      for (const r of a.raw) {
        const c = r.replace(/[.,]/g, '');
        const k = pool.indexOf(c);
        if (k >= 0) { shown.push(r); pool.splice(k, 1); }
      }
      numbers = shown.length ? shown : missCanon;
    }
  }

  // Dấu
  const symbols: string[] = [];
  for (const s of SYMBOLS) {
    let need = countOf(src, s);
    if (!need) continue;
    let have = countOf(dst, s);
    // "<"/">" có thể được viết thành ≤/≥ hoặc ngược lại thì vẫn báo — đổi nghĩa
    if (s === '%') have += (dst.match(/phần trăm/gi) || []).length;
    if (have < need) symbols.push(s);
  }

  // Đại lượng: số phải còn gắn đúng dấu so sánh đứng trước và đơn vị đứng sau (5 mg và 10 mL không được đổi chỗ thành 10 mg, 5 mL)
  const sq = quantityTokens(src);
  const dq = quantityTokens(dst);
  // Bản gốc không có dấu mà bản dịch có ("larger than 1.5 cm" → "lớn hơn 1,5 cm") vẫn khớp
  const pool = [...dq];
  const missQ: Qty[] = [];
  for (const q of [...sq].sort((a, b) => (b.cmp ? 1 : 0) - (a.cmp ? 1 : 0))) {
    const k = pool.findIndex(d => d.core === q.core && (d.cmp === q.cmp || !q.cmp));
    if (k >= 0) pool.splice(k, 1); else missQ.push(q);
  }
  const quantities: string[] = [];
  for (const q of missQ) if (!quantities.includes(q.shown)) quantities.push(q.shown);

  // Đơn vị
  const su = unitTokens(src);
  const du = unitTokens(dst);
  let units = missingFrom(su, du);
  units = units.filter(u => !(UNIT_VI[u]?.test(dst)));
  units = [...new Set(units)];

  // Số đã báo ở "đại lượng" thì không nhắc lại ở "số"
  const qNums = new Set(missQ.map(q => q.core.split('|')[0]));
  numbers = numbers.filter(n => !qNums.has(n.replace(/[.,]/g, '')));
  if (!numbers.length && !symbols.length && !units.length && !quantities.length) return null;
  return { numbers, symbols, units, quantities };
}

/** Mô tả ngắn cho giao diện: "thiếu số 5, 0.05; dấu <; đơn vị mg". */
export function describeNumericIssue(i: NumericIssue): string {
  const parts: string[] = [];
  if (i.numbers.length) parts.push(`số ${i.numbers.slice(0, 6).join(', ')}${i.numbers.length > 6 ? '…' : ''}`);
  if (i.symbols.length) parts.push(`dấu ${i.symbols.join(' ')}`);
  if (i.quantities.length) parts.push(`đại lượng ${i.quantities.slice(0, 5).join('; ')}`);
  if (i.units.length) parts.push(`đơn vị ${i.units.join(', ')}`);
  return 'Bản dịch thiếu ' + parts.join('; ');
}

/** Mức "tệ" của một bản dịch để chọn bản tốt hơn giữa hai lần dịch. */
export function numericScore(i: NumericIssue | null): number {
  return i ? i.numbers.length * 2 + i.quantities.length * 2 + i.symbols.length * 2 + i.units.length : 0;
}
