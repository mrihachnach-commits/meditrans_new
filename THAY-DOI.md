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
