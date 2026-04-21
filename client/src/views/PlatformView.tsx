import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  Building2,
  Users,
  Mail,
  KeyRound,
  Activity,
  FileText,
  Archive,
} from 'lucide-react';

const SIDEBAR_WIDTH_KEY = 'guichet.platformSidebarWidth';
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 400;
const SIDEBAR_DEFAULT = 240;

function readInitialWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT;
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, parsed));
}

export default function PlatformView() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<PlatformTab>('partners');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [partnerToDelete, setPartnerToDelete] = useState<Partner | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [editingUser, setEditingUser] = useState<GlobalUser | null>(null);
  const [editingUserProfile, setEditingUserProfile] = useState<GlobalUser | null>(null);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readInitialWidth());
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(sidebarWidth);

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    dragStateRef.current = { startX: e.clientX, startWidth: widthRef.current };
    e.preventDefault();
  }, []);

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      const drag = dragStateRef.current;
      if (!drag) return;
      const next = drag.startWidth + (e.clientX - drag.startX);
      const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next));
      widthRef.current = clamped;
      setSidebarWidth(clamped);
    }
    function handleUp() {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current)); } catch { /* storage disabled */ }
    }
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, []);

  const NavButton = ({ id, label, icon }: { id: PlatformTab; label: string; icon: React.ReactNode }) => {
    const active = activeTab === id;
    return (
      <button
        role="tab"
        aria-selected={active}
        onClick={() => setActiveTab(id)}
        title={label}
        className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-[var(--radius-btn)] text-[13px] font-medium transition-colors ${
          active
            ? 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]'
            : 'text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
        }`}
      >
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </button>
    );
  };

  const SectionLabel = ({ children }: { children: React.ReactNode }) => (
    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] px-3 pt-4 pb-1.5 select-none">
      {children}
    </div>
  );

  return (
    <ErrorBoundary>
      <div className="h-screen flex flex-row overflow-hidden bg-[var(--color-bg)] text-[var(--color-ink)]">
        <aside
          className="relative h-full bg-[var(--color-bg-surface)] border-r border-[var(--color-border)] flex flex-col flex-shrink-0"
          style={{ width: sidebarWidth }}
        >
          <div className="px-2 pt-3 pb-2 border-b border-[var(--color-border)]">
            <UserMenuChip subtitleOverride="Platform operator" />
          </div>

          <nav role="tablist" aria-label={t('platform')} className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-3">
            <SectionLabel>Tenants</SectionLabel>
            <div className="flex flex-col gap-0.5">
              <NavButton id="partners" label={t('partners_tab')} icon={<Building2 className="h-4 w-4" />} />
              <NavButton id="users" label={t('users_tab')} icon={<Users className="h-4 w-4" />} />
              <NavButton id="invites" label={t('invites_tab')} icon={<Mail className="h-4 w-4" />} />
              <NavButton id="sso" label={t('sso_tab')} icon={<KeyRound className="h-4 w-4" />} />
            </div>

            <SectionLabel>Platform</SectionLabel>
            <div className="flex flex-col gap-0.5">
              <NavButton id="health" label={t('health_tab')} icon={<Activity className="h-4 w-4" />} />
              <NavButton id="audit" label={t('audit_tab')} icon={<FileText className="h-4 w-4" />} />
              <NavButton id="archive" label={t('archive_tab')} icon={<Archive className="h-4 w-4" />} />
            </div>
          </nav>

          <div
            onMouseDown={handleDragStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-[var(--color-accent-soft)] transition-colors"
          />
        </aside>

        <main role="tabpanel" aria-label={t(`${activeTab}_tab`)} className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-[var(--color-bg)]">
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
