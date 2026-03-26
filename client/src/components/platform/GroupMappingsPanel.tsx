import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { getRoleDisplayName } from '../../utils/roles';

export default function GroupMappingsPanel() {
  const t = useT();
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingMapping, setEditingMapping] = useState<{
    id: string;
    azureGroupName: string | null;
    defaultRole: string;
    defaultDepartments: unknown;
    partnerId: string;
  } | null>(null);

  const { data: mappings, refetch, isLoading } = trpc.platform.listGroupMappings.useQuery({});
  const { data: partnersList } = trpc.platform.listPartners.useQuery();
  const removeMutation = trpc.platform.removeGroupMapping.useMutation({
    onSuccess: () => refetch(),
    onError: (err) => alert(err.message),
  });

  const ssoPartners = partnersList?.filter(p => (p.authMethod === 'sso' || p.authMethod === 'both') && !p.deletedAt) || [];

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-widest font-mono">{t('sso_group_mappings')}</h2>
          <p className="text-xs uppercase text-[var(--color-text-muted)] mt-1">{t('sso_group_mappings_desc')}</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          disabled={ssoPartners.length === 0}
          className="btn-primary px-4 py-2 uppercase text-xs tracking-widest disabled:opacity-30"
        >
          {t('add_mapping')}
        </button>
      </div>

      {ssoPartners.length === 0 && (
        <div className="border border-dashed border-[var(--color-border)] p-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-faint)]">{t('sso_no_partners')}</p>
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center uppercase font-bold text-[var(--color-text-muted)] font-mono">Loading...</div>
      ) : mappings && mappings.length > 0 ? (
        <div className="border border-[var(--color-border)] overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]">
                <th className="p-3 text-[10px] font-bold uppercase tracking-widest font-mono text-[var(--color-text-muted)] border-r border-[var(--color-border)]">{t('partner')}</th>
                <th className="p-3 text-[10px] font-bold uppercase tracking-widest font-mono text-[var(--color-text-muted)] border-r border-[var(--color-border)]">{t('azure_group_id')}</th>
                <th className="p-3 text-[10px] font-bold uppercase tracking-widest font-mono text-[var(--color-text-muted)] border-r border-[var(--color-border)]">{t('azure_group_name')}</th>
                <th className="p-3 text-[10px] font-bold uppercase tracking-widest font-mono text-[var(--color-text-muted)] border-r border-[var(--color-border)]">{t('default_role')}</th>
                <th className="p-3 text-[10px] font-bold uppercase tracking-widest font-mono text-[var(--color-text-muted)] text-right">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {mappings.map((m) => (
                <tr key={m.id} className="hover:bg-[var(--color-bg-elevated)]">
                  <td className="p-3 text-sm font-bold uppercase border-r border-[var(--color-border)]">{m.partnerName}</td>
                  <td className="p-3 text-sm font-mono text-[var(--color-text-secondary)] break-all border-r border-[var(--color-border)]">{m.azureGroupId}</td>
                  <td className="p-3 text-sm border-r border-[var(--color-border)]">{m.azureGroupName || <span className="text-[var(--color-text-faint)] italic">—</span>}</td>
                  <td className="p-3 text-sm border-r border-[var(--color-border)]">
                    <span className="badge border border-[var(--color-border)] text-[var(--color-text-secondary)]">
                      {getRoleDisplayName(m.defaultRole as 'agent' | 'support' | 'admin')}
                    </span>
                  </td>
                  <td className="p-3 text-right space-x-3">
                    <button
                      onClick={() => setEditingMapping({
                        id: m.id,
                        azureGroupName: m.azureGroupName,
                        defaultRole: m.defaultRole,
                        defaultDepartments: m.defaultDepartments,
                        partnerId: m.partnerId,
                      })}
                      className="text-[10px] font-bold uppercase tracking-widest hover:underline font-mono text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                    >
                      {t('edit')}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(t('confirm_remove_mapping'))) {
                          removeMutation.mutate(m.id);
                        }
                      }}
                      className="text-[10px] font-bold uppercase tracking-widest font-mono text-[var(--color-accent-red)] hover:line-through"
                    >
                      {t('remove')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : ssoPartners.length > 0 ? (
        <div className="border border-dashed border-[var(--color-border)] p-8 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-[var(--color-text-faint)]">{t('sso_no_mappings')}</p>
        </div>
      ) : null}

      {showAddModal && (
        <AddMappingModal
          ssoPartners={ssoPartners}
          onClose={() => setShowAddModal(false)}
          onAdded={() => { setShowAddModal(false); refetch(); }}
        />
      )}

      {editingMapping && (
        <EditMappingModal
          mapping={editingMapping}
          onClose={() => setEditingMapping(null)}
          onUpdated={() => { setEditingMapping(null); refetch(); }}
        />
      )}
    </div>
  );
}

function AddMappingModal({ ssoPartners, onClose, onAdded }: {
  ssoPartners: { id: string; name: string; departments?: unknown }[];
  onClose: () => void;
  onAdded: () => void;
}) {
  const t = useT();
  const [partnerId, setPartnerId] = useState(ssoPartners[0]?.id || '');
  const [azureGroupId, setAzureGroupId] = useState('');
  const [azureGroupName, setAzureGroupName] = useState('');
  const [defaultRole, setDefaultRole] = useState<'agent' | 'support' | 'admin'>('agent');

  const addMutation = trpc.platform.addGroupMapping.useMutation({
    onSuccess: onAdded,
    onError: (err) => alert(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    addMutation.mutate({
      partnerId,
      azureGroupId: azureGroupId.trim(),
      azureGroupName: azureGroupName.trim() || undefined,
      defaultRole,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} aria-label="Close" />
      <div role="dialog" className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] p-6 w-[520px] relative z-10">
        <h3 className="text-xl font-bold uppercase tracking-wide font-mono mb-4">{t('add_mapping')}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mono-label">{t('partner')}</label>
            <select
              value={partnerId}
              onChange={e => setPartnerId(e.target.value)}
              className="input-field w-full uppercase font-bold"
            >
              {ssoPartners.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mono-label">{t('azure_group_id')}</label>
            <input
              type="text"
              required
              value={azureGroupId}
              onChange={e => setAzureGroupId(e.target.value)}
              placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890"
              className="input-field w-full font-mono"
            />
            <p className="text-[9px] uppercase text-[var(--color-text-muted)] mt-1">{t('azure_group_id_hint')}</p>
          </div>
          <div>
            <label className="mono-label">{t('azure_group_name')}</label>
            <input
              type="text"
              value={azureGroupName}
              onChange={e => setAzureGroupName(e.target.value)}
              placeholder="e.g. BU-Telecom-Support"
              className="input-field w-full"
            />
          </div>
          <div>
            <label className="mono-label">{t('default_role')}</label>
            <select
              value={defaultRole}
              onChange={e => setDefaultRole(e.target.value as 'agent' | 'support' | 'admin')}
              className="input-field w-full uppercase font-bold"
            >
              <option value="agent">{getRoleDisplayName('agent')}</option>
              <option value="support">{getRoleDisplayName('support')}</option>
              <option value="admin">{getRoleDisplayName('admin')}</option>
            </select>
            {defaultRole === 'admin' && (
              <p className="text-[9px] uppercase font-bold mt-1 text-[var(--color-accent-red)]">{t('admin_role_warning')}</p>
            )}
          </div>
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 py-3 uppercase text-[10px] tracking-widest">
              {t('cancel')}
            </button>
            <button type="submit" disabled={addMutation.isPending} className="btn-primary flex-1 py-3 uppercase text-[10px] tracking-widest disabled:opacity-30">
              {addMutation.isPending ? '...' : t('add_mapping')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditMappingModal({ mapping, onClose, onUpdated }: {
  mapping: { id: string; azureGroupName: string | null; defaultRole: string; defaultDepartments: unknown; partnerId: string };
  onClose: () => void;
  onUpdated: () => void;
}) {
  const t = useT();
  const [azureGroupName, setAzureGroupName] = useState(mapping.azureGroupName || '');
  const [defaultRole, setDefaultRole] = useState<'agent' | 'support' | 'admin'>(mapping.defaultRole as 'agent' | 'support' | 'admin');

  const updateMutation = trpc.platform.updateGroupMapping.useMutation({
    onSuccess: onUpdated,
    onError: (err) => alert(err.message),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    updateMutation.mutate({
      id: mapping.id,
      azureGroupName: azureGroupName.trim() || undefined,
      defaultRole,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} aria-label="Close" />
      <div role="dialog" className="bg-[var(--color-bg-surface)] border border-[var(--color-border)] p-6 w-[520px] relative z-10">
        <h3 className="text-xl font-bold uppercase tracking-wide font-mono mb-4">{t('edit_mapping')}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mono-label">{t('azure_group_name')}</label>
            <input
              type="text"
              value={azureGroupName}
              onChange={e => setAzureGroupName(e.target.value)}
              className="input-field w-full"
            />
          </div>
          <div>
            <label className="mono-label">{t('default_role')}</label>
            <select
              value={defaultRole}
              onChange={e => setDefaultRole(e.target.value as 'agent' | 'support' | 'admin')}
              className="input-field w-full uppercase font-bold"
            >
              <option value="agent">{getRoleDisplayName('agent')}</option>
              <option value="support">{getRoleDisplayName('support')}</option>
              <option value="admin">{getRoleDisplayName('admin')}</option>
            </select>
            {defaultRole === 'admin' && (
              <p className="text-[9px] uppercase font-bold mt-1 text-[var(--color-accent-red)]">{t('admin_role_warning')}</p>
            )}
          </div>
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 py-3 uppercase text-[10px] tracking-widest">
              {t('cancel')}
            </button>
            <button type="submit" disabled={updateMutation.isPending} className="btn-primary flex-1 py-3 uppercase text-[10px] tracking-widest disabled:opacity-30">
              {updateMutation.isPending ? '...' : t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
