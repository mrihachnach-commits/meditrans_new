/**
 * v10.6 — Bộ đếm lượt gọi AI (trong bộ nhớ trình duyệt, không gửi đi đâu).
 * Mỗi lượt gọi proxy ghi: trang (nếu biết), loại (dịch giữ định dạng / OCR / dịch thường), model, mã trả về,
 * thời gian, token vào / ra / suy nghĩ, lý do dừng (length = bị cắt cụt). Dùng để so model, kiểm chứng tắt suy nghĩ,
 * xem trang nào tốn nhiều lượt thử lại. Xuất CSV trong bảng Dịch giữ định dạng.
 */
export interface AiCallRecord {
  t: number;
  page?: number;
  kind: string;
  model: string;
  status: number | string;
  ms: number;
  tin?: number;
  tout?: number;
  treason?: number;
  finish?: string;
}
export interface AiPageSummary {
  page: number | null;
  requests: number;
  errors: number;
  tin: number;
  tout: number;
  treason: number;
  ms: number;
  truncated: number;
}

const MAX_RECORDS = 20000;
let records: AiCallRecord[] = [];
const listeners = new Set<() => void>();
const pageTags = new WeakMap<AbortSignal, number>();

/** Tín hiệu huỷ riêng cho một trang (gắn số trang để bộ đếm ghi đúng trang). Gọi done() khi xong trang. */
export function pageScopedSignal(signal: AbortSignal | undefined, page: number): { signal: AbortSignal; done: () => void } {
  const c = new AbortController();
  const onAbort = () => c.abort();
  if (signal?.aborted) c.abort();
  else signal?.addEventListener('abort', onAbort, { once: true });
  pageTags.set(c.signal, page);
  return { signal: c.signal, done: () => signal?.removeEventListener('abort', onAbort) };
}
export function pageOfSignal(signal?: AbortSignal): number | undefined {
  return signal ? pageTags.get(signal) : undefined;
}

export function recordAiCall(r: AiCallRecord) {
  records.push(r);
  if (records.length > MAX_RECORDS) records = records.slice(-MAX_RECORDS);
  listeners.forEach(f => { try { f(); } catch { /* */ } });
}
export function onAiTelemetry(f: () => void): () => void { listeners.add(f); return () => { listeners.delete(f); }; }
export function aiTelemetryRecords(): AiCallRecord[] { return records; }
export function clearAiTelemetry() { records = []; listeners.forEach(f => { try { f(); } catch { /* */ } }); }

const isOk = (r: AiCallRecord) => r.status === 200;

export function summarizeAiTelemetry(rs: AiCallRecord[] = records): { total: AiPageSummary; pages: AiPageSummary[] } {
  const mk = (page: number | null): AiPageSummary => ({ page, requests: 0, errors: 0, tin: 0, tout: 0, treason: 0, ms: 0, truncated: 0 });
  const total = mk(null);
  const by = new Map<number, AiPageSummary>();
  for (const r of rs) {
    const targets = [total];
    if (r.page != null) {
      if (!by.has(r.page)) by.set(r.page, mk(r.page));
      targets.push(by.get(r.page)!);
    }
    for (const s of targets) {
      s.requests++;
      if (!isOk(r)) s.errors++;
      s.tin += r.tin || 0; s.tout += r.tout || 0; s.treason += r.treason || 0; s.ms += r.ms || 0;
      if (r.finish === 'length') s.truncated++;
    }
  }
  return { total, pages: [...by.values()].sort((a, b) => (a.page ?? 0) - (b.page ?? 0)) };
}

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV: phần 1 = tổng theo trang, phần 2 = từng lượt gọi. */
export function aiTelemetryCsv(): string {
  const { total, pages } = summarizeAiTelemetry();
  const lines: string[] = [];
  lines.push(['trang', 'so_luot_goi', 'loi_thu_lai', 'token_vao', 'token_ra', 'token_suy_nghi', 'tong_thoi_gian_ms', 'bi_cat_cut'].join(','));
  for (const s of [...pages, total]) lines.push([s.page ?? 'TONG', s.requests, s.errors, s.tin, s.tout, s.treason, s.ms, s.truncated].map(csvCell).join(','));
  lines.push('');
  lines.push(['thoi_diem', 'trang', 'loai', 'model', 'ma_tra_ve', 'thoi_gian_ms', 'token_vao', 'token_ra', 'token_suy_nghi', 'ly_do_dung'].join(','));
  for (const r of records) {
    lines.push([new Date(r.t).toISOString(), r.page ?? '', r.kind, r.model, r.status, r.ms, r.tin ?? '', r.tout ?? '', r.treason ?? '', r.finish ?? ''].map(csvCell).join(','));
  }
  return '﻿' + lines.join('\n');
}
