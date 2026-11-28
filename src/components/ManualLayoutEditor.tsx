/**
 * v11.5: Chỉnh tay bố cục trang dịch giữ định dạng.
 *
 * - Kéo để di chuyển khối, kéo góc để đổi cỡ khung.
 * - Đổi chữ (xuống dòng bằng Enter), cỡ chữ, giãn dòng, căn lề, đậm / nghiêng, kiểu chữ, màu, tô nền.
 * - Gộp nhiều khối thành một, tách một khối tại con trỏ, ẩn khối, thêm khung chữ mới, xoá vùng chữ sót.
 *
 * Mọi chỉnh sửa lưu thành dữ liệu nhỏ (toạ độ theo tỉ lệ trang) đi kèm bản dịch của trang (máy + đám mây) và được áp lại
 * mỗi lần dựng trang — không gọi AI, không tốn token. Ảnh xem trước được vẽ bằng đúng bộ máy dàn trang.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Eraser, Italic, Loader2, Merge, MousePointer2,
  RotateCcw, Save, Scissors, SquarePlus, Trash2, Undo2, X, EyeOff, ZoomIn, ZoomOut,
} from 'lucide-react';
import {
  LayoutPair,
  ManualBoxStore,
  ManualStore,
  PageEditModel,
  emptyManual,
  parseManual,
  renderPageFromPairs,
  withManual,
} from '../services/layoutTranslationService';

type Sel = { kind: 'block'; key: string } | { kind: 'extra'; idx: number } | { kind: 'erase'; idx: number } | null;
type Mode = 'select' | 'add' | 'erase';
type Align = 'left' | 'center' | 'right' | 'justify';

interface Props {
  pdfDoc: PDFDocumentProxy;
  page: number;
  pairs: LayoutPair[];
  widthPt: number;
  onClose: () => void;
  /** Lưu: nhận danh sách cặp câu mới (đã gắn dữ liệu chỉnh tay). */
  onSave: (pairs: LayoutPair[]) => Promise<void>;
}

const clone = (m: ManualStore): ManualStore => JSON.parse(JSON.stringify(m));
const r4 = (v: number) => Math.round(v * 10000) / 10000;
const pairKeyOf = (key: string) => key.replace(/#\d+$/, '');

export const ManualLayoutEditor: React.FC<Props> = ({ pdfDoc, page, pairs: initialPairs, widthPt, onClose, onSave }) => {
  const [basePairs, setBasePairs] = useState<LayoutPair[]>(() => initialPairs.map(p => ({ ...p })));
  const [store, setStore] = useState<ManualStore>(() => parseManual(initialPairs) || emptyManual());
  const [history, setHistory] = useState<ManualStore[]>([]);
  const [model, setModel] = useState<PageEditModel | null>(null);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [sel, setSel] = useState<Sel>(null);
  const [multi, setMulti] = useState<string[]>([]);
  const [multiMode, setMultiMode] = useState(false);
  const [mode, setMode] = useState<Mode>('select');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showAll, setShowAll] = useState(true);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [dispW, setDispW] = useState(0);
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  const W = model?.W || 1, H = model?.H || 1;
  const scale = dispW / W;
  const ptPerPx = widthPt / W;

  /* ---------------- dựng ảnh xem trước bằng bộ máy dàn trang (không gọi AI) ---------------- */
  const seq = useRef(0);
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    const my = ++seq.current;
    const t = window.setTimeout(async () => {
      setRendering(true);
      try {
        const res = await renderPageFromPairs(pdfDoc, page, withManual(basePairs, store));
        if (my !== seq.current) return;
        if (res.edit) setModel(res.edit);
        const url = URL.createObjectURL(res.blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setImgUrl(url);
        setRenderError(null);
      } catch (e: any) {
        if (my === seq.current) setRenderError(String(e?.message || e));
      } finally {
        if (my === seq.current) setRendering(false);
      }
    }, model ? 450 : 0);
    return () => window.clearTimeout(t);
  }, [store, basePairs, pdfDoc, page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDispW(el.clientWidth));
    ro.observe(el);
    setDispW(el.clientWidth);
    return () => ro.disconnect();
  }, [imgUrl]);

  /* ---------------- tiện ích dữ liệu ---------------- */
  const blockByKey = useMemo(() => new Map((model?.blocks || []).map(b => [b.key, b])), [model]);
  const manualByKey = useMemo(() => new Map(store.boxes.map((b, i) => [b.k || '', i])), [store]);

  /** Khung hiện tại của một khối (px): khung chỉnh tay nếu có, không thì chỗ bộ máy đã đặt. */
  const autoBoxPx = useCallback((key: string) => {
    const b = blockByKey.get(key);
    if (!b) return null;
    if (b.placed) return { x0: b.placed.x0, top: b.placed.top, x1: b.placed.x0 + b.placed.width, bottom: b.placed.top + Math.max(b.placed.height, b.bottom - b.top), size: b.placed.size, lh: b.placed.lineRatio, al: b.placed.align as Align };
    return { x0: b.x0, top: b.top, x1: b.x1, bottom: b.bottom, size: b.size, lh: 1.18, al: b.align as Align };
  }, [blockByKey]);

  const boxPx = (s: { x0: number; y0: number; x1: number; y1: number }) => ({ x0: s.x0 * W, top: s.y0 * H, x1: s.x1 * W, bottom: s.y1 * H });

  const commit = (next: ManualStore, snapshot = true) => {
    if (snapshot) setHistory(h => [...h.slice(-40), clone(store)]);
    setStore(next);
    setDirty(true);
  };

  /** Bảo đảm khối đã có khung chỉnh tay (lần sửa đầu: chép vị trí / cỡ chữ bộ máy đã đặt). Trả về chỉ số trong boxes. */
  const ensureManual = (m: ManualStore, key: string): number => {
    const i = m.boxes.findIndex(b => b.k === key);
    if (i >= 0) return i;
    const a = autoBoxPx(key);
    const b = blockByKey.get(key);
    if (!a || !b) return -1;
    m.boxes.push({
      k: key, x0: r4(a.x0 / W), y0: r4(a.top / H), x1: r4(a.x1 / W), y1: r4(a.bottom / H),
      fs: r4(a.size / W), lh: +a.lh.toFixed(3), al: a.al, fit: true,
    });
    return m.boxes.length - 1;
  };

  const selected = useMemo((): { box: ManualBoxStore | null; text: string; src: string; auto: boolean } | null => {
    if (!sel) return null;
    if (sel.kind === 'block') {
      const b = blockByKey.get(sel.key);
      const i = manualByKey.get(sel.key);
      const box = i !== undefined ? store.boxes[i] : null;
      return { box, text: box?.t ?? b?.v ?? '', src: b?.src || '', auto: !box };
    }
    if (sel.kind === 'extra') { const e = store.extras[sel.idx]; return e ? { box: e, text: e.t || '', src: '', auto: false } : null; }
    return null;
  }, [sel, store, blockByKey, manualByKey]);

  /** Sửa thuộc tính khung đang chọn (tự tạo khung chỉnh tay nếu khối còn tự động). */
  const patch = (fn: (b: ManualBoxStore) => void, snapshot = true) => {
    if (!sel || sel.kind === 'erase') return;
    const m = clone(store);
    if (sel.kind === 'block') {
      const i = ensureManual(m, sel.key);
      if (i < 0) return;
      fn(m.boxes[i]);
    } else {
      const e = m.extras[sel.idx];
      if (!e) return;
      fn(e);
    }
    commit(m, snapshot);
  };

  const undo = () => {
    setHistory(h => {
      if (!h.length) return h;
      setStore(h[h.length - 1]);
      setDirty(true);
      return h.slice(0, -1);
    });
  };

  /* ---------------- kéo / đổi cỡ / vẽ khung ---------------- */
  type Drag = { kind: 'move' | 'resize'; corner?: string; sel: NonNullable<Sel>; sx: number; sy: number; start: { x0: number; y0: number; x1: number; y1: number }; base: ManualStore; moved: boolean }
    | { kind: 'create'; sx: number; sy: number };
  const drag = useRef<Drag | null>(null);
  const toPage = (e: { clientX: number; clientY: number }) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const startBoxDrag = (e: React.PointerEvent, s: NonNullable<Sel>, kind: 'move' | 'resize', corner?: string) => {
    if (mode !== 'select' && kind === 'move' && s.kind === 'block') return;
    e.stopPropagation();
    e.preventDefault();
    if (s.kind === 'block' && (multiMode || e.shiftKey)) {
      setMulti(ms => ms.includes(s.key) ? ms.filter(k => k !== s.key) : [...ms, s.key]);
      setSel(s);
      return;
    }
    setSel(s);
    setMulti([]);
    const m = clone(store);
    let st: { x0: number; y0: number; x1: number; y1: number } | null = null;
    if (s.kind === 'block') {
      const i = m.boxes.findIndex(b => b.k === s.key);
      if (i >= 0) st = m.boxes[i];
      else { const a = autoBoxPx(s.key); if (a) st = { x0: a.x0 / W, y0: a.top / H, x1: a.x1 / W, y1: a.bottom / H }; }
    } else if (s.kind === 'extra') st = m.extras[s.idx];
    else st = m.erase[s.idx];
    if (!st) return;
    const p = toPage(e);
    drag.current = { kind, corner, sel: s, sx: p.x, sy: p.y, start: { x0: st.x0, y0: st.y0, x1: st.x1, y1: st.y1 }, base: m, moved: false };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const startCreate = (e: React.PointerEvent) => {
    if (mode === 'select') { setSel(null); setMulti([]); return; }
    e.preventDefault();
    const p = toPage(e);
    drag.current = { kind: 'create', sx: p.x, sy: p.y };
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toPage(e);
    if (d.kind === 'create') { setDraft({ x0: Math.min(d.sx, p.x), y0: Math.min(d.sy, p.y), x1: Math.max(d.sx, p.x), y1: Math.max(d.sy, p.y) }); return; }
    const dx = (p.x - d.sx) / W, dy = (p.y - d.sy) / H;
    if (!d.moved && Math.abs(p.x - d.sx) < 2 && Math.abs(p.y - d.sy) < 2) return;
    if (!d.moved) { setHistory(h => [...h.slice(-40), clone(store)]); d.moved = true; }
    const m = clone(d.base);
    let target: { x0: number; y0: number; x1: number; y1: number } | undefined;
    if (d.sel.kind === 'block') { const i = ensureManual(m, d.sel.key); target = m.boxes[i]; }
    else if (d.sel.kind === 'extra') target = m.extras[d.sel.idx];
    else target = m.erase[d.sel.idx];
    if (!target) return;
    const s = d.start;
    const minW = 12 / W, minH = 8 / H;
    if (d.kind === 'move') {
      const w = s.x1 - s.x0, h = s.y1 - s.y0;
      target.x0 = r4(Math.max(0, Math.min(1 - w, s.x0 + dx))); target.x1 = r4(target.x0 + w);
      target.y0 = r4(Math.max(0, Math.min(1 - h, s.y0 + dy))); target.y1 = r4(target.y0 + h);
    } else {
      const c = d.corner || 'se';
      if (c.includes('w')) target.x0 = r4(Math.max(0, Math.min(s.x1 - minW, s.x0 + dx)));
      if (c.includes('e')) target.x1 = r4(Math.min(1, Math.max(s.x0 + minW, s.x1 + dx)));
      if (c.includes('n')) target.y0 = r4(Math.max(0, Math.min(s.y1 - minH, s.y0 + dy)));
      if (c.includes('s')) target.y1 = r4(Math.min(1, Math.max(s.y0 + minH, s.y1 + dy)));
    }
    setStore(m);
    setDirty(true);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.kind !== 'create' || !draft) { setDraft(null); return; }
    const r = draft;
    setDraft(null);
    if (r.x1 - r.x0 < 10 || r.y1 - r.y0 < 6) return;
    const m = clone(store);
    const fr = { x0: r4(r.x0 / W), y0: r4(r.y0 / H), x1: r4(r.x1 / W), y1: r4(r.y1 / H) };
    if (mode === 'erase') {
      m.erase.push(fr);
      commit(m);
      setSel({ kind: 'erase', idx: m.erase.length - 1 });
    } else {
      // cỡ chữ mặc định: cỡ thân bài phổ biến của trang
      const sizes = (model?.blocks || []).filter(b => b.src.length > 60).map(b => b.placed?.size || b.size).sort((a, b) => a - b);
      const size = sizes.length ? sizes[Math.floor(sizes.length / 2)] : 22;
      m.extras.push({ ...fr, fs: r4(size / W), lh: 1.18, al: 'left', t: '', fit: true, sf: true });
      commit(m);
      setSel({ kind: 'extra', idx: m.extras.length - 1 });
      setTimeout(() => textRef.current?.focus(), 50);
    }
    setMode('select');
  };

  /* ---------------- thao tác ---------------- */
  const setText = (t: string) => patch(b => { b.t = t; }, false);
  const textFocusSnapshot = () => setHistory(h => [...h.slice(-40), clone(store)]);

  const resetSelected = () => {
    if (!sel) return;
    const m = clone(store);
    if (sel.kind === 'block') m.boxes = m.boxes.filter(b => b.k !== sel.key);
    else if (sel.kind === 'extra') m.extras.splice(sel.idx, 1);
    else m.erase.splice(sel.idx, 1);
    commit(m);
    if (sel.kind !== 'block') setSel(null);
  };

  const mergeSelected = () => {
    const keys = multi.filter(k => blockByKey.has(k));
    if (keys.length < 2) return;
    const m = clone(store);
    const items = keys.map(k => {
      const i = ensureManual(m, k);
      return { k, box: m.boxes[i], b: blockByKey.get(k)! };
    }).sort((a, c) => a.box.y0 - c.box.y0 || a.box.x0 - c.box.x0);
    const first = items[0].box;
    first.x0 = Math.min(...items.map(i => i.box.x0)); first.y0 = Math.min(...items.map(i => i.box.y0));
    first.x1 = Math.max(...items.map(i => i.box.x1)); first.y1 = Math.max(...items.map(i => i.box.y1));
    first.t = items.map(i => (i.box.t ?? i.b.v).trim()).filter(Boolean).join(' ');
    first.hide = false;
    for (const it of items.slice(1)) it.box.hide = true;
    commit(m);
    setMulti([]);
    setMultiMode(false);
    setSel({ kind: 'block', key: items[0].k });
  };

  const splitAtCursor = () => {
    if (!selected || !sel || sel.kind === 'erase') return;
    const ta = textRef.current;
    const pos = ta ? ta.selectionStart : -1;
    const text = selected.text;
    if (pos <= 0 || pos >= text.length) return;
    const before = text.slice(0, pos).trimEnd(), after = text.slice(pos).trimStart();
    const m = clone(store);
    let box: ManualBoxStore | undefined;
    if (sel.kind === 'block') { const i = ensureManual(m, sel.key); box = m.boxes[i]; }
    else box = m.extras[sel.idx];
    if (!box) return;
    box.t = before;
    const h = box.y1 - box.y0;
    const gap = 0.004;
    const nb: ManualBoxStore = { ...box, k: undefined, t: after, hide: false, y0: r4(Math.min(1 - h, box.y1 + gap)), y1: r4(Math.min(1, box.y1 + gap + h)) };
    delete nb.k;
    m.extras.push(nb);
    commit(m);
    setSel({ kind: 'extra', idx: m.extras.length - 1 });
  };

  const resetAll = () => {
    if (!store.boxes.length && !store.extras.length && !store.erase.length) return;
    commit(emptyManual());
    setSel(null);
  };

  const nudge = useCallback((dx: number, dy: number) => {
    if (!sel) return;
    const m = clone(store);
    let t: { x0: number; y0: number; x1: number; y1: number } | undefined;
    if (sel.kind === 'block') { const i = ensureManual(m, sel.key); t = m.boxes[i]; }
    else if (sel.kind === 'extra') t = m.extras[sel.idx];
    else t = m.erase[sel.idx];
    if (!t) return;
    const fx = dx / W, fy = dy / H;
    t.x0 = r4(t.x0 + fx); t.x1 = r4(t.x1 + fx); t.y0 = r4(t.y0 + fy); t.y1 = r4(t.y1 + fy);
    commit(m);
  }, [sel, store, W, H]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
      const step = e.shiftKey ? 10 : 2;
      if (e.key === 'ArrowLeft') { nudge(-step, 0); e.preventDefault(); }
      else if (e.key === 'ArrowRight') { nudge(step, 0); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { nudge(0, -step); e.preventDefault(); }
      else if (e.key === 'ArrowDown') { nudge(0, step); e.preventDefault(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); }
      else if (e.key === 'Escape') { setSel(null); setMulti([]); setMode('select'); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nudge]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    setSaving(true);
    try {
      // chữ đã sửa trong khung chỉnh tay → cập nhật luôn bản dịch của khối (xuất chữ, bộ nhớ dịch, kiểm duyệt dùng bản mới)
      let pairs = basePairs.map(p => ({ ...p }));
      for (const b of store.boxes) {
        if (b.t === undefined || !b.k || !/#0$/.test(b.k)) continue;
        const s = pairKeyOf(b.k);
        const same = pairs.filter(p => p.s === s);
        if (same.length === 1 && b.t.trim()) same[0].v = b.t.replace(/\s*\n\s*/g, ' ').trim();
      }
      pairs = withManual(pairs, store);
      await onSave(pairs);
      setDirty(false);
      setBasePairs(pairs);
    } catch {
      /* lỗi đã được báo ở khung dịch */
    } finally {
      setSaving(false);
    }
  };

  // window.confirm bị chặn trong khung nhúng / một số trình duyệt → hỏi ngay trên nút
  const [confirmClose, setConfirmClose] = useState(false);
  const close = () => {
    if (dirty && !confirmClose) { setConfirmClose(true); window.setTimeout(() => setConfirmClose(false), 4000); return; }
    onClose();
  };

  /* ---------------- hiển thị ---------------- */
  const overflow = new Set(model?.overflow || []);
  const blocks = (model?.blocks || []).filter(b => b.editable);
  const selBoxStore = selected?.box || null;
  const curSizePx = selBoxStore?.fs ? selBoxStore.fs * W : (sel?.kind === 'block' ? autoBoxPx(sel.key)?.size : undefined) || 20;
  const curLh = selBoxStore?.lh ?? (sel?.kind === 'block' ? autoBoxPx(sel.key)?.lh : undefined) ?? 1.18;
  const curAlign: Align = (selBoxStore?.al ?? (sel?.kind === 'block' ? autoBoxPx(sel.key)?.al : undefined) ?? 'left') as Align;
  const selBlock = sel?.kind === 'block' ? blockByKey.get(sel.key) : undefined;
  const curBold = selBoxStore?.b ?? selBlock?.bold ?? false;
  const curItalic = selBoxStore?.i ?? selBlock?.italic ?? false;
  const curSerif = selBoxStore?.sf ?? selBlock?.serif ?? true;
  const curColor = selBoxStore?.c ?? selBlock?.color ?? '#1a1a1a';

  const handle = (s: NonNullable<Sel>, c: string) => (
    <div
      key={c}
      onPointerDown={e => startBoxDrag(e, s, 'resize', c)}
      className="absolute w-3 h-3 bg-white border-2 border-indigo-600 rounded-sm [touch-action:none]"
      style={{
        left: c.includes('w') ? -6 : c.includes('e') ? undefined : 'calc(50% - 6px)', right: c.includes('e') ? -6 : undefined,
        top: c.includes('n') ? -6 : c.includes('s') ? undefined : 'calc(50% - 6px)', bottom: c.includes('s') ? -6 : undefined,
        cursor: `${c}-resize`,
      }}
    />
  );
  const corners = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

  const renderBox = (key: string, r: { x0: number; top: number; x1: number; bottom: number }, s: NonNullable<Sel>, kind: 'auto' | 'manual' | 'extra' | 'erase', extra?: { hidden?: boolean; over?: boolean; title?: string }) => {
    const isSel = sel && JSON.stringify(sel) === JSON.stringify(s);
    const inMulti = s.kind === 'block' && multi.includes(s.key);
    const color = kind === 'erase' ? 'border-rose-500 bg-rose-500/15' : extra?.over ? 'border-amber-500 bg-amber-400/10'
      : kind === 'auto' ? 'border-sky-400/60 border-dashed hover:bg-sky-400/10' : 'border-indigo-600 bg-indigo-500/5';
    if (kind === 'auto' && !showAll && !isSel && !inMulti) return null;
    return (
      <div
        key={key}
        title={extra?.title}
        onPointerDown={e => startBoxDrag(e, s, 'move')}
        className={`absolute border ${color} ${isSel ? 'ring-2 ring-indigo-500 z-20' : 'z-10'} ${inMulti ? 'ring-2 ring-emerald-500 bg-emerald-400/15' : ''} ${extra?.hidden ? 'opacity-50 bg-slate-500/20' : ''} cursor-move [touch-action:none]`}
        style={{ left: r.x0 * scale, top: r.top * scale, width: Math.max(4, (r.x1 - r.x0) * scale), height: Math.max(4, (r.bottom - r.top) * scale) }}
      >
        {isSel && !inMulti && corners.map(c => handle(s, c))}
        {extra?.hidden && <EyeOff className="w-3 h-3 text-slate-600 absolute top-0.5 left-0.5" />}
      </div>
    );
  };

  const btn = 'inline-flex items-center justify-center gap-1 h-8 px-2 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all disabled:opacity-40 disabled:cursor-not-allowed';
  const tog = (on: boolean) => `${btn} w-8 px-0 border ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`;
  const manualCount = store.boxes.length + store.extras.length + store.erase.length;

  return createPortal(
    <div className="fixed inset-0 z-[200] bg-slate-900/60 flex flex-col" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {/* thanh công cụ */}
      <div className="bg-white border-b border-slate-200 px-2 py-1.5 flex items-center gap-1 flex-wrap">
        <span className="text-xs font-black text-slate-700 mr-1">Chỉnh bố cục trang {page}</span>
        <button onClick={() => setMode('select')} className={`${btn} border ${mode === 'select' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-600'}`} title="Chọn, kéo để di chuyển, kéo ô vuông ở góc để đổi cỡ khung"><MousePointer2 className="w-3.5 h-3.5" />Chọn</button>
        <button onClick={() => setMode('add')} className={`${btn} border ${mode === 'add' ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-slate-200 text-slate-600'}`} title="Kéo trên trang để thêm khung chữ mới"><SquarePlus className="w-3.5 h-3.5" />Thêm chữ</button>
        <button onClick={() => setMode('erase')} className={`${btn} border ${mode === 'erase' ? 'bg-rose-50 border-rose-300 text-rose-700' : 'border-slate-200 text-slate-600'}`} title="Kéo trên trang để xoá vùng (chữ gốc còn sót, vết bẩn)"><Eraser className="w-3.5 h-3.5" />Xoá vùng</button>
        <button onClick={() => { setMultiMode(v => !v); setMulti([]); }} className={`${btn} border ${multiMode ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'border-slate-200 text-slate-600'}`} title="Chọn nhiều khối (hoặc giữ Shift khi bấm) để gộp thành một">Chọn nhiều</button>
        {multi.length >= 2 && <button onClick={mergeSelected} className={`${btn} bg-emerald-600 text-white`}><Merge className="w-3.5 h-3.5" />Gộp {multi.length} khối</button>}
        <span className="w-px h-6 bg-slate-200 mx-1" />
        <button onClick={undo} disabled={!history.length} className={`${btn} border border-slate-200 text-slate-600`} title="Hoàn tác (Ctrl+Z)"><Undo2 className="w-3.5 h-3.5" /></button>
        <button onClick={() => setZoom(z => Math.max(0.5, +(z - 0.25).toFixed(2)))} className={`${btn} border border-slate-200 text-slate-600`} title="Thu nhỏ"><ZoomOut className="w-3.5 h-3.5" /></button>
        <button onClick={() => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)))} className={`${btn} border border-slate-200 text-slate-600`} title="Phóng to"><ZoomIn className="w-3.5 h-3.5" /></button>
        <label className="flex items-center gap-1 text-[11px] text-slate-600 ml-1"><input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />Hiện khung tự động</label>
        {rendering && <Loader2 className="w-4 h-4 animate-spin text-indigo-500 ml-1" />}
        <div className="flex-1" />
        <button onClick={resetAll} disabled={!manualCount} className={`${btn} border border-slate-200 text-slate-600`} title="Bỏ mọi chỉnh tay của trang, về bố cục tự động"><RotateCcw className="w-3.5 h-3.5" />Về tự động</button>
        <button onClick={close} disabled={saving} className={`${btn} border border-slate-200 text-slate-600`}><X className="w-3.5 h-3.5" />{confirmClose ? 'Bấm lần nữa để bỏ thay đổi' : 'Đóng'}</button>
        <button onClick={save} disabled={saving || !dirty} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}>{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}Lưu</button>
      </div>

      <div className="flex-1 min-h-0 flex flex-col md:flex-row">
        {/* trang */}
        <div className="flex-1 min-h-0 overflow-auto bg-slate-200 p-3">
          {!imgUrl && !renderError && <div className="h-full flex items-center justify-center text-white text-sm gap-2"><Loader2 className="w-5 h-5 animate-spin" />Đang dựng trang…</div>}
          {renderError && <div className="text-rose-700 bg-rose-50 p-3 rounded-lg text-sm">Không dựng được trang: {renderError}</div>}
          {imgUrl && (
            <div className="relative mx-auto select-none" style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? 1100 : undefined }}>
              <img ref={imgRef} src={imgUrl} alt={`Trang ${page}`} draggable={false} className="w-full h-auto block shadow-lg bg-white" />
              <div
                className={`absolute inset-0 ${mode !== 'select' ? 'cursor-crosshair [touch-action:none]' : ''}`}
                onPointerDown={startCreate}
              >
                {scale > 0 && blocks.map(b => {
                  const mi = manualByKey.get(b.key);
                  const ms = mi !== undefined ? store.boxes[mi] : null;
                  const r = ms ? boxPx(ms) : autoBoxPx(b.key);
                  if (!r) return null;
                  return renderBox(b.key, r, { kind: 'block', key: b.key }, ms ? 'manual' : 'auto', { hidden: !!ms?.hide, over: overflow.has(b.id), title: b.src.slice(0, 120) });
                })}
                {scale > 0 && store.extras.map((e, i) => renderBox(`x${i}`, boxPx(e), { kind: 'extra', idx: i }, 'extra', { over: overflow.has(`manual-${i}`) }))}
                {scale > 0 && store.erase.map((e, i) => renderBox(`e${i}`, boxPx(e), { kind: 'erase', idx: i }, 'erase'))}
                {draft && (
                  <div className={`absolute border-2 ${mode === 'erase' ? 'border-rose-500 bg-rose-400/20' : 'border-indigo-500 bg-indigo-400/10'}`}
                    style={{ left: draft.x0 * scale, top: draft.y0 * scale, width: (draft.x1 - draft.x0) * scale, height: (draft.y1 - draft.y0) * scale }} />
                )}
              </div>
            </div>
          )}
        </div>

        {/* bảng thuộc tính */}
        <div className="md:w-80 w-full md:h-auto max-h-[45vh] md:max-h-none overflow-y-auto bg-white border-t md:border-t-0 md:border-l border-slate-200 p-3 text-xs space-y-3">
          {!sel && (
            <div className="text-slate-500 space-y-2 leading-relaxed">
              <p><b>Bấm vào một khối</b> trên trang để chọn. Kéo để di chuyển, kéo các ô vuông ở cạnh / góc để đổi cỡ khung.</p>
              <p>Khung nét đứt xanh = bố cục tự động. Khung xanh đậm = đã chỉnh tay. Khung vàng = chữ không vừa khung.</p>
              <p><b>Thêm chữ</b>: kéo một khung mới trên trang. <b>Xoá vùng</b>: kéo trên chỗ còn chữ gốc / vết bẩn.</p>
              <p><b>Gộp</b>: bật "Chọn nhiều", bấm các khối bị tách rời rồi bấm "Gộp". <b>Tách</b>: đặt con trỏ trong ô chữ rồi bấm "Tách tại con trỏ".</p>
              <p>Phím mũi tên dời khối 2 điểm ảnh (Shift: 10). Ctrl+Z hoàn tác.</p>
              <p className="text-slate-400">Chỉnh tay lưu cùng bản dịch của trang (máy này + tài khoản), áp lại mỗi lần dựng trang, không tốn token. Dịch lại trang vẫn giữ các chỉnh tay.</p>
              {manualCount > 0 && <p className="text-indigo-700 font-bold">Trang đang có {manualCount} chỉnh tay.</p>}
            </div>
          )}

          {sel?.kind === 'erase' && (
            <div className="space-y-2">
              <div className="font-black text-rose-700">Vùng xoá</div>
              <p className="text-slate-500">Vùng này được tô màu nền (chữ vector được xoá sạch, ảnh nền giữ nguyên nếu có).</p>
              <button onClick={resetSelected} className={`${btn} border border-rose-200 text-rose-700 w-full`}><Trash2 className="w-3.5 h-3.5" />Bỏ vùng xoá này</button>
            </div>
          )}

          {selected && sel && sel.kind !== 'erase' && (
            <>
              <div className="flex items-center gap-2">
                <div className="font-black text-slate-700 flex-1">{sel.kind === 'extra' ? 'Khung chữ thêm mới' : selected.auto ? 'Khối (tự động)' : 'Khối (đã chỉnh tay)'}</div>
                {sel.kind === 'block' && overflow.has(selBlock?.id || '') && <span className="text-amber-600 font-bold">Chữ không vừa</span>}
              </div>
              {selected.src && (
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Bản gốc</div>
                  <div className="text-slate-500 bg-slate-50 rounded p-1.5 max-h-24 overflow-y-auto whitespace-pre-wrap">{selected.src}</div>
                </div>
              )}
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase mb-0.5">Chữ hiển thị (Enter = xuống dòng)</div>
                <textarea
                  ref={textRef}
                  value={selected.text}
                  onFocus={textFocusSnapshot}
                  onChange={e => setText(e.target.value)}
                  rows={5}
                  className="w-full border border-slate-200 rounded-lg p-1.5 text-[12px] leading-snug focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <button onClick={splitAtCursor} className={`${btn} border border-slate-200 text-slate-600 mt-1`} title="Phần chữ sau con trỏ chuyển sang một khung mới ngay bên dưới"><Scissors className="w-3.5 h-3.5" />Tách tại con trỏ</button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Cỡ chữ (pt)</span>
                  <input type="number" step={0.5} min={3} max={96} value={+(curSizePx * ptPerPx).toFixed(1)}
                    onChange={e => { const v = parseFloat(e.target.value); if (v > 0) patch(b => { b.fs = r4(v / ptPerPx / W); }, false); }}
                    onFocus={textFocusSnapshot}
                    className="w-full border border-slate-200 rounded-lg px-1.5 h-8" />
                </label>
                <label className="block">
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Giãn dòng</span>
                  <input type="number" step={0.05} min={0.8} max={3} value={+curLh.toFixed(2)}
                    onChange={e => { const v = parseFloat(e.target.value); if (v > 0) patch(b => { b.lh = v; }, false); }}
                    onFocus={textFocusSnapshot}
                    className="w-full border border-slate-200 rounded-lg px-1.5 h-8" />
                </label>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                <button onClick={() => patch(b => { b.al = 'left'; })} className={tog(curAlign === 'left')} title="Căn trái"><AlignLeft className="w-3.5 h-3.5" /></button>
                <button onClick={() => patch(b => { b.al = 'center'; })} className={tog(curAlign === 'center')} title="Căn giữa"><AlignCenter className="w-3.5 h-3.5" /></button>
                <button onClick={() => patch(b => { b.al = 'right'; })} className={tog(curAlign === 'right')} title="Căn phải"><AlignRight className="w-3.5 h-3.5" /></button>
                <button onClick={() => patch(b => { b.al = 'justify'; })} className={tog(curAlign === 'justify')} title="Căn đều"><AlignJustify className="w-3.5 h-3.5" /></button>
                <span className="w-px h-6 bg-slate-200 mx-1" />
                <button onClick={() => patch(b => { b.b = !curBold; })} className={tog(curBold)} title="Đậm"><Bold className="w-3.5 h-3.5" /></button>
                <button onClick={() => patch(b => { b.i = !curItalic; })} className={tog(curItalic)} title="Nghiêng"><Italic className="w-3.5 h-3.5" /></button>
                <button onClick={() => patch(b => { b.sf = !curSerif; })} className={`${btn} border border-slate-200 text-slate-600 px-2`} title="Đổi kiểu chữ có chân / không chân">{curSerif ? 'Có chân' : 'Không chân'}</button>
                <input type="color" value={curColor || '#1a1a1a'} onChange={e => patch(b => { b.c = e.target.value; }, false)} onFocus={textFocusSnapshot} className="w-8 h-8 border border-slate-200 rounded-lg p-0.5" title="Màu chữ" />
              </div>
              <div className="space-y-1">
                <label className="flex items-center gap-2"><input type="checkbox" checked={selBoxStore?.fit !== false} onChange={e => patch(b => { b.fit = e.target.checked; })} />Tự thu nhỏ chữ nếu không vừa khung</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={!!selBoxStore?.fill} onChange={e => patch(b => { b.fill = e.target.checked; })} />Tô nền khung (khi đặt lên ảnh / chữ khác)</label>
                {sel.kind === 'block' && <label className="flex items-center gap-2"><input type="checkbox" checked={!!selBoxStore?.hide} onChange={e => patch(b => { b.hide = e.target.checked; })} />Ẩn khối này (xoá chữ, không vẽ lại)</label>}
              </div>
              <div className="flex gap-2 pt-1">
                {(sel.kind === 'extra' || !selected.auto) && (
                  <button onClick={resetSelected} className={`${btn} border border-slate-200 text-slate-600 flex-1`}>
                    {sel.kind === 'extra' ? <><Trash2 className="w-3.5 h-3.5" />Xoá khung này</> : <><RotateCcw className="w-3.5 h-3.5" />Khối này về tự động</>}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default ManualLayoutEditor;
