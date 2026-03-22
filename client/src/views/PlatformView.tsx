import { useState } from 'react';
import useStore from '../store/useStore';
import { trpc } from '../utils/trpc';
import DarkModeToggle from '../components/DarkModeToggle';
import { useT } from '../i18n';
import PlatformSystemHealth from '../components/admin/PlatformSystemHealth';
import PlatformAuditLog from '../components/admin/PlatformAuditLog';
import PlatformSystemSettings from '../components/admin/PlatformSystemSettings';
import LanguageSwitcher from '../components/LanguageSwitcher';

type PlatformTab = 'partners' | 'users' | 'health' | 'config' | 'audit';
type UserRole = 'agent' | 'support' | 'admin' | 'platform_operator';

interface PartnerMembership {
  id: string;
  partnerId: string;
  partnerName: string;
  role: string;
}

interface Partner {
  id: string;
  name: string;
  logoUrl: string | null;
  industry: string | null;
  status: string;
  authMethod: 'local' | 'sso';
  departments?: unknown;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  ref1Label?: string | null;
  ref2Label?: string | null;
  businessHoursStart?: string | null;
  businessHoursEnd?: string | null;
  slaConfig?: unknown;
  [key: string]: unknown;
}

interface GlobalUser {
  id: string;
  name: string;
  email: string | null;
  isPlatformOperator?: boolean | null;
  deletedAt?: string | null;
  lastActiveAt?: string | null;
  externalId?: string | null;
  password?: string | null;
  lang?: string | null;
  createdAt?: string;
  updatedAt?: string;
  partnerMemberships?: PartnerMembership[];
  [key: string]: unknown;
}

export default function PlatformView() {
  const { logout } = useStore();
  const t = useT();
  const [activeTab, setActiveTab] = useState<PlatformTab>('partners');
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);

  const [createForm, setCreateForm] = useState({ id: '', name: '', logoUrl: '', industry: '', authMethod: 'local' as 'local' | 'sso' });

  const [inviteForm, setInviteForm] = useState<{
    email: string;
    name: string;
    role: UserRole;
    partnerId: string;
    dept: string;
  }>({
    email: '',
    name: '',
    role: 'support',
    partnerId: '',
    dept: ''
  });

  const [partnerDeleteConfirmation, setPartnerDeleteConfirmation] = useState('');
  const [partnerToDelete, setPartnerToDelete] = useState<Partner | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('all');
  const [editingUser, setEditingUser] = useState<GlobalUser | null>(null);
  const [editingUserProfile, setEditingUserProfile] = useState<GlobalUser | null>(null);
  const [inviteError, setInviteError] = useState<string>('');
  const [inviteResult, setInviteResult] = useState<{ tempPassword: string | null; isExistingUser: boolean; partnerName: string } | null>(null);

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const ROLE_LABEL: Record<string, string> = { 
    agent: t('agent'),
    support: t('support'),
    admin: t('admin'),
    platform_operator: t('platform_operator')
  };

  async function handleLogoUpload(file: File, isEdit = false) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await fetch('/api/v1/logos', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${useStore.getState().token}` },
        body: formData
      });
      const data = await res.json();
      if (data.url) {
        if (isEdit) setEditingPartner((prev) => prev ? { ...prev, logoUrl: data.url } : null);
        else setCreateForm(prev => ({ ...prev, logoUrl: data.url }));
      } else {
        alert(data.error || t('request_failed'));
      }
    } catch (err) {
      console.error(err);
      alert(t('network_error'));
    }
  }

  const { data: partners, refetch: refetchPartners } = trpc.platform.listPartners.useQuery();
  const { data: globalUsers, refetch: refetchUsers } = trpc.platform.listGlobalUsers.useQuery();
  const utils = trpc.useUtils();

  const createPartner = trpc.platform.createPartner.useMutation({
    onSuccess: () => {
      setShowCreateModal(false);
      setCreateForm({ id: '', name: '', industry: '', logoUrl: '', authMethod: 'local' as 'local' | 'sso' });
      refetchPartners();
    },
    onError: (err) => alert(err.message)
  });

  const updatePartner = trpc.platform.updatePartner.useMutation({
    onSuccess: () => { setEditingPartner(null); refetchPartners(); }
  });

  const deactivatePartner = trpc.platform.deactivatePartner.useMutation({ onSuccess: () => refetchPartners() });
  const reactivatePartner = trpc.platform.reactivatePartner.useMutation({ onSuccess: () => refetchPartners() });
  const deletePartner = trpc.platform.deletePartner.useMutation({ onSuccess: () => refetchPartners() });

  const resendInvite = trpc.platform.resendInvite.useMutation({
    onSuccess: () => alert(t('invite_resent_success')),
    onError: (err) => alert(`${t('invite_resent_error')}: ${err.message}`)
  });

  const inviteUser = trpc.platform.inviteUser.useMutation({
    onSuccess: async (data) => {
      setInviteError('');
      const currentPartners = utils.platform.listPartners.getData();
      const partnerName = currentPartners?.find(p => p.id === inviteForm.partnerId)?.name || inviteForm.partnerId;
      setInviteResult({ tempPassword: data.tempPassword, isExistingUser: data.isExistingUser, partnerName });
      if (!editingUser) {
        setShowInviteModal(false);
        setInviteForm({ email: '', name: '', role: 'support', partnerId: '', dept: '' });
      }
      const { data: freshUsers } = await refetchUsers();
      if (editingUser && freshUsers) {
        const updatedUser = freshUsers.find(u => u.id === editingUser.id);
        if (updatedUser) setEditingUser(updatedUser);
      }
    },
    onError: (err) => {
      const msg = err.message;
      if (msg.includes('email') || msg.includes('Email') || msg.includes('invalid_string')) {
        setInviteError(t('invalid_email_error'));
      } else if (msg.includes('CONFLICT') || msg.includes('already')) {
        setInviteError(t('email_already_exists_error'));
      } else {
        setInviteError(msg || t('general_error'));
      }
    }
  });

  const deleteUser = trpc.platform.deleteUser.useMutation({ onSuccess: () => refetchUsers() });
  const removeMembership = trpc.platform.removeMembership.useMutation({ 
    onSuccess: async () => {
      const { data: freshUsers } = await refetchUsers();
      if (editingUser && freshUsers) {
        const updatedUser = freshUsers.find(u => u.id === editingUser.id);
        if (updatedUser) setEditingUser(updatedUser);
        else setEditingUser(null);
      }
    } 
  });

  const updateMembership = trpc.platform.updateMembership.useMutation({
    onSuccess: async () => {
      const { data: freshUsers } = await refetchUsers();
      if (editingUser && freshUsers) {
        const updatedUser = freshUsers.find(u => u.id === editingUser.id);
        if (updatedUser) setEditingUser(updatedUser);
      }
    }
  });

  const updateUser = trpc.platform.updateUser.useMutation({
    onSuccess: () => { setEditingUserProfile(null); refetchUsers(); }
  });

  const activePartnersList = (partners || []).filter(p => p.status === 'active' && !p.deletedAt);
  const inactivePartnersList = (partners || []).filter(p => p.status === 'inactive' && !p.deletedAt);

  const filteredUsers = (globalUsers || []).filter(u => {
    if (u.deletedAt) return false;
    const search = userSearch.toLowerCase();
    const matchesSearch = u.name.toLowerCase().includes(search) || (u.email || '').toLowerCase().includes(search);
    const matchesPartner = selectedPartnerId === 'all' || u.partnerMemberships?.some((m) => m.partnerId === selectedPartnerId);
    return matchesSearch && matchesPartner;
  });

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
          <button onClick={logout} className="text-black dark:text-white hover:line-through text-xs font-black uppercase tracking-widest">➔ {t('sign_out')}</button>
        </div>
      </nav>

      <div className="flex border-b-2 border-black dark:border-white bg-white dark:bg-black px-8 overflow-x-auto">
        {(['partners', 'users', 'health', 'config', 'audit'] as const).map((tab) => (
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
            <>
              <div className="flex justify-between items-end mb-8 border-b-4 border-black dark:border-white pb-4">
                <div>
                  <h1 className="text-4xl font-black uppercase tracking-tighter">{t('partner_ecosystem')}</h1>
                  <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">{t('manage_tenants_desc')}</p>
                </div>
                <button onClick={() => setShowCreateModal(true)} className="bg-black dark:bg-white text-white dark:text-black px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-white hover:text-black dark:hover:bg-black dark:hover:text-white">{t('create_new_partner')}</button>
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
                          <button onClick={() => setEditingPartner(p)} className="flex-1 min-w-[80px] py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black">{t('configure')}</button>
                          <button onClick={async () => { try { await useStore.getState().enterPartnerAsOperator(p.id); } catch (err: unknown) { alert(err instanceof Error ? err.message : 'Failed to enter partner'); } }} className="flex-1 min-w-[80px] py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert">{t('enter')}</button>
                          <button onClick={() => { if(confirm(t('confirm_deactivate_partner').replace('{name}', p.name))) deactivatePartner.mutate({ partnerId: p.id }); }} className="flex-none px-4 py-2 text-[10px] font-black uppercase tracking-widest opacity-50 hover:opacity-100 border-2 border-black dark:border-white">{t('deactivate')}</button>
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
                          <button onClick={() => setPartnerToDelete(p)} className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:invert">{t('delete_permanently')}</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
          
          {activeTab === 'users' && (
            <>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8 border-b-4 border-black dark:border-white pb-6">
                <div className="flex-1">
                  <h1 className="text-4xl font-black uppercase tracking-tighter">{t('global_users')}</h1>
                  <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">{t('manage_identities_desc')}</p>
                  <div className="mt-6 flex flex-col sm:flex-row gap-4 max-w-2xl relative">
                    <div className="flex-1 relative">
                      <input type="text" placeholder={t('search_users_placeholder')} className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-4 py-2.5 text-sm font-bold outline-none focus:bg-transparent" value={userSearch} onChange={(e) => setUserSearch(e.target.value)} />
                      {userSearch && <button onClick={() => setUserSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase opacity-40 hover:opacity-100">{t('clear')}</button>}
                    </div>
                    <select className="bg-white dark:bg-black border-2 border-black dark:border-white px-4 py-2.5 text-sm font-black uppercase tracking-widest outline-none" value={selectedPartnerId} onChange={(e) => setSelectedPartnerId(e.target.value)}>
                      <option value="all">{t('all_partners')}</option>
                      {partners?.filter(p => !p.deletedAt).map(p => <option key={p.id} value={p.id}>{p.status === 'inactive' ? `[${t('inactive_status')}] ${p.name}` : p.name}</option>)}
                    </select>
                  </div>
                </div>
                <button onClick={() => setShowInviteModal(true)} className="bg-black dark:bg-white text-white dark:text-black px-8 py-3 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:invert shrink-0">{t('invite_new_user')}</button>
              </div>

              <div className="border-2 border-black dark:border-white overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-widest">
                        <th className="p-4 border-r border-white/20">{t('col_name')}</th>
                        <th className="p-4 border-r border-white/20">{t('email_identity')}</th>
                        <th className="p-4 border-r border-white/20">{t('col_status')}</th>
                        <th className="p-4 border-r border-white/20">{t('last_active')}</th>
                        <th className="p-4 border-r border-white/20">{t('col_access_scope')}</th>
                        <th className="p-4 text-right">{t('col_actions')}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-black/10 dark:divide-white/10">
                      {filteredUsers.length > 0 ? filteredUsers.map((u) => (
                        <tr key={u.id} className="text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5">
                          <td className="p-4 uppercase tracking-tighter whitespace-nowrap border-r border-black/5 dark:border-white/5">{u.name} {u.isPlatformOperator && <span className="ml-2 text-[8px] border border-black dark:border-white px-1.5 py-0.5 align-middle bg-black dark:bg-white text-white dark:text-black">ROOT</span>}</td>
                          <td className="p-4 border-r border-black/5 dark:border-white/5"><p className="font-mono text-xs mb-0.5">{u.email || '—'}</p><p className="text-[8px] font-black uppercase opacity-30 tracking-widest">{t('id_label')}: {u.id}</p></td>
                          <td className="p-4 border-r border-black/5 dark:border-white/5">
                            {u.externalId || u.lastActiveAt ? (
                              <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 bg-black dark:bg-white" />
                                <span className="text-[9px] font-black uppercase tracking-widest">{u.externalId ? t('status_linked_sso') : t('status_active_local')}</span>
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-1.5 opacity-40"><div className="w-1.5 h-1.5 border border-black dark:border-white" /><span className="text-[9px] font-black uppercase tracking-widest">{t('status_pending')}</span></div>
                                <button onClick={() => { const membershipsArr = u.partnerMemberships || []; const resolvedPartnerId: string | undefined = selectedPartnerId !== 'all' ? selectedPartnerId : membershipsArr.length === 1 ? membershipsArr[0].partnerId : undefined; if (!resolvedPartnerId) { alert(t('select_partner_for_resend')); return; } if (confirm(t('confirm_resend_invite').replace('{email}', u.email || ''))) resendInvite.mutate({ userId: u.id, partnerId: resolvedPartnerId }); }} className="text-[8px] font-black uppercase tracking-widest underline underline-offset-2 hover:opacity-60 text-left">{t('resend_invite')}</button>
                              </div>
                            )}
                          </td>
                          <td className="p-4 border-r border-black/5 dark:border-white/5 text-[10px] font-black uppercase tracking-tighter">{u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleString() : t('never')}</td>
                          <td className="p-4 border-r border-black/5 dark:border-white/5">
                            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar pr-2">
                              {u.isPlatformOperator && <span className="border border-black dark:border-white text-[8px] font-black uppercase px-2 py-1 flex items-center gap-1 shrink-0 bg-black dark:bg-white text-white dark:text-black">{t('all_partners')} <span className="opacity-60 italic">(admin)</span></span>}
                              {(u.partnerMemberships?.length ?? 0) > 0 ? u.partnerMemberships!.map((m: PartnerMembership) => (
                                <span key={m.partnerId} className="border border-black dark:border-white text-[8px] font-black uppercase px-2 py-1 flex items-center gap-1 shrink-0">{m.partnerName} <span className="opacity-40 italic">({ROLE_LABEL[m.role] || m.role})</span></span>
                              )) : !u.isPlatformOperator && <span className="opacity-20 text-[10px] uppercase font-black tracking-widest">{t('no_active_memberships')}</span>}
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button onClick={() => setEditingUserProfile(u)} className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-3 py-1.5 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black">{t('edit_profile')}</button>
                              <button onClick={() => setEditingUser(u)} className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-3 py-1.5 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black opacity-60 hover:opacity-100">{t('manage_access')}</button>
                              <button onClick={() => { if(confirm(t('confirm_delete_account').replace('{name}', u.name))) deleteUser.mutate(u.id); }} className="text-[10px] font-black uppercase tracking-widest border border-black/20 dark:border-white/20 px-3 py-1.5 hover:border-black dark:hover:border-white opacity-40 hover:opacity-100">{t('delete_account')}</button>
                            </div>
                          </td>
                        </tr>
                      )) : <tr><td colSpan={6} className="p-12 text-center"><p className="text-xl font-black uppercase opacity-20 tracking-widest">{t('no_users')}</p></td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === 'health' && <PlatformSystemHealth />}
          {activeTab === 'config' && <PlatformSystemSettings />}
          {activeTab === 'audit' && <PlatformAuditLog />}
        </div>
      </main>

      {/* Edit Global Profile Modal */}
      {editingUserProfile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div onClick={() => setEditingUserProfile(null)} className="absolute inset-0 bg-black opacity-80" />
          <div className="w-full max-w-md bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">{t('edit_profile')}</h2>
            <div className="space-y-4">
              <div><label className="block text-[10px] font-black uppercase mb-1">{t('col_name')}</label><input type="text" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" value={editingUserProfile.name} onChange={e => setEditingUserProfile({...editingUserProfile, name: e.target.value})} /></div>
              <div><label className="block text-[10px] font-black uppercase mb-1">{t('email_label')}</label><input type="email" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" value={editingUserProfile.email ?? ''} onChange={e => setEditingUserProfile({...editingUserProfile, email: e.target.value})} /></div>
              <div className="flex justify-end gap-3 mt-8">
                <button onClick={() => setEditingUserProfile(null)} className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white">{t('cancel')}</button>
                <button onClick={() => updateUser.mutate({ id: editingUserProfile.id, data: { name: editingUserProfile.name, email: editingUserProfile.email ?? undefined } })} disabled={updateUser.isPending} className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert">{t('save_profile')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Manage User Access Modal */}
      {editingUser && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div onClick={() => setEditingUser(null)} className="absolute inset-0 bg-black opacity-80" />
          <div className="w-full max-w-2xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8 max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-start mb-6 border-b-2 border-black dark:border-white pb-4">
              <div><h2 className="text-2xl font-black uppercase tracking-tighter">{t('manage_access')}</h2><p className="text-sm font-bold uppercase opacity-60 tracking-widest">{editingUser.name}</p></div>
              <button onClick={() => setEditingUser(null)} className="text-xl font-black">✕</button>
            </div>
            <div className="space-y-8">
              {(editingUser.partnerMemberships?.length ?? 0) > 0 ? editingUser.partnerMemberships!.map((m: PartnerMembership) => (
                <div key={m.id} className="border-2 border-black dark:border-white p-4">
                  <div className="flex justify-between items-center mb-4"><h3 className="font-black uppercase tracking-widest text-xs">{m.partnerName}</h3><button onClick={() => { if(confirm(t('confirm_revoke_access').replace('{name}', editingUser.name))) removeMembership.mutate(m.id); }} className="text-[8px] font-black uppercase tracking-widest border border-black dark:border-white px-2 py-1 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black">{t('revoke_access')}</button></div>
                  <select className="w-full bg-black/5 dark:bg-white/5 border border-black dark:border-white px-2 py-1.5 text-xs font-bold outline-none" value={m.role} onChange={(e) => updateMembership.mutate({ id: m.id, data: { role: e.target.value as UserRole } })}>
                    <option value="agent">{t('agent')}</option><option value="support">{t('support')}</option><option value="admin">{t('admin')}</option><option value="platform_operator">{t('platform_operator')}</option>
                  </select>
                </div>
              )) : <div className="p-12 text-center border-2 border-dashed border-black/20 dark:border-white/20"><p className="text-sm font-black uppercase opacity-20 tracking-widest">{t('no_active_memberships')}</p></div>}
            </div>
            <div className="flex justify-end mt-10"><button onClick={() => setEditingUser(null)} className="px-8 py-3 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-[10px] tracking-widest border-2 border-black dark:border-white hover:invert">{t('done')}</button></div>
          </div>
        </div>
      )}

      {/* Create Partner Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div onClick={() => setShowCreateModal(false)} className="absolute inset-0 bg-black opacity-80" />
          <div className="w-full max-w-xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">{t('create_new_partner')}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">{t('partner_id')}</label>
                  <input
                    type="text"
                    placeholder={t('placeholder_partner_id')}
                    className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold font-mono outline-none"
                    value={createForm.id}
                    onChange={e => setCreateForm({...createForm, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">{t('display_name')}</label>
                  <input
                    type="text"
                    placeholder={t('placeholder_partner_name')}
                    className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                    value={createForm.name}
                    onChange={e => setCreateForm({...createForm, name: e.target.value})}
                  />
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-[10px] font-black uppercase mb-1">Logo</label>
                  <div className="flex items-center gap-3">
                    {createForm.logoUrl ? (
                      <img src={createForm.logoUrl} className="w-10 h-10 object-contain border-2 border-black dark:border-white" />
                    ) : (
                      <div className="w-10 h-10 border-2 border-dashed border-black/20 dark:border-white/20" />
                    )}
                    <input type="file" accept="image/*" className="hidden" id="logo-upload-create"
                      onChange={e => e.target.files?.[0] && handleLogoUpload(e.target.files[0], false)}
                    />
                    <label htmlFor="logo-upload-create"
                      className="cursor-pointer px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                    >
                      {createForm.logoUrl ? t('configure') : 'Upload'}
                    </label>
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-black uppercase mb-1">{t('provider_label')}</label>
                  <select className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                    value={createForm.authMethod} onChange={e => setCreateForm({...createForm, authMethod: e.target.value as 'local' | 'sso'})}>
                    <option value="local">Local (Email/Password)</option>
                    <option value="sso">Enterprise SSO</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t-2 border-black/10 dark:border-white/10">
                <button onClick={() => setShowCreateModal(false)}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white"
                >{t('cancel')}</button>
                <button onClick={() => createPartner.mutate(createForm)}
                  disabled={!createForm.id || !createForm.name || createPartner.isPending}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white disabled:opacity-20"
                >{t('create_new_partner')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit Partner Modal */}
      {editingPartner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div onClick={() => setEditingPartner(null)} className="absolute inset-0 bg-black opacity-80" />
          <div className="w-full max-w-2xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">{editingPartner.name}</h2>
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">{t('display_name')}</label>
                  <input type="text" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                    value={editingPartner.name} onChange={e => setEditingPartner({...editingPartner, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">{t('id_label')}</label>
                  <div className="w-full bg-black/5 dark:bg-white/5 border-2 border-black/20 dark:border-white/20 px-3 py-2 text-sm font-bold font-mono opacity-50">{editingPartner.id}</div>
                </div>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <label className="block text-[10px] font-black uppercase mb-1">Logo</label>
                  <div className="flex items-center gap-3">
                    {editingPartner.logoUrl ? (
                      <img src={editingPartner.logoUrl!} className="w-10 h-10 object-contain border-2 border-black dark:border-white" />
                    ) : (
                      <div className="w-10 h-10 border-2 border-dashed border-black/20 dark:border-white/20" />
                    )}
                    <input type="file" accept="image/*" className="hidden" id="logo-upload-edit"
                      onChange={e => e.target.files?.[0] && handleLogoUpload(e.target.files[0], true)}
                    />
                    <label htmlFor="logo-upload-edit"
                      className="cursor-pointer px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                    >
                      {editingPartner.logoUrl ? t('configure') : 'Upload'}
                    </label>
                  </div>
                </div>
                <div className="flex-1">
                  <label className="block text-[10px] font-black uppercase mb-1">{t('provider_label')}</label>
                  <select className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                    value={editingPartner.authMethod} onChange={e => setEditingPartner({...editingPartner, authMethod: e.target.value as 'local' | 'sso'})}>
                    <option value="local">Local (Email/Password)</option>
                    <option value="sso">Enterprise SSO</option>
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t-2 border-black/10 dark:border-white/10">
                <button onClick={() => setEditingPartner(null)}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white"
                >{t('cancel')}</button>
                <button onClick={() => updatePartner.mutate({ id: editingPartner.id, data: { name: editingPartner.name, logoUrl: editingPartner.logoUrl || undefined, authMethod: editingPartner.authMethod } })}
                  disabled={updatePartner.isPending}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white disabled:opacity-20"
                >{t('save_profile')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invite User Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div onClick={() => setShowInviteModal(false)} className="absolute inset-0 bg-black opacity-80" />
          <div className="w-full max-w-xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">{t('invite_new_user')}</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">{t('col_name')}</label>
                  <input type="text" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                    value={inviteForm.name} onChange={e => setInviteForm({...inviteForm, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">{t('email_label')}</label>
                  <input type="email" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                    value={inviteForm.email} onChange={e => { setInviteForm({...inviteForm, email: e.target.value}); setInviteError(''); }}
                  />
                  {inviteForm.email && !isValidEmail(inviteForm.email) && (
                    <p className="mt-1 text-[9px] font-black uppercase opacity-50">{t('placeholder_email')}</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">{t('all_partners')}</label>
                  <select className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                    value={inviteForm.partnerId} onChange={e => setInviteForm({...inviteForm, partnerId: e.target.value})}>
                    <option value="">—</option>
                    {partners?.filter(p => p.status === 'active').map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">{t('col_status')}</label>
                  <select className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                    value={inviteForm.role} onChange={e => setInviteForm({...inviteForm, role: e.target.value as UserRole})}>
                    <option value="agent">{t('agent')}</option>
                    <option value="support">{t('support')}</option>
                    <option value="admin">{t('admin')}</option>
                    <option value="platform_operator">{t('platform_operator')}</option>
                  </select>
                </div>
              </div>
              {inviteError && <p className="text-xs font-bold uppercase">{inviteError}</p>}
              <div className="flex justify-end gap-3 pt-4 border-t-2 border-black/10 dark:border-white/10">
                <button onClick={() => { setShowInviteModal(false); setInviteError(''); }}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white"
                >{t('cancel')}</button>
                <button onClick={() => inviteUser.mutate({ email: inviteForm.email, name: inviteForm.name, role: inviteForm.role, partnerId: inviteForm.partnerId, departments: inviteForm.dept ? [inviteForm.dept] : undefined })}
                  disabled={!inviteForm.email || !isValidEmail(inviteForm.email) || !inviteForm.name || (!inviteForm.partnerId && inviteForm.role !== 'platform_operator')}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white disabled:opacity-20"
                >{t('invite_new_user')}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Invite Result Dialog */}
      {inviteResult && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div onClick={() => setInviteResult(null)} className="absolute inset-0 bg-black opacity-80" />
          <div className="w-full max-w-md bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
            <h2 className="text-xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">
              {t('invite_resent_success')}
            </h2>
            {inviteResult.isExistingUser ? (
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest">
                  {t('manage_access')} — {inviteResult.partnerName}
                </p>
                <p className="text-[10px] uppercase opacity-60">
                  {t('status_linked_sso')}
                </p>
              </div>
            ) : inviteResult.tempPassword ? (
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest">
                  {inviteResult.partnerName}
                </p>
                <div className="border-2 border-black dark:border-white p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2 opacity-60">{t('password_label')}</p>
                  <div className="flex items-center justify-between gap-3">
                    <code className="font-mono text-sm font-bold break-all">{inviteResult.tempPassword}</code>
                    <button onClick={() => navigator.clipboard.writeText(inviteResult.tempPassword!)}
                      className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                    >Copy</button>
                  </div>
                </div>
                <p className="text-[9px] uppercase font-bold opacity-50">
                  {t('config_verify_note')}
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest">
                  {inviteResult.partnerName}
                </p>
                <p className="text-[10px] uppercase opacity-60">
                  {t('sso_enterprise')}
                </p>
              </div>
            )}
            <div className="flex justify-end mt-8">
              <button onClick={() => setInviteResult(null)}
                className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white"
              >{t('done')}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Partner Confirmation Modal */}
      {partnerToDelete && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
          <div onClick={() => setPartnerToDelete(null)} className="absolute inset-0 bg-black opacity-80" />
          <div className="w-full max-w-md bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8 text-center">
            <div className="w-16 h-16 border-4 border-black dark:border-white flex items-center justify-center mx-auto mb-6 text-2xl font-black">!</div>
            <h3 className="text-xl font-black uppercase tracking-tighter mb-2">{t('delete_permanently')}</h3>
            <p className="text-sm font-bold uppercase opacity-60 mb-6">
              {t('confirm_remove_partner').replace('{name}', partnerToDelete.name)}
            </p>
            <div className="text-left mb-6">
              <label className="block text-[10px] font-black uppercase tracking-widest mb-1">{t('display_name')}</label>
              <input
                type="text"
                placeholder={partnerToDelete.name}
                className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold outline-none"
                value={partnerDeleteConfirmation}
                onChange={e => setPartnerDeleteConfirmation(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setPartnerToDelete(null); setPartnerDeleteConfirmation(''); }}
                className="flex-1 py-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest"
              >{t('cancel')}</button>
              <button onClick={() => { deletePartner.mutate(partnerToDelete.id); setPartnerToDelete(null); setPartnerDeleteConfirmation(''); }}
                disabled={partnerDeleteConfirmation !== partnerToDelete.name || deletePartner.isPending}
                className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:invert disabled:opacity-30 disabled:hover:invert-0"
              >{t('delete_permanently')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}