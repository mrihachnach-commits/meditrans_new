/**
 * v10.4: plugin rehype làm sạch HTML sau rehype-raw theo DANH SÁCH CHO PHÉP (allowlist).
 *
 * Nội dung bản dịch / tóm tắt do AI trả về (có thể bị chèn lệnh qua văn bản PDF) được hiển thị dạng HTML thô.
 * v10.3 chặn theo danh sách cấm; nay chỉ GIỮ những gì cần cho Markdown + định dạng y khoa, mọi thứ khác bị bỏ:
 *  - Thẻ ngoài danh sách: bỏ thẻ nhưng giữ chữ bên trong (không mất nội dung); thẻ nguy hiểm (script, style, iframe,
 *    svg, math, form…) bỏ cả nội dung.
 *  - Thuộc tính: chỉ những thuộc tính liệt kê cho từng thẻ; style chỉ giữ vài thuộc tính trình bày an toàn.
 *  - URL: chỉ http(s), mailto, tel, liên kết nội bộ (#, /), ảnh data:image raster.
 */

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'caption', 'code', 'col', 'colgroup', 'dd', 'del', 'div', 'dl', 'dt', 'em',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'li', 'mark', 'ol', 'p', 'pre', 'q',
  's', 'section', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead',
  'tr', 'u', 'ul',
]);

// Bỏ cả nội dung (chữ bên trong không phải nội dung hiển thị / có thể là mã)
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'template', 'noscript', 'noembed',
  'noframes', 'textarea', 'select', 'option', 'title', 'head', 'svg', 'math', 'canvas', 'audio', 'video', 'source',
  'track', 'link', 'meta', 'base', 'button', 'form', 'portal', 'dialog', 'xmp', 'plaintext', 'listing',
]);

const GLOBAL_ATTRS = new Set(['className', 'title', 'id', 'lang', 'dir', 'style', 'ariaLabel', 'ariaHidden', 'ariaDescribedBy',
  'dataFootnotes', 'dataFootnoteRef', 'dataFootnoteBackref', 'role']);
const TAG_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel']),
  img: new Set(['src', 'alt', 'width', 'height']),
  td: new Set(['colSpan', 'rowSpan', 'align']),
  th: new Set(['colSpan', 'rowSpan', 'align', 'scope']),
  col: new Set(['span']),
  colgroup: new Set(['span']),
  ol: new Set(['start', 'type', 'reversed']),
  li: new Set(['value']),
  input: new Set(['type', 'checked', 'disabled']),
  q: new Set(['cite']),
  abbr: new Set([]),
};

const SAFE_STYLE_PROPS = new Set([
  'color', 'background-color', 'font-weight', 'font-style', 'text-align', 'text-decoration', 'vertical-align',
  'text-transform', 'white-space', 'font-size', 'border', 'border-collapse', 'padding', 'margin-left', 'width',
]);

const cleanStyle = (value: string): string => {
  const out: string[] = [];
  for (const decl of value.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop)) continue;
    // Không cho url(), expression(), @import, ký tự thoát CSS, javascript:
    if (/url\s*\(|expression|@import|javascript:|\\|[<>]/i.test(val)) continue;
    if (val.length > 100) continue;
    out.push(`${prop}: ${val}`);
  }
  return out.join('; ');
};

const isSafeUrl = (value: string, tagName: string, prop: string): boolean => {
  // Bỏ ký tự điều khiển / khoảng trắng mà trình duyệt bỏ qua khi phân tích scheme (vd. "java\tscript:")
  const v = value.replace(/[\u0000- \u007f-\u009f]+/g, '').toLowerCase();
  if (!v) return true;
  if (v.startsWith('#') || v.startsWith('/') && !v.startsWith('//')) return true;
  if (/^(https?:|mailto:|tel:)/.test(v)) return true;
  if (tagName === 'img' && prop === 'src') return /^data:image\/(png|jpe?g|gif|webp|bmp);/.test(v);
  // Đường dẫn tương đối không có scheme ("page.html", "./x")
  return !/^[a-z][a-z0-9+.-]*:/.test(v) && !v.startsWith('//');
};

const URL_ATTRS = new Set(['href', 'src', 'cite']);

const sanitizeProperties = (node: any) => {
  const props = node.properties;
  if (!props || typeof props !== 'object') { node.properties = {}; return; }
  const tag = node.tagName;
  const allowed = TAG_ATTRS[tag];
  for (const key of Object.keys(props)) {
    if (!(GLOBAL_ATTRS.has(key) || allowed?.has(key))) { delete props[key]; continue; }
    const value = props[key];
    if (key === 'style') {
      const v = typeof value === 'string' ? cleanStyle(value) : '';
      if (v) props[key] = v; else delete props[key];
      continue;
    }
    if (URL_ATTRS.has(key)) {
      const vals = Array.isArray(value) ? value : [value];
      if (vals.some(v => typeof v !== 'string' || !isSafeUrl(v, tag, key))) delete props[key];
      continue;
    }
    // id: thêm tiền tố để không đè biến toàn cục (DOM clobbering); id chú thích của remark-gfm đã có "user-content-"
    if (key === 'id' && typeof value === 'string' && !value.startsWith('user-content-') && value !== 'footnote-label') props[key] = `user-content-${value}`;
  }
  if (tag === 'input') {
    // Chỉ ô checkbox chỉ đọc của danh sách việc (remark-gfm)
    props.type = 'checkbox';
    props.disabled = true;
  }
  // Liên kết mở tab mới phải kèm rel an toàn
  if (tag === 'a' && props.target) props.rel = ['noopener', 'noreferrer'];
};

const sanitizeChildren = (parent: any) => {
  if (!parent || !Array.isArray(parent.children)) return;
  const next: any[] = [];
  for (const child of parent.children) {
    if (!child) continue;
    if (child.type === 'text') { next.push(child); continue; }
    if (child.type !== 'element') continue; // raw, comment, doctype… → bỏ
    const tag = String(child.tagName || '').toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) continue;
    if (!ALLOWED_TAGS.has(tag)) {
      // Thẻ lạ: bỏ thẻ, giữ phần chữ bên trong (đã làm sạch)
      sanitizeChildren(child);
      next.push(...(child.children || []));
      continue;
    }
    child.tagName = tag;
    sanitizeProperties(child);
    delete child.content;
    sanitizeChildren(child);
    next.push(child);
  }
  parent.children = next;
};

export default function rehypeSafeHtml() {
  return (tree: any) => {
    sanitizeChildren(tree);
  };
}
