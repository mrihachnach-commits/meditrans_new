/**
 * Google Drive Service
 * Manages Google Drive OAuth tokens, uploading files to Drive, 
 * listing Drive files (Picker API/custom browser), and fetching file content for PDF rendering.
 */

import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { auth } from '../firebase';

// Cache token in memory
let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Connect to Google Drive via Firebase GoogleAuthProvider popup
 */
export async function connectGoogleDrive(): Promise<string> {
  const provider = new GoogleAuthProvider();
  provider.addScope('https://www.googleapis.com/auth/drive.file');
  provider.addScope('https://www.googleapis.com/auth/drive.readonly');

  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken;
    if (!token) {
      throw new Error("Không thể lấy mã truy cập Google.");
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
 * Upload a file to Google Drive using multipart upload
 */
export async function uploadFileToDrive(
  file: File,
  folderName = 'MediTrans AI Documents'
): Promise<DriveFileMetadata> {
  const token = await getGoogleOAuthToken();

  // Create boundary for multipart upload
  const boundary = 'foo_bar_baz_' + Math.random().toString(36).substring(2);
  const delimiter = "\r\n--" + boundary + "\r\n";
  const close_delim = "\r\n--" + boundary + "--";

  const metadata = {
    name: file.name,
    mimeType: file.type || 'application/pdf',
    description: 'Uploaded via MediTrans AI Medical Translator'
  };

  const fileBuffer = await file.arrayBuffer();

  const multipartResponseBody = new Uint8Array([
    ...new TextEncoder().encode(
      delimiter +
      'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter +
      'Content-Type: ' + (file.type || 'application/pdf') + '\r\n\r\n'
    ),
    ...new Uint8Array(fileBuffer),
    ...new TextEncoder().encode(close_delim)
  ]);

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

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  if (!response.ok) {
    if (response.status === 401) {
      cachedToken = null;
      throw new Error("Xác thực Google Drive hết hạn. Vui lòng thử lại.");
    }
    throw new Error(`Không thể tải tệp từ Google Drive (Mã lỗi ${response.status})`);
  }

  return await response.arrayBuffer();
}

/**
 * List PDF files in user's Google Drive
 */
export async function listUserDriveFiles(searchQuery = ''): Promise<DriveFileMetadata[]> {
  const token = await getGoogleOAuthToken();

  let q = "mimeType='application/pdf' and trashed=false";
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
