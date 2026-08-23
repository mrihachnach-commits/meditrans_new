/**
 * Google Drive Service
 * Manages Google Drive OAuth tokens, uploading files to Drive, 
 * listing Drive files (Picker API/custom browser), and fetching file content for PDF rendering.
 */

import { GoogleAuthProvider, signInWithPopup, linkWithPopup, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from '../firebase';
import { getFileBufferCache, saveFileBufferCache } from './storageService';

// Cache token in memory
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

// Cache MediTrans AI folder ID in RAM and localStorage
let cachedMediTransFolderId: string | null = null;

export function clearCachedMediTransFolderId() {
  cachedMediTransFolderId = null;
  try {
    localStorage.removeItem('meditrans_folder_id');
  } catch (e) {}
}

/**
 * Connect to Google Drive via Firebase GoogleAuthProvider popup.
 * Preserves the existing authenticated user session (UID) when obtaining Drive scope.
 */
export async function connectGoogleDrive(): Promise<string> {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.addScope('https://www.googleapis.com/auth/drive.readonly');

  const activeUser = auth.currentUser;

  try {
    let token: string | undefined;

    if (activeUser) {
      console.log(`[GoogleDriveService] Obtaining Drive access token for active user: ${activeUser.email} (UID: ${activeUser.uid})`);
      
      // Try linking Google Provider to current user
      try {
        const result = await linkWithPopup(activeUser, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);
        token = credential?.accessToken;
      } catch (linkError: any) {
        console.warn('[GoogleDriveService] linkWithPopup note:', linkError?.code || linkError?.message);
        
        // Extract OAuth token if credential was already linked or in use
        const credential = GoogleAuthProvider.credentialFromError(linkError);
        if (credential?.accessToken) {
          token = credential.accessToken;
        } else {
          // Try reauthenticating current user
          try {
            const reauthResult = await reauthenticateWithPopup(activeUser, provider);
            const reauthCred = GoogleAuthProvider.credentialFromResult(reauthResult);
            token = reauthCred?.accessToken;
          } catch (reauthErr: any) {
            console.warn('[GoogleDriveService] reauthenticateWithPopup note:', reauthErr?.code || reauthErr?.message);
            const fallbackCred = GoogleAuthProvider.credentialFromError(reauthErr);
            token = fallbackCred?.accessToken;
          }
        }
      }
    }

    // Only if no active user session exists, fall back to signInWithPopup
    if (!token && !activeUser) {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      token = credential?.accessToken;
    }

    if (!token) {
      throw new Error("Không thể lấy mã truy cập Google Drive.");
    }

    setGoogleOAuthToken(token);
    return token;
  } catch (error: any) {
    console.error('[GoogleDriveService] OAuth Popup error:', error);
    if (error.code === 'auth/popup-closed-by-user') {
      throw new Error("Cửa sổ đăng nhập Google đã bị đóng. Vui lòng thử lại.");
    }
    throw new Error(error.message || 'Lỗi kết nối tài khoản Google.');
  }
}

/**
 * Obtain Google OAuth Access Token
 */
export async function getGoogleOAuthToken(forceInteractive = false): Promise<string> {
  if (forceInteractive) {
    return await connectGoogleDrive();
  }

  // Return cached token if valid
  if (cachedToken && Date.now() < tokenExpiresAt - 60000) {
    return cachedToken;
  }

  // Check sessionStorage
  const savedToken = sessionStorage.getItem('google_drive_oauth_token');
  if (savedToken) {
    cachedToken = savedToken;
    tokenExpiresAt = Date.now() + 3600 * 1000;
    return savedToken;
  }

  // Check AI Studio Platform helper if available
  if (typeof window !== 'undefined' && (window as any).aistudio?.getOAuthToken) {
    try {
      const result = await (window as any).aistudio.getOAuthToken('google');
      if (result) {
        const token = typeof result === 'string' ? result : result.token || result.access_token;
        if (token) {
          setGoogleOAuthToken(token);
          return token;
        }
      }
    } catch (e) {
      console.warn('[GoogleDriveService] AI Studio getOAuthToken error:', e);
    }
  }

  // Fallback: Prompt user to connect
  throw new Error("CHUA_KET_NOI_DRIVE");
}

export function setGoogleOAuthToken(token: string) {
  cachedToken = token;
  tokenExpiresAt = Date.now() + 3600 * 1000;
  sessionStorage.setItem('google_drive_oauth_token', token);
}

export interface DriveFileMetadata {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  webViewLink?: string;
  createdTime?: string;
  iconLink?: string;
}

/**
 * Get or create the "MediTrans AI" folder on Google Drive.
 * Caches folder ID in RAM and localStorage to eliminate unnecessary search queries.
 */
export async function getOrCreateMediTransFolder(token?: string): Promise<string> {
  // 1. Check RAM memory cache
  if (cachedMediTransFolderId) {
    return cachedMediTransFolderId;
  }

  // 2. Check localStorage
  try {
    const savedFolderId = localStorage.getItem('meditrans_folder_id');
    if (savedFolderId) {
      cachedMediTransFolderId = savedFolderId;
      return savedFolderId;
    }
  } catch (e) {}

  const authToken = token || await getGoogleOAuthToken();
  const folderName = 'MediTrans AI';

  // 3. Search for existing folder named "MediTrans AI"
  const q = `mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;

  try {
    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) {
        const folderId = data.files[0].id;
        cachedMediTransFolderId = folderId;
        try {
          localStorage.setItem('meditrans_folder_id', folderId);
        } catch (e) {}
        return folderId;
      }
    }
  } catch (err) {
    console.warn('[GoogleDriveService] Error searching folder:', err);
  }

  // 4. Folder does not exist, create it
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${authToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      description: 'Thư mục chứa tài liệu dịch thuật của MediTrans AI'
    })
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => '');
    console.error('[GoogleDriveService] Failed to create folder:', createRes.status, errText);
    throw new Error('Không thể tạo thư mục "MediTrans AI" trên Google Drive');
  }

  const folderData = await createRes.json();
  const newFolderId = folderData.id;
  cachedMediTransFolderId = newFolderId;
  try {
    localStorage.setItem('meditrans_folder_id', newFolderId);
  } catch (e) {}
  return newFolderId;
}

/**
 * Upload a file to Google Drive using multipart upload into "MediTrans AI" folder
 */
export async function uploadFileToDrive(
  file: File,
  folderName = 'MediTrans AI'
): Promise<DriveFileMetadata> {
  const token = await getGoogleOAuthToken();

  // Get or create MediTrans AI folder ID on Drive
  const folderId = await getOrCreateMediTransFolder(token);

  // Create boundary for multipart upload
  const boundary = 'foo_bar_baz_' + Math.random().toString(36).substring(2);
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/pdf',
    description: 'Uploaded via MediTrans AI Medical Translator',
    parents: [folderId]
  };

  const fileBuffer = await file.arrayBuffer();

  const headerBytes = new TextEncoder().encode(
    delimiter +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    JSON.stringify(metadata) +
    delimiter +
    'Content-Type: ' + (file.type || 'application/pdf') + '\r\n\r\n'
  );
  const fileBytes = new Uint8Array(fileBuffer);
  const footerBytes = new TextEncoder().encode(close_delim);

  const totalLength = headerBytes.length + fileBytes.length + footerBytes.length;
  const multipartResponseBody = new Uint8Array(totalLength);
  multipartResponseBody.set(headerBytes, 0);
  multipartResponseBody.set(fileBytes, headerBytes.length);
  multipartResponseBody.set(footerBytes, headerBytes.length + fileBytes.length);

  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,mimeType,size,webViewLink',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`
      },
      body: multipartResponseBody
    }
  );

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    console.error('[GoogleDriveService] Upload failed:', response.status, errorText);
    if (response.status === 401) {
      cachedToken = null;
      throw new Error("Phiên đăng nhập Google hết hạn. Vui lòng thử lại.");
    }
    throw new Error(`Tải lên Google Drive thất bại (${response.status})`);
  }

  const result = await response.json();
  return {
    id: result.id,
    name: result.name || file.name,
    mimeType: result.mimeType || file.type,
    size: result.size ? parseInt(result.size) : file.size,
    webViewLink: result.webViewLink
  };
}

/**
 * Download file binary from Google Drive as ArrayBuffer for PDF.js.
 * Features:
 * 1. Multi-Layer Smart Cache (RAM Memory Cache + IndexedDB): Instantaneous re-opening (0 - 10ms).
 * 2. Dual-Channel Racing (Google CDN Direct vs Server Streaming Proxy /api/drive/download):
 *    Fires both streams simultaneously, picks the fastest channel, and aborts the loser stream.
 */
export async function downloadDriveFileAsArrayBuffer(fileId: string): Promise<ArrayBuffer> {
  // Step 1: Check Multi-Layer Smart Cache (RAM + IndexedDB)
  const cachedBuffer = await getFileBufferCache(fileId);
  if (cachedBuffer && cachedBuffer.byteLength > 0) {
    console.log(`[MediTrans AI] Instantaneous load from Multi-Layer Cache for file ${fileId} (<10ms)`);
    return cachedBuffer;
  }

  // Step 2: Dual-Channel Racing (Google CDN Direct vs Server Streaming Proxy)
  const token = await getGoogleOAuthToken();
  const controllerA = new AbortController();
  const controllerB = new AbortController();

  const directFetch = async (): Promise<ArrayBuffer> => {
    const directUrl = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const res = await fetch(directUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controllerA.signal
    });
    if (!res.ok) {
      if (res.status === 401) cachedToken = null;
      throw new Error(`Google CDN direct fetch failed with status ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength === 0) throw new Error("Google CDN direct fetch returned empty body");
    return buf;
  };

  const proxyFetch = async (): Promise<ArrayBuffer> => {
    const proxyUrl = `/api/drive/download?fileId=${encodeURIComponent(fileId)}`;
    const res = await fetch(proxyUrl, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controllerB.signal
    });
    if (!res.ok) {
      if (res.status === 401) cachedToken = null;
      throw new Error(`Server streaming proxy fetch failed with status ${res.status}`);
    }
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength === 0) throw new Error("Server streaming proxy fetch returned empty body");
    return buf;
  };

  const startTime = Date.now();

  try {
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      let settledCount = 0;
      let errors: any[] = [];
      let isDone = false;

      // Channel A: Google CDN Direct
      directFetch().then(
        (buf) => {
          if (!isDone) {
            isDone = true;
            controllerB.abort(); // Cancel loser channel
            const elapsed = Date.now() - startTime;
            console.log(`[Dual-Channel Racing] Channel A (Google CDN Direct) WON in ${elapsed}ms for file ${fileId}`);
            resolve(buf);
          }
        },
        (err) => {
          if (err.name !== 'AbortError') {
            console.warn('[Dual-Channel Racing] Channel A error:', err.message || err);
          }
          settledCount++;
          errors.push(err);
          if (settledCount === 2 && !isDone) {
            reject(new Error(`Tải tệp từ Google Drive thất bại ở cả 2 đường truyền: ${errors.map(e => e.message).join('; ')}`));
          }
        }
      );

      // Channel B: Server Streaming Proxy
      proxyFetch().then(
        (buf) => {
          if (!isDone) {
            isDone = true;
            controllerA.abort(); // Cancel loser channel
            const elapsed = Date.now() - startTime;
            console.log(`[Dual-Channel Racing] Channel B (Server Streaming Proxy) WON in ${elapsed}ms for file ${fileId}`);
            resolve(buf);
          }
        },
        (err) => {
          if (err.name !== 'AbortError') {
            console.warn('[Dual-Channel Racing] Channel B error:', err.message || err);
          }
          settledCount++;
          errors.push(err);
          if (settledCount === 2 && !isDone) {
            reject(new Error(`Tải tệp từ Google Drive thất bại ở cả 2 đường truyền: ${errors.map(e => e.message).join('; ')}`));
          }
        }
      );
    });

    // Step 3: Save arrayBuffer to Multi-Layer Smart Cache
    saveFileBufferCache(fileId, arrayBuffer);

    return arrayBuffer;
  } catch (error: any) {
    console.error(`[MediTrans AI] Error in Dual-Channel Racing for file ${fileId}:`, error);
    throw error;
  }
}

/**
 * List PDF files strictly inside the user's "MediTrans AI" Google Drive folder
 */
export async function listUserDriveFiles(searchQuery = ''): Promise<DriveFileMetadata[]> {
  const token = await getGoogleOAuthToken();

  // 1. Get or create the MediTrans AI folder
  const folderId = await getOrCreateMediTransFolder(token);

  // 2. Query files strictly inside this parent folder
  let q = `'${folderId}' in parents and mimeType='application/pdf' and trashed=false`;
  if (searchQuery.trim()) {
    q += ` and name contains '${searchQuery.replace(/'/g, "\\'")}'`;
  }

  const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,mimeType,size,webViewLink,createdTime,iconLink)&pageSize=50&orderBy=recency%20desc`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null;
    }
    throw new Error(`Không thể lấy danh sách tệp Google Drive (${response.status})`);
  }

  const data = await response.json();
  return (data.files || []).map((f: any) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    size: f.size ? parseInt(f.size) : 0,
    webViewLink: f.webViewLink,
    createdTime: f.createdTime,
    iconLink: f.iconLink
  }));
}
