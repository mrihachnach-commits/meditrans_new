# Bộ kiểm thử hồi quy "Giữ định dạng" (so ảnh + so cấu trúc khối)

Chạy hoàn toàn trên máy, KHÔNG gọi AI: bộ dịch giả thay chữ (a→ă, e→ê) và nối thêm ~30% số từ để mô phỏng bản Việt dài hơn.

Bộ trang (v10.2, 21 trang): sách "Breast Imaging Techniques for Radiographers" (bìa, trang tên sách, mục lục, thân bài 2 cột,
biểu đồ + tài liệu tham khảo, bảng), "Chẩn đoán hình ảnh vú" (tr.18, 19, 36, 37, 40), Atlas FBU (mục lục, trang hình + chú thích),
cộng 2 bộ trang scan BI-RADS (dữ liệu OCR cố định trong e2e.ts / e2e2.ts).

Cách chạy:
1. Đặt các PDF mẫu (nb.pdf, bk.pdf, atlas.pdf…) cùng pdf.worker.min.js, font Tinos vào một thư mục, mở `python3 -m http.server 8796` tại đó.
2. `./regress.sh <thư mục mã nguồn> <thư mục kết quả>` — chạy cả bộ bằng Chrome headless (run4.mjs).
3. `python3 compare.py <kết quả cũ> <kết quả mới>` — liệt kê khối thay đổi (tách/gộp đoạn, cỡ chữ, đậm) và % điểm ảnh khác,
   số khối tràn khung. Mọi thay đổi phải là CẢI THIỆN có chủ đích; thay đổi ngoài dự kiến = lỗi hồi quy.

## v10.3 — bổ sung
Bộ trang thêm 7 trang: Thyroid Ablation tr.17, 27 (taf.pdf; chú thích 2 cột vắt cột, nhãn hình), Practical Guide to Cardiac CT
tr.220 (ctvi.pdf; bảng có đường kẻ + thân bài trên bảng), Thyroid Ablation tr.92, 213 (abl.pdf; bảng nền màu vạch trắng, chú
thích 2 cột), Parathyroid tr.137 (par.pdf; khe cột hẹp 0,4 cỡ chữ), Abdominal tr.73 (abd.pdf; mục danh sách xen đoạn văn).

Đầu dò chất lượng tự động (không cần nhìn ảnh): `e2e8_probe.ts` bật `globalThis.__LAYOUT_PROBE`, bộ máy ghi lại từng khối đã
dàn (cỡ gốc/cỡ vẽ, số dòng, độ lấp đầy từng dòng, từ bị cắt, khung) → `probe_analyze.py <thư mục>` gắn cờ: co chữ < 80%, cỡ
chữ thân bài không đều, giãn dòng không đều, dòng căn đều quá thưa, cắt đôi từ, mẩu câu trôi nổi, khối chồng nhau, tràn khung.
`sweep.sh <thư mục>` chạy ~21 trang mẫu mỗi cuốn (bìa, mục lục, thân bài, bảng, hình, tài liệu tham khảo, chỉ mục).
