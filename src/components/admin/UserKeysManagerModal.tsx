import React, { useState, useEffect, useMemo } from 'react';
import { ApiKeyItem, UserProfile } from '../../types';
import { 
  db, 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  handleFirestoreError,
  OperationType
} from '../../firebase';
import { X, Plus, Key, KeyRound, Trash2, Edit2, CheckCircle2, AlertCircle, Loader2, Play, Shield, RefreshCcw } from 'lucide-react';
import { GeminiService } from '../../services/geminiService';
import { deleteApiKeyReliably, getPendingKeyDeletes, PENDING_DELETES_EVENT } from '../../services/keyDeletion';

interface UserKeysManagerModalProps {
  user: UserProfile;
  onClose: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const UserKeysManagerModal: React.FC<UserKeysManagerModalProps> = ({ user, onClose, showToast }) => {
  const [allKeys, setAllKeys] = useState<ApiKeyItem[]>([]);
  // Ẩn key đã xoá nhưng máy chủ chưa xác nhận (Firestore hết hạn mức ghi)
  const [pendingDeletes, setPendingDeletes] = useState<Set<string>>(() => getPendingKeyDeletes());
  useEffect(() => {
    const sync = () => setPendingDeletes(getPendingKeyDeletes());
    window.addEventListener(PENDING_DELETES_EVENT, sync);
    return () => window.removeEventListener(PENDING_DELETES_EVENT, sync);
  }, []);
  const keys = useMemo(() => allKeys.filter(k => !pendingDeletes.has(k.id)), [allKeys, pendingDeletes]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingKeyId, setEditingKeyId] = useState<string | null>(null);

  const [newKey, setNewKey] = useState({
    name: '',
    value: '',
    engine: 'shopaikey' as 'gemini' | 'shopaikey'
  });

  const [editKeyData, setEditKeyData] = useState({
    name: '',
    value: '',
    engine: 'shopaikey' as 'gemini' | 'shopaikey'
  });

  const [testingKeyId, setTestingKeyId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { success: boolean; latencyMs?: number; error?: string }>>({});

  useEffect(() => {
    const q = query(collection(db, 'apiKeys'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      })) as ApiKeyItem[];
      setAllKeys(items);
      setLoading(false);
    }, (err) => {
      console.error("Error loading user keys:", err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, [user.uid]);

  const handleAddKey = async () => {
    if (!newKey.value.trim()) {
      showToast("Vui lòng nhập giá trị API Key", "error");
      return;
    }
    if (newKey.value.trim().startsWith('AIzaSy')) {
      showToast("Web chỉ còn dùng key ShopAIKey — không thêm key Google Gemini (AIzaSy…).", "error");
      return;
    }

    const name = newKey.name.trim() || `ShopAIKey (${user.displayName || user.email.split('@')[0]})`;
    
    try {
      await addDoc(collection(db, 'apiKeys'), {
        ownerId: user.uid,
        ownerEmail: user.email || '',
        name,
        value: newKey.value.trim(),
        engine: 'shopaikey',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'active',
        sharedWith: []
      });
      showToast(`Đã thêm Key mới cho tài khoản ${user.email}`, "success");
      setNewKey({ name: '', value: '', engine: 'shopaikey' });
      setIsAdding(false);
    } catch (e: any) {
      console.error("Failed to add key for user:", e);
      handleFirestoreError(e, OperationType.CREATE, 'apiKeys');
      showToast("Không thể thêm key: " + e.message, "error");
    }
  };

  const handleSaveEditKey = async (keyId: string) => {
    if (!editKeyData.value.trim()) {
      showToast("Giá trị API Key không được để trống", "error");
      return;
    }
    if (editKeyData.value.trim().startsWith('AIzaSy')) {
      showToast("Web chỉ còn dùng key ShopAIKey — không lưu key Google Gemini (AIzaSy…).", "error");
      return;
    }

    try {
      await updateDoc(doc(db, 'apiKeys', keyId), {
        name: editKeyData.name.trim() || 'API Key',
        value: editKeyData.value.trim(),
        engine: 'shopaikey',
        status: 'active',
        updatedAt: serverTimestamp()
      });
      showToast("Đã cập nhật thông tin Key thành công", "success");
      setEditingKeyId(null);
    } catch (e: any) {
      console.error("Failed to update key:", e);
      handleFirestoreError(e, OperationType.UPDATE, `apiKeys/${keyId}`);
      showToast("Lỗi khi cập nhật key: " + e.message, "error");
    }
  };

  const handleDeleteKey = async (keyId: string) => {
    try {
      const r = await deleteApiKeyReliably(keyId);
      if (r.outcome === 'error') throw r.error;
      if (r.outcome === 'pending') {
        showToast("Firebase đang hết hạn mức ghi hôm nay nên chưa xoá được Key trên máy chủ. Key đã được ẩn trên máy này và sẽ tự xoá lại khi hạn mức được đặt lại (khoảng 15:00).", "info");
        return;
      }
      showToast("Đã xóa Key thành công (máy chủ đã xác nhận)", "success");
    } catch (e: any) {
      console.error("Failed to delete key:", e);
      handleFirestoreError(e, OperationType.DELETE, `apiKeys/${keyId}`);
      showToast("Lỗi khi xóa key: " + e.message, "error");
    }
  };

  const handleTestKey = async (keyId: string, keyValue: string, engine: string) => {
    setTestingKeyId(keyId);
    try {
      const service = new GeminiService(keyValue, engine);
      const isProxy = true;
      const res = await service.testSingleKeyTranslation(keyValue, "Hello! Medical AI Test.", isProxy ? 'proxy' : 'google');
      setTestResult(prev => ({ ...prev, [keyId]: res }));
      
      // Update status in Firestore (key chỉ tạm hết lượt / proxy bận vẫn là key tốt → không đánh dấu lỗi)
      await updateDoc(doc(db, 'apiKeys', keyId), {
        status: res.success || res.errorKind === 'quota' ? 'active' : 'error',
        lastUsed: serverTimestamp()
      });
    } catch (err: any) {
      setTestResult(prev => ({ ...prev, [keyId]: { success: false, error: err.message || 'Chạy thử thất bại' } }));
    } finally {
      setTestingKeyId(null);
    }
  };

  const freeKeysCount = keys.filter(k => (k.value || '').trim().startsWith('AIzaSy')).length;
  const shopAiKeysCount = keys.filter(k => !(k.value || '').trim().startsWith('AIzaSy')).length;

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border border-slate-100">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-100 p-2.5 rounded-2xl text-indigo-600">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base">Quản lý Keys: {user.displayName || user.email}</h3>
              <p className="text-xs text-slate-400">UID: {user.uid.substring(0, 12)}...</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          
          {/* Key Counter Badges */}
          <div className="grid grid-cols-2 gap-3">
            <div className="p-4 bg-emerald-50/80 rounded-2xl border border-emerald-100/80 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase text-emerald-600 tracking-wider">Key Gemini cũ (không dùng)</p>
                <p className="text-xl font-black text-emerald-900">{freeKeysCount} Key</p>
              </div>
              <Key className="w-6 h-6 text-emerald-500 opacity-60" />
            </div>
            <div className="p-4 bg-purple-50/80 rounded-2xl border border-purple-100/80 flex items-center justify-between">
              <div>
                <p className="text-[10px] font-bold uppercase text-purple-600 tracking-wider">ShopAIkey / Proxy Key</p>
                <p className="text-xl font-black text-purple-900">{shopAiKeysCount} Key</p>
              </div>
              <Shield className="w-6 h-6 text-purple-500 opacity-60" />
            </div>
          </div>

          {/* Add Key Form */}
          {!isAdding ? (
            <button
              onClick={() => setIsAdding(true)}
              className="w-full py-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-2xl text-xs transition-all flex items-center justify-center gap-2 border border-indigo-100"
            >
              <Plus className="w-4 h-4" />
              Thêm Key Mới Cho Tài Khoản Này
            </button>
          ) : (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700">Thêm API Key mới</span>
                <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase">Tên gợi nhớ (Tùy chọn)</label>
                  <input
                    type="text"
                    placeholder="VD: Key ShopAIKey cá nhân"
                    value={newKey.name}
                    onChange={(e) => setNewKey({ ...newKey, name: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 mt-1"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-400 uppercase">Giá trị Key (API Key String)</label>
                <input
                  type="text"
                  placeholder="sk-..."
                  value={newKey.value}
                  onChange={(e) => setNewKey({ ...newKey, value: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 mt-1 font-mono"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setIsAdding(false)}
                  className="px-4 py-2 bg-slate-200 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-300 transition-colors"
                >
                  Hủy
                </button>
                <button
                  onClick={handleAddKey}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors shadow-sm"
                >
                  Lưu Key
                </button>
              </div>
            </div>
          )}

          {/* Keys List */}
          {loading ? (
            <div className="py-12 flex justify-center text-slate-400">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : keys.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs italic">
              Tài khoản này chưa cài đặt API Key nào.
            </div>
          ) : (
            <div className="space-y-3">
              {keys.map((k) => {
                const isShop = !(k.value || '').trim().startsWith('AIzaSy');
                const isEditing = editingKeyId === k.id;
                const result = testResult[k.id];

                return (
                  <div key={k.id} className="p-4 bg-slate-50/70 border border-slate-200/80 rounded-2xl space-y-2 hover:border-slate-300 transition-all">
                    {isEditing ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={editKeyData.name}
                            onChange={(e) => setEditKeyData({ ...editKeyData, name: e.target.value })}
                            className="px-3 py-1.5 bg-white border rounded-xl text-xs"
                            placeholder="Tên Key"
                          />
                        </div>
                        <input
                          type="text"
                          value={editKeyData.value}
                          onChange={(e) => setEditKeyData({ ...editKeyData, value: e.target.value })}
                          className="w-full px-3 py-1.5 bg-white border rounded-xl text-xs font-mono"
                        />
                        <div className="flex justify-end gap-2">
                          <button onClick={() => setEditingKeyId(null)} className="px-3 py-1 bg-slate-200 rounded-lg text-xs font-bold">
                            Hủy
                          </button>
                          <button onClick={() => handleSaveEditKey(k.id)} className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold">
                            Cập nhật
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                              isShop ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              {isShop ? 'ShopAIKey' : 'Gemini cũ · không dùng'}
                            </span>
                            <span className="font-bold text-slate-800 text-xs">{k.name}</span>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleTestKey(k.id, k.value, k.engine)}
                              disabled={testingKeyId === k.id}
                              className="p-1.5 hover:bg-slate-200 text-slate-600 rounded-lg transition-colors text-xs flex items-center gap-1"
                              title="Chạy thử Key"
                            >
                              {testingKeyId === k.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" /> : <Play className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => {
                                setEditingKeyId(k.id);
                                setEditKeyData({ name: k.name, value: k.value, engine: k.engine as any });
                              }}
                              className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors"
                              title="Chỉnh sửa Key"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteKey(k.id)}
                              className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors"
                              title="Xóa Key"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="bg-white p-2.5 rounded-xl border border-slate-100 flex items-center justify-between">
                          <span className="font-mono text-xs text-slate-600 truncate max-w-[340px]">
                            {k.value.substring(0, 8)}...{k.value.substring(k.value.length - 6)}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {k.status === 'active' ? (
                              <span className="text-emerald-600 font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" /> Hoạt động
                              </span>
                            ) : (
                              <span className="text-rose-500 font-bold flex items-center gap-1">
                                <AlertCircle className="w-3 h-3" /> Lỗi / Hết hạn
                              </span>
                            )}
                          </span>
                        </div>

                        {result && (
                          <div className={`p-2 rounded-xl text-xs flex items-center justify-between ${
                            result.success ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'
                          }`}>
                            <span>{result.success ? '✅ Kết nối thành công!' : `❌ Lỗi: ${result.error}`}</span>
                            {result.latencyMs && <span className="font-mono text-[10px] opacity-75">{result.latencyMs}ms</span>}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
