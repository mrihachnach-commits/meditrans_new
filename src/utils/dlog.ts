/**
 * v10.2.1: log chẩn đoán chi tiết (đồng bộ key, gọi API, đệm trang) chỉ in khi bật chế độ gỡ lỗi:
 *   localStorage.setItem('meditrans_debug', '1')   → bật;   removeItem → tắt.
 * Trước đây mỗi lần danh sách key thay đổi đều in cả danh sách 21 key → log nhảy liên tục, làm chậm trình duyệt.
 */
let on: boolean | null = null;
export function dlog(...args: any[]) {
  if (on === null) { try { on = localStorage.getItem('meditrans_debug') === '1'; } catch { on = false; } }
  if (on) console.log(...args);
}
