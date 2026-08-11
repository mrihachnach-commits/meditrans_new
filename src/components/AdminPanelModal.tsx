import React, { useState } from 'react';
import { UserProfile } from '../types';
import { UserAccountsManager } from './admin/UserAccountsManager';
import { SystemShopAiKeyManager } from './admin/SystemShopAiKeyManager';
import { X, Users, KeyRound, Shield, Sparkles, Activity } from 'lucide-react';

interface AdminPanelModalProps {
  allUsers: UserProfile[];
  userKeysMap: Record<string, { freeCount: number; shopAiCount: number }>;
  onClose: () => void;
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

export const AdminPanelModal: React.FC<AdminPanelModalProps> = ({
  allUsers,
  userKeysMap,
  onClose,
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
  const [activeTab, setActiveTab] = useState<'users' | 'systemShopKeys'>('users');

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-6xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border border-slate-100">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="bg-amber-500 text-white p-2.5 rounded-2xl shadow-md">
              <Shield className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-black text-slate-800 text-lg">Trang Quản Trị Hệ Thống</h2>
              <p className="text-xs text-slate-400">Quản lý cấp độ tài khoản, thời hạn sử dụng, key thành viên và hệ thống ShopAIkey</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button 
              onClick={onClose}
              className="p-2 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Navigation Bar */}
        <div className="px-6 pt-3 bg-slate-50/30 border-b border-slate-100 flex items-center gap-2">
          <button
            onClick={() => setActiveTab('users')}
            className={`px-5 py-3 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x ${
              activeTab === 'users'
                ? 'bg-white border-slate-200 text-indigo-600 shadow-sm -mb-px'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
            }`}
          >
            <Users className="w-4 h-4" />
            Quản Lý Tài Khoản & Level & Keys
          </button>

          <button
            onClick={() => setActiveTab('systemShopKeys')}
            className={`px-5 py-3 rounded-t-2xl font-bold text-xs transition-all flex items-center gap-2 border-t border-x ${
              activeTab === 'systemShopKeys'
                ? 'bg-white border-slate-200 text-purple-600 shadow-sm -mb-px'
                : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            Hệ Thống ShopAIkey Pool
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-white">
          {activeTab === 'users' ? (
            <UserAccountsManager
              allUsers={allUsers}
              userKeysMap={userKeysMap}
              onUpdateLevel={onUpdateLevel}
              onToggleBlock={onToggleBlock}
              onUpdateRole={onUpdateRole}
              onDeleteUser={onDeleteUser}
              onChangePasswordDirect={onChangePasswordDirect}
              onSendResetEmail={onSendResetEmail}
              onCreateNewUser={onCreateNewUser}
              onRefresh={onRefresh}
              showToast={showToast}
            />
          ) : (
            <SystemShopAiKeyManager showToast={showToast} />
          )}
        </div>

      </div>
    </div>
  );
};
