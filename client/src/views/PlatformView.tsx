import { useState } from 'react';
import useStore from '../store/useStore';
import { trpc } from '../utils/trpc';
import DarkModeToggle from '../components/DarkModeToggle';
import { useT } from '../i18n';
import { motion, AnimatePresence } from 'framer-motion';

type PlatformTab = 'partners' | 'users';

export default function PlatformView() {
  const { logout } = useStore();
  const t = useT();
  const [activeTab, setActiveTab] = useState<PlatformTab>('partners');
  const [editingPartner, setEditingPartner] = useState<any>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: '',
    name: '',
    role: 'support' as any,
    partnerId: '',
    dept: ''
  });

  const { data: partners, refetch: refetchPartners } = trpc.platform.listPartners.useQuery();
  const { data: globalUsers, refetch: refetchUsers } = trpc.platform.listGlobalUsers.useQuery();

  const updatePartner = trpc.platform.updatePartner.useMutation({
    onSuccess: () => {
      setEditingPartner(null);
      refetchPartners();
    }
  });

  const inviteUser = trpc.platform.inviteUser.useMutation({
    onSuccess: () => {
      setShowInviteModal(false);
      setInviteForm({ email: '', name: '', role: 'support', partnerId: '', dept: '' });
      refetchUsers();
    }
  });

  const deleteUser = trpc.platform.deleteUser.useMutation({ onSuccess: () => refetchUsers() });

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-black text-black dark:text-white overflow-hidden font-sans">
      <nav className="px-8 py-4 border-b-2 border-black dark:border-white bg-white dark:bg-black flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-4">
          <span className="text-2xl font-black uppercase tracking-tighter">TESSERA</span>
          <div className="h-6 w-px bg-black dark:bg-white opacity-20 mx-2" />
          <span className="text-[10px] font-black px-2 py-1 bg-black dark:bg-white text-white dark:text-black uppercase tracking-widest">Platform Operator</span>
        </div>
        <div className="flex items-center gap-6">
          <DarkModeToggle />
          <button onClick={logout} className="text-black dark:text-white hover:line-through text-xs font-black uppercase tracking-widest transition-all">➔ {t('sign_out')}</button>
        </div>
      </nav>

      <div className="flex border-b-2 border-black dark:border-white bg-white dark:bg-black px-8">
        {(['partners', 'users'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-8 py-4 text-[10px] font-black uppercase tracking-widest border-b-4 transition-all ${
              activeTab === tab ? 'border-black dark:border-white text-black dark:text-white' : 'border-transparent text-slate-400 hover:text-black'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto">
          {activeTab === 'partners' ? (
            <>
              <div className="flex justify-between items-end mb-8 border-b-4 border-black dark:border-white pb-4">
                <div>
                  <h1 className="text-4xl font-black uppercase tracking-tighter">Partner Ecosystem</h1>
                  <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">Manage tenants and system rules.</p>
                </div>
                <button className="bg-black dark:bg-white text-white dark:text-black px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-white hover:text-black dark:hover:bg-black dark:hover:text-white">
                  + Create New Partner
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {(partners || []).map((p: any) => (
                  <div key={p.id} className="border-2 border-black dark:border-white p-6 bg-white dark:bg-black">
                    <div className="flex justify-between items-start mb-6">
                      <div className="flex items-center gap-4">
                        <div className="w-14 h-14 border-4 border-black dark:border-white flex items-center justify-center text-2xl font-black">
                          {p.name.charAt(0)}
                        </div>
                        <div>
                          <h2 className="text-xl font-black uppercase tracking-tight">{p.name}</h2>
                          <p className="text-[10px] font-bold opacity-60 uppercase tracking-widest">{p.industry}</p>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setEditingPartner(p)} className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black">Configure</button>
                      <button onClick={() => useStore.getState().setActiveMembershipId(p.id)} className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert">Enter Workspace</button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="flex justify-between items-end mb-8 border-b-4 border-black dark:border-white pb-4">
                <div>
                  <h1 className="text-4xl font-black uppercase tracking-tighter">Global Users</h1>
                  <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">Invite and manage users across all partners.</p>
                </div>
                <button 
                  onClick={() => setShowInviteModal(true)}
                  className="bg-black dark:bg-white text-white dark:text-black px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-white hover:text-black"
                >
                  + Invite User
                </button>
              </div>

              <div className="border-2 border-black dark:border-white">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-widest">
                      <th className="p-4">Name</th>
                      <th className="p-4">Email</th>
                      <th className="p-4">External ID (Azure)</th>
                      <th className="p-4">Created</th>
                      <th className="p-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-black dark:divide-white">
                    {(globalUsers || []).filter(u => !u.deletedAt).map((u: any) => (
                      <tr key={u.id} className="text-sm font-bold hover:bg-black/5">
                        <td className="p-4 uppercase tracking-tighter">{u.name} {u.isPlatformOperator && <span className="ml-2 text-[8px] border border-black px-1">ROOT</span>}</td>
                        <td className="p-4 font-mono text-xs">{u.email || '-'}</td>
                        <td className="p-4 font-mono text-xs opacity-40">{u.externalId || 'Not Linked'}</td>
                        <td className="p-4 text-[10px] opacity-60">{new Date(u.createdAt).toLocaleDateString()}</td>
                        <td className="p-4">
                          <button 
                            onClick={() => { if(confirm('Delete user?')) deleteUser.mutate(u.id); }}
                            className="text-[10px] font-black uppercase hover:line-through"
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
        </div>
      </main>

      {/* Edit Partner Modal */}
      {editingPartner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div onClick={() => setEditingPartner(null)} className="absolute inset-0 bg-black opacity-80" />
          <div className="w-full max-w-2xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">Partner: {editingPartner.name}</h2>
            
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black uppercase mb-1">Ollama Model</label>
                <input type="text" className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold font-mono outline-none" value={editingPartner?.ollamaModel || ''} onChange={e => setEditingPartner({ ...editingPartner, ollamaModel: e.target.value })} />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase mb-2">Departments</label>
                <div className="space-y-2">
                  {(editingPartner?.departments || []).map((dept: any, idx: number) => (
                    <div key={idx} className="flex gap-2">
                      <input 
                        type="text" 
                        placeholder="ID (e.g. SALES)" 
                        className="flex-1 bg-black/5 dark:bg-white/5 border border-black dark:border-white px-2 py-1 text-xs font-black uppercase" 
                        value={dept.id} 
                        onChange={e => {
                          const next = [...editingPartner.departments];
                          next[idx] = { ...next[idx], id: e.target.value.toUpperCase() };
                          setEditingPartner({ ...editingPartner, departments: next });
                        }}
                      />
                      <input 
                        type="text" 
                        placeholder="Name (e.g. Sales)" 
                        className="flex-[2] bg-black/5 dark:bg-white/5 border border-black dark:border-white px-2 py-1 text-xs font-bold" 
                        value={dept.name} 
                        onChange={e => {
                          const next = [...editingPartner.departments];
                          next[idx] = { ...next[idx], name: e.target.value };
                          setEditingPartner({ ...editingPartner, departments: next });
                        }}
                      />
                      <button 
                        onClick={() => {
                          const next = editingPartner.departments.filter((_: any, i: number) => i !== idx);
                          setEditingPartner({ ...editingPartner, departments: next });
                        }}
                        className="px-2 border border-black dark:border-white hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button 
                    onClick={() => {
                      const next = [...(editingPartner?.departments || []), { id: '', name: '' }];
                      setEditingPartner({ ...editingPartner, departments: next });
                    }}
                    className="w-full py-1 text-[10px] font-black uppercase border border-dashed border-black dark:border-white hover:bg-black/5"
                  >
                    + Add Department
                  </button>
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
                    {partners?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
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
                  disabled={!inviteForm.email || !inviteForm.partnerId}
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
