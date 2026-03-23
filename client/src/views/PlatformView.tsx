import { useState } from 'react';
import useStore from '../store/useStore';
import DarkModeToggle from '../components/DarkModeToggle';
import { useT } from '../i18n';
import PlatformSystemHealth from '../components/admin/PlatformSystemHealth';
import PlatformAuditLog from '../components/admin/PlatformAuditLog';
import PlatformSystemSettings from '../components/admin/PlatformSystemSettings';
import LanguageSwitcher from '../components/LanguageSwitcher';
import PartnerList from '../components/platform/PartnerList';
import UserTable from '../components/platform/UserTable';
import CreatePartnerModal from '../components/platform/CreatePartnerModal';
import EditPartnerModal from '../components/platform/EditPartnerModal';
import DeletePartnerModal from '../components/platform/DeletePartnerModal';
import InviteUserModal from '../components/platform/InviteUserModal';
import ManageAccessModal from '../components/platform/ManageAccessModal';
import EditUserProfileModal from '../components/platform/EditUserProfileModal';
import GroupMappingsPanel from '../components/platform/GroupMappingsPanel';
import type { PlatformTab, Partner, GlobalUser } from '../components/platform/types';

export default function PlatformView() {
  const { logout } = useStore();
  const t = useT();
  const [activeTab, setActiveTab] = useState<PlatformTab>('partners');

  // Modal visibility state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [partnerToDelete, setPartnerToDelete] = useState<Partner | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingUser, setEditingUser] = useState<GlobalUser | null>(null);
  const [editingUserProfile, setEditingUserProfile] = useState<GlobalUser | null>(null);

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-black text-black dark:text-white overflow-hidden font-sans">
      <nav className="px-8 py-4 border-b-2 border-black dark:border-white bg-white dark:bg-black flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <span className="text-2xl font-black uppercase tracking-tighter">TESSERA</span>
          <div className="h-6 w-px bg-black dark:bg-white opacity-20 mx-2" />
          <span className="text-[10px] font-black px-2 py-1 bg-black dark:bg-white text-white dark:text-black uppercase tracking-widest mr-4">{t('platform_operator')}</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 bg-black/5 dark:bg-white/5 p-1 border border-black dark:border-white">
            <LanguageSwitcher />
            <DarkModeToggle />
          </div>
          <button onClick={logout} className="text-black dark:text-white hover:line-through text-xs font-black uppercase tracking-widest">{'\u279c'} {t('sign_out')}</button>
        </div>
      </nav>

      <div className="flex border-b-2 border-black dark:border-white bg-white dark:bg-black px-8 overflow-x-auto">
        {(['partners', 'users', 'sso', 'health', 'config', 'audit'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-8 py-4 text-[10px] font-black uppercase tracking-widest border-b-4 whitespace-nowrap ${
              activeTab === tab ? 'border-black dark:border-white text-black dark:text-white' : 'border-transparent opacity-40 hover:opacity-100'
            }`}
          >
            {t(`${tab}_tab`)}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto">
          {activeTab === 'partners' && (
            <PartnerList
              onCreateClick={() => setShowCreateModal(true)}
              onEditPartner={setEditingPartner}
              onDeletePartner={setPartnerToDelete}
            />
          )}
          {activeTab === 'users' && (
            <UserTable
              onInviteClick={() => setShowInviteModal(true)}
              onEditProfile={setEditingUserProfile}
              onManageAccess={setEditingUser}
            />
          )}
          {activeTab === 'sso' && <GroupMappingsPanel />}
          {activeTab === 'health' && <PlatformSystemHealth />}
          {activeTab === 'config' && <PlatformSystemSettings />}
          {activeTab === 'audit' && <PlatformAuditLog />}
        </div>
      </main>

      <CreatePartnerModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <EditPartnerModal partner={editingPartner} onClose={() => setEditingPartner(null)} />
      <DeletePartnerModal partner={partnerToDelete} onClose={() => setPartnerToDelete(null)} />
      <InviteUserModal open={showInviteModal} onClose={() => setShowInviteModal(false)} />
      <ManageAccessModal user={editingUser} onClose={() => setEditingUser(null)} />
      <EditUserProfileModal user={editingUserProfile} onClose={() => setEditingUserProfile(null)} />
    </div>
  );
}
