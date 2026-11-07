import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { saveAs } from 'file-saver';
import {
  LayoutTemplate, Play, Square, Download, RefreshCw, AlertTriangle, Loader2, Layers,
  ImageDown, Cloud, HardDrive, Repeat, X,
} from 'lucide-react';
import {
  LayoutBlockTranslator,
  LayoutPageResult,
  LayoutPair,
  renderPageFromPairs,
  deleteLayoutPages,
  exportLayoutPdf,
  loadLayoutPages,
  parsePageRange,
  saveLayoutPage,
  translatePageWithLayout,
} from '../services/layoutTranslationService';
import { LayoutCloudTarget, loadCloudLayoutPages, saveCloudLayoutPage } from '../services/layoutCloudService';

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
}

function friendlyError(err: any): string {
  const msg = String(err?.message || err || '');
  if (/level 2/i.test(msg)) return 'Tài khoản chưa đủ Level 2 để dùng Key hệ thống.';
  if (/api key|key khả dụng/i.test(msg)) return 'Không có API Key khả dụng. Kiểm tra lại Key trong Cài đặt.';
  if (/429|quota|resource_exhausted/i.test(msg)) return 'Key đang hết hạn mức (429). Thử lại sau ít phút.';
  if (/json|hợp lệ/i.test(msg)) return 'AI trả về dữ liệu không đúng định dạng. Hãy bấm "Dịch lại".';
  return msg.slice(0, 160) || 'Lỗi không xác định';
}

const iconBtn = 'inline-flex items-center justify-center gap-1 h-7 px-2 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all disabled:opacity-40 disabled:cursor-not-allowed';

export const LayoutTranslatePanel: React.FC<LayoutTranslatePanelProps> = ({
  pdfDoc, numPages, currentPage, docKey, fileName, translator, showToast, cloud,
  toolbarTarget, pageBox, syncScrollEl, fullScreen,
}) => {
  const [results, setResults] = useState<Record<number, LayoutPageResult>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [rangeInput, setRangeInput] = useState('');
  const [showRange, setShowRange] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; page: number | null }>({ done: 0, total: 0, page: null });
  const [exporting, setExporting] = useState(false);
  const [loadingCache, setLoadingCache] = useState(true);
  const [autoFollow, setAutoFollow] = useState(false);
  const [cloudPairs, setCloudPairs] = useState<Record<number, LayoutPair[]>>({});
  const [cloudLoading, setCloudLoading] = useState(!!cloud);
  const [rebuilding, setRebuilding] = useState<number | null>(null);
  const [noticeHidden, setNoticeHidden] = useState<number | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const cloudPairsRef = useRef(cloudPairs);
  cloudPairsRef.current = cloudPairs;
  const urlCache = useRef<Map<number, { blob: Blob; url: string }>>(new Map());
  const scrollRef = useRef<HTMLDivElement>(null);
  const cloudKey = cloud ? `${cloud.ownerId}/${cloud.fileId}/${cloud.canWrite}` : '';

  const urlFor = useCallback((r?: LayoutPageResult) => {
    if (!r) return null;
    const hit = urlCache.current.get(r.pageNumber);
    if (hit && hit.blob === r.blob) return hit.url;
    if (hit) URL.revokeObjectURL(hit.url);
    const url = URL.createObjectURL(r.blob);
    urlCache.current.set(r.pageNumber, { blob: r.blob, url });
    return url;
  }, []);

  useEffect(() => {
    const cache = urlCache.current;
    return () => {
      abortRef.current?.abort();
      cache.forEach(v => URL.revokeObjectURL(v.url));
    };
  }, []);

  /* -------- đệm trên máy -------- */
  useEffect(() => {
    let alive = true;
    setLoadingCache(true);
    loadLayoutPages(docKey, numPages).then(cached => {
      if (!alive) return;
      setResults(cached);
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
      .then(pairs => { if (alive) setCloudPairs(pairs); })
      .catch(e => console.warn('[Layout] Không tải được bản dịch đã lưu trên đám mây:', e))
      .finally(() => { if (alive) setCloudLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudKey]);

  const pushToCloud = useCallback(async (page: number, pairs?: LayoutPair[]) => {
    if (!cloud?.canWrite || !pairs?.length) return;
    try {
      await saveCloudLayoutPage(cloud, page, pairs);
      setCloudPairs(prev => ({ ...prev, [page]: pairs }));
    } catch (e) {
      console.warn(`[Layout] Không lưu được trang ${page} lên đám mây:`, e);
    }
  }, [cloud]);

  useEffect(() => {
    if (loadingCache || cloudLoading || !cloud?.canWrite) return;
    Object.values(resultsRef.current).forEach(r => {
      if (r.pairs?.length && !cloudPairsRef.current[r.pageNumber]) pushToCloud(r.pageNumber, r.pairs);
    });
  }, [loadingCache, cloudLoading, cloud, pushToCloud]);

  const rebuildFromCloud = useCallback(async (page: number): Promise<LayoutPageResult | null> => {
    const pairs = cloudPairsRef.current[page];
    if (!pairs?.length) return null;
    const res = await renderPageFromPairs(pdfDoc, page, pairs);
    await saveLayoutPage(docKey, res);
    setResults(prev => ({ ...prev, [page]: res }));
    return res;
  }, [pdfDoc, docKey]);

  useEffect(() => {
    if (loadingCache || cloudLoading || running || rebuilding !== null) return;
    if (resultsRef.current[currentPage] || !cloudPairs[currentPage]) return;
    setRebuilding(currentPage);
    rebuildFromCloud(currentPage)
      .catch(e => console.warn('[Layout] Dựng lại trang thất bại:', e))
      .finally(() => setRebuilding(null));
  }, [currentPage, cloudPairs, loadingCache, cloudLoading, running, rebuilding, rebuildFromCloud]);

  /* -------- dịch -------- */
  const runPages = useCallback(async (pages: number[], force = false) => {
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
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setShowRange(false);

    let ok = 0;
    for (let i = 0; i < todo.length; i++) {
      const p = todo[i];
      if (controller.signal.aborted) break;
      setProgress({ done: i, total: todo.length, page: p });
      setErrors(prev => { const n = { ...prev }; delete n[p]; return n; });
      try {
        if (!force && cloudPairsRef.current[p]?.length) {
          await rebuildFromCloud(p);
          ok++;
          continue;
        }
        const res = await translatePageWithLayout(pdfDoc, p, translator, controller.signal);
        await saveLayoutPage(docKey, res);
        setResults(prev => ({ ...prev, [p]: res }));
        pushToCloud(p, res.pairs);
        ok++;
      } catch (err: any) {
        if (controller.signal.aborted || /aborted/i.test(String(err?.message))) break;
        console.error(`[Layout] Lỗi dịch trang ${p}:`, err);
        setErrors(prev => ({ ...prev, [p]: friendlyError(err) }));
        if (/level 2|api key|key khả dụng/i.test(String(err?.message))) break;
      }
    }
    setProgress({ done: 0, total: 0, page: null });
    setRunning(false);
    abortRef.current = null;
    if (controller.signal.aborted) showToast(`Đã dừng. Hoàn thành ${ok} trang.`, 'info');
    else if (todo.length > 1 && ok > 0) showToast(`Đã dịch giữ định dạng ${ok} trang.`, 'success');
  }, [translator, pdfDoc, docKey, showToast, rebuildFromCloud, pushToCloud]);

  useEffect(() => {
    if (!autoFollow || loadingCache || running) return;
    if (resultsRef.current[currentPage] || cloudPairsRef.current[currentPage] || errors[currentPage]) return;
    const t = setTimeout(() => runPages([currentPage]), 600);
    return () => clearTimeout(t);
  }, [autoFollow, currentPage, loadingCache, running, errors, runPages]);

  const handleRunRange = () => {
    const pages = parsePageRange(rangeInput, numPages);
    if (pages.length === 0) {
      showToast(`Khoảng trang không hợp lệ. Ví dụ: 1-3, 5 (tối đa ${numPages}).`, 'error');
      return;
    }
    runPages(pages);
  };

  const handleRetranslate = async () => {
    await deleteLayoutPages(docKey, [currentPage]);
    setResults(prev => { const n = { ...prev }; delete n[currentPage]; return n; });
    runPages([currentPage], true);
  };

  /* -------- xuất -------- */
  const baseName = useMemo(() => (fileName || 'tai-lieu').replace(/\.pdf$/i, ''), [fileName]);

  const handleExport = async () => {
    const allDone = Array.from(new Set([...Object.keys(results), ...Object.keys(cloudPairs)].map(Number))).sort((a, b) => a - b);
    const wanted = rangeInput.trim() ? parsePageRange(rangeInput, numPages).filter(p => allDone.includes(p)) : allDone;
    if (wanted.length === 0) {
      showToast('Chưa có trang nào được dịch để xuất.', 'error');
      return;
    }
    setExporting(true);
    try {
      const pages: LayoutPageResult[] = [];
      for (const p of wanted) {
        const r = resultsRef.current[p] || (await rebuildFromCloud(p));
        if (r && !r.scanned) pages.push(r);
      }
      if (pages.length === 0) throw new Error('Không có trang hợp lệ để xuất.');
      const blob = await exportLayoutPdf(pages);
      saveAs(blob, `${baseName}_ban-dich-giu-dinh-dang.pdf`);
      showToast(`Đã xuất PDF ${pages.length} trang.`, 'success');
    } catch (e: any) {
      showToast(`Lỗi xuất PDF: ${e?.message || e}`, 'error');
    } finally {
      setExporting(false);
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
  const busyHere = (running && progress.page === currentPage) || rebuilding === currentPage;
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
    : current?.scanned
      ? { tone: 'warn', text: 'Trang scan (không có lớp chữ): hãy dùng tab "Dịch" cho trang này.' }
      : current && current.overflowCount > 0
        ? { tone: 'warn', text: `${current.overflowCount} khối chữ quá chật, có thể lấn khung. Nên xem lại.` }
        : null;

  const storageTitle = cloud?.canWrite
    ? 'Bản dịch được lưu lên đám mây theo tài liệu (mở trên máy khác vẫn còn)'
    : cloud ? 'Bạn chỉ có quyền xem: bản dịch mới chỉ lưu trên máy này' : 'File chưa lưu lên tài khoản: bản dịch chỉ lưu trên máy này';

  const toolbar = (
    <div className="flex items-center gap-1 min-w-0">
      {running ? (
        <button onClick={() => abortRef.current?.abort()} className={`${iconBtn} bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-100`} title="Dừng dịch">
          <Square className="w-3 h-3 fill-current" />
          <span>{progress.total > 1 ? `${progress.done + 1}/${progress.total}` : 'Dừng'}</span>
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
      {current && !running && (
        <button onClick={handleRetranslate} className={`${iconBtn} border border-slate-200 text-slate-600 hover:bg-slate-50`} title="Dịch lại trang này">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      )}
      <button onClick={() => setAutoFollow(v => !v)}
        className={`${iconBtn} border ${autoFollow ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-400 hover:text-slate-600'}`}
        title={autoFollow ? 'Đang bật: tự dịch trang khi lật trang (tốn thêm token)' : 'Tự dịch khi lật trang (đang tắt)'}>
        <Repeat className="w-3.5 h-3.5" /><span className="hidden 2xl:inline">Tự dịch</span>
      </button>
      <span className={`inline-flex items-center h-7 px-1 ${cloud?.canWrite ? 'text-emerald-600' : 'text-slate-400'}`} title={storageTitle}>
        {cloud?.canWrite ? <Cloud className="w-3.5 h-3.5" /> : <HardDrive className="w-3.5 h-3.5" />}
      </span>
      <div className="w-px h-4 bg-slate-200 mx-0.5" />
      {current && (
        <button onClick={() => saveAs(current.blob, `${baseName}_trang-${currentPage}_ban-dich.jpg`)}
          className={`${iconBtn} border border-slate-200 text-slate-600 hover:bg-slate-50`} title="Tải ảnh trang này">
          <ImageDown className="w-3.5 h-3.5" />
        </button>
      )}
      <button onClick={handleExport} disabled={exporting || running || translatedCount === 0}
        className={`${iconBtn} bg-emerald-600 text-white hover:bg-emerald-700 shadow-sm`}
        title={rangeInput.trim() ? 'Xuất PDF các trang đã dịch trong khoảng đã nhập' : 'Xuất PDF tất cả trang đã dịch'}>
        {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
        <span>PDF ({translatedCount})</span>
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

      {/* Ô nhập khoảng trang (nổi) */}
      {showRange && !running && (
        <div className="absolute top-2 right-3 z-30 w-[300px] max-w-[calc(100%-1.5rem)] bg-white rounded-xl shadow-xl border border-slate-200 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-700">Dịch / xuất nhiều trang</span>
            <button onClick={() => setShowRange(false)} className="p-1 rounded hover:bg-slate-100 text-slate-400"><X className="w-3.5 h-3.5" /></button>
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
      {notice && noticeHidden !== currentPage && (
        <div className={`absolute top-2 left-3 z-20 max-w-[min(420px,calc(100%-1.5rem))] flex items-start gap-2 px-3 py-2 rounded-xl shadow-md text-[11px] border ${notice.tone === 'error' ? 'bg-rose-50 text-rose-700 border-rose-100' : 'bg-amber-50 text-amber-800 border-amber-100'}`}>
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span className="flex-1">{notice.text}</span>
          <button onClick={() => setNoticeHidden(currentPage)} className="opacity-60 hover:opacity-100"><X className="w-3 h-3" /></button>
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
