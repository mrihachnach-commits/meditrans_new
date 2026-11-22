/**
 * v10.3: Đoạn văn VẮT CỘT — câu bắt đầu ở cuối cột trái và chạy tiếp ở đầu cột phải
 * (vd. Thyroid Ablation tr.17: chú thích "Fig. 1.2 (a) … to the recur-" | "rent laryngeal nerve. (b) …",
 * mục "Deep Cervical Fascia … divi-" | "sions: the investing …").
 * Trước đây mỗi nửa được gửi AI dịch RIÊNG → nửa sau là mẩu câu cụt ("rent laryngeal nerve") dịch vô nghĩa,
 * nửa trước kết thúc lửng. Nay: ghép các nửa thành MỘT đơn vị dịch, rồi chia bản dịch lại cho từng khung theo tỉ lệ
 * độ dài bản gốc (cắt ở khoảng trắng). Bản lưu vẫn là {câu gốc từng khối → bản dịch từng khối} như cũ.
 */
import type { LayoutBlock } from './layoutEngine';

const TAG_RE = /<(\/?)(\d+)>/g;
const ENDS_SENTENCE = /[.!?:;…]["'”’)\]]*$/;

const plainOf = (t: string) => t.replace(/<\/?\d+>/g, '');
const maxTag = (t: string) => { let m = 0; for (const x of t.matchAll(TAG_RE)) m = Math.max(m, +x[2]); return m; };

/** b là phần chạy tiếp của a ở cột kế bên? */
export function continuesInNextColumn(a: LayoutBlock, b: LayoutBlock): boolean {
  if (!a.translatable || !b.translatable || a.rotate || b.rotate || a.fromOcr || b.fromOcr || a.figLabel || b.figLabel) return false;
  const sz = Math.max(a.size, b.size);
  if (Math.abs(a.size - b.size) > 0.08 * sz || a.serif !== b.serif) return false;
  // b nằm ở cột bên phải và bắt đầu cao hơn a (đầu cột tiếp theo)
  if (b.x0 < a.x1 - 0.5 * sz || b.top > a.top + 0.6 * sz) return false; // (chú thích 2 cột: hai nửa cùng mép trên)
  if (a.col !== undefined && b.col !== undefined && (a.col < 0 || b.col < 0 || b.col !== a.col + 1)) return false;
  // độ rộng tương đương (cột cùng khổ) — không nối vào ô bảng / nhãn hẹp
  const wa = a.x1 - a.x0, wb = b.x1 - b.x0;
  if (wb < 0.6 * wa || wa < 0.6 * wb || wa < 12 * sz) return false;
  const at = plainOf(a.plain).trim(), bt = plainOf(b.plain).trim();
  if (at.length < 25 || bt.length < 3) return false;
  if (ENDS_SENTENCE.test(at)) return false;
  const hyph = /\p{L}[-‐]$/u.test(at);
  // nửa sau phải bắt đầu bằng chữ thường (giữa câu) — hoặc nửa trước kết thúc bằng gạch nối giữa từ
  if (!hyph && !/^\p{Ll}/u.test(bt)) return false;
  if (hyph && !/^\p{L}/u.test(bt)) return false;
  return true;
}

/** Chuỗi khối vắt cột: Map<id khối đầu, các khối (gồm khối đầu)>.
 *  Không dựa vào thứ tự đọc (chú thích 2 cột nằm trong cùng dải với thân bài nên hai nửa không liền nhau trong thứ tự). */
export function findColumnChains(blocks: LayoutBlock[]): Map<string, LayoutBlock[]> {
  const sameCol = (a: LayoutBlock, b: LayoutBlock) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 * Math.min(a.x1 - a.x0, b.x1 - b.x0);
  // a là khối cuối đoạn cột (ngay dưới không có khối chữ cùng cột sát liền)
  const lastInCol = (a: LayoutBlock) => !blocks.some(o => o !== a && sameCol(o, a) && o.top >= a.bottom - 0.3 * a.size && o.top - a.bottom < 1.5 * Math.max(a.size, o.size));
  // b là khối đầu đoạn cột (ngay trên không có khối chữ cùng cột sát liền)
  const firstInCol = (b: LayoutBlock) => !blocks.some(o => o !== b && sameCol(o, b) && o.bottom <= b.top + 0.3 * b.size && b.top - o.bottom < 1.5 * Math.max(b.size, o.size));
  const next = new Map<string, LayoutBlock>();
  const taken = new Set<string>();
  const heads = blocks.filter(lastInCol).sort((a, b) => a.top - b.top);
  for (const a of heads) {
    // nhiều ứng viên → lấy khối thấp nhất còn ở trên mép trên của a (cùng dải trang với a)
    const cands = blocks.filter(b => b !== a && !taken.has(b.id) && continuesInNextColumn(a, b) && firstInCol(b));
    if (!cands.length) continue;
    const b = cands.reduce((m, c) => c.top > m.top ? c : m);
    next.set(a.id, b);
    taken.add(b.id);
  }
  const chains = new Map<string, LayoutBlock[]>();
  for (const a of blocks) {
    if (taken.has(a.id) || !next.has(a.id)) continue;
    const chain = [a];
    let cur = a;
    while (next.has(cur.id) && chain.length < 4) { cur = next.get(cur.id)!; chain.push(cur); }
    chains.set(a.id, chain);
  }
  return chains;
}

/** Ghép văn bản (có thẻ kiểu chữ) của chuỗi: đánh số lại thẻ của các khối sau để không trùng. */
export function joinChainText(chain: LayoutBlock[]): { text: string; offsets: number[] } {
  let text = '';
  const offsets: number[] = [];
  let off = 0;
  chain.forEach((b, k) => {
    offsets.push(off);
    let t = b.text.trim().replace(TAG_RE, (_m, sl, n) => `<${sl}${+n + off}>`);
    if (k > 0) {
      // "recur-" + "rent" → "recurrent"; còn lại nối bằng dấu cách
      const m = /(\p{L})[-‐]((?:<\/\d+>)*)$/u.exec(text);
      if (m && /^(?:<\d+>)*\p{Ll}/u.test(t)) text = text.slice(0, m.index + 1) + m[2];
      else text += ' ';
    }
    text += t;
    off += Math.max(maxTag(b.text), b.styles?.length || 0);
  });
  return { text, offsets };
}

/** Bỏ thẻ không thuộc khối / thẻ mở-đóng lẻ sau khi cắt. */
function cleanTags(t: string, lo: number, hi: number, off: number): string {
  // giữ thẻ có số trong (lo, hi], trả về số gốc của khối
  let s = t.replace(TAG_RE, (m, sl, n) => (+n > lo && +n <= hi) ? `<${sl}${+n - off}>` : '');
  // thẻ lẻ: mở không đóng / đóng không mở
  const open: string[] = [];
  const out: string[] = [];
  let last = 0;
  for (const m of s.matchAll(TAG_RE)) {
    out.push(s.slice(last, m.index));
    last = m.index! + m[0].length;
    if (!m[1]) { open.push(m[2]); out.push(m[0]); }
    else if (open[open.length - 1] === m[2]) { open.pop(); out.push(m[0]); }
  }
  out.push(s.slice(last));
  s = out.join('');
  for (const n of open.reverse()) s += `</${n}>`;
  return s.replace(/\s+/g, ' ').trim();
}

/** Chia bản dịch của cả chuỗi thành phần cho từng khối, theo tỉ lệ độ dài bản gốc, cắt ở khoảng trắng. */
export function splitChainTranslation(v: string, chain: LayoutBlock[], offsets: number[]): string[] {
  const lens = chain.map(b => Math.max(1, plainOf(b.plain).replace(/\s+/g, '').length));
  const total = lens.reduce((a, b) => a + b, 0);
  // vị trí các khoảng trắng nằm NGOÀI thẻ, tính theo chỉ số chữ thuần
  const spaces: { raw: number; plain: number }[] = [];
  let plain = 0;
  for (let i = 0; i < v.length;) {
    if (v[i] === '<') { const m = /^<\/?\d+>/.exec(v.slice(i)); if (m) { i += m[0].length; continue; } }
    if (/\s/.test(v[i])) spaces.push({ raw: i, plain });
    else plain++;
    i++;
  }
  const cuts: number[] = [];
  let acc = 0;
  for (let k = 0; k < chain.length - 1; k++) {
    acc += lens[k];
    const want = plain * acc / total;
    let best = -1, bd = Infinity;
    for (const s of spaces) {
      if (cuts.length && s.raw <= cuts[cuts.length - 1]) continue;
      const d = Math.abs(s.plain - want);
      if (d < bd) { bd = d; best = s.raw; }
    }
    if (best < 0) break;
    cuts.push(best);
  }
  const parts: string[] = [];
  let from = 0;
  for (const c of cuts) { parts.push(v.slice(from, c)); from = c + 1; }
  parts.push(v.slice(from));
  // thẻ mở ở phần trước còn hiệu lực sang phần sau: mở lại ở đầu phần sau
  const result: string[] = [];
  let carry: string[] = [];
  parts.forEach((p, k) => {
    const withCarry = carry.map(n => `<${n}>`).join('') + p;
    const open: string[] = [];
    for (const m of withCarry.matchAll(TAG_RE)) { if (!m[1]) open.push(m[2]); else { const i = open.lastIndexOf(m[2]); if (i >= 0) open.splice(i, 1); } }
    carry = open;
    const lo = offsets[k], hi = k + 1 < offsets.length ? offsets[k + 1] : Infinity;
    result.push(cleanTags(withCarry, lo, hi, lo));
  });
  while (result.length < chain.length) result.push('');
  return result;
}
