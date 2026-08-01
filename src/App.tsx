/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react';
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PDFDocument } from 'pdf-lib';
import { GeminiService } from './services/geminiService';
import { Logo, LogoWithText } from './components/Logo';
import { FileExplorer, FileData } from './components/FileExplorer';
import { UploadStatus, UploadTask } from './components/UploadStatus';
import { GoogleDrivePickerModal } from './components/GoogleDrivePickerModal';
import { uploadFileToDrive, downloadDriveFileAsArrayBuffer, setGoogleOAuthToken, getOrCreateMediTransFolder, DriveFileMetadata } from './services/googleDriveService';
import { saveActiveDocSession, getActiveDocSession, clearActiveDocSession, saveTranslationsCache, getTranslationsCache } from './services/storageService';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`;

import { 
  Upload, 
  FileText, 
  ChevronLeft, 
  ChevronRight, 
  Settings, 
  Loader2, 
  Download, 
  Languages,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Maximize2,
  Minimize2,
  HardDrive,
  Search,
  Hand,
  Trash2,
  RefreshCcw,
  KeyRound,
  Layout,
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  Maximize,
  Type,
  ALargeSmall,
  Type as FontIcon,
  LogIn,
  LogOut,
  Plus,
  Minus,
  Key,
  Activity,
  Zap,
  Cpu,
  ShieldCheck,
  ShieldAlert,
  User as UserIcon,
  UserPlus,
  Users,
  Globe,
  Share2,
  Pencil,
  X,
  Square,
  Check,
  Copy,
  Folder,
  Home,
  ExternalLink,
  Mail,
  Eye,
  EyeOff,
  Save,
  ScrollText,
  FileSearch,
  BookOpen,
  Sparkles,
  Play
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { saveAs } from 'file-saver';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { TranslationEngine, TranslationService } from './services/translationService';
import { 
  auth, 
  firebaseConfig,
  signOut, 
  onAuthStateChanged, 
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  GoogleAuthProvider,
  signInWithPopup,
  db, 
  collection, 
  addDoc,
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy,
  onSnapshot, 
  deleteDoc, 
  updateDoc, 
  serverTimestamp,
  User,
  Timestamp,
  getDocFromServer,
  OperationType,
  handleFirestoreError,
  or,
  collectionGroup
} from './firebase';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Đã có lỗi xảy ra. Vui lòng tải lại trang.";
      try {
        if (this.state.error?.message.startsWith('{')) {
          const info = JSON.parse(this.state.error.message);
          errorMessage = `Lỗi hệ thống (${info.operationType}): ${info.error}`;
        }
      } catch (e) {}

      return (
        <div className="h-screen flex flex-col items-center justify-center bg-slate-50 p-8 text-center">
          <div className="bg-white p-8 rounded-3xl shadow-xl border border-slate-100 max-w-md">
            <AlertCircle className="w-16 h-16 text-rose-500 mx-auto mb-6" />
            <h2 className="text-2xl font-display font-bold text-slate-800 mb-4">Rất tiếc!</h2>
            <p className="text-slate-500 mb-8">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-indigo-600 text-white rounded-full font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"
            >
              Tải lại trang
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function formatErrorMessage(error: any): string {
  if (!error) return 'Lỗi không xác định';
  if (typeof error === 'string') {
    try {
      const parsed = JSON.parse(error);
      if (parsed.error && parsed.error.message) {
        return formatErrorMessage(parsed.error.message);
      }
    } catch (e) {
      return error;
    }
  }
  
  const message = error.message || String(error);
  
  if (message.includes('403') || message.toLowerCase().includes('permission_denied') || message.toLowerCase().includes('denied access')) {
    return 'Lỗi 403: API Key hoặc Project bị từ chối truy cập. Vui lòng kiểm tra lại Key hoặc Project trong Google AI Studio.';
  }
  
  if (message.includes('429') || message.toLowerCase().includes('quota') || message.toLowerCase().includes('resource_exhausted')) {
    return 'Lỗi 429: Hết hạn mức (Quota). Vui lòng thử lại sau hoặc đổi API Key khác.';
  }

  if (message.includes('503') || message.toLowerCase().includes('unavailable')) {
    return 'Lỗi 503: Dịch vụ đang quá tải. Vui lòng thử lại sau vài giây.';
  }

  if (message.includes('code: 0') || message.includes('status code: 0') || message.toLowerCase().includes('fetch failed')) {
    return 'Lỗi kết nối (Network Error): Không thể kết nối tới máy chủ AI hoặc bị chặn bởi trình duyệt/CORS. Vui lòng kiểm tra lại mạng hoặc tắt VPN/Extension chặn quảng cáo.';
  }
  
  try {
    const parsed = JSON.parse(message);
    if (parsed.error && parsed.error.message) {
      return formatErrorMessage(parsed.error.message);
    }
  } catch (e) {}

  return message;
}

interface TranslationState {
  [page: number]: {
    content: string;
    status: 'idle' | 'loading' | 'success' | 'error';
  };
}

// --- UTILITIES ---
const OPTIMIZED_IMAGE_DIM = 850;
const OPTIMIZED_IMAGE_QUALITY = 0.5;

const optimizeCanvasImage = (canvas: HTMLCanvasElement): string => {
  const { width, height } = canvas;
  const ratio = Math.min(OPTIMIZED_IMAGE_DIM / width, OPTIMIZED_IMAGE_DIM / height, 1);
  
  const temp = document.createElement('canvas');
  temp.width = width * ratio;
  temp.height = height * ratio;
  const ctx = temp.getContext('2d', { alpha: false });
  if (!ctx) return canvas.toDataURL('image/jpeg', OPTIMIZED_IMAGE_QUALITY);
  
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, temp.width, temp.height);
  ctx.drawImage(canvas, 0, 0, temp.width, temp.height);
  return temp.toDataURL('image/jpeg', OPTIMIZED_IMAGE_QUALITY);
};

// --- COMPONENTS ---
const TranslationMarkdown = memo(({ content, page, isStreaming, onCancel, fontSize, fontFamily }: { 
  content: string; 
  page: number; 
  isStreaming: boolean;
  onCancel: () => void;
  fontSize?: number;
  fontFamily?: string;
}) => {
  const processedContent = useMemo(() => {
    if (!content) return '';
    // Normalize escaped HTML br tags (&lt;br&gt; or &lt;br/&gt;) to real <br/>
    let text = content.replace(/&lt;br\s*\/?&gt;/gi, '<br/>');
    // Replace sequences of 4 or more dots (possibly with spaces) with a clean ' ... '
    text = text.replace(/(\s*\.\s*){4,}/g, ' ... ');
    return text;
  }, [content]);

  const fontStyle = useMemo(() => {
    const styleObj: React.CSSProperties = {};
    if (fontSize) {
      styleObj.fontSize = `${fontSize}px`;
    }
    if (fontFamily) {
      styleObj.fontFamily = fontFamily === 'Inter' ? 'var(--font-sans)' : 
                             fontFamily === 'JetBrains Mono' ? 'var(--font-mono)' : 
                             fontFamily === 'Playfair Display' ? 'var(--font-display)' :
                             fontFamily === 'Cormorant Garamond' ? 'var(--font-serif)' :
                             fontFamily;
    }
    return styleObj;
  }, [fontSize, fontFamily]);

  return (
    <div 
      className="markdown-body select-text pb-60 md:pb-0"
      style={fontStyle}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {processedContent}
      </ReactMarkdown>

      {isStreaming && (
        <div className="mt-6 p-4 bg-indigo-50/50 rounded-2xl border border-indigo-100/50 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-indigo-600 font-bold text-xs animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Đang dịch nội dung y khoa...</span>
          </div>
          <button 
            onClick={onCancel}
            className="w-fit px-4 py-2 bg-white text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-rose-50 hover:text-rose-600 transition-all border border-slate-200 shadow-sm flex items-center gap-2"
          >
            <Square className="w-3 h-3 fill-current" />
            Dừng dịch
          </button>
        </div>
      )}
    </div>
  );
});

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [currentFileName, setCurrentFileName] = useState<string>('');
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentJob, setCurrentJob] = useState(1);
  const PAGES_PER_JOB = 100;
  const totalJobs = Math.ceil(numPages / PAGES_PER_JOB);

  const [fileId, setFileId] = useState<string | null>(null);
  const [fileOwnerId, setFileOwnerId] = useState<string | null>(null);
  const [isLocalOnly, setIsLocalOnly] = useState(false);
  const [showExplorer, setShowExplorer] = useState(true);
  const [showDrivePickerModal, setShowDrivePickerModal] = useState(false);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [translations, setTranslations] = useState<TranslationState>({});
  const translationsRef = useRef<TranslationState>({});
  const currentPageRef = useRef<number>(1);
  const [activeTranslation, setActiveTranslation] = useState<{page: number, content: string, status: string} | null>(null);
  const translatingPagesRef = useRef<Set<number>>(new Set());
  const abortControllerRef = useRef<AbortController | null>(null);
  const bulkAbortControllerRef = useRef<AbortController | null>(null);
  const fileIdRef = useRef<number>(1);
  const preTranslateControllersRef = useRef<Map<number, AbortController>>(new Map());
  const activeFileDataRef = useRef<FileData | null>(null);
  const activeDriveFileRef = useRef<DriveFileMetadata | null>(null);
  const activeFileBufferRef = useRef<ArrayBuffer | null>(null);

  useEffect(() => {
    translationsRef.current = translations;
    const docKey = fileId || currentFileName;
    if (docKey && Object.keys(translations).length > 0) {
      saveTranslationsCache(docKey, translations);
    }
  }, [translations, fileId, currentFileName]);

  useEffect(() => {
    if (pdfDoc && (fileId || currentFileName)) {
      saveActiveDocSession({
        fileData: activeFileDataRef.current || undefined,
        driveFile: activeDriveFileRef.current || undefined,
        fileId,
        fileOwnerId,
        fileName: currentFileName,
        currentPage,
        isLocalOnly,
        fileBuffer: activeFileBufferRef.current || undefined
      });
    }
  }, [currentPage, pdfDoc, fileId, currentFileName, fileOwnerId, isLocalOnly]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // Sync currentJob with currentPage (Virtual Job)
  useEffect(() => {
    if (numPages > 0) {
      const newJob = Math.ceil(currentPage / PAGES_PER_JOB);
      if (newJob !== currentJob) {
        setCurrentJob(newJob);
      }
    }
  }, [currentPage, numPages, currentJob]);

  const [isTranslating, setIsTranslating] = useState(false);
  const isTranslatingRef = useRef(false);
  useEffect(() => {
    isTranslatingRef.current = isTranslating;
  }, [isTranslating]);
  const [selectedEngine, setSelectedEngine] = useState<TranslationEngine>(() => {
    const saved = localStorage.getItem('mediTrans_selectedEngine') as TranslationEngine;
    if (saved === 'gemini-3-flash-preview') return 'gemini-3.6-flash';
    return saved || 'gemini-flash-lite-latest';
  });

  const [customBaseUrl, setCustomBaseUrl] = useState<string>(() => {
    return localStorage.getItem('mediTrans_customBaseUrl') || 'https://api.shopaikey.com/v1';
  });

  const [customOpenAIModelNormal, setCustomOpenAIModelNormal] = useState<string>(() => {
    return localStorage.getItem('mediTrans_customOpenAIModelNormal') || localStorage.getItem('mediTrans_customOpenAIModel') || '';
  });

  const [customOpenAIModelDeep, setCustomOpenAIModelDeep] = useState<string>(() => {
    return localStorage.getItem('mediTrans_customOpenAIModelDeep') || '';
  });

  useEffect(() => {
    localStorage.setItem('mediTrans_selectedEngine', selectedEngine);
  }, [selectedEngine]);
  
  useEffect(() => {
    localStorage.setItem('mediTrans_customBaseUrl', customBaseUrl);
  }, [customBaseUrl]);

  useEffect(() => {
    localStorage.setItem('mediTrans_customOpenAIModelNormal', customOpenAIModelNormal);
    // Legacy fallback
    localStorage.setItem('mediTrans_customOpenAIModel', customOpenAIModelNormal);
  }, [customOpenAIModelNormal]);

  useEffect(() => {
    localStorage.setItem('mediTrans_customOpenAIModelDeep', customOpenAIModelDeep);
  }, [customOpenAIModelDeep]);
  
  const [engineKeys, setEngineKeys] = useState<Record<TranslationEngine, string>>(() => {
    const saved = localStorage.getItem('mediTrans_engineKeys');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { 
          'gemini-3.6-flash': parsed['gemini-3.6-flash'] || parsed['gemini-3-flash-preview'] || '',
          'gemini-3-flash-preview': parsed['gemini-3-flash-preview'] || '',
          'gemini-flash-lite-latest': parsed['gemini-flash-lite-latest'] || parsed['gemini-3.1-flash-lite-preview'] || parsed['gemini-flash'] || parsed['gemini-1.5-flash'] || '',
        };
      } catch (e) {
        console.error("Failed to parse engine keys:", e);
      }
    }
    
    return {
      'gemini-3.6-flash': '',
      'gemini-3-flash-preview': '',
      'gemini-flash-lite-latest': '',
    };
  });
  const [showSettings, setShowSettings] = useState(false);
  const [showApiSettings, setShowApiSettings] = useState(false);
  const [showProxyModal, setShowProxyModal] = useState(false);
  const [activeKeyFolder, setActiveKeyFolder] = useState<'all' | 'gemini' | 'shopaikey'>(() => {
    return (localStorage.getItem('mediTrans_activeKeyFolder') as any) || 'all';
  });

  useEffect(() => {
    localStorage.setItem('mediTrans_activeKeyFolder', activeKeyFolder);
  }, [activeKeyFolder]);

  const isKeyShopAIKey = (k: { value?: string; engine?: string }) => {
    const val = (k.value || '').trim();
    const eng = (k.engine || '').toLowerCase();
    return val.startsWith('sk-') || eng === 'shopaikey' || eng.includes('openai') || eng.includes('proxy');
  };

  const matchesKeyFolder = (k: { value?: string; engine?: string }, folder: 'all' | 'gemini' | 'shopaikey') => {
    if (folder === 'all') return true;
    const isShop = isKeyShopAIKey(k);
    if (folder === 'shopaikey') return isShop;
    if (folder === 'gemini') return !isShop;
    return true;
  };

  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [keyTestResults, setKeyTestResults] = useState<Record<string, { success: boolean; resultText?: string; error?: string; latencyMs?: number }>>({});
  const [newKeyTestResult, setNewKeyTestResult] = useState<{ success?: boolean; resultText?: string; error?: string; latencyMs?: number; loading?: boolean } | null>(null);

  const handleTestKey = async (keyId: string, keyValue: string) => {
    setTestingKeyId(keyId);
    try {
      const res = await translationService.current.testSingleKeyTranslation(keyValue, "Hello world! Testing translation AI.");
      setKeyTestResults(prev => ({
        ...prev,
        [keyId]: res
      }));
    } catch (err: any) {
      setKeyTestResults(prev => ({
        ...prev,
        [keyId]: { success: false, error: err.message || "Lỗi khi chạy thử" }
      }));
    } finally {
      setTestingKeyId(null);
    }
  };

  const handleTestNewKey = async () => {
    if (!newKey.value.trim()) return;
    setNewKeyTestResult({ loading: true });
    try {
      const res = await translationService.current.testSingleKeyTranslation(newKey.value, "Hello world! Testing translation AI.");
      setNewKeyTestResult({ ...res, loading: false });
    } catch (err: any) {
      setNewKeyTestResult({ success: false, error: err.message || "Lỗi khi chạy thử", loading: false });
    }
  };

  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [selectedPagesToDownload, setSelectedPagesToDownload] = useState<number[]>([]);
  const [uploadTasks, setUploadTasks] = useState<UploadTask[]>([]);
  const [showFolderSelectModal, setShowFolderSelectModal] = useState(false);
  const [driveFileToSave, setDriveFileToSave] = useState<any | null>(null);
  const [showDriveFolderModal, setShowDriveFolderModal] = useState<boolean>(false);
  const [allFolders, setAllFolders] = useState<{id: string, name: string, parentId?: string | null}[]>([]);
  const [isFirebaseConnected, setIsFirebaseConnected] = useState<boolean | null>(null);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error' | 'info'} | null>(null);
  
  // Sharing State
  const [showShareKeyModal, setShowShareKeyModal] = useState<any | null>(null);
  const [shareKeyEmail, setShareKeyEmail] = useState('');
  const [isSharingKey, setIsSharingKey] = useState(false);
  
  // Renaming State
  const [showRenameKeyModal, setShowRenameKeyModal] = useState<any | null>(null);
  const [renameKeyName, setRenameKeyName] = useState('');
  const [isUpdatingKeyName, setIsUpdatingKeyName] = useState(false);
  
  // Summarization State
  const [translationPanelMode, setTranslationPanelMode] = useState<'translation' | 'summary'>('translation');
  const [summaryText, setSummaryText] = useState<string>('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isSavingSummary, setIsSavingSummary] = useState(false);
  const [summaryRange, setSummaryRange] = useState<{from: number, to: number}>({from: 1, to: 1});
  const summarySignalRef = useRef<AbortController | null>(null);

  // Initialize summary range when numPages changes
  useEffect(() => {
    if (numPages > 0) {
      setSummaryRange(prev => ({ ...prev, to: Math.min(numPages, prev.from + 4) }));
    }
  }, [numPages]);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Test Firebase connection
  useEffect(() => {
    setIsFirebaseConnected(true);
  }, []);

  // Sync folders for late upload selection
  useEffect(() => {
    if (!user) {
      setAllFolders([]);
      return;
    }

    const q = query(collection(db, `users/${user.uid}/folders`), orderBy('name'));
    return onSnapshot(q, (snapshot) => {
      const folderList = snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.data().name,
        parentId: doc.data().parentId
      }));
      setAllFolders(folderList);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}/folders`);
    });
  }, [user]);

  // Helper to get full folder path
  const getFolderPath = (folderId: string | null): string => {
    if (!folderId) return 'Root';
    const folder = allFolders.find(f => f.id === folderId);
    if (!folder) return 'Unknown';
    
    const path = [folder.name];
    let currentParentId = folder.parentId;
    
    // Guard against circular refs or too deep structure
    let depth = 0;
    while (currentParentId && depth < 20) {
      const parent = allFolders.find(f => f.id === currentParentId);
      if (parent) {
        path.unshift(parent.name);
        currentParentId = parent.parentId;
      } else {
        break;
      }
      depth++;
    }
    
    return path.join(' / ');
  };

  const handleLocalFileOpen = async (localFile: File) => {
    setIsPdfLoading(true);
    setPdfError(null);
    setShowExplorer(false);
    setIsLocalOnly(true);
    setCurrentFileName(localFile.name);
    
    // On mobile, switch to split view automatically when opening a file
    if (window.innerWidth < 768) {
      setMobileViewMode('split');
    }
    
    // Generate a temporary docId for local file
    const docId = `local_${localFile.name.replace(/[^a-zA-Z0-9]/g, '_')}_${localFile.size}`;
    setFileId(docId);
    setFileOwnerId(user?.uid || null);

    // Increment fileId to invalidate all pending translations
    fileIdRef.current += 1;
    
    // Abort all pending translations
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    preTranslateControllersRef.current.forEach(controller => controller.abort());
    preTranslateControllersRef.current.clear();
    translatingPagesRef.current.clear();

    setFile(localFile);
    setTranslations({});
    setCurrentPage(1);
    setCurrentJob(1);
    setAutoTranslate(false);

    try {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      const url = URL.createObjectURL(localFile);
      setFileUrl(url);
      
      console.log(`[MediTrans AI] Loading local PDF: ${localFile.name}`);

      const loadingTask = pdfjs.getDocument({
        url,
        cMapUrl: `https://unpkg.com/pdfjs-dist@3.11.174/cmaps/`,
        cMapPacked: true,
        disableAutoFetch: false,
        disableStream: false,
      });

      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
    } catch (error: any) {
      console.error("Error loading local PDF:", error);
      setPdfError(`Không thể tải file PDF cục bộ: ${error.message || "Lỗi không xác định"}`);
    } finally {
      setIsPdfLoading(false);
    }
  };

  const startUpload = async (fileToUpload: File, folderId: string | null) => {
    // Immediately close folder select modal
    setShowFolderSelectModal(false);

    const user = auth.currentUser;
    if (!user) {
      showToast("Vui lòng đăng nhập để tải tệp lên Google Drive.", "info");
      return;
    }

    const taskId = Math.random().toString(36).substring(7);
    const newTask: UploadTask = {
      id: taskId,
      fileName: fileToUpload.name,
      status: 'uploading',
      progress: 0
    };

    setUploadTasks(prev => [newTask, ...prev]);

    try {
      // Upload directly to user's Google Drive
      const uploadedDriveFile = await uploadFileToDrive(fileToUpload);

      try {
        await addDoc(collection(db, `users/${user.uid}/documents`), {
          name: fileToUpload.name,
          folderId: folderId,
          ownerId: user.uid,
          sharedWith: [],
          driveFileId: uploadedDriveFile.id,
          downloadUrl: uploadedDriveFile.webViewLink || '',
          size: fileToUpload.size,
          type: fileToUpload.type,
          createdAt: serverTimestamp()
        });
      } catch (error: any) {
        console.warn("Could not save document record to Firestore:", error);
      }

      setIsLocalOnly(false);

      setUploadTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, status: 'success' } : t
      ));

      // Auto dismiss success toast quickly after 1.5s
      setTimeout(() => {
        setUploadTasks(prev => prev.filter(t => t.id !== taskId));
      }, 1500);
    } catch (error: any) {
      console.error("Error uploading to Google Drive:", error);
      setUploadTasks(prev => prev.map(t => 
        t.id === taskId ? { ...t, status: 'error' } : t
      ));
      showToast(`Lỗi tải lên Google Drive: ${error.message || 'Lỗi không xác định'}`, 'error');
    }
  };

  const dismissUploadTask = (id: string) => {
    setUploadTasks(prev => prev.filter(t => t.id !== id));
  };

  useEffect(() => {
    const checkKey = async () => {
      if (translationService.current) {
        const hasKey = await translationService.current.hasApiKey();
      }
    };
    checkKey();
  }, [selectedEngine, engineKeys]);

  const [serviceStatus, setServiceStatus] = useState<{model: string, totalKeys: number, activeKeys: number, lastUsedSuffix: string} | null>(null);
  const [isFullScreen, setIsFullScreen] = useState(false);
  const isFullScreenRef = useRef(false);

  // Periodic status update
  useEffect(() => {
    const updateStatus = () => {
      if (translationService.current instanceof GeminiService) {
        setServiceStatus((translationService.current as GeminiService).getStatusInfo());
      }
    };
    const interval = setInterval(updateStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  const toggleFullScreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        }
      }
    } catch (err) {
      console.error(`Error attempting to enable full-screen mode: ${err}`);
      // Fallback to internal state if native fails (e.g. in some iframe environments)
      setIsFullScreen(!isFullScreen);
    }
  };

  useEffect(() => {
    const handleFullScreenChange = () => {
      const isNativeFull = !!document.fullscreenElement;
      setIsFullScreen(isNativeFull);
      isFullScreenRef.current = isNativeFull;
      if (isNativeFull) {}
    };

    document.addEventListener('fullscreenchange', handleFullScreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullScreenChange);
  }, []);
  const [showTranslationPanel, setShowTranslationPanel] = useState(false);
  const [mobileViewMode, setMobileViewMode] = useState<'pdf' | 'translation' | 'split'>('pdf');
  const [isBulkTranslating, setIsBulkTranslating] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkTranslateProgress, setBulkTranslateProgress] = useState(0);
  const [bulkTranslateStatus, setBulkTranslateStatus] = useState<'translating' | 'completed' | 'failed' | 'idle'>('idle');
  const shouldAutoBulkRef = useRef(false);
  
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [autoTranslateLookAhead, setAutoTranslateLookAhead] = useState(3); // Reduced for quota efficiency
  const [zoom, setZoom] = useState(0.82); // Default to 82% as requested
  const [isAutoFit, setIsAutoFit] = useState(true);
  
  const [isPanning, setIsPanning] = useState(false);
  const [isLookupEnabled, setIsLookupEnabled] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, scrollLeft: 0, scrollTop: 0 });

  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const isRenderingRef = useRef(false);
  const renderRequestIdRef = useRef(0);
  const [pdfError, setPdfError] = useState<string | null>(null);
  
  const [fontSize, setFontSize] = useState<number>(() => {
    return Number(localStorage.getItem('mediTrans_fontSize')) || 15;
  });
  
  useEffect(() => {
    localStorage.setItem('mediTrans_fontSize', fontSize.toString());
  }, [fontSize]);

  const [fontFamily, setFontFamily] = useState<string>(() => {
    return localStorage.getItem('mediTrans_fontFamily') || 'Inter';
  });
  
  useEffect(() => {
    localStorage.setItem('mediTrans_fontFamily', fontFamily);
  }, [fontFamily]);
  
  // PDF Rendering Cache to prevent re-loading same pages during navigation
  const pageCacheRef = useRef<Map<number, { canvas: HTMLCanvasElement, zoom: number, textContent: any }>>(new Map());
  const CACHE_SIZE_LIMIT = 8; // Keep last 8 pages in memory for instant switching

  const [isAuthReady, setIsAuthReady] = useState(false);
  const [userRole, setUserRole] = useState<'admin' | 'user' | null>(null);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [authSyncError, setAuthSyncError] = useState<string | null>(null);
  const [apiActivationLink, setApiActivationLink] = useState<string | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeDatabaseId, setActiveDatabaseId] = useState<string | null>(null);
  const [isFetchingUsers, setIsFetchingUsers] = useState(false);
  const [adminUserSearch, setAdminUserSearch] = useState('');
  const [adminRoleFilter, setAdminRoleFilter] = useState<'all' | 'user' | 'admin' | 'blocked'>('all');
  const [adminNewUserEmail, setAdminNewUserEmail] = useState('');
  const [adminNewUserPassword, setAdminNewUserPassword] = useState('');
  const [adminNewUserDisplayName, setAdminNewUserDisplayName] = useState('');
  const [adminNewUserRole, setAdminNewUserRole] = useState<'user' | 'admin'>('user');
  const [pendingDeleteUid, setPendingDeleteUid] = useState<string | null>(null);
  const [pendingPasswordUid, setPendingPasswordUid] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authDisplayName, setAuthDisplayName] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showAdminNewUserPassword, setShowAdminNewUserPassword] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  
  const [ownedKeys, setOwnedKeys] = useState<any[]>([]);
  const [sharedKeys, setSharedKeys] = useState<any[]>([]);
  const [isOwnedKeysLoaded, setIsOwnedKeysLoaded] = useState(false);
  const [isSharedKeysLoaded, setIsSharedKeysLoaded] = useState(false);
  
  const isKeysLoading = user ? (!isOwnedKeysLoaded || !isSharedKeysLoaded) : false;

  const userKeys = useMemo(() => {
    const combined = [...ownedKeys];
    sharedKeys.forEach(sk => {
      if (!combined.find(k => k.id === sk.id)) {
        combined.push(sk);
      }
    });
    return combined;
  }, [ownedKeys, sharedKeys]);

  const hasValidKeysForFolder = useCallback((folder: 'all' | 'gemini' | 'shopaikey') => {
    const validVaultKeys = userKeys.filter(k => matchesKeyFolder(k, folder) && k.status !== 'error' && k.value?.trim());
    if (validVaultKeys.length > 0) return true;

    if (folder === 'gemini' || folder === 'all') {
      const geminiManual = engineKeys['gemini-flash-lite-latest'] || (import.meta as any).env?.VITE_GEMINI_API_KEY || (process as any).env?.GEMINI_API_KEY;
      if (geminiManual && geminiManual.trim()) return true;
    }
    if (folder === 'shopaikey' || folder === 'all') {
      const proxyManual = engineKeys['shopaikey'];
      if (proxyManual && proxyManual.trim()) return true;
    }

    return false;
  }, [userKeys, engineKeys]);

  const toggleAutoTranslate = useCallback(() => {
    if (!autoTranslate) {
      const folderLabel = activeKeyFolder === 'gemini' 
        ? 'Google Gemini' 
        : activeKeyFolder === 'shopaikey' 
        ? 'ShopAIKey / Proxy' 
        : 'Tất cả';

      if (!hasValidKeysForFolder(activeKeyFolder)) {
        showToast(`Nhóm Key hiện tại ('${folderLabel}') chưa có API Key khả dụng. Vui lòng chọn nhóm key khác hoặc thêm Key trước khi bật tự động dịch.`, 'error');
        setShowApiSettings(true);
        return;
      }
      showToast(`Đã bật Tự Động Dịch với nhóm Key: ${folderLabel}`, 'success');
    }
    setAutoTranslate(prev => !prev);
  }, [autoTranslate, activeKeyFolder, hasValidKeysForFolder]);

  const [selectedKeyId, setSelectedKeyId] = useState<string | null>(() => {
    return localStorage.getItem('selected_key_id');
  });

  // Auto-select key logic
  useEffect(() => {
    if (userKeys.length > 0) {
      const exists = userKeys.some(k => k.id === selectedKeyId);
      if (!selectedKeyId || !exists) {
        console.log(`[MediTrans AI] Auto-selecting first available key: ${userKeys[0].name}`);
        setSelectedKeyId(userKeys[0].id);
      }
    } else if (selectedKeyId && !isKeysLoading) {
      setSelectedKeyId(null);
    }
  }, [userKeys, selectedKeyId, isKeysLoading]);

  // Persist selected key id
  useEffect(() => {
    if (selectedKeyId) {
      localStorage.setItem('selected_key_id', selectedKeyId);
    } else {
      localStorage.removeItem('selected_key_id');
    }
  }, [selectedKeyId]);
  const [isAddingKey, setIsAddingKey] = useState(false);
  const [newKey, setNewKey] = useState({ name: '', value: '', engine: 'gemini' });
  const [keyToDelete, setKeyToDelete] = useState<any | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [keyCheckResults, setKeyCheckResults] = useState<{ 
    envKey: boolean; 
    manualKey: boolean; 
    envKeyName?: string;
    isVaultKey?: boolean;
    vaultKeyName?: string;
    totalActive?: number;
    totalChecked?: number;
  } | null>(null);
  const [isCheckingKeys, setIsCheckingKeys] = useState(false);

  const [hasDoneInitialCheck, setHasDoneInitialCheck] = useState(false);

  const performKeyCheck = async (silent: boolean = false) => {
    if (!silent) setIsCheckingKeys(true);
    try {
      // 1. Check Vault Keys 
      let activeVaultCount = 0;
      let currentVaultKeyResults = null;

      if (user && userKeys.length > 0) {
        const vaultKeysToCheck = userKeys.filter(k => {
          const vEng = (k.engine || 'gemini').toLowerCase();
          return vEng === 'gemini' || vEng.includes('gemini') || vEng.includes('shopaikey') || vEng.includes('openai') || k.value?.startsWith('sk-') || k.value?.startsWith('AIzaSy');
        });
        
        // Run checks in parallel
        const checkPromises = vaultKeysToCheck.map(async (vKey) => {
          const vService = new GeminiService(vKey.value, vKey.engine || selectedEngine);
          const vRes = await vService.checkAvailableKeys();
          const isActive = vRes.manualKey;
          
          if (isActive) activeVaultCount++;
          
          // Update Firestore for each key
          try {
            await updateDoc(doc(db, 'apiKeys', vKey.id), {
              lastUsed: serverTimestamp(),
              status: isActive ? 'active' : 'error'
            });
          } catch (e: any) {
            handleFirestoreError(e, OperationType.UPDATE, `apiKeys/${vKey.id}`);
          }
          
          // If this is the currently selected key, store its result for the notification
          if (vKey.id === selectedKeyId) {
            currentVaultKeyResults = {
              isActive,
              name: vKey.name
            };
          }
          
          return { id: vKey.id, isActive };
        });

        await Promise.all(checkPromises);
      }

      // 3. Set results for UI only if not silent
      if (!silent) {
        setKeyCheckResults({
          envKey: false,
          manualKey: currentVaultKeyResults ? currentVaultKeyResults.isActive : false,
          envKeyName: "",
          isVaultKey: !!currentVaultKeyResults,
          vaultKeyName: currentVaultKeyResults?.name || '',
          totalActive: activeVaultCount,
          totalChecked: (userKeys.filter(k => k.engine === (selectedEngine.startsWith('gemini') ? 'gemini' : selectedEngine)).length)
        });
        
        // Auto-hide after 10 seconds
        setTimeout(() => setKeyCheckResults(null), 10000);
      }
      
      setHasDoneInitialCheck(true);
    } catch (e) {
      console.error("Key check failed:", e);
    } finally {
      if (!silent) setIsCheckingKeys(false);
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthReady(true);
      
      if (currentUser) {
        // Ensure user profile exists in Firestore
        const path = `users/${currentUser.uid}`;
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          let userSnap = null;
          try {
            userSnap = await getDoc(userRef);
          } catch (getErr: any) {
            console.warn('[Auth] Could not fetch user doc:', getErr?.message);
          }
          
          // CRITICAL: Always check if this specific email or UID should be admin
          const isAdminUser = currentUser.uid === "4cFbfQhPMpgStJXZ9EpAVcd90i33" ||
                              currentUser.email?.toLowerCase() === "hoanghiep1296@gmail.com" || 
                              currentUser.email?.toLowerCase() === "mrihachnach@gmail.com";
          
          console.log(`[Auth] User logged in: ${currentUser.email} (UID: ${currentUser.uid}). Admin check: ${isAdminUser}`);
          
          if (!userSnap || !userSnap.exists()) {
            console.log(`[Auth] Creating new user profile for ${currentUser.email}`);
            try {
              await setDoc(userRef, {
                uid: currentUser.uid,
                email: currentUser.email,
                displayName: currentUser.displayName,
                photoURL: currentUser.photoURL,
                createdAt: serverTimestamp(),
                role: isAdminUser ? 'admin' : 'user',
                isBlocked: false
              }, { merge: true });
            } catch (writeError: any) {
              console.error(`[Auth] Failed to create user profile:`, writeError);
              // We'll still set the local role for UI purposes
            }
            setUserRole(isAdminUser ? 'admin' : 'user');
          } else {
            const data = userSnap.data();
            console.log(`[Auth] Existing user profile found. DB Role: ${data?.role}`);
            
            // Check if user is blocked
            if (data?.isBlocked && !isAdminUser) {
              console.warn("User is blocked, logging out...");
              showToast("Tài khoản của bạn đã bị khóa bởi quản trị viên.", 'error');
              await signOut(auth);
              setUser(null);
              setIsAuthReady(true);
              return;
            }

            let currentRole = data?.role || 'user';
            // If it's an admin user but role is not admin in DB, update it
            if (isAdminUser && currentRole !== 'admin') {
              console.log(`[Auth] Upgrading user ${currentUser.email} to admin role in DB`);
              try {
                await updateDoc(userRef, { role: 'admin' });
              } catch (updateError: any) {
                console.error(`[Auth] Failed to update role to admin:`, updateError);
              }
              setUserRole('admin');
            } else {
              setUserRole(isAdminUser ? 'admin' : currentRole);
            }
          }
        } catch (error: any) {
          console.error("Error fetching user data from Firestore:", error);
          
          // Fallback if Firestore is completely blocked
          const isAdminUser = currentUser.uid === "4cFbfQhPMpgStJXZ9EpAVcd90i33" ||
                              currentUser.email?.toLowerCase() === "hoanghiep1296@gmail.com" || 
                              currentUser.email?.toLowerCase() === "mrihachnach@gmail.com";
          
          console.log(`[Auth] Firestore fallback triggered. Forcing admin: ${isAdminUser}`);
          if (isAdminUser) {
            setUserRole('admin');
          } else {
            setUserRole('user');
          }
          
          // Only show error if it's not a common permission issue during setup
          if (!error.message?.includes('permission-denied') && !error.message?.includes('insufficient permissions')) {
            handleFirestoreError(error, OperationType.WRITE, path);
          }
        }
      } else {
        setUserRole(null);
        setShowAdminPanel(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Auto-restore active document session on page reload
  useEffect(() => {
    if (!isAuthReady) return;

    let isSubscribed = true;
    const restoreSession = async () => {
      try {
        const activeSession = await getActiveDocSession();
        if (!activeSession || !isSubscribed) return;

        const docKey = activeSession.fileId || activeSession.fileName;
        if (docKey) {
          const cachedTrans = await getTranslationsCache(docKey);
          if (cachedTrans && Object.keys(cachedTrans).length > 0 && isSubscribed) {
            setTranslations(cachedTrans);
          }
        }

        if (activeSession.fileData) {
          activeFileDataRef.current = activeSession.fileData;
          await handleFileSelectFromExplorer(activeSession.fileData, true);
          if (activeSession.currentPage > 1 && isSubscribed) {
            setCurrentPage(activeSession.currentPage);
          }
        } else if (activeSession.driveFile) {
          activeDriveFileRef.current = activeSession.driveFile;
          await handleOpenDriveFile(activeSession.driveFile, true);
          if (activeSession.currentPage > 1 && isSubscribed) {
            setCurrentPage(activeSession.currentPage);
          }
        } else if (activeSession.fileBuffer) {
          activeFileBufferRef.current = activeSession.fileBuffer;
          setShowExplorer(false);
          setIsPdfLoading(true);
          setCurrentFileName(activeSession.fileName);
          setFileId(activeSession.fileId || null);
          setIsLocalOnly(true);
          try {
            const loadingTask = pdfjs.getDocument({
              data: activeSession.fileBuffer,
              cMapUrl: `https://unpkg.com/pdfjs-dist@3.11.174/cmaps/`,
              cMapPacked: true,
            });
            const pdf = await loadingTask.promise;
            if (isSubscribed) {
              setPdfDoc(pdf);
              setNumPages(pdf.numPages);
              if (activeSession.currentPage > 1) {
                setCurrentPage(activeSession.currentPage);
              }
            }
          } catch (e) {
            console.error("Error restoring PDF from buffer:", e);
          } finally {
            if (isSubscribed) setIsPdfLoading(false);
          }
        }
      } catch (err) {
        console.warn("Failed to restore previous session:", err);
      }
    };

    restoreSession();
    return () => {
      isSubscribed = false;
    };
  }, [isAuthReady]);

  // Real-time security listener: Force logout if blocked
  useEffect(() => {
    if (!user) return;

    // Listen to user's own document
    const userDocRef = doc(db, 'users', user.uid);
    const unsubscribeUser = onSnapshot(userDocRef, async (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        
        // CRITICAL: Admins are immune to blocking to prevent accidental lockout
        const isAdminUser = user.uid === "4cFbfQhPMpgStJXZ9EpAVcd90i33" ||
                            user.email?.toLowerCase() === "hoanghiep1296@gmail.com" || 
                            user.email?.toLowerCase() === "mrihachnach@gmail.com";

        if (data?.isBlocked && !isAdminUser) {
          console.warn("User has been blocked remotely. Logging out...");
          showToast("Tài khoản của bạn đã bị khóa bởi quản trị viên.", 'error');
          await signOut(auth);
          return;
        }

        const effectiveRole = (isAdminUser || data?.role === 'admin') ? 'admin' : (data?.role || 'user');
        if (effectiveRole !== userRole) {
          console.log(`[Auth Listener] Setting effective userRole: ${effectiveRole}`);
          setUserRole(effectiveRole);
        }
      }
    }, (error) => {
      console.warn("User profile snapshot listener failed:", error);
      // Suppressing JSON toast for this specific background listener to avoid irritation
    });

    return () => {
      unsubscribeUser();
    };
  }, [user, userRole]);

  // Perform key check when user logs in and keys are loaded
  useEffect(() => {
    if (user && isAuthReady && !hasDoneInitialCheck) {
      // Automatic key check disabled to save quota as requested by user
      setHasDoneInitialCheck(true);
    }
  }, [user, isAuthReady, hasDoneInitialCheck]);

  // Keys are now handled at the top of the component

  useEffect(() => {
    if (!user) {
      setOwnedKeys([]);
      setIsOwnedKeysLoaded(true);
      return;
    }
    const q = query(collection(db, 'apiKeys'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setOwnedKeys(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setIsOwnedKeysLoaded(true);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'apiKeys');
      setIsOwnedKeysLoaded(true);
    });
    return () => unsubscribe();
  }, [user, isLocalOnly]);

  useEffect(() => {
    const userEmail = user?.email?.trim().toLowerCase();
    if (!user || !userEmail || isLocalOnly) {
      setSharedKeys([]);
      setIsSharedKeysLoaded(true);
      return;
    }
    
    console.log(`[MediTrans] Listening for shared keys for: ${userEmail}`);
    const q = query(
      collection(db, 'apiKeys'), 
      where('sharedWith', 'array-contains', userEmail)
    );
    
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const keys = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      console.log(`[MediTrans] Found ${keys.length} shared keys`);
      setSharedKeys(keys);
      setIsSharedKeysLoaded(true);
    }, (error) => {
      console.error("Error fetching shared keys:", error);
      setIsSharedKeysLoaded(true);
    });
    return () => unsubscribe();
  }, [user, isLocalOnly]);

  // Keys are now handled by useMemo and direct effects

  const handleGoogleAuth = async () => {
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.addScope('https://www.googleapis.com/auth/drive.readonly');
      provider.addScope('https://www.googleapis.com/auth/drive.file');
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      const userRef = doc(db, 'users', user.uid);
      const isAdminUser = user.uid === "4cFbfQhPMpgStJXZ9EpAVcd90i33" ||
                          user.email?.toLowerCase() === "hoanghiep1296@gmail.com" || 
                          user.email?.toLowerCase() === "mrihachnach@gmail.com";
      try {
        await setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName || user.email?.split('@')[0],
          photoURL: user.photoURL || null,
          createdAt: serverTimestamp(),
          role: isAdminUser ? 'admin' : 'user',
          isBlocked: false
        }, { merge: true });
      } catch (fsErr) {
        console.error("Firestore user creation error:", fsErr);
      }

      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setGoogleOAuthToken(credential.accessToken);
        try {
          await getOrCreateMediTransFolder(credential.accessToken);
          console.log('[MediTrans] MediTrans AI folder verified/created on Google Drive.');
        } catch (folderErr) {
          console.warn('[MediTrans] Could not verify/create MediTrans AI folder on Drive during login:', folderErr);
        }
      }

      setShowAuthModal(false);
      showToast("Đăng nhập bằng Gmail (Google) thành công!", "success");
    } catch (error: any) {
      console.error("Google auth failed:", error);
      if (error.code === 'auth/unauthorized-domain') {
        setAuthError("Tên miền này chưa được ủy quyền trên Firebase Console (thêm meditrans.vercel.app vào Authorized domains).");
      } else {
        setAuthError(`Đăng nhập Google thất bại: ${error.message || 'Lỗi không xác định'}`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoggingIn) return;
    setIsLoggingIn(true);
    setAuthError(null);

    const cleanEmail = authEmail.trim();
    if (!cleanEmail) {
      setAuthError("Vui lòng nhập địa chỉ Email.");
      setIsLoggingIn(false);
      return;
    }

    try {
      if (authMode === 'register') {
        if (!authDisplayName.trim()) {
          setAuthError("Vui lòng nhập tên hiển thị.");
          setIsLoggingIn(false);
          return;
        }
        
        // 1. Create auth user
        const userCredential = await createUserWithEmailAndPassword(auth, cleanEmail, authPassword);
        const newUser = userCredential.user;
        
        // 2. Update profile with display name
        await updateProfile(newUser, {
          displayName: authDisplayName.trim()
        });
        
        // 3. Create Firestore user document explicitly (to ensure immediate availability)
        const userRef = doc(db, 'users', newUser.uid);
        
        // Check if UID/Email should be admin
        const isAdminUser = newUser.uid === "4cFbfQhPMpgStJXZ9EpAVcd90i33" ||
                            newUser.email?.toLowerCase() === "hoanghiep1296@gmail.com" || 
                            newUser.email?.toLowerCase() === "mrihachnach@gmail.com";
        
        try {
          await setDoc(userRef, {
            uid: newUser.uid,
            email: newUser.email,
            displayName: authDisplayName.trim(),
            photoURL: newUser.photoURL || null,
            createdAt: serverTimestamp(),
            role: isAdminUser ? 'admin' : 'user',
            isBlocked: false
          }, { merge: true });
          console.log(`[Signup] Firestore document created for ${newUser.email}`);
        } catch (fsError) {
          console.error("[Signup] Firestore profile creation failed:", fsError);
          // If this fails, onAuthStateChanged fallback will try it again
        }
        
        showToast("Đăng ký thành công!", 'success');
      } else {
        await signInWithEmailAndPassword(auth, cleanEmail, authPassword);
      }
      setShowAuthModal(false);
      setAuthEmail('');
      setAuthPassword('');
      setAuthDisplayName('');
    } catch (error: any) {
      console.error("Email auth failed:", error);
      if (error.code === 'auth/email-already-in-use') {
        setAuthError("Email này đã được sử dụng. Vui lòng chọn Đăng nhập.");
      } else if (
        error.code === 'auth/invalid-credential' ||
        error.code === 'auth/user-not-found' ||
        error.code === 'auth/wrong-password'
      ) {
        setAuthError("Email hoặc mật khẩu không chính xác. Nếu chưa có tài khoản, hãy chọn tab Đăng ký.");
      } else if (error.code === 'auth/invalid-email') {
        setAuthError("Định dạng Email không hợp lệ.");
      } else if (error.code === 'auth/weak-password') {
        setAuthError("Mật khẩu quá yếu (tối thiểu 6 ký tự).");
      } else {
        setAuthError(`Xác thực thất bại (${error.code || 'Lỗi không xác định'}). Vui lòng kiểm tra lại thông tin.`);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem('mediTrans_selectedKeyId');
      setSelectedKeyId(null);
      clearActiveDocSession();
      clearFile();
      setPdfError(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const handleAddKey = async () => {
    if (!user || !newKey.name || !newKey.value) return;
    const path = 'apiKeys';
    try {
      await setDoc(doc(collection(db, 'apiKeys')), {
        ownerId: user.uid,
        name: newKey.name,
        value: newKey.value,
        engine: newKey.engine,
        createdAt: serverTimestamp(),
        lastUsed: serverTimestamp()
      });
      setNewKey({ name: '', value: '', engine: 'gemini' });
      setIsAddingKey(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, path);
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    const path = `apiKeys/${keyId}`;
    try {
      await deleteDoc(doc(db, 'apiKeys', keyId));
      if (selectedKeyId === keyId) setSelectedKeyId(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleShareKey = async () => {
    if (!user || !showShareKeyModal || !shareKeyEmail.trim()) return;
    setIsSharingKey(true);
    const targetEmail = shareKeyEmail.trim().toLowerCase();
    try {
      const docRef = doc(db, 'apiKeys', showShareKeyModal.id);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        const currentSharedWith = (data.sharedWith || []).map((e: string) => e.toLowerCase());
        
        if (!currentSharedWith.includes(targetEmail)) {
          await updateDoc(docRef, {
            sharedWith: [...(data.sharedWith || []), targetEmail]
          });
          showToast(`Đã chia sẻ Key với ${targetEmail}`, 'success');
        } else {
          showToast(`Key đã được chia sẻ với ${targetEmail} rồi`, 'info');
        }
      }
      setShareKeyEmail('');
      setShowShareKeyModal(null);
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `apiKeys/${showShareKeyModal.id}`);
    } finally {
      setIsSharingKey(false);
    }
  };

  const handleUpdateKeyName = async () => {
    if (!user || !showRenameKeyModal || !renameKeyName.trim()) return;
    setIsUpdatingKeyName(true);
    try {
      const docRef = doc(db, 'apiKeys', showRenameKeyModal.id);
      await updateDoc(docRef, {
        name: renameKeyName.trim()
      });
      showToast(`Đã đổi tên Key thành "${renameKeyName.trim()}"`, 'success');
      setShowRenameKeyModal(null);
      setRenameKeyName('');
    } catch (error: any) {
      handleFirestoreError(error, OperationType.UPDATE, `apiKeys/${showRenameKeyModal.id}`);
    } finally {
      setIsUpdatingKeyName(false);
    }
  };

  const [isDiagnosticModalOpen, setIsDiagnosticModalOpen] = useState(false);
  const [diagnosticResults, setDiagnosticResults] = useState<any>(null);
  const [isRunningDiagnostics, setIsRunningDiagnostics] = useState(false);

  const runDiagnostics = async () => {
    setIsRunningDiagnostics(true);
    try {
      const idToken = await auth.currentUser?.getIdToken();
      const response = await fetch("/api/admin/diagnostics", {
        headers: {
          'Authorization': `Bearer ${idToken}`
        }
      });
      const data = await handleApiResponse(response);
      setDiagnosticResults(data);
      setIsDiagnosticModalOpen(true);
    } catch (error: any) {
      console.error("Diagnostics failed:", error);
      showToast("Không thể chạy chẩn đoán: " + error.message, 'error');
    } finally {
      setIsRunningDiagnostics(false);
    }
  };

  const handleApiResponse = async (response: Response) => {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch (e) {
      console.error("Non-JSON API response:", text);
      throw new Error(`Lỗi phản hồi từ máy chủ (${response.status}): ${text.substring(0, 100)}`);
    }
  };

  const fetchAllUsers = async () => {
    if (userRole !== 'admin' || !user) return;
    setIsFetchingUsers(true);
    
    let fetchedUsers: any[] = [];
    let firestoreError: any = null;

    // 1. First, try to fetch directly from Firestore (Client SDK)
    try {
      const querySnapshot = await getDocs(collection(db, 'users'));
      fetchedUsers = querySnapshot.docs.map(doc => ({
        ...doc.data(),
        uid: doc.id
      }));
      
      // Sort by createdAt (newest first)
      fetchedUsers.sort((a: any, b: any) => {
        const getTime = (val: any) => {
          if (!val) return 0;
          if (typeof val.toDate === 'function') return val.toDate().getTime();
          if (val._seconds) return val._seconds * 1000;
          const date = new Date(val);
          return isNaN(date.getTime()) ? 0 : date.getTime();
        };
        return getTime(b.createdAt) - getTime(a.createdAt);
      });
      
      setAllUsers(fetchedUsers);
      console.log(`[MediTrans AI] Directly fetched ${fetchedUsers.length} users from Firestore.`);
      
      // Stop here if successful to avoid redundant REST calls that might 403
      setIsFetchingUsers(false);
      return;
    } catch (e: any) {
      console.warn("Direct Firestore fetch failed, will try backend fallback:", e.message);
      firestoreError = e;
    }

    // 2. Try to enrich or fallback with Auth data from Admin API
    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/list-users', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (response.ok) {
        const data = await handleApiResponse(response);
        if (data.success && data.users) {
          setAuthSyncError(data.authSyncError || null);
          setApiActivationLink(data.apiLink || null);
          
          if (fetchedUsers.length > 0) {
            // Case A: Enrich existing Firestore list
            setAllUsers(prev => prev.map(u => {
              const authUser = data.users.find((au: any) => au.uid === u.uid);
              return authUser ? { ...u, ...authUser } : u;
            }));
          } else {
            // Case B: Fallback - use data from Backend if Firestore fetch failed
            console.log(`[MediTrans AI] Using backend list-users as fallback.`);
            const backendUsers = data.users.map((u: any) => ({
              ...u,
              uid: u.uid || u.localId,
              role: u.role || 'user'
              // Note: missing fields like createdAt will be merged if they exist in Auth but Backend might not return all Firestore fields
            }));
            setAllUsers(backendUsers);
          }
        }
      } else if (firestoreError) {
        // Only error if BOTH failed
        handleFirestoreError(firestoreError, OperationType.LIST, 'users');
      }
    } catch (adminError) {
      console.warn("Admin API enrichment/fallback failed:", adminError);
      if (firestoreError) {
        handleFirestoreError(firestoreError, OperationType.LIST, 'users');
      }
    } finally {
      setIsFetchingUsers(false);
    }
  };

  const adminChangeUserPassword = (uid: string, email: string) => {};
  const sendAdminPasswordResetEmail = (email: string) => {};

  const createNewUser = async (userData: any) => {
    if (userRole !== 'admin' || !user) {
      throw new Error("Bạn không có quyền thực hiện hành động này");
    }
    
    // Basic validation
    if (!userData.email || !userData.email.includes('@')) {
      throw new Error("Email không hợp lệ");
    }
    if (!userData.password || userData.password.length < 6) {
      throw new Error("Mật khẩu phải có ít nhất 6 ký tự");
    }

    try {
      const token = await user.getIdToken();
      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(userData)
      });
      
      const data = await handleApiResponse(response);
      
      if (response.ok && data.success) {
        // If server-side DB write failed, try from client (Admin has permission)
        if (!data.dbSuccess && data.userData) {
          console.log("Server-side DB write failed, retrying from client...");
          try {
            const uid = data.uid;
            const email = data.userData.email;
            
            await setDoc(doc(db, 'users', uid), {
              ...data.userData,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp()
            });
            
            console.log("Client-side DB write successful");
          } catch (clientDbError: any) {
            handleFirestoreError(clientDbError, OperationType.CREATE, `users/${data.uid}`);
          }
        }
        
        await fetchAllUsers();
        return true;
      } else {
        if (data.apiLink) setApiActivationLink(data.apiLink);
        throw new Error(data.details || data.error || "Không thể tạo người dùng");
      }
    } catch (error: any) {
      console.error("Error creating user:", error);
      throw error;
    }
  };

  const toggleBlockUser = async (uid: string, email: string, currentBlocked: boolean) => {
    if (userRole !== 'admin' || !user) return;
    
    // Don't allow blocking admins
    const isAdminEmail = email?.toLowerCase() === "hoanghiep1296@gmail.com" || 
                         email?.toLowerCase() === "mrihachnach@gmail.com" || 
                         email?.toLowerCase() === "admin@gmail.com" || 
                         email?.toLowerCase() === "hoctap853@gmail.com";
    if (isAdminEmail && !currentBlocked) {
      showToast("Không thể chặn tài khoản quản trị viên.", 'error');
      return;
    }

    try {
      await updateDoc(doc(db, 'users', uid), {
        isBlocked: !currentBlocked,
        updatedAt: serverTimestamp()
      });
      
      showToast(currentBlocked ? `Đã khôi phục tài khoản ${email}` : `Đã chặn tài khoản ${email}`, 'success');
      await fetchAllUsers();
    } catch (error: any) {
      console.error("Error toggling block status:", error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };



  const updateUserRole = async (uid: string, email: string, newRole: 'user' | 'admin') => {
    if (userRole !== 'admin' || !user) return;
    
    try {
      await setDoc(doc(db, 'users', uid), {
        role: newRole,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      showToast(`Đã cập nhật vai trò thành ${newRole === 'admin' ? 'Quản trị viên' : 'Thành viên'}`, 'success');
      await fetchAllUsers();
    } catch (error: any) {
      console.error("Error updating role:", error);
      handleFirestoreError(error, OperationType.UPDATE, `users/${uid}`);
    }
  };



  const deleteUserAccount = async (uid: string, email: string) => {
    if (userRole !== 'admin' || !user) {
      console.warn("[Admin] Permission denied for delete operation");
      return;
    }

    // Debug log
    console.log(`[Admin] Attempting to delete user: ${email} (${uid})`);

    // Protection for root admin
    const isRootAdmin = email?.toLowerCase() === "hoanghiep1296@gmail.com" || 
                        email?.toLowerCase() === "mrihachnach@gmail.com";
    if (isRootAdmin) {
      showToast("Không thể xóa tài khoản Quản trị viên hệ thống.", 'error');
      return;
    }

    showToast(`Đang thực hiện xóa tài khoản ${email}...`, 'info');

    try {
      console.log("[Admin] Fetching idToken...");
      const token = await user.getIdToken();
      
      console.log("[Admin] Sending request to server...");
      showToast("Đang gửi yêu cầu xóa đến máy chủ...", 'info');
      
      const response = await fetch('/api/admin/delete-user', {
        method: 'POST',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ uid, email })
      });
      
      console.log("[Admin] Server response status:", response.status);
      
        if (!response.ok) {
          const errorText = await response.text();
          console.error("[Admin] Server returned error:", errorText);
          let errorMessage = "Lỗi khi xóa người dùng";
          let details = "";
          try {
            const errorJson = JSON.parse(errorText);
            errorMessage = errorJson.error || errorMessage;
            details = errorJson.details || "";
          } catch (e) {}
          
          showToast(errorMessage + (details ? `. ${details}` : ""), 'error');
          return;
        }

      const data = await response.json();
      console.log("[Admin] Server response data:", data);

      if (data.success) {
        showToast(`Đã xóa tài khoản ${email} thành công.`, 'success');
        setPendingDeleteUid(null);
        await fetchAllUsers();
      } else {
        showToast(data.error || "Không thể xóa người dùng", 'error');
      }
    } catch (error: any) {
      console.error("[Admin] Error deleting user:", error);
      showToast("Lỗi khi xóa người dùng: " + error.message, 'error');
    }
  };




  const handleDownload = async (pagesToDownload?: number[]) => {
    const pages = pagesToDownload || [currentPage];
    const availablePages = pages.filter(p => translations[p]?.status === 'success');
    
    if (availablePages.length === 0) return;

    try {
      const allChildren: Paragraph[] = [];
      
      for (const pageNum of availablePages) {
        const content = translations[pageNum]?.content;
        if (!content) continue;

        // Add page header
        allChildren.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: "center",
          spacing: { before: 400, after: 200 },
          children: [
            new TextRun({
              text: `Trang ${pageNum}`,
              bold: true,
              color: "4F46E5",
              size: 32,
              font: "Times New Roman"
            })
          ]
        }));

        const lines = content.split('\n');
        const pageParagraphs = lines.map(line => {
          let text = line.trim();
          if (!text) return new Paragraph({ spacing: { after: 120 }, children: [new TextRun("")] });

          let isHeading = false;
          let headingLevel: any = undefined;

          if (text.startsWith('### ')) {
            text = text.replace('### ', '');
            isHeading = true;
            headingLevel = HeadingLevel.HEADING_3;
          } else if (text.startsWith('## ')) {
            text = text.replace('## ', '');
            isHeading = true;
            headingLevel = HeadingLevel.HEADING_2;
          } else if (text.startsWith('# ')) {
            text = text.replace('# ', '');
            isHeading = true;
            headingLevel = HeadingLevel.HEADING_1;
          }

          let isBullet = false;
          if (text.startsWith('- ') || text.startsWith('* ')) {
            text = text.substring(2);
            isBullet = true;
          }

          return new Paragraph({
            heading: isHeading ? headingLevel : undefined,
            bullet: isBullet ? { level: 0 } : undefined,
            spacing: { after: 120 },
            children: [
              new TextRun({
                text: text,
                size: isHeading ? 28 : 24,
                font: "Times New Roman",
                bold: isHeading
              })
            ]
          });
        });

        allChildren.push(...pageParagraphs);
        
        // Add page break if not the last page
        if (pageNum !== availablePages[availablePages.length - 1]) {
          allChildren.push(new Paragraph({
            children: [new TextRun({ text: "", break: 1 })]
          }));
        }
      }

      const doc = new Document({
        sections: [{
          properties: {},
          children: allChildren,
        }],
      });

      const blob = await Packer.toBlob(doc);
      const fileName = availablePages.length === 1 
        ? `MediTrans_Trang_${availablePages[0]}.docx` 
        : `MediTrans_Tong_Hop_${availablePages.length}_Trang.docx`;
      saveAs(blob, fileName);
    } catch (error) {
      console.error("Error generating docx:", error);
      // Fallback to markdown if docx fails (just for the first page if multiple)
      const firstPageContent = translations[availablePages[0]]?.content || "";
      const blob = new Blob([firstPageContent], { type: 'text/markdown' });
      saveAs(blob, `MediTrans_Trang_${availablePages[0]}.md`);
    }
  };

  const clearFile = () => {
    if (fileUrl && fileUrl.startsWith('blob:')) URL.revokeObjectURL(fileUrl);
    
    // Increment fileId to invalidate all pending translations for the previous file
    fileIdRef.current += 1;
    
    // Abort all pending translations
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    preTranslateControllersRef.current.forEach(controller => controller.abort());
    preTranslateControllersRef.current.clear();
    
    setFile(null);
    setCurrentFileName('');
    setFileUrl(null);
    setFileId(null);
    setPdfDoc(null);
    lastRenderedImageRef.current = null;
    setNumPages(0);
    setCurrentPage(1);
    setCurrentJob(1);
    setTranslations({});
    setPdfError(null);
    isRenderingRef.current = false;
    translatingPagesRef.current.clear();
    
    // Reset Summary State
    setTranslationPanelMode('translation');
    setSummaryText('');
    setIsSummarizing(false);
    if (summarySignalRef.current) {
      summarySignalRef.current.abort();
    }
    
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
    }

    clearActiveDocSession();
    setShowExplorer(true);
  };

  const handleGoHome = () => {
    setPdfError(null);
    setShowAdminPanel(false);
    clearFile();
  };

  const handleDeleteCurrentFile = async () => {
    if (!fileId || isLocalOnly) {
      clearFile();
      return;
    }

    if (window.confirm(`Bạn có chắc chắn muốn XÓA vĩnh viễn tệp "${currentFileName}" khỏi hệ thống? Hành động này không thể hoàn tác.`)) {
      const uId = auth.currentUser?.uid;
      try {
        if (!uId) {
          showToast("Vui lòng đăng nhập để thực hiện thao tác này", 'error');
          return;
        }
        
        await deleteDoc(doc(db, `users/${uId}/documents`, fileId));
        showToast("Đã xóa tài liệu thành công", 'success');
        clearFile();
      } catch (error: any) {
        console.error("Lỗi khi xóa tài liệu:", error);
        handleFirestoreError(error, OperationType.DELETE, `users/${uId}/documents/${fileId}`);
      }
    }
  };

  const handleSummarize = async (type: 'page' | 'document' | 'chapter') => {
    if (!translationService.current) return;
    
    let contentToSummarize = "";
    
    if (type === 'page') {
      contentToSummarize = translations[currentPage]?.content || "";
      if (!contentToSummarize) {
        showToast("Vui lòng dịch trang này trước khi tóm tắt.", 'info');
        return;
      }
    } else if (type === 'chapter') {
      const startPage = Math.max(1, summaryRange.from);
      const endPage = Math.min(numPages, summaryRange.to);
      
      if (startPage > endPage) {
        showToast("Khoảng trang không hợp lệ.", 'error');
        return;
      }

      const pages = Object.keys(translations)
        .map(Number)
        .filter(p => p >= startPage && p <= endPage)
        .sort((a, b) => a - b);
        
      if (pages.length === 0) {
        showToast(`Không tìm thấy trang nào được dịch trong khoảng từ ${startPage} đến ${endPage}.`, 'info');
        return;
      }
      
      contentToSummarize = pages
        .map(p => `--- Trang ${p} ---\n${translations[p].content}`)
        .join("\n\n");

      if (pages.length < (endPage - startPage + 1)) {
        showToast(`Đang tóm tắt dựa trên ${pages.length} trang đã dịch trong khoảng từ ${startPage} đến ${endPage}.`, 'info');
      }
    } else if (type === 'document') {
      // Collect all translated pages
      const pages = Object.keys(translations).map(Number).sort((a, b) => a - b);
      if (pages.length === 0) {
        showToast("Chưa có nội dung nào được dịch để tóm tắt.", 'info');
        return;
      }
      
      contentToSummarize = pages
        .map(p => `--- Trang ${p} ---\n${translations[p].content}`)
        .join("\n\n");
        
      if (type === 'document' && pages.length < numPages) {
        if (!window.confirm(`Bạn mới chỉ dịch ${pages.length}/${numPages} trang. Bạn có muốn tóm tắt dựa trên những trang đã dịch không?`)) {
          return;
        }
      }
    }

    setTranslationPanelMode('summary');
    setSummaryText('');
    setIsSummarizing(true);
    
    if (summarySignalRef.current) {
      summarySignalRef.current.abort();
    }
    summarySignalRef.current = new AbortController();
    
    try {
      const g = (translationService.current as any).summarizeContent(
        contentToSummarize, 
        type, 
        summarySignalRef.current.signal
      );
      
      let fullSummary = "";
      for await (const chunk of g) {
        fullSummary += chunk;
        setSummaryText(fullSummary);
      }
    } catch (error: any) {
      if (error.message !== "Summarization aborted" && error.message !== "Aborted") {
        console.error("Summarization error:", error);
        showToast(`Lỗi tóm tắt: ${formatErrorMessage(error)}`, 'error');
      }
    } finally {
      setIsSummarizing(false);
      summarySignalRef.current = null;
    }
  };

  const handleSaveSummary = async () => {
    if (!summaryText || isSummarizing) return;
    if (!fileId || isLocalOnly) {
      showToast("Vui lòng tải tệp lên đám mây để lưu tóm tắt.", 'info');
      return;
    }

    const userId = fileOwnerId || auth.currentUser?.uid;
    if (!userId) {
      showToast("Vui lòng đăng nhập để lưu tóm tắt.", 'error');
      return;
    }

    setIsSavingSummary(true);
    try {
      const summaryId = `summary_${Date.now()}`;
      await setDoc(doc(db, `users/${userId}/documents/${fileId}/summaries`, summaryId), {
        content: summaryText,
        type: summaryRange.from === summaryRange.to ? 'page' : 'chapter', // approximation
        range: `${summaryRange.from}-${summaryRange.to}`,
        createdAt: serverTimestamp()
      });
      showToast("Đã lưu tóm tắt thành công", 'success');
    } catch (error: any) {
      console.error("Lỗi khi lưu tóm tắt:", error);
      handleFirestoreError(error, OperationType.CREATE, `users/${userId}/documents/${fileId}/summaries`);
    } finally {
      setIsSavingSummary(false);
    }
  };

  const handleDownloadSummary = async () => {
    if (!summaryText) return;
    
    try {
      showToast("Đang chuẩn bị tệp Word...", 'info');
      
      const fileNameWithoutExt = (currentFileName || 'document').replace(/\.[^/.]+$/, "");
      
      const doc = new Document({
        sections: [{
          properties: {},
          children: [
            new Paragraph({
              text: `TÓM TẮT TÀI LIỆU`,
              heading: HeadingLevel.HEADING_1,
              spacing: { after: 400 }
            }),
            new Paragraph({
              children: [
                new TextRun({
                  text: `Tên tài liệu: ${currentFileName || 'Không rõ'}`,
                  bold: true
                })
              ],
              spacing: { after: 200 }
            }),
            new Paragraph({
              text: `Ngày tạo: ${new Date().toLocaleString('vi-VN')}`,
              spacing: { after: 400 }
            }),
            ...summaryText.split('\n').map(line => {
              const trimmed = line.trim();
              if (!trimmed) return new Paragraph({ text: "" });

              const isHeading = trimmed.startsWith('#');
              const level = trimmed.match(/^#+/)?.[0].length || 0;
              const cleanText = trimmed.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/\*/g, '');

              return new Paragraph({
                heading: isHeading ? (level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2) : undefined,
                spacing: { before: isHeading ? 200 : 100, after: 100 },
                children: [
                   new TextRun({
                     text: cleanText,
                     bold: trimmed.includes('**') || isHeading
                   })
                ]
              });
            })
          ],
        }],
      });

      const blob = await Packer.toBlob(doc);
      saveAs(blob, `TomTat_${fileNameWithoutExt}.docx`);
      showToast("Đã bắt đầu tải xuống tóm tắt (.docx)", 'success');
    } catch (error) {
      console.error("Lỗi khi tải xuống tóm tắt Word:", error);
      showToast("Không thể tải xuống tóm tắt dạng Word", 'error');
    }
  };

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const renderTaskRef = useRef<any>(null);
  const lastRenderedImageRef = useRef<{ page: number, zoom: number, buffer: string } | null>(null);
  const translationService = useRef<TranslationService | null>(null);

  // Pre-load PDF worker
  useEffect(() => {
    console.log(`[MediTrans AI] Pre-loading PDF worker v${pdfjs.version}...`);
  }, []);

  const handleFileSelectFromExplorer = async (fileData: FileData, isAutoRestore = false) => {
    activeFileDataRef.current = fileData;
    activeDriveFileRef.current = null;
    activeFileBufferRef.current = null;

    setIsPdfLoading(true);
    setPdfError(null);
    setFileId(fileData.id);
    setFileOwnerId(fileData.ownerId || user?.uid || null);
    setCurrentFileName(fileData.name);
    setShowExplorer(false);
    setIsLocalOnly(false);

    // Pre-load cached translations if available
    getTranslationsCache(fileData.id || fileData.name).then(cached => {
      if (cached && Object.keys(cached).length > 0) {
        setTranslations(cached);
      }
    });

    // On mobile, switch to split view automatically when opening a file
    if (window.innerWidth < 768) {
      setMobileViewMode('split');
    }

    // Increment fileId to invalidate all pending translations for the previous file
    fileIdRef.current += 1;
    
    // Abort all pending translations
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    
    preTranslateControllersRef.current.forEach(controller => controller.abort());
    preTranslateControllersRef.current.clear();
    translatingPagesRef.current.clear();
    pageCacheRef.current.clear();

    setFile(null); // We don't have a local File object
    setTranslations({});
    setCurrentPage(1);
    setCurrentJob(1);
    setAutoTranslate(false);

    try {
      console.log(`[MediTrans AI] Loading PDF document: ${fileData.name}`);
      setCurrentFileName(fileData.name);
      let loadingTask;

      if (fileData.driveFileId) {
        // Fetch ArrayBuffer directly from Google Drive API
        const arrayBuffer = await downloadDriveFileAsArrayBuffer(fileData.driveFileId);
        loadingTask = pdfjs.getDocument({
          data: arrayBuffer,
          cMapUrl: `https://unpkg.com/pdfjs-dist@3.11.174/cmaps/`,
          cMapPacked: true,
          disableAutoFetch: false,
          disableStream: false,
        });
      } else if (fileData.downloadUrl) {
        setFileUrl(fileData.downloadUrl);
        loadingTask = pdfjs.getDocument({
          url: fileData.downloadUrl,
          cMapUrl: `https://unpkg.com/pdfjs-dist@3.11.174/cmaps/`,
          cMapPacked: true,
          disableAutoFetch: false,
          disableStream: false,
        });
      } else {
        throw new Error("Không tìm thấy thông tin tệp trên Google Drive.");
      }

      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
    } catch (error: any) {
      console.error("Error loading PDF from Google Drive:", error);
      clearActiveDocSession();
      if (isAutoRestore) {
        setPdfDoc(null);
        setFile(null);
        setShowExplorer(true);
        setPdfError(null);
        showToast("Tài liệu phiên trước không thể tải từ Google Drive (Mã lỗi 404). Đã về trang chủ.", "info");
      } else {
        if (error.message === 'CHUA_KET_NOI_DRIVE') {
          setPdfError('Chưa kết nối tài khoản Google Drive. Vui lòng bấm "Google Drive" trên thanh công cụ để kết nối và cấp quyền.');
        } else if (error.message?.includes('404')) {
          setPdfError('Tệp PDF này không còn tồn tại trên Google Drive (Mã lỗi 404). Vui lòng chọn tài liệu khác.');
        } else {
          setPdfError(`Không thể tải tệp PDF từ Google Drive: ${error.message || "Lỗi không xác định"}`);
        }
      }
    } finally {
      setIsPdfLoading(false);
    }
  };

  const handleOpenDriveFile = async (driveFile: DriveFileMetadata, isAutoRestore = false) => {
    activeFileDataRef.current = null;
    activeDriveFileRef.current = driveFile;
    activeFileBufferRef.current = null;

    setShowDrivePickerModal(false);

    const currentUser = auth.currentUser;
    if (!currentUser) {
      showToast("Vui lòng đăng nhập để mở tài liệu.", "info");
      return;
    }

    setShowExplorer(false);
    setIsPdfLoading(true);
    setPdfError(null);

    getTranslationsCache(driveFile.id || driveFile.name).then(cached => {
      if (cached && Object.keys(cached).length > 0) {
        setTranslations(cached);
      }
    });

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    preTranslateControllersRef.current.forEach(c => c.abort());
    preTranslateControllersRef.current.clear();
    translatingPagesRef.current.clear();
    pageCacheRef.current.clear();

    try {
      console.log(`[MediTrans AI] Opening Google Drive File (No Auto-Save): ${driveFile.name} (${driveFile.id})`);
      const arrayBuffer = await downloadDriveFileAsArrayBuffer(driveFile.id);
      
      const loadingTask = pdfjs.getDocument({
        data: arrayBuffer,
        cMapUrl: `https://unpkg.com/pdfjs-dist@3.11.174/cmaps/`,
        cMapPacked: true,
        disableAutoFetch: false,
        disableStream: false,
      });

      const pdf = await loadingTask.promise;
      setPdfDoc(pdf);
      setNumPages(pdf.numPages);
      setCurrentFileName(driveFile.name);
      setFile(null);
      setTranslations({});
      setCurrentPage(1);
      setFileId(null);
      setFileOwnerId(currentUser.uid);

      saveActiveDocSession({
        fileName: driveFile.name,
        currentPage: 1,
        driveFile
      });
    } catch (error: any) {
      console.error("Error opening PDF from Google Drive:", error);
      clearActiveDocSession();
      if (isAutoRestore) {
        setPdfDoc(null);
        setFile(null);
        setShowExplorer(true);
        setPdfError(null);
        showToast("Tài liệu phiên trước không thể tải từ Google Drive (Mã lỗi 404). Đã về trang chủ.", "info");
      } else {
        if (error.message === 'CHUA_KET_NOI_DRIVE') {
          setPdfError('Chưa kết nối tài khoản Google Drive. Vui lòng bấm "Google Drive" trên thanh công cụ để kết nối và cấp quyền.');
        } else if (error.message?.includes('404')) {
          setPdfError('Tệp PDF này không còn tồn tại trên Google Drive (Mã lỗi 404). Vui lòng chọn tài liệu khác.');
        } else {
          setPdfError(`Không thể tải tệp PDF từ Google Drive: ${error.message || "Lỗi không xác định"}`);
        }
      }
    } finally {
      setIsPdfLoading(false);
    }
  };

  const handleSaveDriveFile = (driveFile: DriveFileMetadata) => {
    setDriveFileToSave(driveFile);
    setShowDriveFolderModal(true);
  };

  const confirmSaveDriveFileToFolder = async (folderId: string | null) => {
    setShowDriveFolderModal(false);
    const currentUser = auth.currentUser;
    if (!currentUser || !driveFileToSave) return;

    try {
      await addDoc(collection(db, `users/${currentUser.uid}/documents`), {
        name: driveFileToSave.name,
        folderId: folderId,
        ownerId: currentUser.uid,
        sharedWith: [],
        driveFileId: driveFileToSave.id,
        downloadUrl: driveFileToSave.webViewLink || '',
        size: driveFileToSave.size || 0,
        type: driveFileToSave.mimeType || 'application/pdf',
        createdAt: serverTimestamp()
      });

      showToast(`Đã lưu "${driveFileToSave.name}" vào quản lý tài liệu thành công.`, 'success');
      setDriveFileToSave(null);
    } catch (error: any) {
      console.error("Error saving drive file:", error);
      showToast("Lỗi khi lưu tài liệu: " + error.message, 'error');
    }
  };

  const handleBulkTranslateFromExplorer = (fileData: FileData) => {
    shouldAutoBulkRef.current = true;
    setShowTranslationPanel(true);
    handleFileSelectFromExplorer(fileData);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    // Reset input value so the same file can be selected again
    e.target.value = '';
    
    if (!selectedFile) return;

    // Check file size (200MB limit)
    if (selectedFile.size > 200 * 1024 * 1024) {
      setUploadError("File quá lớn. Vui lòng chọn file dưới 200MB.");
      setTimeout(() => setUploadError(null), 5000);
      return;
    }

    const isPdf = selectedFile.type === 'application/pdf' || 
                  selectedFile.type === 'application/x-pdf' ||
                  selectedFile.name.toLowerCase().endsWith('.pdf');
    
    if (isPdf) {
      setIsPdfLoading(true);
      setPdfError(null);
      
      // Generate a document ID based on filename and size
      const docId = `${selectedFile.name.replace(/[^a-zA-Z0-9]/g, '_')}_${selectedFile.size}`;
      setFileId(docId);
      setCurrentFileName(selectedFile.name);

      try {
        const arrayBuffer = await selectedFile.arrayBuffer();
        activeFileDataRef.current = null;
        activeDriveFileRef.current = null;
        activeFileBufferRef.current = arrayBuffer;
      } catch (e) {
        console.warn("Could not cache file buffer:", e);
      }

      getTranslationsCache(docId).then(cached => {
        if (cached && Object.keys(cached).length > 0) {
          setTranslations(cached);
        }
      });

      // On mobile, switch to split view automatically when opening a file
      if (window.innerWidth < 768) {
        setMobileViewMode('split');
      }

      // Small delay to allow UI to update and browser to settle after file picker
      await new Promise(resolve => setTimeout(resolve, 100));

      // Clear previous
      if (fileUrl) URL.revokeObjectURL(fileUrl);
      if (pdfDoc) {
        try {
          await pdfDoc.destroy();
        } catch (e) {
          console.warn("Error destroying previous PDF:", e);
        }
      }

      // Increment fileId to invalidate all pending translations for the previous file
      fileIdRef.current += 1;
      
      // Abort all pending translations
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      
      preTranslateControllersRef.current.forEach(controller => controller.abort());
      preTranslateControllersRef.current.clear();
      translatingPagesRef.current.clear();
      pageCacheRef.current.clear();

      setFile(selectedFile);
      setTranslations({});
      setCurrentPage(1);
      setCurrentJob(1);
      setAutoTranslate(false);
      
      try {
        // For iOS Chrome/Safari stability, we'll try loading via ArrayBuffer if Blob URL fails
        // but first try the efficient Blob URL method
        const url = URL.createObjectURL(selectedFile);
        setFileUrl(url);
        
        console.log(`[MediTrans AI] Loading PDF: ${selectedFile.name} (${Math.round(selectedFile.size / 1024)} KB)`);

        const loadingTask = pdfjs.getDocument({
          url,
          // Use unpkg for cmaps as well for consistency with worker
          cMapUrl: `https://unpkg.com/pdfjs-dist@3.11.174/cmaps/`,
          cMapPacked: true,
          disableAutoFetch: false,
          disableStream: false,
        });

        const pdf = await loadingTask.promise;
        setPdfDoc(pdf);
        setNumPages(pdf.numPages);
      } catch (error: any) {
        console.error("Error loading PDF with Blob URL, trying ArrayBuffer fallback:", error);
        
        try {
          // Fallback: Read as ArrayBuffer (more stable on some mobile browsers)
          const arrayBuffer = await selectedFile.arrayBuffer();
          const loadingTask = pdfjs.getDocument({
            data: arrayBuffer,
            cMapUrl: `https://unpkg.com/pdfjs-dist@3.11.174/cmaps/`,
            cMapPacked: true,
          });
          const pdf = await loadingTask.promise;
          setPdfDoc(pdf);
          setNumPages(pdf.numPages);
        } catch (fallbackError: any) {
          console.error("Final PDF loading error:", fallbackError);
          setPdfError(`Không thể tải file PDF: ${fallbackError.message || "Lỗi không xác định"}`);
        }
      } finally {
        setIsPdfLoading(false);
      }
    } else {
      setUploadError("Vui lòng chọn file định dạng PDF.");
      setTimeout(() => setUploadError(null), 5000);
    }
  };

  const renderPage = useCallback(async (pageNum: number) => {
    if (!pdfDoc || !canvasRef.current || !textLayerRef.current) return;

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

    // Bounds check to prevent "Invalid page request"
    if (pageNum < 1 || pageNum > pdfDoc.numPages) {
      console.warn(`[MediTrans AI] Invalid page request: ${pageNum}. Document has ${pdfDoc.numPages} pages.`);
      return;
    }

    const requestId = ++renderRequestIdRef.current;

    // 1. Instant Cache Check - If we have this page rendered at this zoom, show it immediately!
    const cached = pageCacheRef.current.get(pageNum);
    if (cached && Math.abs(cached.zoom - zoom) < 0.01) {
      console.log(`[MediTrans] Instant Cache Hit for page ${pageNum}`);
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { alpha: false });
      if (context) {
        canvas.width = cached.canvas.width;
        canvas.height = cached.canvas.height;
        canvas.style.width = cached.canvas.style.width;
        canvas.style.height = cached.canvas.style.height;
        context.drawImage(cached.canvas, 0, 0);
        
        // Restore text layer if available
        if (cached.textContent && textLayerRef.current) {
          const textLayerDiv = textLayerRef.current;
          textLayerDiv.innerHTML = '';
          const page = await pdfDoc.getPage(pageNum);
          const textViewport = page.getViewport({ scale: zoom });
          textLayerDiv.style.width = `${textViewport.width}px`;
          textLayerDiv.style.height = `${textViewport.height}px`;
          textLayerDiv.style.setProperty('--scale-factor', textViewport.scale.toString());
          
          await (pdfjs as any).renderTextLayer({
            textContentSource: cached.textContent,
            container: textLayerDiv,
            viewport: textViewport,
            textDivs: []
          }).promise;
          page.cleanup();
        }
        
        setIsRendering(false);
        isRenderingRef.current = false;
        return;
      }
    }

    setIsRendering(true);
    isRenderingRef.current = true;

    // Ensure previous render task is cancelled
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    // Give a tiny gap for the main thread to breathe during rapid navigation
    if (isMobile) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    // Check if a newer request has come in while we were waiting
    if (requestId !== renderRequestIdRef.current) {
      return;
    }

    try {
      const page = await pdfDoc.getPage(pageNum);
      
      // iOS Canvas Limit Check: Ensure canvas doesn't exceed 4096px which is safe for most mobile browsers
      const MAX_CANVAS_DIMENSION = 4096;
      let renderScale = zoom * 2;
      const baseViewport = page.getViewport({ scale: 1 });
      
      if (baseViewport.width * renderScale > MAX_CANVAS_DIMENSION || baseViewport.height * renderScale > MAX_CANVAS_DIMENSION) {
        renderScale = Math.min(MAX_CANVAS_DIMENSION / baseViewport.width, MAX_CANVAS_DIMENSION / baseViewport.height);
        console.log(`[MediTrans] Đã giới hạn tỉ lệ render cho mobile: ${renderScale}`);
      }
      
      const viewport = page.getViewport({ scale: renderScale });
      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { alpha: false }); // Optimization: disable alpha if not needed

      if (context) {
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.width = `${viewport.width / (renderScale / zoom)}px`;
        canvas.style.height = `${viewport.height / (renderScale / zoom)}px`;
        
        const renderTask = page.render({
          canvasContext: context,
          viewport: viewport,
        } as any);
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        
        // Small delay for mobile browsers to ensure canvas buffer is flushed before capture
        if (isMobile) {
          await new Promise(resolve => setTimeout(resolve, 150));
        }

        // Only update state if this is still the current request
        if (requestId === renderRequestIdRef.current) {
          // Signal that visual rendering is done so translation can start immediately
          setIsRendering(false);
          isRenderingRef.current = false;
          renderTaskRef.current = null;
          
          // LAZY OPERATIONS: Capture image and Text layer slightly after visual render
          // This prevents the UI from "freezing" between page turns
          setTimeout(async () => {
             if (requestId !== renderRequestIdRef.current) return;

             try {
               // 1. Capture for Translation
               const MAX_DIMENSION = 1024;
               let captureCanvas = canvas;
               
               if (canvas.width > MAX_DIMENSION || canvas.height > MAX_DIMENSION) {
                 const tempCanvas = document.createElement('canvas');
                 const ratio = Math.min(MAX_DIMENSION / canvas.width, MAX_DIMENSION / canvas.height);
                 tempCanvas.width = canvas.width * ratio;
                 tempCanvas.height = canvas.height * ratio;
                 const tempCtx = tempCanvas.getContext('2d');
                 if (tempCtx) {
                   tempCtx.drawImage(canvas, 0, 0, tempCanvas.width, tempCanvas.height);
                   captureCanvas = tempCanvas;
                 }
               }
               
               const buffer = captureCanvas.toDataURL('image/jpeg', 0.65);
               if (buffer.length > 1000) {
                 lastRenderedImageRef.current = { page: pageNum, zoom, buffer };
               }

               // 2. Render Text Layer
               const textContent = await page.getTextContent();
               
               // Cache this result for next time
               if (requestId === renderRequestIdRef.current) {
                 const cacheCanvas = document.createElement('canvas');
                 cacheCanvas.width = canvas.width;
                 cacheCanvas.height = canvas.height;
                 cacheCanvas.style.width = canvas.style.width;
                 cacheCanvas.style.height = canvas.style.height;
                 const cacheCtx = cacheCanvas.getContext('2d');
                 if (cacheCtx) cacheCtx.drawImage(canvas, 0, 0);
                 
                 pageCacheRef.current.set(pageNum, { 
                   canvas: cacheCanvas, 
                   zoom, 
                   textContent 
                 });

                 // LRU: Evict oldest if limit reached
                 if (pageCacheRef.current.size > CACHE_SIZE_LIMIT) {
                   const oldestKey = pageCacheRef.current.keys().next().value;
                   if (oldestKey !== undefined) {
                     const old = pageCacheRef.current.get(oldestKey);
                     if (old?.canvas) {
                       old.canvas.width = 0;
                       old.canvas.height = 0;
                     }
                     pageCacheRef.current.delete(oldestKey);
                   }
                 }
               }

               const textLayerDiv = textLayerRef.current;
               if (textLayerDiv && requestId === renderRequestIdRef.current) {
                 textLayerDiv.innerHTML = '';
                 const textViewport = page.getViewport({ scale: zoom });
                 textLayerDiv.style.width = `${textViewport.width}px`;
                 textLayerDiv.style.height = `${textViewport.height}px`;
                 textLayerDiv.style.left = '0';
                 textLayerDiv.style.top = '0';
                 textLayerDiv.style.setProperty('--scale-factor', textViewport.scale.toString());
                 
                 await (pdfjs as any).renderTextLayer({
                   textContentSource: textContent,
                   container: textLayerDiv,
                   viewport: textViewport,
                   textDivs: []
                 }).promise;
               }
             } catch (err) {
               console.warn("[MediTrans] Lazy post-render failed:", err);
             } finally {
               // Crucial for memory: cleanup page resources
               page.cleanup();
             }
          }, 150);
        }
      }
    } catch (error: any) {
      if (error.name !== 'RenderingCancelledException') {
        console.error("Error rendering page:", error);
      }
      
      if (requestId === renderRequestIdRef.current) {
        setIsRendering(false);
        isRenderingRef.current = false;
        renderTaskRef.current = null;
      }
    }
  }, [pdfDoc, zoom]);

  const fitToWidth = async () => {
    if (!pdfDoc || !containerRef.current) return;
    
    // Use the current page from the doc to be safe
    const pageToFit = currentPage;
    if (pageToFit < 1 || pageToFit > pdfDoc.numPages) return;

    requestAnimationFrame(async () => {
      if (!pdfDoc || !containerRef.current) return;
      try {
        const page = await pdfDoc.getPage(pageToFit);
        const viewport = page.getViewport({ scale: 1 });
        const rect = containerRef.current.getBoundingClientRect();
        const containerWidth = rect.width - 64;
        const newZoom = containerWidth / viewport.width;
        setZoom(Number(newZoom.toFixed(2)));
        page.cleanup();
      } catch (error) {
        console.error("Error fitting to width:", error);
      }
    });
  };

  useEffect(() => {
    if (pdfDoc && isAutoFit) {
      fitToWidth();
    }
  }, [mobileViewMode, pdfDoc, isAutoFit]);

  const fitToWidthAction = () => {
    setIsAutoFit(true);
    fitToWidth();
  };

  const cancelTranslation = useCallback(() => {
    const currentFileId = fileIdRef.current;
    
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTranslating(false);
    setActiveTranslation(null);
    
    // Update status of the page being translated to error or idle
    const targetPage = currentPage;
    if (translatingPagesRef.current.has(targetPage)) {
      if (fileIdRef.current === currentFileId) {
        setTranslations(prev => ({
          ...prev,
          [targetPage]: { ...prev[targetPage], status: 'error', content: 'Đã dừng dịch thuật.' }
        }));
      }
      translatingPagesRef.current.delete(targetPage);
    }
  }, [currentPage]);

  const performTranslation = useCallback(async (
    targetPage: number, 
    signal: AbortSignal, 
    engine?: TranslationEngine,
    onProgress?: (content: string) => void
  ) => {
    const currentFileId = fileIdRef.current;
    if (!translationService.current || !pdfDoc) return null;

    try {
      // 1. Image preparation
      let imageBuffer = "";
      const cached = pageCacheRef.current.get(targetPage);
      
      // Use live canvas if it's the current page, otherwise use cache
      if (targetPage === currentPageRef.current && canvasRef.current && canvasRef.current.width > 0) {
        imageBuffer = optimizeCanvasImage(canvasRef.current);
      } else if (cached?.canvas && cached.canvas.width > 0) {
        imageBuffer = optimizeCanvasImage(cached.canvas);
      }
      
      // Fallback: If no image buffer from live/cached canvas, render via pdfDoc
      if (!imageBuffer) {
        const pdfPage = await pdfDoc.getPage(targetPage);
        const viewport = pdfPage.getViewport({ scale: 1.5 });
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = viewport.width;
        tempCanvas.height = viewport.height;
        const ctx = tempCanvas.getContext('2d');
        if (ctx) {
          await pdfPage.render({ canvasContext: ctx, viewport }).promise;
          imageBuffer = optimizeCanvasImage(tempCanvas);
        }
        pdfPage.cleanup();
      }

      if (!imageBuffer || signal.aborted) return null;

      // 2. Start Stream
      const stream = translationService.current.translateMedicalPageStream({ 
        imageBuffer, 
        pageNumber: targetPage, 
        signal,
        model: engine || selectedEngine
      });

      let fullContent = "";
      let lastUpdate = Date.now();

      for await (const chunk of stream) {
        if (signal.aborted) break;
        fullContent += chunk;
        
        const now = Date.now();
        if (onProgress && now - lastUpdate > 120) {
          onProgress(fullContent);
          lastUpdate = now;
        }
      }

      if (signal.aborted) return null;
      return fullContent;

    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.message === 'Translation aborted')) {
        return null;
      }
      throw error;
    }
  }, [pdfDoc, selectedEngine]);

  const translateCurrentPage = useCallback(async (pageNumber?: number, force = false, engine?: TranslationEngine) => {
    const targetPage = pageNumber ?? currentPage;
    const currentFileId = fileIdRef.current;
    
    if (!translationService.current) return;

    // Fast return if already done
    const currentStatus = translationsRef.current[targetPage]?.status;
    if (!force && (currentStatus === 'loading' || currentStatus === 'success')) {
      if (translatingPagesRef.current.has(targetPage)) return;
    }

    // Abort previous FOREGROUND request only
    if (abortControllerRef.current) abortControllerRef.current.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    translatingPagesRef.current.add(targetPage);
    setIsTranslating(true);
    setActiveTranslation({ page: targetPage, content: '', status: 'loading' });

    try {
      if (!hasValidKeysForFolder(activeKeyFolder)) {
        const folderLabel = activeKeyFolder === 'gemini' 
          ? 'Google Gemini' 
          : activeKeyFolder === 'shopaikey' 
          ? 'ShopAIKey / Proxy' 
          : 'Tất cả';
        showToast(`Nhóm Key hiện tại ('${folderLabel}') chưa có API Key. Vui lòng chọn đúng nhóm key có sẵn trong Cài đặt.`, "error");
        setShowApiSettings(true);
        setIsTranslating(false);
        setActiveTranslation(null);
        translatingPagesRef.current.delete(targetPage);
        return;
      }

      const hasKey = await translationService.current.hasApiKey();
      if (!hasKey) {
        showToast("Vui lòng cấu hình API Key trong Cài đặt.", "error");
        setIsTranslating(false);
        setActiveTranslation(null);
        translatingPagesRef.current.delete(targetPage);
        return;
      }

      const content = await performTranslation(
        targetPage, 
        controller.signal, 
        engine,
        (text) => {
          if (currentPageRef.current === targetPage) {
            setActiveTranslation({ page: targetPage, content: text, status: 'loading' });
          }
        }
      );

      if (content !== null) {
        const finalResult = { content, status: 'success' as const };
        if (fileIdRef.current === currentFileId) {
          setTranslations(prev => ({ ...prev, [targetPage]: finalResult }));
          setActiveTranslation({ page: targetPage, content, status: 'success' });
          
          if (user && fileId && fileOwnerId) {
            setDoc(doc(db, 'users', fileOwnerId, 'documents', fileId, 'pages', targetPage.toString()), {
              content, status: 'success', updatedAt: serverTimestamp()
            }, { merge: true }).catch(console.error);
          }
        }
        
        setTimeout(() => {
          if (currentPageRef.current === targetPage) setActiveTranslation(null);
        }, 500);
      }
    } catch (error: any) {
      console.error(`Translation error for page ${targetPage}:`, error);
      setTranslations(prev => ({ ...prev, [targetPage]: { content: formatErrorMessage(error), status: 'error' } }));
      setActiveTranslation(null);
    } finally {
      translatingPagesRef.current.delete(targetPage);
      if (abortControllerRef.current === controller) {
        setIsTranslating(false);
      }
    }
  }, [currentPage, user, fileId, pdfDoc, performTranslation]);

  const preTranslatePage = useCallback(async (pageNum: number, signal: AbortSignal, engine?: TranslationEngine) => {
    if (!pdfDoc || pageNum > numPages || translatingPagesRef.current.has(pageNum)) return;
    if (!hasValidKeysForFolder(activeKeyFolder)) return;
    
    try {
      translatingPagesRef.current.add(pageNum);
      
      const content = await performTranslation(
        pageNum, 
        signal, 
        engine,
        (text) => {
          // Only show progress if user moves to this page while it is being pre-translated
          if (pageNum === currentPageRef.current) {
            setActiveTranslation({ page: pageNum, content: text, status: 'loading' });
            setIsTranslating(true);
          }
        }
      );

      if (content !== null) {
        const finalResult = { content, status: 'success' as const };
        setTranslations(prev => ({ ...prev, [pageNum]: finalResult }));

        if (pageNum === currentPageRef.current) {
          setActiveTranslation({ page: pageNum, content, status: 'success' });
          setTimeout(() => {
            if (currentPageRef.current === pageNum) setActiveTranslation(null);
          }, 500);
        }
        
        if (user && fileId && fileOwnerId) {
          setDoc(doc(db, 'users', fileOwnerId, 'documents', fileId, 'pages', pageNum.toString()), {
            content, status: 'success', updatedAt: serverTimestamp()
          }, { merge: true }).catch(console.error);
        }
      }
    } catch (error: any) {
      // Quiet fail for pre-translation
    } finally {
      translatingPagesRef.current.delete(pageNum);
    }
  }, [pdfDoc, numPages, user, fileId, performTranslation]);

  useEffect(() => {
    if (pdfDoc && autoTranslate) {
      if (!hasValidKeysForFolder(activeKeyFolder)) return;

      // Find all pages in the look-ahead window that need translation
      // We only look at a strict window of 'autoTranslateLookAhead' pages from the current page.
      const pagesToBuffer: number[] = [];
      
      // Strict window: Current page + autoTranslateLookAhead
      for (let i = 1; i <= Math.min(numPages - currentPage, autoTranslateLookAhead); i++) {
        const pageNum = currentPage + i;
        const state = translationsRef.current[pageNum];
        const isDone = state?.status === 'success';
        const isTranslating = translatingPagesRef.current.has(pageNum);

        if (!isDone && !isTranslating) {
          pagesToBuffer.push(pageNum);
        }
      }

      if (pagesToBuffer.length === 0) return;

      // Limit concurrent translations to avoid browser/network congestion.
      // We allow space for the current page + the lookahead pool.
      const MAX_CONCURRENT_PRE_TRANSLATION = 5; // Fixed reasonable concurrency limit
      const currentConcurrency = translatingPagesRef.current.size;
      const spaceLeft = MAX_CONCURRENT_PRE_TRANSLATION - currentConcurrency;

      if (spaceLeft <= 0) return;

      const pagesToStart = pagesToBuffer.slice(0, spaceLeft);

      pagesToStart.forEach((pageNum, index) => {
        const controller = new AbortController();
        preTranslateControllersRef.current.set(pageNum, controller);
        
        // Stagger starts slightly (200ms) to avoid simultaneous browser capture CPU peaks
        setTimeout(() => {
          preTranslatePage(pageNum, controller.signal).finally(() => {
            preTranslateControllersRef.current.delete(pageNum);
          });
        }, index * 200);
      });
    }
  }, [currentPage, pdfDoc, autoTranslate, numPages, preTranslatePage, autoTranslateLookAhead, activeKeyFolder, hasValidKeysForFolder]);

  const startBulkTranslation = async (engine?: TranslationEngine) => {
    if (!pdfDoc || numPages <= 0) return;

    if (!hasValidKeysForFolder(activeKeyFolder)) {
      const folderLabel = activeKeyFolder === 'gemini' 
        ? 'Google Gemini' 
        : activeKeyFolder === 'shopaikey' 
        ? 'ShopAIKey / Proxy' 
        : 'Tất cả';
      showToast(`Nhóm Key hiện tại ('${folderLabel}') chưa có API Key. Vui lòng chọn nhóm key khác hoặc thêm Key trước khi dịch toàn bộ.`, 'error');
      setShowApiSettings(true);
      return;
    }
    
    // If already translating, clicking toggles cancellation
    if (isBulkTranslating) {
      if (bulkAbortControllerRef.current) bulkAbortControllerRef.current.abort();
      setIsBulkTranslating(false);
      setBulkTranslateStatus('idle');
      return;
    }

    const controller = new AbortController();
    bulkAbortControllerRef.current = controller;
    const { signal } = controller;

    setIsBulkTranslating(true);
    setBulkTranslateStatus('translating');
    setBulkTranslateProgress(0);

    const pagesToTranslate: number[] = [];
    for (let i = 1; i <= numPages; i++) {
      if (translationsRef.current[i]?.status !== 'success') {
        pagesToTranslate.push(i);
      }
    }

    if (pagesToTranslate.length === 0) {
      setIsBulkTranslating(false);
      setBulkTranslateStatus('completed');
      setBulkTranslateProgress(100);
      showToast("Tất cả các trang đã được dịch thành công.", 'success');
      return;
    }

    const totalToTranslate = pagesToTranslate.length;
    let newlyCompletedCount = 0;
    
    // Concurrency depends on keys and engine
    let concurrentLimit = 5;
    if (activeKeyFolder === 'shopaikey') {
      concurrentLimit = 1; // Process sequentially for ShopAIKey/Proxy
    } else {
      concurrentLimit = Math.min(10, userKeys.length > 5 ? Math.floor(userKeys.length * 0.8) : 5);
    }
    
    console.log(`[MediTrans] Starting Bulk Translation for ${totalToTranslate} pages with concurrency ${concurrentLimit}...`);

    // Process in batches
    for (let i = 0; i < pagesToTranslate.length; i += concurrentLimit) {
      if (signal.aborted) break;

      const batch = pagesToTranslate.slice(i, i + concurrentLimit);
      await Promise.all(batch.map(async (pageNum) => {
        if (signal.aborted) return;
        
        try {
          translatingPagesRef.current.add(pageNum);
          const content = await performTranslation(
            pageNum, 
            signal, 
            engine,
            (text) => {
              if (currentPageRef.current === pageNum) {
                setActiveTranslation({ page: pageNum, content: text, status: 'loading' });
                setIsTranslating(true);
              }
            }
          );

          if (content !== null && !signal.aborted) {
            const finalResult = { content, status: 'success' as const };
            setTranslations(prev => ({ ...prev, [pageNum]: finalResult }));
            newlyCompletedCount++;
            setBulkTranslateProgress(Math.floor((newlyCompletedCount / totalToTranslate) * 100));

            // Sync with current page UI
            if (pageNum === currentPageRef.current) {
              setActiveTranslation({ page: pageNum, content, status: 'success' });
              setTimeout(() => {
                if (currentPageRef.current === pageNum) setActiveTranslation(null);
              }, 500);
            }

            // Save to Firestore
            if (user && fileId && fileOwnerId) {
              setDoc(doc(db, 'users', fileOwnerId, 'documents', fileId, 'pages', pageNum.toString()), {
                content, status: 'success', updatedAt: serverTimestamp()
              }, { merge: true }).catch(console.error);
            }
          }
        } catch (e) {
          console.error(`Bulk translation failed for page ${pageNum}:`, e);
          setTranslations(prev => ({ ...prev, [pageNum]: { content: 'Lỗi dịch thuật.', status: 'error' } }));
        } finally {
          translatingPagesRef.current.delete(pageNum);
        }
      }));
    }

    if (bulkAbortControllerRef.current === controller) {
      bulkAbortControllerRef.current = null;
      setIsBulkTranslating(false);
      if (!signal.aborted) {
        setBulkTranslateStatus('completed');
        showToast(`Đã hoàn thành dịch ${newlyCompletedCount} trang.`, 'success');
      }
    }
  };

  useEffect(() => {
    if (pdfDoc && shouldAutoBulkRef.current && numPages > 0) {
      shouldAutoBulkRef.current = false;
      startBulkTranslation();
    }
  }, [pdfDoc, numPages]);

  useEffect(() => {
    if (user && fileId && fileOwnerId) {
      console.log(`[MediTrans] Listening for translations for document: ${fileId} owned by: ${fileOwnerId}`);
      const q = query(collection(db, 'users', fileOwnerId, 'documents', fileId, 'pages'));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const remoteTranslations: TranslationState = {};
        snapshot.docs.forEach(doc => {
          const data = doc.data();
          remoteTranslations[parseInt(doc.id)] = {
            content: data.content,
            status: data.status as any
          };
        });
        
        setTranslations(prev => {
          const newState = { ...prev };
          Object.keys(remoteTranslations).forEach(page => {
            const pageNum = parseInt(page);
            // Only update if we don't have it locally or if it's currently loading/error
            // AND the page is not currently being translated locally
            if (!newState[pageNum] || (newState[pageNum].status !== 'success' && !translatingPagesRef.current.has(pageNum))) {
              newState[pageNum] = remoteTranslations[pageNum];
            }
          });
          return newState;
        });
      }, (error) => {
        const path = `users/${user.uid}/documents/${fileId}/pages`;
        handleFirestoreError(error, OperationType.GET, path);
      });
      return () => unsubscribe();
    }
  }, [user, fileId]);

  const currentEngineRef = useRef<string | null>(null);
  const currentKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // Wait for keys to load if we have a user
    if (user && isKeysLoading) {
      console.log(`[MediTrans AI] Postponing key sync - waiting for Vault keys to load...`);
      return;
    }

    const currentEngineType = selectedEngine.startsWith('gemini') ? 'gemini' : selectedEngine;
    
    // Enhanced logging for diagnostics
    console.log(`[MediTrans AI] Syncing keys for engine: ${selectedEngine}. UserKeys count: ${userKeys.length}`);
    
    // Enhanced logging for chuyển đổi key
    if (userKeys.length > 0) {
      console.log(`[MediTrans AI] Processing Vault Keys:`, userKeys.map(k => ({ id: k.id, name: k.name, engine: k.engine })));
    }
    
    // 1. Build list of keys from vault filtered by activeKeyFolder
    let allKeys: string[] = [];
    let selectedVaultKeyName = "";
    let primaryKey = "";

    const isGeminiEngine = (engine: string) => {
      const e = (engine || 'gemini').toLowerCase();
      return e === 'gemini' || e.includes('gemini') || e.includes('flash') || e.includes('pro') || e.includes('shopaikey') || e.includes('openai') || e.includes('sk');
    };

    // Filter userKeys by active folder (gemini vs shopaikey vs all)
    const folderKeys = userKeys.filter(k => matchesKeyFolder(k, activeKeyFolder));

    // Prioritize selected key from vault (if it belongs to active folder)
    if (user && selectedKeyId) {
      const vaultKey = folderKeys.find(k => k.id === selectedKeyId);
      if (vaultKey) {
        const engineMatches = vaultKey.engine === currentEngineType || 
                             (currentEngineType === 'gemini' && isGeminiEngine(vaultKey.engine));
        
        if (engineMatches) {
          primaryKey = vaultKey.value;
          selectedVaultKeyName = vaultKey.name;
          if (primaryKey) allKeys.push(primaryKey);
          console.log(`[MediTrans AI] Selected primary key from vault (${activeKeyFolder}): ${vaultKey.name}`);
        } else {
          console.warn(`[MediTrans AI] Selected key ${vaultKey.name} (engine: ${vaultKey.engine}) does not match current engine ${selectedEngine}`);
        }
      }
    }

    // Add other compatible keys from active folder in vault for rotation
    if (user && folderKeys.length > 0) {
      const otherVaultKeys = folderKeys
        .filter(k => {
          const engineMatches = k.engine === currentEngineType || 
                               (currentEngineType === 'gemini' && isGeminiEngine(k.engine));
          // Important: also check if k.value exists to avoid adding empty keys
          return engineMatches && k.id !== selectedKeyId && k.status !== 'error' && k.value;
        })
        .map(k => k.value);
      
      if (otherVaultKeys.length > 0) {
        console.log(`[MediTrans AI] Found ${otherVaultKeys.length} additional compatible keys in folder '${activeKeyFolder}'`);
      }
      allKeys = [...allKeys, ...otherVaultKeys];
    }

    // 2. Fallback to manual/system key ONLY if no vault keys are found
    // This allows fallback if vault hasn't loaded or user has no keys,
    // but prioritized vault keys if they exist.
    if (allKeys.length === 0) {
      const manualKey = engineKeys[selectedEngine] || (import.meta as any).env?.VITE_GEMINI_API_KEY || (process as any).env?.GEMINI_API_KEY;
      if (manualKey) {
        allKeys.push(manualKey);
        primaryKey = manualKey;
      }
    }

    // Deduplicate and filter
    allKeys = Array.from(new Set(allKeys.filter(k => k && k.trim() !== "")));
    const keyString = allKeys.join(',');

    // Avoid unnecessary re-initialization
    if (currentEngineRef.current === selectedEngine && currentKeyRef.current === keyString) {
      return;
    }

    currentEngineRef.current = selectedEngine;
    currentKeyRef.current = keyString;

    // Use selected vault key as primary if available
    const serviceKey = primaryKey || (allKeys.length > 0 ? allKeys[0] : "");

    translationService.current = new GeminiService(allKeys, selectedEngine);

    // Enhanced logging for diagnostics
    const vaultKeyCount = allKeys.filter(k => userKeys.some(vk => vk.value === k)).length;
    if (allKeys.length > 0) {
      console.log(`[MediTrans AI] Engine: Gemini Flash | Keys: ${allKeys.length} (${vaultKeyCount} from Vault) | Active: ${selectedVaultKeyName || "Manual/System"}`);
    } else {
      console.warn(`[MediTrans AI] Engine: Gemini Flash - NO API KEYS AVAILABLE`);
    }
  }, [selectedEngine, engineKeys, user, selectedKeyId, userKeys, isKeysLoading, activeKeyFolder]);

  // Handle Focus Mode (FullScreen) transitions
  useEffect(() => {
    if (file) {
      // Set auto-fit to true when toggling focus mode to ensure it fills the space
      setIsAutoFit(true);
      
      // Small delay to allow layout transitions to complete before measuring
      const timer = setTimeout(() => {
        fitToWidth();
      }, 350);
      return () => clearTimeout(timer);
    }
  }, [isFullScreen, file]);

  // Handle PDF document load
  useEffect(() => {
    if (pdfDoc) {
      fitToWidth();
    }
  }, [pdfDoc]);

  // Handle container resize to maintain fit-to-width if enabled
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfDoc || !isAutoFit) return;

    const observer = new ResizeObserver(() => {
      fitToWidth();
    });
    
    observer.observe(container);
    return () => observer.disconnect();
  }, [pdfDoc, isAutoFit, currentPage]);

  useEffect(() => {
    if (!pdfDoc || !autoTranslate) return;

    if (!hasValidKeysForFolder(activeKeyFolder)) {
      setAutoTranslate(false);
      const folderLabel = activeKeyFolder === 'gemini' 
        ? 'Google Gemini' 
        : activeKeyFolder === 'shopaikey' 
        ? 'ShopAIKey / Proxy' 
        : 'Tất cả';
      showToast(`Tự động dịch đã tạm dừng: Nhóm key '${folderLabel}' chưa có API Key khả dụng.`, 'info');
      setShowApiSettings(true);
      return;
    }

    // Debounce auto-translation slightly to prevent hammering the API when scrolling super fast
    const timer = setTimeout(() => {
      const translation = translationsRef.current[currentPage];
      const isDone = translation?.status === 'success';
      const isForegroundActive = isTranslatingRef.current && activeTranslation?.page === currentPage;
      
      if (!isDone && !isForegroundActive) {
        translateCurrentPage(currentPage);
      }
    }, 150); // Faster initiation (150ms)

    return () => clearTimeout(timer);
  }, [currentPage, pdfDoc, autoTranslate, isRendering, isTranslating, translateCurrentPage, activeTranslation?.page, translations, activeKeyFolder, hasValidKeysForFolder]);

  useEffect(() => {
    if (pdfDoc) {
      renderPage(currentPage);
      
      // Predictive Background Rendering - Render next page in advance
      const nextP = currentPage + 1;
      if (nextP <= numPages && !pageCacheRef.current.has(nextP)) {
        const timer = setTimeout(async () => {
          try {
            const page = await pdfDoc.getPage(nextP);
            const renderScale = zoom * 2;
            const viewport = page.getViewport({ scale: renderScale });
            
            const cacheCanvas = document.createElement('canvas');
            cacheCanvas.width = viewport.width;
            cacheCanvas.height = viewport.height;
            cacheCanvas.style.width = `${viewport.width / (renderScale / zoom)}px`;
            cacheCanvas.style.height = `${viewport.height / (renderScale / zoom)}px`;
            
            const ctx = cacheCanvas.getContext('2d', { alpha: false });
            if (ctx) {
              await page.render({ canvasContext: ctx, viewport }).promise;
              const textContent = await page.getTextContent();
              
              pageCacheRef.current.set(nextP, { 
                canvas: cacheCanvas, 
                zoom, 
                textContent 
              });
              
              console.log(`[MediTrans] Prefetched page ${nextP}`);
              
              if (pageCacheRef.current.size > CACHE_SIZE_LIMIT) {
                const oldestKey = pageCacheRef.current.keys().next().value;
                if (oldestKey !== undefined) {
                  const old = pageCacheRef.current.get(oldestKey);
                  if (old?.canvas) {
                    old.canvas.width = 0;
                    old.canvas.height = 0;
                  }
                  pageCacheRef.current.delete(oldestKey);
                }
              }
            }
            page.cleanup();
          } catch (e) {
            console.warn("Predictive render failed:", e);
          }
        }, 3000); // Wait 3s after current page render to do background work
        return () => clearTimeout(timer);
      }
    }
  }, [pdfDoc, currentPage, renderPage, numPages, zoom]);

  const handleKeyDownRef = useRef<(e: KeyboardEvent) => void>(null);
  
  useEffect(() => {
    handleKeyDownRef.current = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullScreenRef.current) {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => setIsFullScreen(false));
        } else {
          setIsFullScreen(false);
        }
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+') {
          e.preventDefault();
          setIsAutoFit(false);
          setZoom(z => Math.min(3, Number((z + 0.1).toFixed(1))));
        } else if (e.key === '-') {
          e.preventDefault();
          setIsAutoFit(false);
          setZoom(z => Math.max(0.5, Number((z - 0.1).toFixed(1))));
        } else if (e.key === '0') {
          e.preventDefault();
          fitToWidthAction();
        }
      } else {
        // Arrow keys for navigation (only if not typing in an input)
        const activeElement = document.activeElement;
        const isTyping = activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA' || (activeElement as HTMLElement)?.isContentEditable;
        
        if (!isTyping) {
          if (e.key === 'ArrowLeft') {
            setCurrentPage(p => Math.max(1, p - 1));
          } else if (e.key === 'ArrowRight') {
            setCurrentPage(p => Math.min(numPages, p + 1));
          }
        }
      }
    };
  }, [numPages, fitToWidthAction]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (handleKeyDownRef.current) {
        handleKeyDownRef.current(e);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfDoc) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setIsAutoFit(false);
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        setZoom(prev => {
          const next = Math.min(3, Math.max(0.5, prev + delta));
          return Number(next.toFixed(1));
        });
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [pdfDoc]);

  useEffect(() => {
    const handleGlobalMouseMove = (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;
      e.preventDefault();
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      containerRef.current.scrollLeft = dragStart.scrollLeft - dx;
      containerRef.current.scrollTop = dragStart.scrollTop - dy;
    };

    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (!isDragging || !containerRef.current || e.touches.length !== 1) return;
      // Prevent default to stop browser scrolling when panning
      e.preventDefault();
      const touch = e.touches[0];
      const dx = touch.clientX - dragStart.x;
      const dy = touch.clientY - dragStart.y;
      containerRef.current.scrollLeft = dragStart.scrollLeft - dx;
      containerRef.current.scrollTop = dragStart.scrollTop - dy;
    };

    const handleGlobalMouseUp = () => {
      if (isDragging) {
        setIsDragging(false);
        document.body.style.cursor = 'auto';
        if (containerRef.current) {
          containerRef.current.style.cursor = isPanning ? 'grab' : 'auto';
        }
      }
    };

    if (isDragging) {
      document.body.style.cursor = 'grabbing';
      window.addEventListener('mousemove', handleGlobalMouseMove);
      window.addEventListener('mouseup', handleGlobalMouseUp);
      window.addEventListener('touchmove', handleGlobalTouchMove, { passive: false });
      window.addEventListener('touchend', handleGlobalMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleGlobalMouseMove);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchmove', handleGlobalTouchMove);
      window.removeEventListener('touchend', handleGlobalMouseUp);
    };
  }, [isDragging, isPanning, dragStart]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isPanning || !containerRef.current) return;
    
    // Only handle left click
    if (e.button !== 0) return;

    setIsDragging(true);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop
    });
    containerRef.current.style.cursor = 'grabbing';
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (!isPanning || !containerRef.current || e.touches.length !== 1) return;

    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({
      x: touch.clientX,
      y: touch.clientY,
      scrollLeft: containerRef.current.scrollLeft,
      scrollTop: containerRef.current.scrollTop
    });
    containerRef.current.style.cursor = 'grabbing';
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    // Handle text selection for dictionary
    // Only trigger if lookup is enabled, translation panel is open and NOT in full screen mode
    if (!isLookupEnabled || !showTranslationPanel || isFullScreen) return;

    // Use a small timeout to ensure the selection is fully captured by the browser
    setTimeout(() => {
      const selection = window.getSelection();
      const selectedText = selection?.toString() || "";
      
      if (selectedText.trim().length > 0) {
        // Verify selection is within our target areas to avoid accidental triggers
        const anchorNode = selection?.anchorNode;
        if (!anchorNode) return;
        
        const targetElement = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
        const isInsidePDF = targetElement?.closest('.textLayer');
        const isInsideTranslation = targetElement?.closest('.markdown-body');
        
        if (!isInsidePDF && !isInsideTranslation) return;

        // Clean the selected text: remove invisible characters and trim
        // We keep punctuation and internal spacing as the user wants the "exact" selection
        const text = selectedText
          .replace(/[\u00AD\u200B\u200C\u200D]/g, '') // Remove soft hyphens and zero-width spaces
          .trim();
        
        // Only trigger if it's not just whitespace
        const isNumeric = /^\d+$/.test(text);
        
        // Check if selection spans multiple lines by comparing rects
        let isSingleLine = true;
        try {
          const range = selection?.getRangeAt(0);
          if (range) {
            const rects = range.getClientRects();
            if (rects.length > 1) {
              // If multiple rects, check if they are on different vertical levels
              const firstRect = rects[0];
              for (let i = 1; i < rects.length; i++) {
                if (Math.abs(rects[i].top - firstRect.top) > 15) { // Slightly more tolerant
                  isSingleLine = false;
                  break;
                }
              }
            }
          }
        } catch (e) {}

        // Relax limits to allow longer phrases or short sentences (up to 200 chars, 20 words)
        const wordCount = text.split(/\s+/).length;
        // Allow slightly multi-line selections (up to 30px vertical difference)
        if (text.length > 1 && text.length < 200 && !isNumeric && wordCount <= 20) {
          try {
            const range = selection?.getRangeAt(0);
            if (range) {
              const rect = range.getBoundingClientRect();
              
              // Check if selection spans too many lines vertically
              let verticalSpan = 0;
              const rects = range.getClientRects();
              if (rects.length > 1) {
                let minTop = rects[0].top;
                let maxTop = rects[0].top;
                for (let i = 1; i < rects.length; i++) {
                  minTop = Math.min(minTop, rects[i].top);
                  maxTop = Math.max(maxTop, rects[i].top);
                }
                verticalSpan = maxTop - minTop;
              }

              // Only trigger if vertical span is reasonable (approx 2-3 lines max)
              if (verticalSpan < 60) {
                // Position relative to the viewport
                // Term lookup removed
              }
            }
          } catch (err) {
            // Range might be invalid if selection changed rapidly
          }
        }
      }
    }, 50);
  };

  const saveSettings = () => {
    // Basic settings are now primarily driven by selectedKeyId which is state-synced
    setShowSettings(false);
    showToast("Đã lưu cấu hình", 'success');
  };

  const [copiedPage, setCopiedPage] = useState<number | null>(null);

  const handleCopyTranslation = (content: string, pageNum: number) => {
    navigator.clipboard.writeText(content);
    setCopiedPage(pageNum);
    setTimeout(() => setCopiedPage(null), 2000);
  };

  const clearAllTranslations = () => {
    setTranslations({});
    translationsRef.current = {};
    setActiveTranslation(null);
    setIsTranslating(false);
  };

  const [tempKeys, setTempKeys] = useState<Record<TranslationEngine, string>>(engineKeys);
  const [testStatus, setTestStatus] = useState<{ type: 'success' | 'error' | 'loading' | null, message: string }>({ type: null, message: '' });

  useEffect(() => {
    if (showSettings) {
      let currentKey = engineKeys[selectedEngine];
      if (user && selectedKeyId) {
        const vaultKey = userKeys.find(k => k.id === selectedKeyId);
        const currentEngineType = selectedEngine.startsWith('gemini') ? 'gemini' : selectedEngine;
        if (vaultKey && vaultKey.engine === currentEngineType) {
          currentKey = vaultKey.value;
        }
      }
      setTempKeys({ ...engineKeys, [selectedEngine]: currentKey });
    }
  }, [showSettings, engineKeys, user, selectedKeyId, userKeys, selectedEngine]);

  if (!isAuthReady) {
    return (
      <div className="h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-slate-50 p-6">
        <div className="w-full max-w-md bg-white rounded-[40px] shadow-2xl shadow-indigo-100/50 border border-slate-100 overflow-hidden p-10">
          <div className="flex flex-col items-center mb-10">
            <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center shadow-xl shadow-indigo-200 mb-6 rotate-3">
              <Logo className="w-12 h-12 text-white" />
            </div>
            <h1 className="text-3xl font-display font-black text-slate-800 tracking-tight text-center">MediTrans AI</h1>
            <p className="text-slate-400 font-bold text-sm mt-2 uppercase tracking-widest">Medical Translation System</p>
          </div>

          <div className="space-y-4">
            <button 
              onClick={handleGoogleAuth}
              disabled={isLoggingIn}
              className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95 flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {isLoggingIn ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#ffffff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                  <path fill="#ffffff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#ffffff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#ffffff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                </svg>
              )}
              <span>Đăng nhập với Google (Gmail)</span>
            </button>
            {authError && (
              <div className="p-3 bg-rose-50 text-rose-600 rounded-xl text-xs font-bold text-center">
                {authError}
              </div>
            )}
          </div>

          <div className="mt-10 pt-8 border-t border-slate-50 text-center">
            <p className="text-[10px] text-slate-300 font-black uppercase tracking-[0.3em]">
              Copyright © Dr. Hoang Hiep
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className={cn(
        "h-screen flex flex-col bg-slate-50 overflow-hidden", 
        (isFullScreen || (pdfDoc && window.innerWidth < 768)) && "fixed inset-0 z-50"
      )}>
      {/* Key Check Notification */}
      <AnimatePresence>
        {keyCheckResults && (
          <motion.div 
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[1000] w-full max-w-md px-4"
          >
            <div className="bg-white rounded-3xl shadow-2xl border border-slate-100 p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-100 p-2 rounded-xl">
                    <Key className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h4 className="font-display font-black text-slate-800">Kiểm tra kết nối API</h4>
                    {keyCheckResults.totalActive !== undefined && (
                      <p className="text-[10px] font-black text-emerald-600 uppercase tracking-tighter">
                        Hoạt động: {keyCheckResults.totalActive}/{keyCheckResults.totalChecked}
                      </p>
                    )}
                  </div>
                </div>
                <button onClick={() => setKeyCheckResults(null)} className="p-1 hover:bg-slate-50 rounded-full">
                  <ChevronLeft className="w-5 h-5 text-slate-400 rotate-180" />
                </button>
              </div>

              <div className="space-y-3">
                {(keyCheckResults.manualKey || keyCheckResults.isVaultKey) ? (
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-2xl border border-slate-100">
                    <div className="flex items-center gap-3">
                      <Key className={cn("w-4 h-4", (keyCheckResults.manualKey) ? "text-emerald-500" : "text-slate-300")} />
                      <span className="text-xs font-bold text-slate-700">
                        {keyCheckResults.isVaultKey ? `Key từ Vault (${keyCheckResults.vaultKeyName})` : 'Key Thủ công (Manual)'}
                      </span>
                    </div>
                    {keyCheckResults.manualKey ? (
                      <span className="px-2 py-1 bg-emerald-100 text-emerald-600 text-[10px] font-black rounded-lg uppercase tracking-tighter">Kết nối thành công</span>
                    ) : (
                      <span className="px-2 py-1 bg-rose-100 text-rose-600 text-[10px] font-black rounded-lg uppercase tracking-tighter">Lỗi kết nối</span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center p-8 bg-slate-50 rounded-2xl border border-slate-100 border-dashed">
                    <p className="text-xs text-slate-400 italic">Không tìm thấy Key nào đang được kích hoạt</p>
                  </div>
                )}
              </div>

              {!keyCheckResults.envKey && !keyCheckResults.manualKey && (
                <div className="p-3 bg-rose-50 border border-rose-100 rounded-2xl flex items-center gap-3 text-rose-600 text-[10px] font-bold">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  Không có API Key nào hoạt động. Vui lòng cấu hình trong Cài đặt.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Header */}
      {(!isFullScreen && !(pdfDoc && window.innerWidth < 768)) && (
        <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-4 shrink-0 shadow-sm z-30">
          {file || pdfDoc ? (
            <button 
              onClick={clearFile}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 mr-2"
              title="Quay lại quản lý file"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : null}
          <LogoWithText onClick={handleGoHome} />

        <div className="flex items-center gap-2">
          {pdfDoc && (
            <div className="hidden md:flex items-center bg-slate-50 rounded-full px-3 py-1 gap-2 border border-slate-100 max-w-[300px]">
              <FileText className="w-3.5 h-3.5 text-slate-400" />
              <span className="text-xs font-medium text-slate-600 truncate">{currentFileName}</span>
            </div>
          )}
          
          <div className="h-6 w-px bg-slate-200 mx-1 hidden md:block" />
          
          {pdfDoc && (
            <button 
              onClick={clearFile}
              className="flex items-center gap-1.5 px-3 py-1.5 hover:bg-slate-100 text-slate-500 hover:text-indigo-600 rounded-full transition-all text-[10px] font-bold uppercase tracking-wider"
              title="Đóng tài liệu hiện tại"
            >
              <X className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Đóng file</span>
            </button>
          )}

          {userRole === 'admin' && (
            <button 
              onClick={() => {
                setShowAdminPanel(true);
                fetchAllUsers();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 text-white rounded-full transition-all text-[10px] font-bold uppercase tracking-wider shadow-sm hover:bg-amber-600"
              title="Quản trị hệ thống"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Quản trị</span>
            </button>
          )}

          <button 
            onClick={() => setShowDrivePickerModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 border border-indigo-100 text-indigo-600 hover:bg-indigo-100 rounded-full transition-all text-[10px] font-bold uppercase tracking-wider shadow-sm"
            title="Mở hoặc chọn tài liệu từ Google Drive"
          >
            <HardDrive className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Google Drive</span>
          </button>

          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500"
            title="Cài đặt hệ thống"
          >
            <Settings className="w-4 h-4" />
          </button>

          <button 
            onClick={() => setShowApiSettings(true)}
            className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500"
            title="Quản lý API Keys"
          >
            <Key className="w-4 h-4" />
          </button>

          <button 
            onClick={() => {
              const nextState = !showTranslationPanel;
              setShowTranslationPanel(nextState);
              if (!nextState) {}
              
              // On mobile, also update mobileViewMode for better sync
              if (window.innerWidth < 768) {
                setMobileViewMode(nextState ? 'split' : 'pdf');
              }
            }}
            className={cn(
              "p-2 rounded-full transition-all",
              showTranslationPanel ? "bg-indigo-50 text-indigo-600 shadow-sm" : "hover:bg-slate-100 text-slate-500"
            )}
            title={showTranslationPanel ? "Đóng Tra cứu & Dịch thuật" : "Mở Tra cứu & Dịch thuật"}
          >
            <Languages className="w-4 h-4" />
          </button>
          
          <button 
            onClick={toggleFullScreen}
            className={cn(
              "p-2 rounded-full transition-all",
              isFullScreen ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" : "hover:bg-slate-100 text-slate-500"
            )}
            title={isFullScreen ? "Thoát toàn màn hình" : "Toàn màn hình (F11)"}
          >
            {isFullScreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <div className="h-6 w-px bg-slate-200 mx-1" />

          {isAuthReady && (
            user ? (
              <div className="flex items-center gap-2 pl-1">
                <div className="hidden lg:flex flex-col items-end mr-1">
                  <span className="text-[10px] font-bold text-slate-700 leading-none">{user.displayName || 'Người dùng'}</span>
                  <span className="text-[8px] text-slate-400 font-medium">{user.email}</span>
                </div>
                <div className="relative group">
                  <img 
                    src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName || 'User'}&background=6366f1&color=fff`} 
                    alt="Avatar" 
                    className="w-8 h-8 rounded-full border-2 border-white shadow-sm cursor-pointer"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-2xl shadow-xl border border-slate-100 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 p-2">
                    <div className="px-3 py-2 border-b border-slate-50 mb-1">
                      <p className="text-xs font-bold text-slate-800 truncate">{user.displayName}</p>
                      <p className="text-[10px] text-slate-400 truncate">{user.email}</p>
                    </div>
                    <button 
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-3 py-2 text-rose-500 hover:bg-rose-50 rounded-xl transition-colors text-xs font-bold"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      Đăng xuất
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button 
                onClick={() => setShowAuthModal(true)}
                className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-1.5 rounded-full text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 active:scale-95"
              >
                <LogIn className="w-3.5 h-3.5" />
                Đăng nhập
              </button>
            )
          )}
        </div>
      </header>
      )}

      {/* Main Content */}
      <main className="flex-1 flex overflow-hidden relative bg-slate-50">
        <UploadStatus tasks={uploadTasks} onDismiss={dismissUploadTask} />
        {showExplorer ? (
          <div className="flex-1 p-4 sm:p-8 overflow-hidden">
            <FileExplorer 
              onFileSelect={handleFileSelectFromExplorer} 
              onUploadStart={startUpload} 
              onLocalFileOpen={handleLocalFileOpen}
              onBulkTranslate={handleBulkTranslateFromExplorer}
              onOpenGoogleDrive={() => setShowDrivePickerModal(true)}
            />
          </div>
        ) : (
          <div className="flex-1 flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-slate-200 min-h-0 w-full overflow-hidden relative">
            {/* Left Side: Original PDF */}
            <div className={cn(
              "flex flex-col bg-slate-100 overflow-hidden border-r border-slate-200 transition-all duration-300 ease-in-out relative",
              isFullScreen ? "w-1/2" : (showTranslationPanel ? "w-full md:w-1/2" : "w-full"),
              mobileViewMode === 'pdf' ? "flex h-full" : (mobileViewMode === 'split' ? "flex h-[45%] shrink-0 md:h-full" : "hidden md:flex")
            )}>
              <div className="h-11 bg-white border-b border-slate-200 flex items-center justify-between px-3 shrink-0 z-20 shadow-sm overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-3 min-w-max">
                  <div className="flex items-center gap-1.5">
                    {isLocalOnly && (
                      <button 
                        onClick={() => setShowFolderSelectModal(true)}
                        className="flex items-center gap-1.5 px-3 py-1 bg-amber-500 text-white text-[10px] font-bold rounded-full hover:bg-amber-600 transition-all shadow-sm ml-2"
                        title="Tải tệp này lên đám mây để lưu trữ"
                      >
                        <Upload className="w-3 h-3" />
                        <span>TẢI LÊN ĐÁM MÂY</span>
                      </button>
                    )}

                    {isFullScreen && (
                      <button 
                        onClick={toggleFullScreen}
                        className="flex items-center gap-1 px-2 py-0.5 bg-indigo-600 text-white text-[10px] font-bold rounded-full hover:bg-indigo-700 transition-all shadow-sm ml-2"
                      >
                        <Minimize2 className="w-3 h-3" />
                        <span>THOÁT TOÀN MÀN HÌNH</span>
                      </button>
                    )}

                    {fileUrl && !isLocalOnly && (
                      <a 
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1 bg-emerald-500 text-white text-[10px] font-bold rounded-full hover:bg-emerald-600 transition-all shadow-sm ml-2"
                        title="Tải tệp PDF gốc về máy"
                      >
                        <Download className="w-3 h-3" />
                        <span>TẢI PDF GỐC</span>
                      </a>
                    )}

                    {/* Mobile Actions - Settings & Close */}
                    <div className="flex md:hidden items-center gap-0.5 mr-2">
                      <button 
                        onClick={() => setShowSettings(true)}
                        className="p-1.5 text-slate-400 active:text-indigo-600 transition-colors"
                        title="Cài đặt hệ thống"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={() => setShowApiSettings(true)}
                        className="p-1.5 text-slate-400 active:text-indigo-600 transition-colors"
                        title="Quản lý API Keys"
                      >
                        <Key className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={clearFile}
                        className="p-1.5 text-slate-400 active:text-indigo-600 transition-colors"
                        title="Đóng PDF"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Mobile Navigation - Removed as redundant with floating bar */}
                    <div className="hidden md:flex items-center gap-0.5 bg-slate-50 rounded-lg px-1.5 py-0.5 border border-slate-100">
                      {/* Navigation Logic Consolidated Below */}
                    </div>
                  </div>

                  <div className="h-4 w-px bg-slate-200 hidden xs:block" />

                  <div className="flex items-center gap-0.5">
                    <button 
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="p-1 hover:bg-slate-100 rounded-md disabled:opacity-20 transition-colors"
                    >
                      <ChevronLeft className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-600" />
                    </button>
                    <div className="flex items-center gap-1 px-1">
                      <input 
                        type="number" 
                        min={1} 
                        max={numPages}
                        value={currentPage}
                        onChange={(e) => {
                          const val = parseInt(e.target.value);
                          if (!isNaN(val) && val >= 1 && val <= numPages) {
                            setCurrentPage(val);
                          }
                        }}
                        className="w-8 md:w-9 h-5 md:h-6 text-center text-[10px] md:text-[11px] font-bold border border-slate-200 rounded bg-slate-50 focus:bg-white focus:ring-1 focus:ring-indigo-500 transition-all px-0"
                      />
                      <span className="text-[9px] md:text-[10px] font-bold text-slate-400">/ {numPages}</span>
                    </div>
                    <button 
                      onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
                      disabled={currentPage === numPages}
                      className="p-1 hover:bg-slate-100 rounded-md disabled:opacity-20 transition-colors"
                    >
                      <ChevronRight className="w-3.5 h-3.5 md:w-4 md:h-4 text-slate-600" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3 min-w-max ml-4">
                  <div className="flex items-center gap-0.5 bg-slate-50 rounded-lg p-0.5 border border-slate-100">
                    <button 
                      onClick={() => setIsPanning(!isPanning)}
                      className={cn(
                        "p-1.5 rounded transition-all",
                        isPanning ? "bg-indigo-600 text-white shadow-md" : "hover:bg-white text-slate-500"
                      )}
                      title={isPanning ? "Tắt Hand Tool" : "Bật Hand Tool (Di chuyển)"}
                    >
                      <Hand className="w-3.5 h-3.5" />
                    </button>
                    <div className="w-px h-3 bg-slate-200 mx-0.5" />
                    <button 
                      onClick={() => {
                        const nextState = !isLookupEnabled;
                        setIsLookupEnabled(nextState);
                        if (!nextState) {}
                      }}
                      className={cn(
                        "p-1.5 rounded transition-all",
                        isLookupEnabled ? "bg-indigo-600 text-white shadow-md" : "hover:bg-white text-slate-500"
                      )}
                      title={isLookupEnabled ? "Tắt Tra cứu nhanh" : "Bật Tra cứu nhanh (Bôi đen để dịch)"}
                    >
                      <Search className="w-3.5 h-3.5" />
                    </button>
                    <div className="w-px h-3 bg-slate-200 mx-0.5" />
                    <button 
                      onClick={() => {
                        setIsAutoFit(false);
                        setZoom(z => Math.max(0.5, z - 0.1));
                      }} 
                      className="p-1.5 hover:bg-white hover:shadow-sm rounded transition-all text-slate-500"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[10px] font-black font-mono text-slate-600 w-9 text-center">
                      {Math.round(zoom * 100)}%
                    </span>
                    <button 
                      onClick={() => {
                        setIsAutoFit(false);
                        setZoom(z => Math.min(3, z + 0.1));
                      }} 
                      className="p-1.5 hover:bg-white hover:shadow-sm rounded transition-all text-slate-500"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                    </button>
                    <button 
                      onClick={fitToWidthAction} 
                      className={cn(
                        "p-1.5 rounded transition-all ml-0.5",
                        isAutoFit ? "bg-indigo-600 text-white shadow-md" : "hover:bg-white text-slate-500"
                      )}
                      title="Vừa khít chiều rộng"
                    >
                      <Maximize className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
              <div 
                className={cn(
                  "flex-1 overflow-auto pdf-container relative bg-slate-100 pb-52 md:pb-8",
                  isFullScreen ? "p-0" : "p-4 md:p-8",
                  isPanning ? "cursor-grab select-none touch-none" : "cursor-auto"
                )} 
                ref={containerRef}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
              >
                <div className="inline-block min-w-full text-center align-top">
                  {!pdfDoc && isPdfLoading ? (
                    <div className="flex flex-col items-center justify-center py-20 gap-4">
                      <div className="relative">
                        <div className="w-16 h-16 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
                        <FileText className="absolute inset-0 m-auto w-6 h-6 text-indigo-600" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-slate-700">Đang tải tài liệu...</p>
                        <p className="text-xs text-slate-400">Vui lòng đợi trong giây lát</p>
                      </div>
                    </div>
                  ) : (
                    <div className={cn(
                      "inline-block text-left relative shadow-2xl bg-white overflow-hidden shrink-0 transition-all duration-300",
                      isFullScreen ? "my-0 rounded-none border-none" : "my-8 rounded-lg border border-slate-200"
                    )}>
                      {(isPdfLoading || isRendering) && (
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-200/30 z-20">
                          <div className="flex flex-col items-center gap-2">
                            <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                          </div>
                        </div>
                      )}
                      {pdfError && (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/95 z-30 p-4 text-center">
                          <div className="max-w-md bg-white p-6 rounded-2xl border border-rose-100 shadow-2xl flex flex-col items-center">
                            <AlertCircle className="w-12 h-12 text-rose-500 mb-3" />
                            <p className="text-sm font-bold text-slate-800 mb-5 leading-relaxed">{pdfError}</p>
                            <button 
                              onClick={handleGoHome}
                              className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 flex items-center gap-2 cursor-pointer"
                            >
                              <Home className="w-4 h-4" />
                              <span>Quay về trang chủ</span>
                            </button>
                          </div>
                        </div>
                      )}
                      <canvas 
                        ref={canvasRef} 
                        className={cn(
                          "transition-opacity duration-200 relative z-0 block", 
                          (isPdfLoading || isRendering) ? "opacity-50" : "opacity-100"
                        )} 
                      />
                      <div 
                        ref={textLayerRef}
                        className="absolute inset-0 textLayer pointer-events-auto z-10"
                        onMouseUp={handleMouseUp}
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Side: Translation */}
            <motion.div 
              initial={{ x: 300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 300, opacity: 0 }}
              className={cn(
                "flex flex-col bg-white overflow-hidden transition-all duration-300",
                isFullScreen ? "flex w-1/2" : (mobileViewMode === 'translation' ? "flex h-full" : (mobileViewMode === 'split' ? "flex h-[55%] border-t-2 border-slate-200 md:h-full md:border-t-0" : (showTranslationPanel ? "hidden md:flex w-1/2" : "hidden")))
              )}
            >
              <div className="h-11 border-b border-slate-200 flex items-center justify-between px-3 shrink-0 z-20 shadow-sm overflow-x-auto no-scrollbar">
                <div className="flex items-center gap-3 min-w-max">
                  <div className="flex items-center gap-2">
                    <div className="flex md:hidden items-center gap-0.5 mr-1">
                      <button 
                        onClick={() => setShowSettings(true)}
                        className="p-1.5 text-slate-400 active:text-indigo-600 transition-colors"
                        title="Cài đặt hệ thống"
                      >
                        <Settings className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={() => setShowApiSettings(true)}
                        className="p-1.5 text-slate-400 active:text-indigo-600 transition-colors"
                        title="Quản lý API Keys"
                      >
                        <Key className="w-3.5 h-3.5" />
                      </button>
                      <button 
                        onClick={clearFile}
                        className="p-1.5 text-slate-400 active:text-indigo-600 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1 p-1 bg-slate-100/50 rounded-lg border border-slate-200/50">
                      <button 
                        onClick={() => setTranslationPanelMode('translation')}
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-1 rounded-md transition-all text-[10px] font-black uppercase tracking-tight",
                          translationPanelMode === 'translation' ? "bg-white shadow-sm text-indigo-600" : "text-slate-400 hover:text-slate-600"
                        )}
                      >
                        <Languages className="w-3 h-3" />
                        <span>Dịch</span>
                      </button>
                      <button 
                        onClick={() => setTranslationPanelMode('summary')}
                        className={cn(
                          "flex items-center gap-1.5 px-2 py-1 rounded-md transition-all text-[10px] font-black uppercase tracking-tight",
                          translationPanelMode === 'summary' ? "bg-white shadow-sm text-indigo-600" : "text-slate-400 hover:text-slate-600"
                        )}
                      >
                        <ScrollText className="w-3 h-3" />
                        <span>Tóm tắt</span>
                      </button>
                    </div>
                  </div>
                  
                  <div className="h-4 w-px bg-slate-200" />
                  
                  {isTranslating && (
                    <button 
                      onClick={cancelTranslation}
                      className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-rose-50 border border-rose-100 text-rose-600 hover:bg-rose-100 transition-all"
                      title="Dừng dịch thuật"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                      <span className="text-[9px] font-black uppercase tracking-tight">Dừng</span>
                    </button>
                  )}

                  {isTranslating && <div className="h-4 w-px bg-slate-200" />}

                  <button 
                    onClick={toggleAutoTranslate}
                    className={cn(
                      "flex items-center gap-1.5 px-2 py-0.5 rounded-full transition-all border",
                      autoTranslate 
                        ? "bg-emerald-50 border-emerald-100 text-emerald-600" 
                        : "bg-slate-50 border-slate-100 text-slate-400 hover:text-slate-500"
                    )}
                    title="Tự động dịch khi chuyển trang"
                  >
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      autoTranslate ? "bg-emerald-500 animate-pulse" : "bg-slate-300"
                    )} />
                    <span className="text-[9px] font-black uppercase tracking-tight">Auto</span>
                  </button>

                  <div className="h-4 w-px bg-slate-200" />
                </div>
                
                <div className="flex items-center gap-1.5 md:gap-3 min-w-max ml-0 md:ml-4 flex-wrap pb-2 md:pb-0">
                  <button 
                    onClick={() => {
                      if (translations[currentPage]?.status === 'success') {
                        setSelectedPagesToDownload([currentPage]);
                      } else {
                        setSelectedPagesToDownload([]);
                      }
                      setShowDownloadModal(true);
                    }}
                    className="flex items-center justify-center p-2 rounded-xl text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-all border border-indigo-100 shadow-sm hover:scale-105 active:scale-95"
                    title="Tải tập tin dịch"
                  >
                    <Download className="w-4 h-4" />
                  </button>

                  <div className="h-4 w-px bg-slate-200 hidden xs:block" />

                  {translationPanelMode === 'translation' ? (
                    <div className="flex items-center gap-1.5 md:gap-2">
                      <button 
                        onClick={() => translateCurrentPage(currentPage, true, 'gemini-flash-lite-latest')}
                        disabled={isTranslating}
                        className={cn(
                          "p-2 rounded-xl transition-all flex items-center justify-center border shadow-sm",
                          isTranslating
                            ? "bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed" 
                            : "bg-indigo-50 text-indigo-600 border-indigo-100 hover:bg-indigo-100 hover:shadow hover:scale-105 active:scale-95"
                        )}
                        title={isTranslating ? 'Đang dịch thường...' : (translations[currentPage] ? 'Dịch lại (Thường)' : 'Dịch thường')}
                      >
                        {isTranslating ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Zap className="w-4 h-4" />
                        )}
                      </button>

                      <button 
                        onClick={() => translateCurrentPage(currentPage, true, 'gemini-3.6-flash')}
                        disabled={isTranslating}
                        className={cn(
                          "p-2 rounded-xl transition-all flex items-center justify-center shadow-lg",
                          isTranslating
                            ? "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none" 
                            : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-200 hover:shadow-indigo-300 hover:scale-105 active:scale-95"
                        )}
                        title={isTranslating ? 'Đang dịch chuyên sâu...' : (translations[currentPage] ? 'Dịch lại (Chuyên sâu 3.6 Flash)' : 'Dịch chuyên sâu (3.6 Flash)')}
                      >
                        {isTranslating ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 bg-slate-100/50 p-1 rounded-2xl border border-slate-200/50">
                      <button 
                        onClick={() => handleSummarize('page')}
                        disabled={isSummarizing}
                        className={cn(
                          "px-2 md:px-3 py-1.5 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 md:gap-2",
                          isSummarizing 
                            ? "text-slate-400 opacity-50" 
                            : "bg-white text-indigo-600 shadow-sm hover:bg-indigo-50"
                        )}
                        title="Tóm tắt trang hiện tại"
                      >
                        {isSummarizing ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <FileSearch className="w-3.5 h-3.5" />
                        )}
                        <span className="hidden sm:inline">Trang</span>
                      </button>

                      <div className="flex items-center gap-1 px-1 bg-white/60 rounded-lg border border-slate-200 shadow-inner group transition-all focus-within:ring-2 focus-within:ring-indigo-100">
                        <input 
                          type="number" 
                          min={1} 
                          max={numPages} 
                          value={summaryRange.from} 
                          onChange={(e) => setSummaryRange(prev => ({ ...prev, from: parseInt(e.target.value) || 1 }))}
                          className="w-7 md:w-8 text-[10px] font-black bg-transparent border-none p-0 text-center text-slate-600 focus:ring-0"
                          title="Trang bắt đầu"
                        />
                        <span className="text-[10px] font-black text-slate-400">→</span>
                        <input 
                          type="number" 
                          min={1} 
                          max={numPages} 
                          value={summaryRange.to} 
                          onChange={(e) => setSummaryRange(prev => ({ ...prev, to: parseInt(e.target.value) || 1 }))}
                          className="w-7 md:w-8 text-[10px] font-black bg-transparent border-none p-0 text-center text-slate-600 focus:ring-0"
                          title="Trang kết thúc"
                        />
                        <button 
                          onClick={() => handleSummarize('chapter')}
                          disabled={isSummarizing}
                          className={cn(
                            "ml-1 p-1.5 rounded-lg transition-all",
                            isSummarizing 
                              ? "text-slate-300" 
                              : "text-indigo-600 hover:bg-indigo-50 active:scale-90"
                          )}
                          title="Tóm tắt khoảng tùy chọn"
                        >
                          <Layout className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      
                      <button 
                        onClick={() => handleSummarize('document')}
                        disabled={isSummarizing}
                        className={cn(
                          "px-2 md:px-3 py-1.5 rounded-xl text-[9px] md:text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-1.5 md:gap-2",
                          isSummarizing 
                            ? "text-slate-400 opacity-50" 
                            : "bg-white text-indigo-600 shadow-sm hover:bg-indigo-50"
                        )}
                        title="Tóm tắt toàn bộ tài liệu"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Tài liệu</span>
                      </button>
                    </div>
                  )}

                  <div className="h-4 w-px bg-slate-200 hidden xs:block" />

                  <AnimatePresence>
                    {translationPanelMode === 'translation' && serviceStatus && (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="hidden xs:flex items-center gap-2 px-2.5 py-1.5 bg-indigo-50 border border-indigo-100/50 rounded-xl"
                      >
                        <Zap className={cn("w-3 h-3", serviceStatus.activeKeys > 0 ? "text-amber-500 animate-pulse" : "text-slate-400")} />
                        <div className="flex flex-col">
                          <span className="text-[8px] leading-none font-black uppercase tracking-tight text-indigo-700 mb-0.5">
                            {serviceStatus.model.toLowerCase().includes('flash') ? "Gemini Flash" : "Gemini Pro"}
                          </span>
                          <div className="flex items-center gap-1">
                            <span className="text-[7px] font-bold text-indigo-400 leading-none">
                              {serviceStatus.activeKeys}/{serviceStatus.totalKeys} Keys
                            </span>
                            {serviceStatus.lastUsedSuffix !== '...' && (
                              <span className="text-[7px] px-1 bg-white rounded-sm text-indigo-600 font-mono leading-none border border-indigo-100">
                                *{serviceStatus.lastUsedSuffix}
                              </span>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {(translationPanelMode === 'translation' ? translations[currentPage]?.content : summaryText) && (
                    <div className="flex items-center gap-1.5 ml-auto">
                      <button 
                        onClick={() => handleCopyTranslation(translationPanelMode === 'translation' ? translations[currentPage].content : summaryText, currentPage)}
                        className={cn(
                          "p-2 border rounded-xl transition-all flex items-center gap-1.5 shadow-sm",
                          copiedPage === currentPage 
                            ? "bg-emerald-50 border-emerald-200 text-emerald-600" 
                            : "bg-white border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50/30"
                        )}
                        title="Sao chép"
                      >
                        {copiedPage === currentPage ? (
                          <>
                            <Check className="w-3.5 h-3.5" />
                            <span className="hidden xs:inline text-[9px] font-black uppercase tracking-wider">Đã chép!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span className="hidden xs:inline text-[9px] font-black uppercase tracking-wider text-slate-400">Chép</span>
                          </>
                        )}
                      </button>

                      {translationPanelMode === 'summary' && summaryText && (
                        <>
                          <button 
                            onClick={handleSaveSummary}
                            disabled={isSavingSummary || isSummarizing}
                            className="p-2 border border-slate-200 rounded-xl bg-white text-slate-400 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50/30 transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                            title="Lưu tóm tắt vào đám mây"
                          >
                            {isSavingSummary ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                            <span className="hidden xs:inline text-[9px] font-black uppercase tracking-wider">Lưu</span>
                          </button>
                          <button 
                            onClick={handleDownloadSummary}
                            className="p-2 border border-slate-200 rounded-xl bg-white text-slate-400 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50/30 transition-all flex items-center gap-1.5 shadow-sm"
                            title="Tải xuống tóm tắt"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span className="hidden xs:inline text-[9px] font-black uppercase tracking-wider text-slate-400">Tải</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}

                  <div className="h-4 w-px bg-slate-200 hidden md:block" />
                  
                  {/* Font Controls at the end */}
                  <div className="flex items-center gap-1.5 bg-slate-50 rounded-xl p-1 border border-slate-200/80 shadow-sm">
                    {/* Font Family Selector */}
                    <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg hover:bg-slate-100 transition-colors">
                      <FontIcon className="w-3.5 h-3.5 text-indigo-500" />
                      <select 
                        value={fontFamily}
                        onChange={(e) => setFontFamily(e.target.value)}
                        className="text-[11px] font-bold bg-transparent border-none focus:ring-0 cursor-pointer text-slate-700 p-0 outline-none select-none"
                        title="Kiểu phông chữ"
                      >
                        <option value="Inter">Không chân (Inter)</option>
                        <option value="Cormorant Garamond">Dễ đọc (Cormorant)</option>
                        <option value="Playfair Display">Nghệ thuật (Playfair)</option>
                        <option value="JetBrains Mono">Đơn cách (Mono)</option>
                      </select>
                    </div>
                    
                    <div className="w-px h-4 bg-slate-200" />
                    
                    {/* Font Size Selector & Quick Controls */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setFontSize(prev => Math.max(12, prev - 1))}
                        disabled={fontSize <= 12}
                        className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent text-slate-500 hover:text-indigo-600 transition-all active:scale-90"
                        title="Giảm cỡ chữ"
                      >
                        <Minus className="w-3 h-3" />
                      </button>

                      <div className="flex items-center gap-0.5 px-1 rounded-lg hover:bg-slate-100 transition-colors">
                        <ALargeSmall className="w-3.5 h-3.5 text-indigo-500" />
                        <select 
                          value={fontSize}
                          onChange={(e) => setFontSize(Number(e.target.value))}
                          className="text-[11px] font-black bg-transparent border-none focus:ring-0 cursor-pointer text-slate-700 p-0 outline-none w-10 text-center"
                          title="Cỡ chữ"
                        >
                          {[12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28, 30].map(size => (
                            <option key={size} value={size}>{size}px</option>
                          ))}
                        </select>
                      </div>

                      <button
                        onClick={() => setFontSize(prev => Math.min(30, prev + 1))}
                        disabled={fontSize >= 30}
                        className="p-1 rounded-lg hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent text-slate-500 hover:text-indigo-600 transition-all active:scale-90"
                        title="Tăng cỡ chữ"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="flex-1 overflow-auto p-6 md:p-12 bg-white">
                <AnimatePresence mode="wait">
                  {translationPanelMode === 'summary' ? (
                    <motion.div 
                      key="summary-view"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="h-full flex flex-col"
                    >
                      {!summaryText && !isSummarizing ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 text-center">
                          <ScrollText className="w-12 h-12 mb-4 opacity-20" />
                          <p className="text-sm font-medium">Chưa có tóm tắt.</p>
                          <p className="text-xs">Chọn chế độ tóm tắt để bắt đầu.</p>
                        </div>
                      ) : (
                        <div 
                          className="markdown-body select-text pb-60 md:pb-0"
                          style={{ 
                            fontSize: `${fontSize}px`,
                            fontFamily: fontFamily === 'Inter' ? 'var(--font-sans)' : 
                                       fontFamily === 'JetBrains Mono' ? 'var(--font-mono)' : 
                                       fontFamily === 'Playfair Display' ? 'var(--font-display)' :
                                       fontFamily === 'Cormorant Garamond' ? 'var(--font-serif)' :
                                       fontFamily
                          }}
                        >
                          {isSummarizing && !summaryText && (
                            <div className="flex flex-col items-center justify-center py-20 gap-4">
                              <Loader2 className="w-10 h-10 text-indigo-600 animate-spin" />
                              <p className="text-xs font-bold text-slate-500 animate-pulse uppercase tracking-wider">Đang khởi tạo tóm tắt...</p>
                            </div>
                          )}
                          <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                            {summaryText}
                          </ReactMarkdown>
                          {isSummarizing && summaryText && (
                            <div className="mt-4 flex items-center gap-2 text-indigo-600 font-bold text-xs animate-pulse">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              <span>Đang tóm tắt nội dung...</span>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    // Translation Mode Content
                    (!translations[currentPage] && (!activeTranslation || activeTranslation.page !== currentPage)) ? (
                      (isRendering || isPdfLoading) ? (
                      <motion.div 
                        key="rendering"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="h-full flex flex-col items-center justify-center text-slate-400 text-center"
                      >
                        <Loader2 className="w-12 h-12 mb-4 text-indigo-400 animate-spin" />
                        <p className="text-sm font-medium">Đang chuẩn bị trang...</p>
                        <p className="text-xs">Vui lòng đợi trong giây lát</p>
                      </motion.div>
                    ) : (
                      <motion.div 
                        key="empty"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="h-full flex flex-col items-center justify-center text-slate-400 text-center"
                      >
                        <Search className="w-12 h-12 mb-4 opacity-20" />
                        <p className="text-sm font-medium">Chưa có bản dịch cho trang này.</p>
                        <p className="text-xs">Nhấn "Dịch trang này" để bắt đầu.</p>
                      </motion.div>
                    )
                  ) : (translations[currentPage]?.status === 'loading' && !translations[currentPage].content && (!activeTranslation || activeTranslation.page !== currentPage)) ? (
                    <motion.div 
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center justify-center gap-4"
                    >
                      <div className="relative">
                        <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin" />
                        <Languages className="absolute inset-0 m-auto w-5 h-5 text-indigo-600" />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-bold text-slate-700">Đang phân tích y khoa...</p>
                        <p className="text-xs text-slate-400 mb-4">Gemini đang xử lý hình ảnh và văn bản</p>
                        <button 
                          onClick={cancelTranslation}
                          className="px-4 py-2 bg-slate-100 text-slate-600 rounded-xl text-xs font-bold hover:bg-rose-50 hover:text-rose-600 transition-all border border-slate-200"
                        >
                          Dừng dịch
                        </button>
                      </div>
                    </motion.div>
                  ) : translations[currentPage]?.status === 'error' ? (
                    <motion.div 
                      key="error"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="h-full flex flex-col items-center justify-center gap-4 text-rose-500 bg-rose-50 rounded-2xl p-8"
                    >
                      <AlertCircle className="w-12 h-12" />
                      <p className="text-sm font-bold text-center leading-relaxed">
                        {translations[currentPage].content}
                      </p>
                      
                      {translations[currentPage].content?.includes('hết hạn mức') && (
                        <div className="bg-white/50 p-3 rounded-xl border border-rose-200 mt-2 text-center">
                          <p className="text-[11px] font-medium mb-2">Hệ thống gợi ý:</p>
                          <p className="text-[10px] italic">Thêm nhiều Key trong Cài đặt để tự động luân phiên tránh lỗi này.</p>
                        </div>
                      )}

                      <div className="flex flex-wrap justify-center gap-3">
                        <button 
                          onClick={() => setShowApiSettings(true)}
                          className="px-5 py-2.5 bg-rose-600 text-white rounded-2xl text-xs font-bold hover:bg-rose-700 transition-all shadow-lg shadow-rose-200 flex items-center gap-2"
                        >
                          <Key className="w-3.5 h-3.5" />
                          Quản lý API Key
                        </button>
                        <button 
                          onClick={() => translateCurrentPage(currentPage, true)}
                          className="px-5 py-2.5 bg-white border border-rose-200 text-rose-600 rounded-2xl text-xs font-bold hover:bg-rose-100 transition-all"
                        >
                          Thử lại
                        </button>
                      </div>
                      
                      {(window as any).aistudio?.openSelectKey && (
                        <button 
                          onClick={async () => {
                            if (translationService.current instanceof GeminiService) {
                              await (translationService.current as any).openKeySelection();
                              translateCurrentPage(currentPage, true);
                            }
                          }}
                          className="mt-2 text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-700 underline underline-offset-4"
                        >
                          Chọn Key từ AI Studio
                        </button>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div 
                      key="content"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="markdown-body select-text pb-60 md:pb-0"
                      onMouseUp={handleMouseUp}
                      style={{ 
                        fontSize: `${fontSize}px`,
                        fontFamily: fontFamily === 'Inter' ? 'var(--font-sans)' : 
                                   fontFamily === 'JetBrains Mono' ? 'var(--font-mono)' : 
                                   fontFamily === 'Playfair Display' ? 'var(--font-display)' :
                                   fontFamily === 'Cormorant Garamond' ? 'var(--font-serif)' :
                                   fontFamily
                      }}
                    >
                        <TranslationMarkdown 
                          content={activeTranslation && activeTranslation.page === currentPage 
                            ? activeTranslation.content 
                            : translations[currentPage]?.content || ''}
                          page={currentPage}
                          isStreaming={!!(activeTranslation && activeTranslation.page === currentPage && activeTranslation.status === 'loading')}
                          onCancel={cancelTranslation}
                          fontSize={fontSize}
                          fontFamily={fontFamily}
                        />

                      {/* Mobile Navigation Buttons - Removed as redundant with floating bar */}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </motion.div>
          </div>
        )}
      </main>

      {/* Tablet Navigation Buttons */}
      {pdfDoc && !showSettings && !showAuthModal && (
        <div className="fixed bottom-6 md:bottom-8 left-0 right-0 pointer-events-none z-40 hidden md:flex justify-between px-4 md:px-12">
          <button 
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1 || isPdfLoading || isRendering}
            className={cn(
              "pointer-events-auto w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 border backdrop-blur-sm",
              (currentPage === 1 || isPdfLoading || isRendering)
                ? "bg-slate-50/80 text-slate-200 border-slate-100 cursor-not-allowed" 
                : "bg-white/90 text-indigo-600 hover:bg-indigo-50 border-indigo-100 hover:shadow-indigo-100"
            )}
            title="Trang trước"
          >
            <ChevronLeft className="w-6 h-6 md:w-8 md:h-8" />
          </button>
          
          <button 
            onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
            disabled={currentPage === numPages || isPdfLoading || isRendering}
            className={cn(
              "pointer-events-auto w-12 h-12 md:w-14 md:h-14 rounded-full flex items-center justify-center shadow-2xl transition-all active:scale-90 border backdrop-blur-sm",
              (currentPage === numPages || isPdfLoading || isRendering)
                ? "bg-slate-50/80 text-slate-200 border-slate-100 cursor-not-allowed" 
                : "bg-indigo-600/90 text-white hover:bg-indigo-700 border-indigo-500 shadow-indigo-200 hover:shadow-indigo-300"
            )}
            title="Trang tiếp theo"
          >
            <ChevronRight className="w-6 h-6 md:w-8 md:h-8" />
          </button>
        </div>
      )}

      {/* Auth Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuthModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8">
                <div className="text-center mb-6">
                  <div className="bg-indigo-600 w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-indigo-200">
                    <UserIcon className="text-white w-6 h-6" />
                  </div>
                  <h3 className="text-2xl font-display font-bold text-slate-800">
                    Đăng nhập tài khoản
                  </h3>
                  <p className="text-slate-500 text-sm mt-1">
                    Sử dụng tài khoản Google để tiếp tục
                  </p>
                </div>

                <div className="mb-4">
                  <button
                    type="button"
                    onClick={handleGoogleAuth}
                    disabled={isLoggingIn}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg shadow-indigo-100 transition-all active:scale-95 flex items-center justify-center gap-3 text-sm disabled:opacity-50"
                  >
                    {isLoggingIn ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#ffffff" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                        <path fill="#ffffff" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#ffffff" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#ffffff" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                      </svg>
                    )}
                    <span>Đăng nhập với Google (Gmail)</span>
                  </button>
                  {authError && (
                    <div className="mt-3 p-3 bg-rose-50 text-rose-600 rounded-xl text-xs font-bold text-center">
                      {authError}
                    </div>
                  )}
                </div>

                <div className="mt-6 text-center">
                  <button 
                    onClick={() => setShowAuthModal(false)}
                    className="text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Hủy bỏ
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Key Confirmation Modal */}
      <AnimatePresence>
        {keyToDelete && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setKeyToDelete(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden p-8 text-center"
            >
              <div className="bg-rose-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-rose-100">
                <Trash2 className="text-rose-600 w-8 h-8" />
              </div>
              <h3 className="text-xl font-display font-bold text-slate-800 mb-2">Xác nhận xóa Key?</h3>
              <p className="text-slate-500 text-sm mb-4">
                Bạn có chắc chắn muốn xóa key <span className="font-bold text-slate-700">"{keyToDelete.name}"</span>? 
                Hành động này không thể hoàn tác.
              </p>

              <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 mb-8 text-left">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-[10px] font-bold text-amber-600 uppercase tracking-widest">Thông tin hạn mức (Free Tier)</span>
                </div>
                <ul className="space-y-1.5">
                  <li className="text-[11px] text-amber-700 leading-relaxed flex justify-between">
                    <span>• Gemini Flash (3.0):</span>
                    <span className="font-bold">RPM: 15 / RPD: 1500+</span>
                  </li>
                  <li className="text-[11px] text-amber-700 leading-relaxed flex justify-between">
                    <span>• Gemini Pro (3.1):</span>
                    <span className="font-bold">RPM: 2 / RPD: 50+</span>
                  </li>
                </ul>
                <p className="mt-2 pt-2 border-t border-amber-200 text-[10px] text-amber-600 italic leading-tight">
                  * Google hiện không cung cấp API để kiểm tra số lượng yêu cầu còn lại chính xác trong ngày.
                </p>
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => setKeyToDelete(null)}
                  className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  onClick={() => {
                    handleDeleteKey(keyToDelete.id);
                    setKeyToDelete(null);
                  }}
                  className="flex-1 px-6 py-3 rounded-xl text-sm font-bold bg-rose-500 text-white hover:bg-rose-600 transition-colors shadow-lg shadow-rose-100"
                >
                  Xác nhận xóa
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Mobile View Toggle & Navigation Floating Bar */}
      {pdfDoc && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] md:hidden flex flex-col items-center gap-3 w-[95%] max-w-[420px]">
          {/* Main Action Bar */}
          <div className="w-full flex items-center bg-white/95 backdrop-blur-xl rounded-full shadow-[0_20px_50px_rgba(0,0,0,0.3)] border border-slate-200 p-1 gap-0.5 ring-1 ring-slate-900/5 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* View Toggle */}
            <div className="flex bg-slate-100/80 rounded-full p-0.5 gap-0.5 shrink-0 ml-1">
              <button 
                onClick={() => setMobileViewMode('pdf')}
                className={cn(
                  "flex items-center gap-0.5 px-1.5 py-1 rounded-full text-[7px] font-black uppercase tracking-tighter transition-all duration-300",
                  mobileViewMode === 'pdf' 
                    ? "bg-white text-indigo-600 shadow-sm" 
                    : "text-slate-500"
                )}
              >
                <FileText className="w-2.5 h-2.5" />
                PDF
              </button>
              <button 
                onClick={() => setMobileViewMode('split')}
                className={cn(
                  "flex items-center gap-0.5 px-1.5 py-1 rounded-full text-[7px] font-black uppercase tracking-tighter transition-all duration-300",
                  mobileViewMode === 'split' 
                    ? "bg-white text-indigo-600 shadow-sm" 
                    : "text-slate-500"
                )}
              >
                <Layout className="w-2.5 h-2.5" />
                Đôi
              </button>
              <button 
                onClick={() => setMobileViewMode('translation')}
                className={cn(
                  "flex items-center gap-0.5 px-1.5 py-1 rounded-full text-[7px] font-black uppercase tracking-tighter transition-all duration-300",
                  mobileViewMode === 'translation' 
                    ? "bg-white text-indigo-600 shadow-sm" 
                    : "text-slate-500"
                )}
              >
                <Languages className="w-2.5 h-2.5" />
                Dịch
              </button>
            </div>
            
            <div className="w-px h-6 bg-slate-200 mx-0.5 shrink-0" />
            
            {/* Navigation */}
            <div className="flex-1 flex items-center justify-center gap-0">
              <button 
                onClick={() => {
                  setCurrentPage(p => Math.max(1, p - 1));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                disabled={currentPage === 1}
                className="p-1.5 text-slate-600 disabled:opacity-20 active:scale-75 transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              
              <span className="text-[10px] font-black text-slate-800 min-w-[30px] text-center">{currentPage}/{numPages}</span>
              
              <button 
                onClick={() => {
                  setCurrentPage(p => Math.min(numPages, p + 1));
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                disabled={currentPage === numPages}
                className="p-1.5 text-slate-600 disabled:opacity-20 active:scale-75 transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="w-px h-6 bg-slate-200 mx-0.5 shrink-0" />

            {/* Right Actions */}
            <div className="flex items-center gap-0.5 pr-1 shrink-0">
              <button 
                onClick={() => translateCurrentPage(currentPage, true)}
                disabled={isTranslating}
                className={cn(
                  "p-2 rounded-full transition-all",
                  isTranslating
                    ? "text-slate-300"
                    : "text-indigo-600 active:bg-indigo-50"
                )}
              >
                <RefreshCcw className={cn("w-4 h-4", isTranslating && "animate-spin")} />
              </button>

              <button 
                onClick={toggleAutoTranslate}
                className={cn(
                  "p-2 rounded-full transition-all relative",
                  autoTranslate ? "text-emerald-600" : "text-slate-400"
                )}
              >
                <div className={cn(
                  "w-1 h-1 rounded-full absolute top-1.5 right-1.5",
                  autoTranslate ? "bg-emerald-500 animate-pulse" : "hidden"
                )} />
                <Languages className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Folder Selection Modal for Late Upload */}
      <AnimatePresence>
        {showFolderSelectModal && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowFolderSelectModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="bg-amber-100 p-2 rounded-xl">
                    <Folder className="text-amber-600 w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-display font-bold text-slate-800">Chọn thư mục tải lên</h3>
                </div>
                <button 
                  onClick={() => setShowFolderSelectModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
                <p className="text-xs font-medium text-slate-400 px-2 mb-2 uppercase tracking-wider">Thư mục hiện có</p>
                
                <button 
                  onClick={() => startUpload(file!, null)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-2xl transition-all text-left group border border-transparent hover:border-slate-100"
                >
                  <div className="bg-slate-100 p-2 rounded-xl group-hover:bg-indigo-100 transition-colors">
                    <Home className="w-5 h-5 text-slate-500 group-hover:text-indigo-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">Root (Thư mục gốc)</p>
                    <p className="text-[10px] text-slate-400">Tải trực tiếp lên thư mục chính</p>
                  </div>
                </button>

                {allFolders.map(folder => (
                  <button 
                    key={folder.id}
                    onClick={() => startUpload(file!, folder.id)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-2xl transition-all text-left group border border-transparent hover:border-slate-100"
                  >
                    <div className="bg-amber-50 p-2 rounded-xl group-hover:bg-amber-100 transition-colors">
                      <Folder className="w-5 h-5 text-amber-600" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-700">{folder.name}</p>
                      <p className="text-[10px] text-slate-400">{getFolderPath(folder.id)}</p>
                    </div>
                  </button>
                ))}

                {allFolders.length === 0 && (
                  <div className="py-8 text-center">
                    <p className="text-sm text-slate-400">Chưa có thư mục nào. Bạn có thể tải lên Root.</p>
                  </div>
                )}
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                <button 
                  onClick={() => setShowFolderSelectModal(false)}
                  className="px-6 py-2 text-slate-500 text-sm font-bold hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Hủy bỏ
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowSettings(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-100 p-2 rounded-xl">
                    <Settings className="text-indigo-600 w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-display font-bold text-slate-800">Cấu hình hệ thống</h3>
                </div>
                <button 
                  onClick={() => setShowSettings(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
                {/* User Profile Section */}
                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center overflow-hidden">
                      {user ? (
                        <img 
                          src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName || 'User'}&background=6366f1&color=fff`} 
                          alt="Avatar" 
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <UserIcon className="w-5 h-5 text-indigo-600" />
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-800">{user ? (user.displayName || user.email) : 'Khách'}</p>
                      <p className="text-[10px] text-slate-500">{user ? (userRole === 'admin' ? 'Quản trị viên' : 'Người dùng') : 'Đăng nhập để lưu Key'}</p>
                    </div>
                  </div>
                  {user ? (
                    <div className="flex gap-2">
                      {userRole === 'admin' && (
                        <button 
                          onClick={() => {
                            setShowSettings(false);
                            setShowAdminPanel(true);
                            fetchAllUsers();
                          }}
                          className="px-3 py-1.5 bg-amber-100 text-amber-700 rounded-lg text-[10px] font-bold hover:bg-amber-200 transition-all"
                        >
                          Quản trị
                        </button>
                      )}
                      <button 
                        onClick={handleLogout}
                        className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                        title="Đăng xuất"
                      >
                        <LogOut className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => {
                        setShowSettings(false);
                        setShowAuthModal(true);
                      }}
                      className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100"
                    >
                      Đăng nhập
                    </button>
                  )}
                </div>




                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ALargeSmall className="w-4 h-4 text-amber-500" />
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                        Cỡ chữ bản dịch
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-bold text-slate-400">{fontSize}px</span>
                      <input 
                        type="range" 
                        min="10" 
                        max="24" 
                        step="1"
                        value={fontSize}
                        onChange={(e) => setFontSize(Number(e.target.value))}
                        className="w-24 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-indigo-500" />
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                        Chế độ dịch mặc định
                      </label>
                    </div>
                    <select 
                      value={selectedEngine}
                      onChange={(e) => setSelectedEngine(e.target.value as TranslationEngine)}
                      className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold text-slate-700 focus:ring-2 focus:ring-indigo-500 outline-none"
                    >
                      <option value="gemini-flash-lite-latest">Cơ bản (Flash Lite)</option>
                      <option value="gemini-3.6-flash">Chuyên sâu (3.6 Flash)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-emerald-500" />
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                        Tự động dịch (Auto-Translate)
                      </label>
                    </div>
                    <button 
                      type="button"
                      onClick={toggleAutoTranslate}
                      className={cn(
                        "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none cursor-pointer",
                        autoTranslate ? "bg-emerald-500" : "bg-slate-200"
                      )}
                    >
                      <span className={cn(
                        "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                        autoTranslate ? "translate-x-6" : "translate-x-1"
                      )} />
                    </button>
                  </div>

                  {/* Key Group Selector for Auto-Translate */}
                  <div className="space-y-2 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1.5">
                        <Folder className="w-3.5 h-3.5 text-indigo-500" />
                        Nhóm Key áp dụng dịch thuật:
                      </span>
                      {hasValidKeysForFolder(activeKeyFolder) ? (
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          Key sẵn sàng
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200/60 px-2 py-0.5 rounded-full flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          Chưa có Key
                        </span>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setActiveKeyFolder('all')}
                        className={cn(
                          "py-1.5 px-2 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer border",
                          activeKeyFolder === 'all'
                            ? "bg-white text-indigo-700 border-indigo-300 shadow-sm"
                            : "bg-white/60 text-slate-500 border-slate-200 hover:text-slate-800"
                        )}
                      >
                        <span>Tất cả</span>
                        <span className="text-[9px] bg-slate-200/80 text-slate-700 px-1.5 py-0.2 rounded-full font-extrabold">
                          {userKeys.length}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveKeyFolder('gemini')}
                        className={cn(
                          "py-1.5 px-2 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer border",
                          activeKeyFolder === 'gemini'
                            ? "bg-white text-indigo-700 border-indigo-300 shadow-sm"
                            : "bg-white/60 text-slate-500 border-slate-200 hover:text-slate-800"
                        )}
                      >
                        <Cpu className="w-3 h-3 text-indigo-500 shrink-0" />
                        <span className="truncate">Gemini</span>
                        <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded-full font-extrabold">
                          {userKeys.filter(k => !isKeyShopAIKey(k)).length}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveKeyFolder('shopaikey')}
                        className={cn(
                          "py-1.5 px-2 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-1 cursor-pointer border",
                          activeKeyFolder === 'shopaikey'
                            ? "bg-white text-sky-700 border-sky-300 shadow-sm"
                            : "bg-white/60 text-slate-500 border-slate-200 hover:text-slate-800"
                        )}
                      >
                        <Globe className="w-3 h-3 text-sky-500 shrink-0" />
                        <span className="truncate">ShopAIKey</span>
                        <span className="text-[9px] bg-sky-100 text-sky-700 px-1.5 py-0.2 rounded-full font-extrabold">
                          {userKeys.filter(k => isKeyShopAIKey(k)).length}
                        </span>
                      </button>
                    </div>

                    {!hasValidKeysForFolder(activeKeyFolder) && (
                      <p className="text-[10px] text-amber-600 font-medium pt-1 flex items-center gap-1">
                        ⚠ Vui lòng chọn nhóm key khác hoặc cuộn xuống kho key để thêm Key.
                      </p>
                    )}
                  </div>

                  {autoTranslate && (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Số trang dịch trước (Buffer)
                        </label>
                        <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">
                          {autoTranslateLookAhead} trang
                        </span>
                      </div>
                      <input 
                        type="range"
                        min="0"
                        max="20"
                        step="1"
                        value={autoTranslateLookAhead}
                        onChange={(e) => setAutoTranslateLookAhead(parseInt(e.target.value))}
                        className="w-full h-1.5 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                      />
                      <p className="text-[9px] text-slate-400 italic">
                        * Tự động dịch trước các trang tiếp theo theo nhóm Key đã chọn để trải nghiệm đọc mượt mà hơn.
                      </p>
                    </div>
                  )}
                </div>

                {/* Bulk Translation Button with Confirmation */}
                {pdfDoc && (
                  <div className="pt-4 border-t border-slate-100">
                    {showBulkConfirm && !isBulkTranslating ? (
                      <div className="space-y-3 animate-in zoom-in-95 duration-200">
                        <div className="bg-amber-50 border border-amber-100 p-3 rounded-xl">
                          <p className="text-[10px] font-bold text-amber-900 leading-relaxed">
                            Xác nhận dịch toàn bộ {numPages} trang? 
                            <span className="block font-normal mt-1 text-amber-700">Hành động này sẽ tiêu tốn hạn mức API của bạn.</span>
                          </p>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => {
                              setShowBulkConfirm(false);
                              startBulkTranslation('gemini-flash-lite-latest');
                            }}
                            className="w-full py-2.5 bg-indigo-50 text-indigo-600 rounded-xl text-[10px] font-bold uppercase hover:bg-indigo-100 border border-indigo-100 shadow-sm transition-all active:scale-95 flex items-center justify-center gap-2"
                          >
                            <Zap className="w-3.5 h-3.5" />
                            Dịch toàn bộ (Cơ bản)
                          </button>
                          <button
                            onClick={() => {
                              setShowBulkConfirm(false);
                              startBulkTranslation('gemini-3.6-flash');
                            }}
                            className="w-full py-3 bg-indigo-600 text-white rounded-xl text-xs font-bold uppercase hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all active:scale-95 flex items-center justify-center gap-2"
                          >
                            <Sparkles className="w-4 h-4" />
                            Dịch chuyên sâu (Gemini 3.6 Flash)
                          </button>
                          <button
                            onClick={() => setShowBulkConfirm(false)}
                            className="w-full py-2.5 bg-slate-100 text-slate-500 rounded-xl text-[10px] font-bold uppercase hover:bg-slate-200 transition-all"
                          >
                            Hủy
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (isBulkTranslating) {
                            startBulkTranslation(); // This handles stopping
                          } else {
                            setShowBulkConfirm(true);
                          }
                        }}
                        disabled={!pdfDoc}
                        className={cn(
                          "w-full py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-all font-bold text-xs uppercase tracking-wider",
                          bulkTranslateStatus === 'translating' 
                            ? "bg-amber-100 text-amber-700 border border-amber-200" 
                            : bulkTranslateStatus === 'completed'
                            ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                            : bulkTranslateStatus === 'failed'
                            ? "bg-rose-100 text-rose-700 border border-rose-200"
                            : "bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700 hover:-translate-y-0.5 active:translate-y-0"
                        )}
                      >
                        {bulkTranslateStatus === 'translating' ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin" />
                            Dừng dịch (Stop)
                          </>
                        ) : bulkTranslateStatus === 'completed' ? (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            Đã dịch xong
                          </>
                        ) : bulkTranslateStatus === 'failed' ? (
                          <>
                            <AlertTriangle className="w-4 h-4" />
                            Lỗi/Hết Key
                          </>
                        ) : (
                          <>
                            <Zap className="w-4 h-4" />
                            Dịch toàn bộ tài liệu
                          </>
                        )}
                      </button>
                    )}
                    
                    {bulkTranslateStatus !== 'idle' && (
                      <div className="mt-3 space-y-1.5 px-1 animate-in fade-in slide-in-from-top-2">
                        <div className="flex justify-between items-center text-[9px] font-bold text-slate-500 uppercase">
                          <span>
                            {bulkTranslateStatus === 'translating' ? 'Tiến độ dịch thuật' : 
                             bulkTranslateStatus === 'completed' ? 'Hoàn tất dịch thuật' : 'Hết hạn mức API'}
                          </span>
                          <span className={cn(
                            bulkTranslateStatus === 'completed' ? 'text-emerald-600' :
                            bulkTranslateStatus === 'failed' ? 'text-rose-600' :
                            'text-indigo-600'
                          )}>{bulkTranslateProgress}%</span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all duration-300 rounded-full",
                              bulkTranslateStatus === 'completed' ? 'bg-emerald-500' :
                              bulkTranslateStatus === 'failed' ? 'bg-rose-500' :
                              'bg-indigo-600'
                            )}
                            style={{ width: `${bulkTranslateProgress}%` }}
                          />
                        </div>
                        <p className="text-[8px] text-slate-400 text-center italic">
                          {bulkTranslateStatus === 'translating' 
                            ? `Đang sử dụng pool keys (${userKeys.length} keys) để dịch song song...`
                            : bulkTranslateStatus === 'completed'
                            ? "Tất cả các trang đã được dịch thành công."
                            : "Đã dừng dịch do hết API Key khả dụng."}
                        </p>
                      </div>
                    )}
                  </div>
                )}

                <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
                  <button 
                    onClick={() => setShowSettings(false)}
                    className="flex-1 px-6 py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                  >
                    Hoàn tất
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* API Keys Modal */}
      <AnimatePresence>
        {showApiSettings && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowApiSettings(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-100 p-2 rounded-xl">
                    <Key className="text-indigo-600 w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-display font-bold text-slate-800">Quản lý API Keys</h3>
                </div>
                <button 
                  onClick={() => setShowApiSettings(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>
              
              <div className="flex-1 overflow-y-auto p-6 space-y-6 no-scrollbar">
                {/* Button to open dedicated Proxy Engine Modal (Admin only) */}
                {userRole === 'admin' && (
                  <div className="bg-gradient-to-r from-sky-50 to-indigo-50 border border-sky-100 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="bg-sky-500 text-white p-2.5 rounded-xl shadow-md shadow-sky-200 shrink-0">
                        <Globe className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-800">Cấu hình Proxy Engine (ShopAIKey)</h4>
                        <p className="text-[11px] text-slate-500 leading-tight">Tuỳ chỉnh Base URL & Model cho API Key `sk-...`</p>
                      </div>
                    </div>
                    <button 
                      type="button"
                      onClick={() => setShowProxyModal(true)}
                      className="px-3 py-2 bg-white hover:bg-sky-50 text-sky-700 border border-sky-200 rounded-xl text-xs font-bold shadow-sm flex items-center gap-1.5 transition-all shrink-0 active:scale-95 cursor-pointer"
                    >
                      <Settings className="w-3.5 h-3.5" /> Mở cửa sổ cấu hình
                    </button>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest">
                      API Keys cho Gemini AI / ShopAIKey
                    </label>
                    {currentKeyRef.current?.split(',').length! > 1 && (
                      <div className="flex items-center gap-1.5 px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 animate-pulse">
                        <RefreshCcw className="w-2.5 h-2.5" />
                        <span className="text-[8px] font-black uppercase tracking-tighter">Luân phiên: BẬT ({currentKeyRef.current?.split(',').length})</span>
                      </div>
                    )}
                  </div>
                </div>
                
                {/* Key Vault Section */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-indigo-500" />
                      <label className="text-xs font-bold text-slate-700 uppercase tracking-widest">
                        Kho lưu trữ Key (Vault)
                      </label>
                    </div>
                    {user && (
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => performKeyCheck(false)}
                          disabled={isCheckingKeys}
                          className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-all active:scale-95 disabled:opacity-50"
                          title="Kiểm tra tất cả Key"
                        >
                          {isCheckingKeys ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCcw className="w-3.5 h-3.5" />}
                        </button>
                        <button 
                          onClick={() => setIsAddingKey(!isAddingKey)}
                          className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 uppercase tracking-tighter flex items-center gap-1 bg-indigo-50 px-2 py-1 rounded-md"
                        >
                          <Plus className="w-3 h-3" /> Thêm Key mới
                        </button>
                      </div>
                    )}
                  </div>

                  {!user ? (
                    <div className="bg-slate-50 rounded-2xl p-6 text-center border border-dashed border-slate-200">
                      <ShieldCheck className="w-8 h-8 text-slate-300 mx-auto mb-3" />
                      <p className="text-xs font-bold text-slate-500 mb-4">Đăng nhập để lưu trữ nhiều API Key và tự động chuyển đổi khi hết hạn mức.</p>
                      <button 
                        onClick={() => setShowAuthModal(true)}
                        className="bg-indigo-600 text-white px-6 py-2 rounded-full text-xs font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
                      >
                        Đăng nhập ngay
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {/* Folder Tabs for Key Vault */}
                      <div className="bg-slate-100/90 p-1 rounded-2xl flex items-center gap-1 border border-slate-200/60">
                        <button
                          type="button"
                          onClick={() => setActiveKeyFolder('all')}
                          className={cn(
                            "flex-1 py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                            activeKeyFolder === 'all'
                              ? "bg-white text-indigo-700 shadow-sm border border-slate-200"
                              : "text-slate-500 hover:text-slate-800"
                          )}
                        >
                          <Folder className="w-3.5 h-3.5 text-slate-600" />
                          <span>Tất cả</span>
                          <span className="text-[9px] bg-slate-200 text-slate-700 px-1.5 py-0.2 rounded-full font-extrabold">
                            {userKeys.length}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveKeyFolder('gemini')}
                          className={cn(
                            "flex-1 py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                            activeKeyFolder === 'gemini'
                              ? "bg-white text-indigo-700 shadow-sm border border-indigo-200"
                              : "text-slate-500 hover:text-slate-800"
                          )}
                        >
                          <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                          <span>Thư mục Gemini</span>
                          <span className="text-[9px] bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded-full font-extrabold">
                            {userKeys.filter(k => !isKeyShopAIKey(k)).length}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveKeyFolder('shopaikey')}
                          className={cn(
                            "flex-1 py-1.5 px-2 rounded-xl text-[11px] font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer",
                            activeKeyFolder === 'shopaikey'
                              ? "bg-white text-sky-700 shadow-sm border border-sky-200"
                              : "text-slate-500 hover:text-slate-800"
                          )}
                        >
                          <Globe className="w-3.5 h-3.5 text-sky-500" />
                          <span>Thư mục ShopAIKey</span>
                          <span className="text-[9px] bg-sky-100 text-sky-700 px-1.5 py-0.2 rounded-full font-extrabold">
                            {userKeys.filter(k => isKeyShopAIKey(k)).length}
                          </span>
                        </button>
                      </div>

                      {/* Folder Scope Indicator Banner */}
                      <div className="bg-sky-50/80 border border-sky-200/80 rounded-xl p-2.5 flex items-center justify-between text-[11px] text-sky-900 shadow-sm">
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="w-4 h-4 text-sky-600 shrink-0" />
                          <span>
                            <strong>Phạm vi chạy key:</strong> Chỉ kích hoạt key trong{" "}
                            <span className="underline font-bold">
                              {activeKeyFolder === 'gemini' 
                                ? 'Thư mục Google Gemini (chỉ APIKey AIzaSy...)' 
                                : activeKeyFolder === 'shopaikey' 
                                ? 'Thư mục ShopAIKey / Proxy (chỉ APIKey sk-...)' 
                                : 'Tất cả các thư mục'}
                            </span>
                          </span>
                        </div>
                      </div>

                      {isAddingKey && (
                        <motion.div 
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="bg-indigo-50/50 rounded-2xl p-4 border border-indigo-100 mb-4"
                        >
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <input 
                              type="text"
                              placeholder="Tên gợi nhớ (VD: Key ShopAIKey 1)"
                              value={newKey.name}
                              onChange={(e) => setNewKey(prev => ({ ...prev, name: e.target.value }))}
                              className="px-3 py-2 bg-white border border-indigo-100 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                            />
                            <select
                              value={newKey.engine}
                              onChange={(e) => setNewKey(prev => ({ ...prev, engine: e.target.value as any }))}
                              className="px-3 py-2 bg-white border border-indigo-100 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                            >
                              <option value="gemini">Google Gemini (AIzaSy...)</option>
                              <option value="shopaikey">ShopAIKey / OpenAI Proxy (sk-...)</option>
                            </select>
                          </div>
                          <div className="relative">
                            <input 
                              type={showApiKeys ? "text" : "password"}
                              placeholder="Dán mã API Key (sk-9rskQZJbZv... hoặc AIzaSy...)"
                              value={newKey.value}
                              onChange={(e) => {
                                const val = e.target.value;
                                setNewKey(prev => ({
                                  ...prev,
                                  value: val,
                                  engine: val.trim().startsWith('sk-') ? 'shopaikey' : prev.engine
                                }));
                              }}
                              className="w-full pl-3 pr-10 py-2 bg-white border border-indigo-100 rounded-xl text-xs mb-2 focus:ring-2 focus:ring-indigo-500 outline-none font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => setShowApiKeys(!showApiKeys)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 transition-colors mb-2"
                            >
                              {showApiKeys ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                          {newKey.value.trim().startsWith('sk-') && (
                            <p className="text-[10px] text-sky-600 font-bold mb-3 flex items-center gap-1">
                              ✨ Đã tự động nhận diện API Key định dạng ShopAIKey / OpenAI (sk-...)
                            </p>
                          )}
                          <div className="flex justify-between items-center gap-2">
                            <button
                              type="button"
                              onClick={handleTestNewKey}
                              disabled={!newKey.value.trim() || newKeyTestResult?.loading}
                              className="px-3 py-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-lg text-[10px] font-bold flex items-center gap-1.5 transition-all disabled:opacity-50"
                            >
                              {newKeyTestResult?.loading ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" /> Đang dịch thử...
                                </>
                              ) : (
                                <>
                                  <Play className="w-3 h-3 text-sky-600" /> Dịch thử 1 đoạn
                                </>
                              )}
                            </button>
                            <div className="flex gap-2">
                              <button 
                                onClick={() => {
                                  setIsAddingKey(false);
                                  setNewKeyTestResult(null);
                                }}
                                className="px-3 py-1.5 text-[10px] font-bold text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                              >
                                Hủy
                              </button>
                              <button 
                                onClick={handleAddKey}
                                className="px-4 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100"
                              >
                                Lưu vào Vault
                              </button>
                            </div>
                          </div>
                          {newKeyTestResult && !newKeyTestResult.loading && (
                            <div className={cn(
                              "mt-3 p-2.5 rounded-xl text-[11px] leading-relaxed border font-sans",
                              newKeyTestResult.success ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"
                            )}>
                              {newKeyTestResult.success ? (
                                <p className="flex items-start gap-1.5">
                                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                                  <span>
                                    <strong>Dịch thử thành công ({((newKeyTestResult.latencyMs || 0)/1000).toFixed(2)}s):</strong> "{newKeyTestResult.resultText}"
                                  </span>
                                </p>
                              ) : (
                                <p className="flex items-start gap-1.5">
                                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                  <span>
                                    <strong>Lỗi:</strong> {newKeyTestResult.error}
                                  </span>
                                </p>
                              )}
                            </div>
                          )}
                        </motion.div>
                      )}

                      <div className="max-h-[300px] overflow-y-auto pr-2 space-y-2 no-scrollbar">
                        {userKeys.filter(k => matchesKeyFolder(k, activeKeyFolder)).length === 0 ? (
                          <p className="text-[11px] text-slate-400 text-center py-6 italic border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                            Không có Key nào trong {activeKeyFolder === 'gemini' ? 'Thư mục Google Gemini' : activeKeyFolder === 'shopaikey' ? 'Thư mục ShopAIKey / Proxy' : 'kho lưu trữ'}.
                          </p>
                        ) : (
                          userKeys.filter(k => matchesKeyFolder(k, activeKeyFolder)).map((key) => (
                            <div 
                              key={key.id}
                              className={cn(
                                "p-3 rounded-xl border transition-all group space-y-2",
                                selectedKeyId === key.id 
                                  ? "bg-indigo-50/70 border-indigo-200 ring-1 ring-indigo-200" 
                                  : "bg-white border-slate-100 hover:border-slate-200"
                              )}
                            >
                              <div className="flex items-center justify-between">
                                <div 
                                  className="flex-1 cursor-pointer"
                                  onClick={() => setSelectedKeyId(key.id)}
                                >
                                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                                    <span className="text-xs font-bold text-slate-700">{key.name}</span>
                                    {isKeyShopAIKey(key) ? (
                                      <span className="text-[8px] bg-sky-100 text-sky-700 font-extrabold px-1.5 py-0.5 rounded-md flex items-center gap-1">
                                        <Globe className="w-2.5 h-2.5" /> ShopAIKey
                                      </span>
                                    ) : (
                                      <span className="text-[8px] bg-indigo-100 text-indigo-700 font-extrabold px-1.5 py-0.5 rounded-md flex items-center gap-1">
                                        <Cpu className="w-2.5 h-2.5" /> Gemini
                                      </span>
                                    )}
                                    {key.status && (
                                      <span className={cn(
                                        "text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-tighter",
                                        key.status === 'active' ? "bg-emerald-100 text-emerald-600" : "bg-rose-100 text-rose-600"
                                      )}>
                                        {key.status === 'active' ? 'Hoạt động' : 'Lỗi'}
                                      </span>
                                    )}
                                    {key.ownerId !== user.uid && (
                                      <span className="text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-tighter bg-indigo-100 text-indigo-600 flex items-center gap-1">
                                        <Users className="w-2 h-2" />
                                        Được chia sẻ
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-slate-400 font-mono truncate max-w-[200px]">
                                    {key.value.substring(0, 8)}••••••••{key.value.substring(key.value.length - 4)}
                                  </p>
                                </div>

                                <div className="flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleTestKey(key.id, key.value)}
                                    disabled={testingKeyId === key.id}
                                    className="px-2 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-lg text-[9px] font-bold flex items-center gap-1 transition-all disabled:opacity-50"
                                    title="Chạy thử dịch 1 đoạn văn mẫu"
                                  >
                                    {testingKeyId === key.id ? (
                                      <Loader2 className="w-3 h-3 animate-spin text-sky-600" />
                                    ) : (
                                      <Play className="w-3 h-3 text-sky-600" />
                                    )}
                                    <span>Dịch thử</span>
                                  </button>

                                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    {key.ownerId === user.uid && (
                                      <>
                                        <button 
                                          onClick={() => {
                                            setShowRenameKeyModal(key);
                                            setRenameKeyName(key.name);
                                          }}
                                          className="p-1.5 hover:bg-slate-50 text-slate-400 hover:text-slate-600 rounded-lg transition-colors"
                                          title="Đổi tên Key"
                                        >
                                          <Pencil className="w-3.5 h-3.5" />
                                        </button>
                                        <button 
                                          onClick={() => setShowShareKeyModal(key)}
                                          className="p-1.5 hover:bg-indigo-50 text-indigo-400 hover:text-indigo-500 rounded-lg transition-colors"
                                          title="Chia sẻ Key"
                                        >
                                          <Share2 className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    )}
                                    <button 
                                      onClick={() => setKeyToDelete(key)}
                                      className="p-1.5 hover:bg-rose-50 text-rose-400 hover:text-rose-500 rounded-lg transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                    {selectedKeyId === key.id && (
                                      <div className="bg-emerald-500 p-1 rounded-full">
                                        <CheckCircle2 className="w-3 h-3 text-white" />
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {keyTestResults[key.id] && (
                                <div className={cn(
                                  "p-2 rounded-lg text-[10px] leading-relaxed border font-sans",
                                  keyTestResults[key.id].success ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"
                                )}>
                                  {keyTestResults[key.id].success ? (
                                    <p className="flex items-start gap-1">
                                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                                      <span>
                                        <strong>OK ({((keyTestResults[key.id].latencyMs || 0)/1000).toFixed(2)}s):</strong> "{keyTestResults[key.id].resultText}"
                                      </span>
                                    </p>
                                  ) : (
                                    <p className="flex items-start gap-1">
                                      <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0 mt-0.5" />
                                      <span>
                                        <strong>Lỗi:</strong> {keyTestResults[key.id].error}
                                      </span>
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
                <button 
                  onClick={() => setShowApiSettings(false)}
                  className="flex-1 px-6 py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                >
                  Hoàn tất
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Proxy Engine Dedicated Modal (Admin only) */}
      <AnimatePresence>
        {showProxyModal && userRole === 'admin' && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowProxyModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col z-10"
            >
              <div className="p-5 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-sky-500 text-white p-2.5 rounded-2xl shadow-md shadow-sky-200">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-800">Cấu hình Proxy Engine (ShopAIKey)</h3>
                    <p className="text-[10px] text-slate-400">Thiết lập dành cho các API Key dạng `sk-...`</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowProxyModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-4 h-4 text-slate-400" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 block">
                    1. API Base URL (Máy chủ API Proxy):
                  </label>
                  <input 
                    type="text"
                    value={customBaseUrl}
                    onChange={(e) => {
                      setCustomBaseUrl(e.target.value);
                      localStorage.setItem('mediTrans_customBaseUrl', e.target.value);
                    }}
                    placeholder="https://api.shopaikey.com/v1"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:ring-2 focus:ring-sky-500 outline-none text-slate-800"
                  />
                  <div className="flex gap-2 pt-0.5">
                    <button 
                      type="button"
                      onClick={() => {
                        setCustomBaseUrl('https://api.shopaikey.com/v1');
                        localStorage.setItem('mediTrans_customBaseUrl', 'https://api.shopaikey.com/v1');
                      }}
                      className="px-3 py-1 bg-sky-50 hover:bg-sky-100 text-sky-700 border border-sky-200 rounded-lg text-[10px] font-bold transition-colors"
                    >
                      Mặc định ShopAIKey
                    </button>
                    <button 
                      type="button"
                      onClick={() => {
                        setCustomBaseUrl('https://api.openai.com/v1');
                        localStorage.setItem('mediTrans_customBaseUrl', 'https://api.openai.com/v1');
                      }}
                      className="px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[10px] font-bold transition-colors"
                    >
                      OpenAI Official
                    </button>
                  </div>
                </div>

                {/* 2. Model Proxy - Dịch Thường (Cơ bản) */}
                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-amber-500" />
                      2. Model Proxy cho Dịch Thường (Cơ bản):
                    </label>
                    <span className="text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">Flash / Basic</span>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={customOpenAIModelNormal}
                      onChange={(e) => {
                        setCustomOpenAIModelNormal(e.target.value);
                      }}
                      placeholder="Mặc định: gemini-2.5-flash-lite..."
                      className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:ring-2 focus:ring-sky-500 outline-none text-slate-800"
                    />
                    <select
                      value={customOpenAIModelNormal}
                      onChange={(e) => {
                        setCustomOpenAIModelNormal(e.target.value);
                      }}
                      className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-bold outline-none cursor-pointer"
                    >
                      <option value="">⚙️ Mặc định (gemini-2.5-flash-lite)</option>
                      <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                      <option value="gemini-3.1-flash-lite">gemini-3.1-flash-lite</option>
                      <option value="gemini-3.5-flash-lite">gemini-3.5-flash-lite</option>
                      <option value="gemini-3.1-flash-lite-preview">gemini-3.1-flash-lite-preview</option>
                      <option value="gemini-1.5-flash">gemini-1.5-flash</option>
                      <option value="gemini-2.0-flash">gemini-2.0-flash</option>
                      <option value="gpt-4o-mini">gpt-4o-mini</option>
                      <option value="claude-3-5-haiku">claude-3-5-haiku</option>
                    </select>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Dành cho chế độ dịch Cơ bản (Flash Lite) / tự động dịch. Tốc độ xử lý cực nhanh.
                  </p>
                </div>

                {/* 3. Model Proxy - Dịch Chuyên Sâu */}
                <div className="space-y-2 pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                      3. Model Proxy cho Dịch Chuyên Sâu:
                    </label>
                    <span className="text-[10px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full">Deep / Pro</span>
                  </div>
                  <div className="flex gap-2">
                    <input 
                      type="text"
                      value={customOpenAIModelDeep}
                      onChange={(e) => {
                        setCustomOpenAIModelDeep(e.target.value);
                      }}
                      placeholder="Mặc định: gemini-3.6-flash..."
                      className="flex-1 px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono focus:ring-2 focus:ring-purple-500 outline-none text-slate-800"
                    />
                    <select
                      value={customOpenAIModelDeep}
                      onChange={(e) => {
                        setCustomOpenAIModelDeep(e.target.value);
                      }}
                      className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700 font-bold outline-none cursor-pointer"
                    >
                      <option value="">⚙️ Mặc định (Theo Dịch Thường)</option>
                      <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                      <option value="gemini-3.5-flash">gemini-3.5-flash</option>
                      <option value="gemini-3.1-pro-preview">gemini-3.1-pro-preview</option>
                      <option value="gemini-3.6-flash">gemini-3.6-flash</option>
                      <option value="gemini-1.5-pro">gemini-1.5-pro</option>
                      <option value="gpt-4o">gpt-4o</option>
                      <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
                    </select>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-tight">
                    Dành riêng cho nút &quot;Dịch Chuyên Sâu&quot; (3.6 Flash / Pro). Phù hợp cho phân tích y khoa chi tiết.
                  </p>
                </div>
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
                <button 
                  type="button"
                  onClick={() => setShowProxyModal(false)}
                  className="px-6 py-2.5 bg-sky-600 text-white font-bold text-xs rounded-xl hover:bg-sky-700 transition-all shadow-md shadow-sky-200"
                >
                  Lưu & Đóng cửa sổ
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Download Modal */}
      <AnimatePresence>
        {showDownloadModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowDownloadModal(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="bg-indigo-100 p-2 rounded-xl">
                    <Download className="text-indigo-600 w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xl font-display font-bold text-slate-800">Tải xuống bản dịch</h3>
                    <p className="text-[10px] text-slate-400 font-medium">Chọn các trang bạn muốn xuất ra file Word (.docx)</p>
                  </div>
                </div>
                <button 
                  onClick={() => setShowDownloadModal(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 no-scrollbar">
                <div className="mb-4 flex items-center justify-between bg-slate-50 p-3 rounded-2xl border border-slate-100">
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => {
                        const allTranslated = Object.keys(translations)
                          .filter(p => translations[Number(p)]?.status === 'success')
                          .map(Number);
                        setSelectedPagesToDownload(allTranslated);
                      }}
                      className="text-[10px] font-black text-indigo-600 hover:text-indigo-700 uppercase tracking-widest"
                    >
                      Chọn tất cả đã dịch
                    </button>
                    <button 
                      onClick={() => setSelectedPagesToDownload([])}
                      className="text-[10px] font-black text-slate-400 hover:text-slate-500 uppercase tracking-widest"
                    >
                      Bỏ chọn tất cả
                    </button>
                  </div>
                  <div className="text-[10px] font-bold text-slate-500">
                    Đã chọn: <span className="text-indigo-600">{selectedPagesToDownload.length}</span> trang
                  </div>
                </div>

                <div className="grid grid-cols-5 sm:grid-cols-8 gap-2 p-1">
                  {Array.from({ length: numPages }, (_, i) => i + 1).map(pageNum => {
                    const isTranslated = translations[pageNum]?.status === 'success';
                    const isSelected = selectedPagesToDownload.includes(pageNum);
                    
                    return (
                      <button
                        key={pageNum}
                        disabled={!isTranslated}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedPagesToDownload(prev => prev.filter(p => p !== pageNum));
                          } else {
                            setSelectedPagesToDownload(prev => [...prev, pageNum].sort((a, b) => a - b));
                          }
                        }}
                        className={cn(
                          "aspect-square rounded-xl border flex flex-col items-center justify-center transition-all relative group",
                          isSelected 
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100 scale-105 z-10" 
                            : isTranslated
                              ? "bg-white border-indigo-100 text-slate-700 hover:border-indigo-300 hover:bg-indigo-50/30"
                              : "bg-slate-50 border-slate-100 text-slate-300 cursor-not-allowed opacity-60"
                        )}
                      >
                        <span className="text-xs font-black">{pageNum}</span>
                        {isTranslated && !isSelected && (
                          <div className="absolute top-1 right-1 w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                        )}
                        {isSelected && (
                          <CheckCircle2 className="w-3 h-3 absolute -top-1 -right-1 bg-white text-indigo-600 rounded-full" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex gap-3 shrink-0">
                <button 
                  onClick={() => setShowDownloadModal(false)}
                  className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors"
                >
                  Hủy
                </button>
                <button 
                  disabled={selectedPagesToDownload.length === 0}
                  onClick={() => {
                    handleDownload(selectedPagesToDownload);
                    setShowDownloadModal(false);
                  }}
                  className="flex-1 px-6 py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Tải file Word ({selectedPagesToDownload.length} trang)
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Diagnostic Modal */}
      <AnimatePresence>
        {isDiagnosticModalOpen && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden border border-slate-100"
            >
              <div className="p-6 border-b border-slate-50 flex items-center justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Chẩn đoán hệ thống</h3>
                    <p className="text-xs text-slate-500">Kiểm tra trạng thái kết nối Firebase</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsDiagnosticModalOpen(false)}
                  className="p-2 hover:bg-white rounded-xl transition-colors text-slate-400 hover:text-slate-600 shadow-sm"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {diagnosticResults && (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Dự án</p>
                        <p className="text-xs font-mono text-slate-700 break-all">{diagnosticResults.projectId}</p>
                      </div>
                      <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Database ID</p>
                        <p className="text-xs font-mono text-slate-700 break-all">{diagnosticResults.databaseId || '(default)'}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className={cn(
                        "p-4 rounded-2xl border flex items-start gap-3",
                        diagnosticResults.auth.status === 'ok' ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100"
                      )}>
                        {diagnosticResults.auth.status === 'ok' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                        )}
                        <div>
                          <p className={cn("text-xs font-bold", diagnosticResults.auth.status === 'ok' ? "text-emerald-800" : "text-rose-800")}>
                            Firebase Authentication API
                          </p>
                          <p className={cn("text-[10px] mt-0.5", diagnosticResults.auth.status === 'ok' ? "text-emerald-600" : "text-rose-600")}>
                            {diagnosticResults.auth.status === 'ok' ? "Hoạt động bình thường" : `Lỗi: ${diagnosticResults.auth.message}`}
                          </p>
                          {diagnosticResults.auth.status !== 'ok' && (
                            <div className="mt-2 space-y-1">
                              {diagnosticResults.auth.advice && (
                                <p className="text-[9px] text-rose-700 font-medium">{diagnosticResults.auth.advice}</p>
                              )}
                              <a 
                                href={diagnosticResults.auth.link || `https://console.developers.google.com/apis/api/identitytoolkit.googleapis.com/overview?project=${diagnosticResults.projectId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 hover:underline"
                              >
                                {diagnosticResults.auth.link ? "Mở Console ngay" : "Kích hoạt Identity Toolkit"} <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className={cn(
                        "p-4 rounded-2xl border flex items-start gap-3",
                        diagnosticResults.firestore.status === 'ok' ? "bg-emerald-50 border-emerald-100" : "bg-rose-50 border-rose-100"
                      )}>
                        {diagnosticResults.firestore.status === 'ok' ? (
                          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                        )}
                        <div>
                          <p className={cn("text-xs font-bold", diagnosticResults.firestore.status === 'ok' ? "text-emerald-800" : "text-rose-800")}>
                            Cloud Firestore API
                          </p>
                          <p className={cn("text-[10px] mt-0.5", diagnosticResults.firestore.status === 'ok' ? "text-emerald-600" : "text-rose-600")}>
                            {diagnosticResults.firestore.status === 'ok' ? "Hoạt động bình thường" : `Lỗi: ${diagnosticResults.firestore.message}`}
                          </p>
                          {diagnosticResults.firestore.status !== 'ok' && (
                            <div className="mt-2 space-y-2">
                              {diagnosticResults.firestore.advice && (
                                <p className="text-[9px] text-rose-700 font-medium">{diagnosticResults.firestore.advice}</p>
                              )}
                              <a 
                                href={diagnosticResults.firestore.link || `https://console.cloud.google.com/apis/library/firestore.googleapis.com?project=${diagnosticResults.projectId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-700 hover:underline"
                              >
                                {diagnosticResults.firestore.link ? "Mở Console ngay" : "Kích hoạt Firestore API"} <ExternalLink className="w-3 h-3" />
                              </a>
                              {!diagnosticResults.firestore.advice && (
                                <p className="text-[9px] text-rose-500 italic">
                                  Gợi ý: Nếu API đã bật, hãy đảm bảo bạn đã "Tạo Database" trong Firebase Console.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {diagnosticResults.firestore.fallbackStatus === 'ok_with_default_db' && (
                        <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 flex items-start gap-3">
                          <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                          <div>
                            <p className="text-xs font-bold text-amber-800">Lưu ý: Đang sử dụng Database mặc định</p>
                            <p className="text-[10px] text-amber-600 mt-0.5">
                              Database định danh thất bại, nhưng Database mặc định (default) hoạt động. Ứng dụng sẽ tự động chuyển vùng dữ liệu.
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
              
              <div className="p-6 bg-slate-50 border-t border-slate-100 flex justify-end">
                <button 
                  onClick={() => setIsDiagnosticModalOpen(false)}
                  className="px-6 py-2.5 bg-white border border-slate-200 text-slate-600 rounded-2xl text-sm font-bold hover:bg-slate-50 transition-all shadow-sm"
                >
                  Đóng
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Panel Modal */}
      <AnimatePresence>
        {showAdminPanel && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdminPanel(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-4xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="bg-amber-100 p-2 rounded-xl">
                    <ShieldCheck className="text-amber-600 w-5 h-5" />
                  </div>
                  <h3 className="text-xl font-display font-bold text-slate-800">Quản trị hệ thống</h3>
                </div>
                <button 
                  onClick={() => setShowAdminPanel(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                >
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8 no-scrollbar">
                {/* Stats Section */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="bg-indigo-50 p-5 rounded-3xl border border-indigo-100 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="bg-indigo-100 p-2 rounded-xl">
                        <Users className="w-4 h-4 text-indigo-600" />
                      </div>
                      <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">Tổng người dùng</span>
                    </div>
                    <p className="text-3xl font-display font-black text-indigo-900">{allUsers.length}</p>
                  </div>
                  <div className="bg-amber-50 p-5 rounded-3xl border border-amber-100 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="bg-amber-100 p-2 rounded-xl">
                        <ShieldCheck className="w-4 h-4 text-amber-600" />
                      </div>
                      <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest">Quản trị viên</span>
                    </div>
                    <p className="text-3xl font-display font-black text-amber-900">{allUsers.filter(u => u.role === 'admin').length}</p>
                  </div>
                  <div className="bg-rose-50 p-5 rounded-3xl border border-rose-100 shadow-sm">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="bg-rose-100 p-2 rounded-xl">
                          <ShieldAlert className="w-4 h-4 text-rose-600" />
                        </div>
                        <span className="text-[10px] font-black text-rose-400 uppercase tracking-widest">Tài khoản bị chặn</span>
                      </div>
                      <p className="text-3xl font-display font-black text-rose-900">{allUsers.filter(u => u.isBlocked).length}</p>
                    </div>
                  </div>

                  {/* Create User Section */}
                  <section>
                    <div className="flex items-center gap-2 mb-4">
                      <div className="w-1.5 h-4 bg-indigo-500 rounded-full" />
                      <h4 className="text-sm font-bold text-slate-800">Thêm người dùng mới</h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 bg-slate-50 p-5 rounded-2xl border border-slate-100">
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Tên hiển thị</label>
                        <input 
                          type="text"
                          placeholder="VD: Nguyễn Văn A"
                          value={adminNewUserDisplayName}
                          onChange={(e) => setAdminNewUserDisplayName(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Email</label>
                        <input 
                          type="email"
                          placeholder="email@example.com"
                          value={adminNewUserEmail}
                          onChange={(e) => setAdminNewUserEmail(e.target.value)}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Mật khẩu</label>
                        <div className="relative">
                          <input 
                            type={showAdminNewUserPassword ? "text" : "password"}
                            placeholder="••••••••"
                            value={adminNewUserPassword}
                            onChange={(e) => setAdminNewUserPassword(e.target.value)}
                            className="w-full pl-3 pr-10 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                          />
                          <button
                            type="button"
                            onClick={() => setShowAdminNewUserPassword(!showAdminNewUserPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-indigo-600 transition-colors"
                          >
                            {showAdminNewUserPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] font-bold text-slate-400 uppercase ml-1">Vai trò</label>
                        <select 
                          value={adminNewUserRole}
                          onChange={(e) => setAdminNewUserRole(e.target.value as 'user' | 'admin')}
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer"
                        >
                          <option value="user">Người dùng</option>
                          <option value="admin">Quản trị viên</option>
                        </select>
                      </div>
                      <div className="flex items-end">
                        <button 
                          onClick={async () => {
                            if (!adminNewUserEmail || !adminNewUserPassword) {
                              showToast("Vui lòng nhập email và mật khẩu", 'error');
                              return;
                            }
                            setIsCreatingUser(true);
                            try {
                              await createNewUser({
                                email: adminNewUserEmail,
                                password: adminNewUserPassword,
                                displayName: adminNewUserDisplayName,
                                role: adminNewUserRole
                              });
                              showToast("Đã thêm người dùng thành công", 'success');
                              setAdminNewUserEmail('');
                              setAdminNewUserPassword('');
                              setAdminNewUserDisplayName('');
                            } catch (e: any) {
                              if (e.message.includes("Identity Toolkit API")) {
                                showToast("Lỗi: Identity Toolkit API chưa được kích hoạt. Vui lòng kiểm tra cấu hình dự án.", 'error');
                              } else {
                                showToast(e.message, 'error');
                              }
                            } finally {
                              setIsCreatingUser(false);
                            }
                          }}
                          disabled={isCreatingUser}
                          className="w-full py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 disabled:opacity-50 shadow-lg shadow-indigo-200"
                        >
                          {isCreatingUser ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                          Thêm ngay
                        </button>
                      </div>
                    </div>
                  </section>

                  {/* User List Section */}
                  <section>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                        <Users className="w-3.5 h-3.5" />
                        Danh sách người dùng ({allUsers.length})
                      </h4>
                      <div className="flex items-center gap-3">
                        <div className="relative">
                          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                          <input 
                            type="text"
                            placeholder="Tìm kiếm email/tên..."
                            value={adminUserSearch}
                            onChange={(e) => setAdminUserSearch(e.target.value)}
                            className="pl-8 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] focus:ring-2 focus:ring-indigo-500 outline-none w-40 transition-all"
                          />
                        </div>
                        <select 
                          value={adminRoleFilter}
                          onChange={(e) => setAdminRoleFilter(e.target.value as any)}
                          className="px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-[10px] focus:ring-2 focus:ring-indigo-500 outline-none transition-all appearance-none cursor-pointer pr-6"
                        >
                          <option value="all">Tất cả</option>
                          <option value="user">Thành viên</option>
                          <option value="admin">Quản trị viên</option>
                          <option value="blocked">Đã chặn</option>
                        </select>
                        {(activeProjectId || activeDatabaseId) && (
                          <div className="hidden md:flex flex-col items-end mr-2 border-r border-slate-100 pr-2">
                            <div className="text-[7px] font-mono text-slate-400 uppercase tracking-tighter">Project: {activeProjectId}</div>
                            <div className="text-[7px] font-mono text-slate-400 uppercase tracking-tighter">DB: {activeDatabaseId}</div>
                          </div>
                        )}
                        <button 
                          onClick={runDiagnostics}
                          disabled={isRunningDiagnostics}
                          className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors flex items-center gap-1.5"
                          title="Chẩn đoán hệ thống"
                        >
                          <Activity className={cn("w-3.5 h-3.5", isRunningDiagnostics && "animate-pulse")} />
                          <span className="text-[10px] font-medium">Chẩn đoán</span>
                        </button>
                        <button 
                          onClick={fetchAllUsers}
                          className="p-1.5 hover:bg-slate-100 text-slate-500 rounded-lg transition-colors"
                          title="Làm mới"
                        >
                          <RefreshCcw className={cn("w-3.5 h-3.5", isFetchingUsers && "animate-spin")} />
                        </button>
                      </div>
                    </div>

                    <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm">
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-50/50 text-slate-400 font-bold uppercase tracking-widest border-b border-slate-100">
                            <tr>
                              <th className="px-6 py-4">Thông tin người dùng</th>
                              <th className="px-6 py-4">Vai trò</th>
                              <th className="px-6 py-4">Ngày tham gia</th>
                              <th className="px-6 py-4 text-right">Hành động</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-50">
                            {allUsers
                              .filter(u => {
                                const searchMatch = (u.email || '').toLowerCase().includes(adminUserSearch.toLowerCase()) || 
                                                   (u.displayName || '').toLowerCase().includes(adminUserSearch.toLowerCase());
                                let roleMatch = true;
                                if (adminRoleFilter === 'admin') roleMatch = u.role === 'admin';
                                else if (adminRoleFilter === 'user') roleMatch = u.role === 'user';
                                else if (adminRoleFilter === 'blocked') roleMatch = u.isBlocked === true;
                                return searchMatch && roleMatch;
                              })
                              .length === 0 ? (
                              <tr>
                                <td colSpan={4} className="px-6 py-12 text-center text-slate-400 italic">
                                  Không tìm thấy người dùng phù hợp
                                </td>
                              </tr>
                            ) : (
                              allUsers
                                .filter(u => {
                                  const searchMatch = (u.email || '').toLowerCase().includes(adminUserSearch.toLowerCase()) || 
                                                     (u.displayName || '').toLowerCase().includes(adminUserSearch.toLowerCase());
                                  let roleMatch = true;
                                  if (adminRoleFilter === 'admin') roleMatch = u.role === 'admin';
                                  else if (adminRoleFilter === 'user') roleMatch = u.role === 'user';
                                  else if (adminRoleFilter === 'blocked') roleMatch = u.isBlocked === true;
                                  return searchMatch && roleMatch;
                                })
                                .map((u) => (
                                <tr key={u.uid} className={cn(
                                  "hover:bg-slate-50/30 transition-colors group",
                                  u.isBlocked && "bg-rose-50/20"
                                )}>
                                  <td className="px-6 py-4">
                                    <div className="flex items-center gap-3">
                                      <div className={cn(
                                        "w-9 h-9 bg-gradient-to-br rounded-xl flex items-center justify-center text-xs font-black text-slate-500 shadow-inner",
                                        u.isBlocked ? "from-rose-100 to-rose-200" : "from-slate-100 to-slate-200"
                                      )}>
                                        {(u.displayName || u.email || u.uid || 'U').charAt(0).toUpperCase()}
                                      </div>
                                      <div>
                                        <div className="flex items-center gap-2">
                                          <p className="font-bold text-slate-800 text-sm">{u.displayName || (u.email ? u.email.split('@')[0] : u.uid || 'Người dùng')}</p>
                                          {u.isBlocked && (
                                            <span className="bg-rose-100 text-rose-600 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-tighter">Bị chặn</span>
                                          )}
                                        </div>
                                        <p className="text-[10px] text-slate-400 font-medium">{u.email}</p>
                                      </div>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className={cn(
                                      "px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider shadow-sm",
                                      u.role === 'admin' 
                                        ? "bg-amber-50 text-amber-600 border border-amber-100" 
                                        : "bg-indigo-50 text-indigo-600 border border-indigo-100"
                                    )}>
                                      {u.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4">
                                    <div className="flex flex-col">
                                      <span className="text-slate-600 font-medium">
                                        {u.createdAt ? (typeof u.createdAt === 'string' ? new Date(u.createdAt).toLocaleDateString('vi-VN') : (u.createdAt._seconds ? new Date(u.createdAt._seconds * 1000).toLocaleDateString('vi-VN') : 'N/A')) : 'N/A'}
                                      </span>
                                      <span className="text-[9px] text-slate-300">
                                        {u.uid.substring(0, 8)}...
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-2 transition-opacity">
                                      <div className="flex items-center gap-1">
                                        {pendingPasswordUid === u.uid ? (
                                          <div className="flex items-center gap-1 animate-in fade-in slide-in-from-right-2 duration-300">
                                            <input 
                                              type="text"
                                              value={newPasswordInput}
                                              onChange={(e) => setNewPasswordInput(e.target.value)}
                                              placeholder="Mật khẩu mới"
                                              className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[10px] w-24 focus:ring-1 focus:ring-indigo-500 outline-none"
                                              autoFocus
                                            />
                                            <button 
                                              onClick={() => adminChangeUserPassword(u.uid, u.email)}
                                              className="p-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors shadow-sm"
                                              title="Xác nhận đổi mật khẩu"
                                            >
                                              <CheckCircle2 className="w-3.5 h-3.5" />
                                            </button>
                                            <button 
                                              onClick={() => {
                                                setPendingPasswordUid(null);
                                                setNewPasswordInput('');
                                              }}
                                              className="p-1 bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                                              title="Hủy"
                                            >
                                              <ChevronLeft className="w-3.5 h-3.5" />
                                            </button>
                                          </div>
                                        ) : (
                                          <>
                                            <button 
                                              onClick={() => sendAdminPasswordResetEmail(u.email)}
                                              className="p-2 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors"
                                              title="Gửi email đặt lại mật khẩu"
                                            >
                                              <Mail className="w-4 h-4" />
                                            </button>
                                            <button 
                                              onClick={() => {
                                                setPendingPasswordUid(u.uid);
                                                setNewPasswordInput('');
                                              }}
                                              className="p-2 hover:bg-amber-50 text-amber-600 rounded-lg transition-colors"
                                              title="Đổi mật khẩu trực tiếp"
                                            >
                                              <KeyRound className="w-4 h-4" />
                                            </button>
                                          </>
                                        )}
                                      </div>
                                      <button 
                                        onClick={() => updateUserRole(u.uid, u.email, u.role === 'admin' ? 'user' : 'admin')}
                                        className={cn(
                                          "p-2 rounded-lg transition-colors",
                                          u.role === 'admin' ? "hover:bg-indigo-50 text-indigo-600" : "hover:bg-amber-50 text-amber-600"
                                        )}
                                        title={u.role === 'admin' ? "Hạ cấp xuống Thành viên" : "Thăng cấp lên Quản trị viên"}
                                      >
                                        {u.role === 'admin' ? <UserIcon className="w-4 h-4" /> : <ShieldCheck className="w-4 h-4" />}
                                      </button>
                                      <button 
                                        onClick={() => toggleBlockUser(u.uid, u.email, u.isBlocked)}
                                        className={cn(
                                          "p-2 rounded-lg transition-colors",
                                          u.isBlocked ? "hover:bg-emerald-50 text-emerald-500" : "hover:bg-rose-50 text-rose-500"
                                        )}
                                        title={u.isBlocked ? "Bỏ chặn người dùng" : "Chặn người dùng"}
                                      >
                                        {u.isBlocked ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                                      </button>
                                      <div className="flex items-center gap-1">
                                        {pendingDeleteUid === u.uid ? (
                                          <div className="flex items-center gap-1 animate-in fade-in slide-in-from-right-2 duration-300">
                                            <button 
                                              onClick={() => deleteUserAccount(u.uid, u.email)}
                                              className="px-3 py-1 bg-rose-600 text-white text-xs font-bold rounded-lg hover:bg-rose-700 transition-colors shadow-sm"
                                            >
                                              Xác nhận xóa
                                            </button>
                                            <button 
                                              onClick={() => setPendingDeleteUid(null)}
                                              className="p-1 px-2 bg-slate-100 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-200 transition-colors"
                                            >
                                              Hủy
                                            </button>
                                          </div>
                                        ) : (
                                          <button 
                                            onClick={() => setPendingDeleteUid(u.uid)}
                                            className="p-2 hover:bg-rose-100 text-rose-600 rounded-lg transition-colors border border-transparent hover:border-rose-200"
                                            title="Xóa tài khoản vĩnh viễn"
                                          >
                                            <Trash2 className="w-4 h-4" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </section>
                </div>

              <div className="p-6 border-t border-slate-100 bg-slate-50 flex justify-end">
                <button 
                  onClick={() => setShowAdminPanel(false)}
                  className="px-6 py-2 bg-white border border-slate-200 text-slate-600 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all"
                >
                  Đóng
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer Info */}
      {!pdfDoc && (
        <footer className="h-12 border-t border-slate-200 bg-white flex items-center justify-center px-6 shrink-0">
          <p className="text-[10px] text-slate-400 font-medium uppercase tracking-[0.2em]">
            Copyright © Dr. Hoang Hiep • Medical Grade Translation
          </p>
        </footer>
      )}
    </div>
    
    {/* Share API Key Modal */}
    <AnimatePresence>
      {showShareKeyModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowShareKeyModal(null)}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden p-8"
          >
            <div className="bg-indigo-50 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto">
              <Share2 className="w-8 h-8 text-indigo-500" />
            </div>
            <h3 className="text-xl font-display font-bold text-slate-800 mb-2 text-center">Chia sẻ API Key</h3>
            <p className="text-slate-500 text-sm text-center mb-6">
              Chia sẻ Key <span className="font-bold text-slate-700">"{showShareKeyModal.name}"</span> với bác sĩ khác.
            </p>
            
            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Email người nhận</label>
                <input 
                  type="email" 
                  placeholder="doctor@medical.com" 
                  value={shareKeyEmail}
                  onChange={(e) => setShareKeyEmail(e.target.value)}
                  autoFocus
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-medium"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setShowShareKeyModal(null)}
                className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors"
              >
                Hủy
              </button>
              <button 
                onClick={handleShareKey}
                disabled={isSharingKey || !shareKeyEmail.trim()}
                className="flex-1 px-6 py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSharingKey && <Loader2 className="w-4 h-4 animate-spin" />}
                Chia sẻ ngay
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* Rename API Key Modal */}
    <AnimatePresence>
      {showRenameKeyModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowRenameKeyModal(null)}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden p-8"
          >
            <div className="bg-slate-50 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 mx-auto">
              <Pencil className="w-8 h-8 text-slate-500" />
            </div>
            <h3 className="text-xl font-display font-bold text-slate-800 mb-2 text-center">Đổi tên API Key</h3>
            <p className="text-slate-500 text-sm text-center mb-6">
              Vui lòng nhập tên mới cho Key này.
            </p>
            
            <div className="space-y-4 mb-8">
              <div>
                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Tên Key mới</label>
                <input 
                  type="text" 
                  placeholder="Ví dụ: Gemini Pro Key mới" 
                  value={renameKeyName}
                  onChange={(e) => setRenameKeyName(e.target.value)}
                  autoFocus
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all text-sm font-medium"
                />
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setShowRenameKeyModal(null)}
                className="flex-1 px-6 py-3 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 transition-colors"
              >
                Hủy
              </button>
              <button 
                onClick={handleUpdateKeyName}
                disabled={isUpdatingKeyName || !renameKeyName.trim() || renameKeyName.trim() === showRenameKeyModal.name}
                className="flex-1 px-6 py-3 rounded-xl text-sm font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isUpdatingKeyName && <Loader2 className="w-4 h-4 animate-spin" />}
                Lưu thay đổi
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* Google Drive Picker Modal */}
    <GoogleDrivePickerModal 
      isOpen={showDrivePickerModal}
      onClose={() => setShowDrivePickerModal(false)}
      onOpenDriveFile={handleOpenDriveFile}
      onSaveDriveFile={handleSaveDriveFile}
    />

    {/* Drive Folder Selection Modal for Saving */}
    <AnimatePresence>
      {showDriveFolderModal && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowDriveFolderModal(false)}
            className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="relative bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
          >
            <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="bg-indigo-100 p-2 rounded-xl">
                  <Folder className="text-indigo-600 w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-xl font-display font-bold text-slate-800">Chọn thư mục lưu trữ</h3>
                  <p className="text-xs text-slate-400 truncate max-w-[240px]">{driveFileToSave?.name}</p>
                </div>
              </div>
              <button 
                onClick={() => setShowDriveFolderModal(false)}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-2 no-scrollbar">
              <p className="text-xs font-medium text-slate-400 px-2 mb-2 uppercase tracking-wider">Thư mục hiện có</p>
              
              <button 
                onClick={() => confirmSaveDriveFileToFolder(null)}
                className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-2xl transition-all text-left group border border-transparent hover:border-slate-100"
              >
                <div className="bg-slate-100 p-2 rounded-xl group-hover:bg-indigo-100 transition-colors">
                  <Home className="w-5 h-5 text-slate-500 group-hover:text-indigo-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700">Root (Thư mục gốc)</p>
                  <p className="text-[10px] text-slate-400">Lưu trực tiếp vào thư mục chính</p>
                </div>
              </button>

              {allFolders.map(folder => (
                <button 
                  key={folder.id}
                  onClick={() => confirmSaveDriveFileToFolder(folder.id)}
                  className="w-full flex items-center gap-3 p-3 hover:bg-slate-50 rounded-2xl transition-all text-left group border border-transparent hover:border-slate-100"
                >
                  <div className="bg-amber-50 p-2 rounded-xl group-hover:bg-amber-100 transition-colors">
                    <Folder className="w-5 h-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">{folder.name}</p>
                    <p className="text-[10px] text-slate-400">{getFolderPath(folder.id)}</p>
                  </div>
                </button>
              ))}

              {allFolders.length === 0 && (
                <div className="py-8 text-center">
                  <p className="text-sm text-slate-400">Chưa có thư mục nào. Bạn có thể lưu vào Root.</p>
                </div>
              )}
            </div>

            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button 
                onClick={() => setShowDriveFolderModal(false)}
                className="px-6 py-2 text-slate-500 text-sm font-bold hover:bg-slate-100 rounded-xl transition-colors"
              >
                Hủy bỏ
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>

    {/* Toast Notification */}
    <AnimatePresence>
      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className={cn(
            "fixed bottom-8 left-1/2 -translate-x-1/2 z-[9999] px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border backdrop-blur-md",
            toast.type === 'success' ? "bg-emerald-50/90 border-emerald-100 text-emerald-800" : 
            toast.type === 'error' ? "bg-rose-50/90 border-rose-100 text-rose-800" : 
            "bg-slate-800/90 border-slate-700 text-white"
          )}
        >
          {toast.type === 'success' && <Check className="w-4 h-4" />}
          {toast.type === 'error' && <AlertCircle className="w-4 h-4" />}
          {toast.type === 'info' && <Activity className="w-4 h-4" />}
          <span className="text-xs font-bold">{toast.message}</span>
        </motion.div>
      )}
    </AnimatePresence>

    </ErrorBoundary>
  );
}
