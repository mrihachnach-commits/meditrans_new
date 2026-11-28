/**
 * v11.5: Kiểm duyệt bản dịch giữ định dạng từng trang bằng một model mạnh hơn model dịch.
 *
 * Luồng cho mỗi trang (chỉ dùng cặp câu gốc → dịch đã lưu, không đọc lại ảnh):
 *  1. Gửi các khối đã dịch cho model kiểm duyệt → chỉ nhận lỗi NẶNG (sai nghĩa, sót / thêm ý, số liệu, phủ định, trái/phải,
 *     thuật ngữ, sót tiếng Anh) kèm bản sửa của khối.
 *  2. Lọc bản sửa bằng luật trên máy: giữ đủ thẻ <n>, khớp số liệu (numericQa), độ dài hợp lý.
 *  3. (L2) Kiểm lại MỘT lần các khối đã sửa. Đạt → nhận bản sửa; vẫn lỗi → giữ bản cũ, đánh dấu "cần duyệt".
 *     Không lặp quá một vòng (tránh vòng lặp và chi phí).
 *  4. Học: lỗi thuật ngữ đã sửa đạt → thêm "thuật ngữ = cách dịch" vào bảng thuật ngữ riêng của tài liệu (các trang sau dịch đúng
 *     ngay); bộ nhớ dịch được ghi đè bằng bản sửa.
 */
import type { LayoutPair, PageReview } from './layoutTranslationService';
import { isOcrKey, rememberSourceTranslation, withReview } from './layoutTranslationService';
import { checkNumeric } from './numericQa';
import { getActiveGlossaryDoc, getDocGlossaryText, glossaryMatches, setDocGlossaryText } from './medicalGlossary';

export interface Reviewer {
  reviewLayoutBlocks(items: { id: string; en: string; vi: string }[], signal?: AbortSignal): Promise<RawIssue[]>;
  reviewModelName(): string;
}
interface RawIssue { id: string; type: string; note: string; fix?: string; term_en?: string; term_vi?: string }

const SERIOUS = new Set(['meaning', 'omission', 'addition', 'number', 'negation', 'laterality', 'term', 'untranslated']);
export const ISSUE_LABEL: Record<string, string> = {
  meaning: 'Sai nghĩa', omission: 'Sót ý', addition: 'Thêm ý', number: 'Số liệu', negation: 'Phủ định',
  laterality: 'Trái/phải', term: 'Thuật ngữ', untranslated: 'Sót tiếng Anh', other: 'Khác',
};

const tagsOf = (t: string) => (t.match(/<\/?\d+>/g) || []).sort().join('');
const plain = (t: string) => t.replace(/<\/?\d+>/g, '').replace(/\s+/g, ' ').trim();

/** Khối đáng gửi kiểm duyệt: đã dịch (khác bản gốc), có chữ, không phải dữ liệu đặc biệt. */
function reviewable(p: LayoutPair): boolean {
  if (isOcrKey(p.s) || !p.v) return false;
  const s = plain(p.s), v = plain(p.v);
  if (!/\p{L}{2}/u.test(s) || s === v) return false;
  return true;
}

/** Ước lượng token một lượt kiểm duyệt (≈ 4 ký tự / token tiếng Anh, tiếng Việt tốn hơn). */
export function estimateReviewTokens(pairs: LayoutPair[]): number {
  const items = pairs.filter(reviewable);
  const chars = items.reduce((n, p) => n + p.s.length + p.v.length * 1.6 + 30, 0);
  return items.length ? Math.round(900 + chars / 3.6) : 0;
}

function chunk<T extends { en: string; vi: string }>(items: T[], maxChars = 7000, maxItems = 60): T[][] {
  const out: T[][] = [];
  let cur: T[] = [], n = 0;
  for (const it of items) {
    const c = it.en.length + it.vi.length;
    if (cur.length && (n + c > maxChars || cur.length >= maxItems)) { out.push(cur); cur = []; n = 0; }
    cur.push(it); n += c;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Bản sửa có dùng được không (luật trên máy, không tốn token). */
function acceptableFix(src: string, oldV: string, fix?: string): boolean {
  if (!fix) return false;
  const f = plain(fix);
  if (!f || f === plain(oldV) || f === plain(src)) return false;
  if (/<\/?\d+>/.test(src) && tagsOf(src) !== tagsOf(fix)) return false;
  if (!/<\/?\d+>/.test(src) && /<\/?\d+>/.test(fix)) return false;
  if (checkNumeric(src, fix)) return false;
  // bản sửa thêm con số không có trong bản gốc (AI bịa số) → không nhận
  const nums = (t: string) => (plain(t).match(/\d+(?:[.,]\d+)?/g) || []).map(n => n.replace(',', '.'));
  const srcNums = new Set(nums(src));
  if (nums(fix).some(n => !srcNums.has(n))) return false;
  const r = f.length / Math.max(1, plain(src).length);
  return r > 0.3 && r < 3.5;
}

function learnTerm(en: string, vi: string, src: string, fix: string): boolean {
  const docKey = getActiveGlossaryDoc();
  en = en.replace(/\s+/g, ' ').trim(); vi = vi.replace(/\s+/g, ' ').trim();
  if (!docKey || en.length < 3 || en.length > 60 || !vi || vi.length > 80 || /[=\n]/.test(en + vi)) return false;
  if (!src.toLowerCase().includes(en.toLowerCase()) || !fix.toLowerCase().includes(vi.toLowerCase())) return false;
  if (en.split(' ').length === 1 && en.length < 5) return false; // từ quá ngắn / mơ hồ: không ép cứng
  // bảng chung đã có thuật ngữ này → không ghi đè (bảng chung luôn được ưu tiên)
  if (glossaryMatches(en).some(g => g.en.toLowerCase() === en.toLowerCase())) return false;
  const text = getDocGlossaryText(docKey);
  const lines = text.split('\n');
  const idx = lines.findIndex(l => l.split('=')[0].trim().toLowerCase() === en.toLowerCase());
  const line = `${en} = ${vi}`;
  if (idx >= 0) { if (lines[idx].trim() === line) return false; lines[idx] = line; }
  else {
    if (!lines.some(l => l.startsWith('# Học từ kiểm duyệt'))) lines.push('# Học từ kiểm duyệt (v11.5) — sửa / xoá được');
    lines.push(line);
  }
  setDocGlossaryText(docKey, lines.join('\n').replace(/^\n+/, ''));
  return true;
}

export interface ReviewOutcome {
  pairs: LayoutPair[];
  review: PageReview;
  learned: number;
}

export async function reviewPagePairs(
  pairs: LayoutPair[], reviewer: Reviewer, opts: { autoFix: boolean; learn: boolean; signal?: AbortSignal },
): Promise<ReviewOutcome> {
  const model = reviewer.reviewModelName();
  const idxs = pairs.map((p, i) => (reviewable(p) ? i : -1)).filter(i => i >= 0);
  const items = idxs.map((i, k) => ({ id: `b${k + 1}`, en: pairs[i].s, vi: pairs[i].v, at: i }));
  if (!items.length) {
    const review: PageReview = { status: 'ok', model, at: Date.now() };
    return { pairs: withReview(pairs, review), review, learned: 0 };
  }
  const run = async (list: typeof items) => {
    const parts = chunk(list);
    const res = await Promise.all(parts.map(p => reviewer.reviewLayoutBlocks(p.map(({ id, en, vi }) => ({ id, en, vi })), opts.signal)));
    return res.flat().filter(x => SERIOUS.has(x.type));
  };
  const first = await run(items);
  const byId = new Map(items.map(i => [i.id, i]));
  const out = pairs.map(p => ({ ...p }));
  const remaining: NonNullable<PageReview['issues']> = [];
  let fixed = 0, learned = 0;

  // một khối có thể bị báo nhiều lỗi: gộp ghi chú, lấy bản sửa đầu tiên dùng được
  const grouped = new Map<string, RawIssue[]>();
  for (const x of first) { const g = grouped.get(x.id); if (g) g.push(x); else grouped.set(x.id, [x]); }

  const candidates: { id: string; fix: string; issues: RawIssue[] }[] = [];
  for (const [id, iss] of grouped) {
    const it = byId.get(id)!;
    const fix = opts.autoFix ? iss.map(x => x.fix).find(f => acceptableFix(it.en, it.vi, f)) : undefined;
    if (fix) candidates.push({ id, fix, issues: iss });
    else remaining.push({ s: it.en, type: iss[0].type, note: iss.map(x => x.note).filter(Boolean).join('; ').slice(0, 300), fix: iss.find(x => x.fix)?.fix });
  }

  if (candidates.length) {
    // L2: kiểm lại một lần đúng các khối đã sửa (kèm khối liền trước/sau để model hiểu câu vắt khối)
    const ctxIds = new Set<string>();
    for (const c of candidates) {
      const k = items.findIndex(i => i.id === c.id);
      [k - 1, k, k + 1].forEach(j => { if (items[j]) ctxIds.add(items[j].id); });
    }
    const fixOf = new Map(candidates.map(c => [c.id, c.fix]));
    const recheckList = items.filter(i => ctxIds.has(i.id)).map(i => ({ ...i, vi: fixOf.get(i.id) ?? i.vi }));
    let second: RawIssue[] = [];
    let recheckFailed = false;
    try { second = await run(recheckList); } catch (e) { if (opts.signal?.aborted) throw e; recheckFailed = true; }
    const stillBad = new Set(second.map(x => x.id));
    for (const c of candidates) {
      const it = byId.get(c.id)!;
      if (recheckFailed || stillBad.has(c.id)) {
        const again = second.filter(x => x.id === c.id).map(x => x.note);
        remaining.push({ s: it.en, type: c.issues[0].type, note: [...c.issues.map(x => x.note), ...again.map(n => `kiểm lại: ${n}`)].filter(Boolean).join('; ').slice(0, 300), fix: c.fix });
        continue;
      }
      out[it.at].v = c.fix;
      fixed++;
      rememberSourceTranslation(it.en, c.fix);
      if (opts.learn) {
        for (const x of c.issues) if (x.type === 'term' && x.term_en && x.term_vi && learnTerm(x.term_en, x.term_vi, plain(it.en), plain(c.fix))) learned++;
      }
    }
  }

  const review: PageReview = {
    status: remaining.length ? 'issues' : fixed ? 'fixed' : 'ok',
    model, at: Date.now(),
    issues: remaining.length ? remaining : undefined,
    fixed: fixed || undefined,
  };
  return { pairs: withReview(out, review), review, learned };
}
