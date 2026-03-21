import { useState } from 'react';
import useStore from '../store/useStore';
import { trpc } from '../utils/trpc';
import DarkModeToggle from '../components/DarkModeToggle';
import { useT } from '../i18n';
import PlatformSystemHealth from '../components/admin/PlatformSystemHealth';
import PlatformAuditLog from '../components/admin/PlatformAuditLog';
import LanguageSwitcher from '../components/LanguageSwitcher';

type PlatformTab = 'partners' | 'users' | 'system' | 'audit';

const ROLE_LABEL: Record<string, string> = { agent: 'Agent', support: 'Support', manager: 'Manager', admin: 'Partner Admin', platform_operator: 'Platform Operator' };

export default function PlatformView() {
  const { user, memberships, activeMembershipId, logout } = useStore();
  const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
  const t = useT();
  const [activeTab, setActiveTab] = useState<PlatformTab>('partners');
  const [editingPartner, setEditingPartner] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  
  const [createForm, setCreateForm] = useState({ id: '', name: '', logoUrl: '', industry: '', authMethod: 'local' as 'local' | 'sso' });

  const [inviteForm, setInviteForm] = useState({
    email: '',
    name: '',
    role: 'support' as string,
    partnerId: '',
    dept: ''
  });

  const [partnerDeleteConfirmation, setPartnerDeleteConfirmation] = useState('');
  const [partnerToDelete, setPartnerToDelete] = useState<any>(null);
  const [userSearch, setUserSearch] = useState('');
  const [selectedPartnerId, setSelectedPartnerId] = useState<string>('all');
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editingUserProfile, setEditingUserProfile] = useState<any>(null);
  const [addRole, setAddRole] = useState<string>('support');
  const [addPartnerId, setAddPartnerId] = useState<string>('');
  const [inviteError, setInviteError] = useState<string>('');
  const [inviteResult, setInviteResult] = useState<{ tempPassword: string | null; isExistingUser: boolean; partnerName: string } | null>(null);

  const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

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
        if (isEdit) setEditingPartner({ ...editingPartner, logoUrl: data.url });
        else setCreateForm({ ...createForm, logoUrl: data.url });
      } else {
        alert(data.error || 'Upload failed');
      }
    } catch (err) {
      console.error(err);
      alert('Upload error');
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
    onSuccess: () => {
      setEditingPartner(null);
      refetchPartners();
    }
  });

  const deactivatePartner = trpc.platform.deactivatePartner.useMutation({ onSuccess: () => refetchPartners() });
  const reactivatePartner = trpc.platform.reactivatePartner.useMutation({ onSuccess: () => refetchPartners() });
  const deletePartner = trpc.platform.deletePartner.useMutation({ onSuccess: () => refetchPartners() });

  const inviteUser = trpc.platform.inviteUser.useMutation({
    onSuccess: async (data) => {
      setInviteError('');

      // Determine partner name for the confirmation dialog
      // Use a local ref to the current partners data to avoid stale closure
      const currentPartners = utils.platform.listPartners.getData();
      const partnerName = currentPartners?.find(p => p.id === inviteForm.partnerId)?.name || inviteForm.partnerId;

      // Show confirmation dialog with result
      setInviteResult({
        tempPassword: data.tempPassword,
        isExistingUser: data.isExistingUser,
        partnerName
      });

      // If we are NOT in the 'Manage Access' modal, clean up the global invite form
      if (!editingUser) {
        setShowInviteModal(false);
        setInviteForm({ email: '', name: '', role: 'support', partnerId: '', dept: '' });
      }

      // Refresh data
      const { data: freshUsers } = await refetchUsers();

      // If we ARE in the 'Manage Access' modal, update the current user snapshot
      if (editingUser && freshUsers) {
        const updatedUser = freshUsers.find(u => u.id === editingUser.id);
        if (updatedUser) setEditingUser(updatedUser);
      }
    },
    onError: (err) => {
      const msg = err.message;
      if (msg.includes('email') || msg.includes('Email') || msg.includes('invalid_string')) {
        setInviteError('Invalid email address. Please check the format (e.g. user@example.com).');
      } else if (msg.includes('CONFLICT') || msg.includes('already')) {
        setInviteError('This email is already registered or has access to this partner.');
      } else {
        setInviteError(msg || 'Something went wrong. Please try again.');
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

  const activePartnersList = (partners || []).filter(p => p.status === 'active' && !p.deletedAt);
  const inactivePartnersList = (partners || []).filter(p => p.status === 'inactive' && !p.deletedAt);

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
    onSuccess: () => {
      setEditingUserProfile(null);
      refetchUsers();
    }
  });

  const filteredUsers = (globalUsers || []).filter(u => {
    if (u.deletedAt) return false;
    
    // Text Filter
    const search = userSearch.toLowerCase();
    const matchesSearch = u.name.toLowerCase().includes(search) || (u.email || '').toLowerCase().includes(search);
    
    // Partner Filter
    const matchesPartner = selectedPartnerId === 'all' || 
      (u as any).partnerMemberships?.some((m: any) => m.partnerId === selectedPartnerId);

    return matchesSearch && matchesPartner;
  });

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-black text-black dark:text-white overflow-hidden font-sans">
      <nav className="px-8 py-4 border-b-2 border-black dark:border-white bg-white dark:bg-black flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <span className="text-2xl font-black uppercase tracking-tighter">TESSERA</span>
          <div className="h-6 w-px bg-black dark:bg-white opacity-20 mx-2" />
          <span className="text-[10px] font-black px-2 py-1 bg-black dark:bg-white text-white dark:text-black uppercase tracking-widest mr-4">Platform Operator</span>
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
        {(['partners', 'users', 'system', 'audit'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-8 py-4 text-[10px] font-black uppercase tracking-widest border-b-4 whitespace-nowrap ${
              activeTab === tab ? 'border-black dark:border-white text-black dark:text-white' : 'border-transparent opacity-40 hover:opacity-100'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto">
          {activeTab === 'partners' && (
            <>
              <div className="flex justify-between items-end mb-8 border-b-4 border-black dark:border-white pb-4">
                <div>
                  <h1 className="text-4xl font-black uppercase tracking-tighter">Partner Ecosystem</h1>
                  <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">Manage tenants and system rules.</p>
                </div>
                <button 
                  onClick={() => setShowCreateModal(true)}
                  className="bg-black dark:bg-white text-white dark:text-black px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-white hover:text-black dark:hover:bg-black dark:hover:text-white"
                >
                  + Create New Partner
                </button>
              </div>

              {activePartnersList.length > 0 && (
                <div className="mb-12">
                  <h2 className="text-lg font-black uppercase tracking-widest mb-4">Active Partners</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {activePartnersList.map((p) => (
                      <div key={p.id} className="border-2 border-black dark:border-white p-6 bg-white dark:bg-black flex flex-col justify-between">
                        <div className="flex justify-between items-start mb-6">
                          <div className="flex items-center gap-4">
                            <div className="w-14 h-14 border-4 border-black dark:border-white flex items-center justify-center overflow-hidden bg-black/5 dark:bg-white/5 shrink-0">
                              {p.logoUrl ? (
                                <img src={p.logoUrl} alt={p.name} className="w-full h-full object-contain" />
                              ) : (
                                <span className="text-2xl font-black">{p.name.charAt(0)}</span>
                              )}
                            </div>
                            <div>
                              <h2 className="text-xl font-black uppercase tracking-tight line-clamp-1" title={p.name}>{p.name}</h2>
                              <div className="flex items-center gap-2">
                                <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">{p.industry}</p>
                                </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[8px] font-black uppercase opacity-40">ID: {p.id}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-auto">
                          <button onClick={() => setEditingPartner(p)} className="flex-1 min-w-[80px] py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black">Configure</button>
                          <button onClick={() => useStore.getState().setActiveMembershipId(p.id)} className="flex-1 min-w-[80px] py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert">Enter</button>
                          <button
                            onClick={() => { if(confirm(`Deactivate partner ${p.name}? Users will be disconnected.`)) deactivatePartner.mutate({ partnerId: p.id }); }}
                            className="flex-none px-4 py-2 text-[10px] font-black uppercase tracking-widest opacity-50 hover:opacity-100 border-2 border-black dark:border-white"
                          >
                            Deactivate
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {inactivePartnersList.length > 0 && (
                <div>
                  <h2 className="text-lg font-black uppercase tracking-widest mb-4 opacity-50">Inactive Partners</h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 opacity-60">
                    {inactivePartnersList.map((p) => (
                      <div key={p.id} className="border-2 border-dashed border-black dark:border-white p-6 bg-black/5 dark:bg-white/5 flex flex-col justify-between">
                        <div className="flex justify-between items-start mb-6">
                          <div className="flex items-center gap-4">
                            <div className="w-14 h-14 border-4 border-black dark:border-white flex items-center justify-center overflow-hidden bg-black/10 dark:bg-white/10 shrink-0 grayscale">
                              {p.logoUrl ? (
                                <img src={p.logoUrl} alt={p.name} className="w-full h-full object-contain" />
                              ) : (
                                <span className="text-2xl font-black">{p.name.charAt(0)}</span>
                              )}
                            </div>
                            <div>
                              <h2 className="text-xl font-black uppercase tracking-tight line-through line-clamp-1" title={p.name}>{p.name}</h2>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-1">INACTIVE</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-auto">
                          <button 
                            onClick={() => reactivatePartner.mutate({ partnerId: p.id })} 
                            className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert"
                          >
                            Reactivate
                          </button>
                          <button 
                            onClick={() => setPartnerToDelete(p)} 
                            className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:invert"
                          >
                            Delete Permanently
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Hard Delete Partner Confirmation Modal */}
              {partnerToDelete && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-6">
                  <div onClick={() => setPartnerToDelete(null)} className="absolute inset-0 bg-black opacity-80" />
                  <div className="w-full max-w-md bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8 text-center">
                    <div className="w-16 h-16 border-4 border-black dark:border-white flex items-center justify-center mx-auto mb-6 text-2xl font-black">!</div>
                    <h3 className="text-xl font-black uppercase tracking-tighter mb-2">Delete Permanently</h3>
                    <p className="text-sm font-bold uppercase opacity-60 mb-6">
                      This will irreversibly delete <strong>{partnerToDelete.name}</strong>.
                    </p>
                    <div className="text-left mb-6">
                      <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Type partner name to confirm</label>
                      <input 
                        type="text" 
                        placeholder={partnerToDelete.name}
                        className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold outline-none" 
                        value={partnerDeleteConfirmation} 
                        onChange={e => setPartnerDeleteConfirmation(e.target.value)} 
                      />
                    </div>
                    <div className="flex gap-4">
                      <button onClick={() => { setPartnerToDelete(null); setPartnerDeleteConfirmation(''); }} className="flex-1 py-3 border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:bg-black/5">Cancel</button>
                      <button 
                        onClick={() => {
                          if (partnerDeleteConfirmation === partnerToDelete.name) {
                            deletePartner.mutate(partnerToDelete.id);
                            setPartnerToDelete(null);
                            setPartnerDeleteConfirmation('');
                          }
                        }}
                        disabled={partnerDeleteConfirmation !== partnerToDelete.name || deletePartner.isPending}
                        className="flex-1 py-3 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:invert disabled:opacity-30 disabled:hover:invert-0"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          
          {activeTab === 'users' && (
            <>
              <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 mb-8 border-b-4 border-black dark:border-white pb-6">
                <div className="flex-1">
                  <h1 className="text-4xl font-black uppercase tracking-tighter">Global Users</h1>
                  <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">Identify and manage identities across the ecosystem.</p>
                  
                  <div className="mt-6 flex flex-col sm:flex-row gap-4 max-w-2xl relative">
                    <div className="flex-1 relative">
                      <input 
                        type="text" 
                        placeholder="Search by name or email..." 
                        className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-4 py-2.5 text-sm font-bold outline-none focus:bg-transparent"
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                      />
                      {userSearch && (
                        <button 
                          onClick={() => setUserSearch('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase opacity-40 hover:opacity-100"
                        >
                          Clear
                        </button>
                      )}
                    </div>
                    <select 
                      className="bg-white dark:bg-black border-2 border-black dark:border-white px-4 py-2.5 text-sm font-black uppercase tracking-widest outline-none"
                      value={selectedPartnerId}
                      onChange={(e) => setSelectedPartnerId(e.target.value)}
                    >
                      <option value="all" className="bg-white dark:bg-black text-black dark:text-white">All Partners</option>
                      {partners?.filter(p => !p.deletedAt)
                        .sort((a, b) => (a.status === 'active' ? -1 : 1))
                        .map(p => (
                        <option key={p.id} value={p.id} className="bg-white dark:bg-black text-black dark:text-white">
                          {p.status === 'inactive' ? `[INACTIVE] ${p.name}` : p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <button 
                  onClick={() => setShowInviteModal(true)}
                  className="bg-black dark:bg-white text-white dark:text-black px-8 py-3 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:invert shrink-0"
                >
                  + Invite New User
                </button>
              </div>

              <div className="border-2 border-black dark:border-white overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-widest">
                        <th className="p-4 border-r border-white/20">Name</th>
                        <th className="p-4 border-r border-white/20">Email / Identity</th>
                        <th className="p-4 border-r border-white/20">Status</th>
                        <th className="p-4 border-r border-white/20">Access Scope</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y-2 divide-black/10 dark:divide-white/10">
                      {filteredUsers.length > 0 ? filteredUsers.map((u) => (
                        <tr key={u.id} className="text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5">
                          <td className="p-4 uppercase tracking-tighter whitespace-nowrap border-r border-black/5 dark:border-white/5">
                            {u.name} 
                            {u.isPlatformOperator && (
                              <span className="ml-2 text-[8px] border border-black dark:border-white px-1.5 py-0.5 align-middle bg-black dark:bg-white text-white dark:text-black">
                                ROOT
                              </span>
                            )}
                          </td>
                          <td className="p-4 border-r border-black/5 dark:border-white/5">
                            <p className="font-mono text-xs mb-0.5">{u.email || '—'}</p>
                            <p className="text-[8px] font-black uppercase opacity-30 tracking-widest">ID: {u.id}</p>
                          </td>
                          <td className="p-4 border-r border-black/5 dark:border-white/5">
                            {u.externalId ? (
                              <div className="flex items-center gap-1.5">
                                <div className="w-1.5 h-1.5 bg-black dark:bg-white" />
                                <span className="text-[9px] font-black uppercase tracking-widest">Linked (SSO)</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 opacity-40">
                                <div className="w-1.5 h-1.5 border border-black dark:border-white" />
                                <span className="text-[9px] font-black uppercase tracking-widest">Pending Invite</span>
                              </div>
                            )}
                          </td>
                          <td className="p-4 border-r border-black/5 dark:border-white/5">
                            <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto custom-scrollbar pr-2">
                              {(u as any).partnerMemberships?.length > 0
                                ? (u as any).partnerMemberships.map((m: any) => (
                                    <span key={m.partnerId} className="border border-black dark:border-white text-[8px] font-black uppercase px-2 py-1 flex items-center gap-1 shrink-0">
                                      {m.partnerName}
                                      <span className="opacity-40 italic">({ROLE_LABEL[m.role as keyof typeof ROLE_LABEL] || m.role})</span>
                                    </span>
                                  ))
                                : <span className="opacity-20 text-[10px] uppercase font-black tracking-widest">No Partner Access</span>
                              }
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex justify-end gap-2">
                              <button 
                                onClick={() => setEditingUserProfile(u)}
                                className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-3 py-1.5 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                              >
                                Edit Profile
                              </button>
                              <button 
                                onClick={() => setEditingUser(u)}
                                className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-3 py-1.5 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black opacity-60 hover:opacity-100"
                              >
                                Manage Access
                              </button>
                              <button 
                                onClick={() => { if(confirm(`Irreversibly delete user ${u.name} globally? All partner memberships will be revoked.`)) deleteUser.mutate(u.id); }}
                                className="text-[10px] font-black uppercase tracking-widest border border-black/20 dark:border-white/20 px-3 py-1.5 hover:border-black dark:hover:border-white opacity-40 hover:opacity-100"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan={5} className="p-12 text-center">
                            <p className="text-xl font-black uppercase opacity-20 tracking-widest">No users found</p>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {activeTab === 'system' && <PlatformSystemHealth />}
          {activeTab === 'audit' && <PlatformAuditLog />}
        </div>
      </main>

      {/* Create Partner Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div onClick={() => setShowCreateModal(false)} className="absolute inset-0 bg-black opacity-80" />
          <div className="w-full max-w-xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">Create New Partner</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Partner ID (slug)</label>
                  <input 
                    type="text" 
                    placeholder="e.g. acme-corp"
                    className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold font-mono outline-none" 
                    value={createForm.id} 
                    onChange={e => setCreateForm({...createForm, id: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '')})} 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Display Name</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Acme Corporation"
                    className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" 
                    value={createForm.name} 
                    onChange={e => setCreateForm({...createForm, name: e.target.value})} 
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Logo</label>
                  <div className="flex items-center gap-3">
                    {createForm.logoUrl ? (
                      <div className="w-10 h-10 border-2 border-black dark:border-white p-1">
                        <img src={createForm.logoUrl} className="w-full h-full object-contain" alt="Logo preview" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 border-2 border-dashed border-black/20 dark:border-white/20" />
                    )}
                    <input 
                      type="file" 
                      accept="image/*"
                      className="hidden" 
                      id="logo-upload-create"
                      onChange={e => e.target.files?.[0] && handleLogoUpload(e.target.files[0], false)}
                    />
                    <label 
                      htmlFor="logo-upload-create"
                      className="cursor-pointer px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                    >
                      {createForm.logoUrl ? 'Change Logo' : 'Upload Logo'}
                    </label>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase mb-1">Industry</label>
                <input
                  type="text"
                  placeholder="e.g. Retail, Healthcare, Finance"
                  className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
                  value={createForm.industry}
                  onChange={e => setCreateForm({...createForm, industry: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase mb-1">Auth Method</label>
                <div className="flex border-2 border-black dark:border-white">
                  <button
                    type="button"
                    onClick={() => setCreateForm({...createForm, authMethod: 'local'})}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest ${createForm.authMethod === 'local' ? 'bg-black dark:bg-white text-white dark:text-black' : 'hover:bg-black/5'}`}
                  >
                    Local (Password)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateForm({...createForm, authMethod: 'sso'})}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest border-l-2 border-black dark:border-white ${createForm.authMethod === 'sso' ? 'bg-black dark:bg-white text-white dark:text-black' : 'hover:bg-black/5'}`}
                  >
                    SSO (Corporate)
                  </button>
                </div>
                <p className="mt-1 text-[9px] uppercase font-bold opacity-50">
                  {createForm.authMethod === 'local'
                    ? 'Users sign in with email and password.'
                    : 'Users sign in via corporate identity provider.'}
                </p>
              </div>
              <div className="flex justify-end gap-3 mt-8">
                <button onClick={() => setShowCreateModal(false)} className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white">Cancel</button>
                <button 
                  onClick={() => createPartner.mutate(createForm)} 
                  disabled={!createForm.id || !createForm.name || createPartner.isPending}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white disabled:opacity-20"
                >
                  Create Partner
                </button>
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
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">Partner: {editingPartner.name}</h2>
            
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Display Name</label>
                  <input type="text" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" value={editingPartner.name} onChange={e => setEditingPartner({...editingPartner, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Logo</label>
                  <div className="flex items-center gap-3">
                    {editingPartner.logoUrl ? (
                      <div className="w-10 h-10 border-2 border-black dark:border-white p-1">
                        <img src={editingPartner.logoUrl} className="w-full h-full object-contain" alt="Logo preview" />
                      </div>
                    ) : (
                      <div className="w-10 h-10 border-2 border-dashed border-black/20 dark:border-white/20" />
                    )}
                    <input 
                      type="file" 
                      accept="image/*"
                      className="hidden" 
                      id="logo-upload-edit"
                      onChange={e => e.target.files?.[0] && handleLogoUpload(e.target.files[0], true)}
                    />
                    <label 
                      htmlFor="logo-upload-edit"
                      className="cursor-pointer px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                    >
                      {editingPartner.logoUrl ? 'Change Logo' : 'Upload Logo'}
                    </label>
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase mb-1">Auth Method</label>
                <div className="flex border-2 border-black dark:border-white">
                  <button
                    type="button"
                    onClick={() => setEditingPartner({...editingPartner, authMethod: 'local'})}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest ${editingPartner.authMethod === 'local' ? 'bg-black dark:bg-white text-white dark:text-black' : 'hover:bg-black/5'}`}
                  >
                    Local (Password)
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingPartner({...editingPartner, authMethod: 'sso'})}
                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest border-l-2 border-black dark:border-white ${editingPartner.authMethod === 'sso' ? 'bg-black dark:bg-white text-white dark:text-black' : 'hover:bg-black/5'}`}
                  >
                    SSO (Corporate)
                  </button>
                </div>
                <p className="mt-1 text-[9px] uppercase font-bold opacity-50">
                  {editingPartner.authMethod === 'local'
                    ? 'Users sign in with email and password.'
                    : 'Users sign in via corporate identity provider.'}
                </p>
              </div>
              <div className="flex justify-end gap-3 mt-8">
                <button onClick={() => setEditingPartner(null)} className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white">Cancel</button>
                <button onClick={() => updatePartner.mutate({ id: editingPartner.id, data: { ...editingPartner } })} className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white">Save Configuration</button>
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
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">Invite New User</h2>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Name</label>
                  <input type="text" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" value={inviteForm.name} onChange={e => setInviteForm({...inviteForm, name: e.target.value})} />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Email</label>
                  <input
                    type="email"
                    className={`w-full bg-black/5 dark:bg-white/5 border-2 px-3 py-2 text-sm font-bold outline-none ${
                      inviteForm.email && !isValidEmail(inviteForm.email)
                        ? 'border-black/30 dark:border-white/30'
                        : 'border-black dark:border-white'
                    }`}
                    value={inviteForm.email}
                    onChange={e => { setInviteForm({...inviteForm, email: e.target.value}); setInviteError(''); }}
                  />
                  {inviteForm.email && !isValidEmail(inviteForm.email) && (
                    <p className="mt-1 text-[9px] font-black uppercase opacity-50">Enter a valid email (e.g. user@example.com)</p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Partner</label>
                  <select className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" value={inviteForm.partnerId} onChange={e => setInviteForm({...inviteForm, partnerId: e.target.value})}>
                    <option value="">Select Partner...</option>
                    {partners?.filter(p => !p.deletedAt && p.status === 'active').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Role</label>
                  <select className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" value={inviteForm.role} onChange={e => setInviteForm({...inviteForm, role: e.target.value})}>
                    <option value="agent">Agent</option>
                    <option value="support">Support</option>
                    <option value="manager">Manager</option>
                    <option value="admin">Partner Admin</option>
                    <option value="platform_operator">Platform Operator</option>
                  </select>
                </div>
              </div>
              {inviteError && (
                <div className="mt-4 border-2 border-black dark:border-white p-3">
                  <p className="text-[10px] font-black uppercase tracking-widest">{inviteError}</p>
                </div>
              )}
              <div className="flex justify-end gap-3 mt-8">
                <button onClick={() => { setShowInviteModal(false); setInviteError(''); }} className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white">Cancel</button>
                <button
                  onClick={() => { setInviteError(''); inviteUser.mutate(inviteForm); }}
                  disabled={!inviteForm.email || !isValidEmail(inviteForm.email) || !inviteForm.name || (!inviteForm.partnerId && inviteForm.role !== 'platform_operator')}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white disabled:opacity-20"
                >
                  Invite User
                </button>
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
              User Invited
            </h2>
            {inviteResult.isExistingUser ? (
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest">
                  User granted access to {inviteResult.partnerName}.
                </p>
                <p className="text-[10px] uppercase opacity-60">
                  They can sign in with their existing credentials.
                </p>
              </div>
            ) : inviteResult.tempPassword ? (
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest">
                  User created for {inviteResult.partnerName}.
                </p>
                <div className="border-2 border-black dark:border-white p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest mb-2 opacity-60">Temporary Password</p>
                  <div className="flex items-center justify-between gap-3">
                    <code className="font-mono text-sm font-bold break-all">{inviteResult.tempPassword}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(inviteResult.tempPassword!)}
                      className="px-3 py-1.5 text-[9px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black shrink-0"
                    >
                      Copy
                    </button>
                  </div>
                </div>
                <p className="text-[9px] uppercase font-bold opacity-50">
                  Share this securely. It won't be shown again.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-xs font-bold uppercase tracking-widest">
                  User invited to {inviteResult.partnerName}.
                </p>
                <p className="text-[10px] uppercase opacity-60">
                  They can sign in via their corporate SSO.
                </p>
              </div>
            )}
            <div className="flex justify-end mt-8">
              <button
                onClick={() => setInviteResult(null)}
                className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Edit Global Profile Modal */}
      {editingUserProfile && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div onClick={() => setEditingUserProfile(null)} className="absolute inset-0 bg-black opacity-80" />
          <div className="w-full max-w-md bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">Edit Global Profile</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase mb-1">Full Name</label>
                <input 
                  type="text" 
                  className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" 
                  value={editingUserProfile.name} 
                  onChange={e => setEditingUserProfile({...editingUserProfile, name: e.target.value})} 
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase mb-1">Email Address</label>
                <input 
                  type="email" 
                  className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" 
                  value={editingUserProfile.email} 
                  onChange={e => setEditingUserProfile({...editingUserProfile, email: e.target.value})} 
                />
                <p className="mt-2 text-[8px] uppercase font-bold opacity-40 italic">Note: Changing the email may affect SSO linking.</p>
              </div>
              <div className="flex justify-end gap-3 mt-8">
                <button onClick={() => setEditingUserProfile(null)} className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black/5">Cancel</button>
                <button 
                  onClick={() => updateUser.mutate({ id: editingUserProfile.id, data: { name: editingUserProfile.name, email: editingUserProfile.email } })} 
                  disabled={updateUser.isPending}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert"
                >
                  Save Profile
                </button>
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
              <div>
                <h2 className="text-2xl font-black uppercase tracking-tighter">Manage Access</h2>
                <p className="text-sm font-bold uppercase opacity-60 tracking-widest">{editingUser.name} ({editingUser.email})</p>
              </div>
              <button onClick={() => setEditingUser(null)} className="text-xl font-black">✕</button>
            </div>

            <div className="space-y-8">
              {editingUser.partnerMemberships?.length > 0 ? (
                editingUser.partnerMemberships.map((m: any) => (
                  <div key={m.id} className="border-2 border-black dark:border-white p-4">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="font-black uppercase tracking-widest text-xs">{m.partnerName}</h3>
                      <button 
                        onClick={() => { if(confirm(`Revoke ${editingUser.name}'s access to ${m.partnerName}?`)) removeMembership.mutate(m.id); }}
                        className="text-[8px] font-black uppercase tracking-widest border border-black dark:border-white px-2 py-1 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                      >
                        Revoke Access
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[8px] font-black uppercase mb-1 opacity-60">Role</label>
                        <select 
                          className="w-full bg-black/5 dark:bg-white/5 border border-black dark:border-white px-2 py-1.5 text-xs font-bold outline-none"
                          value={m.role}
                          onChange={(e) => updateMembership.mutate({ id: m.id, data: { role: e.target.value as any } })}
                        >
                          <option value="agent">Agent</option>
                          <option value="support">Support</option>
                          <option value="manager">Manager</option>
                          <option value="admin">Partner Admin</option>
                          <option value="platform_operator">Platform Operator</option>
                        </select>
                      </div>
                      <div className="flex items-end">
                        <p className="text-[8px] uppercase font-bold opacity-40 italic">Changes are saved automatically on selection.</p>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-12 text-center border-2 border-dashed border-black/20 dark:border-white/20">
                  <p className="text-sm font-black uppercase opacity-20 tracking-widest">No Active Memberships</p>
                </div>
              )}

              <div className="pt-6 border-t-2 border-black dark:border-white">
                <h3 className="text-[10px] font-black uppercase tracking-widest mb-4">Add to another Partner</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
                  <div>
                    <label className="block text-[8px] font-black uppercase mb-1 opacity-60">Select Partner</label>
                    <select
                      className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-xs font-bold outline-none"
                      value={addPartnerId}
                      onChange={(e) => setAddPartnerId(e.target.value)}
                    >
                      <option value="">Choose Partner...</option>
                      {partners?.filter(p => !p.deletedAt && !editingUser.partnerMemberships.some((em: any) => em.partnerId === p.id)).map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[8px] font-black uppercase mb-1 opacity-60">Select Role</label>
                    <select 
                      className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-xs font-bold outline-none"
                      value={addRole}
                      onChange={(e) => setAddRole(e.target.value)}
                    >
                      <option value="agent">Agent</option>
                      <option value="support">Support</option>
                      <option value="manager">Manager</option>
                      <option value="admin">Partner Admin</option>
                      <option value="platform_operator">Platform Operator</option>
                    </select>
                  </div>
                  <button 
                    onClick={() => {
                      if (!addPartnerId) return;
                      inviteUser.mutate({
                        email: editingUser.email,
                        name: editingUser.name,
                        partnerId: addPartnerId,
                        role: addRole as any,
                        departments: []
                      });
                      setAddPartnerId('');
                    }}
                    className="bg-black dark:bg-white text-white dark:text-black py-2.5 px-4 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:invert h-[42px]"
                  >
                    Grant Access
                  </button>
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-10">
              <button onClick={() => setEditingUser(null)} className="px-8 py-3 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-[10px] tracking-widest border-2 border-black dark:border-white hover:invert">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}