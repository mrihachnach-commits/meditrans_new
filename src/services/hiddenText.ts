/**
 * v10.2: Phát hiện chữ ẨN trong lớp chữ PDF — chữ có trong file nhưng KHÔNG hiện trên trang:
 *  - nằm ngoài vùng cắt trang (crop box), bị cắt bởi vùng clip;
 *  - bị ảnh / mảng màu vẽ SAU đè lên (mẫu bìa InDesign: "Covertemplate", tên biên tập viên của mẫu cũ…);
 *  - cùng màu nền (chữ trắng trên nền trắng).
 * Cách làm: ghi lại từng lệnh vẽ ký tự (fillText) khi pdf.js vẽ trang, rồi vẽ lại trang một lượt nữa với mỗi dòng chữ
 * mang một "màu mã" riêng — mọi hình vẽ khác giữ nguyên nên chữ bị che/cắt sẽ không còn điểm màu mã nào trên ảnh.
 * Dòng chữ không ghi nhận được lệnh vẽ (font vẽ bằng đường nét, chữ trong nhóm trong suốt, lớp OCR ẩn của bản scan)
 * → giữ nguyên như trước (không đoán).
 */

export interface GlyphCall { x: number; y: number; fill: string; alpha: number; op: string; stroke: boolean; }
export interface BoxItem { str: string; x: number; y: number; size: number; w: number; }

/** Bọc fillText/strokeText của ctx để ghi vị trí (toạ độ thiết bị) + màu từng ký tự; trả về hàm gỡ bọc. */
export function recordGlyphs(ctx: CanvasRenderingContext2D, out: GlyphCall[]): () => void {
  const c: any = ctx;
  const ofill = c.fillText, ostroke = c.strokeText;
  const rec = (stroke: boolean) => function (this: any, s: string, x: number, y: number, ...rest: any[]) {
    try {
      const m = ctx.getTransform();
      out.push({
        x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f,
        fill: typeof ctx.fillStyle === 'string' ? ctx.fillStyle : '', alpha: ctx.globalAlpha,
        op: ctx.globalCompositeOperation, stroke,
      });
    } catch { /* ignore */ }
    return (stroke ? ostroke : ofill).call(ctx, s, x, y, ...rest);
  };
  c.fillText = rec(false);
  c.strokeText = rec(true);
  return () => { delete c.fillText; delete c.strokeText; };
}

const boxOf = (it: BoxItem) => ({
  x0: it.x - 0.35 * it.size, x1: it.x + it.w + 0.35 * it.size,
  y0: it.y - 1.0 * it.size, y1: it.y + 0.4 * it.size,
});

/** Gán từng ký tự đã vẽ cho dòng chữ chứa nó (ưu tiên theo thứ tự vẽ = thứ tự lớp chữ). */
export function makeFinder(items: BoxItem[]) {
  const boxes = items.map(boxOf);
  // ô "chặt" theo đúng bề ngang mảnh chữ — ưu tiên trước, tránh gán nhầm ký tự của mảnh kế bên ("]." sau "4")
  const tight = items.map(it => ({ x0: it.x - 0.05 * it.size - 0.5, x1: it.x + it.w + 0.02 * it.size, y0: it.y - 1.0 * it.size, y1: it.y + 0.4 * it.size }));
  let ptr = 0;
  const scan = (bx: typeof boxes, x: number, y: number) => {
    const inside = (k: number) => { const b = bx[k]; return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1; };
    for (let d = 0; d < 8; d++) { const k = ptr + d; if (k < items.length && inside(k)) return k; }
    for (let k = 0; k < items.length; k++) if (inside(k)) return k;
    return -1;
  };
  return (x: number, y: number) => {
    let k = scan(tight, x, y);
    if (k < 0) k = scan(boxes, x, y);
    if (k >= 0) ptr = k;
    return k;
  };
}

/** Gán từng ký tự đã vẽ cho dòng chữ chứa nó (ưu tiên theo thứ tự vẽ = thứ tự lớp chữ). */
export function assignGlyphs(items: BoxItem[], glyphs: { x: number; y: number }[]): number[] {
  const find = makeFinder(items);
  return glyphs.map(g => find(g.x, g.y));
}

/** Màu mã của dòng thứ k (bước 12 mỗi kênh → khác nhau rõ, không trùng màu khử răng cưa của dòng khác). */
export function codeColor(k: number): [number, number, number] {
  return [36 + (k & 15) * 12, 36 + ((k >> 4) & 15) * 12, 36 + ((k >> 8) & 15) * 12];
}

/** Bọc fillText để vẽ mỗi ký tự bằng màu mã của dòng chứa nó. */
export function codedTextHook(ctx: CanvasRenderingContext2D, items: BoxItem[]): () => void {
  const c: any = ctx;
  const ofill = c.fillText, ostroke = c.strokeText;
  const find = makeFinder(items);
  const draw = (stroke: boolean) => function (this: any, s: string, x: number, y: number, ...rest: any[]) {
    const m = ctx.getTransform();
    const k = find(m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f);
    if (k < 0) return undefined;
    const [r, g, b] = codeColor(k);
    const save = { f: ctx.fillStyle, s: ctx.strokeStyle, a: ctx.globalAlpha, o: ctx.globalCompositeOperation };
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    try { return (stroke ? ostroke : ofill).call(ctx, s, x, y, ...rest); } finally {
      ctx.fillStyle = save.f; ctx.strokeStyle = save.s; ctx.globalAlpha = save.a; ctx.globalCompositeOperation = save.o;
    }
  };
  c.fillText = draw(false);
  c.strokeText = draw(true);
  return () => { delete c.fillText; delete c.strokeText; };
}

const parseColor = (s: string): [number, number, number] | null => {
  let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/i.exec(s);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
};

/**
 * Trả về tập chỉ số các dòng chữ bị ẩn.
 * @param coded ảnh lượt vẽ màu mã (null = không có lượt này → chỉ xét ngoài trang + cùng màu nền)
 * @param bgImg ảnh nền thật không chữ (hoặc ảnh trang nếu không có) để xét "cùng màu nền"
 */
export function findHiddenItems(
  items: BoxItem[], glyphs: GlyphCall[], W: number, H: number, coded: ImageData | null, bgImg: ImageData | null,
): Set<number> {
  const hidden = new Set<number>();
  const owner = assignGlyphs(items, glyphs);
  const per: GlyphCall[][] = items.map(() => []);
  owner.forEach((k, i) => { if (k >= 0) per[k].push(glyphs[i]); });
  const drawnItems = per.filter(p => p.length).length;
  // lệnh vẽ chữ không đi qua fillText (font dạng đường nét) → không đủ dữ kiện, chỉ xét ngoài trang
  const reliable = drawnItems >= Math.max(1, 0.5 * items.filter(i => /\p{L}/u.test(i.str)).length);
  items.forEach((it, k) => {
    const b = boxOf(it);
    // 1) ngoài trang: đường chân chữ hoặc phần lớn ô chữ nằm ngoài khung
    const ix = Math.max(0, Math.min(W, it.x + it.w) - Math.max(0, it.x));
    const iy = Math.max(0, Math.min(H, it.y + 0.2 * it.size) - Math.max(0, it.y - 0.75 * it.size));
    if (it.y < 0.15 * it.size || it.y > H + 0.6 * it.size || it.x > W || it.x + it.w < 0 ||
      (it.w > 0 && ix * iy < 0.35 * it.w * 0.95 * it.size)) { hidden.add(k); return; }
    if (!reliable) return;
    // mảnh chữ rất ngắn (dấu câu, "]." , số trích dẫn) không bao giờ bị coi là ẩn — bỏ nhầm làm vỡ dòng
    if ((it.str.match(/[\p{L}\p{N}]/gu) || []).length < 3) return;
    const gs = per[k];
    if (!gs.length) return; // không ghi nhận được → giữ
    // 2) bị che / bị cắt: lượt vẽ màu mã không còn điểm nào của dòng này
    if (coded) {
      const [r, g, bb] = codeColor(k);
      const d = coded.data;
      let n = 0;
      const xa = Math.max(0, Math.floor(b.x0)), xb = Math.min(W, Math.ceil(b.x1));
      const ya = Math.max(0, Math.floor(b.y0)), yb = Math.min(H, Math.ceil(b.y1));
      for (let y = ya; y < yb && n < 40; y++) for (let x = xa; x < xb; x++) {
        const i = (y * W + x) * 4;
        if (Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - bb) <= 6) { if (++n >= 40) break; }
      }
      const need = Math.max(3, Math.min(40, 0.003 * gs.length * it.size * it.size));
      if (n < need) { hidden.add(k); return; }
    }
    // 3) cùng màu nền: màu tô của chữ ≈ màu nền thật ở mọi điểm trong ô chữ
    if (bgImg && it.size >= 8) {
      const fills = gs.filter(g => !g.stroke && g.alpha > 0.9 && g.op === 'source-over').map(g => parseColor(g.fill)).filter(Boolean) as [number, number, number][];
      if (fills.length < 0.8 * gs.length || !fills.length) return;
      const f = fills[Math.floor(fills.length / 2)];
      const d = bgImg.data;
      let near = 0, tot = 0;
      const xa = Math.max(0, Math.floor(it.x)), xb = Math.min(W, Math.ceil(it.x + it.w));
      const ya = Math.max(0, Math.floor(it.y - 0.7 * it.size)), yb = Math.min(H, Math.ceil(it.y));
      const step = Math.max(1, Math.floor(it.size / 10));
      for (let y = ya; y < yb; y += step) for (let x = xa; x < xb; x += step) {
        const i = (y * W + x) * 4;
        tot++;
        if (Math.abs(d[i] - f[0]) + Math.abs(d[i + 1] - f[1]) + Math.abs(d[i + 2] - f[2]) <= 30) near++;
      }
      if (tot >= 20 && near > 0.985 * tot) hidden.add(k);
    }
  });
  return hidden;
}
