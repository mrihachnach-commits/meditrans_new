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
