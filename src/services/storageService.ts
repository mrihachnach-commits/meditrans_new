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

export async function saveActiveDocSession(sessionData: ActiveDocSession): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').put({ ...sessionData, timestamp: Date.now() }, 'activeSession');
  } catch (e) {
    console.warn('Failed to save active session to IndexedDB:', e);
  }
}

export async function getActiveDocSession(): Promise<ActiveDocSession | null> {
  try {
    const db = await openDB();
    const tx = db.transaction('sessions', 'readonly');
    const req = tx.objectStore('sessions').get('activeSession');
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

export async function clearActiveDocSession(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction('sessions', 'readwrite');
    tx.objectStore('sessions').delete('activeSession');
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
