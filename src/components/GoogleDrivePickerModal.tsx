import React, { useState, useEffect } from 'react';
import { 
  HardDrive, 
  Search, 
  FileText, 
  X, 
  Loader2, 
  RefreshCcw, 
  Upload, 
  CheckCircle2, 
  AlertCircle,
  ExternalLink,
  Plus,
  FolderPlus
} from 'lucide-react';
import { 
  listUserDriveFiles, 
  uploadFileToDrive, 
  getGoogleOAuthToken, 
  connectGoogleDrive,
  DriveFileMetadata 
} from '../services/googleDriveService';
import { motion } from 'motion/react';

interface GoogleDrivePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenDriveFile: (file: DriveFileMetadata) => void;
  onSaveDriveFile: (file: DriveFileMetadata) => void;
  onFileUploaded?: (file: DriveFileMetadata) => void;
}

export const GoogleDrivePickerModal: React.FC<GoogleDrivePickerModalProps> = ({
  isOpen,
  onClose,
  onOpenDriveFile,
  onSaveDriveFile,
  onFileUploaded
}) => {
  const [files, setFiles] = useState<DriveFileMetadata[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);

  const fetchDriveFiles = async () => {
    setLoading(true);
    setError(null);
    try {
      const driveFiles = await listUserDriveFiles(searchQuery);
      setFiles(driveFiles);
    } catch (err: any) {
      console.error('Error listing Drive files:', err);
      setError(err.message || 'Không thể kết nối đến Google Drive. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchDriveFiles();
    }
  }, [isOpen]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchDriveFiles();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadProgress(`Đang tải lên "${file.name}" sang Google Drive...`);
    setError(null);

    try {
      const uploaded = await uploadFileToDrive(file);
      setUploadProgress(`Tải lên thành công!`);
      if (onFileUploaded) {
        onFileUploaded(uploaded);
      } else {
        onSaveDriveFile(uploaded);
      }
      setTimeout(() => {
        setIsUploading(false);
        setUploadProgress(null);
        fetchDriveFiles();
      }, 1000);
    } catch (err: any) {
      console.error('Upload error:', err);
      setError(`Lỗi tải lên Google Drive: ${err.message || 'Lỗi không xác định'}`);
      setIsUploading(false);
      setUploadProgress(null);
    } finally {
      e.target.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <motion.div 
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 w-full max-w-2xl overflow-hidden flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-slate-50 to-indigo-50/30">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-600 text-white rounded-2xl shadow-md shadow-indigo-100">
              <HardDrive className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base">Google Drive (Thư mục "MediTrans AI")</h3>
              <p className="text-xs text-slate-500">Quản lý và chọn tệp PDF trong thư mục MediTrans AI trên Google Drive</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar & Search */}
        <div className="p-4 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-3">
          <form onSubmit={handleSearchSubmit} className="flex-1 min-w-[200px] relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text"
              placeholder="Tìm kiếm tài liệu PDF trong thư mục MediTrans AI..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
            />
          </form>

          <button 
            onClick={fetchDriveFiles}
            disabled={loading}
            className="p-2 bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm"
            title="Làm mới"
          >
            <RefreshCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <label className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-100 flex items-center gap-2 cursor-pointer active:scale-95">
            <Upload className="w-3.5 h-3.5" />
            <span>Tải tệp mới lên Drive</span>
            <input 
              type="file" 
              accept=".pdf,application/pdf"
              onChange={handleFileUpload}
              disabled={isUploading}
              className="hidden"
            />
          </label>
        </div>

        {/* Status / Upload Message */}
        {uploadProgress && (
          <div className="px-6 py-3 bg-indigo-50 border-b border-indigo-100 flex items-center gap-3 text-indigo-700 text-xs font-medium animate-in slide-in-from-top duration-200">
            <Loader2 className="w-4 h-4 animate-spin shrink-0 text-indigo-600" />
            <span>{uploadProgress}</span>
          </div>
        )}

        {error && error !== "CHUA_KET_NOI_DRIVE" && (
          <div className="px-6 py-3 bg-rose-50 border-b border-rose-100 flex items-center justify-between gap-3 text-rose-700 text-xs font-medium">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button 
              onClick={async () => {
                try {
                  await connectGoogleDrive();
                  fetchDriveFiles();
                } catch (e: any) {
                  setError(e.message);
                }
              }}
              className="px-3 py-1 bg-rose-600 text-white text-[10px] font-bold rounded-lg hover:bg-rose-700 transition-all shrink-0"
            >
              Cấp quyền lại
            </button>
          </div>
        )}

        {/* File List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-[250px]">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
              <p className="text-xs font-medium">Đang tải danh sách tài liệu từ Google Drive...</p>
            </div>
          ) : error === "CHUA_KET_NOI_DRIVE" ? (
            <div className="py-12 flex flex-col items-center justify-center text-center p-6 bg-slate-50/50 rounded-2xl border border-dashed border-indigo-100 my-4">
              <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mb-3 shadow-sm">
                <HardDrive className="w-7 h-7" />
              </div>
              <h4 className="font-bold text-slate-800 text-sm mb-1">Kết nối Google Drive</h4>
              <p className="text-xs text-slate-500 max-w-sm mb-5 leading-relaxed">
                Ứng dụng cần quyền xem và quản lý tệp trên Google Drive cá nhân của bạn để mở tài liệu PDF và lưu bản dịch.
              </p>
              <button
                onClick={async () => {
                  setLoading(true);
                  setError(null);
                  try {
                    await connectGoogleDrive();
                    await fetchDriveFiles();
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setLoading(false);
                  }
                }}
                className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-200 transition-all active:scale-95 flex items-center gap-2"
              >
                <HardDrive className="w-4 h-4" />
                <span>Kết nối & Cấp quyền Google Drive</span>
              </button>
            </div>
          ) : files.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center p-6">
              <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
                <FileText className="w-6 h-6" />
              </div>
              <h4 className="font-bold text-slate-700 text-sm mb-1">Chưa có tài liệu PDF trong thư mục "MediTrans AI"</h4>
              <p className="text-xs text-slate-400 max-w-sm mb-4">
                Hãy dùng nút "Tải tệp mới lên Drive" ở trên để đưa tài liệu y khoa vào thư mục "MediTrans AI" trên Google Drive.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {files.map((file) => (
                <div 
                  key={file.id}
                  className="p-3 bg-white border border-slate-100 hover:border-indigo-200 hover:bg-indigo-50/30 rounded-2xl flex items-center justify-between gap-3 transition-all group"
                >
                  <div 
                    onClick={() => {
                      onOpenDriveFile(file);
                      onClose();
                    }}
                    className="flex items-center gap-3 min-w-0 cursor-pointer flex-1"
                  >
                    <div className="p-2.5 bg-rose-50 text-rose-600 rounded-xl group-hover:bg-indigo-600 group-hover:text-white transition-all shrink-0">
                      <FileText className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="font-semibold text-slate-800 text-xs truncate group-hover:text-indigo-700 transition-all">
                        {file.name}
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-0.5 flex items-center gap-2">
                        {file.size ? `${(file.size / (1024 * 1024)).toFixed(2)} MB` : 'PDF Document'}
                        {file.createdTime && (
                          <>
                            <span>•</span>
                            <span>{new Date(file.createdTime).toLocaleDateString('vi-VN')}</span>
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button 
                      onClick={() => {
                        onOpenDriveFile(file);
                        onClose();
                      }}
                      className="px-3 py-1.5 bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1"
                      title="Mở tài liệu để dịch ngay"
                    >
                      <span>Mở dịch</span>
                    </button>
                    <button 
                      onClick={() => {
                        onSaveDriveFile(file);
                        onClose();
                      }}
                      className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-slate-800 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1"
                      title="Lưu vào quản lý tài liệu và chọn thư mục"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span>Lưu</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            Tài liệu lưu trữ an toàn trực tiếp trên Google Drive cá nhân
          </span>
          <button 
            onClick={onClose}
            className="px-4 py-1.5 text-slate-500 hover:text-slate-700 font-semibold"
          >
            Đóng
          </button>
        </div>
      </motion.div>
    </div>
  );
};
