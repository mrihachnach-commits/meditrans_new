import React, { useState, useEffect } from 'react';
import { SystemShopAiKey } from '../../types';
import { 
  db, 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  serverTimestamp,
  handleFirestoreError,
  OperationType 
} from '../../firebase';
import { 
  Plus, 
  Key, 
  ShieldCheck, 
  ShieldAlert, 
  Trash2, 
  Edit2, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  Play, 
  RefreshCcw, 
  Eye, 
  EyeOff, 
  Zap,
  Power
} from 'lucide-react';
import { GeminiService } from '../../services/geminiService';

interface SystemShopAiKeyManagerProps {
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const SystemShopAiKeyManager: React.FC<SystemShopAiKeyManagerProps> = ({ showToast }) => {
  const [keys, setKeys] = useState<SystemShopAiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showValues, setShowValues] = useState<Record<string, boolean>>({});

  const [newKey, setNewKey] = useState({
    name: '',
    value: '',
    engine: 'shopaikey',
    isActive: true
  });

  const [editData, setEditData] = useState({
    name: '',
    value: '',
    engine: 'shopaikey',
    isActive: true
  });

  const [testingId, setTestingId] = useState<string | null>(null);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; latencyMs?: number; error?: string }>>({});

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'systemShopAiKeys'), (snapshot) => {
      const items = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      })) as SystemShopAiKey[];
      setKeys(items);
      setLoading(false);
    }, (err) => {
      console.error("Error fetching system ShopAIkeys:", err);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleAddKey = async () => {
    if (!newKey.value.trim()) {
      showToast("Vui lòng nhập giá trị ShopAIkey (sk-...)", "error");
      return;
    }

    try {
      await addDoc(collection(db, 'systemShopAiKeys'), {
        name: newKey.name.trim() || `ShopAIKey Hệ Thống #${keys.length + 1}`,
        value: newKey.value.trim(),
        engine: newKey.engine || 'shopaikey',
        isActive: newKey.isActive,
        createdAt: serverTimestamp(),
        status: 'active'
      });
      showToast("Đã thêm ShopAIkey hệ thống mới thành công!", "success");
      setNewKey({ name: '', value: '', engine: 'shopaikey', isActive: true });
      setIsAdding(false);
    } catch (e: any) {
      console.error("Failed to add system key:", e);
      handleFirestoreError(e, OperationType.WRITE, 'systemShopAiKeys');
      showToast("Lỗi thêm ShopAIkey hệ thống: " + e.message, "error");
    }
  };

  const handleToggleActive = async (key: SystemShopAiKey) => {
    try {
      await updateDoc(doc(db, 'systemShopAiKeys', key.id), {
        isActive: !key.isActive
      });
      showToast(`Đã ${!key.isActive ? 'Bật' : 'Tắt'} Key [${key.name}]`, "info");
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, `systemShopAiKeys/${key.id}`);
      showToast("Lỗi khi đổi trạng thái key: " + e.message, "error");
    }
  };

  const handleSaveEdit = async (id: string) => {
    if (!editData.value.trim()) {
      showToast("Giá trị key không được để trống", "error");
      return;
    }

    try {
      await updateDoc(doc(db, 'systemShopAiKeys', id), {
        name: editData.name.trim() || 'ShopAIkey Hệ Thống',
        value: editData.value.trim(),
        engine: editData.engine,
        isActive: editData.isActive
      });
      showToast("Đã cập nhật thông tin ShopAIkey hệ thống", "success");
      setEditingId(null);
    } catch (e: any) {
      handleFirestoreError(e, OperationType.UPDATE, `systemShopAiKeys/${id}`);
      showToast("Lỗi cập nhật: " + e.message, "error");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Bạn có chắc chắn muốn xóa ShopAIkey hệ thống này?")) return;
    try {
      await deleteDoc(doc(db, 'systemShopAiKeys', id));
      showToast("Đã xóa ShopAIkey hệ thống", "success");
    } catch (e: any) {
      handleFirestoreError(e, OperationType.DELETE, `systemShopAiKeys/${id}`);
      showToast("Lỗi khi xóa key: " + e.message, "error");
    }
  };

  const handleTestSingleKey = async (key: SystemShopAiKey) => {
    setTestingId(key.id);
    try {
      const service = new GeminiService(key.value, key.engine || 'shopaikey');
      const res = await service.testSingleKeyTranslation(key.value, "Testing ShopAIKey System API Connection");
      setTestResults(prev => ({ ...prev, [key.id]: res }));

      await updateDoc(doc(db, 'systemShopAiKeys', key.id), {
        status: res.success ? 'active' : 'error',
        lastTestedAt: serverTimestamp(),
        latencyMs: res.latencyMs || null
      });
    } catch (e: any) {
      setTestResults(prev => ({ ...prev, [key.id]: { success: false, error: e.message || 'Lỗi thử nghiệm' } }));
    } finally {
      setTestingId(null);
    }
  };

  const handleTestAllKeys = async () => {
    if (keys.length === 0) return;
    setIsTestingAll(true);
    showToast("Đang kiểm tra toàn bộ ShopAIkey hệ thống...", "info");

    for (const k of keys) {
      await handleTestSingleKey(k);
    }

    setIsTestingAll(false);
    showToast("Hoàn tất kiểm tra hệ thống ShopAIkey!", "success");
  };

  const activeCount = keys.filter(k => k.isActive).length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-purple-900 via-indigo-900 to-slate-900 text-white p-6 rounded-3xl shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Zap className="w-5 h-5 text-amber-400" />
            <h3 className="text-lg font-bold">Hệ Thống Key ShopAIkey Pool</h3>
          </div>
          <p className="text-xs text-purple-200">
            Quản lý tập trung các ShopAIkey dùng chung cho các tài khoản Level 2 trở lên.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="px-4 py-2 bg-white/10 backdrop-blur-md rounded-2xl border border-white/10 text-center">
            <span className="text-[10px] uppercase font-bold text-purple-300 block">Đang hoạt động</span>
            <span className="text-xl font-black text-amber-300">{activeCount} / {keys.length} Key</span>
          </div>
          <button
            onClick={handleTestAllKeys}
            disabled={isTestingAll || keys.length === 0}
            className="px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-900 rounded-2xl text-xs font-bold transition-all shadow-lg flex items-center gap-2 disabled:opacity-50"
          >
            {isTestingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            Kiểm tra toàn bộ
          </button>
        </div>
      </div>

      {/* Add New Key Section */}
      {!isAdding ? (
        <button
          onClick={() => setIsAdding(true)}
          className="w-full py-3.5 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 font-bold rounded-2xl text-xs transition-all flex items-center justify-center gap-2 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Thêm ShopAIkey Hệ Thống Mới
        </button>
      ) : (
        <div className="p-5 bg-white border border-indigo-100 rounded-2xl shadow-sm space-y-4 animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <span className="text-sm font-bold text-slate-800">Thêm ShopAIkey Hệ Thống</span>
            <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600">
              <EyeOff className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">Tên gợi nhớ</label>
              <input
                type="text"
                placeholder="VD: ShopAIkey Server #1"
                value={newKey.name}
                onChange={(e) => setNewKey({ ...newKey, name: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 mt-1"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-400 uppercase">Engine</label>
              <input
                type="text"
                value="shopaikey"
                disabled
                className="w-full px-3 py-2 bg-slate-100 border rounded-xl text-xs font-mono text-slate-500 mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Giá trị Key (sk-...)</label>
            <input
              type="text"
              placeholder="sk-..."
              value={newKey.value}
              onChange={(e) => setNewKey({ ...newKey, value: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border rounded-xl text-xs font-mono outline-none focus:ring-2 focus:ring-indigo-500 mt-1"
            />
          </div>

          <div className="flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
              <input
                type="checkbox"
                checked={newKey.isActive}
                onChange={(e) => setNewKey({ ...newKey, isActive: e.target.checked })}
                className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
              />
              Kích hoạt ngay
            </label>

            <div className="flex gap-2">
              <button onClick={() => setIsAdding(false)} className="px-4 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600">
                Hủy
              </button>
              <button onClick={handleAddKey} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700">
                Lưu vào hệ thống
              </button>
            </div>
          </div>
        </div>
      )}

      {/* System Keys List */}
      {loading ? (
        <div className="py-12 flex justify-center text-slate-400">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : keys.length === 0 ? (
        <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-slate-400 text-xs italic">
          Chưa có ShopAIkey hệ thống nào. Vui lòng thêm key để hỗ trợ tài khoản Level 2.
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100">
                <tr>
                  <th className="px-5 py-3.5">Tên Key</th>
                  <th className="px-5 py-3.5">Giá trị Key</th>
                  <th className="px-5 py-3.5">Trạng thái</th>
                  <th className="px-5 py-3.5 text-right">Hành động</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {keys.map((k) => {
                  const isEditing = editingId === k.id;
                  const isShown = showValues[k.id];
                  const res = testResults[k.id];

                  return (
                    <tr key={k.id} className={`hover:bg-slate-50/50 transition-colors ${!k.isActive ? 'bg-slate-50/40 opacity-60' : ''}`}>
                      <td className="px-5 py-4">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editData.name}
                            onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                            className="px-2.5 py-1 bg-white border rounded-lg text-xs"
                          />
                        ) : (
                          <div>
                            <span className="font-bold text-slate-800 block text-xs">{k.name}</span>
                            <span className="text-[9px] text-slate-400 font-mono">Engine: {k.engine}</span>
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-4 font-mono">
                        {isEditing ? (
                          <input
                            type="text"
                            value={editData.value}
                            onChange={(e) => setEditData({ ...editData, value: e.target.value })}
                            className="w-full px-2.5 py-1 bg-white border rounded-lg text-xs font-mono"
                          />
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-slate-700 font-medium">
                              {isShown ? k.value : `${k.value.substring(0, 8)}...${k.value.substring(k.value.length - 6)}`}
                            </span>
                            <button
                              onClick={() => setShowValues(prev => ({ ...prev, [k.id]: !prev[k.id] }))}
                              className="text-slate-400 hover:text-slate-600 p-1"
                            >
                              {isShown ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleActive(k)}
                            className={`p-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 ${
                              k.isActive 
                                ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' 
                                : 'bg-slate-200 text-slate-600 hover:bg-slate-300'
                            }`}
                          >
                            <Power className="w-3.5 h-3.5" />
                            {k.isActive ? 'Đang bật' : 'Đã tắt'}
                          </button>

                          {res && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                              res.success ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'
                            }`}>
                              {res.success ? `${res.latencyMs || 0}ms` : 'Lỗi'}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-5 py-4 text-right">
                        {isEditing ? (
                          <div className="flex justify-end gap-1">
                            <button onClick={() => setEditingId(null)} className="px-2.5 py-1 bg-slate-200 rounded-lg text-xs font-bold">
                              Hủy
                            </button>
                            <button onClick={() => handleSaveEdit(k.id)} className="px-2.5 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold">
                              Lưu
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleTestSingleKey(k)}
                              disabled={testingId === k.id}
                              className="p-1.5 hover:bg-slate-100 text-slate-600 rounded-lg transition-colors"
                              title="Chạy thử"
                            >
                              {testingId === k.id ? <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" /> : <Play className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => {
                                setEditingId(k.id);
                                setEditData({ name: k.name, value: k.value, engine: k.engine, isActive: k.isActive });
                              }}
                              className="p-1.5 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors"
                              title="Chỉnh sửa"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(k.id)}
                              className="p-1.5 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors"
                              title="Xóa"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
