import { useState, useCallback } from 'react';
import { Plus, LogIn, Pause, Play, Trash2, Settings } from 'lucide-react';
import useStore from '../../store/useStore';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog';
import Toast from '../Toast';
import Button from '../ui/Button';
import Pill from '../ui/Pill';
import Avatar from '../ui/Avatar';
import type { Partner } from './types';

interface PartnerListProps {
  onCreateClick: () => void;
  onEditPartner: (partner: Partner) => void;
  onDeletePartner: (partner: Partner) => void;
}

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)]';
const SECTION_LABEL = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]';

export default function PartnerList({ onCreateClick, onEditPartner, onDeletePartner }: PartnerListProps) {
  const t = useT();
  const utils = trpc.useUtils();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel?: string; onConfirm: () => void } | null>(null);
  const showError = useCallback((message: string) => setToast({ message, type: 'error' }), []);

  const { data: partners } = trpc.platform.listPartners.useQuery();

  const deactivatePartner = trpc.platform.deactivatePartner.useMutation({
    onSuccess: () => utils.platform.listPartners.invalidate(),
  });
  const reactivatePartner = trpc.platform.reactivatePartner.useMutation({
    onSuccess: () => utils.platform.listPartners.invalidate(),
  });

  const activePartnersList = (partners || []).filter(p => p.status === 'active' && !p.deletedAt);
  const inactivePartnersList = (partners || []).filter(p => p.status === 'inactive' && !p.deletedAt);

  return (
    <>
      <div className="flex justify-between items-end mb-8 pb-4 border-b border-[var(--color-border)]">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('partner_ecosystem')}</h1>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{t('manage_tenants_desc')}</p>
        </div>
        <Button variant="primary" size="md" leading={<Plus className="h-3.5 w-3.5" />} onClick={onCreateClick}>
          {t('create_new_partner')}
        </Button>
      </div>

      {activePartnersList.length > 0 && (
        <div className="mb-12">
          <h2 className={`${SECTION_LABEL} mb-4`}>{t('active_partners')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activePartnersList.map((p) => (
              <div key={p.id} className={`${CARD} p-5 flex flex-col justify-between`}>
                <div className="flex justify-between items-start mb-5 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={p.name} size={44} />
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold tracking-[-0.1px] text-[var(--color-ink)] line-clamp-1" title={p.name}>{p.name}</h3>
                      <p className="text-[12px] text-[var(--color-ink-muted)] mt-0.5">{p.industry}</p>
                    </div>
                  </div>
                  <p className="text-[11px] font-mono text-[var(--color-ink-muted)] shrink-0">{t('id_label')}: {p.id}</p>
                </div>
                <div className="flex flex-wrap gap-2 mt-auto">
                  <Button
                    variant="secondary"
                    size="sm"
                    leading={<Settings className="h-3.5 w-3.5" />}
                    className="flex-1 min-w-[90px]"
                    onClick={() => onEditPartner(p)}
                  >
                    {t('configure')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    leading={<LogIn className="h-3.5 w-3.5" />}
                    className="flex-1 min-w-[90px]"
                    onClick={async () => { try { await useStore.getState().enterPartnerAsOperator(p.id); } catch (err: unknown) { showError(err instanceof Error ? err.message : 'Failed to enter partner'); } }}
                  >
                    {t('enter')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    leading={<Pause className="h-3.5 w-3.5" />}
                    onClick={() => setConfirmDialog({ title: t('deactivate'), message: t('confirm_deactivate_partner').replace('{name}', p.name), confirmLabel: t('deactivate'), onConfirm: () => { deactivatePartner.mutate({ partnerId: p.id }); setConfirmDialog(null); } })}
                  >
                    {t('deactivate')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {inactivePartnersList.length > 0 && (
        <div>
          <h2 className={`${SECTION_LABEL} mb-4`}>{t('inactive_partners')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {inactivePartnersList.map((p) => (
              <div key={p.id} className={`rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] border border-dashed border-[var(--color-border-strong)] p-5 flex flex-col justify-between`}>
                <div className="flex justify-between items-start mb-5 gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={p.name} size={44} className="grayscale opacity-70" />
                    <div className="min-w-0">
                      <h3 className="text-[15px] font-semibold tracking-[-0.1px] text-[var(--color-ink-soft)] line-through line-clamp-1" title={p.name}>{p.name}</h3>
                      <div className="mt-1">
                        <Pill tone="urgent">{t('inactive_status')}</Pill>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-auto">
                  <Button
                    variant="primary"
                    size="sm"
                    leading={<Play className="h-3.5 w-3.5" />}
                    className="flex-1"
                    onClick={() => reactivatePartner.mutate({ partnerId: p.id })}
                  >
                    {t('reactivate')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    leading={<Trash2 className="h-3.5 w-3.5" />}
                    className="flex-1"
                    onClick={() => onDeletePartner(p)}
                  >
                    {t('delete_permanently')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          onConfirm={confirmDialog.onConfirm}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </>
  );
}
