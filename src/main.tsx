import React, {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress benign Vite HMR websocket errors that can look like unhandled rejections
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (event) => {
    if (event.reason && (
      event.reason.message?.includes('WebSocket') || 
      event.reason.message?.includes('vite') ||
      String(event.reason).includes('WebSocket')
    )) {
      event.preventDefault();
    }
  });
}

// Lưới an toàn ngoài cùng: lỗi xảy ra ngay khi khởi động App (trước khi ErrorBoundary bên trong kịp chạy)
// sẽ hiện thông báo dễ đọc thay vì trang trắng tinh.
class RootBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: any) { console.error('[MediTrans] Lỗi khởi động giao diện:', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 640, margin: '10vh auto', padding: 24, border: '1px solid #fecaca', borderRadius: 16, background: '#fff1f2', color: '#881337' }}>
        <h2 style={{ marginTop: 0 }}>MediTrans AI gặp lỗi khi tải giao diện</h2>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#fff', padding: 12, borderRadius: 8 }}>{String(this.state.error?.message || this.state.error)}</pre>
        <button onClick={() => location.reload()} style={{ marginRight: 8, padding: '8px 16px', borderRadius: 8, border: 0, background: '#4f46e5', color: '#fff', cursor: 'pointer' }}>Tải lại trang</button>
        <button onClick={() => { Object.keys(localStorage).filter(k => /^mediTrans_/i.test(k)).forEach(k => localStorage.removeItem(k)); location.reload(); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #e11d48', background: '#fff', color: '#e11d48', cursor: 'pointer' }}>Đặt lại cài đặt trình duyệt & tải lại</button>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootBoundary>
      <App />
    </RootBoundary>
  </StrictMode>,
);
