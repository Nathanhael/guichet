import { useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useT } from '../i18n';
import PlatformSystemHealth from '../components/admin/PlatformSystemHealth';
import PlatformAuditLog from '../components/admin/PlatformAuditLog';
import UserMenuChip from '../components/ui/UserMenuChip';
import PartnerList from '../components/platform/PartnerList';
import UserTable from '../components/platform/UserTable';
import CreatePartnerModal from '../components/platform/CreatePartnerModal';
import EditPartnerModal from '../components/platform/EditPartnerModal';
import DeletePartnerModal from '../components/platform/DeletePartnerModal';
import InviteUserModal from '../components/platform/InviteUserModal';
import ManageAccessModal from '../components/platform/ManageAccessModal';
import EditUserProfileModal from '../components/platform/EditUserProfileModal';
import GroupMappingsPanel from '../components/platform/GroupMappingsPanel';
import PendingInvitesTab from '../components/platform/PendingInvitesTab';
import PlatformArchiveViewer from '../components/admin/PlatformArchiveViewer';
import type { PlatformTab, Partner, GlobalUser } from '../components/platform/types';
import { APP_NAME } from '../constants';

export default function PlatformView() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<PlatformTab>('partners');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [partnerToDelete, setPartnerToDelete] = useState<Partner | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingUser, setEditingUser] = useState<GlobalUser | null>(null);
  const [editingUserProfile, setEditingUserProfile] = useState<GlobalUser | null>(null);

  return (
    <ErrorBoundary>
    <div className="h-screen flex flex-col bg-[var(--color-bg-base)] text-[var(--color-text-primary)] overflow-hidden font-sans">
      <nav className="px-8 py-3 border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <img src="/icon-blue.svg" className="w-5 h-5 mr-1" alt="" />
            <span className="text-[14px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{APP_NAME}</span>
          </div>
          <span className="inline-flex items-center rounded-[var(--radius-pill)] bg-[var(--color-accent)] text-white text-[11px] font-semibold px-2 py-0.5 ml-2 leading-none">
            {t('platform')}
          </span>
        </div>
        <div className="w-[240px]">
          <UserMenuChip subtitleOverride="Platform operator" placement="bottom-end" />
        </div>
      </nav>

      <div role="tablist" aria-label={t('platform')} className="flex border-b border-[var(--color-border)] bg-[var(--color-bg-surface)] px-8 overflow-x-auto">
        {(['partners', 'users', 'invites', 'sso', 'health', 'audit', 'archive'] as const).map((tab) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`px-6 py-3 text-[13px] font-medium border-b-2 whitespace-nowrap transition-colors ${
              activeTab === tab
                ? 'border-[var(--color-accent)] text-[var(--color-accent)]'
                : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {t(`${tab}_tab`)}
          </button>
        ))}
      </div>

      <main role="tabpanel" aria-label={t(`${activeTab}_tab`)} className="flex-1 overflow-y-auto p-8 custom-scrollbar">
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
          {activeTab === 'invites' && <PendingInvitesTab />}
          {activeTab === 'sso' && <GroupMappingsPanel />}
          {activeTab === 'health' && <PlatformSystemHealth />}
          {activeTab === 'audit' && <PlatformAuditLog />}
          {activeTab === 'archive' && <PlatformArchiveViewer />}
        </div>
      </main>

      <CreatePartnerModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
      <EditPartnerModal partner={editingPartner} onClose={() => setEditingPartner(null)} />
      <DeletePartnerModal partner={partnerToDelete} onClose={() => setPartnerToDelete(null)} />
      <InviteUserModal open={showInviteModal} onClose={() => setShowInviteModal(false)} />
      <ManageAccessModal user={editingUser} onClose={() => setEditingUser(null)} />
      <EditUserProfileModal user={editingUserProfile} onClose={() => setEditingUserProfile(null)} />
    </div>
    </ErrorBoundary>
  );
}
