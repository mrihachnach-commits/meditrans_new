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
estimated glomerular filtration rate = mức lọc cầu thận ước tính
# v11.4: TUYẾN GIÁP – CẬN GIÁP – VÙNG CỔ
thyroid gland = tuyến giáp
thyroid nodule = nốt tuyến giáp
thyroid nodules = nốt tuyến giáp
thyroid lobe = thùy tuyến giáp
isthmus = eo tuyến giáp
aortic isthmus = eo động mạch chủ
parathyroid gland = tuyến cận giáp
parathyroid glands = tuyến cận giáp
parathyroid adenoma = u tuyến cận giáp
parathyroid hyperplasia = tăng sản tuyến cận giáp
parathyroid carcinoma = ung thư biểu mô tuyến cận giáp
primary hyperparathyroidism = cường cận giáp nguyên phát
secondary hyperparathyroidism = cường cận giáp thứ phát
hyperthyroidism = cường giáp
hypothyroidism = suy giáp
thyrotoxicosis = nhiễm độc giáp
euthyroid = bình giáp
goiter = bướu giáp
goitre = bướu giáp
multinodular goiter = bướu giáp đa nhân
multinodular goitre = bướu giáp đa nhân
Graves disease = bệnh Basedow (Graves)
Graves' disease = bệnh Basedow (Graves)
Hashimoto thyroiditis = viêm tuyến giáp Hashimoto
Hashimoto's thyroiditis = viêm tuyến giáp Hashimoto
subacute thyroiditis = viêm tuyến giáp bán cấp
papillary thyroid carcinoma = ung thư biểu mô tuyến giáp thể nhú
papillary thyroid microcarcinoma = vi ung thư biểu mô tuyến giáp thể nhú
papillary carcinoma = ung thư biểu mô thể nhú
follicular thyroid carcinoma = ung thư biểu mô tuyến giáp thể nang
follicular carcinoma = ung thư biểu mô thể nang
follicular neoplasm = u tân sinh dạng nang
medullary thyroid carcinoma = ung thư biểu mô tuyến giáp thể tủy
medullary carcinoma = ung thư biểu mô thể tủy
anaplastic thyroid carcinoma = ung thư biểu mô tuyến giáp thể không biệt hóa
differentiated thyroid cancer = ung thư tuyến giáp biệt hóa
differentiated thyroid carcinoma = ung thư biểu mô tuyến giáp biệt hóa
colloid nodule = nốt keo
colloid cyst = nang keo
spongiform = dạng bọt biển
taller-than-wide = cao hơn rộng
wider-than-tall = rộng hơn cao
echogenic foci = các điểm hồi âm
punctate echogenic foci = các điểm hồi âm dạng chấm
comet-tail artifact = xảo ảnh đuôi sao chổi
comet-tail artifacts = xảo ảnh đuôi sao chổi
macrocalcification = vôi hóa thô
macrocalcifications = vôi hóa thô
rim calcification = vôi hóa viền
rim calcifications = vôi hóa viền
peripheral calcifications = vôi hóa ngoại vi
eggshell calcification = vôi hóa vỏ trứng
extrathyroidal extension = xâm lấn ngoài tuyến giáp
TI-RADS = TI-RADS
Bethesda = Bethesda
fine-needle aspiration cytology = tế bào học chọc hút kim nhỏ
lymph node metastasis = di căn hạch
cervical lymph node = hạch cổ
cervical lymph nodes = hạch cổ
central compartment = khoang trung tâm
central neck compartment = khoang cổ trung tâm
lateral neck = vùng cổ bên
recurrent laryngeal nerve = thần kinh thanh quản quặt ngược
superior laryngeal nerve = thần kinh thanh quản trên
vagus nerve = dây thần kinh phế vị
cervical sympathetic ganglion = hạch giao cảm cổ
common carotid artery = động mạch cảnh chung
internal jugular vein = tĩnh mạch cảnh trong
sternocleidomastoid muscle = cơ ức đòn chũm
strap muscles = các cơ dưới móng
danger triangle = tam giác nguy hiểm
thyroglobulin = thyroglobulin
calcitonin = calcitonin
# v11.4: ĐỐT NHIỆT / CAN THIỆP TUYẾN GIÁP
radiofrequency ablation = đốt sóng cao tần (RFA)
microwave ablation = đốt vi sóng (MWA)
laser ablation = đốt laser (LA)
thermal ablation = đốt nhiệt
ethanol ablation = đốt bằng cồn (EA)
percutaneous ethanol injection = tiêm cồn qua da (PEI)
high-intensity focused ultrasound = siêu âm hội tụ cường độ cao (HIFU)
moving-shot technique = kỹ thuật đốt di chuyển (moving-shot)
trans-isthmic approach = đường vào qua eo tuyến giáp
transisthmic approach = đường vào qua eo tuyến giáp
hydrodissection = bóc tách bằng dịch
volume reduction ratio = tỷ lệ giảm thể tích (VRR)
vital volume = thể tích còn sống
marginal regrowth = tái phát triển ở rìa
internally cooled electrode = điện cực làm lạnh bên trong
active tip = đầu hoạt động
autonomously functioning thyroid nodule = nốt tuyến giáp tự chủ chức năng
benign thyroid nodule = nốt tuyến giáp lành tính
local anesthesia = gây tê tại chỗ
# v11.4: TUYẾN VÚ (BI-RADS 2025, can thiệp)
breast composition = thành phần mô vú
almost entirely fatty = gần như toàn bộ là mỡ
scattered areas of fibroglandular density = có các vùng mô sợi tuyến rải rác
heterogeneously dense = đậm độ không đồng nhất
extremely dense = rất đậm
fibroglandular tissue = mô sợi tuyến
dense breasts = vú đặc
asymmetry = bất đối xứng
focal asymmetry = bất đối xứng khu trú
global asymmetry = bất đối xứng toàn bộ
developing asymmetry = bất đối xứng tiến triển
amorphous = vô định hình
coarse heterogeneous = thô không đồng nhất
fine pleomorphic = đa hình thái mịn
fine linear branching = dạng đường mảnh phân nhánh
fine-linear branching = dạng đường mảnh phân nhánh
segmental distribution = phân bố theo phân thùy
regional distribution = phân bố theo vùng
linear distribution = phân bố dạng đường
skin thickening = dày da
skin retraction = co kéo da
nipple retraction = co kéo núm vú
trabecular thickening = dày bè
intramammary lymph node = hạch trong vú
non-mass enhancement = ngấm thuốc không dạng khối (NME)
background parenchymal enhancement = ngấm thuốc nhu mô nền (BPE)
kinetic curve = đường cong động học
washout = thải thuốc
rim enhancement = ngấm thuốc viền
posterior acoustic features = đặc điểm âm phía sau
parallel orientation = hướng song song
echo pattern = cấu trúc hồi âm
contrast-enhanced mammography = nhũ ảnh có tiêm thuốc tương phản (CEM)
contrast-enhanced spectral mammography = nhũ ảnh phổ có tiêm thuốc tương phản (CESM)
digital breast tomosynthesis = chụp cắt lớp tổng hợp tuyến vú (DBT)
screening mammography = nhũ ảnh sàng lọc
diagnostic mammography = nhũ ảnh chẩn đoán
recall rate = tỷ lệ gọi lại
interval cancer = ung thư giữa hai lần sàng lọc
assessment category = phân loại đánh giá
probably benign = có thể lành tính
highly suggestive of malignancy = rất nghi ngờ ác tính
short-interval follow-up = theo dõi ngắn hạn
spot compression = ép điểm
spot compression view = phim ép điểm
magnification view = phim phóng đại
intracapsular rupture = vỡ trong bao
extracapsular rupture = vỡ ngoài bao
linguine sign = dấu hiệu sợi mì (linguine)
seroma = tụ dịch huyết thanh
hematoma = tụ máu
haematoma = tụ máu
mastectomy = cắt bỏ tuyến vú
lumpectomy = phẫu thuật cắt bỏ khối u (lumpectomy)
breast-conserving surgery = phẫu thuật bảo tồn tuyến vú
neoadjuvant chemotherapy = hóa trị tân bổ trợ
Paget disease of the nipple = bệnh Paget núm vú
inflammatory breast cancer = ung thư vú thể viêm
mucinous carcinoma = ung thư biểu mô thể nhầy
tubular carcinoma = ung thư biểu mô thể ống nhỏ
atypical ductal hyperplasia = tăng sản ống không điển hình (ADH)
flat epithelial atypia = không điển hình biểu mô phẳng (FEA)
pseudoangiomatous stromal hyperplasia = tăng sản mô đệm giả u mạch (PASH)
vacuum-assisted biopsy = sinh thiết hút chân không
stereotactic biopsy = sinh thiết định vị lập thể
# v11.4: CT TIM MẠCH
coronary CT angiography = chụp cắt lớp vi tính mạch vành (CCTA)
coronary artery calcium = vôi hóa động mạch vành
calcium scoring = tính điểm vôi hóa
Agatston score = điểm Agatston
atherosclerotic plaque = mảng xơ vữa
calcified plaque = mảng xơ vữa vôi hóa
noncalcified plaque = mảng xơ vữa không vôi hóa
non-calcified plaque = mảng xơ vữa không vôi hóa
partially calcified plaque = mảng xơ vữa vôi hóa một phần
positive remodeling = tái cấu trúc dương tính
low-attenuation plaque = mảng xơ vữa đậm độ thấp
napkin-ring sign = dấu hiệu vòng khăn ăn
spotty calcification = vôi hóa dạng đốm
left main coronary artery = thân chung động mạch vành trái
left anterior descending artery = động mạch liên thất trước (LAD)
left circumflex artery = động mạch mũ (LCx)
right coronary artery = động mạch vành phải (RCA)
posterior descending artery = động mạch liên thất sau (PDA)
diagonal branch = nhánh chéo
obtuse marginal branch = nhánh bờ tù
myocardial bridging = cầu cơ
myocardial bridge = cầu cơ
myocardial infarction = nhồi máu cơ tim
myocardial ischemia = thiếu máu cơ tim cục bộ
fractional flow reserve = phân suất dự trữ lưu lượng (FFR)
left atrial appendage = tiểu nhĩ trái
pericardial effusion = tràn dịch màng ngoài tim
prospective ECG triggering = kích hoạt điện tim tiến cứu
retrospective ECG gating = đồng bộ điện tim hồi cứu
radial artery = động mạch quay
# v11.4: KỸ THUẬT HÌNH ẢNH CHUNG (CT, siêu âm, liều)
artifact = xảo ảnh
artefact = xảo ảnh
motion artifact = xảo ảnh chuyển động
beam hardening = cứng hóa chùm tia
beam-hardening artifact = xảo ảnh cứng hóa chùm tia
blooming artifact = xảo ảnh nở rộng (blooming)
reverberation artifact = xảo ảnh dội lại
mirror image artifact = xảo ảnh gương
side lobe artifact = xảo ảnh búp sóng bên
acoustic impedance = trở kháng âm
color Doppler = Doppler màu
colour Doppler = Doppler màu
power Doppler = Doppler năng lượng
spectral Doppler = Doppler phổ
resistive index = chỉ số trở kháng (RI)
pulsatility index = chỉ số đập (PI)
peak systolic velocity = vận tốc đỉnh tâm thu (PSV)
end-diastolic velocity = vận tốc cuối tâm trương (EDV)
time gain compensation = bù độ khuếch đại theo độ sâu (TGC)
focal zone = vùng hội tụ
linear array transducer = đầu dò thẳng (linear)
curvilinear transducer = đầu dò cong (convex)
contrast-enhanced ultrasound = siêu âm có tiêm thuốc tương phản (CEUS)
transverse plane = mặt phẳng cắt ngang
sagittal plane = mặt phẳng đứng dọc
coronal plane = mặt phẳng đứng ngang
axial plane = mặt phẳng ngang
iterative reconstruction = tái tạo lặp
multiplanar reformation = tái tạo đa mặt phẳng (MPR)
multiplanar reconstruction = tái tạo đa mặt phẳng (MPR)
maximum intensity projection = chiếu cường độ tối đa (MIP)
curved planar reformation = tái tạo mặt phẳng cong (CPR)
volume rendering = dựng hình thể tích (VR)
Hounsfield unit = đơn vị Hounsfield (HU)
Hounsfield units = đơn vị Hounsfield (HU)
tube voltage = điện áp ống tia
tube current = dòng điện ống tia
radiation dose = liều bức xạ
effective dose = liều hiệu dụng
dose-length product = tích liều – chiều dài (DLP)
iodinated contrast medium = thuốc cản quang chứa i-ốt
contrast-induced nephropathy = bệnh thận do thuốc cản quang
arterial phase = thì động mạch
portal venous phase = thì tĩnh mạch cửa
delayed phase = thì muộn
# v11.4: NGỰC – BỤNG
ground-glass opacity = tổn thương kính mờ
ground-glass opacities = tổn thương kính mờ
consolidation = đông đặc
pleural effusion = tràn dịch màng phổi
pneumothorax = tràn khí màng phổi
atelectasis = xẹp phổi
pulmonary nodule = nốt phổi
pulmonary embolism = thuyên tắc phổi
interstitial lung disease = bệnh phổi kẽ
bronchiectasis = giãn phế quản
emphysema = khí phế thũng
air bronchogram = dấu hiệu khí phế quản đồ
silhouette sign = dấu hiệu xóa bờ
tree-in-bud = hình cây nảy chồi
honeycombing = hình tổ ong
cardiothoracic ratio = chỉ số tim – ngực
lymphadenopathy = hạch to
hepatic steatosis = gan nhiễm mỡ
cirrhosis = xơ gan
hepatocellular carcinoma = ung thư biểu mô tế bào gan (HCC)
hemangioma = u máu
haemangioma = u máu
focal nodular hyperplasia = tăng sản thể nốt khu trú (FNH)
cholelithiasis = sỏi túi mật
cholecystitis = viêm túi mật
choledocholithiasis = sỏi ống mật chủ
common bile duct = ống mật chủ
portal vein = tĩnh mạch cửa
pancreatitis = viêm tụy
appendicitis = viêm ruột thừa
bowel obstruction = tắc ruột
hydronephrosis = thận ứ nước
ascites = cổ trướng
# v11.4: CƠ XƯƠNG KHỚP – CAN THIỆP DƯỚI SIÊU ÂM
tendon = gân
tendinopathy = bệnh lý gân
tenosynovitis = viêm bao gân
rotator cuff = chóp xoay
supraspinatus = cơ trên gai
subacromial-subdeltoid bursa = túi thanh dịch dưới mỏm cùng – dưới cơ delta
subacromial bursa = túi thanh dịch dưới mỏm cùng vai
bursitis = viêm túi thanh dịch
carpal tunnel syndrome = hội chứng ống cổ tay
carpal tunnel = ống cổ tay
trigger finger = ngón tay cò súng
lateral epicondylitis = viêm lồi cầu ngoài xương cánh tay
ganglion cyst = nang bao hoạt dịch (ganglion)
corticosteroid injection = tiêm corticosteroid
in-plane approach = tiếp cận trong mặt phẳng (in-plane)
out-of-plane approach = tiếp cận ngoài mặt phẳng (out-of-plane)
needle tip = đầu kim
anisotropy = hiện tượng dị hướng
platelet-rich plasma = huyết tương giàu tiểu cầu (PRP)
# v11.4: NGHIÊN CỨU – THỐNG KÊ
randomized controlled trial = thử nghiệm ngẫu nhiên có đối chứng
meta-analysis = phân tích gộp
systematic review = tổng quan hệ thống
cohort study = nghiên cứu đoàn hệ
retrospective study = nghiên cứu hồi cứu
prospective study = nghiên cứu tiến cứu
odds ratio = tỷ số chênh (OR)
hazard ratio = tỷ số nguy cơ (HR)
relative risk = nguy cơ tương đối (RR)
confidence interval = khoảng tin cậy (CI)
positive predictive value = giá trị dự báo dương tính (PPV)
negative predictive value = giá trị dự báo âm tính (NPV)
sensitivity = độ nhạy
specificity = độ đặc hiệu
false-positive = dương tính giả
false positive = dương tính giả
false-negative = âm tính giả
false negative = âm tính giả
interobserver agreement = mức độ đồng thuận giữa người đọc
interobserver variability = mức độ khác biệt giữa người đọc
incidence = tỷ lệ mới mắc
prevalence = tỷ lệ hiện mắc
# v11.4: THUẬT NGỮ CHUNG
differential diagnosis = chẩn đoán phân biệt
lesion = tổn thương
benign = lành tính
malignant = ác tính
malignancy = bệnh lý ác tính
metastasis = di căn
metastases = di căn
recurrence = tái phát
histology = mô học
cytology = tế bào học
pitfall = bẫy chẩn đoán
pitfalls = bẫy chẩn đoán`;

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
  // v11.4: bảng thuật ngữ RIÊNG của tài liệu đang mở (AI lập một lần từ lớp chữ cả sách, người dùng sửa được).
  // Bảng chung luôn thắng khi trùng thuật ngữ; bảng tài liệu chỉ bổ sung thuật ngữ bảng chung chưa có.
  const docSrc = activeDocKey ? getDocGlossaryText(activeDocKey) : '';
  // v9.8: bảng người dùng đã tự sửa vẫn nhận các thuật ngữ mặc định mới (chỉ thêm thuật ngữ họ chưa có)
  if (src !== DEFAULT_GLOSSARY_TEXT) {
    const have = new Set(src.split('\n').map(l => l.split('=')[0].trim().toLowerCase()).filter(Boolean));
    const add = DEFAULT_GLOSSARY_TEXT.split('\n').filter(l => !l.trim().startsWith('#') && l.includes('=') && !have.has(l.split('=')[0].trim().toLowerCase()));
    if (add.length) src = src + '\n' + add.join('\n');
  }
  const style = getViToneStyle();
  const sig = src + '\u0000' + docSrc + '\u0000' + style;
  if (cache && cache.src === sig) return cache.entries;
  const list: Entry[] = [];
  const globalKeys = new Set(src.split('\n').map(l => l.split('=')[0].trim().toLowerCase()).filter(Boolean));
  const docLines = docSrc.split('\n').filter(l => { const k = l.split('=')[0].trim().toLowerCase(); return k && !globalKeys.has(k); });
  for (const raw of src.split('\n').concat(docLines)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i <= 0) continue;
    const en = line.slice(0, i).trim(), vi = normalizeViTone(line.slice(i + 1).trim(), style); // v11.4: cùng kiểu dấu với bản dịch
    if (!en || !vi) continue;
    // Viết tắt toàn chữ hoa (TDLU, ROI) so khớp phân biệt hoa/thường; còn lại không phân biệt
    const caseSensitive = /^[A-Z0-9-]{2,8}$/.test(en);
    const pattern = esc(en).replace(/\\-|\s+/g, m => (m === '\\-' ? '[-‐–\\s]?' : '\\s+'));
    list.push({ en, vi, re: new RegExp(`(?<![\\p{L}\\p{N}])${pattern}(?![\\p{L}\\p{N}])`, caseSensitive ? 'u' : 'iu') });
  }
  // Cụm dài trước (để "phyllodes tumor" thắng "phyllodes")
  list.sort((a, b) => b.en.length - a.en.length);
  cache = { src: sig, entries: list };
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
  const m = glossaryMatches(text, 50);
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
  // v11.4: ưu tiên thuật ngữ ĐÃ gặp trong tài liệu đang dịch (bảng tài liệu + các trang trước), sau đó mới tới cụm dài
  const all = entries();
  const seen = activeDocKey ? docSeen.get(activeDocKey) : undefined;
  const docKeys = new Set(getDocGlossaryText().split('\n').map(l => l.split('=')[0].trim().toLowerCase()).filter(Boolean));
  const pri = (e: Entry) => (seen?.has(e.en) ? 0 : docKeys.has(e.en.toLowerCase()) ? 1 : 2);
  const list = all.map((e, i) => ({ e, i })).sort((a, b) => pri(a.e) - pri(b.e) || a.i - b.i).slice(0, max).map(x => x.e);
  if (!list.length) return '';
  return `\nMANDATORY terminology (use exactly these Vietnamese terms): ${list.map(x => `${x.en} → ${x.vi}`).join('; ')}.`;
}


// ───────────────────────────── v11.4: chuẩn hoá thuật ngữ & văn phong ─────────────────────────────

/**
 * Hướng dẫn văn phong y khoa tiếng Việt, gửi kèm MỌI yêu cầu dịch (dịch thường, giữ định dạng, OCR).
 * Viết tiếng Anh cho ít token (~120 token). Ví dụ lấy từ các lỗi thật trong bản rà soát Atlas siêu âm vú.
 */
export const VI_MEDICAL_STYLE = `
Vietnamese medical register (as in Vietnamese medical textbooks and Ministry of Health documents):
- Use the established Vietnamese medical term, never a literal word-for-word rendering ("areola" → "quầng vú", not "hoàng điểm"; "radial scar" → "sẹo hình tia"; "nested case-control" → "bệnh – chứng lồng ghép"). Prefer standard Sino-Vietnamese terms: tăng sản, loạn sản, di căn, xâm lấn, giảm âm, tăng âm, đậm độ, ngấm thuốc.
- One English term = one Vietnamese term everywhere; never alternate synonyms for the same concept within the document.
- Term with no established Vietnamese equivalent: Vietnamese rendering + the English term in parentheses the first time it appears, e.g. "u diệp thể (phyllodes tumor)". Never leave an ordinary English word inside a Vietnamese sentence.
- Abbreviations: keep as written; when the source spells one out, translate the expansion and keep the abbreviation: "computed tomography (CT)" → "chụp cắt lớp vi tính (CT)". Eponyms keep the name: "Cooper's ligaments" → "dây chằng Cooper". Drug names: international non-proprietary names.
- Natural, concise scientific Vietnamese: avoid "của… của…" chains, needless "được/bị", and English word order; keep the meaning, hedging (may, likely, suggests) and every number exactly.`;

/** Bản rút gọn cho prompt giữ định dạng / OCR (khối ngắn, model nhỏ). */
export const VI_MEDICAL_STYLE_SHORT = `
Vietnamese medical register: use the established Vietnamese medical term (never a literal rendering), one Vietnamese term per English term on every page, Sino-Vietnamese terms (tăng sản, loạn sản, di căn, xâm lấn, giảm âm, tăng âm); a term with no Vietnamese equivalent: Vietnamese + "(English)" the first time; an abbreviation spelled out in the source: translate the expansion, keep the abbreviation ("computed tomography (CT)" → "chụp cắt lớp vi tính (CT)").`;

// ── Kiểu đặt dấu thanh: "hóa, thùy, khỏe" (kiểu mới, mặc định) hay "hoá, thuỳ, khoẻ" (kiểu cũ) ──
export type ViToneStyle = 'new' | 'old' | 'off';
const TONE_KEY = 'mediTrans_viToneStyle';
export function getViToneStyle(): ViToneStyle {
  try { const v = localStorage.getItem(TONE_KEY); return v === 'old' || v === 'off' ? v : 'new'; } catch { return 'new'; }
}
export function setViToneStyle(v: ViToneStyle) {
  try { if (v === 'new') localStorage.removeItem(TONE_KEY); else localStorage.setItem(TONE_KEY, v); } catch { /* */ }
  cache = null;
}
const TONE_MARKS = '̣̀́̃̉';
/** Tách nguyên âm có thanh thành [nguyên âm gốc không dấu phụ, dấu thanh]; nguyên âm có dấu phụ (â, ê, ô, ơ, ư, ă) → null. */
function splitTone(ch: string): [string, string] | null {
  const d = ch.normalize('NFD');
  if (d.length !== 2 || !TONE_MARKS.includes(d[1])) return null;
  return [d[0], d[1]];
}
/**
 * Thống nhất cách đặt dấu thanh ở vần mở oa, oe, uy (không có phụ âm/nguyên âm cuối):
 * kiểu mới "hóa, hòa, khỏe, thủy, tùy"; kiểu cũ "hoá, hoà, khoẻ, thuỷ, tuỳ". "qu" (quý, quỳ) và vần có âm cuối (hoạt, toán) không đổi.
 * Trước đây bản dịch lẫn "vôi hoá" / "vôi hóa", "tiểu thùy" / "tiểu thuỳ" trên cùng một trang.
 */
export function normalizeViTone(text: string, style: ViToneStyle = getViToneStyle()): string {
  if (!text || style === 'off') return text;
  const t = text.normalize('NFC');
  if (style === 'new') {
    return t.replace(/(?<![qQ])([oOuU])([^\s\p{N}\p{P}])(?![\p{L}\p{M}])/gu, (m, v1: string, v2: string) => {
      const sp = splitTone(v2);
      if (!sp) return m;
      const base = sp[0];
      const ok = (/[oO]/.test(v1) && /[aAeE]/.test(base)) || (/[uU]/.test(v1) && /[yY]/.test(base));
      return ok ? (v1 + sp[1]).normalize('NFC') + base : m;
    });
  }
  return t.replace(/(?<![qQ])([^\s\p{N}\p{P}])([aAeEyY])(?![\p{L}\p{M}])/gu, (m, v1: string, v2: string) => {
    const sp = splitTone(v1);
    if (!sp) return m;
    const base = sp[0];
    const ok = (/[oO]/.test(base) && /[aAeE]/.test(v2)) || (/[uU]/.test(base) && /[yY]/.test(v2));
    return ok ? base + (v2 + sp[1]).normalize('NFC') : m;
  });
}

// ── Bảng thuật ngữ riêng của từng tài liệu ──
const DOC_KEY_PREFIX = 'mediTrans_docGlossary::';
let activeDocKey = '';
/** Gọi khi mở tài liệu (khoá = vân tay PDF, giống nhau trên mọi máy và mọi tên file). */
export function setActiveGlossaryDoc(docKey: string) {
  if (docKey !== activeDocKey) { activeDocKey = docKey; cache = null; }
}
export function getActiveGlossaryDoc(): string { return activeDocKey; }
export function getDocGlossaryText(docKey = activeDocKey): string {
  if (!docKey) return '';
  try { return localStorage.getItem(DOC_KEY_PREFIX + docKey) || ''; } catch { return ''; }
}
export function setDocGlossaryText(docKey: string, text: string) {
  if (!docKey) return;
  try { if (text.trim()) localStorage.setItem(DOC_KEY_PREFIX + docKey, text); else localStorage.removeItem(DOC_KEY_PREFIX + docKey); } catch { /* đầy bộ nhớ */ }
  cache = null;
}
export function docGlossarySize(docKey = activeDocKey): number {
  return getDocGlossaryText(docKey).split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#')).length;
}

const STOP = new Set(('a an the and or of in on at to for from by with without within into onto as is are was were be been being this that these those ' +
  'it its their there here which who whom whose what when where while than then also may can could should would will shall must not no nor ' +
  'such each other both either neither more most less least very much many few some any all only same so if but because however although ' +
  'between among during after before above below over under through about against per via upon et al figure fig figs table chapter section page ' +
  'see shown show shows showing used use using case cases patient patients image images arrow arrows left right one two three first second ' +
  'new often usually typically generally well due including include includes include based like has have had do does did done ' +
  // từ học thuật thông dụng (không phải thuật ngữ) — để dành chỗ cho thuật ngữ thật
  'treatment treatments results result clinical study studies reported review compared treated significant significantly structures structure ' +
  'procedure procedures technique techniques associated diagnostic injury disease evaluation evaluated higher lower active outcomes outcome ' +
  'performed common symptoms initial following therapy approach increased decreased therefore different difference differences classification ' +
  'practice considered located present general effective groups group experience normal number larger smaller internal external several important ' +
  'reporting factors factor versus further assessment growth medical potential multiple target criteria related points point showed demonstrated ' +
  'available according selection course greater adjacent presence defined observed negative positive overall surrounding location critical ' +
  'changes change appearance indicated department component regarding examination evidence authors author published control required ' +
  'particularly especially characteristics performance analysis months month years year management features feature volume method methods ' +
  'patient data system systems level levels type types rate rates value values time times risk factors total mean median range ratio ' +
  'anterior posterior superior inferior lateral medial single small large high low long short major minor good poor recent previous ' +
  'university hospital center centre school medicine department press springer nature switzerland license exclusive copyright').split(' '));
/** Dòng trích dẫn tài liệu tham khảo / bản quyền (không lấy thuật ngữ từ đây). */
const REF_LINE = /\bet al\b|\b(19|20)\d{2}\s*[;:.,)]\s*\d|\bdoi\b|https?:|©|\bSpringer\b|\bElsevier\b|\bvol\.\s*\d/i;

/**
 * Lấy cụm từ ứng viên thuật ngữ từ lớp chữ cả tài liệu (chạy trên máy, không tốn token):
 * cụm 1–4 từ không bắt đầu/kết thúc bằng hư từ, lặp ≥ 3 lần (từ đơn ≥ 4 lần, ≥ 6 chữ), bỏ cụm con trùng tần suất với cụm dài,
 * bỏ cụm đã có trong bảng thuật ngữ. Trả về tối đa `max` cụm, nhiều nhất trước.
 */
export function extractTermCandidates(pages: string[], max = 350): { term: string; count: number }[] {
  const counts = new Map<string, number>();
  const display = new Map<string, string>();
  for (const page of pages) {
    // bỏ tài liệu tham khảo / đường dẫn; ngắt câu theo dấu câu
    const text = page.split(/\n/).filter(l => !REF_LINE.test(l)).join('\n')
      .replace(/https?:\/\/\S+|doi:\S+/gi, ' ').replace(/(\p{L})-\s+(\p{Ll})/gu, '$1$2');
    for (const sent of text.split(/[.;:,()\[\]{}!?"“”‘’•·|\/\n\r\t]+|\s[-–—]\s/)) {
      const words = sent.match(/[\p{L}][\p{L}'’-]*/gu) || [];
      for (let i = 0; i < words.length; i++) {
        for (let n = 1; n <= 4 && i + n <= words.length; n++) {
          const ws = words.slice(i, i + n);
          const lw = ws.map(w => w.toLowerCase());
          if (STOP.has(lw[0]) || STOP.has(lw[n - 1])) continue;
          if (lw.some(w => w.length < 2) || lw.every(w => w.length < 4)) continue;
          if (new Set(lw).size < n) continue; // cụm lặp từ ("hookwire hookwire")
          if (n > 1 && ws.some(w => /^[A-Z]{1,3}$/.test(w)) && ws.some(w => /^\p{Lu}\p{Ll}/u.test(w))) continue; // "Baek JH" (tên tác giả)
          if (n === 1 && STOP.has(lw[0])) continue;
          // tên người (Chữ Hoa đầu từ, trừ từ đầu câu) hay chữ toàn HOA dài (tiêu đề chạy) → bỏ
          if (n === 1 && /^\p{Lu}/u.test(ws[0]) && i > 0) continue;
          if (ws.every(w => w.length > 3 && w === w.toUpperCase())) continue;
          const k = lw.join(' ');
          counts.set(k, (counts.get(k) || 0) + 1);
          if (!display.has(k)) display.set(k, ws.join(' '));
        }
      }
    }
  }
  let cand = [...counts.entries()].filter(([k, c]) => {
    const n = k.split(' ').length;
    return n === 1 ? c >= 4 && k.length >= 6 : c >= 3;
  });
  // cụm con xuất hiện gần như chỉ bên trong một cụm dài hơn → bỏ cụm con
  const byLen = cand.slice().sort((a, b) => b[0].length - a[0].length);
  const drop = new Set<string>();
  for (const [k, c] of byLen) {
    if (drop.has(k)) continue;
    for (const [k2, c2] of cand) {
      if (k2 !== k && k.includes(k2) && c >= 0.75 * c2) drop.add(k2);
    }
  }
  cand = cand.filter(([k]) => !drop.has(k));
  const ents = entries();
  cand = cand.filter(([k]) => !ents.some(e => e.en.toLowerCase() === k));
  // cụm nhiều từ được ưu tiên (thuật ngữ thật thường là cụm); từ đơn tối đa 1/3 danh sách
  const w = (k: string) => (k.includes(' ') ? Math.min(3, k.split(' ').length) : 0.5);
  cand.sort((a, b) => b[1] * w(b[0]) - a[1] * w(a[0]));
  const out: [string, number][] = [];
  let singles = 0;
  for (const c of cand) {
    if (out.length >= max) break;
    if (!c[0].includes(' ')) { if (singles >= Math.floor(max / 3)) continue; singles++; }
    out.push(c);
  }
  return out.map(([k, c]) => ({ term: display.get(k) || k, count: c }));
}

/** Chuỗi so khớp tiếng Việt: thường, cùng kiểu dấu, gộp khoảng trắng. */
const viKey = (t: string) => normalizeViTone(t.replace(/<\/?\d+>/g, ' '), 'new').toLocaleLowerCase('vi').replace(/\s+/g, ' ');

/**
 * Thuật ngữ trong bảng mà bản dịch vẫn để nguyên tiếng Anh (không nằm trong ngoặc giải thích) và KHÔNG dùng cách dịch bắt buộc.
 * ("sonoelastography" để nguyên 155 lần trong bản dịch Atlas trong khi mục lục đã dịch là "siêu âm đàn hồi".)
 */
const VI_DIACRITIC = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
const CITATION = /\bet al\.|\b(19|20)\d{2}\s*[;:]\s*\d|\bdoi\b|https?:|www\./i;

export function glossaryLeftEnglish(src: string, v: string): { en: string; vi: string }[] {
  if (!src || !v) return [];
  // chỉ xét câu tiếng Việt (có dấu) và không phải trích dẫn tài liệu tham khảo
  if (!VI_DIACRITIC.test(v) || CITATION.test(v)) return [];
  const out: { en: string; vi: string }[] = [];
  const vPlain = v.replace(/<\/?\d+>/g, ' ');
  const vNoParen = vPlain.replace(/\([^()]*\)/g, ' ');
  const vk = viKey(vPlain);
  for (const m of glossaryMatches(src, 60)) {
    if (m.en.toLowerCase() === m.vi.toLowerCase().replace(/\s*\([^)]*\)\s*$/, '')) continue; // Doppler = Doppler
    const e = entries().find(x => x.en === m.en);
    if (!e || !e.re.test(vNoParen)) continue;
    const core = viKey(m.vi.replace(/\s*\([^)]*\)\s*$/, ''));
    if (core && vk.includes(core)) continue;
    out.push(m);
  }
  return out;
}

/**
 * Thay thuật ngữ tiếng Anh còn sót (ngoài ngoặc) bằng cách dịch bắt buộc — chỉ dùng khi AI đã được nhắc mà vẫn để nguyên.
 * Tránh lặp chữ khi từ đứng trước đã là đầu cụm tiếng Việt ("siêu âm sonoelastography" → "siêu âm đàn hồi").
 */
export function applyGlossaryFixes(src: string, v: string): string {
  const left = glossaryLeftEnglish(src, v);
  if (!left.length) return v;
  let out = v;
  for (const m of left) {
    const e = entries().find(x => x.en === m.en);
    if (!e) continue;
    const vi = m.vi.replace(/\s*\(([A-Z][A-Za-z0-9-]{1,10})\)\s*$/, ''); // "(RFA)" chỉ cần ở chỗ định nghĩa
    const re = new RegExp(e.re.source, e.re.flags.includes('g') ? e.re.flags : e.re.flags + 'g');
    // chỉ thay phần NGOÀI ngoặc đơn (trong ngoặc là chú thích tiếng Anh hợp lệ)
    out = out.split(/(\([^()]*\))/).map((part, i) => i % 2 ? part : part.replace(re, (hit, offset: number, whole: string) => {
      const before = whole.slice(0, offset).replace(/<\/?\d+>/g, '').trimEnd();
      const viWords = vi.split(/\s+/);
      let rep = vi;
      for (let k = Math.min(3, viWords.length - 1); k >= 1; k--) {
        const head = viWords.slice(0, k).join(' ');
        if (viKey(before).endsWith(viKey(head))) { rep = viWords.slice(k).join(' '); break; }
      }
      // và tránh lặp đuôi: "Gynecomastia ở nam giới" → "Vú to ở nam giới" (không phải "… ở nam giới ở nam giới")
      const after = whole.slice(offset + hit.length).replace(/<\/?\d+>/g, '').trimStart();
      const repWords = rep.split(/\s+/);
      for (let k = Math.min(3, repWords.length - 1); k >= 1; k--) {
        const tail = repWords.slice(-k).join(' ');
        if (viKey(after).startsWith(viKey(tail) + ' ') || viKey(after) === viKey(tail)) { rep = repWords.slice(0, -k).join(' '); break; }
      }
      // giữ chữ hoa đầu nếu thuật ngữ gốc đứng đầu câu/khối
      if (/^\p{Lu}/u.test(hit) && (offset === 0 || /[.!?:]\s*$/.test(before))) rep = rep.charAt(0).toLocaleUpperCase('vi') + rep.slice(1);
      if (hit === hit.toUpperCase() && /\p{L}{3}/u.test(hit)) rep = rep.toLocaleUpperCase('vi');
      return rep;
    })).join('');
  }
  return out;
}

/** Hậu xử lý bản dịch thường (Markdown cả trang): thống nhất dấu thanh + thay thuật ngữ tiếng Anh còn sót. */
export function finalizeVietnamesePage(src: string, md: string): string {
  if (!md) return md;
  let out = md;
  if (src) {
    // xử lý từng dòng, bỏ qua bảng mã / đường dẫn
    out = out.split('\n').map(line => applyGlossaryFixes(src, line)).join('\n');
  }
  return normalizeViTone(out);
}

/** Thuật ngữ đã gặp trong từng tài liệu (để OCR trang scan gửi kèm đúng thuật ngữ của sách đó). Chỉ trong phiên. */
const docSeen = new Map<string, Set<string>>();
export function noteDocumentText(text: string) {
  if (!activeDocKey || !text) return;
  let set = docSeen.get(activeDocKey);
  if (!set) { set = new Set(); docSeen.set(activeDocKey, set); }
  for (const m of glossaryMatches(text, 80)) { if (set.size < 400) set.add(m.en); }
}
