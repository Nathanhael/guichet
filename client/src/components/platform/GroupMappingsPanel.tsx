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

  const ssoPartners = partnersList?.filter(p => p.authMethod === 'sso' && !p.deletedAt) || [];

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest">{t('sso_group_mappings')}</h2>
          <p className="text-xs uppercase opacity-60 mt-1">{t('sso_group_mappings_desc')}</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          disabled={ssoPartners.length === 0}
          className="px-4 py-2 bg-black text-white dark:bg-white dark:text-black font-black uppercase text-xs tracking-widest hover:invert transition-all disabled:opacity-30"
        >
          {t('add_mapping')}
        </button>
      </div>

      {ssoPartners.length === 0 && (
        <div className="border-2 border-dashed border-black/20 dark:border-white/20 p-8 text-center">
          <p className="text-xs font-black uppercase tracking-widest opacity-50">{t('sso_no_partners')}</p>
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center uppercase font-black opacity-50">Loading...</div>
      ) : mappings && mappings.length > 0 ? (
        <div className="border border-black dark:border-white overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('partner')}</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('azure_group_id')}</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('azure_group_name')}</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('default_role')}</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest text-right">{t('actions')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20 dark:divide-white/20">
              {mappings.map((m) => (
                <tr key={m.id} className="hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                  <td className="p-3 text-sm font-bold uppercase">{m.partnerName}</td>
                  <td className="p-3 text-sm font-mono opacity-80 break-all">{m.azureGroupId}</td>
                  <td className="p-3 text-sm">{m.azureGroupName || <span className="opacity-30 italic">—</span>}</td>
                  <td className="p-3 text-sm">
                    <span className="px-2 py-0.5 border border-current text-[10px] font-black uppercase">
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
                      className="text-[10px] font-black uppercase tracking-widest hover:underline"
                    >
                      {t('edit')}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(t('confirm_remove_mapping'))) {
                          removeMutation.mutate(m.id);
                        }
                      }}
                      className="text-[10px] font-black uppercase tracking-widest text-red-600 hover:line-through"
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
        <div className="border-2 border-dashed border-black/20 dark:border-white/20 p-8 text-center">
          <p className="text-xs font-black uppercase tracking-widest opacity-50">{t('sso_no_mappings')}</p>
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
      <div className="absolute inset-0 bg-black opacity-80" onClick={onClose} />
      <div className="bg-white dark:bg-black border-2 border-black dark:border-white p-6 w-[520px] relative z-10">
        <h3 className="text-xl font-black uppercase tracking-tighter mb-4">{t('add_mapping')}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">{t('partner')}</label>
            <select
              value={partnerId}
              onChange={e => setPartnerId(e.target.value)}
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm uppercase font-bold"
            >
              {ssoPartners.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">{t('azure_group_id')}</label>
            <input
              type="text"
              required
              value={azureGroupId}
              onChange={e => setAzureGroupId(e.target.value)}
              placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890"
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-mono"
            />
            <p className="text-[9px] uppercase opacity-50 mt-1">{t('azure_group_id_hint')}</p>
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">{t('azure_group_name')}</label>
            <input
              type="text"
              value={azureGroupName}
              onChange={e => setAzureGroupName(e.target.value)}
              placeholder="e.g. BU-Telecom-Support"
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">{t('default_role')}</label>
            <select
              value={defaultRole}
              onChange={e => setDefaultRole(e.target.value as 'agent' | 'support' | 'admin')}
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm uppercase font-bold"
            >
              <option value="agent">{getRoleDisplayName('agent')}</option>
              <option value="support">{getRoleDisplayName('support')}</option>
              <option value="admin">{getRoleDisplayName('admin')}</option>
            </select>
            {defaultRole === 'admin' && (
              <p className="text-[9px] uppercase text-red-600 font-bold mt-1">{t('admin_role_warning')}</p>
            )}
          </div>
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="flex-1 py-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:bg-black/5">
              {t('cancel')}
            </button>
            <button type="submit" disabled={addMutation.isPending} className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:invert">
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
      <div className="absolute inset-0 bg-black opacity-80" onClick={onClose} />
      <div className="bg-white dark:bg-black border-2 border-black dark:border-white p-6 w-[520px] relative z-10">
        <h3 className="text-xl font-black uppercase tracking-tighter mb-4">{t('edit_mapping')}</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">{t('azure_group_name')}</label>
            <input
              type="text"
              value={azureGroupName}
              onChange={e => setAzureGroupName(e.target.value)}
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">{t('default_role')}</label>
            <select
              value={defaultRole}
              onChange={e => setDefaultRole(e.target.value as 'agent' | 'support' | 'admin')}
              className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm uppercase font-bold"
            >
              <option value="agent">{getRoleDisplayName('agent')}</option>
              <option value="support">{getRoleDisplayName('support')}</option>
              <option value="admin">{getRoleDisplayName('admin')}</option>
            </select>
            {defaultRole === 'admin' && (
              <p className="text-[9px] uppercase text-red-600 font-bold mt-1">{t('admin_role_warning')}</p>
            )}
          </div>
          <div className="flex gap-4 pt-4">
            <button type="button" onClick={onClose} className="flex-1 py-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:bg-black/5">
              {t('cancel')}
            </button>
            <button type="submit" disabled={updateMutation.isPending} className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:invert">
              {updateMutation.isPending ? '...' : t('save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
