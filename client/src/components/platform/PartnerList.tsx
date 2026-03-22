import { useState, useCallback } from 'react';
import useStore from '../../store/useStore';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import ConfirmDialog from '../ConfirmDialog';
import Toast from '../Toast';
import type { Partner } from './types';

interface PartnerListProps {
  onCreateClick: () => void;
  onEditPartner: (partner: Partner) => void;
  onDeletePartner: (partner: Partner) => void;
}

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
      <div className="flex justify-between items-end mb-8 border-b-4 border-black dark:border-white pb-4">
        <div>
          <h1 className="text-4xl font-black uppercase tracking-tighter">{t('partner_ecosystem')}</h1>
          <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">{t('manage_tenants_desc')}</p>
        </div>
        <button onClick={onCreateClick} className="bg-black dark:bg-white text-white dark:text-black px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-white hover:text-black dark:hover:bg-black dark:hover:text-white">{t('create_new_partner')}</button>
      </div>

      {activePartnersList.length > 0 && (
        <div className="mb-12">
          <h2 className="text-lg font-black uppercase tracking-widest mb-4">{t('active_partners')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {activePartnersList.map((p) => (
              <div key={p.id} className="border-2 border-black dark:border-white p-6 bg-white dark:bg-black flex flex-col justify-between">
                <div className="flex justify-between items-start mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 border-4 border-black dark:border-white flex items-center justify-center overflow-hidden bg-black/5 dark:bg-white/5 shrink-0">
                      {p.logoUrl ? <img src={p.logoUrl} alt={p.name} className="w-full h-full object-contain" /> : <span className="text-2xl font-black">{p.name.charAt(0)}</span>}
                    </div>
                    <div>
                      <h2 className="text-xl font-black uppercase tracking-tight line-clamp-1" title={p.name}>{p.name}</h2>
                      <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">{p.industry}</p>
                    </div>
                  </div>
                  <div className="text-right"><p className="text-[8px] font-black uppercase opacity-40">{t('id_label')}: {p.id}</p></div>
                </div>
                <div className="flex flex-wrap gap-2 mt-auto">
                  <button onClick={() => onEditPartner(p)} className="flex-1 min-w-[80px] py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black">{t('configure')}</button>
                  <button onClick={async () => { try { await useStore.getState().enterPartnerAsOperator(p.id); } catch (err: unknown) { showError(err instanceof Error ? err.message : 'Failed to enter partner'); } }} className="flex-1 min-w-[80px] py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert">{t('enter')}</button>
                  <button onClick={() => setConfirmDialog({ title: t('deactivate'), message: t('confirm_deactivate_partner').replace('{name}', p.name), confirmLabel: t('deactivate'), onConfirm: () => { deactivatePartner.mutate({ partnerId: p.id }); setConfirmDialog(null); } })} className="flex-none px-4 py-2 text-[10px] font-black uppercase tracking-widest opacity-50 hover:opacity-100 border-2 border-black dark:border-white">{t('deactivate')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {inactivePartnersList.length > 0 && (
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest mb-4 opacity-50">{t('inactive_partners')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 opacity-60">
            {inactivePartnersList.map((p) => (
              <div key={p.id} className="border-2 border-dashed border-black dark:border-white p-6 bg-black/5 dark:bg-white/5 flex flex-col justify-between">
                <div className="flex justify-between items-start mb-6">
                  <div className="flex items-center gap-4">
                    <div className="w-14 h-14 border-4 border-black dark:border-white flex items-center justify-center overflow-hidden bg-black/10 dark:bg-white/10 shrink-0 grayscale">
                      {p.logoUrl ? <img src={p.logoUrl} alt={p.name} className="w-full h-full object-contain" /> : <span className="text-2xl font-black">{p.name.charAt(0)}</span>}
                    </div>
                    <div>
                      <h2 className="text-xl font-black uppercase tracking-tight line-through line-clamp-1" title={p.name}>{p.name}</h2>
                      <span className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-1">{t('inactive_status')}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 mt-auto">
                  <button onClick={() => reactivatePartner.mutate({ partnerId: p.id })} className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert">{t('reactivate')}</button>
                  <button onClick={() => onDeletePartner(p)} className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:invert">{t('delete_permanently')}</button>
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
