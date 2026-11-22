/**
 * v9.4: Bảng thuật ngữ y khoa Anh → Việt BẮT BUỘC (thống nhất cách dịch trong toàn bộ tài liệu).
 * - Mặc định: bộ thuật ngữ chẩn đoán hình ảnh / tuyến vú (rà soát từ bản dịch "Atlas of Full Breast Ultrasonography").
 * - Người dùng sửa / thêm trong Cài đặt (lưu trên máy: localStorage "mediTrans_glossary", mỗi dòng "tiếng Anh = tiếng Việt").
 * - Chỉ gửi cho AI những thuật ngữ THỰC SỰ xuất hiện trong đoạn đang dịch → gần như không tốn thêm token.
 */
export const DEFAULT_GLOSSARY_TEXT = `# Mỗi dòng: thuật ngữ tiếng Anh = cách dịch tiếng Việt bắt buộc. Dòng bắt đầu bằng # là ghi chú.
areola = quầng vú
areolar = quầng vú
nipple-areolar complex = phức hợp núm vú – quầng vú
nipple = núm vú
radial scar = sẹo hình tia
gynecomastia = vú to ở nam giới
gynaecomastia = vú to ở nam giới
male breast = vú nam giới
phyllodes tumor = u diệp thể
phyllodes tumour = u diệp thể
phyllodes = u diệp thể
fibroadenoma = u xơ tuyến
fibroadenomas = u xơ tuyến
adenosis = bệnh tuyến (adenosis)
sclerosing adenosis = bệnh tuyến xơ hoá
mammography = nhũ ảnh
mammographic = nhũ ảnh
mammogram = phim nhũ ảnh
digital mammography = nhũ ảnh kỹ thuật số
tomosynthesis = chụp cắt lớp tổng hợp tuyến vú
sonoelastography = siêu âm đàn hồi
elastography = siêu âm đàn hồi
elastogram = ảnh đàn hồi
strain elastography = siêu âm đàn hồi biến dạng
shear wave elastography = siêu âm đàn hồi sóng biến dạng
ductal echography = siêu âm ống tuyến vú
ductal ultrasonography = siêu âm ống tuyến vú
full breast ultrasonography = siêu âm toàn bộ vú
lactiferous duct = ống dẫn sữa
lactiferous ducts = ống dẫn sữa
ductal ectasia = giãn ống tuyến vú
duct ectasia = giãn ống tuyến vú
terminal ductal lobular unit = đơn vị tiểu thùy – ống tận
TDLU = đơn vị tiểu thùy – ống tận (TDLU)
mean glandular dose = liều tuyến trung bình (MGD)
nested case-control = bệnh – chứng lồng ghép
case-control = bệnh – chứng
posterior shadowing = bóng cản phía sau
acoustic shadowing = bóng cản âm
posterior enhancement = tăng âm phía sau
radial = theo hướng nan hoa
antiradial = vuông góc hướng nan hoa
thelarche = khởi phát phát triển tuyến vú
menarche = có kinh lần đầu
carcinoma = ung thư biểu mô
ductal carcinoma in situ = ung thư biểu mô ống tại chỗ
invasive ductal carcinoma = ung thư biểu mô ống xâm nhập
invasive lobular carcinoma = ung thư biểu mô tiểu thùy xâm nhập
lobular carcinoma in situ = ung thư biểu mô tiểu thùy tại chỗ
papilloma = u nhú
intraductal papilloma = u nhú trong ống
hamartoma = u mô thừa
lipoma = u mỡ
cyst = nang
complicated cyst = nang biến chứng
complex cyst = nang phức tạp
galactocele = nang sữa
mastitis = viêm vú
abscess = áp xe
fat necrosis = hoại tử mỡ
Cooper ligaments = dây chằng Cooper
Cooper's ligaments = dây chằng Cooper
hypoechoic = giảm âm
hyperechoic = tăng âm
anechoic = trống âm
isoechoic = đồng âm
echogenicity = độ hồi âm
microcalcifications = vi vôi hoá
calcifications = vôi hoá
architectural distortion = biến dạng cấu trúc
axillary lymph node = hạch nách
lymph node = hạch bạch huyết
sentinel lymph node = hạch gác
core needle biopsy = sinh thiết lõi kim
fine-needle aspiration = chọc hút kim nhỏ
Doppler = Doppler
transducer = đầu dò
probe = đầu dò
field of view = trường nhìn
region of interest = vùng quan tâm (ROI)
# v9.8: mô tả khối (BI-RADS)
equal density = đậm độ tương đương
high density = đậm độ cao
low density = đậm độ thấp
fat-containing = chứa mỡ
circumscribed margin = bờ rõ
circumscribed = bờ rõ
obscured margin = bờ bị che khuất
obscured = bờ bị che khuất
microlobulated = bờ vi thùy
indistinct = bờ không rõ
spiculated = bờ tua gai
lobulated = dạng thùy
oval = bầu dục
simple cyst = nang đơn thuần
# v10.0: tiêu đề sách / mục lục
SECTION = PHẦN
MASSES = KHỐI
mass = khối
masses = khối
table of contents = mục lục`;

const LS_KEY = 'mediTrans_glossary';

export function getGlossaryText(): string {
  try { return localStorage.getItem(LS_KEY) ?? DEFAULT_GLOSSARY_TEXT; } catch { return DEFAULT_GLOSSARY_TEXT; }
}
export function setGlossaryText(t: string) {
  try {
    if (t.trim() === DEFAULT_GLOSSARY_TEXT.trim()) localStorage.removeItem(LS_KEY); else localStorage.setItem(LS_KEY, t);
  } catch { /* */ }
  cache = null;
}

interface Entry { en: string; vi: string; re: RegExp; }
let cache: { src: string; entries: Entry[] } | null = null;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function entries(): Entry[] {
  let src = getGlossaryText();
  // v9.8: bảng người dùng đã tự sửa vẫn nhận các thuật ngữ mặc định mới (chỉ thêm thuật ngữ họ chưa có)
  if (src !== DEFAULT_GLOSSARY_TEXT) {
    const have = new Set(src.split('\n').map(l => l.split('=')[0].trim().toLowerCase()).filter(Boolean));
    const add = DEFAULT_GLOSSARY_TEXT.split('\n').filter(l => !l.trim().startsWith('#') && l.includes('=') && !have.has(l.split('=')[0].trim().toLowerCase()));
    if (add.length) src = src + '\n' + add.join('\n');
  }
  if (cache && cache.src === src) return cache.entries;
  const list: Entry[] = [];
  for (const raw of src.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const en = line.slice(0, i).trim(), vi = line.slice(i + 1).trim();
    if (!en || !vi) continue;
    // Viết tắt toàn chữ hoa (TDLU, ROI) so khớp phân biệt hoa/thường; còn lại không phân biệt
    const caseSensitive = /^[A-Z0-9-]{2,8}$/.test(en);
    const pattern = esc(en).replace(/\\-|\s+/g, m => (m === '\\-' ? '[-‐–\\s]?' : '\\s+'));
    list.push({ en, vi, re: new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, caseSensitive ? 'u' : 'iu') });
  }
  // Cụm dài trước (để "phyllodes tumor" thắng "phyllodes")
  list.sort((a, b) => b.en.length - a.en.length);
  cache = { src, entries: list };
  return list;
}

/** Các thuật ngữ trong bảng xuất hiện trong đoạn chữ (tối đa `max`). */
export function glossaryMatches(text: string, max = 40): { en: string; vi: string }[] {
  if (!text) return [];
  let plain = text.replace(/<\/?\d+>/g, '');
  const out: { en: string; vi: string }[] = [];
  const seenVi = new Set<string>();
  for (const e of entries()) {
    if (!e.re.test(plain)) continue;
    // Bỏ cụm đã khớp khỏi đoạn → thuật ngữ ngắn nằm trong cụm dài ("radial" trong "radial scar") không bị gửi thừa
    plain = plain.replace(new RegExp(e.re.source, e.re.flags.includes('g') ? e.re.flags : e.re.flags + 'g'), ' ');
    const k = `${e.en.toLowerCase()}|${e.vi}`;
    if (seenVi.has(k)) continue;
    seenVi.add(k);
    out.push({ en: e.en, vi: e.vi });
    if (out.length >= max) break;
  }
  return out;
}

/** Dòng hướng dẫn gửi kèm yêu cầu dịch (rỗng nếu không có thuật ngữ nào). */
export function glossaryPrompt(text: string): string {
  const m = glossaryMatches(text);
  if (!m.length) return '';
  return `\nMANDATORY terminology (always use exactly these Vietnamese terms, never leave the English term untranslated, keep them identical on every page): ${m.map(x => `${x.en} → ${x.vi}`).join('; ')}.`;
}

/**
 * v9.6: cả khối chỉ là MỘT thuật ngữ trong bảng ("MAMMOGRAPHY" ở tab dọc, "Ultrasound" làm tiêu đề) → dịch ngay trên máy,
 * giữ kiểu viết hoa của bản gốc. Không có → undefined.
 */
export function glossaryExact(text: string): string | undefined {
  const t = (text || '').replace(/<\/?\d+>/g, '').replace(/\s+/g, ' ').trim();
  const core = t.replace(/^[\s.:;,\-–—•]+|[\s.:;,\-–—•]+$/g, '');
  if (!core || core.length > 60) return undefined;
  const e = entries().find(x => x.en.toLowerCase() === core.toLowerCase());
  if (!e) return undefined;
  const caps = core === core.toUpperCase() && /\p{Lu}/u.test(core) && core.length > 1;
  let vi = caps ? e.vi.toLocaleUpperCase('vi') : (/^\p{Lu}/u.test(core) ? e.vi.charAt(0).toLocaleUpperCase('vi') + e.vi.slice(1) : e.vi);
  return t.replace(core, vi);
}

/** Toàn bộ bảng thuật ngữ dạng gọn (gửi kèm OCR, vì lúc đó chưa biết trang có chữ gì). */
export function glossaryCompact(max = 160): string {
  const list = entries().slice(0, max);
  if (!list.length) return '';
  return `\nMANDATORY terminology (use exactly these Vietnamese terms): ${list.map(x => `${x.en} → ${x.vi}`).join('; ')}.`;
}
