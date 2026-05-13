import React, { useState } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useT } from '../i18n';
import { useResizableSidebar } from '../hooks/useResizableSidebar';
import PlatformSystemHealth from '../components/admin/PlatformSystemHealth';
import PlatformAuditLog from '../components/admin/PlatformAuditLog';
import UserMenuChip from '../components/ui/UserMenuChip';
import { NavButton, NavGroupLabel } from '../components/ui/SidebarNav';
import PartnerList from '../components/platform/PartnerList';
import UserTable from '../components/platform/UserTable';
import CreatePartnerModal from '../components/platform/CreatePartnerModal';
import EditPartnerModal from '../components/platform/EditPartnerModal';
import DeletePartnerModal from '../components/platform/DeletePartnerModal';
import GroupMappingsPanel from '../components/platform/GroupMappingsPanel';
import PlatformArchiveViewer from '../components/admin/PlatformArchiveViewer';
import PlatformSecurity from '../components/platform/PlatformSecurity';
import type { PlatformTab, Partner } from '../components/platform/types';
import {
  Building2,
  Users,
  KeyRound,
  Activity,
  FileText,
  Archive,
  ShieldCheck,
} from 'lucide-react';

export default function PlatformView() {
  const t = useT();
  const [activeTab, setActiveTab] = useState<PlatformTab>('partners');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [partnerToDelete, setPartnerToDelete] = useState<Partner | null>(null);

  const { width: sidebarWidth, onDragStart: handleDragStart } = useResizableSidebar({
    storageKey: 'guichet.platformSidebarWidth',
    defaultWidth: 240,
    min: 200,
    max: 400,
  });

  const navItem = (id: PlatformTab, label: string, icon: React.ReactNode) => (
    <NavButton
      key={id}
      role="tab"
      active={activeTab === id}
      onClick={() => setActiveTab(id)}
      label={label}
      icon={icon}
    />
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
            <NavGroupLabel>Tenants</NavGroupLabel>
            <div className="flex flex-col gap-0.5">
              {navItem('partners', t('partners_tab'), <Building2 className="h-4 w-4" />)}
              {navItem('users', t('users_tab'), <Users className="h-4 w-4" />)}
              {navItem('sso', t('sso_tab'), <KeyRound className="h-4 w-4" />)}
            </div>

            <NavGroupLabel>Platform</NavGroupLabel>
            <div className="flex flex-col gap-0.5">
              {navItem('ai-security', t('platform_tab_ai_security'), <ShieldCheck className="h-4 w-4" />)}
              {navItem('health', t('health_tab'), <Activity className="h-4 w-4" />)}
              {navItem('audit', t('audit_tab'), <FileText className="h-4 w-4" />)}
              {navItem('archive', t('archive_tab'), <Archive className="h-4 w-4" />)}
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
            {activeTab === 'users' && <UserTable />}
            {activeTab === 'sso' && <GroupMappingsPanel />}
            {activeTab === 'ai-security' && <PlatformSecurity />}
            {activeTab === 'health' && <PlatformSystemHealth />}
            {activeTab === 'audit' && <PlatformAuditLog />}
            {activeTab === 'archive' && <PlatformArchiveViewer />}
          </div>
        </main>

        <CreatePartnerModal open={showCreateModal} onClose={() => setShowCreateModal(false)} />
        <EditPartnerModal partner={editingPartner} onClose={() => setEditingPartner(null)} />
        <DeletePartnerModal partner={partnerToDelete} onClose={() => setPartnerToDelete(null)} />
      </div>
    </ErrorBoundary>
  );
}
