import React, { useState } from 'react';
import { UserProfile, getEffectiveUserLevel, formatLevelExpiration } from '../../types';
import { UserKeysManagerModal } from './UserKeysManagerModal';
import { 
  Users, 
  Search, 
  ShieldCheck, 
  ShieldAlert, 
  User as UserIcon, 
  Mail, 
  KeyRound, 
  CheckCircle2, 
  ChevronLeft, 
  Trash2, 
  Calendar, 
  Clock, 
  Plus, 
  Minus, 
  Key, 
  Sparkles, 
  ChevronDown,
  Activity,
  RefreshCcw,
  UserPlus,
  Eye,
  EyeOff,
  Loader2
} from 'lucide-react';

interface UserAccountsManagerProps {
  allUsers: UserProfile[];
  userKeysMap: Record<string, { freeCount: number; shopAiCount: number }>;
  onUpdateLevel: (uid: string, level: number, durationDays?: number | null) => Promise<void>;
  onToggleBlock: (uid: string, email: string, isBlocked: boolean) => Promise<void>;
  onUpdateRole: (uid: string, email: string, role: 'admin' | 'user') => Promise<void>;
  onDeleteUser: (uid: string, email: string) => Promise<void>;
  onChangePasswordDirect: (uid: string, email: string, newPass: string) => Promise<void>;
  onSendResetEmail: (email: string) => Promise<void>;
  onCreateNewUser: (data: any) => Promise<void>;
  onRefresh: () => void;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
}

export const UserAccountsManager: React.FC<UserAccountsManagerProps> = ({
  allUsers,
  userKeysMap,
  onUpdateLevel,
  onToggleBlock,
  onUpdateRole,
  onDeleteUser,
  onChangePasswordDirect,
  onSendResetEmail,
  onCreateNewUser,
  onRefresh,
  showToast
}) => {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'user' | 'admin' | 'blocked'>('all');
  const [levelFilter, setLevelFilter] = useState<'all' | '1' | '2' | '3'>('all');

  const [managedKeyUser, setManagedKeyUser] = useState<UserProfile | null>(null);

  // Duration Modal / Popover state
  const [durationPickerUid, setDurationPickerUid] = useState<string | null>(null);

  // Passwords / Delete confirmations
  const [pendingPasswordUid, setPendingPasswordUid] = useState<string | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [pendingDeleteUid, setPendingDeleteUid] = useState<string | null>(null);

  // New user creation
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserDisplayName, setNewUserDisplayName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'user' | 'admin'>('user');
  const [newUserLevel, setNewUserLevel] = useState<number>(1);
  const [showNewUserPassword, setShowNewUserPassword] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);

  const filteredUsers = allUsers.filter(u => {
    const searchMatch = (u.email || '').toLowerCase().includes(search.toLowerCase()) || 
                       (u.displayName || '').toLowerCase().includes(search.toLowerCase());
    let roleMatch = true;
    if (roleFilter === 'admin') roleMatch = u.role === 'admin';
    else if (roleFilter === 'user') roleMatch = u.role === 'user';
    else if (roleFilter === 'blocked') roleMatch = u.isBlocked === true;

    let levelMatch = true;
    const effLevel = getEffectiveUserLevel(u);
    if (levelFilter === '1') levelMatch = effLevel === 1;
    else if (levelFilter === '2') levelMatch = effLevel === 2;
    else if (levelFilter === '3') levelMatch = effLevel === 3;

    return searchMatch && roleMatch && levelMatch;
  });

  const handleCreateUserSubmit = async () => {
    if (!newUserEmail || !newUserPassword) {
      showToast("Vui lòng nhập Email và Mật khẩu", "error");
      return;
    }
    setIsCreatingUser(true);
    try {
      await onCreateNewUser({
        email: newUserEmail,
        password: newUserPassword,
        displayName: newUserDisplayName,
        role: newUserRole,
        level: newUserLevel
      });
      showToast("Đã tạo người dùng mới thành công", "success");
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserDisplayName('');
      setNewUserLevel(1);
    } catch (e: any) {
      showToast(e.message || "Không thể tạo tài khoản", "error");
    } finally {
      setIsCreatingUser(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Key Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-indigo-50/80 p-4 rounded-2xl border border-indigo-100 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-indigo-400 tracking-wider">Tổng tài khoản</span>
            <p className="text-2xl font-black text-indigo-900">{allUsers.length}</p>
          </div>
          <Users className="w-6 h-6 text-indigo-400 opacity-60" />
        </div>

        <div className="bg-emerald-50/80 p-4 rounded-2xl border border-emerald-100 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-emerald-600 tracking-wider">Level 1 (Thường)</span>
            <p className="text-2xl font-black text-emerald-900">{allUsers.filter(u => getEffectiveUserLevel(u) === 1).length}</p>
          </div>
          <UserIcon className="w-6 h-6 text-emerald-500 opacity-60" />
        </div>

        <div className="bg-purple-50/80 p-4 rounded-2xl border border-purple-100 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-purple-600 tracking-wider">Level 2 (VIP)</span>
            <p className="text-2xl font-black text-purple-900">{allUsers.filter(u => getEffectiveUserLevel(u) === 2).length}</p>
          </div>
          <Sparkles className="w-6 h-6 text-purple-500 opacity-60" />
        </div>

        <div className="bg-amber-50/80 p-4 rounded-2xl border border-amber-100 flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold uppercase text-amber-600 tracking-wider">Level 3 (Admin)</span>
            <p className="text-2xl font-black text-amber-900">{allUsers.filter(u => getEffectiveUserLevel(u) === 3).length}</p>
          </div>
          <ShieldCheck className="w-6 h-6 text-amber-500 opacity-60" />
        </div>
      </div>

      {/* Create User Form Section */}
      <section className="bg-slate-50/80 p-5 rounded-2xl border border-slate-200 space-y-3">
        <div className="flex items-center gap-2">
          <UserPlus className="w-4 h-4 text-indigo-600" />
          <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">Thêm người dùng mới</h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Tên hiển thị</label>
            <input 
              type="text"
              placeholder="Nguyễn Văn A"
              value={newUserDisplayName}
              onChange={(e) => setNewUserDisplayName(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 mt-1"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Email</label>
            <input 
              type="email"
              placeholder="user@example.com"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 mt-1"
            />
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Mật khẩu</label>
            <div className="relative mt-1">
              <input 
                type={showNewUserPassword ? "text" : "password"}
                placeholder="••••••••"
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                className="w-full pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowNewUserPassword(!showNewUserPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                {showNewUserPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Level mặc định</label>
            <select
              value={newUserLevel}
              onChange={(e) => setNewUserLevel(Number(e.target.value))}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 mt-1 cursor-pointer"
            >
              <option value={1}>Level 1 (Thường / Free)</option>
              <option value={2}>Level 2 (VIP / ShopAIkey)</option>
              <option value={3}>Level 3 (Pro / Admin)</option>
            </select>
          </div>

          <div>
            <label className="text-[10px] font-bold text-slate-400 uppercase">Vai trò</label>
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as any)}
              className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500 mt-1 cursor-pointer"
            >
              <option value="user">Người dùng</option>
              <option value="admin">Quản trị viên</option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              onClick={handleCreateUserSubmit}
              disabled={isCreatingUser}
              className="w-full py-2.5 bg-indigo-600 text-white font-bold rounded-xl text-xs hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 shadow-md disabled:opacity-50"
            >
              {isCreatingUser ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
              Tạo tài khoản
            </button>
          </div>
        </div>
      </section>

      {/* User Search & Filters */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200">
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input 
            type="text"
            placeholder="Tìm theo email, tên..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <select 
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as any)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none font-medium cursor-pointer"
          >
            <option value="all">Tất cả Level</option>
            <option value="1">Level 1 (Thường)</option>
            <option value="2">Level 2 (VIP)</option>
            <option value="3">Level 3 (Admin)</option>
          </select>

          <select 
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs outline-none font-medium cursor-pointer"
          >
            <option value="all">Tất cả vai trò</option>
            <option value="user">Thành viên</option>
            <option value="admin">Quản trị viên</option>
            <option value="blocked">Đã chặn</option>
          </select>

          <button 
            onClick={onRefresh}
            className="p-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl transition-colors"
            title="Làm mới danh sách"
          >
            <RefreshCcw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Users Table */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-100">
              <tr>
                <th className="px-5 py-3.5">Người dùng</th>
                <th className="px-5 py-3.5">Level & Thời gian</th>
                <th className="px-5 py-3.5">Keys Khả Dụng</th>
                <th className="px-5 py-3.5">Vai trò</th>
                <th className="px-5 py-3.5 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">
                    Không tìm thấy tài khoản người dùng phù hợp.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const effLevel = getEffectiveUserLevel(u);
                  const expInfo = formatLevelExpiration(u.levelExpiresAt);
                  const keyCounts = userKeysMap[u.uid] || { freeCount: 0, shopAiCount: 0 };

                  return (
                    <tr key={u.uid} className={`hover:bg-slate-50/60 transition-colors ${u.isBlocked ? 'bg-rose-50/20' : ''}`}>
                      
                      {/* User Info */}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs text-white shadow-inner ${
                            effLevel === 3 ? 'bg-amber-500' : effLevel === 2 ? 'bg-purple-600' : 'bg-slate-500'
                          }`}>
                            {(u.displayName || u.email || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-800 text-xs">{u.displayName || u.email.split('@')[0]}</span>
                              {u.isBlocked && (
                                <span className="px-1.5 py-0.5 bg-rose-100 text-rose-600 text-[8px] font-black uppercase rounded-md">Bị chặn</span>
                              )}
                            </div>
                            <span className="text-[10px] text-slate-400 block">{u.email}</span>
                          </div>
                        </div>
                      </td>

                      {/* Level & Expiration Duration Management */}
                      <td className="px-5 py-4">
                        <div className="space-y-1.5">
                          {/* Level Badge and Controls */}
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-wider ${
                              effLevel === 3 
                                ? 'bg-amber-100 text-amber-700 border border-amber-200' 
                                : effLevel === 2 
                                ? 'bg-purple-100 text-purple-700 border border-purple-200' 
                                : 'bg-slate-100 text-slate-700 border border-slate-200'
                            }`}>
                              Level {effLevel} {effLevel === 2 ? '(VIP)' : effLevel === 3 ? '(Pro/Admin)' : '(Thường)'}
                            </span>

                            {/* Increase / Decrease Level Buttons */}
                            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
                              <button
                                onClick={() => onUpdateLevel(u.uid, Math.max(1, effLevel - 1))}
                                disabled={effLevel <= 1}
                                className="p-1 hover:bg-white rounded text-slate-600 disabled:opacity-30"
                                title="Giảm Level"
                              >
                                <Minus className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => onUpdateLevel(u.uid, Math.min(3, effLevel + 1))}
                                disabled={effLevel >= 3}
                                className="p-1 hover:bg-white rounded text-slate-600 disabled:opacity-30"
                                title="Tăng Level"
                              >
                                <Plus className="w-3 h-3" />
                              </button>
                            </div>
                          </div>

                          {/* Level Expiration Display & Preset Extender */}
                          <div className="flex items-center gap-2 text-[10px]">
                            <span className={`font-medium flex items-center gap-1 ${
                              expInfo.isExpired ? 'text-rose-500 font-bold' : 'text-slate-500'
                            }`}>
                              <Clock className="w-3 h-3" />
                              {expInfo.text}
                            </span>

                            {/* Extension dropdown */}
                            <div className="relative">
                              <button
                                onClick={() => setDurationPickerUid(durationPickerUid === u.uid ? null : u.uid)}
                                className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-md font-bold text-[9px] transition-colors flex items-center gap-1"
                              >
                                Gia hạn
                                <ChevronDown className="w-2.5 h-2.5" />
                              </button>

                              {durationPickerUid === u.uid && (
                                <div className="absolute left-0 mt-1 w-44 bg-white border border-slate-200 rounded-xl shadow-xl p-2 z-20 space-y-1 animate-in fade-in duration-150">
                                  <p className="text-[9px] font-bold text-slate-400 uppercase px-2 py-1">Gia hạn thời gian dùng</p>
                                  <button
                                    onClick={() => {
                                      onUpdateLevel(u.uid, Math.max(2, effLevel), 7);
                                      setDurationPickerUid(null);
                                    }}
                                    className="w-full text-left px-2 py-1 text-xs hover:bg-slate-50 rounded-lg text-slate-700 font-medium"
                                  >
                                    +7 ngày
                                  </button>
                                  <button
                                    onClick={() => {
                                      onUpdateLevel(u.uid, Math.max(2, effLevel), 30);
                                      setDurationPickerUid(null);
                                    }}
                                    className="w-full text-left px-2 py-1 text-xs hover:bg-slate-50 rounded-lg text-slate-700 font-medium"
                                  >
                                    +30 ngày (1 tháng)
                                  </button>
                                  <button
                                    onClick={() => {
                                      onUpdateLevel(u.uid, Math.max(2, effLevel), 90);
                                      setDurationPickerUid(null);
                                    }}
                                    className="w-full text-left px-2 py-1 text-xs hover:bg-slate-50 rounded-lg text-slate-700 font-medium"
                                  >
                                    +90 ngày (3 tháng)
                                  </button>
                                  <button
                                    onClick={() => {
                                      onUpdateLevel(u.uid, Math.max(2, effLevel), 365);
                                      setDurationPickerUid(null);
                                    }}
                                    className="w-full text-left px-2 py-1 text-xs hover:bg-slate-50 rounded-lg text-slate-700 font-medium"
                                  >
                                    +365 ngày (1 năm)
                                  </button>
                                  <button
                                    onClick={() => {
                                      onUpdateLevel(u.uid, Math.max(2, effLevel), null); // null = unlimited
                                      setDurationPickerUid(null);
                                    }}
                                    className="w-full text-left px-2 py-1 text-xs hover:bg-indigo-50 text-indigo-700 rounded-lg font-bold"
                                  >
                                    Vĩnh viễn (Không giới hạn)
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Account Keys Summary & Action */}
                      <td className="px-5 py-4">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-md font-bold">
                              Free: {keyCounts.freeCount}
                            </span>
                            <span className="text-[10px] px-2 py-0.5 bg-purple-50 text-purple-700 border border-purple-100 rounded-md font-bold">
                              ShopAI: {keyCounts.shopAiCount}
                            </span>
                          </div>

                          <button
                            onClick={() => setManagedKeyUser(u)}
                            className="px-2.5 py-1 bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 text-slate-700 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1.5"
                          >
                            <KeyRound className="w-3 h-3" />
                            Quản lý Keys ({keyCounts.freeCount + keyCounts.shopAiCount})
                          </button>
                        </div>
                      </td>

                      {/* Role */}
                      <td className="px-5 py-4">
                        <button
                          onClick={() => onUpdateRole(u.uid, u.email, u.role === 'admin' ? 'user' : 'admin')}
                          className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider transition-colors ${
                            u.role === 'admin' ? 'bg-amber-100 text-amber-700' : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                          }`}
                        >
                          {u.role === 'admin' ? 'Quản trị viên' : 'Thành viên'}
                        </button>
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          
                          {/* Direct password change inline */}
                          {pendingPasswordUid === u.uid ? (
                            <div className="flex items-center gap-1">
                              <input 
                                type="text"
                                value={newPasswordInput}
                                onChange={(e) => setNewPasswordInput(e.target.value)}
                                placeholder="Mật khẩu mới"
                                className="px-2 py-1 bg-white border rounded-lg text-[10px] w-24 outline-none focus:ring-1 focus:ring-indigo-500"
                                autoFocus
                              />
                              <button 
                                onClick={() => {
                                  onChangePasswordDirect(u.uid, u.email, newPasswordInput);
                                  setPendingPasswordUid(null);
                                  setNewPasswordInput('');
                                }}
                                className="p-1 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </button>
                              <button 
                                onClick={() => setPendingPasswordUid(null)}
                                className="p-1 bg-slate-100 text-slate-600 rounded-lg"
                              >
                                <ChevronLeft className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <>
                              <button 
                                onClick={() => onSendResetEmail(u.email)}
                                className="p-2 hover:bg-indigo-50 text-indigo-600 rounded-lg transition-colors"
                                title="Gửi email đổi mật khẩu"
                              >
                                <Mail className="w-4 h-4" />
                              </button>

                              <button 
                                onClick={() => setPendingPasswordUid(u.uid)}
                                className="p-2 hover:bg-amber-50 text-amber-600 rounded-lg transition-colors"
                                title="Đổi mật khẩu trực tiếp"
                              >
                                <KeyRound className="w-4 h-4" />
                              </button>
                            </>
                          )}

                          {/* Block/Unblock toggle */}
                          <button 
                            onClick={() => onToggleBlock(u.uid, u.email, !!u.isBlocked)}
                            className={`p-2 rounded-lg transition-colors ${
                              u.isBlocked ? 'hover:bg-emerald-50 text-emerald-600' : 'hover:bg-rose-50 text-rose-600'
                            }`}
                            title={u.isBlocked ? 'Bỏ chặn tài khoản' : 'Chặn tài khoản này'}
                          >
                            {u.isBlocked ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
                          </button>

                          {/* Delete account confirmation */}
                          {pendingDeleteUid === u.uid ? (
                            <button 
                              onClick={() => {
                                onDeleteUser(u.uid, u.email);
                                setPendingDeleteUid(null);
                              }}
                              className="px-2 py-1 bg-rose-600 text-white text-[10px] font-bold rounded-lg hover:bg-rose-700"
                            >
                              Xóa luôn
                            </button>
                          ) : (
                            <button 
                              onClick={() => setPendingDeleteUid(u.uid)}
                              className="p-2 hover:bg-rose-50 text-rose-600 rounded-lg transition-colors"
                              title="Xóa tài khoản"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}

                        </div>
                      </td>

                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* User Keys Manager Modal */}
      {managedKeyUser && (
        <UserKeysManagerModal
          user={managedKeyUser}
          onClose={() => setManagedKeyUser(null)}
          showToast={showToast}
        />
      )}
    </div>
  );
};
