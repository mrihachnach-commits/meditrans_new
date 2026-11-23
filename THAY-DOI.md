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




### Cập nhật v6 — khớp font gốc, sửa dịch thường

**Giữ định dạng:**
- **Đo cỡ chữ thật trên ảnh** (chiều cao nét chữ) thay vì tin cỡ ghi trong file — nhiều sách ghi cỡ lớn hơn thực tế → trước đây chữ dịch quá to, phải co cả cột, vùng che tràn ra ngoài thanh tiêu đề (mảng trắng trên thanh xám).
- **Co ngang theo độ rộng font gốc** (font hẹp/mảnh) → chữ dịch có cùng “dáng” với bản gốc.
- **Nhận chữ đậm theo mật độ mực** khi tên font không ghi “Bold”.
- **Màu nền che = màu chính xác** phổ biến nhất (không lấy trung bình) → hết mảng xám mờ trên nền trắng.
- Lọc thẻ HTML AI tự thêm (`<i>`, `<b>`, `<sup>`…).
- Tiêu đề 1 dòng không còn chỗ bên dưới (trên thanh màu, sát hình) → ưu tiên mượn chỗ bên trái, nếu không được thì thu nhỏ riêng tiêu đề để giữ 1 dòng, không đè nội dung bên dưới.
- Trang đã dịch được tự dựng lại theo cách hiệu chỉnh mới (đệm ảnh v6), không tốn token.

**Dịch thường:**
- Prompt mới: dịch **toàn bộ** (tiêu đề, tiêu đề phụ, nhãn hình…), chỉ bỏ hẳn tiêu đề chạy/dải chương bên lề/số trang; quy định rõ tiêu đề (###), tiêu đề phụ (**in đậm**, không phải gạch đầu dòng), danh sách nhiều cấp; kèm ví dụ ngắn.
- Chế độ đọc ảnh dùng mức suy nghĩ `low` (đủ cho vừa đọc ảnh vừa dàn trình bày; vẫn rẻ hơn nhiều so với mặc định `high`).
- **Mới: “Ưu tiên lớp chữ”** (Cài đặt, mặc định bật): trang PDF có chữ thật → dựng sẵn Markdown đúng cấu trúc từ lớp chữ (tiêu đề theo cỡ/đậm, danh sách đúng cấp theo từng cột, mục lục, bỏ tiêu đề chạy/số trang/dải chương) rồi **chỉ gửi chữ** cho AI dịch (`translateMarkdownPageStream`, suy nghĩ `minimal`). Không gửi ảnh → nhanh hơn, ít token hơn, không lỗi đọc nhầm chữ. Trang scan, trang có bảng hoặc trang hình nhiều nhãn rời → tự dùng cách đọc ảnh như cũ. Lỗi giữa chừng → tự chuyển sang đọc ảnh.

### Cập nhật v5 — danh sách gạch đầu dòng, nhãn hình, dịch toàn bộ giữ định dạng, tăng tốc dịch thường

**Giữ định dạng (layoutEngine):**
- Nhận diện ký hiệu đầu dòng: • ● ▪ ■ ◦ ○ ‣ ► ➢ ✓ ❖ – — * **o** (cấp 2 kiểu Courier) và ký hiệu Wingdings/Symbol; tách ký hiệu dính liền chữ (`• Breast`).
- **Mỗi mục danh sách là một khối riêng** (trước đây các mục thẳng lề bị gộp thành một đoạn → chữ dính, chồng lên nhau).
- Khi mục dịch dài hơn và bị đẩy xuống, **ký hiệu/số thứ tự di chuyển theo** (sao chép nguyên điểm ảnh gốc) → không phải thu nhỏ cả cột.
- Lớp che chữ gốc luôn **đục 100%** (trước đây 93% ở vùng nền không đều → còn bóng chữ tiếng Anh mờ, ví dụ thanh tiêu đề nền xám).
- **Cột nhãn hình căn phải** (nhãn bên trái ảnh, có đường chỉ dẫn) được nhận diện → bản dịch dài giãn sang trái, không vỡ thành nhiều dòng hẹp.
- Tiêu đề 1 dòng sát vật cản bên phải: **mượn chỗ bên trái** (giữ mép phải) để nằm gọn 1 dòng. Không áp dụng cho ô bảng.
- Căn giữa cho tiêu đề chạy giữa trang; quy tắc căn phải “sát lề phải” chỉ còn áp dụng cho dòng đầu/cuối trang.

**Dịch toàn bộ giữ định dạng:**
- Cài đặt → “Dịch toàn bộ tài liệu” → nút mới **“Dịch toàn bộ giữ định dạng”**: tự chuyển sang tab Giữ định dạng và chạy toàn bộ tài liệu; tiến độ hiện trên nút Dừng (x/N) và trong Cài đặt.
- Dịch **song song 2–3 trang** (3 khi dùng key hệ thống hoặc có ≥3 key).
- Trang đã dịch trước đó (kể cả trên máy khác) được dựng lại, không tốn token; trang scan được bỏ qua.
- Ảnh trang đã dịch được đọc lại từ IndexedDB (lưu trên ổ đĩa) để **không chiếm RAM** với tài liệu hàng nghìn trang; chỉ giữ tối đa 24 ảnh đang mở.
- Xuất PDF tài liệu lớn tự **chia nhiều file (150 trang/file)**.

**Dịch thường nhanh hơn, ít token hơn:**
- Gemini 3 mặc định “suy nghĩ” mức CAO trước khi trả lời (tính tiền như token đầu ra, làm chậm). Nay gửi kèm cấu hình: Gemini 3.x Flash → `thinkingLevel: minimal` (không nhận thì lùi về `low`), 3.x Pro → `low`, 2.5 Flash/Flash-Lite → `thinkingBudget: 0`. Nếu model không nhận tham số → tự bỏ và thử lại ngay, không làm hỏng việc dịch.
- Proxy kiểu OpenAI (ShopAIKey/key hệ thống): gửi `reasoning_effort` cho model Gemini có thinking; proxy không hỗ trợ → tự bỏ. `/api/ai/chat` chuyển tiếp tham số này (chỉ nhận none/minimal/low/medium/high).
- Giới hạn `maxOutputTokens: 8192` để chặn trường hợp model viết lan man.
- Áp dụng cho cả dịch trang thường (stream & không stream) và dịch giữ định dạng.

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


### Cập nhật v7 — sửa lỗi ghép nhầm 2 cột, tự nhận diện số cột (AI hỗ trợ khi mơ hồ)

**Lỗi đã sửa (Giữ định dạng):**
- **Ghép nhầm dòng cột trái với dòng cột phải** (sách Springer… có khe cột hẹp ≈ 1 cỡ chữ, thấp hơn ngưỡng tách 1,2 cỡ chữ cũ) → chữ dịch tràn ngang cả trang, chữ siêu nhỏ, chồng lên nhau, còn sót chữ tiếng Anh, bản dịch rơi sai chỗ. Nay tự **tìm khe cột** (dải dọc không có chữ thân bài, nhiều dòng kết thúc/bắt đầu sát hai bên) và luôn tách tại đó.
- **Số chương cỡ lớn ("1") kéo nhiều dòng tiêu đề vào cùng một hàng** → tiêu đề bị ghép dính ("DuctalUltrasonography"), che không hết chữ gốc (còn bóng chữ tiếng Anh phía trên). Nay so hàng theo cỡ chữ tương ứng.
- **Dòng căn đều có khoảng trắng rất rộng** bị cắt thành nhiều mảnh ("With | regards | to | performance") → nay giữ thành một dòng.
- **Số mục "1.1" bị xoá mất** khi tiêu đề bên cạnh được dịch → nay giữ nguyên các số/ký hiệu không cần dịch.
- **Thứ tự đọc**: tiêu đề ngang trang → hết cột trái (trên → dưới) → cột phải (hỗ trợ cả 3 cột) → AI dịch đúng ngữ cảnh hơn.

**Nhận diện số cột tự động:**
- Trang 1 cột, 2 cột, 3 cột được nhận diện tự động, không tốn token khi tín hiệu rõ.
- Khi mơ hồ (ít dòng, khe không rõ), gửi **ảnh trang thu nhỏ** cho AI hỏi số cột/vị trí khe (`GeminiService.detectColumns`), ghi nhớ kết quả theo trang (localStorage `meditrans_layout_columns_v1`) để không hỏi lại. AI lỗi → dùng nhận diện tự động.

**Bản dịch đã lưu trước đây:** đệm ảnh đổi sang v7 nên trang cũ được dựng lại. Những khối không còn khớp với bản lưu cũ (do trước kia ghép nhầm cột) được **dịch bù riêng các khối đó** rồi cập nhật bản lưu đám mây. Nếu muốn dịch lại toàn bộ trang, bấm "Dịch lại".

**Sửa lỗi "PROXY_GENERATION_DISABLED: generateContent is not supported":**
- Nguyên nhân: khi nhóm key đang chọn chưa có key (hoặc kho key chưa tải xong), `App.tsx` tự lấy `GEMINI_API_KEY` của môi trường AI Studio. Key này đi qua proxy của AI Studio, mà proxy đó chặn `generateContent`.
- Đã bỏ đường lùi này: web **chỉ dùng key do người dùng/hệ thống của web cung cấp** (kho key, key nhập tay, `[Hệ thống] ShopAIKey`). Không có key → báo "chưa có API Key" thay vì gọi nhầm proxy AI Studio.
- Hỏi số cột (`detectColumns`) dùng chung cơ chế chọn key/xoay key/key hệ thống với dịch giữ định dạng.

### Cập nhật v8 — giống bản gốc hơn & lưu trữ như bản dịch thường

**Hiển thị (Giữ định dạng):**
- **Hết chữ chồng lên nhau** ("trở nên kháng kháng sinh… (nhiễm trùng cơ hội)", "M. Teboul…"): dòng căn đều có khoảng trắng rất rộng, từ sau khoảng trắng bắt đầu bằng chữ hoa/dấu ngoặc trước đây bị cắt thành khối riêng. Nay so với dòng trên/dưới: chữ của chúng phủ qua khoảng trắng → vẫn là một dòng; chỉ tách khi dòng trên/dưới cũng có khe rộng cùng vị trí (cột bảng).
- **Xoá sạch chữ gốc** theo mực thật trên ảnh (hết bóng chữ "Breast Doppler Ductal" phía trên tiêu đề).
- **Cỡ chữ đồng đều cả trang**: các đoạn thân bài cùng cỡ gốc dùng chung một tỉ lệ (trừ đoạn buộc phải nhỏ hơn hẳn).
- **Căn đều mọi dòng trừ dòng cuối** như bản in (trước đây dòng có nhiều khoảng trắng bị chuyển sang căn trái, trông như ngắt đoạn).
- Đệm ảnh v8: trang đã dịch được vẽ lại theo bản sửa, không tốn token (chỉ dịch bù khối nào không còn khớp).

**Lưu trữ giống bản dịch thường:**
- Đám mây: lưu ở `users/{chủ file}/documents/{file}/pages/layout-{trang}` — **cùng collection với bản dịch chữ**, dùng quyền đã có sẵn → **không cần triển khai lại Firestore rules**. Vẫn đọc bản lưu cũ ở `layoutPages` (nếu có). Danh sách bản dịch chữ bỏ qua các tài liệu `layout-*`. Sao chép file trong Thư mục cũng sao chép luôn bản dịch giữ định dạng.
- Điều kiện lưu đám mây giống hệt bản dịch chữ (đăng nhập + file có trên tài khoản); trang dịch trên máy trước đó được tự đẩy lên khi có thể.
- Trên máy: cặp câu dịch lưu theo khoá không phụ thuộc phiên bản (`pairs::…`) → nâng cấp bộ máy không còn mất bản dịch; tự khôi phục bản dịch nằm trong đệm ảnh của các phiên bản cũ.

### Cập nhật v9 — sửa chi tiết, OCR tự động (trang scan, chữ trong ảnh, chữ xoay), sửa bản dịch

**Sửa chi tiết hiển thị:**
- "M. Teboul…", "A. Colan…", "2. …" ở đầu đoạn không còn bị nhận nhầm là ký hiệu danh sách (trước đây tách dòng đầu → chữ chồng lên nhau). Nhận biết bằng cách xem dòng dưới có chạy lùi về dưới ký hiệu hay không (danh sách thật thì thụt treo).
- Cỡ chữ thân bài đồng đều hơn giữa các cột/đoạn trên cùng trang.

**OCR tự động (không cần bấm nút):**
- Trang scan (không có lớp chữ) **và** trang có lớp chữ hỏng (font không có bảng mã → ký tự rác) được tự nhận diện và dịch bằng OCR: AI đọc ảnh trang, trả về từng khối chữ (vị trí, chữ gốc, bản dịch) trong MỘT lần gọi, dùng đúng hệ thống key của web.
- Trang có lớp chữ nhưng có **ảnh** (siêu âm, X-quang, sơ đồ… có chữ in trong ảnh) hoặc **chữ xoay 90°**: tự gọi OCR bổ sung chỉ cho các vùng đó (vị trí ảnh đọc từ lệnh vẽ của PDF); chữ thường vẫn lấy từ lớp chữ. Khối OCR trùng với chữ đã có bị bỏ.
- Chữ xoay được vẽ xoay đúng hướng (đọc từ dưới lên / từ trên xuống). Chữ sáng trên nền tối (nhãn trên ảnh siêu âm) giữ đúng màu.
- Khung AI chỉ gần đúng → tinh chỉnh theo mực thật: tìm từng dòng chữ trên ảnh rồi gán mỗi dòng cho khối OCR chồng lên nhiều nhất (khung lệch ~1 dòng vẫn xoá sạch, không lấy nhầm dòng khối bên cạnh), tách dòng dính nhau, nhận thụt đầu dòng, cỡ chữ thân bài đồng đều.
- Kết quả OCR lưu cùng bản dịch (`__ocr__` / `__ocr_extra__` trong các cặp câu) → mở lại / máy khác dựng lại không cần OCR lại.
- Tab "Dịch" thường: trang có lớp chữ hỏng tự chuyển sang đọc ảnh thay vì gửi chữ rác.

**Sửa bản dịch:** nút "Sửa" (bút chì) trên thanh công cụ Giữ định dạng → sửa từng khối (có ô tìm kiếm), "Lưu & vẽ lại": vẽ lại ngay, không tốn token, lưu trên máy và đồng bộ lên tài khoản.

### Cập nhật v10 — giữ cỡ chữ (nén giãn dòng), xoá chữ bằng nền thật, bảng, mục lục, OCR chính xác hơn

**Cỡ chữ đều như bản in:**
- Giữ nguyên cỡ chữ gốc; bản dịch dài hơn → **nén giãn dòng trước** (tối thiểu 1,08 cỡ chữ, đủ chỗ dấu tiếng Việt), chỉ thu nhỏ chữ khi giãn dòng đã tối thiểu.
- Mọi đoạn thân bài trên trang dùng **chung một cỡ chữ** (không còn cột to cột nhỏ).

**Xoá chữ gốc bằng nền thật:** trang được vẽ thêm một bản **không có chữ**; vùng chữ gốc được thay bằng đúng nền thật từ bản này → giữ nguyên ảnh (dải ảnh trang bìa), khung viền, đường kẻ bảng, nền màu, logo; hết bóng chữ tiêu đề. Chữ nằm trong ảnh / trang scan: chỉ thay các điểm ảnh là chữ (giữ vân giấy, nền ảnh, không để vệt chữ nhật).

**Bảng:** các ô cùng cột không còn bị gộp thành một đoạn; mỗi ô giữ đúng hàng/cột, đường kẻ giữ nguyên.

**Mục lục:** hết lỗi hai mục vẽ chồng một dòng ("5.3.2 5.3.3…", "8.4.5 8.4.6…").

**Canh giữa:** khối chữ canh giữa có các dòng dài gần bằng nhau (khung chữ cuối trang) được nhận đúng.

**OCR:**
- Cỡ chữ đo theo chiều cao nét chữ thật, giới hạn theo giãn dòng → ổn định, sát bản gốc; dòng có logo chèn giữa không còn bị phóng to.
- Đường kẻ / khung viền không bị tính là chữ.
- Dòng nằm giữa hai khung AI: dòng thụt đầu thuộc đoạn dưới, còn lại thuộc đoạn trên (hết sót dòng cuối đoạn).
- Chấm nhiễu trên ảnh siêu âm không bị tính là dòng chữ.
- Lấy trọn chân chữ / dấu thanh khi xoá.

**Dịch:** prompt yêu cầu dịch cả các từ nằm ngoài thẻ đánh dấu (vd. "Atlas of …" trên trang bìa).

### Cập nhật v11 — trang OCR chuẩn font & cỡ chữ, mục lục OCR, cỡ chữ đồng đều

**Trang OCR (lớp chữ hỏng bảng mã, vd. sách BI-RADS):**
- Lớp chữ hỏng bảng mã vẫn cho đúng vị trí, cỡ chữ, font (có chân/không chân), đậm/nghiêng, màu → mỗi khối OCR lấy định dạng từ lớp chữ nằm dưới nó → **cỡ chữ và font khớp bản gốc** (không còn chữ Times thay cho chữ không chân, không còn to nhỏ lung tung). Trang scan thuần (không có lớp chữ) vẫn dùng ước lượng từ ảnh.
- Hết vạch "|" sót lại trước tiêu đề / mục lục ("|GIỚI THIỆU", "|IV.", "II II."): nét dọc của chữ I, D, B… trước đây bị nhận nhầm là đường kẻ dọc nên không được xoá (và chắn chỗ làm tiêu đề "Tuyên bố miễn trừ trách nhiệm" gãy 3 dòng).
- **Mục lục trên trang OCR**: dấu chấm dẫn + số trang vẽ riêng, căn phải đúng như bản gốc.
- Khung OCR theo cùng quy ước với khối lớp chữ → dòng mục lục / tiêu đề không còn bị thu nhỏ vì "tràn khung" giả.
- Khung AI quá thấp được nới thành một dòng; tiêu đề cỡ lớn không "ăn" dòng chữ nhỏ bên dưới.

**Cỡ chữ đồng đều:**
- Thân bài: cả trang dùng chung một cỡ (chỉ đoạn buộc phải nhỏ hơn hẳn mới giữ cỡ riêng).
- Dòng mục lục và ô bảng cùng cỡ gốc: dùng chung một cỡ khi phải thu nhỏ để giữ 1 dòng.

**Khác:** "M. Teboul…" ở đầu đoạn có thụt đầu dòng được ghép đúng vào đoạn.

### Cập nhật v12 — kiểm thử & sửa trên sách thật (Atlas of Full Breast Ultrasonography, BI-RADS v2025)

Chạy bộ máy thật trên các trang đại diện: bìa, mục lục, tiêu đề chương, trang 2 cột, bảng, trang có ảnh siêu âm (Atlas); trang scan điều khoản, mục lục, giới thiệu (BI-RADS — toàn bộ là ảnh scan, không có lớp chữ).

**Lớp chữ (Atlas):**
- Tiêu đề chương bị ghép dính 2 dòng ("DuctalUltrasonography", "Echography:Technique") và giãn dòng quá rộng, còn bóng chữ gốc: số chương cỡ lớn kéo nhiều dòng tiêu đề vào cùng một hàng → nay hai chữ chồng nhau theo chiều ngang không bao giờ cùng hàng.
- Tiêu đề in đậm nhiều dòng không còn bị căn đều (giãn chữ).
- Mục danh sách số dính liền chữ trong cùng item ("3. Finally…", "(2) the related…") bị nhập vào đoạn trên → nay tách đúng thành mục danh sách (quy tắc "M. Teboul" vẫn ghép lại khi là chữ của đoạn).
- Hết khoảng trắng thừa trước dấu câu: "[6 , 7 ]", "(Fig. 2.8 )" → "[6, 7]", "(Fig. 2.8)".

**OCR (BI-RADS):**
- Cỡ chữ đo theo chiều cao chữ x / chữ hoa (biết từ nội dung chữ), bỏ qua dấu chấm dẫn → các dòng mục lục, tiêu đề, thân bài cùng cỡ như bản in (trước đây dòng có chấm dẫn nhỏ hơn hẳn, dòng thưa bị phóng to).
- Gom cỡ chữ ước lượng thành vài cỡ chuẩn (lệch < 9% → dùng chung).
- Tự nhận **chữ đậm** theo độ dày nét (so với đoạn văn thường) khi AI không báo.
- Hết bóng chữ đậm còn sót khi xoá; logo / ảnh nhỏ chèn trong dòng được giữ lại.
- Không nới khung sang chữ hoa đầu đoạn cỡ lớn (drop cap).
- Prompt OCR: mỗi mục mục lục một khối, giữ dấu chấm dẫn + số trang.

**Giãn dòng:** chỉ nén tối đa ~12% (tối thiểu 1,12 cỡ chữ) rồi mới thu nhỏ chữ đều cả trang — tránh đoạn bị dồn dòng sát nhau trông chật, các đoạn cùng giãn dòng.

### Cập nhật v7 — sửa lỗi dàn trang, nhanh hơn, nút Dừng dừng thật

**Lỗi dàn trang đã sửa (đã kiểm thử tái hiện trước/sau):**
- **Chữ mờ như "bóng ma" trên bìa/nền ảnh** (vd. "Từ Sinh thiết đến Cắt bỏ"): trước đây màu từng từ được lấy so với "màu nền phổ biến" → trên nền chuyển màu, một từ bị nhận là "chữ màu xanh đậm" và vẽ gần trùng màu nền. Nay lấy màu chữ bằng cách so ảnh gốc với bản vẽ không chữ; nền không đồng màu thì dùng màu cả dòng.
- **Vết chữ cũ còn lại trên nền ảnh/gradient**: vùng xoá được lấp bằng nội suy từ điểm nền xung quanh (không tô một màu phẳng). Nền trắng/đồng màu vẫn tô nhanh như cũ.
- **Đường kẻ bảng bị đứt, vạch "_" lẻ ở góc ô**: khi xoá chữ, các đường kẻ ngang/dọc dài được giữ nguyên.
- **Chữ hoa cỡ lớn đầu đoạn (drop cap)**: trước đây chữ "T" bị ghép nhầm vào dòng khác ("Tappendices."), dòng đầu bị coi là căn giữa, chữ Việt đè lên chữ "T". Nay nhận diện riêng: chữ cái đầu của bản dịch được vẽ lại to ở đúng chỗ, các dòng bên cạnh thụt vào.
- Dòng đầu đoạn văn dài nằm gần giữa trang không còn bị nhận nhầm là tiêu đề căn giữa.
- Mục danh sách / ô bảng không còn bị nhận nhầm là "cột nhãn hình căn phải" (lỗi chữ lệch trái đè lên "c.", "d."…).
- Ô bảng / mục lục / danh sách "PHẦN I…VII": cùng cỡ gốc thì cùng cỡ chữ (hết cảnh dòng to dòng nhỏ).
- Font không chân (Avenir, Myriad, Frutiger, Helvetica…) bị pdf.js gắn nhầm "serif" → nay vẽ đúng Arimo thay vì Tinos.
- Khối chữ AI bỏ sót (còn nguyên tiếng Anh) được dịch bù tự động; phản hồi JSON bị cắt giữa chừng vẫn lấy được phần đã dịch.

**Nhanh hơn, không đơ máy:**
- Phân tích màu/cỡ chữ nhanh hơn 4–7 lần (viết lại hàm thống kê điểm ảnh, chỉ tách từng từ khi dòng thật sự có nhiều màu).
- Phần nặng CPU (vẽ trang, đọc điểm ảnh, dàn chữ) chạy lần lượt từng trang, có nhường luồng cho giao diện; phần gọi AI vẫn song song → không còn 3 trang cùng vẽ một lúc làm đơ máy và nghẽn trình xem PDF bên trái.
- Chỉ vẽ bản "không chữ" khi trang có hình / đường kẻ / mảng màu; ảnh trang được đọc một lần và dùng lại; giải phóng canvas ngay sau khi xong (mỗi canvas ≈ 15 MB).
- Các phần chữ của một trang gửi AI song song; OCR chữ trong hình chạy song song với dịch chữ thường (trước đây tuần tự).
- Bố cục cột AI đã xác nhận được dùng lại cho các trang khác cùng sách → ít lần gửi ảnh cho AI.
- IndexedDB: dùng một kết nối duy nhất; đọc đệm theo khoảng khoá của tài liệu (trước đây duyệt toàn bộ kho của mọi tài liệu mỗi lần mở file).

**Nút Dừng:**
- Bấm Dừng → hiện "Đang dừng…", huỷ ngay lệnh vẽ pdf.js, lệnh gọi AI và cả thời gian chờ thử lại (trước đây có thể chờ tới 8 giây/lần thử, và việc "dựng lại từ bản lưu" không dừng được nên web vẫn chạy ngầm).
- Lật sang trang khác → huỷ việc dựng lại trang cũ.
- Đệm ảnh nâng lên v13: trang đã dịch được tự dựng lại theo bộ máy mới, không tốn token (bản lưu cũ thiếu chữ cái đầu do drop cap vẫn ghép được).

### Cập nhật v7.1 — sửa tiếp trang 2 cột có hình và bìa sách

- **Trang 2 cột mà cột trái phần lớn là hình** (vd. sách Springer trang 6): trước đây bộ nhận diện chỉ thấy khe cột "yếu" nên phải hỏi AI. AI nhìn thấy cột trái toàn hình và trả lời "1 cột", thế là khe cột bị bỏ. Hậu quả: dòng của hai cột bị ghép lẫn vào nhau, đoạn văn vỡ thành dòng lẻ, chữ Anh còn sót đè lên chú thích hình. Câu trả lời sai này còn được ghi nhớ nên dịch lại vẫn sai. Sửa: tính bằng chứng theo số hàng (có tính cả chú thích hình); khe cột có bằng chứng rõ thì AI không được bỏ; xoá bộ nhớ số cột cũ.
- **Bìa sách: phụ đề xếp dọc từng chữ ở đầu trang**: AI đọc chữ trong ảnh và trả lại cả phụ đề vốn đã có trong lớp chữ, nhưng với khung vị trí sai. Nay khối OCR trùng nội dung với lớp chữ, hoặc có khung vô lý (nhiều từ mà khung quá hẹp), đều bị loại, kể cả khi dựng lại từ bản đã lưu.
- Đệm ảnh v14: các trang đã dịch tự được vẽ lại. Những khối trước đây bị tách sai sẽ được dịch bù (tốn ít token).

### Cập nhật v7.2 — kiểm thử trên sách thật (Fornage, Interventional Ultrasound of the Breast)

- **Dải chữ tiếng Anh sót ở đầu mỗi dòng cột trái** (trang 6: "Fig. 1.13", "benign type", "and 1.14,"…): AI đọc chữ trong ảnh siêu âm trả về một khối hẹp và cao dọc mép trái hình (thang độ sâu, nhãn "ST"). Khối này không cần dịch nên bước "giữ nguyên số mục/ký hiệu" đã chép trả cả dải ảnh gốc, đè lên bản dịch. Sửa: không bao giờ chép trả khối OCR hoặc khối lớn; bỏ khối OCR có khung lấn vào chữ thường.
- **Đọc chữ trong hình nay mặc định TẮT** (nút mới "Chữ trong hình" trên thanh công cụ). Đây là nguyên nhân chính khiến mỗi trang có hình mất hơn 1 phút: phải gửi ảnh trang 1600px cho AI đọc rồi mới vẽ được. Chữ trong ảnh y khoa (thang đo, ST, L/R…) hầu như không cần dịch.
- **Chú thích hình bị ghép với thân bài cột bên cạnh** (trang 15): khe cột của Springer rất hẹp, chỗ cột bên kia chỉ có hình + chú thích thì không dò ra khe. Nay hai mảnh chữ khác cỡ hẳn trên cùng hàng được tách riêng, và không bị coi là ô bảng.
- **Vệt nét chữ sót ở cuối tiêu đề** (vd. "┌" sau "PATIENT"): vùng xoá được nới sang hai bên theo mực thật.
- Nét chữ rất to (tiêu đề bìa) không còn bị coi là logo nên được xoá hết; chữ trên nền ảnh lấy đúng màu (phần sáng/tối nhất của vùng).
- Đường kẻ bảng chỉ được giữ khi chạy tiếp ra ngoài khung chữ (không giữ nhầm thân chữ F, l…).
- **Dịch nhanh hơn**: mỗi trang chia thành các phần ~1800 ký tự, gửi song song tối đa 3 phần. Thời gian chờ AI giảm ~40% (mô phỏng).
- Kiểm thử: 40 trang thật (tr. 18–57) chạy không lỗi, xử lý trên máy ~0,5 giây/trang; nút Dừng thoát mọi luồng trong < 0,1 giây sau khi bấm.
- Đệm ảnh v16: trang đã dịch tự vẽ lại.

### Cập nhật v7.3 — không dồn tải lên ShopAIKey

**Bộ điều tiết chung cho mọi yêu cầu qua proxy** (ShopAIKey và key hệ thống `/api/ai/chat`; mọi chức năng: dịch thường, dịch giữ định dạng, tóm tắt, OCR…):
- Tối đa **2 yêu cầu cùng lúc**, các lần gửi cách nhau ≥ 0,35 giây. Muốn đổi thì đặt `localStorage.mediTrans_proxyMaxConcurrent` (1–8).
- Proxy báo quá tải (429, 5xx, "overloaded", lỗi mạng) → **tạm dừng mọi yêu cầu** theo `Retry-After`, hoặc lùi dần 4 → 8 → 16 → 30 giây, và chỉ gửi 1 yêu cầu/lần. Sau 6 lần thành công liên tiếp thì tăng dần trở lại.
- Bấm Dừng vẫn thoát ngay cả khi đang chờ trong hàng.

**Cấu hình dịch nhiều trang (trước → sau, khi dùng ShopAIKey):**
| Chức năng | Trước | Sau |
|---|---|---|
| Dịch toàn bộ (dịch thường) | 6 trang cùng lúc (nhiều key: tới 10), chạy theo mẻ | 3 trang, hàng đợi liên tục (trang xong thì lấy trang tiếp) |
| Dịch trước khi lật trang | 5 trang | 2 trang |
| Dịch giữ định dạng | 3 trang × 3 phần = tới 9 yêu cầu | 2 trang; mọi yêu cầu qua bộ điều tiết (≤ 2 cùng lúc) |

Key Google riêng (AIzaSy…) giữ cấu hình cũ, vì có giới hạn và cơ chế xoay key riêng.

Kiểm thử mô phỏng: dồn 12 yêu cầu cùng lúc vào proxy chỉ chịu 2 → đỉnh 2 yêu cầu, 0 lần quá tải, 12/12 thành công. Proxy chỉ chịu 1 → 2 lần quá tải rồi tự hạ nhịp, 12/12 thành công.

### Cập nhật v7.4 — rà soát toàn bộ luồng API Key + tăng tốc dịch thường / nâng cao

**Lỗi key Google (Gemini API) đã sửa:**
1. **Nguyên nhân lỗi 403 PERMISSION_DENIED:** mọi yêu cầu qua key Google đều bị ĐỔI NGẦM sang `gemini-3.6-flash` (hàm `mapModelForGoogle`), kể cả khi chọn "Cơ bản (Flash Lite)". Key không có quyền dùng model này thì hỏng hết. ShopAIKey không bị vì dùng bảng đổi tên khác. Nay: giữ đúng model đã chọn; nếu key bị từ chối model đó (403/404) thì **tự chuyển** lần lượt sang gemini-2.5-flash → 2.5-flash-lite → flash-latest. Model dùng được được ghi nhớ theo từng key.
2. **Test key:** chỉ thử các model 3.x nên key tốt vẫn báo lỗi; lỗi 429 (tạm hết lượt) bị coi là key hỏng và bị đánh dấu "error" trên Firestore. Nay: thử cả model dự phòng, báo rõ model nào dùng được; phân biệt *key sai*, *bị từ chối*, *tạm hết lượt* (key tạm hết lượt vẫn giữ trạng thái "active"). Áp dụng cho Test key trong Cài đặt, khi thêm key mới, trong Quản trị (key người dùng, key hệ thống) và kiểm tra hàng loạt.
3. **Nhận diện loại key thống nhất:** trước đây chỗ xét nhãn, chỗ xét tiền tố "sk-" → ShopAIKey không có "sk-" bị gọi nhầm sang Google, key AIzaSy… lỡ gắn nhãn ShopAIKey bị gửi sang proxy. Nay: AIzaSy… luôn là Google; các key khác theo nhãn trong kho key, dùng chung cho mọi chức năng (dịch thường, nâng cao, giữ định dạng, tóm tắt, tra thuật ngữ, OCR).
4. **Lỗi 403 / key sai** trước đây bị coi như hết hạn mức → thử lại 6 lần vô ích rồi mới hiện lỗi tiếng Anh khó hiểu. Nay: key bị từ chối hẳn được bỏ qua 10 phút, chuyển sang key khác; không còn key nào thì báo ngay bằng tiếng Việt (nêu cách khắc phục).
5. Dịch thường bằng key Google trước đây không dừng được bằng nút Dừng (thiếu tín hiệu huỷ) → đã sửa.
6. Key nhập tay: nhập ở chế độ "Cơ bản" rồi chọn "Chuyên sâu" thì báo không có key → nay dùng chung.
7. **Chia sẻ key:** thêm danh sách email đang được chia sẻ và nút **Thu hồi**; kiểm tra email hợp lệ, không chia sẻ cho chính mình, Enter để chia sẻ.

**Dịch thường / dịch nâng cao nhanh hơn:**
- Dịch theo lớp chữ dùng **phân tích nhẹ** (chỉ đọc lớp chữ, không vẽ trang): dựng Markdown nhanh hơn ~30 lần (5 trang: 2,7 giây → 0,08 giây), không tranh tài nguyên với trình xem PDF và tab Giữ định dạng.
- **Trang dài (> ~2.400 ký tự) chia 2–3 phần dịch song song**, cắt tại ranh giới đoạn (tiêu đề luôn đi cùng đoạn sau nó). Phần đầu vẫn hiện dần; thời gian chờ ≈ phần dài nhất (ước tính nhanh gần gấp đôi với trang dài).
- **Bảo đảm toàn bộ tiếng Việt:** sau khi dịch, dòng (kể cả ô bảng, gạch đầu dòng, dòng in đậm) còn sót tiếng Anh được tự dịch bù, giữ nguyên định dạng Markdown; tài liệu tham khảo giữ nguyên. Không có dòng sót thì không gọi thêm AI.
- Số luồng dịch hàng loạt với key Google: 2 trang/key (tối đa 8) thay vì 6–12 với cả 1 key (gây 429 liên tục).

### Cập nhật v7.5 — tối ưu chủ đạo cho ShopAIKey + sửa bảng OCR + kiểm thử toàn bộ

**ShopAIKey nhanh nhất có thể mà không quá tải:**
- **Bộ điều tiết tự học:** bắt đầu 2 yêu cầu cùng lúc, cứ 4 lần thành công liên tiếp thì tăng 1 (tối đa 6; chỉnh bằng `localStorage.mediTrans_proxyMaxConcurrent`, 1–10). Khi bị 429 lúc đang chạy N yêu cầu → ghi nhớ ngưỡng an toàn N−1 trong 10 phút và chạy đúng ngưỡng đó (không thử vượt lại). Lỗi 5xx / rớt mạng chỉ dừng 0,8 giây, không hạ ngưỡng. Sau 429 vòng thử lại không chờ thêm (bộ điều tiết đã dừng đúng mức).
- Đo trên ShopAIKey giả lập (24 yêu cầu, 3–5% lỗi 502 ngẫu nhiên), đơn vị giây:

| ShopAIKey chịu được | Cố định 2 (v7.3–7.4) | v7.5 |
|---|---|---|
| 1 yêu cầu | 67 | 63–67 |
| 2 yêu cầu | 33 | 33 |
| 4 yêu cầu | 39 | **21** |
| 8 yêu cầu | 38 | **16–19** |

- **Tự chọn model:** web hỏi ShopAIKey danh sách model (`/models`, lưu đệm 12 giờ). Dịch thường dùng **gemini-2.5-flash-lite** (nhanh nhất). Dịch nâng cao dùng **gemini-2.5-flash** (trước đây cũng bị đổi về Flash-Lite nên không hơn dịch thường). ShopAIKey không có model đó → tự chuyển sang model kế tiếp ngay ở lần gọi sau (không chờ, không đổi key). Model tự đặt trong Cài đặt vẫn được ưu tiên.
- Số trang song song khi dùng ShopAIKey: dịch toàn bộ 4 trang, giữ định dạng 3 trang, dịch trước 2 trang; mọi yêu cầu đều qua bộ điều tiết.

**Dịch giữ định dạng — bảng BI-RADS (trang dịch bằng OCR):**
- Khung OCR chạm đường kẻ dọc → đường kẻ bị tính là "chữ": chữ dịch đè lên đường kẻ, vị trí dòng sai, nhận nhầm in đậm. Nay nhận diện đường kẻ dọc (nét liền dài hơn 1,6 dòng) và đường kẻ ngang, loại khỏi mọi phép đo; dòng chữ bị đường kẻ ngang ngăn cách không bị gán nhầm sang ô khác.
- In đậm theo mật độ mực chặt hơn với ô ngắn; các ô cùng cột (thẳng mép trái) dùng chung một cỡ chữ.

**Lỗi tìm thấy khi kiểm thử toàn bộ sách thật (465 trang) và đã sửa:**
- Chú thích hình chạy 2 cột bị tách thành từng dòng (bị coi là ô bảng) → nay là đoạn liền mạch.
- Trang có bảng chữ nhỏ nhiều ô: hai cột văn bản thân bài bị ghép ngang thành một (do chọn nhầm cỡ chữ của bảng làm chữ thân bài, và ngưỡng ±15% quá rộng) → nay dò khe cột theo từng cỡ chữ chính, ngưỡng ±10%.
- Bỏ điều kiện "chữ vắt qua khe" (thêm ở v7.1) vì làm hỏng nhận diện cột ở trang có tiêu đề bảng chạy ngang trang.

**Kiểm thử đã chạy (đều đạt):** giữ định dạng 120 trang sách thật (0 lỗi, ~0,5 giây/trang); dựng Markdown toàn bộ 465 trang (0 lỗi, 452 trang dịch theo lớp chữ); trang mẫu drop cap / bảng / 2 cột / bìa; AI trả lời sai số cột; OCR khung sai; bảng OCR chạm đường kẻ; nút Dừng (thoát < 0,2 giây); ShopAIKey giả lập 1/2/4/8 yêu cầu + lỗi ngẫu nhiên; tự chọn model ShopAIKey (3 trường hợp); key Google (403, key sai); dịch bù tiếng Anh (không báo nhầm trên bản tiếng Việt); TypeScript + build.

### Cập nhật v7.6 — cố định model gemini-3.5-flash-lite cho ShopAIKey

- Theo thông báo của ShopAIKey (15/11/2026): Gemini 2.5 Pro / 2.5 Flash đang quá tải, Google ngừng hỗ trợ từ 01/12/2026; khuyến nghị dùng `gemini-3.5-flash-lite`.
- **Mọi yêu cầu qua ShopAIKey / key hệ thống** (dịch thường, dịch nâng cao, giữ định dạng, tóm tắt, tra thuật ngữ, OCR) dùng **cố định `gemini-3.5-flash-lite`**. Bỏ cơ chế tự đổi model và việc hỏi danh sách model (bớt một yêu cầu mỗi phiên).
- Chỉ đổi model khi tự đặt "Model dịch thường" trong Cài đặt (ô "Model nâng cao" không còn tác dụng với ShopAIKey). Lựa chọn cũ đã lưu là model Gemini 2.5 được tự chuyển về mặc định một lần.
- Key hệ thống (`/api/ai/chat`): mặc định `gemini-3.5-flash-lite`; danh sách model cho phép bổ sung các model 3.x.
- Nhãn chế độ dịch: "Cơ bản (3.5 Flash-Lite)", "Chuyên sâu (3.5 Flash-Lite)".

### Cập nhật v7.7 — giảm token dịch thường (model Gemini 3.5 Flash-Lite)

**Nguyên nhân tốn token:** Gemini 3 luôn "suy nghĩ" (không tắt được như 2.5-flash-lite trước đây); phần suy nghĩ tính vào token đầu ra. Web gửi `reasoning_effort: "minimal"` (mức thấp nhất), nhưng một số cổng chỉ nhận `high, low, medium, none` và từ chối "minimal". Khi đó code cũ BỎ HẲN tham số → model suy nghĩ ở mức MẶC ĐỊNH (cao) → tốn rất nhiều token đầu ra và chậm hơn.

**Đã sửa:**
- **Thương lượng mức suy nghĩ thấp nhất** cho từng model: bị từ chối thì đọc danh sách giá trị hợp lệ trong thông báo lỗi và chọn mức thấp nhất còn lại ("none" → "low"), không bao giờ để trống tham số. Chỉ mất 1 yêu cầu bị từ chối mỗi phiên.
- Dịch thường: chỉ chia trang khi > 5.000 ký tự, tối đa 2 phần (trước: > 2.400 ký tự, 2–3 phần → lặp hướng dẫn hệ thống và phần suy nghĩ cho mỗi phần).
- Dịch giữ định dạng: gửi theo phần ~3.500 ký tự (trước 1.800) → ít lặp hướng dẫn hệ thống hơn. Dịch giữ định dạng (dịch khối, OCR, nhận diện cột) luôn dùng gemini-3.5-flash-lite, không bị ô Model trong Cài đặt ghi đè.
- Nhật ký (console) ghi số token thực tế mỗi lần gọi không-stream: `Token (model): vào X, ra Y (trong đó suy nghĩ Z)` để đối chiếu.

### Cập nhật v7.8 — sửa lỗi "thỉnh thoảng" của Giữ định dạng + giảm token dịch thường

**Giữ định dạng — lỗi đã sửa:**
- **Bản dịch bị cụt nửa câu**: khi bản dịch có dấu ngoặc kép `"` (vd. dấu hiệu "bánh vòng"), JSON AI trả về bị hỏng; cách đọc dự phòng cũ cắt bản dịch ngay tại dấu `"` mà vẫn coi là thành công. Nay đọc lại đúng cả câu (`parseLayoutJson`), xuống dòng trong chuỗi không còn làm hỏng JSON, mục cuối bị cắt giữa chừng thì dịch bù chứ không lấy nửa câu.
- **Chế độ JSON** cho ShopAIKey / key hệ thống (`response_format: json_object`, `/api/ai/chat` chuyển tiếp); proxy không nhận thì tự bỏ sau 1 lần. Prompt yêu cầu dùng “ ” thay cho `"`.
- **Một phần lỗi làm hỏng cả trang**: trang được chia nhiều phần gửi song song, chỉ cần 1 phần lỗi (JSON hỏng / proxy bận) là cả trang báo lỗi và mất phần đã dịch. Nay giữ các phần thành công, khối thiếu được dịch bù.
- **Còn sót chữ tiếng Anh**: khối AI trả lại nguyên văn tiếng Anh nay được nhận ra và dịch bù (trừ tài liệu tham khảo, tên riêng). Không dịch được khối nào → báo lỗi thay vì lưu trang toàn chữ gốc.
- **Font sai / chữ to nhỏ thất thường**: mạng chậm > 4 giây thì font Tinos/Arimo chưa tải xong nhưng web vẫn coi là xong cả phiên → trang vẽ bằng font dự phòng và bị lưu vào đệm. Nay kiểm tra font đã sẵn sàng thật (chờ tối đa 8 giây, thử lại ở trang sau), nạp cả bộ ký hiệu µ ± ≤ ≥ × →.
- **Dựng lại trang từ bản lưu bị lỗi → lặp vô hạn** (mỗi vòng còn gọi AI dịch bù → tốn token, máy chạy ngầm). Nay chỉ thử 1 lần, hiện thông báo lỗi; nút "Dịch lại" hiện cả khi trang chỉ có bản lưu đám mây (trước đây trang bị kẹt: nút Dịch bị khoá, không có nút Dịch lại).
- **Hai file PDF trên máy trùng tên + cùng số trang** dùng chung đệm → hiện nhầm bản dịch của file kia. Khoá đệm của file chưa lưu lên tài khoản nay kèm mã nhận dạng PDF (file đã lưu tài khoản không đổi). File cục bộ đã dịch trước đây sẽ phải dịch lại một lần.

**Dịch thường — giảm token:**
- **Tài liệu tham khảo không gửi AI**: cụm ≥ 2 mục tham khảo liền nhau được giữ nguyên ngay trên máy (trước đây AI chép lại y nguyên, tốn hàng nghìn token đầu ra mỗi trang tham khảo). Trang toàn tham khảo → 0 token.
- **Hết nội dung lặp 2 lần** khi mạng/proxy rớt giữa lúc đang hiện chữ: trước đây web dịch lại từ đầu và nối thêm vào phần đã hiện (lặp nội dung, tốn gấp đôi). Nay dừng và báo lỗi để bấm dịch lại.
- Key Google, chế độ đọc ảnh: mức suy nghĩ `minimal` (trước `low`), giống ShopAIKey → ít token đầu ra hơn.

### Cập nhật v7.9 — đổi model ShopAIKey sang gemini-3-flash-preview

- Mọi yêu cầu qua **ShopAIKey / key hệ thống** (dịch thường, chuyên sâu, giữ định dạng, OCR, nhận diện cột, tóm tắt, tra thuật ngữ) dùng mặc định **`gemini-3-flash-preview`** (trước: `gemini-3.5-flash-lite`).
- `/api/ai/chat`: model mặc định `gemini-3-flash-preview` (vẫn đổi được bằng `SYSTEM_AI_DEFAULT_MODEL`).
- Cài đặt: ô "Model Proxy" có thêm `gemini-3-flash-preview (mặc định)`; vẫn chọn được `gemini-3.5-flash-lite` nếu muốn rẻ hơn. Ai trước đây đã chọn tay `gemini-3.5-flash-lite` được tự chuyển về "Mặc định" một lần.
- Định dạng yêu cầu giữ nguyên (OpenAI-compatible `/chat/completions`): `reasoning_effort: "minimal"` (proxy từ chối thì tự thương lượng mức thấp kế tiếp), `response_format: json_object` cho dịch giữ định dạng (proxy từ chối thì tự bỏ sau 1 lần).
- Key Google riêng (AIzaSy…) không đổi: vẫn theo "Chế độ dịch" trong Cài đặt, có tự chuyển model dự phòng.
- Lưu ý: 3 Flash Preview chính xác hơn nhưng giá/token cao hơn Flash-Lite; xem số token thực tế trong console (`Token (gemini-3-flash-preview): vào …, ra …`).

### Cập nhật v8.0 — chọn model theo chức năng (ShopAIKey / key hệ thống) + sửa nhận diện model cũ

| Chức năng | Model (ShopAIKey / key hệ thống) |
|---|---|
| Dịch thường (lớp chữ & đọc ảnh), dịch giữ định dạng, dịch bù dòng sót, tóm tắt, tra thuật ngữ | **gpt-4.1-mini** |
| OCR (trang scan, chữ trong hình), nhận diện số cột, dịch chuyên sâu | **gemini-3.1-flash-lite** |

- gpt-4.1-mini: không gửi tham số "suy nghĩ" (`reasoning_effort` chỉ gửi cho model Gemini 3); chế độ JSON (`response_format: json_object`) cho dịch giữ định dạng; proxy không nhận thì tự bỏ.
- Ô "Model Proxy" trong Cài đặt: ô Dịch thường ghi đè model dịch thường; ô Chuyên sâu nay **có tác dụng thật** (trước đây bị bỏ qua). Dịch giữ định dạng và OCR luôn cố định. Lựa chọn tự đặt cũ được đưa về "Mặc định" một lần.
- `/api/ai/chat`: thêm `gpt-4.1-mini`, `gpt-4.1` vào danh sách cho phép; mặc định `gpt-4.1-mini`.

**Lỗi nhận diện model (log `Using key … for gemini-flash-lite-latest`):** "Chế độ dịch" lưu trong máy còn tên engine cũ (vd. `gemini-flash-lite-latest`) và dòng log in tên engine này chứ không phải model thật được gửi. Nay tên engine cũ được chuẩn hoá về Cơ bản / Chuyên sâu khi mở web, và log in đúng model thật: `engine "…" → model gpt-4.1-mini`.

### Cập nhật v8.1 — sửa lỗi trình bày dịch thường (mục lục hiện thành khối code nền đen)

- **Nguyên nhân chính** nằm ở bước hiển thị (`normalizeMarkdownLists`), không phải ở model: các quy tắc "ngữ nghĩa" cũ viết riêng cho một tài liệu tuỵ tự thụt 6 dấu cách mọi gạch đầu dòng bắt đầu bằng "Siêu âm / CT / MRI / X-quang…" và đổi thành `- **Siêu âm**: …` → Markdown hiểu là KHỐI CODE (nền đen, chữ đơn cách, hiện nguyên dấu `- **`). Đã bỏ các quy tắc này.
- Dòng **in đậm** (`**…**`) trước đây bị nhận nhầm là gạch đầu dòng "*" → hỏng dấu in đậm. Nay "-", "*", "+" phải có khoảng trắng phía sau mới là gạch đầu dòng.
- Thụt lề danh sách được giới hạn: mục con không sâu quá mục cha 1 cấp; dòng ngoài danh sách bị thụt ≥ 4 dấu cách được bỏ thụt (không còn thành khối code). Hàng rào ``` AI tự thêm bị bỏ.
- Áp dụng ở bước hiển thị → **các trang đã dịch trước đây cũng hiển thị đúng ngay**, không cần dịch lại.
- **Mục lục giữ số chương/mục** ("1", "1.1", "2.2.1") khi dựng Markdown từ lớp chữ (trước đây bị đổi thành "-" → mất số). Trang dịch mới mới có số.

### Cập nhật v8.2 — hết sót tiêu đề tiếng Anh ở Giữ định dạng ("References"…)

- **Nguyên nhân:** prompt có quy tắc "giữ nguyên tài liệu tham khảo" → AI áp dụng nhầm cho cả TIÊU ĐỀ "References" và trả nguyên văn; bước dịch bù (v7.8) chỉ bắt khối ≥ 4 từ nên tiêu đề 1 từ lọt qua.
- **Tiêu đề mục thông dụng dịch ngay trên máy**, không gửi AI (không tốn token, không bao giờ sót): References → Tài liệu tham khảo, Further Reading → Tài liệu đọc thêm, Conclusions → Kết luận, Introduction, Summary, Abstract, Discussion, Contents, Key Points, Acknowledgments… (giữ VIẾT HOA nếu bản gốc viết hoa).
- Prompt nói rõ: mục tài liệu tham khảo giữ nguyên nhưng tiêu đề mục luôn dịch.
- Bước dịch bù nay bắt cả **khối ngắn 1–3 từ** còn nguyên tiếng Anh thông dụng (tên riêng, tên thuốc, chữ viết tắt như BI-RADS, Doppler không bị coi là sót).
- **Trang đã dịch trước đây**: tiêu đề "References" trong bản lưu được tự thay khi dựng lại trang (không tốn token) — đệm ảnh nâng phiên bản để các trang tự vẽ lại.

### Cập nhật v8.3 — sửa "khối chữ quá chật" ở đoạn thụt treo + cỡ chữ to hơn

- **Đoạn thụt treo** (dòng đầu sát lề, các dòng sau thụt vào — kiểu "ACR: …" / "FBU: …" / "Examples: …" của BI-RADS): trước đây mỗi dòng thụt vào bị coi là MỞ ĐOẠN MỚI → một đoạn bị chặt thành nhiều khối; AI dồn cả câu vào khối 1 dòng (chữ tí hon, cảnh báo "khối chữ quá chật"), các khối sau nhận mẩu câu lặp / lệch chỗ, có khi dòng đầu của đoạn kế bị nhập nhầm vào đoạn trước. Nay nhận diện thụt treo (dòng trước chưa hết câu, hai dòng cùng chạy tới mép phải, các dòng sau thẳng hàng) → cả đoạn là MỘT khối, vẽ lại đúng kiểu thụt treo. Đã kiểm thử tái hiện trước/sau.
- Prompt dịch khối: câu có thể kéo sang khối sau — mỗi khối chỉ dịch chữ của chính nó, không dồn/lặp chữ giữa các khối.
- **Cỡ chữ**: cỡ chung cho thân bài trước đây lấy theo đoạn CHẬT NHẤT → một đoạn chật kéo cả trang xuống 72%. Nay lấy theo đa số (không dưới 85%); chỉ đoạn thật sự chật mới tự thu nhỏ riêng. Áp dụng tương tự cho ô bảng.
- Đệm ảnh v18: trang đã dịch tự vẽ lại. Trang có đoạn thụt treo (như tr. 98) có khối mới khác bản lưu → chỉ các khối đó được dịch bù (tốn ít token); muốn chắc chắn thì bấm "Dịch lại".

### Cập nhật v8.4 — chạy nhiều luồng hơn cho model nhanh (gpt-4.1-mini)

**Bộ điều tiết ShopAIKey / key hệ thống:** trần mặc định 8 yêu cầu đồng thời (trước 6), bắt đầu 3 (trước 2), tăng 1 sau mỗi 3 lần thành công (trước 4), giãn nhịp 0,15 giây (trước 0,25). Vẫn tự hạ ngay khi ShopAIKey báo 429 / quá tải và ghi nhớ ngưỡng an toàn 10 phút. **Cài đặt → mục 4 "Số yêu cầu đồng thời tối đa"** (2–12) để chỉnh khi cần.

**Khi model không "suy nghĩ" (gpt-4.1-mini)** — chia nhỏ gần như không tốn thêm token (chỉ lặp hướng dẫn hệ thống ngắn):
- Dịch thường: trang > 2.200 ký tự chia tới 4 phần ~1.600 ký tự dịch song song (Gemini vẫn > 5.000 ký tự, 2 phần). Phần đầu vẫn hiện dần, thứ tự giữ đúng.
- Giữ định dạng: mỗi trang chia phần ~2.000 ký tự, 4 phần song song (trước 3.500 ký tự, 3 phần); 4 trang cùng lúc (trước 3).
- Dịch toàn bộ: số trang song song theo trần đồng thời (mặc định 6 trang, trước 4). Tự dịch trước: 3 trang (trước 2).
- Không gửi trùng: trang đang dịch/đã dịch không bị gửi lại; mọi yêu cầu vẫn qua một bộ điều tiết chung.

### Cập nhật v8.4.1 — sửa lỗi trang trắng / "OCR không trả về khối chữ hợp lệ"
- **Trang trắng (trang lót, trang trống) khi dịch giữ định dạng**: trước đây trang không có lớp chữ được gửi đi OCR, AI trả `{"blocks":[]}` và trang bị báo lỗi "OCR không trả về khối chữ hợp lệ". Nay trang gần như trắng được nhận diện ngay trên máy (không gọi AI, không tốn token) và giữ nguyên trang gốc; nếu AI xác nhận trang không có chữ thì cũng giữ nguyên trang gốc thay vì báo lỗi.
- **Đọc kết quả OCR chịu lỗi tốt hơn**: bỏ ```json, chấp nhận tên trường khác (`bbox`/`box`, `original`, `vi`/`translation`), toạ độ 0–1, JSON bị cắt cụt (giữ các khối còn nguyên). OCR qua ShopAIKey bật chế độ JSON. JSON hỏng → tự thử lại 2 lần.
- **Không còn màn hình trắng tinh khi giao diện gặp lỗi**: thêm lớp bắt lỗi ngoài cùng (`src/main.tsx`) hiện thông báo lỗi kèm nút "Tải lại" và "Đặt lại cài đặt trình duyệt".
- **Dịch thử key ShopAIKey báo đúng lý do**: 401/403 → key sai/bị khoá (đánh dấu Lỗi), 402/hết số dư, 429/5xx → bận tạm thời, 404 → model không có. Key hệ thống báo đúng lý do máy chủ trả về (chưa đủ Level / bị khoá / kho key hệ thống trống) thay vì luôn báo "chưa đủ Level 2".

### Cập nhật v8.5 — chỉ dùng key ShopAIKey; rà soát chia sẻ key, key hệ thống, dịch thử key; sửa bảng chữ viết tắt
**Chỉ dùng ShopAIKey**
- Bỏ toàn bộ phần key Google Gemini: bỏ chọn nhóm key "Tất cả / Gemini / ShopAIKey" (luôn dùng ShopAIKey, cài đặt cũ tự chuyển), bỏ ô chọn loại key và gợi ý AIzaSy khi thêm key (cả trong trang quản trị key người dùng), bỏ nút "Chọn Key từ AI Studio", bỏ đường dự phòng dùng key Gemini nhập tay.
- Mọi key không phải AIzaSy… đều được gọi qua ShopAIKey (không còn phụ thuộc tiền tố `sk-`). Thêm key AIzaSy… bị từ chối kèm thông báo; key trùng hoặc quá ngắn cũng bị chặn.
- Key Gemini cũ đã lưu KHÔNG bị xoá (giữ dữ liệu), chỉ hiện nhãn "Gemini cũ · không dùng", không được dùng để dịch; có thể tự xoá.
- Level 1 vẫn giữ quy định cũ: không tự thêm key ShopAIKey (vẫn dùng được key người khác chia sẻ).

**Chia sẻ key giữa tài khoản**
- Chia sẻ / thu hồi dùng `arrayUnion` / `arrayRemove` (ghi nguyên tử) → hai thao tác cùng lúc không còn ghi đè mất email của nhau; thu hồi xoá cả các cách viết hoa/thường của email.
- Người được chia sẻ không còn thấy nút xoá (trước đây bấm xoá sẽ báo lỗi quyền); key hệ thống không hiện nút xoá, không hiện mã key.

**Key hệ thống ([Hệ thống] ShopAIKey)**
- "Dịch thử" key hệ thống nay gửi yêu cầu thật qua máy chủ (trước đây chỉ hiện "đã bảo mật", không thử gì).
- Máy chủ `/api/ai/chat`: key hệ thống bị ShopAIKey từ chối (401/403) hoặc hết số dư (402) → tự chuyển sang key hệ thống kế tiếp; tất cả key chỉ hết lượt → trả 429 + Retry-After (trình duyệt tự giãn nhịp, trước đây trả 502); lỗi 403 của ShopAIKey không còn bị trình duyệt báo nhầm thành "chưa đủ Level 2".
- Trình duyệt báo đúng lý do máy chủ trả về (chưa đủ Level / tài khoản bị khoá / kho key hệ thống trống / phiên đăng nhập hết hạn).

**Dịch thử key & hiển thị key đang hoạt động**
- Phân loại kết quả dịch thử: 401/403 → key sai/bị khoá (đánh dấu Lỗi); 402 → hết số dư; 429/5xx → bận tạm thời (vẫn "Hoạt động"); 404 → model không có (không đánh dấu key lỗi); lỗi mạng → báo sai Base URL / mất mạng.
- Kho key hiện nhãn "Đã thử: hoạt động / tạm bận / lỗi" (kèm giờ thử), "Ưu tiên" (key đang chọn) và "Đang dùng" (key vừa dịch thành công gần nhất).
- Cài đặt → mục "Key ShopAIKey dùng để dịch" hiện key ưu tiên, key vừa dịch thành công, số key khả dụng/đang lỗi và cảnh báo key Gemini cũ.

**Dịch giữ định dạng — bảng chữ viết tắt 2 cột**
- Ô bên trái dài ("BRCA1 and BRCA2") làm khe cột hẹp → trước đây 2 ô bị nối thành 1 dòng rồi nhập vào hàng trên (chữ chồng nhau, mất hàng). Nay khe trùng vị trí khe cột của các dòng lân cận được tách thành 2 ô.
- Ô viết tắt có số ("E2") được coi là ô bảng → không bị nối vào hàng trên (trước đây ra "Chụp X-quang kỹ / thuật số Estradiol").
- Ô bảng/mục trong cột thẳng hàng trái tình cờ nằm giữa trang không còn bị căn giữa → bản dịch thẳng cột (DE, ER, FLR, FOV, ROI, SE…).
- Đổi phiên bản bộ dựng trang (v19) → trang đã lưu được dựng lại theo cách mới.

### Cập nhật v8.6 — giữ màu chữ / kiểu chữ của bản gốc khi dịch giữ định dạng
- Số hình và trích dẫn màu xanh (Figs. 3.2, 3.3 … [3]) trước đây thành chữ đen vì AI bỏ mất thẻ đánh dấu kiểu chữ. Nay sau khi dịch, đoạn nào trong bản gốc có màu/nghiêng/đậm riêng mà bản dịch thiếu thẻ thì web tự tìm đúng đoạn chữ giữ nguyên (số, mã, tên) trong bản dịch và gắn lại màu/kiểu chữ gốc (`restoreTags` trong `layoutEngine.ts`, áp dụng cả khi dựng lại trang từ bản dịch đã lưu trên đám mây — không cần dịch lại).
- Hướng dẫn cho AI nhấn mạnh phải giữ đủ thẻ quanh số hình / trích dẫn.
- Đổi phiên bản bộ dựng trang (v20) → trang đã lưu được vẽ lại với màu đúng.
- Level 1: giữ quy định như v8.5 (không tự thêm key ShopAIKey, dùng được key được chia sẻ).

### Cập nhật v8.7 — trang trắng ra ảnh trang trắng, không cảnh báo
- Trang trắng (không có chữ) ở chế độ giữ định dạng nay cho ra đúng ảnh trang trắng, KHÔNG còn hiện cảnh báo "Trang scan (không có lớp chữ) và bộ dịch hiện tại không đọc được ảnh…". Trước đây trang trắng được giữ ảnh gốc nhưng vẫn bị đánh dấu "trang scan" nên hiện cảnh báo và bị bỏ khỏi file PDF xuất ra.
- Trang trắng được lưu dấu `__blank__` lên đám mây → mở lại / máy khác không gọi AI, không cảnh báo. Trang trắng có mặt trong PDF xuất ra (đúng thứ tự trang).
- Trang scan có chữ vẫn đi OCR qua model OCR (Gemini 3.1 Flash-Lite) như cũ; cảnh báo chỉ còn hiện khi trang scan thật sự không đọc được.
- Đổi phiên bản bộ dựng trang (v21) → trang trắng đã lưu kèm cảnh báo được dựng lại.

### Cập nhật v8.8 — số trích dẫn / số hình màu xanh giữ đúng màu (sửa tận gốc)
Tái hiện trên trình duyệt thật với dòng "Halliwell, was published [6, 7]. The new technique…" (chữ số xanh giữa dòng chữ đen) và tìm ra 3 nguyên nhân:
1. **Bỏ sót màu khi chỉ vài ký tự có màu**: dòng chữ chỉ được tách theo màu khi phần mực có màu chiếm ≥ 4% — vài chữ số trích dẫn chỉ chiếm 1–3% → cả dòng bị coi là một màu đen. Nay chỉ cần vài điểm ảnh có màu (chữ đen khử răng cưa gần như không có điểm màu nên không bị nhận nhầm).
2. **Số bị "kế thừa" màu chữ đứng trước**: mảnh chữ không có chữ cái (số, dấu câu) bị gán kiểu chữ của mảnh trước → "6, 7" màu xanh thành đen. Nay chỉ dấu câu thuần mới kế thừa; số giữ màu riêng.
3. **Số không được đánh dấu khi gửi dịch**: đoạn không có chữ cái (chỉ có số) không được bọc thẻ màu. Nay số cũng được bọc thẻ.
- Gắn lại thẻ màu sau dịch chịu được khác biệt khoảng trắng ("6, 7" ↔ "6,7") và "and" ↔ "và".
- Đã kiểm tra: trước sửa → cả dòng màu đen, không có thẻ; sau sửa → "[<1>6, 7</1>]" màu xanh (43,43,184); bản dịch "[6,7] … [10, 11] … [8], [9], [12]" được gắn lại màu đủ cả 5 chỗ.
- Bản dịch đã lưu không cần dịch lại: mở lại trang là màu xanh được tô lại (đổi phiên bản bộ dựng trang v22).

### Cập nhật v8.9 — hết lỗi "ArrayBuffer is detached" và chống cạn hạn mức ghi Firestore
**Lỗi "Failed to save active session… ArrayBuffer is detached" (lặp liên tục)**
- Nguyên nhân: file PDF (ArrayBuffer) được đưa thẳng cho pdf.js; pdf.js chuyển (detach) vùng nhớ đó sang luồng xử lý riêng → mỗi lần lật trang web lưu phiên làm việc với buffer rỗng → lỗi. Đồng thời mỗi lần lật trang web lưu lại CẢ file PDF (vài chục MB) vào IndexedDB.
- Sửa: đưa cho pdf.js bản sao (`slice(0)`), giữ bản gốc để lưu phiên; buffer PDF lưu riêng một lần, lật trang chỉ lưu số trang (vài byte); gộp các lần lưu trong 800 ms; buffer đã detach thì bỏ qua thay vì báo lỗi. Phiên cũ đã lưu vẫn mở lại được.

**Firestore hết hạn mức ghi miễn phí trong ngày (resource-exhausted)**
- Nguyên nhân chính: khung "Giữ định dạng" nhận object `cloud` mới mỗi lần giao diện vẽ lại (hàng chục lần/giây khi đang dịch) → hiệu ứng đồng bộ chạy lại và GHI LẠI lên Firestore mọi trang chưa được xác nhận (trang đang gửi, trang lỗi) — một trang có thể bị ghi hàng trăm lần.
- Sửa: giữ `cloud` cố định theo tài liệu; mỗi trang chỉ gửi một lần (không gửi trùng khi đang gửi, lỗi thì không tự thử lại trong phiên); bỏ qua lượt ghi khi nội dung y hệt lần trước (cả bản dịch thường lẫn giữ định dạng).
- Khi Firestore báo hết hạn mức: tạm ngừng mọi lượt ghi lên đám mây 1 giờ, báo MỘT lần; bản dịch vẫn lưu trên máy và trang chưa lưu được sẽ tự đồng bộ ở lần mở sau khi hạn mức được đặt lại (Google đặt lại lúc 0h giờ Thái Bình Dương ≈ 15:00 giờ Việt Nam).
- Không cần làm gì thêm phía Firebase. Database này là loại miễn phí ("free tier database") nên bật thanh toán cũng không tăng được hạn mức; nếu sau này cần nhiều hơn 20.000 lượt ghi/ngày thì phải tạo database Firestore trả phí mới.

### Cập nhật v9.0 — xuất bản dịch giữ định dạng ra MỘT file PDF duy nhất
- Nút xuất PDF ở tab "Giữ định dạng" nay luôn ghép toàn bộ các trang đã dịch (hoặc khoảng trang đã nhập) thành **một file PDF** `…_ban-dich-giu-dinh-dang.pdf`, không còn chia 150 trang/file.
- Ghép nhanh hơn và không đứng giao diện với tài liệu hàng trăm trang: ảnh trang đọc lần lượt từ ổ đĩa, không nén lại ảnh JPEG đã nén sẵn, nhường giao diện sau mỗi 20 trang; tài liệu > 60 trang có thông báo "Đang ghép…".

### Cập nhật v9.1 — tên file bản dịch có tiền tố "MediTrans_"
- File PDF bản dịch giữ định dạng: `MediTrans_<tên tài liệu>_ban-dich-giu-dinh-dang.pdf`; ảnh 1 trang: `MediTrans_<tên tài liệu>_trang-<n>_ban-dich.jpg`.

### Cập nhật v9.2 — key hệ thống bị tắt trong ShopAIKey Pool thì hiện "Đã tắt" và không dùng để dịch
- Trước đây "[Hệ thống] ShopAIKey" là key ảo luôn hiện "Hoạt động" cho mọi tài khoản Level 2 (người dùng thường không đọc được kho key hệ thống), kể cả khi quản trị viên đã tắt hết key trong ShopAIKey Pool.
- Thêm `GET /api/ai/status` (Vercel + server.ts): máy chủ kiểm tra token đăng nhập rồi chỉ trả về SỐ key hệ thống đang bật (không bao giờ trả mã key).
- Giao diện hỏi trạng thái khi đăng nhập, mỗi 5 phút, khi quay lại tab, ngay khi quản trị viên bật/tắt/thêm/sửa/xoá key trong ShopAIKey Pool, và khi máy chủ báo "chưa có API Key khả dụng".
- Kho key tắt hết → "[Hệ thống] ShopAIKey (đã tắt)" với nhãn "Đã tắt", không còn nhãn "Ưu tiên"/"Đang dùng", KHÔNG được đưa vào danh sách key dịch; key ưu tiên tự chuyển sang key ShopAIKey khác (nếu có). Bật lại key → tự hiện lại "Hoạt động".
- Không hỏi được máy chủ (lỗi mạng / chưa cấu hình Firebase Admin) → giữ cách cũ, không chặn nhầm.

### Cập nhật v9.3 — xoá key chắc chắn (không còn "xoá thành công" rồi tải lại vẫn còn)
- Nguyên nhân: Firestore đang hết hạn mức ghi miễn phí trong ngày (lệnh xoá cũng tính là một lượt ghi). Thư viện Firebase xoá key ngay trên máy (key biến mất khỏi danh sách) rồi chờ máy chủ; máy chủ từ chối vì hết hạn mức → lệnh xoá chỉ nằm trong bộ nhớ tạm, tải lại trang là mất → key hiện lại.
- Sửa (`src/services/keyDeletion.ts`, dùng cho cả Kho API Key và Trang Quản Trị):
  - Chỉ báo "Đã xoá" khi máy chủ xác nhận (chờ tối đa 10 giây).
  - Máy chủ chưa nhận (hết hạn mức / mạng chậm): key được ghi vào danh sách chờ xoá trên máy (localStorage) → ẩn khỏi mọi danh sách, không dùng để dịch kể cả sau khi tải lại trang; thông báo rõ là chưa xoá được trên máy chủ.
  - Web tự xoá lại các key trong danh sách chờ khi đăng nhập và mỗi 10 phút, đến khi máy chủ xác nhận.
  - Lỗi thật (không có quyền…) → báo lỗi, không ẩn key.

## v9.4 — Sửa theo bản rà soát PDF dịch
- Xuất PDF: ảnh trang 2100px (≈250 dpi khổ A4), JPEG 0.86, thêm lớp chữ ẩn (font Tinos, nhúng tập con) để tìm kiếm/copy được trong bản dịch.
- Bố cục: chữ không tràn quá lề dưới vùng nội dung; từ/đường link dài được ngắt dòng thay vì tràn ra ngoài.
- Bảng thuật ngữ y khoa Anh–Việt bắt buộc (~90 mục mặc định, sửa được trong Cài đặt). Chỉ gửi những thuật ngữ có trong trang cho AI.
- Bộ nhớ dịch: tiêu đề đầu trang, tên sách, tên mục đã dịch được dùng lại y hệt ở các trang sau. Có nút "Xoá bộ nhớ dịch".
- Tài liệu tham khảo: chỉ dịch tiêu đề mục, giữ nguyên các mục trích dẫn.
- ENGINE_VERSION v23: trang đã dịch bằng bản cũ sẽ được dựng lại.
- Thêm thư viện @pdf-lib/fontkit (package-lock.json thay đổi).

## v9.5 — Trang scan có ảnh lớn bị giữ nguyên tiếng Anh (BI-RADS tr.28)
- Nguyên nhân: trang scan chỉ có 2 ảnh nhũ ảnh + chú thích + tab dọc; AI OCR trả {"blocks":[]} → web coi là "trang trắng", lưu lại vĩnh viễn (cả trên đám mây) → bản dịch giống hệt bản gốc, nút "Dịch tr." bị khoá.
- Nay chỉ trang thật sự trắng (mực < 0,3%) mới được coi là trang trắng. Trang có hình mà AI trả rỗng → hỏi lại AI lần 2, nhắc rõ phải đọc chú thích "Figure…", tab chữ dọc, chân trang.
- Nếu vẫn rỗng → giữ trang gốc nhưng hiện ghi chú và cho "Dịch lại".
- Bản lưu cũ bị đánh dấu nhầm "trang trắng" sẽ tự được dịch lại bằng OCR khi mở trang (tốn token 1 lần cho mỗi trang đó).
- Đọc JSON OCR chịu lỗi hơn: mảng khối đặt tên khác ("text_blocks", "data", lồng trong "page"), trường chữ "content"/"caption"/"label", toạ độ theo pixel thay vì thang 0–1000.
- ENGINE_VERSION v24.

## v9.6 — Trang scan nhiều ảnh (BI-RADS tr.32, 34, 36) và chữ dọc
- Toạ độ OCR được đối chiếu với vùng chữ thật trên ảnh: khối chú thích AI đặt đè lên ảnh → dời về đúng chỗ chú thích gốc (không tìm được thì bỏ, giữ chữ gốc); khối chỉ khoanh một phần chú thích → nới ra cả đoạn. Nhãn ngắn trong ảnh giữ nguyên.
- AI trả rỗng cho trang toàn ảnh y khoa (tr.32) hoặc bị bộ lọc nội dung chặn → đọc lại với ảnh đã che các hình lớn (chỉ còn chữ in).
- Màu chữ trên trang scan: mực xám do nhoè ảnh → đen như bản gốc; chữ màu được đậm lại.
- Nhãn "Figure n"/"Table n" in đậm ở bản gốc → "Hình n"/"Bảng n" in đậm ở bản dịch (đo độ dày nét trên ảnh, hoặc AI báo bold_lead).
- Chữ dọc: tab "MAMMOGRAPHY" dịch theo bảng thuật ngữ (NHŨ ẢNH), dùng cả chiều dài tab nên không còn bé tí; trang có lớp chữ PDF cũng dịch chữ xoay 90° mà không cần bật "Chữ trong hình". Khung cao-hẹp AI quên báo hướng → coi là chữ dọc.
- Khối chỉ là một thuật ngữ trong bảng → dịch ngay trên máy; OCR gửi kèm bảng thuật ngữ.
- Đọc JSON OCR chịu lỗi hơn (khung dạng chuỗi, tên trường khác).
- ENGINE_VERSION v25.

## v9.7 — Sửa tiếp trang scan BI-RADS (tr.22, 28–31)
- Chú thích hình sát ngay dưới nhũ ảnh: trước đây cột ảnh tối bị coi là "đường kẻ dọc" → gần hết chiều ngang chú thích bị loại → bản dịch bị nhét vào cột hẹp tí hon, chữ gốc hai bên không được xoá. Nay điểm ảnh thuộc ẢNH LỚN không được tính là mực của khối chữ trên giấy; vùng dò dòng chữ không lấn vào ảnh.
- Khung OCR chỉ phủ một phần chú thích / thòng xuống khoảng trắng → thay bằng đúng vùng chữ gốc (đo trên ảnh).
- "Hình n" in đậm như "Figure n": đo độ dày nét và độ phủ mực của nhãn so với phần còn lại (đã thử: 6/6 chú thích tr.29–30 nhận đúng).
- Chú thích trên cùng trang dùng chung một cỡ chữ, giãn dòng ≤ 1,35 (hết "Hình 3" to bất thường).
- Tab dọc: cỡ chữ đo theo dải mực thật trên tab (chữ IN HOA ≈ 0,72 cỡ), in đậm theo độ dày nét, canh giữa; không còn bé tí.
- Đường link trong chữ scan giữ màu xanh/tím như gốc.
- Kiểu chữ có chân/không chân thống nhất theo đa số trên trang; AI không báo → mặc định không chân.
- Chữ in đậm cỡ lớn không còn bị nhận nhầm là ảnh.
- ENGINE_VERSION v26.

## v9.8 — Màu chữ đúng bản gốc, chữ trong hình, trang 36–38 BI-RADS

**Lỗi nặng nhất: tô xanh nhầm thuật ngữ (sách giải phẫu tr.17–18).**
- Nguyên nhân: câu lệnh dịch có ví dụ `<1>Right Ventricle</1>` → `<1>Tâm thất phải</1>`. AI bắt chước và tự bọc thẻ màu quanh "Tâm thất phải", "Vách liên thất", "Van hai lá", "Cơ nhú"…, kể cả ở tiêu đề "(5) Giải phẫu Van hai lá".
- Sửa câu lệnh: chỉ bọc thẻ quanh đúng phần dịch của chữ có thẻ trong câu gốc, không thêm thẻ, khối không có thẻ thì không có thẻ.
- Thêm bộ kiểm tra `sanitizeTags` (layoutEngine.ts), chạy trước khi vẽ, áp dụng cả cho bản dịch đã lưu. Mỗi thẻ trong bản dịch phải ứng với một đoạn có thẻ đó trong câu gốc, theo thứ tự:
  - đoạn gốc có số (1.25, [3]) thì bản dịch phải có đúng các số đó;
  - đoạn gốc là chữ thì độ dài phải tương xứng;
  - thừa số lần thì bỏ thẻ, giữ chữ màu thường.
- Kết quả: chỉ những đoạn có màu ở bản gốc (số hình 1.23, 1.25, 1.26, 1.2, 1.3…) mới có màu.

**Chữ trong hình (nút "Chữ trong hình").**
- Nhãn đặt theo khung AI khi việc dò mực trên ảnh/hình vẽ cho khung sai (trước đây phình to cả hình hoặc co còn 5px).
- Cỡ chữ nhãn không lớn hơn chữ gốc. Cỡ ước theo cả chiều rộng khung và số ký tự, không quá 1,15 lần cỡ chữ thân bài, không quá 1,35 lần trung vị các nhãn. Hết lỗi "ĐƯỜNG NHANH" khổng lồ.
- Chữ viết chéo hoặc khung cao bất thường: giữ nguyên bản gốc, không xoá-vẽ.
- Nhãn chồng lên nhãn đã nhận thì bị bỏ.
- Xoá nhãn trong ảnh bằng `eraseLabel`:
  - màu nền lấy từ viền khung;
  - xoá cả chữ trắng viền màu;
  - lấp dần từ ngoài vào bằng màu nền lân cận, nên không còn vệt xám hay bóng chữ;
  - không nới vùng xoá theo nét vẽ, giữ mũi tên và đường tròn.
- Câu lệnh OCR yêu cầu trả MỌI nhãn của hình vẽ (kể cả chữ viết tay), mỗi nhãn một khung riêng sát chữ.
- Khối chưa có bản dịch thì không bao giờ bị xoá.

**Trang 36–38 BI-RADS.**
- Chú thích hình 2–3 dòng bị dư một dòng thì thu nhỏ nhẹ (≤ 10%) để giữ đúng số dòng như bản gốc. Chú thích Hình 1 tr.38 nay còn 2 dòng, không chạm ảnh.
- Cỡ chữ thân bài tính bằng trung vị theo độ dài, không lẫn cỡ chú thích, nên chữ không còn nhỏ hay dồn.
- "1. HÌNH DẠNG" không còn in đậm nhầm.
- Xoá chữ trên giấy trắng nới viền 2 điểm, ngưỡng thấp hơn, nên hết vệt xám mờ.
- Bảng thuật ngữ thêm:
  - equal density = đậm độ tương đương; high density = đậm độ cao;
  - circumscribed = bờ rõ; obscured = bờ bị che khuất; lobulated = dạng thùy;
  - oval = bầu dục; simple cyst = nang đơn thuần;
  - thêm vài mô tả bờ khác.
- Bảng thuật ngữ người dùng đã tự sửa vẫn nhận các thuật ngữ mặc định mới.
- Quy tắc viết hoa: chỉ viết hoa phần dịch của từ viết hoa trong bản gốc ("OVAL mass" → "Khối BẦU DỤC", "LOBULATED" → "Khối DẠNG THÙY").
- OCR nối từ bị ngắt gạch cuối dòng ("Guid-ance" → "Guidance").
- ENGINE_VERSION = v27, nên các trang đã dịch tự vẽ lại theo cách mới mà không tốn token.

## v9.9 — Hết hạn mức ghi Firestore: ngừng thử ghi, không báo lỗi đỏ lặp lại

- Nguyên nhân lỗi đỏ liên tục: khi hết hạn mức ghi miễn phí, Firestore SDK coi `resource-exhausted` là lỗi tạm thời. SDK tự thử ghi lại mãi (backoff tối đa) và in lỗi mỗi lần thử. Promise của lệnh ghi không thất bại nên web không biết để dừng.
- firebase.ts bắt lỗi này ngay từ log của SDK (`onLog`). Khi bắt được:
  - đánh dấu hết hạn mức;
  - báo một lần (thông báo + một dòng cảnh báo);
  - tắt log lỗi lặp của Firestore SDK.
- Trạng thái hết hạn mức được nhớ qua các lần tải lại trang tới lúc hạn mức đặt lại (0:00 giờ Thái Bình Dương, khoảng 14:00–15:00 giờ Việt Nam). Trước đây chỉ nhớ 1 giờ trong bộ nhớ, nên mỗi lần F5 web lại thử ghi.
- Trong thời gian đó web không ghi gì mới lên đám mây. Bản dịch, bản giữ định dạng và thuật ngữ vẫn lưu trên máy, rồi tự đồng bộ khi mở lại sau giờ đặt lại.
- Giảm lượt ghi: trạng thái API key (chạy thử key, kiểm tra key, khôi phục key) chỉ ghi khi trạng thái thật sự đổi, không ghi `lastUsed` mỗi lần. Các chỗ ghi khác đã được rà:
  - bản dịch từng trang: có chống ghi trùng;
  - trang giữ định dạng: có chống ghi trùng;
  - bộ nhớ dịch và bảng thuật ngữ: chỉ lưu trên máy;
  - máy chủ: không ghi Firestore theo từng lượt dịch.
- Lỗi "[vite] failed to connect to websocket" là của môi trường xem thử (dev) trong AI Studio, dùng để tự tải lại khi sửa code. Lỗi này không ảnh hưởng web và không có trên bản build/Vercel.

## v10.0 — Sách "Chẩn đoán hình ảnh vú" (tr.18, 19, 36, 37, 40) + tự xin quyền Google Drive

**Cỡ chữ không đều trong cùng danh sách.**
- Nguyên nhân 1: trang 2 cột có dòng thẳng hàng giữa hai cột. Khối ở cột bên kia bị coi là "ô bảng cùng hàng", nên danh sách không được đẩy dòng xuống và từng mục tự thu nhỏ riêng. Khối nay mang số cột trang (`col`, theo khe cột đã dò). Khối ở cột khác không còn tính là bạn cùng hàng.
- Nguyên nhân 2: mục ngắn ("Breast", "Weeks 4-6") hoặc thụt cấp khác làm đứt nhóm chảy. Nay cùng cột thì cùng nhóm.
- Trong nhóm chảy, mục 1 dòng được xuống dòng và đẩy các mục sau, cả nhóm thu nhỏ đều nếu thiếu chỗ. Danh sách ≥ 3 mục chảy liền nhau nên khoảng cách giữa các mục đều.
- Các nhóm thân bài chênh nhau ≤ 0,16 dùng chung một cỡ trên cả trang.
- Ký hiệu đầu dòng (•, ○, –) canh theo giữa dòng đầu của mục, không lệch xuống.
- Mục giữ nguyên chữ (TDLUs, ASL…) nằm giữa danh sách cũng được vẽ lại để chảy theo, hết hở/đè.
- Mục cuối cột sát lề dưới không còn bị nhận nhầm là tiêu đề chạy (căn phải lệch).

**Tiêu đề bị gộp dòng.**
- "TERMINOLOGY" + "Abbreviations", "BREAST DEVELOPMENT" + "Neonatal"… nay là hai khối. Tiêu đề phụ xuống dòng riêng và giữ đậm.
- Quy tắc tách:
  - dòng IN HOA ↔ dòng thường;
  - tiêu đề đậm chênh cỡ > 6%;
  - màu chữ khác hẳn (chữ trắng trên thanh màu "SECTION 2: IMAGING" ↔ tiêu đề tối bên dưới), nên hết lỗi đè lên thanh màu.

**Mục lục.**
- Khối có mọi chỗ đổi kiểu chữ trùng chỗ xuống dòng (tên bài thường / tác giả nghiêng) thì bản dịch cũng xuống dòng tại chỗ đổi kiểu (`breakOnStyle`). Tên bài và tác giả ở hai dòng như bản gốc.
- Thuật ngữ: SECTION = PHẦN, MASSES = KHỐI (phân biệt hoa/thường), mass/masses = khối, table of contents = mục lục.

**Màu chữ.**
- Đã đo bản gốc tr.40: chữ thân bài là đen/xám đậm (≈ RGB 32,24,32), không phải xanh navy. Bản dịch giữ đúng màu đo được từ PDF.

**Google Drive.**
- Mở tài liệu Drive khi chưa cấp quyền thì web tự mở cửa sổ cấp quyền Google ngay. Cấp xong tự tải lại đúng tài liệu đó.
- Nếu trình duyệt chặn cửa sổ bật lên, hộp lỗi có nút "Cấp quyền Google Drive" (bấm là mở cửa sổ, cấp xong tự tải lại).
- Khi tự mở lại tài liệu phiên trước mà chưa có quyền: hiện hộp lỗi có nút, không tự về trang chủ.

- ENGINE_VERSION = v28, nên các trang đã dịch tự vẽ lại theo cách mới mà không tốn token.

## v10.1 — In đậm đúng bản gốc, bảng viết tắt theo hàng, nhãn hình không gộp

- **Chữ đậm:** sách dùng bộ font nhiều độ đậm (Amirsys/Ubuntu Light – Regular – Medium – Bold). Bản Medium trước đây bị coi là chữ thường. Nay Medium được vẽ đậm khi trang có bản Light/Regular cùng họ font. Áp dụng cho tên bài mục lục, nhãn hình, viết tắt, tiêu đề thanh màu.
- **Bảng định nghĩa "viết tắt | nghĩa" (tr.25):**
  - Mỗi hàng là một cặp riêng, kể cả khi bộ dò cột đặt nhầm khe cột giữa hai ô. Trước đây cả cột nghĩa bên phải bị gộp thành một đoạn, bản dịch dồn liên tục và lệch hàng.
  - Ô viết tắt giữ nguyên chữ gốc và đi theo hàng của nó. Nghĩa dài xuống dòng trong ô, đẩy các hàng sau xuống, cột viết tắt dời theo.
  - Cả cột dùng chung một cỡ chữ.
- **Nhãn hình xếp chồng** ("Pectoralis major muscle" / "Pectoralis minor muscle") không còn bị gộp thành một đoạn. Nhãn 2 dòng căn phải ("Anterior suspensory ligaments (of" / "Cooper)") giữ là một nhãn. Nhãn căn phải cạnh ảnh không bị đẩy khỏi đường chỉ.
- **Mục lục:**
  - tên bài (đậm) và tác giả (nghiêng) tách đúng dòng;
  - cỡ chữ đều, không thu nhỏ từng dòng;
  - không mượn chỗ bên trái làm lệch so với số trang.
- **Câu lệnh dịch:** giữ nguyên tên tổ chức / khoa phòng / thử nghiệm / nhóm nghiên cứu.
- ENGINE_VERSION = v29.

## v10.2 — Sách "Kỹ thuật Chẩn đoán Hình ảnh Tuyến vú cho KTV X-quang": rà soát toàn bộ bộ dựng trang

Lỗi tìm thấy và sửa tận gốc:
- **Bìa dịch cả chữ ẩn** ("Covertemplate", "Michael R.B. Evans / Editors", "Clinical Medicine Covers T3_HB", "Second Edition"
  của mẫu bìa cũ — có trong file nhưng bị ảnh đè lên). Mới: `hiddenText.ts` ghi lại từng lệnh vẽ ký tự khi pdf.js vẽ trang,
  vẽ thêm một lượt "màu mã" cho từng dòng chữ → dòng nào bị ảnh che, bị cắt, nằm ngoài khung trang hoặc cùng màu nền bị bỏ,
  chỉ dịch chữ nhìn thấy. Dòng không xác định được (font vẽ bằng nét, lớp OCR ẩn của bản scan) giữ như cũ.
- **Chữ trên nền ảnh/gradient xoá không sạch** (vệt dọc ở tên tác giả trên bìa): dùng bản nền không chữ khi chữ thật sự biến
  mất trong bản đó, không đòi tỉ lệ "mực" theo màu nền phổ biến.
- **Tên sách cỡ lớn tràn xuống ảnh**: chữ trưng bày (> 3% chiều cao trang) được thu nhỏ tới 45% thay vì 68%.
- **Đoạn văn vỡ vụn khi có cụm in đậm** ("descriptive epidemiology, …" / câu in đậm nghiêng giữa đoạn): trước đây đổi
  đậm/thường là ngắt khối → mỗi mẩu một cỡ chữ, hở khoảng lớn, cột trái tràn. Nay dòng có cụm đậm cùng cỡ, dòng trước chạy đủ
  khổ và câu chưa dứt → cùng đoạn (tr.42: 8 mẩu → 2 đoạn; tr.44: 7 mẩu → 3 đoạn).
- **Tiêu đề mục 3 dòng bị tách** ("Notes on Epidemiological" / "Data on BC in Europe…"): luật tách nhãn hình xếp chồng không áp
  cho tiêu đề (cỡ lớn hơn thân bài hoặc có số mục bên trái).
- **Dòng [21] đè chữ**: dòng thân bài cột trái bị nối với số mục "10." của cột tài liệu tham khảo bên phải (khác cỡ chữ, khe cột
  không dò ra). Tách theo cỡ chữ chính của phần đã gom.
- **Tài liệu tham khảo nửa dịch nửa không**: thêm "vùng tham khảo" — trang có ≥ 3 mục trích dẫn chắc chắn thì mọi khối cùng cỡ,
  thẳng mép với chúng và có dấu hiệu trích dẫn (năm, DOI, link, et al, ed.) đều giữ nguyên bản gốc, không phụ thuộc thứ tự đọc.
- **Chú thích Fig. 1.1 bị cắt 3 khối**: (1) dòng chú thích cùng hàng với nhãn biểu đồ ("EU 27") bị coi là ô bảng — nay ô bảng
  phải cùng họ font; (2) chú thích căn trái không đều mép phải bị coi là ngắt đoạn — nay chỉ ngắt khi từ đầu dòng sau vừa chỗ
  trống cuối dòng trước. Cũng sửa chú thích dài ở Atlas (tr.150, 200) từng bị hở giữa chừng.
- ENGINE_VERSION v30 → các trang đã dịch được dựng lại theo bản mới, không tốn token.

Kiểm thử: `tests/layout-regression/` — bộ hồi quy so ảnh + so cấu trúc khối 21 trang của 4 sách (có lớp chữ và scan).
So với v10.1: 9 trang thay đổi, đều là cải thiện ở trên; 12 trang còn lại giống hệt từng điểm ảnh.

Hạn chế còn lại: đoạn văn vắt qua cột/trang vẫn dịch thành 2 khối (mỗi cột một khối, câu bị cắt giữa chừng được AI nối nghĩa
nhưng không chuyển chữ thừa từ cột này sang cột kia); chữ ẩn bằng chế độ "invisible" (render mode 3) chưa lọc để không bỏ nhầm
lớp OCR của sách scan.

### v10.2.1 — Xuất PDF / mở lại trang không gọi AI khi bộ máy đổi cách tách khối
Nguyên nhân tốn token khi xuất PDF: trang chưa có ảnh trên máy (hoặc ảnh cũ của phiên bản bộ máy trước) được dựng lại từ bản
dịch đã lưu; khối nào không khớp nguyên văn câu gốc đã lưu (do bản mới gộp các mẩu đoạn cũ thành một đoạn) bị gửi AI "dịch bù".
Nay ghép lại bản dịch của khối mới từ bản dịch đã lưu của các mẩu cũ (đúng thứ tự, phủ ≥ 90% câu gốc) → không gọi AI; bản lưu
trên đám mây được cập nhật theo cách tách khối mới để lần sau khớp thẳng. Chỉ khối thật sự chưa từng được dịch mới gọi AI.
- **Xuất PDF không bao giờ gọi AI**: trang chưa có ảnh được dựng lại chỉ từ bản dịch đã lưu; khối nào không có bản dịch lưu sẵn
  được báo số lượng trong thông báo (mở trang đó để dịch bù).
- **Bớt log thừa**: đồng bộ key (in cả danh sách 21 key mỗi lần thay đổi), "Using key", "Calling Non-Stream", "Cache Hit",
  "Prefetched" chỉ in khi bật gỡ lỗi (`localStorage.setItem('meditrans_debug','1')`). Vẫn giữ dòng "Token: vào…, ra…" để theo dõi chi phí.
- **Lỗi "Cannot use the same canvas during multiple render()"** khi lật trang nhanh: huỷ lần vẽ cũ ngay trước khi vẽ (sau bước tải trang).

### v10.3 — Kiểm thử 16 cuốn sách (368 trang), sửa lỗi dàn trang tận gốc, bảo mật, lỗi nhỏ của web
Bộ dò tự động chấm từng trang dịch (khối vụn, chữ đè, co chữ quá mức, khoảng dòng lệch, tràn khung), chạy 3 lượt trên 16 cuốn.
Kết quả lượt đầu → lượt cuối: khối vụn 172 → 46, chữ đè 50 → 30 (đa số là báo nhầm của bộ dò), co chữ < 80% 36 → 28,
giãn dòng lệch 33 → 29, tràn khung 5 → 3. Sau lượt cuối sửa thêm 3 lỗi (khe cột bị che, chỉ mục, chú thích 2 nửa lệch cỡ).

**Dàn trang (theo loại lỗi)**
- *Đoạn vắt cột bị cắt câu*: đoạn chạy từ cuối cột trái sang đầu cột phải (cả chú thích hình 2 cột) nay được nối thành một
  đoạn để dịch liền mạch, rồi chia bản dịch lại cho hai khung theo tỉ lệ (Thyroid Ablation tr.17).
- *Hai cột bị dính thành một dòng*: khe cột hẹp hoặc bị khung chữ ngang trang che giờ vẫn dò được; dòng chạy ngang qua khe
  (bảng, tiêu đề) không bị cắt nhầm (Parathyroid tr.137, Pitfalls tr.12, Ablation tr.92).
- *Ô bảng có đường kẻ bị gộp*: nhận đường kẻ ngang của bảng, không gộp dòng vượt qua đường kẻ (CT tr.220).
- *Chữ đè lên khối khác*: bước kiểm tra cuối trước khi vẽ, khối nào lấn sang khối khác thì co lại đúng khung gốc.
- *Đoạn bị gộp nhầm / tách nhầm*: sửa luật dòng ngắn, dòng căn giữa, đổi kiểu chữ đậm-thường (Thyroid tr.27, Abdominal tr.73).
- *Cỡ chữ không đều*: nhãn, chú thích một dòng cùng loại trên trang dùng chung một cỡ; 2 nửa chú thích hình cùng cỡ.
- *Trang chỉ mục (Index)*: giữ nguyên bản gốc để số trang tra cứu còn đúng, không tốn token.
- ENGINE_VERSION v31: trang đã dịch được dựng lại theo bản mới từ bản dịch đã lưu, không gọi AI.

**Bảo mật**
- Firestore rules: bắt buộc email đã xác minh; người bị khoá không đọc/ghi được; siết quyền sửa trường nhạy cảm; link tải
  chỉ cho phép tên miền tin cậy.
- `api/drive/download`: bắt buộc đăng nhập Firebase, token Google gửi qua header (không lộ trên URL), kiểm tra fileId,
  tắt CORS, chống đoán kiểu nội dung.
- `api/ai/chat`: bắt buộc đăng nhập, danh sách model cho phép, giới hạn max_tokens, giới hạn 120 lượt/phút mỗi người.
- Lọc HTML trong phần hiển thị Markdown; thêm header bảo mật (vercel.json); pdf.js tắt eval.

**Lỗi nhỏ của web (26 lỗi)**: đổi file khi đang dịch không còn lẫn bản dịch; tải bản dịch đã lưu đúng file; nút "Dịch bù" cho
khối chưa dịch; đồng bộ đám mây báo đúng thành công/thất bại; log gỡ lỗi chỉ in khi bật; và các lỗi giao diện khác.

**Việc chủ web cần làm khi triển khai**
1. Deploy `firestore.rules` mới (`firebase deploy --only firestore:rules`).
2. Báo người dùng xác minh email (rules mới chặn tài khoản chưa xác minh); kiểm tra mẫu email xác minh và Authorized domains.
3. Đặt biến môi trường Vercel `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (tuỳ chọn `SYSTEM_AI_ALLOWED_MODELS`,
   `SYSTEM_AI_RATE_PER_MIN`), rồi deploy API và giao diện cùng lúc.
4. Còn mở: key dùng chung vẫn đọc được bởi người được chia sẻ (cần proxy phía server). Nên nâng pdfjs ≥ 4.2.67.

Hạn chế còn lại: đoạn vắt qua trang vẫn dịch thành 2 phần; đoạn mỗi câu một dòng chạy kín cột có thể bị gộp; ô bảng quá chật
phải co chữ riêng; bản dịch đã lưu của các mẩu cũ được dùng lại nguyên trạng (không dịch lại).

## v10.4 — Bảng, công thức, kiểm tra số liệu y khoa, giới hạn AI theo Firestore

### A. Bảng trong sách CT tim (các bảng 4.1–4.3, 5.7, 5.8, 6.1, 9.1, bảng 18 đoạn SCCT) và bảng viết tắt
Bộ nhận diện bảng được làm lại theo **khung đường kẻ**:
- **Nhận bảng có đường kẻ:** dòng nằm giữa đường kẻ trên và dưới, đi ngược lên gặp cặp "đường kẻ trên + đường kẻ dưới hàng tiêu đề", giữa khung có hàng nhiều ô. Đường kẻ dưới tiêu đề trang hoặc ngăn chú thích chân trang không bị nhận nhầm.
- **Gộp đúng ô nhiều dòng:** trong ô, hai dòng chỉ nối khi có dấu hiệu câu chạy tiếp (dòng sau viết thường, dòng trước kết thúc bằng dấu phẩy/giới từ) **hoặc dòng trước đã chạy kín ô** (chữ đầu dòng sau không đủ chỗ ở cuối dòng trước): "Proximal Right / Coronary Artery (pRCA)", "Borderline-intermediate / 10-year ASCVD risk (5–20%)".
- **Mỗi mục một dòng:** cột dạng danh sách (dòng trên còn thừa chỗ vẫn xuống dòng, dòng dưới viết hoa đầu) thì mỗi dòng viết hoa là một mục riêng ("Diabetes / Proteinuria / Hypertension", "Limited urticaria / Cutaneous edema…").
- **Không gộp ngang qua cột:** khe trống ≥ 3,5 cỡ chữ thẳng mép với ô ở dòng kề là sang cột khác, kể cả khi ô sau viết thường ("descending artery" | "artery (LCx)" bảng 18 đoạn SCCT). Tiêu đề cột gộp nhầm ("Atypical Nonanginal", "Sex Chest pain", 10 cột Bảng 6.1) được tách theo mép trái trùng khít với ô bên dưới.
- **Cả bảng một cỡ chữ:** mọi ô của một bảng dùng chung cỡ (một ô quá dài không kéo cả bảng xuống quá 20% so với đa số ô). Ô bảng **được dùng hết bề ngang trống của ô** (tới cột bên phải / mép bảng) thay vì chỉ bề ngang dòng gốc, nên chữ to hơn.
- **Ô giữ đúng hàng:** ô không chảy dồn lên khi thu nhỏ; nếu bản dịch thêm dòng và sát đường kẻ hàng thì dồn lên chỗ trống trong cùng ô, không tràn qua đường kẻ.
- **Ô chữ ngắn được dịch:** Age/Sex/Women/Men/Mild/Moderate/Severe/Grade/Condition… có từ điển ô cố định (Tuổi, Giới, Nữ, Nam, Nhẹ…). "Mild" trước đây bị nhận nhầm là số La Mã nên không dịch (đã sửa: chỉ nhận số La Mã đúng cú pháp). Ô "Age/Sex" cạnh ô khác không còn bị coi là "ô viết tắt" giữ nguyên.
- Chỉ số trên (ª, ᵇ) và chú thích chân bảng tách riêng từng dòng.
- Bảng viết tắt không đường kẻ (≥ 5 ô cùng cột): các ô cùng cột dùng chung cỡ chữ.

### B. Công thức giữ nguyên bản gốc (tr.12)
Khối là công thức (ký hiệu toán, dấu =, chữ Hy Lạp, phân số dựng bằng ký tự điều khiển…) và các mẩu chữ thuộc công thức (chỉ số dưới, mẫu số) **không dịch, không vẽ lại** → giữ nguyên từng điểm ảnh. Đã quét 16 cuốn sách: chỉ công thức thật bị nhận.

### C. Đoạn dàn đều có khoảng trắng rộng / dãy số (tr.35, 68)
Dòng căn đều có dãy số ("25–49%, 50–69%, 70–99%") hoặc khoảng trắng giãn rộng không còn bị cắt thành nhiều khối.

### D. Kiểm tra số liệu y khoa (theo góp ý ChatGPT, đã điều chỉnh)
- Mỗi khối dịch xong được so số / đơn vị / dấu so sánh với bản gốc **theo cụm đại lượng** (dấu + số + đơn vị, ví dụ `≤|0.05|` hay `|5|mg`), không chỉ so tập hợp số.
- Không báo lỗi giả với cách viết hợp lệ: 0.05 ↔ 0,05; 1,000 ↔ 1.000 ↔ 1 000; ≤ ↔ "nhỏ hơn hoặc bằng", "không quá"; ≥ ↔ "ít nhất", "từ X trở lên"; % ↔ "phần trăm"; mL ↔ ml; "first" ↔ "thứ nhất"…
- Lệch → **dịch lại đúng 1 lần**. Bản mới chỉ được nhận nếu khớp số liệu; nếu vẫn lệch thì **giữ bản dịch đầu**, ghi lý do ("thiếu 0.05", "đổi ≤ thành <"…) và đưa vào danh sách cần duyệt.
- Giao diện: dải đỏ "N khối có số liệu / đơn vị / dấu khác bản gốc, cần duyệt" + nút "Xem & sửa" (lọc riêng khối lệch, trạng thái cập nhật khi sửa).
- Xuất PDF: hỏi xác nhận nếu còn trang chưa dịch, trang còn khối chưa dịch hoặc khối lệch số liệu.

### E. Câu gốc trùng nhau ở nhiều vị trí
Khi dựng lại trang từ dữ liệu đã lưu, cùng một câu gốc xuất hiện nhiều lần ("No significant abnormality was detected") được ghép **theo thứ tự xuất hiện** (lần 1 ↔ bản dịch 1, lần 2 ↔ bản dịch 2), không dùng chung một bản dịch. Trong một trang, các ô ngắn giống hệt nhau dùng cùng bản dịch (nhất quán). Bộ nhớ dịch (TM) bỏ các bản "dịch" giống hệt gốc và **tự xoá khi bảng thuật ngữ thay đổi**.

### F. Bảo mật và giới hạn
- **Giới hạn AI bằng Firestore** (`aiUsage/{uid}`): dùng **transaction**, không đọc–cộng–ghi rời rạc. Giới hạn: số lượt/phút, **số yêu cầu đồng thời** (mặc định 6), **token/ngày** (mặc định 5 triệu, có đặt trước theo ước tính rồi trừ lại theo số token thật sau khi gọi). Tranh chấp transaction → thử lại 4 lần rồi từ chối 429. Firestore lỗi/hết hạn mức → chuyển sang bộ đếm trong bộ nhớ, không chặn người dùng. Admin chính không bị giới hạn ngày. Test trên Firestore emulator: 30 yêu cầu đồng thời → đúng 6 qua.
- HTML từ Markdown: bộ lọc theo **danh sách cho phép** (thẻ, thuộc tính, style an toàn, URL http/https/mailto/tel/ảnh raster) — 24 mẫu XSS bị chặn.
- Lưu bản dịch giữ định dạng lên cloud: chia thành nhiều phần ≤ 900 KB, **không cắt bỏ cặp câu nào**.
- Đệm ảnh trong RAM giới hạn 300 MB / 6 file; IndexedDB đầy thì dọn đệm cũ rồi ghi lại.
- Ngày hết hạn cấp độ không hợp lệ → coi như hết hạn, hiển thị "Ngày hết hạn không hợp lệ".

### G. Việc chủ web cần làm
1. Deploy `firestore.rules` (thêm `aiUsage`).
2. (Tuỳ chọn) biến môi trường Vercel: `SYSTEM_AI_RATE_PER_MIN` (120), `SYSTEM_AI_MAX_CONCURRENT` (6), `SYSTEM_AI_DAILY_TOKENS` (5000000).
3. Redeploy. Trang đã dịch bằng bản cũ: bấm "Dịch lại" để áp dụng cách dựng bảng mới (ENGINE v32).

### H. Góp ý ChatGPT: đã làm / chưa làm
- **Đã làm:** #16 kiểm tra số liệu (theo 3 điều chỉnh của chị), #5 ngày hết hạn không hợp lệ, #12 giới hạn đệm RAM, #4 lọc HTML, #7 lưu cloud không cắt, #10 xác nhận trước khi xuất, #11 (xuất theo khoảng trang đã có sẵn), #8 xoá TM khi đổi thuật ngữ, #2/#14 giới hạn AI theo Firestore + token.
- **#9 ghép theo câu gốc:** giữ cách ghép theo nguyên văn câu + ENGINE_VERSION, bổ sung ghép theo thứ tự cho câu trùng (mục E). Đây là trường hợp kiểm thử, không phải lỗi đã xác nhận.
- **Chưa làm:** #6, #15, #19, #20, #21 — cần thay đổi kiến trúc lớn hoặc ảnh hưởng dữ liệu người dùng hiện có, nên để đợt sau.
- **Giới hạn của kiểm tra số liệu:** phát hiện được số/đơn vị/dấu bị mất hoặc đổi, nhưng **không** phát hiện được số đúng mà gắn nhầm ngữ cảnh khác (ví dụ đảo độ nhạy ↔ độ đặc hiệu) vì cần hiểu ngữ nghĩa câu.

### I. Bộ hồi quy
Thêm vào bộ hồi quy: CT tim tr.12, 35, 44, 48, 56, 57, 68, 73, 103, 108 (số trang theo file PDF) và "Chẩn đoán HA vú" tr.25 (bảng viết tắt).

## v10.5 — Danh sách lồng nhiều cấp, ngắt dòng cân bằng, chọn model riêng (gpt-6-luna tuỳ chọn)

### 1. Model dịch: gpt-6-luna là lựa chọn (mặc định giữ gpt-4.1-mini)
- Thử thật: gpt-6-luna chậm hơn gpt-4.1-mini 2–3 lần cho cùng độ dài bản dịch (8–16 s so với 4–7 s), dù phần lớn lượt gọi đã có 0 token suy nghĩ → **mặc định dịch thường / giữ định dạng giữ gpt-4.1-mini, chuyên sâu giữ gemini-3.1-flash-lite**; gpt-6-luna chọn được trong Cài đặt (ô Model Proxy).
- Khi chọn gpt-6-luna (hoặc gpt-5.x): gửi `reasoning_effort: "none"` (tắt suy nghĩ; proxy không nhận thì tự lùi "minimal" → "low"), bỏ `temperature`, dùng `max_completion_tokens` — cả ở trình duyệt và `api/ai/chat.ts`. Model tắt suy nghĩ vẫn được chia nhiều phần song song.
- OCR giữ gemini-3.1-flash-lite.

### 2. Danh sách lồng nhiều cấp (CT tim tr.133)
- Chỉ số trên ("mm²") không còn làm cắt đôi dòng ("<6 mm²" | "for the left main coronary").
- Khối đã có ≥ 2 dòng thẳng mép mà dòng sau lùi ra trái = mục cấp trên mới ("…PCI may be deferred." | "<4 mm² for proximal…") → mỗi mục giữ đúng cấp thụt lề, cỡ chữ bình thường. Đã thêm trang này vào bộ hồi quy.

### 3. Trình bày như sách in + chọn model riêng
- **Ngắt dòng cân bằng cả đoạn** (kiểu Knuth–Plass rút gọn) cho đoạn căn đều: giữ nguyên số dòng nhưng chia đều khoảng trống, hết dòng giãn rộng. Dòng nào vẫn phải giãn quá 4 lần khoảng trắng thường thì để căn trái.
- Thân bài 2 cột không còn bị giãn sang khe cột (chỉ ô bảng / mục cùng cột mới được dùng chỗ trống bên phải).
- Nhãn hình căn phải ngắn ("lumen" → "lòng mạch") mà bên trái là nét hình → tràn sang vùng trắng bên phải, giữ cỡ chữ như các nhãn khác.
- Cài đặt → Cấu hình Proxy Engine: thêm 2 ô chọn model riêng cho **Dịch giữ định dạng** (mặc định gpt-4.1-mini) và **OCR giữ định dạng** (mặc định gemini-3.1-flash-lite). Model có suy nghĩ tự được tắt suy nghĩ; chọn model GPT cho OCR thì có thêm hướng dẫn toạ độ khung chữ.

## v10.6 — Tốc độ proxy (AIMD), bộ đếm token, bảng CT tim tr.237/238/242/245, AUTO giữ định dạng, giao diện điện thoại

### 1. Bộ điều tiết proxy (hết cảnh tụt 5 → 4 → 3 → 2 yêu cầu rồi kẹt 10 phút)
- Mức tối đa = giới hạn server báo qua header `X-AI-Concurrency-Limit` (key hệ thống, mặc định 6). Key ShopAIKey riêng: theo Cài đặt, mặc định 6 (trước 8, lệch với server 6 → 429 thừa).
- Một đợt 429 chỉ hạ MỘT lần, còn ~70% (6 → 4). Yêu cầu gửi trước lúc hạ mà nhận 429 không bị phạt thêm.
- Mức đã hạ giữ 2,5 phút (trước 10 phút), sau đó tăng 1 nấc mỗi ≥ 20 giây trả lời tốt; độ trễ/token tăng > 1,8 lần thì đứng yên.
- Lỗi 5xx / rớt mạng / server bận ghi sổ chỉ tạm dừng ngắn, không hạ mức.
- Server (api/ai/chat.ts): trả slot "đang chạy" TRƯỚC khi gửi kết quả (trước đây trả sau → yêu cầu kế tiếp bị 429 "quá nhiều yêu cầu" dù chưa tới 6); tranh chấp Firestore thử lại nhiều hơn, còn tranh chấp thì trả `reason: "busy"` (trình duyệt chỉ chờ 1 giây); 429 do ShopAIKey ghi `reason: "upstream"`.

### 2. Token / tốc độ
- Dịch bù khối sót và dịch lại khối lệch số liệu chạy tối đa `plan.parallel` phần cùng lúc (trước gửi hết một lượt).
- Model "nhanh" xếp theo TÊN: gpt-5.x / gpt-6 / o-series dù tắt suy nghĩ vẫn chia phần to, ít luồng (gpt-6-luna chậm hơn gpt-4.1-mini 2–3 lần).
- Bản dịch bị cắt cụt (`finish_reason = length` / Gemini `MAX_TOKENS`): giữ các khối đã đủ, bỏ khối cuối dở dang, phần còn lại chia đôi dịch tiếp ngay.
- **Bộ đếm lượt gọi AI** (nút "Thống kê" trên thanh Giữ định dạng): theo trang — số lượt, lỗi/thử lại, token vào/ra/suy nghĩ, thời gian, số lần bị cắt cụt; **Xuất CSV** (phần tổng theo trang + từng lượt gọi). Chỉ lưu trong trình duyệt.

### 3. Dàn trang (ENGINE v34)
- **CT tim tr.242**: gạch chân mục "Selection of the best cardiac phase:" bị coi là đường kẻ bảng → cả cột thành "bảng" (đoạn đầu cột bị tách, lặp chữ). Nay gạch chân (sát dưới chân chữ, chữ phủ kín) bị loại khỏi danh sách đường kẻ, và nét gạch chân gốc còn trong nền được xoá (không còn thành gạch ngang giữa chữ dịch / đường kẻ thừa). Chữ dịch không còn gạch chân.
- **Tr.245 Bảng 19.7**: cột khít (khe ≈ 1 cỡ chữ) — dòng "…mass on valve or" + "lesion that is attached…" bị nối thành một → ô đè ô. Nay ≥ 2 dòng lân cận có ô bắt đầu đúng mép đó là tách ô.
- **Tr.237 Bảng 19.2 / tr.245**: cỡ chữ bảng đồng bộ theo từng cột (các cột chênh nhau ≤ 0,06), tính cả dòng số liệu không có ô cùng hàng và cỡ thật đã thu nhỏ — hết cảnh dòng chữ to cạnh dòng chữ tí hon. Ô 1 dòng (hàng C, D) thu nhỏ để giữ 1 dòng thay vì tràn qua đường kẻ.
- **Tr.238**: dòng đầu chú thích căn đều "Fig. 19.11 Aortic   Dissection   Related   Aortic" không còn bị cắt thành mẩu chồng lên chú thích.
- Lưu ý: ảnh tr.237 chị gửi có dòng "Vận tốc ĐM chủ" tách khỏi số liệu — bản hiện tại không còn tách ở đây (do lỗi chỉ số dưới "max" đã sửa ở v10.5); trang đã lưu từ bản cũ cần bấm Dịch lại.

### 4. Giữ định dạng: AUTO + dịch trước
- Nút **AUTO** (luôn hiện chữ, cả máy tính bảng/điện thoại) + ô chọn **số trang dịch trước** (+0…+10, mặc định +2): bật thì tự dịch trang đang xem và N trang tiếp theo (bỏ trang đã có bản dịch / bản lưu). Nhớ lựa chọn trên máy.
- Thanh công cụ Giữ định dạng cuộn ngang được trên màn hình hẹp (không bị cắt nút).

### 5. Giao diện điện thoại / máy tính bảng
- Logo "MediTrans AI" không còn bị cắt đầu chữ / xuống dòng; dòng "Medical Translation" ẩn trên điện thoại.
- Thanh đầu trang: nút Đóng file / Quản trị / Google Drive chỉ hiện chữ trên màn hình rộng (≥ 1280px), tên người dùng cắt gọn; tên file ẩn dưới 1024px.
- Trang chủ "Quản lý tài liệu": tiêu đề + tab "Của tôi / Được chia sẻ" không bị bóp; thanh tìm kiếm/sắp xếp/nút xuống hàng dưới trên điện thoại.
- **Tràn viền ở Dịch thường** (khung bản gốc bị bóp còn một dải): chế độ xem điện thoại ("Bản dịch"/"Chia đôi") còn lưu khi mở trên máy tính → khung dịch không có bề rộng cố định, thanh công cụ đẩy khung trái. Nay màn hình ≥ 768px luôn chia đôi 50/50.

## v10.7 — Xuất PDF, viết tắt, tác giả/ORCID, dòng số liệu/%, bảng (engine v35)
- Xuất PDF: bỏ hộp xác nhận của trình duyệt (bị chặn trong khung nhúng nên báo "đã huỷ"), thay bằng hộp hỏi trong app; nút hiện "Đang xuất x/y"; xuất được khi đang dịch; bấm lặp khi đang xuất không làm gì (gộp bản v10.6.1).
- Thanh công cụ khung phải: gom nút phụ vào menu "⋯", có thanh cuộn ngang mảnh.
- Danh sách viết tắt: cột viết tắt luôn giữ nguyên, không gửi đi dịch (kể cả "Ao", "aAo", "AV canal"…); hai dòng định nghĩa liền nhau không còn bị gộp; "Computed     tomography" căn đều không còn bị tách.
- Dòng tên tác giả giữ nguyên (không dịch "and" thành "và" chen vào biểu tượng ORCID).
- Dòng căn đều có số, m², %, ≥/≤ không còn bị cắt vụn hay dính đề mục ("8%17.8.3.1").
- Bảng: tách đúng ô ở bảng có kẻ ngang (Stage | Definition, I | Normal, 12 | 1592…); cỡ chữ trong bảng gần bản gốc hơn; nội dung ô không bị dời lên hàng trên (Bảng 22.3).
- Thân bài nằm ngay dưới bảng không còn bị coi là ô bảng rồi co nhỏ (tr.135, 221, 323, 332); chú thích hình cạnh bảng không bị co.
- Dòng "e-mail:" ở chân trang đi liền với khối địa chỉ tác giả.
- Trang đã dịch bằng bản cũ cần bấm Dịch lại để áp dụng.

## v10.8 — Rà lại toàn bộ bản xuất v10.7 (engine v36) + nút "Sửa lỗi" khi xuất PDF
- Xuất PDF: hộp hỏi khi bản dịch chưa hoàn chỉnh có thêm nút **Sửa lỗi N trang**. Trang thiếu bản dịch được dịch bù phần thiếu, trang lệch số liệu được dịch lại cả trang. Chạy song song chung cơ chế dịch đồng loạt (cùng số luồng, thanh tiến độ, nút "Dừng dịch"). Xong thì bấm Xuất PDF lại.
- Engine lên v36: mọi trang đã lưu tự dựng lại theo cách dàn trang mới khi mở / xuất, dùng lại bản dịch đã lưu (không tốn token).
- Sơ đồ / lưu đồ: nhận ra ô có viền; chữ trong ô dịch chung một cụm, dùng hết lòng ô, căn giữa; gạch đầu dòng vẽ trong ô tách đúng mục (CT tim tr.62, 66, 139, 171).
- Bìa và trang tên sách: tên sách không còn giãn hở "Hướng   Dẫn"; dòng "Editors" tách khỏi dòng tên.
- Chân trang đầu chương: tên tác giả đứng riêng một dòng, không dồn vào địa chỉ.
- Danh mục viết tắt: định nghĩa AI để nguyên tiếng Anh ("Coronary artery disease") được dịch bù; định nghĩa dài không còn bị co nhỏ hơn các dòng khác (tr.31, 42).
- Ô bảng chỉ có từ viết tắt ("CXR", "CACS", "PCI") giữ nguyên, không bị dịch bung rồi tràn (tr.73).
- Bảng: ô tiêu đề dịch dài không còn kéo cả cột chữ nhỏ (tr.44); bảng viết tắt không bị nhận nhầm là bảng có kẻ.
- Dòng căn đều trong cột cạnh bảng không còn bị cắt thành 2 mẩu đè chữ (tr.81).
- Bản dịch: bỏ cụm từ bị AI lặp liền nhau (tr.52), tiêu đề bị VIẾT HOA toàn bộ hoặc một phần được viết thường lại (tr.68, 93, 155), bỏ dấu chấm thừa cuối tiêu đề (tr.88).
- Tài liệu tham khảo cuối cột (vắt sang trang sau) giữ nguyên, không bị dịch (tr.145).
- Dịch giữ định dạng: model mặc định đổi sang **gpt-4.1-nano**. Ô model trong Cài đặt giờ là ô tự nhập (có gợi ý sẵn), gõ tên model bất kỳ proxy hỗ trợ; để trống = gpt-4.1-nano. Máy chủ (key hệ thống) đã cho phép gpt-4.1-nano.

## v10.9 — Rà bản xuất v10.8 của 2 sách (engine v37)

**Lỗi thật đã sửa**
- Chú thích hình chạy 2 cột (Atlas tr.59, 117, 123, 284…): dòng đầu cột trái bị nối với dòng đầu cột phải thành một dòng dài, bản dịch vẽ thành dòng chữ tí hon hoặc giữ nguyên tiếng Anh. Nay nhận ra khe cột (mảnh sau thẳng mép với dòng dưới của cột phải, không dòng nào chạy qua khe) và tách đúng 2 cột. Chú thích căn đều kiểu "Fig. 19.11 Aortic   Dissection" (CT tim tr.238) vẫn giữ nguyên.
- Nhãn "Hình 4.12", "Bảng 3.1" mất chữ đậm khi AI bỏ thẻ quanh nhãn (Atlas tr.91, 225…): nay tự bọc lại thẻ theo số hình.

**Không phải lỗi phần mềm: trang chưa dịch bù**
- Atlas còn nhiều đoạn/chú thích giữ tiếng Anh (khoảng tr.159, 177, 187–217, 238, 249, 265–286, 306–330, 355–386). Đây là các khối AI chưa trả bản dịch. Khi bấm Xuất PDF, chọn **"Sửa lỗi N trang"** để dịch bù các trang này.

**Lưu ý khi cập nhật**: engine đổi sang v37 nên các trang đã dịch sẽ tự dàn lại từ bản dịch đã lưu (không tốn token). Riêng chú thích 2 cột được tách lại thành 2 khối mới → trang đó sẽ hiện trong danh sách "Sửa lỗi" để dịch bù phần chú thích.

## v10.10 — Rà bản dịch v10.9 của 5 cuốn (engine v38)

**Viết hoa / viết thường (BI-RADS, Clark's)**
- Dòng gốc VIẾT HOA toàn bộ ("PREFACE", "1. SHAPE", "ANATOMY", "SECTION 2: IMAGING", "NORMAL VARIANTS", tab dọc "MAMMOGRAPHY", bìa sách) → bản dịch được **ép viết hoa cả dòng bằng code** sau khi dịch, không chỉ dựa vào prompt. Hết "PHẦN 2: hình ảnh", "Biến thể BÌNH THƯỜNG", "1. hình dáng".
- Nhãn mục vẽ riêng ("I.") mà AI lặp lại trong bản dịch → bỏ ("I. I. CÁC LOẠI…").
- Prompt (dịch thường + OCR trang scan) thêm luật rõ: giữ hoa/thường như gốc, không trộn hoa/thường trong một tiêu đề; giữ nguyên tên người, học vị, từ viết tắt; mỗi khối giữ đúng phần chữ và thứ tự của nó.

**Tên tác giả, học vị**
- Dòng "Tên, MD, PhD and Tên, MBBS" được giữ nguyên, không gửi AI (trước đây thành "Bác sĩ đa khoa, Tiến sĩ").

**Bản dịch lệch khối (bìa Clark's)**
- Bản dịch trùng nguyên văn chữ gốc của khối khác (tên tác giả nhảy lên chỗ tiêu đề) hoặc bản dịch dài gấp nhiều lần tiêu đề ngắn (Interventional tr.94) → bị loại và dịch bù.
- Chữ rác của lớp chữ OCR ("@SElr.fcSip") giữ nguyên, không dịch.

**Mục lục (Clark's)**
- Dòng mục lục có số trang in thành cột riêng bên phải: mỗi dòng là một mục riêng, chữ được dùng chỗ trống tới số trang → hết gộp mục, hết "Tài liệu tham / khảo" lệch số trang.

**Dàn trang**
- Dòng căn đều cột trái không còn bị nối sang dòng đầu cột phải (Interventional tr.51).
- Ghi chú dưới bảng "Data from Ref. [2]" tách khỏi câu sau (Interventional tr.181).
- Nhãn "Hình 2.20" giữ màu/đậm cả chữ "Hình" khi AI chỉ bọc thẻ quanh số.
- Bảng có kẻ (Bảng 19.2 CT tim tr.237): ô không còn bị nhận nhầm là khung lưu đồ → không căn giữa, cùng cỡ chữ với bảng.
- Các cột của cùng một bảng chênh cỡ chữ tối đa 0,06 (Bảng 5.8 CT tim tr.57).

**Về model gpt-4.1-nano**: phần lớn lỗi hoa/thường, dịch học vị, lệch khối là do model nano làm ẩu; nay đã có code kiểm tra và sửa sau khi dịch nên kết quả ổn định dù dùng nano. Nếu muốn chất lượng câu chữ tốt hơn, có thể nhập model mạnh hơn (vd. gpt-4.1-mini) ở ô model dịch giữ định dạng.

**Không phải lỗi phần mềm**: Atlas, Interventional, CT tim không còn khối tiếng Anh chưa dịch.

## v11 — Chạy dịch thật v10.10 (gpt-4.1-nano) trên 16 cuốn sách, sửa lỗi tận gốc (engine v39)

Đã dịch giữ định dạng bằng chính bộ máy của web (pdf.js + layoutEngine + GeminiService qua ShopAIKey, model gpt-4.1-nano;
OCR giữ mặc định gemini-3.1-flash-lite) rồi rà từng trang bản xuất PDF. Lỗi tìm thấy và cách sửa:

**Bản dịch (model nano)**
- **Thẻ lạ + sót tiếng Anh hàng loạt** (Fornage: 380 khối / 126 trang; Atlas, CT tim, mọi sách): nano bắt chước ví dụ thẻ `<1>…</1>`
  trong prompt, tự bọc thẻ quanh từ tiếng Anh rồi để nguyên ("thủ thuật <1>US-guided</1>", "<2>core-needle biopsy</2>"), có khi
  đổi nghĩa ("breast biopsy" → "chọc hút kim nhỏ"). Nay phần hướng dẫn thẻ chỉ gửi khi trang có chữ màu/đậm; thẻ model tự thêm bị bỏ.
- **Dịch nửa vời** (giữ nguyên 2+ từ tiếng Anh thường của câu gốc) → tự dịch lại 1 lần, chỉ nhận bản tốt hơn.
- **Lệch mã khối**: bản dịch của khối này gắn vào khối bên cạnh (tiêu đề "Benign Solid Masses" nhận cả đoạn văn; chú thích Hình 2.16
  nhận "HISTOPATHOLOGY: U xơ tuyến"). Nay so "mốc" (số, từ viết tắt, nhãn (A)…) và độ dài → dịch lại riêng từng khối lệch.
- **Dịch tràn sang khối sau** (mục lục 2 dòng: dòng 1 dịch luôn dòng 2 → lặp "bị che khuất tại nhũ ảnh") → cắt phần lặp.
- **Thẻ màu đặt sai từ / lặp quá số lần** (CT tim tr.22: tô xanh "coronary" thay vì "calcium hydroxyapatite") → sửa lại thẻ.
- Ví dụ trong prompt bị nano chép nguyên vào tiêu đề chạy ("Atlas of Mammography" → "Hướng dẫn thiết yếu về…") → bỏ ví dụ tên sách.
- "CLARK’S" bị dịch mất "’S" → giữ nguyên tên riêng.
- Giới hạn token đầu ra theo độ dài đầu vào (trước đây nano đôi khi viết lặp tới 8192 token, ~40 giây/lượt).
- Thuật ngữ sai nghĩa: "M mode" → "chế độ Doppler" (!), "IM node" (hạch vú trong) → "hạch trung thất" (!), "The elbow" → "Cổ tay",
  "paediatric hip" → "Khớp h hip"… → thêm ~60 thuật ngữ bắt buộc (chế độ M/B, hạch vú trong, khuỷu tay, khớp háng, cơ ngực lớn,
  dưới đòn/trên đòn, cùng bên/đối bên, sinh thiết lõi kim, Hội Điện quang Hoa Kỳ, TIỀN SỬ…).
- Viết hoa: chữ đầu khối viết hoa như bản gốc ("ác tính" → "Ác tính"); nhãn VIẾT HOA "HISTORY:", "NOTE:", "HISTOPATHOLOGY:"
  → "TIỀN SỬ:", "GHI CHÚ:", "MÔ BỆNH HỌC:" (trước đây "lịch sử:", "ghi chú:"); "v2025 MANUAL" không còn thành "sổ tay v2025".

**Dàn trang**
- Khối **căn giữa** có mép trái so le (trang tên sách) bị coi là thụt treo → các dòng sau lệch phải (Clark’s tr.3).
- Khối **chữ ký căn phải** cuối bài bị căn trái, bản dịch xuống dòng dồn sang trái (Clark’s tr.9).
- **Danh mục viết tắt**: "cfNIPT | cell-free…" nối thành một dòng rồi nhập vào khối "CFA" → chữ đè lên nhau, cả bảng dồn lên (Clark’s tr.17–18).
- **Từ in đậm đầu đoạn** ("Doppler ultrasound…") bị tách thành khối riêng giữ chữ gốc, đè giữa 2 dòng dịch (Clark’s tr.8):
  cỡ chữ đo theo mực của từ đậm ngắn lệch 15% → nay so cỡ ghi trong PDF.
- **Dòng "nhãn: giá trị"** ("Form: … / Contour: … / Density: … / Size: …") bị chảy thành một đoạn → mỗi nhãn một dòng như bản gốc.
- **Font có chân** Thieme "Gulliver", "Berling"… bị vẽ bằng font không chân → nhận đúng.
- **Đoạn văn có trích dẫn tác giả–năm** ("The CAD marks… Freer and Ulissey (2001)…") bị coi là tài liệu tham khảo → giữ nguyên
  tiếng Anh CẢ CỘT mà không báo (Chẩn đoán HA tuyến vú – Kiến thức thiết yếu tr.27). Nay câu văn xuôi không bị nhận nhầm.

**OCR (BI-RADS — trang scan)**
- gemini-3.1-flash-lite hay trả `box_2d` là danh sách khung → khối bị bỏ → **trang có chữ bị coi là "không có chữ", giữ nguyên tiếng Anh
  và xuất PDF không báo** (BI-RADS tr.xvii), hoặc lỗi "JSON lỗi" (tr.v). Nay đọc được khung lồng, tách theo đoạn; không tách được thì đọc lại.
- Xuất PDF: thêm cảnh báo "N trang AI không đọc được chữ, đang giữ nguyên bản gốc" + đưa vào nút "Sửa lỗi".
- **Mục lục OCR**: khung AI chỉ bao phần chữ → chấm dẫn + số trang gốc không bị xoá, nằm cạnh chấm dẫn vẽ lại (".....107" hai lần) → nới khung theo mực.
- Cụm in đậm/nghiêng giữa đoạn bị AI trả thêm thành khối riêng → vẽ 2 lần, đoạn bị ép nhỏ (tr.8) → bỏ khối trùng.
- Chú thích hình lệch khung: bị "dời" lên tận góc trang (vùng tab dọc), chữ tí hon; dòng 2 của chú thích đè lên ảnh (tr.31, 37) → chỉ dời
  tới vùng chữ gần, cùng cột; gộp 2 khối của cùng chú thích.
- Tiêu đề cỡ lớn không còn bị tự nhận là chữ đậm theo mật độ mực.

**Lưu ý khi cập nhật**: engine lên v39 → trang đã dịch tự dàn lại từ bản dịch đã lưu (không tốn token). Các trang đã dịch bằng v10.10
có lỗi do model (thẻ lạ, sót tiếng Anh, lệch khối, thuật ngữ sai) vẫn giữ bản dịch cũ trong bản lưu → bấm **Dịch lại** cho các trang đó.

**Về model**: các lỗi nghĩa (thuật ngữ sai, lệch khối, sót tiếng Anh) chủ yếu do gpt-4.1-nano. v11 bắt và tự dịch lại được phần lớn,
nhưng không bắt được mọi câu dịch sai nghĩa. Với sách y khoa nên dùng gpt-4.1-mini cho "Dịch giữ định dạng" nếu ngân sách cho phép.
**Bổ sung trong lượt kiểm chứng cuối (v11)**
- Hai khối khác câu gốc nhận cùng một bản dịch (tên sách tách 2 khung ở bìa Clark's) → dịch lại từng khối.
- Đoạn dài nhận bản dịch cụt ("Một số nhà nghiên cứu đã" cho cả đoạn — Atlas tr.xix), khối ngắn nhận bản dịch dài gấp nhiều lần
  → dịch lại riêng. Một khối bị cắt cụt vì hết token → gửi lại với trần token đầy đủ, không nhận bản dở dang.
- Dòng toàn chữ đậm kết thúc bằng ":" ngay dưới đoạn văn ("Lung-/pleura window:") không còn bị nhập vào đoạn (CT Teaching Manual).
- OCR: dòng 1 khung hụt cuối ("…khoảng cách từ núm vú" còn sót "ple") → nới khung theo mực liền mạch, dừng ở đường kẻ bảng.
- OCR: kết quả đặt sai chỗ / đè nhau quá nhiều (trang biểu mẫu dày đặc) → đọc lại; vẫn kém thì giữ trang gốc và báo khi xuất PDF
  (trước đây có thể ra trang lẫn lộn chữ dịch đè chữ gốc).
- Thuật ngữ thêm: tâm thu/tâm trương, co/giãn đồng thể tích, van hai lá/ba lá/động mạch chủ, hẹp/hở van, diện tích van (AVA giữ nguyên),
  chênh áp cao/thấp, thể tích nhát bóp, thất/nhĩ trái–phải, "Exercise n" → "Bài tập n" (trước đây "Thể dục"), cửa sổ/thang xám…
- Đã thử bắt model chép lại 3 từ đầu câu gốc ("k") để kiểm chứng mã khối: gpt-4.1-nano khi đó chỉ dịch đúng 3 từ đó hoặc bỏ hẳn bản
  dịch → KHÔNG dùng; chỉ đọc "k" nếu model tự trả.

**Hạn chế còn lại (do model nano)**: trang dạng phiếu bài tập/biểu mẫu nhiều ô nhãn ngắn (CT Teaching Manual tr.45) vẫn có thể bị
gán lệch bản dịch giữa các nhãn ngắn; một số câu dịch sai nghĩa không có số liệu/từ viết tắt để đối chiếu. Nên dùng gpt-4.1-mini cho các
sách này, hoặc mở "Sửa" để chỉnh tay.
- OCR: AI gắn "dir" (chữ xoay) cho cả chữ ngang → cả trang vẽ xoay dọc, chữ khổng lồ (BI-RADS tr.xvi). Nay khung bẹt ngang hoặc quá nửa số khối có "dir" thì coi là chữ ngang.
- Nhãn hướng trong sơ đồ (Lateral/Medial/Head/Foot…) dịch trên máy: trước đây nano dịch "Lateral" thành "Chếch trong-ngoài".
