const DB_NAME = 'MediTransCacheDB';
const DB_VERSION = 2;

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
      if (!db.objectStoreNames.contains('pdfBuffers')) {
        db.createObjectStore('pdfBuffers');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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

export async function savePdfBufferCache(docKey: string, buffer: ArrayBuffer): Promise<void> {
  if (!docKey || !buffer) return;
  try {
    const db = await openDB();
    const tx = db.transaction('pdfBuffers', 'readwrite');
    tx.objectStore('pdfBuffers').put(buffer, docKey);
  } catch (e) {
    console.warn('Failed to save PDF buffer cache:', e);
  }
}

export async function getPdfBufferCache(docKey: string): Promise<ArrayBuffer | null> {
  if (!docKey) return null;
  try {
    const db = await openDB();
    const tx = db.transaction('pdfBuffers', 'readonly');
    const req = tx.objectStore('pdfBuffers').get(docKey);
    return new Promise((resolve) => {
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}
