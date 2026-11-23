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
table of contents = mục lục
# v11: thuật ngữ model nhỏ (gpt-4.1-nano) hay dịch sai / để nguyên tiếng Anh (Clark's, Fornage)
elbow = khuỷu tay
wrist = cổ tay
hip joint = khớp háng
paediatric hip = khớp háng trẻ em
pediatric hip = khớp háng trẻ em
developmental dysplasia of the hip = loạn sản phát triển khớp háng
crown–rump length = chiều dài đầu – mông
crown-rump length = chiều dài đầu – mông
chorionic villus sampling = sinh thiết gai rau
sonographer = kỹ thuật viên siêu âm
sonographers = kỹ thuật viên siêu âm
sonography = siêu âm
monograph = chuyên khảo
US-guided = dưới hướng dẫn siêu âm (US)
ultrasound-guided = dưới hướng dẫn siêu âm
core-needle biopsy = sinh thiết lõi kim
core needle biopsy = sinh thiết lõi kim
needle localization = định vị bằng kim
wire localization = định vị bằng dây kim
cytopathologist = nhà tế bào bệnh học
cytopathologists = các nhà tế bào bệnh học
freehand = tự do (không dùng giá đỡ kim)
nonpalpable = không sờ thấy
piezoelectric = áp điện
aortic stenosis = hẹp van động mạch chủ
valvular aortic stenosis = hẹp van động mạch chủ
aortic regurgitation = hở van động mạch chủ
mitral regurgitation = hở van hai lá
mitral stenosis = hẹp van hai lá
bicuspid aortic valve = van động mạch chủ hai lá van
prolapse = sa
aortic valve area = diện tích van động mạch chủ
AVA = AVA
AVAi = AVAi
stroke volume index = chỉ số thể tích nhát bóp
stroke volume = thể tích nhát bóp
high-gradient = chênh áp cao
low-gradient = chênh áp thấp
low-flow = dòng chảy thấp
ejection fraction = phân suất tống máu
coaptation = áp sát lá van
Exercise 1 = Bài tập 1
Exercise 2 = Bài tập 2
Exercise 3 = Bài tập 3
Exercise 4 = Bài tập 4
Exercise 5 = Bài tập 5
Exercise 6 = Bài tập 6
Exercise 7 = Bài tập 7
Exercise 8 = Bài tập 8
Exercise 9 = Bài tập 9
Test Yourself = Tự kiểm tra
window width = độ rộng cửa sổ
window level = mức cửa sổ
grey scale = thang xám
gray scale = thang xám
systole = tâm thu
diastole = tâm trương
ventricular systole = tâm thu thất
ventricular diastole = tâm trương thất
isovolumetric contraction = co đồng thể tích
isovolumetric relaxation = giãn đồng thể tích
isovolumic relaxation = giãn đồng thể tích
mitral valve = van hai lá
tricuspid valve = van ba lá
aortic valve = van động mạch chủ
pulmonary valve = van động mạch phổi
hemodynamics = huyết động học
haemodynamics = huyết động học
left ventricle = thất trái
right ventricle = thất phải
left atrium = nhĩ trái
right atrium = nhĩ phải
HISTORY = TIỀN SỬ
histopathology = mô bệnh học
exaggerated craniocaudal = trên-dưới mở rộng
gravida = số lần mang thai
internal mammary = vú trong
internal mammary node = hạch vú trong
internal mammary nodes = hạch vú trong
IM node = hạch vú trong (IM)
IM nodes = hạch vú trong (IM)
IM node[s] = hạch vú trong (IM)
infraclavicular = dưới đòn
supraclavicular = trên đòn
interpectoral = giữa các cơ ngực
ipsilateral = cùng bên
contralateral = đối bên
Any T = T bất kỳ
Any N = N bất kỳ
coronary artery = động mạch vành
coronary arteries = động mạch vành
coronary calcium score = điểm vôi hoá động mạch vành
calcium hydroxyapatite = canxi hydroxyapatit
workstation = trạm làm việc
monoenergetic = đơn năng
attenuation = độ suy giảm
pectoralis major muscle = cơ ngực lớn
pectoralis major = cơ ngực lớn
pectoralis minor muscle = cơ ngực bé
pectoralis minor = cơ ngực bé
serratus anterior = cơ răng trước
latissimus dorsi = cơ lưng rộng
inframammary fold = nếp dưới vú
mediolateral oblique = chếch trong-ngoài (MLO)
craniocaudal = trên-dưới (CC)
hormone replacement therapy = liệu pháp hormone thay thế
M mode = chế độ M
M-mode = chế độ M
B mode = chế độ B
B-mode = chế độ B
M mode trace = đường ghi chế độ M
echogenic = hồi âm
axillary = nách
breast implant = túi độn ngực
implant rupture = vỡ túi độn
stepladder sign = dấu hiệu bậc thang
hilum = rốn
fatty hilum = rốn mỡ
American College of Radiology = Hội Điện quang Hoa Kỳ
intraoperative = trong mổ
hockey-stick = hình gậy khúc côn cầu
hockey stick = hình gậy khúc côn cầu
glomerular filtration rate = mức lọc cầu thận
estimated glomerular filtration rate = mức lọc cầu thận ước tính`;

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
