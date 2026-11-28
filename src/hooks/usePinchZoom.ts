import { useEffect, useRef } from 'react';

/**
 * v11.3: zoom bằng hai ngón tay (pinch) trên màn hình cảm ứng (điện thoại / máy tính bảng).
 *
 * - Trong lúc chụm/mở ngón tay: chỉ phóng ảnh bằng CSS transform (mượt, không vẽ lại PDF).
 * - Khi nhấc tay: gọi `commit(giá trị mới)` (zoom PDF / cỡ chữ bản dịch) rồi chờ phần tử đích đổi
 *   kích thước thật sự mới bỏ transform và cuộn sao cho điểm giữa hai ngón tay vẫn nằm đúng chỗ — không bị giật.
 * - Vùng cuộn cần class `[touch-action:pan-x_pan-y]` (PINCH_TOUCH_CLASS): một ngón vẫn cuộn như cũ, trình duyệt
 *   không tự phóng cả trang nữa.
 * - Tuỳ chọn `wheelStep`: Ctrl/⌘ + lăn chuột (hoặc chụm 2 ngón trên touchpad máy tính) cũng đổi giá trị.
 */
export interface PinchZoomOptions {
  enabled?: boolean;
  /** Giá trị hiện tại (zoom hoặc cỡ chữ) */
  getValue: () => number;
  /** Áp dụng giá trị mới (đã kẹp min/max). Trả về false nếu giá trị không đổi. */
  commit: (next: number) => boolean;
  min: number;
  max: number;
  /** Phần tử được phóng tạm bằng transform trong lúc chụm tay (mặc định: con đầu tiên của vùng cuộn) */
  getContent?: (scrollEl: HTMLElement) => HTMLElement | null;
  /** Phần tử đổi kích thước sau khi commit (trang PDF / khung trang / khối chữ) — mặc định = getContent */
  getTarget?: (scrollEl: HTMLElement) => HTMLElement | null;
  /** Bước đổi khi Ctrl + lăn chuột; bỏ trống = không xử lý lăn chuột */
  wheelStep?: number;
}

const SETTLE_TIMEOUT_MS = 2500;

/** Class cho vùng cuộn: một ngón cuộn, hai ngón do usePinchZoom xử lý */
export const PINCH_TOUCH_CLASS = '[touch-action:pan-x_pan-y]';

export function usePinchZoom(scrollEl: HTMLElement | null, options: PinchZoomOptions) {
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    const el = scrollEl;
    if (!el) return;

    const contentOf = () => (optsRef.current.getContent ? optsRef.current.getContent(el) : (el.firstElementChild as HTMLElement | null));
    const targetOf = () => (optsRef.current.getTarget ? optsRef.current.getTarget(el) : contentOf());

    type Gesture = {
      startDist: number;
      p0: { x: number; y: number };
      p1: { x: number; y: number };
      scale: number;
      value0: number;
      content: HTMLElement;
      target: HTMLElement;
      fx: number;
      fy: number;
      prevTransform: string;
      prevOrigin: string;
      prevWillChange: string;
    };
    let g: Gesture | null = null;
    let settling: { ro: ResizeObserver; timer: number; finish: () => void } | null = null;

    const dist = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const mid = (a: Touch, b: Touch) => ({ x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 });

    const restoreStyles = (st: Gesture) => {
      st.content.style.transform = st.prevTransform;
      st.content.style.transformOrigin = st.prevOrigin;
      st.content.style.willChange = st.prevWillChange;
    };

    // Bỏ transform rồi cuộn để điểm (fx, fy) của phần tử đích nằm dưới điểm p1 (giữa hai ngón tay lúc nhấc)
    const realign = (st: Gesture) => {
      restoreStyles(st);
      const t = st.target.getBoundingClientRect();
      if (t.width < 1 || t.height < 1) return;
      const px = t.left + st.fx * t.width;
      const py = t.top + st.fy * t.height;
      el.scrollLeft += px - st.p1.x;
      el.scrollTop += py - st.p1.y;
    };

    const cancelSettling = () => {
      if (!settling) return;
      settling.finish();
    };

    const onTouchStart = (e: TouchEvent) => {
      if (optsRef.current.enabled === false) return;
      if (e.touches.length !== 2 || g) return;
      cancelSettling();
      const content = contentOf();
      const target = targetOf();
      if (!content || !target) return;
      const [a, b] = [e.touches[0], e.touches[1]];
      const startDist = dist(a, b);
      if (startDist < 10) return;
      const p0 = mid(a, b);
      const c = content.getBoundingClientRect();
      const t = target.getBoundingClientRect();
      g = {
        startDist, p0, p1: p0, scale: 1,
        value0: optsRef.current.getValue(),
        content, target,
        fx: t.width ? (p0.x - t.left) / t.width : 0,
        fy: t.height ? (p0.y - t.top) / t.height : 0,
        prevTransform: content.style.transform,
        prevOrigin: content.style.transformOrigin,
        prevWillChange: content.style.willChange,
      };
      content.style.transformOrigin = `${p0.x - c.left}px ${p0.y - c.top}px`;
      content.style.willChange = 'transform';
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!g) return;
      if (e.touches.length < 2) return;
      if (e.cancelable) e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const { min, max } = optsRef.current;
      let s = dist(a, b) / g.startDist;
      // Kẹp theo giới hạn giá trị để người dùng thấy đã chạm mức tối đa / tối thiểu
      if (g.value0 > 0) s = Math.min(max / g.value0, Math.max(min / g.value0, s));
      g.scale = s;
      g.p1 = mid(a, b);
      const dx = g.p1.x - g.p0.x;
      const dy = g.p1.y - g.p0.y;
      g.content.style.transform = `translate(${dx}px, ${dy}px) scale(${s})`;
    };

    const endGesture = () => {
      if (!g) return;
      const st = g;
      g = null;
      const { min, max } = optsRef.current;
      const next = Math.min(max, Math.max(min, st.value0 * st.scale));
      const changed = Math.abs(st.scale - 1) > 0.02 && optsRef.current.commit(next);
      if (!changed) { realign(st); return; }
      // Giữ ảnh phóng tạm cho tới khi phần tử đích đổi kích thước thật (PDF vẽ lại / chữ dàn lại)
      const w0 = st.target.offsetWidth, h0 = st.target.offsetHeight;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        ro.disconnect();
        window.clearTimeout(timer);
        settling = null;
        realign(st);
      };
      const ro = new ResizeObserver(() => {
        if (Math.abs(st.target.offsetWidth - w0) > 1 || Math.abs(st.target.offsetHeight - h0) > 1) finish();
      });
      ro.observe(st.target);
      const timer = window.setTimeout(finish, SETTLE_TIMEOUT_MS);
      settling = { ro, timer, finish };
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (g && e.touches.length < 2) endGesture();
    };

    // Safari iOS: chặn cử chỉ phóng cả trang của trình duyệt bên trong vùng xem
    const onGesture = (e: Event) => { if (optsRef.current.enabled !== false) e.preventDefault(); };

    const onWheel = (e: WheelEvent) => {
      const o = optsRef.current;
      if (!o.wheelStep || o.enabled === false || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const cur = o.getValue();
      const next = Math.min(o.max, Math.max(o.min, cur + (e.deltaY > 0 ? -o.wheelStep : o.wheelStep)));
      o.commit(next);
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('gesturestart', onGesture as EventListener, { passive: false } as AddEventListenerOptions);
    el.addEventListener('gesturechange', onGesture as EventListener, { passive: false } as AddEventListenerOptions);
    el.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('gesturestart', onGesture as EventListener);
      el.removeEventListener('gesturechange', onGesture as EventListener);
      el.removeEventListener('wheel', onWheel);
      if (g) { restoreStyles(g); g = null; }
      cancelSettling();
    };
  }, [scrollEl]);
}
