import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { saveAs } from 'file-saver';
import {
  LayoutTemplate, Play, Square, Download, RefreshCw, AlertTriangle, Loader2, Layers,
  ImageDown, Cloud, HardDrive, Repeat, X, PencilLine, Save, ScanText,
  BarChart3, MoreHorizontal,
} from 'lucide-react';
import {
  LayoutBlockTranslator,
  LayoutPageResult,
  LayoutPair,
  isOcrKey,
  renderPageFromPairs,
  deleteLayoutPages,
  exportLayoutPdf,
  loadLayoutPage,
  loadLayoutPages,
  loadLocalLayoutPairs,
  parsePageRange,
  saveLayoutPage,
  translatePageWithLayout,
  getLayoutOcrFigures,
  setLayoutOcrFigures,
} from '../services/layoutTranslationService';
import { LayoutCloudTarget, loadCloudLayoutPages, saveCloudLayoutPage } from '../services/layoutCloudService';
import { isFirestoreQuotaBlocked } from '../services/firestoreQuota';
import { checkNumeric, describeNumericIssue } from '../services/numericQa';
import { aiTelemetryCsv, clearAiTelemetry, onAiTelemetry, summarizeAiTelemetry } from '../services/aiTelemetry';

interface LayoutTranslatePanelProps {
  pdfDoc: PDFDocumentProxy;
  numPages: number;
  currentPage: number;
  docKey: string;
  fileName: string;
  translator: LayoutBlockTranslator | null;
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
  /** Lưu đám mây (giống bản dịch chữ). null = file cục bộ / chưa đăng nhập → chỉ lưu trên máy. */
  cloud: LayoutCloudTarget | null;
  /** Ô trên hàng menu chính để đặt thanh công cụ (giữ khung phải chỉ 1 hàng menu như khung trái). */
  toolbarTarget?: HTMLElement | null;
  /** Kích thước hiển thị trang PDF bên trái → bản dịch hiển thị cùng cỡ. */
  pageBox?: { w: number; h: number } | null;
  /** Vùng cuộn của trình xem PDF bên trái → cuộn đồng bộ hai bên. */
  syncScrollEl?: HTMLElement | null;
  fullScreen?: boolean;
  /** Yêu cầu dịch hàng loạt từ Cài đặt ("Dịch toàn bộ giữ định dạng"). Đổi id để kích hoạt.
   *  v10.3: kèm docKey — yêu cầu của tài liệu khác bị bỏ qua. */
  bulkRequest?: { id: number; pages: number[]; docKey?: string } | null;
  onBulkStateChange?: (s: { running: boolean; done: number; total: number }) => void;
}

function friendlyError(err: any): string {
  const msg = String(err?.message || err || '');
  if (/level 2/i.test(msg)) return 'Tài khoản chưa đủ Level 2 để dùng Key hệ thống.';
  if (/api key|key khả dụng/i.test(msg)) return 'Không có API Key khả dụng. Kiểm tra lại Key trong Cài đặt.';
  if (/429|quota|resource_exhausted/i.test(msg)) return 'Key đang hết hạn mức (429). Thử lại sau ít phút.';
  if (/json|hợp lệ/i.test(msg)) return 'AI trả về dữ liệu không đúng định dạng. Hãy bấm "Dịch lại".';
  return msg.slice(0, 160) || 'Lỗi không xác định';
}

/** v10.3: chuẩn hoá khoảng trang trước khi gọi parsePageRange ("1 - 5", "1–5", "1—5" → "1-5"). */
const normalizeRangeInput = (input: string) => input.replace(/\s*[-–—]\s*/g, '-');

const iconBtn = 'inline-flex items-center justify-center gap-1 h-7 px-2 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all disabled:opacity-40 disabled:cursor-not-allowed';

export const LayoutTranslatePanel: React.FC<LayoutTranslatePanelProps> = ({
  pdfDoc, numPages, currentPage, docKey, fileName, translator, showToast, cloud,
  toolbarTarget, pageBox, syncScrollEl, fullScreen, bulkRequest, onBulkStateChange,
}) => {
  const [results, setResults] = useState<Record<number, LayoutPageResult>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [rangeInput, setRangeInput] = useState('');
  const [showRange, setShowRange] = useState(false);
  // v10.6: bộ đếm lượt gọi AI (token vào/ra/suy nghĩ, lỗi, thời gian) theo trang + xuất CSV
  const [showStats, setShowStats] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [statsTick, setStatsTick] = useState(0);
  useEffect(() => {
    if (!showStats) return;
    let t: any = null;
    const off = onAiTelemetry(() => { if (!t) t = setTimeout(() => { t = null; setStatsTick(x => x + 1); }, 500); });
    return () => { off(); if (t) clearTimeout(t); };
  }, [showStats]);
  const stats = useMemo(() => summarizeAiTelemetry(), [statsTick, showStats]); // eslint-disable-line react-hooks/exhaustive-deps
  const [running, setRunning] = useState(false);
  /** Đã bấm Dừng, đang chờ các trang dở dang thoát (thường < 1 giây). */
  const [stopping, setStopping] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; page: number | null }>({ done: 0, total: 0, page: null });
  const [inFlight, setInFlight] = useState<number[]>([]);
  const [exporting, setExporting] = useState(false);
  // v10.7: tiến độ xuất + hộp xác nhận trong app (window.confirm bị chặn trong khung nhúng / một số trình duyệt
  // → trả về "Huỷ" ngay, báo "Đã huỷ xuất PDF" dù người dùng chưa chọn gì)
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  // v10.8: hộp hỏi có thêm lựa chọn "Sửa lỗi" (dịch bù trang thiếu, dịch lại cả trang lệch số liệu)
  type ExportChoice = 'export' | 'cancel' | 'fix';
  const [exportAsk, setExportAsk] = useState<{ problems: string[]; count: number; fixable: number; resolve: (c: ExportChoice) => void } | null>(null);
  const askExport = (problems: string[], count: number, fixable: number) => new Promise<ExportChoice>(resolve => setExportAsk({ problems, count, fixable, resolve }));
  const [loadingCache, setLoadingCache] = useState(true);
  // v10.6: tự dịch + dịch trước N trang (giống chế độ dịch thường); nhớ lựa chọn trên máy
  const [autoFollow, setAutoFollowState] = useState(() => { try { return localStorage.getItem('mediTrans_layoutAuto') === '1'; } catch { return false; } });
  const setAutoFollow = (f: (v: boolean) => boolean) => setAutoFollowState(v => { const n = f(v); try { localStorage.setItem('mediTrans_layoutAuto', n ? '1' : '0'); } catch { /* */ } return n; });
  const [lookAhead, setLookAheadState] = useState(() => { try { const v = parseInt(localStorage.getItem('mediTrans_layoutLookAhead') || '', 10); return v >= 0 && v <= 10 ? v : 2; } catch { return 2; } });
  const setLookAhead = (n: number) => { setLookAheadState(n); try { localStorage.setItem('mediTrans_layoutLookAhead', String(n)); } catch { /* */ } };
  /** Dịch cả chữ nằm trong hình / chữ dọc (AI đọc ảnh trang — chậm hơn nhiều). */
  const [ocrFigures, setOcrFigures] = useState(getLayoutOcrFigures);
  const [cloudPairs, setCloudPairs] = useState<Record<number, LayoutPair[]>>({});
  const [cloudLoading, setCloudLoading] = useState(!!cloud);
  const [rebuilding, setRebuilding] = useState<number | null>(null);
  const [noticeHidden, setNoticeHidden] = useState<number | null>(null);
  /** Bảng sửa bản dịch của trang đang xem. */
  const [editor, setEditor] = useState<{ page: number; items: LayoutPair[]; ocr: LayoutPair[]; filter: string; onlyNumeric?: boolean; issues?: Record<string, string> } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  /** v10.3: số khối chưa có bản dịch khi dựng lại trang từ bản lưu KHÔNG gọi AI (xem → không tốn token). */
  const [untranslatedByPage, setUntranslatedByPage] = useState<Record<number, number>>({});
  const [fillingPage, setFillingPage] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  /** Huỷ việc dựng lại trang đang xem từ bản lưu khi lật sang trang khác / đóng bảng. */
  const rebuildAbortRef = useRef<AbortController | null>(null);
  /** Trang dựng lại từ bản lưu bị lỗi → không tự thử lại liên tục (trước đây lặp vô hạn, mỗi lần còn gọi AI dịch bù). */
  const rebuildFailedRef = useRef<Set<number>>(new Set());
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const cloudPairsRef = useRef(cloudPairs);
  cloudPairsRef.current = cloudPairs;
  const urlCache = useRef<Map<number, { blob: Blob; url: string }>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const cloudKey = cloud ? `${cloud.ownerId}/${cloud.fileId}/${cloud.canWrite}` : '';
  // App tạo object `cloud` mới mỗi lần vẽ lại → giữ cố định theo cloudKey. Trước đây mỗi lần App vẽ lại (rất thường
  // xuyên khi đang dịch) hiệu ứng đồng bộ chạy lại và GHI LẠI mọi trang chưa được xác nhận lên Firestore → cạn hạn
  // mức ghi miễn phí trong ngày.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableCloud = useMemo(() => cloud, [cloudKey]);
  /** Trang đã có bản dịch giữ định dạng trên đám mây (để biết trang nào cần đẩy lên). */
  const remotePagesRef = useRef<Set<number>>(new Set());

  const urlFor = useCallback((r?: LayoutPageResult) => {
    if (!r) return null;
    const hit = urlCache.current.get(r.pageNumber);
    if (hit && hit.blob === r.blob) return hit.url;
    if (hit) URL.revokeObjectURL(hit.url);
    const url = URL.createObjectURL(r.blob);
    urlCache.current.set(r.pageNumber, { blob: r.blob, url });
    if (urlCache.current.size > 24) { // giữ tối đa 24 ảnh đang mở
      const oldest = urlCache.current.keys().next().value as number;
      if (oldest !== r.pageNumber) { URL.revokeObjectURL(urlCache.current.get(oldest)!.url); urlCache.current.delete(oldest); }
    }
    return url;
  }, []);

  useEffect(() => {
    const cache = urlCache.current;
    return () => {
      abortRef.current?.abort();
      rebuildAbortRef.current?.abort();
      cache.forEach(v => URL.revokeObjectURL(v.url));
    };
  }, []);

  /* -------- đệm trên máy -------- */
  useEffect(() => {
    let alive = true;
    setLoadingCache(true);
    // Ảnh đệm của phiên bản hiện tại + bản dịch (cặp câu) đã lưu trên máy, kể cả của phiên bản cũ
    Promise.all([loadLayoutPages(docKey, numPages), loadLocalLayoutPairs(docKey)]).then(([cached, localPairs]) => {
      if (!alive) return;
      setResults(cached);
      setCloudPairs(prev => ({ ...localPairs, ...prev })); // bản đám mây (nếu có) được ưu tiên
      setLoadingCache(false);
    });
    return () => { alive = false; };
  }, [docKey, numPages]);

  /* -------- bản dịch đã lưu trên đám mây -------- */
  useEffect(() => {
    if (!cloud) { setCloudLoading(false); return; }
    let alive = true;
    setCloudLoading(true);
    loadCloudLayoutPages(cloud)
      .then(pairs => {
        if (!alive) return;
        remotePagesRef.current = new Set(Object.keys(pairs).map(Number));
        setCloudPairs(prev => ({ ...prev, ...pairs }));
      })
      .catch(e => console.warn('[Layout] Không tải được bản dịch đã lưu trên đám mây:', e))
      .finally(() => { if (alive) setCloudLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudKey]);

  /** v10.3: lượt gửi đang chạy của từng trang — gửi bắt buộc (force, vd. lưu bản sửa) được XẾP SAU lượt đang chạy
   *  thay vì bị bỏ qua (trước đây bản sửa có thể không được đồng bộ mà vẫn báo "đã đồng bộ"). */
  const pushingRef = useRef<Map<number, Promise<boolean>>>(new Map());
  const pushFailedRef = useRef<Set<number>>(new Set());
  /** v10.3: trả về true nếu bản dịch đã thực sự lên đám mây. */
  const pushToCloud = useCallback(async (page: number, pairs?: LayoutPair[], force = false): Promise<boolean> => {
    if (!stableCloud?.canWrite || !pairs?.length) return false;
    const inflight = pushingRef.current.get(page);
    if (inflight && !force) return inflight; // đang gửi trang này → không gửi trùng
    if (!force && pushFailedRef.current.has(page)) return false; // lỗi rồi → không thử lại liên tục trong phiên
    const doPush = async (): Promise<boolean> => {
      if (isFirestoreQuotaBlocked()) return false; // hết hạn mức ghi hôm nay → chỉ lưu trên máy
      try {
        await saveCloudLayoutPage(stableCloud, page, pairs);
        if (isFirestoreQuotaBlocked()) return false; // vừa hết hạn mức → chưa lưu được, lần sau mở lại sẽ đồng bộ
        remotePagesRef.current.add(page);
        pushFailedRef.current.delete(page);
        setCloudPairs(prev => ({ ...prev, [page]: pairs }));
        return true;
      } catch (e) {
        pushFailedRef.current.add(page);
        console.warn(`[Layout] Không lưu được trang ${page} lên đám mây:`, e);
        return false;
      }
    };
    const next = (inflight ? inflight.catch(() => false).then(doPush) : doPush());
    pushingRef.current.set(page, next);
    try {
      return await next;
    } finally {
      if (pushingRef.current.get(page) === next) pushingRef.current.delete(page);
    }
  }, [stableCloud]);

  useEffect(() => {
    if (loadingCache || cloudLoading || !stableCloud?.canWrite || isFirestoreQuotaBlocked()) return;
    // Đẩy lên đám mây mọi trang đã dịch trên máy mà đám mây chưa có (giống bản dịch chữ được đồng bộ)
    const pushed = new Set<number>();
    Object.values(resultsRef.current).forEach(r => {
      if (r.pairs?.length && !remotePagesRef.current.has(r.pageNumber)) { pushed.add(r.pageNumber); pushToCloud(r.pageNumber, r.pairs); }
    });
    Object.entries(cloudPairsRef.current).forEach(([k, pairs]) => {
      const p = Number(k);
      if (!pushed.has(p) && pairs?.length && !remotePagesRef.current.has(p)) pushToCloud(p, pairs);
    });
  }, [loadingCache, cloudLoading, stableCloud, pushToCloud]);

  // noAi: dựng lại CHỈ từ bản dịch đã lưu (xuất PDF không bao giờ gọi AI / tốn token)
  const rebuildFromCloud = useCallback(async (page: number, signal?: AbortSignal, noAi = false): Promise<LayoutPageResult | null> => {
    const pairs = cloudPairsRef.current[page];
    if (!pairs?.length) return null;
    const res = await renderPageFromPairs(pdfDoc, page, pairs, noAi ? undefined : (translator || undefined), signal);
    if (noAi && res.untranslated) untranslatedRef.current += res.untranslated;
    if (signal?.aborted) return null;
    // v10.3: ghi nhận số khối chưa dịch (dựng không AI) để hiện nút "Dịch bù"
    setUntranslatedByPage(prev => ({ ...prev, [page]: noAi ? (res.untranslated || 0) : 0 }));
    // v10.3: dựng lại KHÔNG AI (xem / xuất PDF) thì không ghi đè bản lưu đám mây
    if ((res.retranslated || res.composed) && res.pairs?.length && !noAi) pushToCloud(page, res.pairs, true); // cập nhật bản lưu theo cách tách khối mới
    await saveLayoutPage(docKey, res);
    const stored = (await loadLayoutPage(docKey, page)) || res; // bản trên ổ đĩa → giải phóng RAM
    setResults(prev => ({ ...prev, [page]: stored }));
    return stored;
  }, [pdfDoc, docKey, translator, pushToCloud]);

  useEffect(() => {
    if (loadingCache || cloudLoading || running || rebuilding !== null) return;
    if (resultsRef.current[currentPage] || !cloudPairs[currentPage] || rebuildFailedRef.current.has(currentPage)) return;
    const ctrl = new AbortController();
    rebuildAbortRef.current = ctrl;
    const page = currentPage;
    setRebuilding(page);
    // v10.3: chỉ XEM trang đã lưu → dựng lại không gọi AI (trước đây âm thầm tốn token); khối thiếu → nút "Dịch bù"
    rebuildFromCloud(page, ctrl.signal, true)
      .catch(e => {
        if (ctrl.signal.aborted || /aborted/i.test(String(e?.message))) return;
        console.warn('[Layout] Dựng lại trang thất bại:', e);
        rebuildFailedRef.current.add(page);
        setErrors(prev => ({ ...prev, [page]: `Không dựng lại được trang từ bản đã lưu (${friendlyError(e)}). Bấm "Dịch lại" để dịch mới.` }));
      })
      .finally(() => {
        if (rebuildAbortRef.current === ctrl) rebuildAbortRef.current = null;
        setRebuilding(null);
      });
  }, [currentPage, cloudPairs, loadingCache, cloudLoading, running, rebuilding, rebuildFromCloud]);

  /** v10.3: người dùng bấm "Dịch bù" → dựng lại trang có gọi AI cho các khối còn thiếu bản dịch. */
  const handleFillMissing = useCallback(async () => {
    const page = currentPage;
    if (!translator) { showToast('Chưa có API Key để dịch. Vui lòng thêm Key trong Cài đặt.', 'error'); return; }
    if (fillingPage !== null || running) return;
    rebuildAbortRef.current?.abort();
    const ctrl = new AbortController();
    rebuildAbortRef.current = ctrl;
    setFillingPage(page);
    setRebuilding(page);
    try {
      const r = await rebuildFromCloud(page, ctrl.signal, false);
      if (r) showToast(`Đã dịch bù trang ${page}.`, 'success');
    } catch (e: any) {
      if (!(ctrl.signal.aborted || /aborted/i.test(String(e?.message)))) {
        showToast(`Không dịch bù được trang ${page}: ${friendlyError(e)}`, 'error');
      }
    } finally {
      if (rebuildAbortRef.current === ctrl) rebuildAbortRef.current = null;
      setFillingPage(null);
      setRebuilding(null);
    }
  }, [currentPage, translator, fillingPage, running, rebuildFromCloud, showToast]);

  // Lật sang trang khác → huỷ việc dựng lại trang cũ (trước đây vẫn chạy tiếp, lật nhanh nhiều trang → đơ máy)
  useEffect(() => () => { rebuildAbortRef.current?.abort(); }, [currentPage]);

  /* -------- dịch -------- */
  // v10.8: fillOnly = các trang chỉ cần DỊCH BÙ khối thiếu (dựng lại từ bản lưu + gọi AI cho khối thiếu), chạy chung hàng đợi
  const runPages = useCallback(async (pages: number[], force = false, fillOnly?: Set<number>) => {
    if (!translator) {
      showToast('Chưa có API Key để dịch. Vui lòng thêm Key trong Cài đặt.', 'error');
      return;
    }
    if (abortRef.current) return;
    const todo = force ? pages : pages.filter(p => !resultsRef.current[p]);
    if (todo.length === 0) {
      showToast('Các trang đã chọn đều đã được dịch.', 'info');
      return;
    }
    rebuildAbortRef.current?.abort(); // dừng việc dựng lại trang đang xem, nhường CPU cho tiến trình dịch
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setStopping(false);
    setShowRange(false);

    // Số trang xử lý song song. Proxy (ShopAIKey / key hệ thống): 2 trang — mọi yêu cầu còn đi qua bộ điều tiết chung
    // (mặc định 2 yêu cầu cùng lúc, tự tạm dừng khi proxy báo quá tải) nên không bao giờ dồn cục lên proxy.
    // Key Google riêng: 3 trang khi có ≥3 key, còn lại 2.
    const keys: string[] = (translator as any).apiKeys || [];
    const viaProxy = !!(translator as any).usesProxy?.();
    const fast = !!(translator as any).isFastProxyModel?.('__layout_fixed__');
    const concurrency = todo.length <= 1 ? 1 : viaProxy ? (fast ? 4 : 3) : (keys.length >= 3 ? 3 : 2);
    const queue = [...todo];
    let ok = 0;
    let finished = 0;
    let fatal = false;
    setProgress({ done: 0, total: todo.length, page: todo[0] });
    onBulkStateChange?.({ running: true, done: 0, total: todo.length });

    const worker = async () => {
      while (queue.length && !controller.signal.aborted && !fatal) {
        const p = queue.shift()!;
        setInFlight(prev => [...prev, p]);
        setErrors(prev => { const n = { ...prev }; delete n[p]; return n; });
        try {
          if (fillOnly?.has(p) && cloudPairsRef.current[p]?.length) {
            const r = await rebuildFromCloud(p, controller.signal, false); // dịch bù: chỉ gọi AI cho khối còn thiếu
            if (!r && !controller.signal.aborted) throw new Error('Không dựng lại được trang từ bản lưu');
          } else if (!force && cloudPairsRef.current[p]?.length) {
            await rebuildFromCloud(p, controller.signal); // đã có bản dịch lưu trên đám mây → không gọi AI
          } else {
            // Trang scan / lớp chữ lỗi được tự nhận diện và dịch bằng OCR bên trong hàm này
            const res = await translatePageWithLayout(pdfDoc, p, translator, controller.signal);
            if (controller.signal.aborted) throw new Error('Translation aborted');
            await saveLayoutPage(docKey, res);
            const stored = (await loadLayoutPage(docKey, p)) || res; // bản trên ổ đĩa → giải phóng RAM
            setResults(prev => ({ ...prev, [p]: stored }));
            pushToCloud(p, res.pairs, true);
          }
          ok++;
        } catch (err: any) {
          if (!(controller.signal.aborted || /aborted/i.test(String(err?.message)))) {
            console.error(`[Layout] Lỗi dịch trang ${p}:`, err);
            setErrors(prev => ({ ...prev, [p]: friendlyError(err) }));
            if (/level 2|api key|key khả dụng/i.test(String(err?.message))) fatal = true;
          }
        } finally {
          finished++;
          setInFlight(prev => prev.filter(x => x !== p));
          setProgress({ done: finished, total: todo.length, page: p });
          onBulkStateChange?.({ running: true, done: finished, total: todo.length });
        }
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));

    setProgress({ done: 0, total: 0, page: null });
    setInFlight([]);
    setRunning(false);
    setStopping(false);
    abortRef.current = null;
    onBulkStateChange?.({ running: false, done: finished, total: todo.length });
    if (fatal) showToast('Dừng dịch: không có API Key khả dụng hoặc tài khoản chưa đủ quyền.', 'error');
    if (controller.signal.aborted) showToast(`Đã dừng. Hoàn thành ${ok} trang.`, 'info');
    else if (fillOnly) showToast(`Đã sửa ${ok}/${todo.length} trang (dịch bù ${todo.filter(p => fillOnly.has(p)).length}, dịch lại ${todo.filter(p => !fillOnly.has(p)).length}).` + (ok < todo.length ? ` ${todo.length - ok} trang chưa sửa được.` : '') + ' Bấm "Xuất PDF" lại để tải file.', ok < todo.length ? 'info' : 'success');
    else if (todo.length > 1 && ok > 0) showToast(`Đã dịch giữ định dạng ${ok} trang.`, 'success');
  }, [translator, pdfDoc, docKey, showToast, rebuildFromCloud, pushToCloud, onBulkStateChange]);

  // Yêu cầu "Dịch toàn bộ giữ định dạng" từ Cài đặt
  const lastBulkId = useRef<number | null>(null);
  useEffect(() => {
    if (!bulkRequest || bulkRequest.id === lastBulkId.current || loadingCache || cloudLoading) return;
    lastBulkId.current = bulkRequest.id;
    // v10.3: yêu cầu của tài liệu khác (đã đổi file) → bỏ qua
    if (bulkRequest.docKey && bulkRequest.docKey !== docKey) return;
    if (abortRef.current) { showToast('Đang có tiến trình dịch giữ định dạng chạy.', 'info'); return; }
    // v10.3: kẹp số trang trong phạm vi tài liệu hiện tại
    const pages = Array.from(new Set(bulkRequest.pages.filter(p => Number.isInteger(p) && p >= 1 && p <= numPages)));
    if (pages.length) runPages(pages);
  }, [bulkRequest, loadingCache, cloudLoading, runPages, showToast, docKey, numPages]);

  useEffect(() => {
    // v10.3: chờ tải xong bản lưu đám mây (cloudLoading) — trước đây có thể dịch lại bằng AI trang đã có bản lưu
    if (!autoFollow || loadingCache || cloudLoading || running) return;
    // v10.6: trang đang xem + dịch trước `lookAhead` trang tiếp theo (bỏ trang đã có bản dịch / bản lưu / đang lỗi)
    const want: number[] = [];
    for (let p = currentPage; p <= Math.min(numPages, currentPage + lookAhead); p++) {
      if (resultsRef.current[p] || cloudPairsRef.current[p] || errors[p]) continue;
      want.push(p);
    }
    if (!want.length) return;
    const t = setTimeout(() => runPages(want), 600);
    return () => clearTimeout(t);
  }, [autoFollow, lookAhead, numPages, currentPage, loadingCache, cloudLoading, running, errors, runPages]);

  const handleRunRange = () => {
    const pages = parsePageRange(normalizeRangeInput(rangeInput), numPages); // v10.3: chuẩn hoá dấu gạch
    if (pages.length === 0) {
      showToast(`Khoảng trang không hợp lệ. Ví dụ: 1-3, 5 (tối đa ${numPages}).`, 'error');
      return;
    }
    runPages(pages);
  };

  const handleRetranslate = async () => {
    rebuildFailedRef.current.delete(currentPage);
    await deleteLayoutPages(docKey, [currentPage]);
    setResults(prev => { const n = { ...prev }; delete n[currentPage]; return n; });
    runPages([currentPage], true);
  };

  /* -------- v10.8: "Sửa lỗi" từ hộp xuất PDF -------- */
  const fixPendingRef = useRef<{ fill: number[]; redo: number[] } | null>(null);
  const runFix = useCallback(async (fill: number[], redo: number[]) => {
    // Chạy chung cơ chế dịch đồng loạt: cùng số luồng song song, cùng thanh tiến độ và nút "Dừng dịch"
    if (redo.length) {
      redo.forEach(p => rebuildFailedRef.current.delete(p));
      await deleteLayoutPages(docKey, redo);
      setResults(prev => { const n = { ...prev }; redo.forEach(p => delete n[p]); return n; });
    }
    await runPages([...fill, ...redo], true, new Set(fill));
  }, [docKey, runPages]);

  /* -------- sửa bản dịch -------- */
  const openEditor = (onlyNumeric = false) => {
    const pairs = resultsRef.current[currentPage]?.pairs || cloudPairsRef.current[currentPage];
    if (!pairs?.length) { showToast('Trang này chưa có bản dịch để sửa.', 'info'); return; }
    const issues: Record<string, string> = {};
    for (const it of resultsRef.current[currentPage]?.numericIssues || []) issues[it.s] = it.why;
    setEditor({
      page: currentPage,
      items: pairs.filter(p => !isOcrKey(p.s)).map(p => ({ ...p })),
      ocr: pairs.filter(p => isOcrKey(p.s)),
      filter: '',
      onlyNumeric: onlyNumeric && Object.keys(issues).length > 0,
      issues,
    });
  };

  const saveEditor = async () => {
    if (!editor) return;
    setSavingEdit(true);
    try {
      const pairs = [...editor.ocr, ...editor.items.map(p => ({ s: p.s, v: p.v.replace(/\s*\n\s*/g, ' ').trim() || p.s }))];
      // Vẽ lại từ bản đã sửa — không gọi AI, không tốn token
      const res = await renderPageFromPairs(pdfDoc, editor.page, pairs);
      await saveLayoutPage(docKey, res);
      const stored = (await loadLayoutPage(docKey, editor.page)) || res;
      setResults(prev => ({ ...prev, [editor.page]: stored }));
      setCloudPairs(prev => ({ ...prev, [editor.page]: res.pairs || pairs }));
      // v10.3: báo đúng kết quả đồng bộ (trước đây luôn báo "đã đồng bộ")
      const synced = cloud?.canWrite ? await pushToCloud(editor.page, res.pairs || pairs, true) : false;
      setUntranslatedByPage(prev => ({ ...prev, [editor.page]: 0 }));
      if (cloud?.canWrite && synced) showToast(`Đã lưu bản sửa trang ${editor.page} (đã đồng bộ lên tài khoản).`, 'success');
      else if (cloud?.canWrite) showToast(`Đã lưu bản sửa trang ${editor.page} trên máy này; chưa đồng bộ được lên tài khoản (sẽ thử lại sau).`, 'info');
      else showToast(`Đã lưu bản sửa trang ${editor.page} trên máy này.`, 'success');
      setEditor(null);
    } catch (e: any) {
      showToast(`Không lưu được bản sửa: ${e?.message || e}`, 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  /* -------- xuất -------- */
  const baseName = useMemo(() => (fileName || 'tai-lieu').replace(/\.pdf$/i, ''), [fileName]);

  const untranslatedRef = useRef(0);
  const handleExport = async () => {
    const allDone = Array.from(new Set([...Object.keys(results), ...Object.keys(cloudPairs)].map(Number))).sort((a, b) => a - b);
    // v10.3: chuẩn hoá khoảng trang + phân biệt "khoảng không hợp lệ" với "chưa có trang dịch trong khoảng"
    let wanted = allDone;
    let notDoneInRange: number[] = [];
    if (rangeInput.trim()) {
      const inRange = parsePageRange(normalizeRangeInput(rangeInput), numPages);
      if (inRange.length === 0) {
        showToast(`Khoảng trang "${rangeInput.trim()}" không hợp lệ. Ví dụ: 1-3, 5 (tối đa ${numPages}). Để trống để xuất tất cả trang đã dịch.`, 'error');
        return;
      }
      wanted = inRange.filter(p => allDone.includes(p));
      notDoneInRange = inRange.filter(p => !allDone.includes(p));
      if (wanted.length === 0) {
        showToast(`Chưa có trang nào trong khoảng "${rangeInput.trim()}" được dịch giữ định dạng.`, 'error');
        return;
      }
    }
    if (wanted.length === 0) {
      showToast('Chưa có trang nào được dịch để xuất.', 'error');
      return;
    }
    if (exporting) return; // (v10.6.1) bấm lại khi đang xuất không làm gì
    setExporting(true);
    setExportProgress({ done: 0, total: wanted.length });
    untranslatedRef.current = 0;
    try {
      const pages: LayoutPageResult[] = [];
      // v10.3: một trang lỗi không làm hỏng cả lần xuất — ghi lại trang bỏ qua và báo trong thông báo
      const failed: number[] = [];
      const scannedSkipped: number[] = [];
      let k = 0;
      for (const p of wanted) {
        setExportProgress({ done: ++k, total: wanted.length });
        try {
          const r = resultsRef.current[p] || (await rebuildFromCloud(p, undefined, true));
          if (!r) { failed.push(p); continue; }
          if (r.scanned && !r.blank) { scannedSkipped.push(p); continue; }
          if (r.scanned) continue; // trang trắng
          pages.push(r);
        } catch (err) {
          console.warn(`[Layout] Bỏ qua trang ${p} khi xuất PDF:`, err);
          failed.push(p);
        }
      }
      const fmt = (arr: number[]) => arr.length > 8 ? `${arr.slice(0, 8).join(', ')}…` : arr.join(', ');
      const skippedNote = (failed.length ? ` Bỏ qua ${failed.length} trang lỗi (${fmt(failed)}).` : '')
        + (scannedSkipped.length ? ` Bỏ qua ${scannedSkipped.length} trang scan chưa dịch được (${fmt(scannedSkipped)}).` : '');
      if (pages.length === 0) throw new Error('Không có trang hợp lệ để xuất.' + skippedNote);
      // v10.4: còn trang chưa dịch / trang scan / khối thiếu bản dịch / khối lệch số liệu → hỏi lại trước khi xuất,
      // liệt kê rõ từng loại (trước đây chỉ báo thoáng qua sau khi đã xuất)
      const numericPages = pages.filter(r => r.numericIssues?.length).map(r => r.pageNumber);
      const notDoneAll = rangeInput.trim() ? notDoneInRange : [];
      const untranslatedPages = Object.entries(untranslatedByPage).filter(([p, n]) => n > 0 && wanted.includes(+p)).map(([p]) => +p);
      const problems: string[] = [];
      if (notDoneAll.length) problems.push(`• ${notDoneAll.length} trang trong khoảng chưa dịch (không có trong file): ${fmt(notDoneAll)}`);
      if (scannedSkipped.length) problems.push(`• ${scannedSkipped.length} trang scan chưa dịch được (bị bỏ khỏi file): ${fmt(scannedSkipped)}`);
      if (failed.length) problems.push(`• ${failed.length} trang lỗi khi dựng lại (bị bỏ khỏi file): ${fmt(failed)}`);
      if (untranslatedPages.length || untranslatedRef.current) problems.push(`• Trang còn khối chưa có bản dịch (giữ chữ gốc): ${untranslatedPages.length ? fmt(untranslatedPages) : `${untranslatedRef.current} khối`}`);
      if (numericPages.length) problems.push(`• ${numericPages.length} trang có khối lệch số liệu so với bản gốc, chưa duyệt: ${fmt(numericPages)}`);
      if (problems.length) {
        const fixable = new Set([...untranslatedPages, ...numericPages]).size;
        const choice = await askExport(problems, pages.length, fixable);
        if (choice === 'cancel') { showToast('Đã huỷ xuất PDF.', 'info'); return; }
        if (choice === 'fix') { fixPendingRef.current = { fill: untranslatedPages.filter(p => !numericPages.includes(p)), redo: numericPages }; return; }
      }
      // v9.0: luôn xuất MỘT file PDF duy nhất cho toàn bộ các trang (trước đây chia 150 trang/file).
      // Ảnh trang được đọc lần lượt từ ổ đĩa và nhúng thẳng vào PDF nên vẫn nhẹ bộ nhớ.
      if (pages.length > 60) showToast(`Đang ghép ${pages.length} trang thành 1 file PDF, vui lòng chờ…`, 'info');
      const blob = await exportLayoutPdf(pages);
      saveAs(blob, `MediTrans_${baseName}_ban-dich-giu-dinh-dang.pdf`);
      showToast(`Đã xuất 1 file PDF gồm ${pages.length} trang.` + skippedNote + (untranslatedRef.current ? ` (${untranslatedRef.current} khối chưa có bản dịch lưu sẵn — mở trang đó và bấm "Dịch bù".)` : ''), (failed.length || scannedSkipped.length) ? 'info' : 'success');
    } catch (e: any) {
      showToast(`Lỗi xuất PDF: ${e?.message || e}`, 'error');
    } finally {
      setExporting(false);
      setExportProgress(null);
      const fx = fixPendingRef.current;
      fixPendingRef.current = null;
      if (fx) {
        if (running) showToast('Đang dịch — hãy đợi xong hoặc dừng rồi bấm "Sửa lỗi" lại.', 'info');
        else runFix(fx.fill, fx.redo);
      }
    }
  };

  /* -------- cuộn đồng bộ với trang gốc -------- */
  useEffect(() => {
    const left = syncScrollEl;
    const right = scrollRef.current;
    if (!left || !right) return;
    let driver: HTMLElement | null = null;
    let release = 0;
    const link = (src: HTMLElement, dst: HTMLElement) => () => {
      if (driver && driver !== src) return;
      driver = src;
      if (Math.abs(dst.scrollTop - src.scrollTop) > 1) dst.scrollTop = src.scrollTop;
      if (Math.abs(dst.scrollLeft - src.scrollLeft) > 1) dst.scrollLeft = src.scrollLeft;
      cancelAnimationFrame(release);
      release = requestAnimationFrame(() => { driver = null; });
    };
    const fromLeft = link(left, right);
    const fromRight = link(right, left);
    left.addEventListener('scroll', fromLeft, { passive: true });
    right.addEventListener('scroll', fromRight, { passive: true });
    right.scrollTop = left.scrollTop;
    right.scrollLeft = left.scrollLeft;
    return () => {
      left.removeEventListener('scroll', fromLeft);
      right.removeEventListener('scroll', fromRight);
      cancelAnimationFrame(release);
    };
  }, [syncScrollEl, currentPage, pageBox?.w, pageBox?.h, toolbarTarget]);

  /* -------- hiển thị -------- */
  const current = results[currentPage];
  const currentUrl = urlFor(current);
  const translatedCount = new Set([...Object.keys(results), ...Object.keys(cloudPairs)]).size;
  const busyHere = inFlight.includes(currentPage) || rebuilding === currentPage;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const hasSaved = !!current || !!cloudPairs[currentPage];

  // Khung trang: cùng cỡ với trang PDF bên trái; chưa đo được thì dùng tỉ lệ trang
  const aspect = current ? current.heightPt / current.widthPt : 1.414;
  const border = fullScreen ? 0 : 2; // khung có viền 1px như trang PDF bên trái
  const frameStyle: React.CSSProperties = pageBox
    ? { width: pageBox.w + border, height: pageBox.h + border }
    : { width: 'min(100%, 820px)', aspectRatio: `${1 / aspect}` };

  const notice = errors[currentPage]
    ? { tone: 'error', text: errors[currentPage] }
    : current?.scanned && !current?.blank
      ? { tone: 'warn', text: 'Trang scan (không có lớp chữ) và bộ dịch hiện tại không đọc được ảnh: hãy bấm "Dịch lại" sau khi kiểm tra Key, hoặc dùng tab "Dịch".' }
      : current?.noText
        ? { tone: 'warn', text: 'AI không tìm thấy chữ cần dịch trên trang này nên đã giữ nguyên trang gốc. Nếu trang có chú thích/chữ, bấm "Dịch lại" để đọc lại.' }
      : current && current.overflowCount > 0
        ? { tone: 'warn', text: `${current.overflowCount} khối chữ quá chật, có thể lấn khung. Nên xem lại.` }
        : null;
  // v10.3: trang dựng từ bản lưu còn khối chưa dịch → mời "Dịch bù" (chỉ gọi AI khi người dùng bấm)
  const missingHere = untranslatedByPage[currentPage] || 0;
  // v10.4: khối lệch số liệu / đơn vị / dấu so với bản gốc → mời duyệt
  const numericHere = current?.numericIssues?.length || 0;

  const storageTitle = cloud?.canWrite
    ? 'Bản dịch được lưu lên đám mây theo tài liệu (mở trên máy khác vẫn còn)'
    : cloud ? 'Bạn chỉ có quyền xem: bản dịch mới chỉ lưu trên máy này' : 'File chưa lưu lên tài khoản: bản dịch chỉ lưu trên máy này';

  const toolbar = (
    <div className="flex items-center gap-1 min-w-0 max-w-full shrink-0">
      {running ? (
        <button onClick={() => { setStopping(true); abortRef.current?.abort(); }} disabled={stopping}
          className={`${iconBtn} bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100`} title="Dừng dịch">
          {stopping ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3 fill-current" />}
          <span>{stopping ? 'Đang dừng…' : progress.total > 1 ? `Dừng dịch ${progress.done}/${progress.total}` : 'Dừng dịch'}</span>
        </button>
      ) : (
        <button onClick={() => runPages([currentPage])} disabled={loadingCache || cloudLoading || hasSaved}
          className={`${iconBtn} bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm`} title={`Dịch giữ định dạng trang ${currentPage}`}>
          <Play className="w-3.5 h-3.5" /><span>Dịch tr.{currentPage}</span>
        </button>
      )}
      <button onClick={() => setShowRange(v => !v)} disabled={running}
        className={`${iconBtn} border ${showRange ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
        title="Dịch / xuất nhiều trang">
        <Layers className="w-3.5 h-3.5" /><span className="hidden 2xl:inline">Nhiều trang</span>
      </button>
      <button onClick={() => setAutoFollow(v => !v)}
        className={`${iconBtn} border ${autoFollow ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-400 hover:text-slate-600'}`}
        title={autoFollow ? `Đang bật: tự dịch trang đang xem và dịch trước ${lookAhead} trang tiếp theo (tốn thêm token)` : 'Tự dịch khi lật trang + dịch trước (đang tắt)'}>
        <Repeat className="w-3.5 h-3.5" /><span className="text-[10px] font-bold">AUTO</span>
      </button>
      {autoFollow && (
        <select value={lookAhead} onChange={e => setLookAhead(parseInt(e.target.value, 10))}
          aria-label="Số trang dịch trước" title="Số trang dịch trước (giữ định dạng)"
          className="h-7 px-1 rounded-lg border border-emerald-200 bg-emerald-50 text-[11px] font-bold text-emerald-700 outline-none cursor-pointer">
          {[0, 1, 2, 3, 4, 5, 6, 8, 10].map(n => <option key={n} value={n}>+{n} tr</option>)}
        </select>
      )}
      {/* v10.7: nút ít dùng gom vào menu "⋯" (Dịch lại, Sửa, Chữ trong hình, Tải ảnh, Thống kê, nơi lưu) */}
      <button onClick={() => setShowMore(v => !v)} aria-label="Thêm" title="Thêm: dịch lại, sửa, chữ trong hình, tải ảnh, thống kê"
        className={`${iconBtn} border ${showMore ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
        <MoreHorizontal className="w-3.5 h-3.5" />
        {ocrFigures && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
      </button>
      <button onClick={handleExport} disabled={exporting || translatedCount === 0}
        className={`${iconBtn} bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm`}
        title={rangeInput.trim() ? 'Xuất PDF các trang đã dịch trong khoảng đã nhập' : 'Xuất PDF tất cả trang đã dịch'}>
        {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        <span>{exporting && exportProgress ? `Đang xuất ${exportProgress.done}/${exportProgress.total}` : `PDF (${translatedCount})`}</span>
      </button>
    </div>
  );

  return (
    <div className="relative flex-1 min-h-0 flex flex-col">
      {toolbarTarget ? createPortal(toolbar, toolbarTarget) : (
        <div className="px-3 py-2 border-b border-slate-100 bg-white">{toolbar}</div>
      )}

      {/* Thanh tiến trình mảnh, không chiếm chỗ */}
      {running && progress.total > 1 && (
        <div className="absolute top-0 left-0 right-0 h-1 bg-indigo-100 z-30">
          <div className="h-full bg-indigo-600 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}

      {/* v10.7: menu "⋯" */}
      {showMore && <div className="fixed inset-0 z-20" onClick={() => setShowMore(false)} />}
      {showMore && (
        <div className="absolute top-2 right-3 z-30 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-1.5 text-xs text-slate-700" onClick={e => e.stopPropagation()}>
          {hasSaved && !running && (
            <button onClick={() => { setShowMore(false); handleRetranslate(); }} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-left">
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />Dịch lại trang {currentPage}
            </button>
          )}
          {hasSaved && !running && (
            <button onClick={() => { setShowMore(false); openEditor(); }} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-left">
              <PencilLine className="w-3.5 h-3.5 text-slate-500" />Sửa bản dịch trang này
            </button>
          )}
          <button onClick={() => { const v = !ocrFigures; setOcrFigures(v); setLayoutOcrFigures(v); }} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-left">
            <ScanText className={`w-3.5 h-3.5 ${ocrFigures ? 'text-amber-600' : 'text-slate-500'}`} />
            <span className="flex-1">Dịch chữ trong hình</span>
            <span className={`text-[10px] font-bold ${ocrFigures ? 'text-amber-600' : 'text-slate-400'}`}>{ocrFigures ? 'BẬT' : 'TẮT'}</span>
          </button>
          {current && (
            <button onClick={() => { setShowMore(false); saveAs(current.blob, `MediTrans_${baseName}_trang-${currentPage}_ban-dich.jpg`); }} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-left">
              <ImageDown className="w-3.5 h-3.5 text-slate-500" />Tải ảnh trang này
            </button>
          )}
          <button onClick={() => { setShowMore(false); setShowStats(true); }} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-slate-50 text-left">
            <BarChart3 className="w-3.5 h-3.5 text-slate-500" />Thống kê lượt gọi AI (CSV)
          </button>
          <div className={`flex items-center gap-2 px-2.5 py-2 text-[11px] border-t border-slate-100 mt-1 ${cloud?.canWrite ? 'text-emerald-700' : 'text-slate-500'}`}>
            {cloud?.canWrite ? <Cloud className="w-3.5 h-3.5" /> : <HardDrive className="w-3.5 h-3.5" />}
            <span className="leading-snug">{storageTitle}</span>
          </div>
        </div>
      )}

      {/* v10.7: hộp xác nhận xuất PDF khi bản dịch chưa hoàn chỉnh (thay window.confirm) */}
      {exportAsk && (
        <div className="absolute inset-0 z-40 bg-slate-900/30 flex items-center justify-center p-4">
          <div className="w-[440px] max-w-full bg-white rounded-xl shadow-xl border border-slate-200 p-4 space-y-3">
            <div className="text-sm font-bold text-slate-800">Bản dịch chưa hoàn chỉnh</div>
            <div className="text-xs text-slate-600 whitespace-pre-line max-h-60 overflow-auto">{exportAsk.problems.join('\n')}</div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => { exportAsk.resolve('cancel'); setExportAsk(null); }} className={`${iconBtn} border border-slate-200 text-slate-600 hover:bg-slate-50`}>Huỷ</button>
              {exportAsk.fixable > 0 && (
                <button onClick={() => { exportAsk.resolve('fix'); setExportAsk(null); }} className={`${iconBtn} bg-amber-500 text-white hover:bg-amber-600`}
                  title="Trang thiếu bản dịch: dịch bù phần thiếu. Trang lệch số liệu: dịch lại cả trang. Xong thì bấm Xuất PDF lại.">
                  <RefreshCw className="w-3.5 h-3.5" /><span>Sửa lỗi {exportAsk.fixable} trang</span>
                </button>
              )}
              <button onClick={() => { exportAsk.resolve('export'); setExportAsk(null); }} className={`${iconBtn} bg-emerald-600 text-white hover:bg-emerald-700`}>
                <Download className="w-3.5 h-3.5" /><span>Vẫn xuất {exportAsk.count} trang</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* v10.6: Bảng thống kê lượt gọi AI (nổi) */}
      {showStats && (
        <div className="absolute top-2 right-3 z-30 w-[420px] max-w-[calc(100%-1.5rem)] bg-white rounded-xl shadow-xl border border-slate-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">Thống kê lượt gọi AI (phiên này)</span>
            <button onClick={() => setShowStats(false)} aria-label="Đóng" title="Đóng" className="p-1 rounded hover:bg-slate-100 text-slate-400"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="text-[11px] text-slate-600 leading-relaxed">
            {stats.total.requests} lượt gọi · {stats.total.errors} lỗi/thử lại · vào {stats.total.tin.toLocaleString('vi-VN')} · ra {stats.total.tout.toLocaleString('vi-VN')}
            {' '}· suy nghĩ {stats.total.treason.toLocaleString('vi-VN')} token · {stats.total.truncated} lần bị cắt cụt
          </div>
          <div className="max-h-56 overflow-auto border border-slate-100 rounded-lg">
            <table className="w-full text-[11px] text-slate-600">
              <thead className="bg-slate-50 sticky top-0">
                <tr>{['Trang', 'Lượt', 'Lỗi', 'Vào', 'Ra', 'Suy nghĩ', 'Giây'].map(h => <th key={h} className="px-1.5 py-1 text-right first:text-left font-semibold">{h}</th>)}</tr>
              </thead>
              <tbody>
                {stats.pages.map(r => (
                  <tr key={String(r.page)} className="border-t border-slate-100">
                    <td className="px-1.5 py-0.5">{r.page}</td>
                    <td className="px-1.5 py-0.5 text-right">{r.requests}</td>
                    <td className={`px-1.5 py-0.5 text-right ${r.errors ? 'text-amber-600 font-semibold' : ''}`}>{r.errors}</td>
                    <td className="px-1.5 py-0.5 text-right">{r.tin}</td>
                    <td className="px-1.5 py-0.5 text-right">{r.tout}</td>
                    <td className={`px-1.5 py-0.5 text-right ${r.treason ? 'text-rose-600 font-semibold' : ''}`}>{r.treason}</td>
                    <td className="px-1.5 py-0.5 text-right">{(r.ms / 1000).toFixed(1)}</td>
                  </tr>
                ))}
                {!stats.pages.length && <tr><td colSpan={7} className="px-2 py-3 text-center text-slate-400">Chưa có lượt gọi nào theo trang.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex gap-1.5 justify-end">
            <button onClick={() => { clearAiTelemetry(); setStatsTick(x => x + 1); }} className={`${iconBtn} border border-slate-200 text-slate-600 hover:bg-slate-50`}>Xoá số liệu</button>
            <button onClick={() => saveAs(new Blob([aiTelemetryCsv()], { type: 'text/csv;charset=utf-8' }), `MediTrans_thong-ke-AI_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`)}
              disabled={!stats.total.requests}
              className={`${iconBtn} bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50`}>
              <Download className="w-3.5 h-3.5" /><span>Xuất CSV</span>
            </button>
          </div>
          <div className="text-[10px] text-slate-400">Giây = tổng thời gian các lượt gọi (các lượt chạy song song nên lớn hơn thời gian chờ thực tế). Chỉ tính lượt gọi qua ShopAIKey / key hệ thống.</div>
        </div>
      )}

      {/* Ô nhập khoảng trang (nổi) */}
      {showRange && !running && (
        <div className="absolute top-2 right-3 z-30 w-[300px] max-w-[calc(100%-1.5rem)] bg-white rounded-xl shadow-xl border border-slate-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">Dịch / xuất nhiều trang</span>
            <button onClick={() => setShowRange(false)} aria-label="Đóng" title="Đóng" className="p-1 rounded hover:bg-slate-100 text-slate-400"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="flex gap-1.5">
            <input value={rangeInput} onChange={e => setRangeInput(e.target.value)} autoFocus
              onKeyDown={e => { if (e.key === 'Enter') handleRunRange(); }}
              placeholder={`VD: 1-5, 8 (1–${numPages})`}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <button onClick={() => setRangeInput(`1-${numPages}`)} className={`${iconBtn} border border-slate-200 text-slate-600 hover:bg-slate-50`}>Tất cả</button>
          </div>
          <button onClick={handleRunRange} className={`${iconBtn} w-full bg-indigo-600 text-white hover:bg-indigo-700`}>
            <Play className="w-3.5 h-3.5" /> Dịch các trang này
          </button>
          <p className="text-[10px] text-slate-400 leading-snug">Trang đã dịch (kể cả trên máy khác) được dựng lại, không tốn token. Nút PDF sẽ xuất theo khoảng này; để trống = tất cả trang đã dịch.</p>
        </div>
      )}

      {/* Cảnh báo trang (nổi) */}
      <div className="absolute top-2 left-3 z-20 max-w-[min(420px,calc(100%-1.5rem))] flex flex-col gap-2 pointer-events-none">
        {notice && noticeHidden !== currentPage && (
          <div className={`pointer-events-auto flex items-start gap-2 px-3 py-2 rounded-xl shadow-md text-[11px] border ${notice.tone === 'error' ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-amber-50 text-amber-800 border-amber-100'}`}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="flex-1">{notice.text}</span>
            <button onClick={() => setNoticeHidden(currentPage)} aria-label="Ẩn thông báo" title="Ẩn thông báo" className="opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
          </div>
        )}
        {/* v10.4: bản dịch lệch số liệu so với bản gốc → duyệt */}
        {numericHere > 0 && current && !running && (
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-xl shadow-md text-[11px] border bg-rose-50 text-rose-800 border-rose-100">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">{numericHere} khối có số liệu / đơn vị / dấu khác bản gốc, cần duyệt</span>
            <button onClick={() => openEditor(true)} className={`${iconBtn} h-6 px-2 bg-rose-600 text-white hover:bg-rose-700`} title="Mở bảng sửa, chỉ hiện các khối lệch số liệu (không tốn token)">
              Xem &amp; sửa
            </button>
          </div>
        )}
        {/* v10.3: khối chưa có bản dịch (dựng lại không tốn token) → nút Dịch bù */}
        {missingHere > 0 && current && !running && (
          <div className="pointer-events-auto flex items-center gap-2 px-3 py-2 rounded-xl shadow-md text-[11px] border bg-sky-50 text-sky-800 border-sky-100">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            <span className="flex-1">{missingHere} khối chưa có bản dịch</span>
            <button onClick={handleFillMissing} disabled={fillingPage !== null || !translator}
              className={`${iconBtn} h-6 px-2 bg-sky-600 text-white hover:bg-sky-700`} title="Gọi AI dịch các khối còn thiếu (tốn token)">
              {fillingPage === currentPage ? <Loader2 className="w-3 h-3 animate-spin" /> : null}Dịch bù
            </button>
          </div>
        )}
      </div>

      {/* Bảng sửa bản dịch */}
      {editor && (
        <div className="absolute inset-0 z-40 bg-slate-900/30 flex items-stretch justify-end" onClick={() => !savingEdit && setEditor(null)}>
          <div className="w-full max-w-[640px] h-full bg-white shadow-2xl flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <PencilLine className="w-4 h-4 text-indigo-600" />
              <span className="text-sm font-bold text-slate-800 flex-1">
                Sửa bản dịch trang {editor.page}{editor.ocr.length ? ' (có OCR)' : ''}
              </span>
              <button onClick={() => setEditor(null)} disabled={savingEdit} aria-label="Đóng bảng sửa" title="Đóng" className="p-1 rounded hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
            </div>
            <div className="px-4 py-2 border-b border-slate-100 space-y-1.5">
              <input value={editor.filter} onChange={e => setEditor(ed => ed && { ...ed, filter: e.target.value })}
                placeholder="Tìm trong câu gốc hoặc bản dịch…"
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <p className="text-[10px] text-slate-400 leading-snug">
                Sửa trực tiếp từng khối rồi bấm Lưu: trang được vẽ lại ngay, không tốn token. Giữ nguyên các thẻ như &lt;1&gt;…&lt;/1&gt; (đánh dấu chữ in đậm/màu).
              </p>
            </div>
            <div className="flex-1 min-h-0 overflow-auto px-4 py-3 space-y-3">
              {editor.items.map((p, i) => {
                const src = p.s.replace(/<\/?\d+>/g, '');
                const f = editor.filter.trim().toLowerCase();
                if (f && !src.toLowerCase().includes(f) && !p.v.toLowerCase().includes(f)) return null;
                const flagged = editor.issues?.[p.s];
                if (editor.onlyNumeric && !flagged) return null;
                // Đối chiếu lại ngay khi sửa (đoạn vắt cột được kiểm tra trên cả đoạn khi vẽ lại)
                const live = flagged ? checkNumeric(p.s, p.v) : null;
                return (
                  <div key={i} className={`rounded-xl border p-2.5 ${flagged ? (live ? 'border-rose-200 bg-rose-50/40' : 'border-emerald-200 bg-emerald-50/40') : 'border-slate-200 bg-slate-50/50'}`}>
                    <p className="text-[11px] text-slate-500 leading-snug mb-1.5 select-text">{src}</p>
                    {flagged && (
                      <p className={`text-[11px] leading-snug mb-1.5 ${live ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {live ? (/Đã dịch lại/.test(flagged) ? flagged : describeNumericIssue(live)) : 'Số liệu đã khớp bản gốc.'}
                      </p>
                    )}
                    <textarea value={p.v} rows={Math.min(8, Math.max(2, Math.ceil(p.v.length / 70)))}
                      onChange={e => {
                        const v = e.target.value;
                        setEditor(ed => ed && { ...ed, items: ed.items.map((x, k) => (k === i ? { ...x, v } : x)) });
                      }}
                      className="w-full text-[13px] leading-snug px-2 py-1.5 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y" />
                  </div>
                );
              })}
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2">
              <span className="text-[11px] text-slate-400 flex-1">
                {editor.items.length} khối chữ
                {editor.issues && Object.keys(editor.issues).length > 0 && (
                  <button onClick={() => setEditor(ed => ed && { ...ed, onlyNumeric: !ed.onlyNumeric })} className="ml-2 underline text-rose-600">
                    {editor.onlyNumeric ? 'Hiện tất cả' : `Chỉ khối lệch số liệu (${Object.keys(editor.issues).length})`}
                  </button>
                )}
              </span>
              <button onClick={() => setEditor(null)} disabled={savingEdit} className={`${iconBtn} h-8 px-3 border border-slate-200 text-slate-600 hover:bg-slate-50`}>Huỷ</button>
              <button onClick={saveEditor} disabled={savingEdit} className={`${iconBtn} h-8 px-3 bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm`}>
                {savingEdit ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Lưu & vẽ lại
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Vùng xem: cùng bố cục với trình xem PDF bên trái */}
      <div ref={scrollRef}
        className={`flex-1 min-h-0 overflow-auto bg-slate-100 ${fullScreen ? 'p-0' : 'p-4 md:p-8'}`}>
        <div className="inline-block min-w-full text-center align-top">
          <div className={`inline-block text-left relative shadow-2xl bg-white overflow-hidden shrink-0 ${fullScreen ? 'my-0' : 'my-8 rounded-lg border border-slate-200'}`}
            style={frameStyle}>
            {currentUrl ? (
              <img src={currentUrl} alt={`Bản dịch giữ định dạng trang ${currentPage}`} draggable={false}
                onContextMenu={e => e.preventDefault()}
                className="block w-full h-full select-none" />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-center text-slate-400 gap-3 p-6">
                {busyHere || ((loadingCache || cloudLoading) && !current) ? (
                  <>
                    <Loader2 className="w-9 h-9 animate-spin text-indigo-400" />
                    <p className="text-sm">
                      {rebuilding === currentPage
                        ? `Đang dựng lại trang ${currentPage} từ bản dịch đã lưu…`
                        : busyHere ? `Đang dịch giữ định dạng trang ${currentPage}…` : 'Đang tải…'}
                    </p>
                  </>
                ) : (
                  <>
                    <LayoutTemplate className="w-11 h-11 opacity-20" />
                    <p className="text-sm font-medium">Trang {currentPage} chưa có bản dịch giữ định dạng.</p>
                    <p className="text-xs max-w-xs">Bản dịch được vẽ lại trên chính bố cục trang gốc và có thể xuất thành PDF.</p>
                    <button onClick={() => runPages([currentPage])} disabled={running}
                      className={`${iconBtn} h-9 px-4 text-xs bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm mt-1`}>
                      <Play className="w-4 h-4" /> Dịch trang này
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LayoutTranslatePanel;
