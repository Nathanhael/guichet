import { useState, useEffect } from 'react';
import { Plus } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { getRoleDisplayName } from '../../utils/roles';
import Toast from '../Toast';
import ConfirmDialog from '../ConfirmDialog';
import Modal, { ModalHeader, ModalBody, ModalFooter } from '../ui/Modal';
import Button from '../ui/Button';
import Pill from '../ui/Pill';

const TH = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';
const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)]';
const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5';
const INPUT =
  'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';

export default function GroupMappingsPanel() {
  const t = useT();
  const [showAddModal, setShowAddModal] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [mappingToRemove, setMappingToRemove] = useState<string | null>(null);
  const [editingMapping, setEditingMapping] = useState<{
    id: string;
    azureGroupName: string | null;
    defaultRole: string;
    defaultDepartments: unknown;
    partnerId: string;
  } | null>(null);

  const utils = trpc.useUtils();
  const { data: mappings, isLoading } = trpc.platform.listGroupMappings.useQuery({});
  const { data: partnersList } = trpc.platform.listPartners.useQuery();
  const invalidate = () => utils.platform.listGroupMappings.invalidate();
  const removeMutation = trpc.platform.removeGroupMapping.useMutation({
    onSuccess: invalidate,
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

  const ssoPartners = partnersList?.filter(p => !p.deletedAt) || [];

  return (
    <div>
      <div className="flex justify-between items-start mb-6">
        <div>
          <h2 className="text-[17px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('sso_group_mappings')}</h2>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{t('sso_group_mappings_desc')}</p>
        </div>
        <Button
          variant="primary"
          size="md"
          leading={<Plus className="h-3.5 w-3.5" />}
          onClick={() => setShowAddModal(true)}
          disabled={ssoPartners.length === 0}
        >
          {t('add_mapping')}
        </Button>
      </div>

      {ssoPartners.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] p-10 text-center">
          <p className="text-[13px] text-[var(--color-ink-muted)]">{t('sso_no_partners')}</p>
        </div>
      )}

      {isLoading ? (
        <div className="py-8 text-center text-[13px] text-[var(--color-ink-muted)]">Loading…</div>
      ) : mappings && mappings.length > 0 ? (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]">
                  <th className={TH}>{t('partner')}</th>
                  <th className={TH}>{t('azure_group_id')}</th>
                  <th className={TH}>{t('azure_group_name')}</th>
                  <th className={TH}>{t('default_role')}</th>
                  <th className={`${TH} text-right`}>{t('actions')}</th>
                </tr>
              </thead>
              <tbody>
                {mappings.map((m) => (
                  <tr key={m.id} className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-hover)] transition-colors">
                    <td className="px-4 py-3 text-[13px] font-medium text-[var(--color-ink)]">{m.partnerName}</td>
                    <td className="px-4 py-3 text-[12px] font-mono text-[var(--color-ink-soft)] break-all">{m.azureGroupId}</td>
                    <td className="px-4 py-3 text-[13px] text-[var(--color-ink)]">
                      {m.azureGroupName || <span className="text-[var(--color-ink-muted)] italic">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <Pill tone="neutral">
                        {getRoleDisplayName(m.defaultRole as 'agent' | 'support' | 'admin')}
                      </Pill>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditingMapping({
                            id: m.id,
                            azureGroupName: m.azureGroupName,
                            defaultRole: m.defaultRole,
                            defaultDepartments: m.defaultDepartments,
                            partnerId: m.partnerId,
                          })}
                        >
                          {t('edit')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setMappingToRemove(m.id)}
                        >
                          {t('remove')}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : ssoPartners.length > 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] p-10 text-center">
          <p className="text-[13px] text-[var(--color-ink-muted)]">{t('sso_no_mappings')}</p>
        </div>
      ) : null}

      {showAddModal && (
        <AddMappingModal
          ssoPartners={ssoPartners}
          onClose={() => setShowAddModal(false)}
          onAdded={() => { setShowAddModal(false); invalidate(); }}
        />
      )}

      {editingMapping && (
        <EditMappingModal
          mapping={editingMapping}
          onClose={() => setEditingMapping(null)}
          onUpdated={() => { setEditingMapping(null); invalidate(); }}
        />
      )}
      {mappingToRemove && (
        <ConfirmDialog
          title={t('remove')}
          message={t('confirm_remove_mapping')}
          onConfirm={() => { removeMutation.mutate(mappingToRemove); setMappingToRemove(null); }}
          onCancel={() => setMappingToRemove(null)}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}

function DepartmentsPicker({
  partnerDepts,
  selectedDepts,
  setSelectedDepts,
  defaultRole,
}: {
  partnerDepts: { id: string; name: string }[];
  selectedDepts: string[];
  setSelectedDepts: (next: string[]) => void;
  defaultRole: 'agent' | 'support' | 'admin';
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className={FIELD_LABEL}>Departments</label>
        <button
          type="button"
          onClick={() => setSelectedDepts(selectedDepts.length === partnerDepts.length ? [] : partnerDepts.map(d => d.id))}
          className="text-[11px] font-medium text-[var(--color-accent)] hover:underline"
        >
          {selectedDepts.length === partnerDepts.length ? 'Deselect all' : 'Select all'}
        </button>
      </div>
      <div className="space-y-1 max-h-40 overflow-y-auto rounded-[var(--radius-btn)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-2">
        {partnerDepts.map(d => (
          <label key={d.id} className="flex items-center gap-2 text-[13px] cursor-pointer px-2 py-1 rounded-[var(--radius-btn)] hover:bg-[var(--color-hover)]">
            <input
              type="checkbox"
              checked={selectedDepts.includes(d.id)}
              onChange={(e) => {
                if (e.target.checked) setSelectedDepts([...selectedDepts, d.id]);
                else setSelectedDepts(selectedDepts.filter(id => id !== d.id));
              }}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            <span className="text-[var(--color-ink)]">{d.name}</span>
          </label>
        ))}
      </div>
      {defaultRole === 'support' && selectedDepts.length === 0 && (
        <p className="text-[11px] text-[var(--color-urgent)] mt-1">Support requires at least one department</p>
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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedDepts, setSelectedDepts] = useState<string[]>([]);
  const selectedPartner = ssoPartners.find(p => p.id === partnerId);
  const partnerDepts = (selectedPartner?.departments as { id: string; name: string }[] | undefined) || [];

  // Clear department selection when the user picks a different partner —
  // dept IDs are partner-scoped and won't apply across tenants.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedDepts([]);
  }, [partnerId]);

  const addMutation = trpc.platform.addGroupMapping.useMutation({
    onSuccess: onAdded,
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    addMutation.mutate({
      partnerId,
      azureGroupId: azureGroupId.trim(),
      azureGroupName: azureGroupName.trim() || undefined,
      defaultRole,
      defaultDepartments: defaultRole === 'support' ? selectedDepts : [],
    });
  };

  return (
    <Modal open={true} onClose={onClose} id="add-group-mapping" maxWidth={560}>
      <ModalHeader onClose={onClose} title={t('add_mapping')} />
      <form onSubmit={handleSubmit}>
        <ModalBody className="max-h-[70vh] overflow-y-auto">
          <div className="space-y-4">
            <div>
              <label className={FIELD_LABEL}>{t('partner')}</label>
              <select value={partnerId} onChange={e => setPartnerId(e.target.value)} className={INPUT}>
                {ssoPartners.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={FIELD_LABEL}>{t('azure_group_id')}</label>
              <input
                type="text"
                required
                value={azureGroupId}
                onChange={e => setAzureGroupId(e.target.value)}
                placeholder="e.g. a1b2c3d4-e5f6-7890-abcd-ef1234567890"
                className={`${INPUT} font-mono`}
              />
              <p className="text-[11px] text-[var(--color-ink-muted)] mt-1">{t('azure_group_id_hint')}</p>
            </div>
            <div>
              <label className={FIELD_LABEL}>{t('azure_group_name')}</label>
              <input
                type="text"
                value={azureGroupName}
                onChange={e => setAzureGroupName(e.target.value)}
                placeholder="e.g. BU-Telecom-Support"
                className={INPUT}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>{t('default_role')}</label>
              <select
                value={defaultRole}
                onChange={e => setDefaultRole(e.target.value as 'agent' | 'support' | 'admin')}
                className={INPUT}
              >
                <option value="agent">{getRoleDisplayName('agent')}</option>
                <option value="support">{getRoleDisplayName('support')}</option>
                <option value="admin">{getRoleDisplayName('admin')}</option>
              </select>
              {defaultRole === 'admin' && (
                <p className="text-[11px] text-[var(--color-urgent)] mt-1">{t('admin_role_warning')}</p>
              )}
            </div>
            {defaultRole === 'admin' && (
              <p className="text-[12px] text-[var(--color-ink-soft)] bg-[var(--color-bg-elevated)] rounded-[var(--radius-btn)] px-3 py-2">
                {t('admin_gets_all_departments')}
              </p>
            )}
            {defaultRole === 'support' && partnerDepts.length > 0 && (
              <DepartmentsPicker
                partnerDepts={partnerDepts}
                selectedDepts={selectedDepts}
                setSelectedDepts={setSelectedDepts}
                defaultRole={defaultRole}
              />
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={addMutation.isPending || (defaultRole === 'support' && selectedDepts.length === 0)}
          >
            {addMutation.isPending ? '…' : t('add_mapping')}
          </Button>
        </ModalFooter>
      </form>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Modal>
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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const { data: partnersList } = trpc.platform.listPartners.useQuery();
  const partner = partnersList?.find(p => p.id === mapping.partnerId);
  const partnerDepts = (partner?.departments as { id: string; name: string }[] | undefined) || [];
  const [selectedDepts, setSelectedDepts] = useState<string[]>((mapping.defaultDepartments as string[]) || []);

  const updateMutation = trpc.platform.updateGroupMapping.useMutation({
    onSuccess: onUpdated,
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

  const handleSubmit = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    updateMutation.mutate({
      id: mapping.id,
      azureGroupName: azureGroupName.trim() || undefined,
      defaultRole,
      defaultDepartments: defaultRole === 'support' ? selectedDepts : [],
    });
  };

  return (
    <Modal open={true} onClose={onClose} id="edit-group-mapping" maxWidth={560}>
      <ModalHeader onClose={onClose} title={t('edit_mapping')} />
      <form onSubmit={handleSubmit}>
        <ModalBody className="max-h-[70vh] overflow-y-auto">
          <div className="space-y-4">
            <div>
              <label className={FIELD_LABEL}>{t('azure_group_name')}</label>
              <input
                type="text"
                value={azureGroupName}
                onChange={e => setAzureGroupName(e.target.value)}
                className={INPUT}
              />
            </div>
            <div>
              <label className={FIELD_LABEL}>{t('default_role')}</label>
              <select
                value={defaultRole}
                onChange={e => setDefaultRole(e.target.value as 'agent' | 'support' | 'admin')}
                className={INPUT}
              >
                <option value="agent">{getRoleDisplayName('agent')}</option>
                <option value="support">{getRoleDisplayName('support')}</option>
                <option value="admin">{getRoleDisplayName('admin')}</option>
              </select>
              {defaultRole === 'admin' && (
                <p className="text-[11px] text-[var(--color-urgent)] mt-1">{t('admin_role_warning')}</p>
              )}
            </div>
            {defaultRole === 'admin' && (
              <p className="text-[12px] text-[var(--color-ink-soft)] bg-[var(--color-bg-elevated)] rounded-[var(--radius-btn)] px-3 py-2">
                {t('admin_gets_all_departments')}
              </p>
            )}
            {defaultRole === 'support' && partnerDepts.length > 0 && (
              <DepartmentsPicker
                partnerDepts={partnerDepts}
                selectedDepts={selectedDepts}
                setSelectedDepts={setSelectedDepts}
                defaultRole={defaultRole}
              />
            )}
          </div>
        </ModalBody>
        <ModalFooter>
          <Button type="button" variant="secondary" size="md" onClick={onClose}>{t('cancel')}</Button>
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={updateMutation.isPending || (defaultRole === 'support' && selectedDepts.length === 0)}
          >
            {updateMutation.isPending ? '…' : t('save')}
          </Button>
        </ModalFooter>
      </form>
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </Modal>
  );
}
