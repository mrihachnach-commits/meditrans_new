const DB_NAME = 'MediTransCacheDB';
const DB_VERSION = 2;

// Memory RAM Cache for instantaneous re-opening (<1ms)
const fileBufferMemoryCache = new Map<string, ArrayBuffer>();

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      return reject(new Error('IndexedDB not supported'));
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions');
      }
      if (!db.objectStoreNames.contains('translations')) {
        db.createObjectStore('translations');
      }
      if (!db.objectStoreNames.contains('fileBuffers')) {
        db.createObjectStore('fileBuffers');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Multi-layer Binary Cache: Save ArrayBuffer to RAM Memory Cache + IndexedDB
 */
export async function saveFileBufferCache(fileId: string, buffer: ArrayBuffer): Promise<void> {
  if (!fileId || !buffer || buffer.byteLength === 0) return;
  
  // 1. RAM Memory Cache
  fileBufferMemoryCache.set(fileId, buffer);

  // 2. IndexedDB Persistent Cache
  try {
    const db = await openDB();
    const tx = db.transaction('fileBuffers', 'readwrite');
    tx.objectStore('fileBuffers').put(buffer, fileId);
  } catch (e) {
    console.warn('[StorageService] Failed to save binary buffer to IndexedDB:', e);
  }
}

/**
 * Multi-layer Binary Cache: Fetch ArrayBuffer from RAM Memory Cache or IndexedDB
 */
export async function getFileBufferCache(fileId: string): Promise<ArrayBuffer | null> {
  if (!fileId) return null;

  // Layer 1: RAM Cache (Instant 0ms)
  if (fileBufferMemoryCache.has(fileId)) {
    const ramBuf = fileBufferMemoryCache.get(fileId)!;
    console.log(`[StorageService] RAM Memory Cache hit for file: ${fileId} (0ms)`);
    return ramBuf.slice(0); // Return a slice to prevent ArrayBuffer detaching issues
  }

  // Layer 2: IndexedDB Cache (Instant 1-10ms)
  try {
    const db = await openDB();
    const tx = db.transaction('fileBuffers', 'readonly');
    const req = tx.objectStore('fileBuffers').get(fileId);
    
    return new Promise((resolve) => {
      req.onsuccess = () => {
        if (req.result) {
          console.log(`[StorageService] IndexedDB Cache hit for file: ${fileId} (~5ms)`);
          const buf = req.result as ArrayBuffer;
          fileBufferMemoryCache.set(fileId, buf);
          resolve(buf.slice(0));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn('[StorageService] IndexedDB read error:', e);
    return null;
  }
}

/**
 * Clear cached binary file buffer from RAM and IndexedDB
 */
export async function clearFileBufferCache(fileId?: string): Promise<void> {
  if (fileId) {
    fileBufferMemoryCache.delete(fileId);
    try {
      const db = await openDB();
      const tx = db.transaction('fileBuffers', 'readwrite');
      tx.objectStore('fileBuffers').delete(fileId);
    } catch (e) {}
  } else {
    fileBufferMemoryCache.clear();
    try {
      const db = await openDB();
      const tx = db.transaction('fileBuffers', 'readwrite');
      tx.objectStore('fileBuffers').clear();
    } catch (e) {}
  }
}

export interface ActiveDocSession {
  fileData?: any;
  driveFile?: any;
  fileId?: string | null;
  fileOwnerId?: string | null;
  fileName: string;
  currentPage: number;
  fileBuffer?: ArrayBuffer;
  isLocalOnly?: boolean;
  timestamp?: number;
}

/** Buffer PDF đã lưu gần nhất → lật trang chỉ ghi thông tin nhỏ, không ghi lại cả file PDF (trước đây mỗi lần lật trang ghi lại vài chục MB). */
let lastSavedBuffer: ArrayBuffer | null = null;
let sessionSaveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSession: ActiveDocSession | null = null;
let warnedSessionSave = false;

const isDetached = (b?: ArrayBuffer | null) => !b || (b as any).detached === true || b.byteLength === 0;

async function writeActiveDocSession(sessionData: ActiveDocSession): Promise<void> {
  try {
    const { fileBuffer, ...meta } = sessionData;
    const db = await openDB();
    const tx = db.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    if (fileBuffer && !isDetached(fileBuffer)) {
      if (fileBuffer !== lastSavedBuffer) {
        store.put(fileBuffer, 'activeSessionBuffer');
        lastSavedBuffer = fileBuffer;
      }
      store.put({ ...meta, hasBuffer: true, timestamp: Date.now() }, 'activeSession');
    } else {
      // Không có buffer (file Drive/đám mây) hoặc buffer đã bị pdf.js chuyển đi → chỉ lưu thông tin phiên
      if (!fileBuffer) { store.delete('activeSessionBuffer'); lastSavedBuffer = null; }
      store.put({ ...meta, hasBuffer: !!fileBuffer && !!lastSavedBuffer, timestamp: Date.now() }, 'activeSession');
    }
  } catch (e) {
    if (!warnedSessionSave) { warnedSessionSave = true; console.warn('Failed to save active session to IndexedDB:', e); }
  }
}

/** Lưu phiên đang mở (gộp các lần gọi liên tiếp trong 800 ms → lật trang nhanh không ghi liên tục). */
export async function saveActiveDocSession(sessionData: ActiveDocSession): Promise<void> {
  pendingSession = sessionData;
  if (sessionSaveTimer) clearTimeout(sessionSaveTimer);
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null;
    const s = pendingSession;
    pendingSession = null;
    if (s) void writeActiveDocSession(s);
  }, 800);
}

export async function getActiveDocSession(): Promise<ActiveDocSession | null> {
  try {
    const db = await openDB();
    const tx = db.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const req = store.get('activeSession');
    const breq = store.get('activeSessionBuffer');
    return new Promise((resolve) => {
      tx.oncomplete = () => {
        const r = req.result || null;
        if (!r) return resolve(null);
        // Phiên cũ lưu buffer ngay trong bản ghi; phiên mới lưu buffer riêng
        const buf: ArrayBuffer | undefined = r.fileBuffer || (r.hasBuffer ? breq.result : undefined) || undefined;
        if (buf && !isDetached(buf)) lastSavedBuffer = buf;
        resolve({ ...r, fileBuffer: buf && !isDetached(buf) ? buf : undefined });
      };
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function clearActiveDocSession(): Promise<void> {
  try {
    const db = await openDB();
    if (sessionSaveTimer) { clearTimeout(sessionSaveTimer); sessionSaveTimer = null; pendingSession = null; }
    lastSavedBuffer = null;
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').delete('activeSession');
    tx.objectStore('sessions').delete('activeSessionBuffer');
  } catch (e) {
    console.warn('Failed to clear active session from IndexedDB:', e);
  }
}

export async function saveTranslationsCache(docKey: string, translations: any): Promise<void> {
  if (!docKey) return;
  try {
    const db = await openDB();
    const tx = db.transaction('translations', 'readwrite');
    tx.objectStore('translations').put(translations, docKey);
  } catch (e) {
    console.warn('Failed to save translations cache:', e);
  }
}

export async function getTranslationsCache(docKey: string): Promise<any> {
  if (!docKey) return {};
  try {
    const db = await openDB();
    const tx = db.transaction('translations', 'readonly');
    const req = tx.objectStore('translations').get(docKey);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || {});
      req.onerror = () => resolve({});
    });
  } catch (e) {
    return {};
  }
}

export async function saveSummaryCache(docKey: string, summaryText: string): Promise<void> {
  if (!docKey) return;
  try {
    const db = await openDB();
    const tx = db.transaction('translations', 'readwrite');
    tx.objectStore('translations').put({ summaryText }, `${docKey}_summaryText`);
  } catch (e) {
    console.warn('Failed to save summary cache:', e);
  }
}

export async function getSummaryCache(docKey: string): Promise<string | null> {
  if (!docKey) return null;
  try {
    const db = await openDB();
    const tx = db.transaction('translations', 'readonly');
    const req = tx.objectStore('translations').get(`${docKey}_summaryText`);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result?.summaryText || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}
