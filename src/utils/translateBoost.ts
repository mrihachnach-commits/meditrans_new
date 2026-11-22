/**
 * Tăng tốc & bảo đảm chất lượng cho dịch thường / dịch nâng cao.
 *  - splitMarkdownForParallel: trang dài → 2–3 phần cắt tại ranh giới đoạn, dịch song song (thời gian chờ AI
 *    tỉ lệ với độ dài bản dịch phải viết ra → chia đôi ≈ nhanh gấp đôi).
 *  - fixUntranslatedLines: dòng còn sót tiếng Anh (AI bỏ quên) → dịch bù riêng các dòng đó.
 */

/** Cắt Markdown thành các phần gần bằng nhau tại dòng trống (không cắt giữa đoạn / bảng / danh sách). */
// Chỉ chia khi trang RẤT dài (> 5.000 ký tự), tối đa 2 phần: mỗi phần lặp lại hướng dẫn hệ thống và phần "suy nghĩ"
// của model (Gemini 3 không tắt được) → chia nhỏ quá thì tốn token hơn nhiều so với lợi về tốc độ.
export function splitMarkdownForParallel(md: string, minChars = 5000, maxParts = 2, targetChars = 3500): string[] {
  const text = md.trim();
  if (text.length < minChars) return [text];
  const blocks = text.split(/\n{2,}/);
  if (blocks.length < 2) return [text];
  const parts = Math.min(maxParts, Math.max(2, Math.round(text.length / targetChars)));
  const target = text.length / parts;
  const out: string[] = [];
  let cur: string[] = [];
  let len = 0;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    cur.push(b);
    len += b.length + 2;
    const remainingParts = parts - out.length - 1;
    const isHeading = /^#{1,6}\s/.test(b) || /^\*\*[^*]+\*\*$/.test(b.trim());
    // Không để tiêu đề đứng cuối một phần (tiêu đề phải đi cùng đoạn ngay sau nó)
    if (remainingParts > 0 && len >= target && !isHeading && i < blocks.length - 1) {
      out.push(cur.join('\n\n'));
      cur = [];
      len = 0;
    }
  }
  if (cur.length) out.push(cur.join('\n\n'));
  return out.filter(p => p.trim());
}

const EN_STOP = new Set([
  'the', 'and', 'of', 'with', 'is', 'are', 'was', 'were', 'for', 'which', 'that', 'this', 'these', 'those',
  'by', 'from', 'as', 'be', 'or', 'it', 'its', 'may', 'can', 'should', 'will', 'has', 'have', 'been', 'not',
  'into', 'their', 'there', 'when', 'than', 'such', 'also', 'but', 'more', 'most', 'other', 'between', 'within',
]);
const VI_MARK = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;

/** Dòng còn là tiếng Anh: nhiều từ chức năng tiếng Anh và gần như không có chữ có dấu tiếng Việt. */
function looksEnglish(body: string): boolean {
  const words = body.match(/[A-Za-zÀ-ỹ]+/g) || [];
  if (words.length < 5) return false;
  const stop = words.filter(w => EN_STOP.has(w.toLowerCase())).length;
  const vi = words.filter(w => VI_MARK.test(w)).length;
  return vi / words.length < 0.1 && ((stop >= 3 && stop / words.length >= 0.15) || (stop >= 2 && stop / words.length >= 0.25));
}

/** Tài liệu tham khảo (giữ nguyên tiếng Anh là đúng). */
const isReference = (s: string) => /\bet al\.|\bdoi\b|\b(19|20)\d{2}[;:,]\s*\d|\bJ\s?[A-Z][a-z]+\b.*\d{4}/.test(s);

interface LayoutTranslator {
  translateLayoutBlocks(blocks: { id: string; text: string }[], signal?: AbortSignal): Promise<Record<string, string>>;
}

/**
 * Tìm các dòng còn sót tiếng Anh trong bản dịch Markdown và dịch bù (giữ nguyên tiền tố Markdown: ###, -, 1., >,
 * in đậm cả dòng). Không có dòng nào sót → trả nguyên văn, không gọi AI.
 */
export async function fixUntranslatedLines(md: string, svc: LayoutTranslator | null | undefined, signal?: AbortSignal): Promise<string> {
  if (!svc?.translateLayoutBlocks || !md) return md;
  const lines = md.split('\n');
  const todo: { idx: number; prefix: string; body: string; bold: boolean; cell?: number }[] = [];
  lines.forEach((line, idx) => {
    if (/^\s*```/.test(line)) return; // khối mã: bỏ qua
    if (/^\s*\|/.test(line)) { // bảng: xét từng ô (bỏ hàng phân cách |---|)
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) return;
      line.split('|').forEach((cell, ci) => {
        const body = cell.trim();
        if (body && looksEnglish(body) && !isReference(body)) todo.push({ idx, prefix: '', body, bold: false, cell: ci });
      });
      return;
    }
    const m = line.match(/^(\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)?)(.*)$/);
    if (!m) return;
    let body = m[2];
    const bold = /^\*\*[\s\S]+\*\*$/.test(body.trim());
    if (bold) body = body.trim().slice(2, -2);
    if (!looksEnglish(body) || isReference(body) || isReferenceLine(line)) return;
    todo.push({ idx, prefix: m[1], body, bold });
  });
  if (!todo.length) return md;
  try {
    const res = await svc.translateLayoutBlocks(todo.map((t, i) => ({ id: `l${i}`, text: t.body })), signal);
    todo.forEach((t, i) => {
      const v = res[`l${i}`]?.trim().replace(/\|/g, '/');
      if (!v || looksEnglish(v)) return;
      if (t.cell !== undefined) {
        const cells = lines[t.idx].split('|');
        cells[t.cell] = ` ${v} `;
        lines[t.idx] = cells.join('|');
      } else {
        lines[t.idx] = t.prefix + (t.bold ? `**${v}**` : v);
      }
    });
    console.log(`[MediTrans] Đã dịch bù ${todo.length} dòng còn sót tiếng Anh.`);
  } catch (e) {
    if (signal?.aborted) throw e;
    console.warn('[MediTrans] Dịch bù dòng sót tiếng Anh thất bại:', e);
  }
  return lines.join('\n');
}

/* ---------------- Tài liệu tham khảo: giữ nguyên, KHÔNG gửi AI (tiết kiệm token) ---------------- */

/** Một dòng là mục tài liệu tham khảo: bắt đầu bằng tên tác giả + chữ viết tắt, có năm và dấu hiệu trích dẫn. */
export function isReferenceLine(line: string): boolean {
  const t = line.replace(/^\s*(?:[-*+]\s+|\d{1,3}[.)]\s+|\[\d{1,3}\]\s*)/, '').replace(/\*\*/g, '').trim();
  if (t.length < 25) return false;
  if (!/\b(19|20)\d{2}[a-z]?\b/.test(t)) return false;
  const author = /^[A-ZÀ-Ý][\p{L}'’\-]+(?:\s+[A-Z][\p{L}'’\-]+)?,?\s+(?:[A-Z]{1,3}\b|[A-Z]\.(?:\s?[A-Z]\.)*)/u.test(t);
  const cite = /\bet al\b|\bdoi\b|\b(19|20)\d{2}[a-z]?\s*[;.,:]\s*\(?\d|\d+\s*\(\d+\)\s*:\s*\d|:\s*\d+\s*[–-]\s*\d+|\bpp?\.\s*\d|\bIn:\s|\b(?:Springer|Elsevier|Wiley|Lippincott|Thieme)\b/i.test(t);
  return author && cite;
}

export interface MdSegment { text: string; passthrough: boolean; }

/**
 * Tách Markdown thành các đoạn cần dịch và các cụm TÀI LIỆU THAM KHẢO (≥ 2 mục liền nhau) giữ nguyên.
 * Trang tài liệu tham khảo cuối mỗi chương rất dài; trước đây gửi AI cả trang và AI viết lại y nguyên
 * → tốn hàng nghìn token đầu ra mà không đổi gì.
 */
export function splitReferenceSegments(md: string): MdSegment[] {
  const lines = md.split('\n');
  const isRef = lines.map(isReferenceLine);
  const out: MdSegment[] = [];
  let i = 0;
  while (i < lines.length) {
    if (isRef[i]) {
      let j = i;
      // cụm tham khảo: các dòng tham khảo liền nhau (cho phép dòng trống xen giữa)
      while (j + 1 < lines.length && (isRef[j + 1] || (!lines[j + 1].trim() && j + 2 < lines.length && isRef[j + 2]))) j++;
      const run = lines.slice(i, j + 1);
      if (run.filter(l => l.trim()).length >= 2) {
        out.push({ text: run.join('\n').trim(), passthrough: true });
        i = j + 1;
        continue;
      }
    }
    const last = out[out.length - 1];
    if (last && !last.passthrough) last.text += '\n' + lines[i];
    else out.push({ text: lines[i], passthrough: false });
    i++;
  }
  return out.map(s => ({ ...s, text: s.text.trim() })).filter(s => s.text);
}
