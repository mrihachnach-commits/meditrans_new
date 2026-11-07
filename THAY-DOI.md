# MediTrans AI — Ghi chú cập nhật (11/2026)

## 1. Tính năng mới: Dịch giữ định dạng (xuất ảnh)

Tab **"Giữ định dạng"** ở khung bên phải, cạnh tab "Dịch" và "Tóm tắt" (nút "Giữ định dạng" cạnh "Tải PDF" cũng mở tab này).
Tab tự đi theo trang đang xem bên trái → bản gốc (trái) và bản dịch giữ định dạng (phải) luôn song song.

Cách hoạt động (chạy hoàn toàn trên trình duyệt, không tốn server):
1. pdf.js vẽ trang gốc thành ảnh độ phân giải cao (~1700px chiều ngang).
2. Đọc vị trí, cỡ chữ, đậm/nghiêng, serif/sans của từng dòng → gom thành khối (đoạn văn, tiêu đề, ô bảng, chú thích). Nhận diện bố cục 2 cột, đoạn căn đều, căn giữa, chỉ số trích dẫn (¹²³).
3. Gửi các khối chữ đi dịch dạng JSON qua `GeminiService.translateLayoutBlocks` (dùng chung hệ thống key, xoay key, key hệ thống `/api/ai/chat`).
4. Xoá chữ gốc bằng màu nền lấy mẫu thật tại chỗ (giữ khung màu, bảng tô màu), vẽ chữ Việt với font Tinos/Arimo (cùng kích thước ký tự với Times/Arial).
5. Xếp chữ vừa khung theo thứ tự: giãn vào khoảng trống thật bên dưới/bên phải → giảm giãn dòng → giảm cỡ chữ (tối thiểu 72%). **Không bao giờ cắt bỏ chữ**; khối nào vẫn chật được đánh dấu cảnh báo.
6. **Lưu bản dịch lên đám mây giống bản dịch chữ**: `users/{chủ file}/documents/{file}/layoutPages/{trang}`. Chỉ lưu cặp {câu gốc → câu dịch} của từng khối (~4–5 KB/trang), không lưu ảnh. Mở lại trên máy khác → ảnh được dựng lại trên máy từ PDF gốc + dữ liệu này (không gọi AI, không tốn token, kết quả giống hệt). Trên máy đang dùng còn có thêm đệm ảnh IndexedDB (`MediTransLayoutDB`) để mở tức thì. Người được chia sẻ file xem được bản dịch; chỉ chủ file/admin lưu được bản dịch mới. File chưa lưu lên tài khoản thì chỉ lưu trên máy.
7. Xuất PDF gồm các trang ảnh, đúng khổ giấy gốc.

Giao diện: "Dịch trang N" (trang đang xem), "Nhiều trang" (nhập khoảng `1-3, 5`), Dừng, Dịch lại, phóng to, tải ảnh trang, xuất PDF (theo khoảng đã nhập hoặc tất cả trang đã dịch). Tuỳ chọn "Tự dịch khi lật trang" (tắt mặc định để tiết kiệm token). Việc dịch nhiều trang vẫn chạy tiếp khi chuyển sang tab khác.

Giới hạn hiện tại: trang scan (không có lớp chữ) và chữ nằm bên trong hình ảnh chưa được dịch ở chế độ này; định dạng in đậm của một vài từ lẻ giữa câu không được giữ.

File mới:
- `src/services/layoutEngine.ts` — thuật toán gom khối & vẽ lại (không phụ thuộc React/pdf.js)
- `src/services/layoutTranslationService.ts` — nối pdf.js, dịch, lưu đệm, xuất PDF
- `src/components/LayoutTranslatePanel.tsx` — giao diện tab khung phải
- `src/services/layoutCloudService.ts` — lưu/tải bản dịch giữ định dạng trên Firestore

File sửa: `src/App.tsx` (tab thứ 3 ở khung phải + nút mở nhanh), `src/services/geminiService.ts` (hàm `translateLayoutBlocks`), `src/services/translationService.ts`, `index.html` (font Tinos, Arimo).


### Cập nhật v4 — giống bản gốc hơn & giao diện song song

**Dàn trang (layoutEngine):**
- Đậm/nghiêng/màu tính theo **chữ cái** (bỏ qua dấu chấm dẫn, số) → hết lỗi lẫn đậm/thường ở mục lục.
- **Giữ từ in đậm / in màu giữa câu**: lấy mẫu màu thật theo từng từ trên ảnh trang, đánh dấu bằng thẻ `<1>…</1>`; AI giữ thẻ quanh cụm từ tương ứng trong bản dịch → vẽ lại đúng màu/đậm.
- **Mục lục**: tách số chương (1, 10, 1.2, •, a)…) khỏi tên chương; dấu chấm dẫn tự kéo tới số trang căn phải; mục 2 dòng ngắt dòng giống bản gốc (nếu không làm tăng số dòng).
- Giữ **thụt đầu dòng**, **thụt treo**, nhận diện **căn phải** (tiêu đề chạy đầu trang, số trang).
- **Màu chữ** lấy từ nhóm điểm ảnh đậm nhất (trước đây lấy trung vị → chữ bị xám nhạt).
- **Dàn theo cột**: các đoạn liền nhau trong cùng cột được dàn chung, cùng một tỉ lệ thu nhỏ (nếu cần). Mỗi đoạn **bắt đầu đúng độ cao đoạn gốc** để đối chiếu song song; chỉ bị đẩy xuống khi đoạn trên dài hơn chỗ. Khối có “bạn cùng hàng” (số mục, ô bảng, số trang) luôn giữ nguyên vị trí.
- Số trang La Mã (xi, iv…) không đem đi dịch.

**Giao diện tab Giữ định dạng:**
- Thanh công cụ nằm gọn trên **hàng menu chính** (1 hàng, giống khung trái); ở tab này ẩn Auto, Tải Word, chọn phông/cỡ chữ (không áp dụng cho ảnh).
- Bỏ nút “Giữ định dạng” ở menu trái (dùng tab ở khung phải).
- Trang dịch hiển thị **cùng kích thước, cùng vị trí** với trang PDF bên trái; **phóng to/thu nhỏ bên trái → bên phải theo**; **cuộn đồng bộ hai chiều**.
- Ô dịch nhiều trang, thanh tiến trình, cảnh báo: nổi trên nội dung, không đẩy trang xuống.
- Nút: Dịch tr.N · Nhiều trang · Dịch lại · Tự dịch khi lật trang · (biểu tượng lưu đám mây/máy) · Tải ảnh · PDF (số trang).

## 2. Tối ưu token cho chế độ "Dịch" thường

- Prompt dịch trang cũ dài ~7.300 ký tự tiếng Việt viết HOA (≈3.300 token) và **bị gửi lặp 2 lần** trong 2 hàm (stream/không stream) → gộp thành 1 hàm `GeminiService.buildPagePrompt()`, viết tiếng Anh ngắn gọn (~1.360 ký tự ≈ 340 token). Giữ đủ quy tắc: 100% tiếng Việt, chú thích hình, bảng GFM đủ cột, danh sách lồng nhau, ký hiệu Unicode thay LaTeX, bố cục 2 cột, khối từ viết tắt. Đầu ra vẫn là tiếng Việt.
- Bỏ dịch header/footer lặp lại và số trang (bớt token đầu ra).
- Trang trắng (gần như không có điểm mực) không gửi lên AI.
- Prompt dịch khối của chế độ "Giữ định dạng" cũng rút gọn sang tiếng Anh.
- Ước tính: tổng token đầu vào mỗi trang giảm từ ~4.300 (prompt ~3.300 + ảnh ~1.000) xuống ~1.350, tức **giảm khoảng 2/3**. Token đầu ra (bản dịch) gần như không đổi.

## 3. Sửa lỗi bản vá bảo mật trước

- **Key hệ thống không bao giờ được dùng**: mục ảo `system_proxy` có `value: ''` nên bị bộ chọn key bỏ qua → đổi thành `value: 'system_proxy'` (`src/App.tsx`).
- **`/api/ai/chat` huỷ request lên ShopAIKey ngay lập tức**: dùng `req.on('close')` (bắn ngay khi đọc xong body trên Node mới) → đổi sang `res.on('close')` và chỉ huỷ khi client thật sự ngắt kết nối (`api/ai/chat.ts`).
- **Ảnh trang không gửi được khi chạy bằng Express (AI Studio / local)**: `express.json()` mặc định giới hạn 100KB → nâng lên 12MB (`server.ts`).
- Danh sách model cho key hệ thống có thể mở rộng bằng biến môi trường, không cần sửa code:
  - `SYSTEM_AI_ALLOWED_MODELS` — thêm model, phân cách dấu phẩy (VD `gemini-2.5-flash,gpt-4o-mini`)
  - `SYSTEM_AI_DEFAULT_MODEL` — model dùng khi client gửi model không có trong danh sách (mặc định `gemini-2.5-flash-lite`)

## 4. Checklist triển khai

1. **Vercel → Settings → Environment Variables**: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (bắt buộc cho `/api/ai/chat` và trang quản trị). Tuỳ chọn: `SYSTEM_AI_BASE_URL`, `SYSTEM_AI_ALLOWED_MODELS`, `SYSTEM_AI_DEFAULT_MODEL`.
2. **Firestore Rules (BẮT BUỘC cập nhật lại — có thêm nhánh `layoutPages`, thiếu bước này bản dịch giữ định dạng sẽ không lưu được lên đám mây)**: Firebase Console → Firestore → chọn database `ai-studio-274cca7a-128b-4f84-92a2-6b79856d515b` → tab Rules → dán nội dung `firestore.rules` → Publish.
3. Đổi các key ShopAIKey hệ thống cũ (đã từng lộ cho mọi tài khoản trước bản vá).
4. Kiểm tra trong Firestore `users` không có tài khoản lạ mang `role: "admin"` hoặc `level` bất thường.
5. Sau khi deploy, thử: tài khoản Level 1 không thấy "[Hệ thống] ShopAIKey"; tài khoản Level 2 dịch được bằng key hệ thống và tab Network không lộ giá trị key.
