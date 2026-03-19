import { useState } from 'react';
import useStore from '../store/useStore';
import { trpc } from '../utils/trpc';
import DarkModeToggle from '../components/DarkModeToggle';
import { useT } from '../i18n';
import PlatformSystemHealth from '../components/admin/PlatformSystemHealth';
import PlatformAuditLog from '../components/admin/PlatformAuditLog';

type PlatformTab = 'partners' | 'users' | 'system' | 'audit';

const ROLE_LABEL: Record<string, string> = { agent: 'Agent', support: 'Support', manager: 'Manager', admin: 'Partner Admin', platform_operator: 'Platform Operator' };
const AI_PROVIDERS = [
  { id: 'none', label: 'Disabled (No AI)' },
  { id: 'ollama', label: 'Ollama (Local)' },
  { id: 'azure', label: 'Azure OpenAI' },
  { id: 'openai', label: 'OpenAI (Compatible)' },
  { id: 'gemini', label: 'Google Gemini' },
  { id: 'anthropic', label: 'Anthropic Claude' },
];

export default function PlatformView() {
  const { user, memberships, activeMembershipId, logout } = useStore();
  const activeMembership = (memberships || []).find(m => m.id === activeMembershipId);
  const t = useT();
  const [activeTab, setActiveTab] = useState<PlatformTab>('partners');
  const [editingPartner, setEditingPartner] = useState<any>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  
  const [createForm, setCreateForm] = useState({
    id: '',
    name: '',
    logoUrl: '',
    industry: 'Telecommunications',
    aiEnabled: true,
    aiProvider: 'ollama',
    ollamaModel: 'translategemma:4b'
  });

  const [inviteForm, setInviteForm] = useState({
    email: '',
    name: '',
    role: 'support' as any,
    partnerId: '',
    dept: ''
  });

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
  const { data: health } = trpc.platform.getSystemHealth.useQuery(undefined, {
    refetchInterval: 30000 // Every 30s
  });

  const createPartner = trpc.platform.createPartner.useMutation({
    onSuccess: () => {
      setShowCreateModal(false);
      setCreateForm({
        id: '',
        name: '',
        industry: 'Telecommunications',
        logoUrl: '',
        aiEnabled: true,
        aiProvider: 'ollama',
        ollamaModel: 'gemmatranslate4b'
      });
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
    onSuccess: () => {
      setShowInviteModal(false);
      setInviteForm({ email: '', name: '', role: 'support', partnerId: '', dept: '' });
      refetchUsers();
    }
  });

  const deleteUser = trpc.platform.deleteUser.useMutation({ onSuccess: () => refetchUsers() });

  const activePartnersList = (partners || []).filter(p => p.status === 'active' && !p.deletedAt);
  const inactivePartnersList = (partners || []).filter(p => p.status === 'inactive' && !p.deletedAt);

  const [partnerDeleteConfirmation, setPartnerDeleteConfirmation] = useState('');
  const [partnerToDelete, setPartnerToDelete] = useState<any>(null);

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-black text-black dark:text-white overflow-hidden font-sans">
      <nav className="px-8 py-4 border-b-2 border-black dark:border-white bg-white dark:bg-black flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <span className="text-2xl font-black uppercase tracking-tighter">TESSERA</span>
          <div className="h-6 w-px bg-black dark:bg-white opacity-20 mx-2" />
          <span className="text-[10px] font-black px-2 py-1 bg-black dark:bg-white text-white dark:text-black uppercase tracking-widest mr-4">Platform Operator</span>
          
          {/* Health Indicators */}
          <div className="hidden lg:flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${health?.postgres ? 'bg-black dark:bg-white' : 'bg-slate-300 animate-pulse'}`} />
              <span className="text-[8px] font-black uppercase tracking-widest opacity-60">Postgres</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${health?.redis ? 'bg-black dark:bg-white' : 'bg-slate-300 animate-pulse'}`} />
              <span className="text-[8px] font-black uppercase tracking-widest opacity-60">Redis</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <DarkModeToggle />
          <button onClick={logout} className="text-black dark:text-white hover:line-through text-xs font-black uppercase tracking-widest transition-all">➔ {t('sign_out')}</button>
        </div>
      </nav>

      <div className="flex border-b-2 border-black dark:border-white bg-white dark:bg-black px-8 overflow-x-auto">
        {(['partners', 'users', 'system', 'audit'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-8 py-4 text-[10px] font-black uppercase tracking-widest border-b-4 transition-all whitespace-nowrap ${
              activeTab === tab ? 'border-black dark:border-white text-black dark:text-white' : 'border-transparent text-slate-400 hover:text-black dark:hover:text-white'
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
                                {!p.aiEnabled && <span className="text-[8px] font-black px-1 border border-black/20 opacity-40">AI OFF</span>}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-[8px] font-black uppercase opacity-40">ID: {p.id}</p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-auto">
                          <button onClick={() => setEditingPartner(p)} className="flex-1 min-w-[80px] py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-all">Configure</button>
                          <button onClick={() => useStore.getState().setActiveMembershipId(p.id)} className="flex-1 min-w-[80px] py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert transition-all">Enter</button>
                          <button 
                            onClick={() => { if(confirm(`Deactivate partner ${p.name}? Users will be disconnected.`)) deactivatePartner.mutate({ partnerId: p.id }); }} 
                            className="flex-none px-4 py-2 text-[10px] font-black uppercase tracking-widest opacity-50 hover:opacity-100 hover:bg-orange-500 hover:text-white transition-all border-2 border-black dark:border-white"
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
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 opacity-60 hover:opacity-100 transition-opacity">
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
                                <span className="text-[10px] font-black uppercase tracking-widest bg-orange-500 text-white px-1">INACTIVE</span>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 mt-auto">
                          <button 
                            onClick={() => reactivatePartner.mutate({ partnerId: p.id })} 
                            className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert transition-all"
                          >
                            Reactivate
                          </button>
                          <button 
                            onClick={() => setPartnerToDelete(p)} 
                            className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-red-600 hover:text-white transition-all border-2 border-transparent hover:border-red-600"
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
                  <div className="w-full max-w-md bg-white dark:bg-black border-4 border-red-600 relative z-10 p-8 text-center">
                    <div className="w-16 h-16 border-4 border-red-600 text-red-600 flex items-center justify-center mx-auto mb-6 text-2xl font-black">!</div>
                    <h3 className="text-xl font-black uppercase tracking-tighter mb-2">Delete Permanently</h3>
                    <p className="text-sm font-bold uppercase opacity-60 mb-6">
                      This will irreversibly delete <span className="text-red-600">{partnerToDelete.name}</span>.
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
                        className="flex-1 py-3 bg-red-600 text-white border-2 border-red-600 font-black uppercase text-[10px] tracking-widest hover:invert disabled:opacity-30 disabled:hover:invert-0"
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
              <div className="flex justify-between items-end mb-8 border-b-4 border-black dark:border-white pb-4">
                <div>
                  <h1 className="text-4xl font-black uppercase tracking-tighter">Global Users</h1>
                  <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">Invite and manage users across all partners.</p>
                </div>
                <button 
                  onClick={() => setShowInviteModal(true)}
                  className="bg-black dark:bg-white text-white dark:text-black px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-white hover:text-black dark:hover:bg-black dark:hover:text-white"
                >
                  + Invite User
                </button>
              </div>

              <div className="border-2 border-black dark:border-white overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-black/5 dark:bg-white/5 border-b-2 border-black dark:border-white text-[10px] font-black uppercase tracking-widest">
                      <th className="p-4">Name</th>
                      <th className="p-4">Email</th>
                      <th className="p-4">External ID (Azure)</th>
                      <th className="p-4">Created</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-black/20 dark:divide-white/20">
                    {(globalUsers || []).filter(u => !u.deletedAt).map((u) => (
                      <tr key={u.id} className="text-sm font-bold hover:bg-black/5 dark:hover:bg-white/5 transition-colors">
                        <td className="p-4 uppercase tracking-tighter whitespace-nowrap">
                          {u.name} 
                          {u.isPlatformOperator && <span className="ml-2 text-[8px] border-2 border-black dark:border-white px-1 py-0.5 align-middle">ROOT</span>}
                        </td>
                        <td className="p-4 font-mono text-xs">{u.email || '-'}</td>
                        <td className="p-4 font-mono text-xs opacity-40">{u.externalId || 'Not Linked'}</td>
                        <td className="p-4 text-[10px] opacity-60 font-mono">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="p-4 text-right">
                          <button 
                            onClick={() => { if(confirm('Delete user globally?')) deleteUser.mutate(u.id); }}
                            className="text-[10px] font-black uppercase tracking-widest text-red-600 hover:line-through"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
                      className="cursor-pointer px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors"
                    >
                      {createForm.logoUrl ? 'Change Logo' : 'Upload Logo'}
                    </label>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Industry</label>
                  <input 
                    type="text" 
                    className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" 
                    value={createForm.industry} 
                    onChange={e => setCreateForm({...createForm, industry: e.target.value})} 
                  />
                </div>
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 accent-black dark:accent-white" 
                      checked={createForm.aiEnabled} 
                      onChange={e => setCreateForm({...createForm, aiEnabled: e.target.checked})} 
                    />
                    <span className="text-[10px] font-black uppercase tracking-widest group-hover:line-through">AI Enabled</span>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">AI Provider</label>
                  <select 
                    className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" 
                    value={createForm.aiProvider} 
                    onChange={e => setCreateForm({...createForm, aiProvider: e.target.value})}
                    disabled={!createForm.aiEnabled}
                  >
                    {AI_PROVIDERS.filter(p => p.id !== 'none').map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Model Name</label>
                  <input 
                    type="text" 
                    placeholder="e.g. gpt-4o-mini"
                    className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold font-mono outline-none disabled:opacity-20" 
                    value={createForm.ollamaModel} 
                    onChange={e => setCreateForm({...createForm, ollamaModel: e.target.value})} 
                    disabled={!createForm.aiEnabled}
                  />
                </div>
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
                      className="cursor-pointer px-3 py-2 border-2 border-black dark:border-white text-[10px] font-black uppercase hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors"
                    >
                      {editingPartner.logoUrl ? 'Change Logo' : 'Upload Logo'}
                    </label>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      className="w-4 h-4 accent-black dark:accent-white" 
                      checked={editingPartner.aiEnabled} 
                      onChange={e => setEditingPartner({...editingPartner, aiEnabled: e.target.checked})} 
                    />
                    <span className="text-[10px] font-black uppercase tracking-widest group-hover:line-through">AI Enabled</span>
                  </label>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">AI Provider</label>
                  <select 
                    className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none disabled:opacity-20" 
                    value={editingPartner.aiProvider || 'ollama'} 
                    onChange={e => setEditingPartner({...editingPartner, aiProvider: e.target.value})}
                    disabled={!editingPartner.aiEnabled}
                  >
                    {AI_PROVIDERS.filter(p => p.id !== 'none').map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Model Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold font-mono outline-none disabled:opacity-20" 
                    value={editingPartner?.ollamaModel || ''} 
                    onChange={e => setEditingPartner({ ...editingPartner, ollamaModel: e.target.value })} 
                    disabled={!editingPartner.aiEnabled}
                  />
                </div>
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
                  <input type="email" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none" value={inviteForm.email} onChange={e => setInviteForm({...inviteForm, email: e.target.value})} />
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
              <div className="flex justify-end gap-3 mt-8">
                <button onClick={() => setShowInviteModal(false)} className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white">Cancel</button>
                <button 
                  onClick={() => inviteUser.mutate(inviteForm)} 
                  disabled={!inviteForm.email || (!inviteForm.partnerId && inviteForm.role !== 'platform_operator')}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white disabled:opacity-20"
                >
                  Invite User
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}