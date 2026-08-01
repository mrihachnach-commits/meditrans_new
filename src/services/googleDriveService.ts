/**
 * Google Drive Service
 * Manages Google Drive OAuth tokens, uploading files to Drive, 
 * listing Drive files (Picker API/custom browser), and fetching file content for PDF rendering.
 */

import { GoogleAuthProvider, signInWithPopup, linkWithPopup, reauthenticateWithPopup } from 'firebase/auth';
import { auth } from '../firebase';

// Cache token in memory
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

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
 * Get or create the "MediTrans AI" folder on Google Drive
 */
export async function getOrCreateMediTransFolder(token?: string): Promise<string> {
  const authToken = token || await getGoogleOAuthToken();
  const folderName = 'MediTrans AI';

  // 1. Search for existing folder named "MediTrans AI"
  const q = `mimeType='application/vnd.google-apps.folder' and name='${folderName.replace(/'/g, "\\'")}' and trashed=false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`;

  try {
    const searchRes = await fetch(searchUrl, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (searchRes.ok) {
      const data = await searchRes.json();
      if (data.files && data.files.length > 0) {
        return data.files[0].id;
      }
    }
  } catch (err) {
    console.warn('[GoogleDriveService] Error searching folder:', err);
  }

  // 2. Folder does not exist, create it
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
  return folderData.id;
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
 * Download file binary from Google Drive as ArrayBuffer for PDF.js
 */
export async function downloadDriveFileAsArrayBuffer(fileId: string): Promise<ArrayBuffer> {
  const token = await getGoogleOAuthToken();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

  try {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 401) {
        cachedToken = null;
        throw new Error("Xác thực Google Drive hết hạn. Vui lòng thử lại.");
      }
      throw new Error(`Không thể tải tệp từ Google Drive (Mã lỗi ${response.status})`);
    }

    return await response.arrayBuffer();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error("Quá thời gian tải tài liệu từ Google Drive. Vui lòng kiểm tra kết nối mạng.");
    }
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
