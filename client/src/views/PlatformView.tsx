import { useEffect, useState } from 'react';
import useStore from '../store/useStore';
import DarkModeToggle from '../components/DarkModeToggle';
import { useT } from '../i18n';
import PlatformSystemHealth from '../components/admin/PlatformSystemHealth';
import PlatformAuditLog from '../components/admin/PlatformAuditLog';
import PlatformSecurityOps from '../components/admin/PlatformSecurityOps';
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
import PlatformArchiveViewer from '../components/admin/PlatformArchiveViewer';
import type { PlatformTab, Partner, GlobalUser } from '../components/platform/types';
import { trpc } from '../utils/trpc';

export default function PlatformView() {
  const logout = useStore((s) => s.logout);
  const t = useT();
  const [activeTab, setActiveTab] = useState<PlatformTab>('partners');
  const { data: securityStatus, isLoading: securityStatusLoading } = trpc.platformSecurity.getStatus.useQuery();
  const stepUpLocked = securityStatusLoading || (securityStatus ? !securityStatus.stepUpSatisfied : true);
  const effectiveTab: PlatformTab = stepUpLocked ? 'security' : activeTab;

  useEffect(() => {
    if (stepUpLocked && activeTab !== 'security') {
      setActiveTab('security');
    }
  }, [activeTab, stepUpLocked]);

  // Modal visibility state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [partnerToDelete, setPartnerToDelete] = useState<Partner | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingUser, setEditingUser] = useState<GlobalUser | null>(null);
  const [editingUserProfile, setEditingUserProfile] = useState<GlobalUser | null>(null);

  return (
    <div className="h-screen flex flex-col bg-[var(--color-bg-base)] text-[var(--color-text-primary)] overflow-hidden font-sans">
      <nav className="px-8 py-4 border-b border-[var(--color-border-heavy)] bg-[var(--color-bg-surface)] flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <span className="text-2xl font-bold uppercase tracking-tighter font-mono">TESSERA</span>
          <div className="h-6 w-px bg-[var(--color-border)] mx-2" />
          <span className="text-[10px] font-bold px-2 py-1 bg-[var(--color-text-primary)] text-[var(--color-bg-base)] uppercase tracking-widest mr-4 font-mono">{t('platform_operator')}</span>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 bg-[var(--color-bg-elevated)] p-1 border border-[var(--color-border)]">
            <LanguageSwitcher />
            <DarkModeToggle />
          </div>
          <button onClick={logout} className="text-[var(--color-text-primary)] hover:line-through text-xs font-bold uppercase tracking-widest font-mono">&#10142; {t('sign_out')}</button>
        </div>
      </nav>

      <div className="flex border-b border-[var(--color-border-heavy)] bg-[var(--color-bg-surface)] px-8 overflow-x-auto">
        {(['partners', 'users', 'sso', 'security', 'health', 'config', 'audit', 'archive'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              if (stepUpLocked && tab !== 'security') {
                return;
              }
              setActiveTab(tab);
            }}
            disabled={stepUpLocked && tab !== 'security'}
            className={`px-8 py-4 text-[10px] font-bold font-mono uppercase tracking-widest border-b-2 whitespace-nowrap ${
              effectiveTab === tab
                ? 'border-[var(--color-accent-blue)] text-[var(--color-accent-blue)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            } ${stepUpLocked && tab !== 'security' ? 'cursor-not-allowed opacity-20 hover:text-[var(--color-text-muted)]' : ''}`}
          >
            {t(`${tab}_tab`)}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto">
          {stepUpLocked && effectiveTab === 'security' && (
            <div className="mb-6 border border-[var(--color-border-heavy)] p-4 text-[10px] font-bold font-mono uppercase tracking-widest text-[var(--color-text-secondary)]">
              Platform admin tabs are locked until you complete TOTP step-up verification in the security panel.
            </div>
          )}
          {effectiveTab === 'partners' && (
            <PartnerList
              onCreateClick={() => setShowCreateModal(true)}
              onEditPartner={setEditingPartner}
              onDeletePartner={setPartnerToDelete}
            />
          )}
          {effectiveTab === 'users' && (
            <UserTable
              onInviteClick={() => setShowInviteModal(true)}
              onEditProfile={setEditingUserProfile}
              onManageAccess={setEditingUser}
            />
          )}
          {effectiveTab === 'sso' && <GroupMappingsPanel />}
          {effectiveTab === 'security' && <PlatformSecurityOps />}
          {effectiveTab === 'health' && <PlatformSystemHealth />}
          {effectiveTab === 'config' && <PlatformSystemSettings />}
          {effectiveTab === 'audit' && <PlatformAuditLog />}
          {effectiveTab === 'archive' && <PlatformArchiveViewer />}
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
