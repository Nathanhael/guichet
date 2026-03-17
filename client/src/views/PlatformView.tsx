import { useState } from 'react';
import useStore from '../store/useStore';
import { trpc } from '../utils/trpc';
import DarkModeToggle from '../components/DarkModeToggle';
import { useT } from '../i18n';

export default function PlatformView() {
  const { logout } = useStore();
  const t = useT();
  const [editingPartner, setEditingPartner] = useState<any>(null);

  const { data: partners, refetch } = trpc.platform.listPartners.useQuery();
  const updatePartner = trpc.platform.updatePartner.useMutation({
    onSuccess: () => {
      setEditingPartner(null);
      refetch();
    }
  });

  return (
    <div className="h-screen flex flex-col bg-white dark:bg-black text-black dark:text-white overflow-hidden">
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

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto">
          <div className="flex justify-between items-end mb-8 border-b-4 border-black dark:border-white pb-4">
            <div>
              <h1 className="text-4xl font-black uppercase tracking-tighter">Partner Ecosystem</h1>
              <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">Manage tenants and system rules.</p>
            </div>
            <button className="bg-black dark:bg-white text-white dark:text-black px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white">
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
                  <button
                    onClick={() => setEditingPartner(p)}
                    className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white"
                  >
                    Configure
                  </button>
                  <button 
                    onClick={() => {
                      useStore.getState().setActiveMembershipId(p.id);
                    }}
                    className="flex-1 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white"
                  >
                    Enter Workspace
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {editingPartner && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
          <div 
            onClick={() => setEditingPartner(null)}
            className="absolute inset-0 bg-black opacity-80"
          />
          <div className="w-full max-w-2xl bg-white dark:bg-black border-4 border-black dark:border-white relative z-10 p-8">
            <h2 className="text-2xl font-black uppercase tracking-tighter mb-6 border-b-2 border-black dark:border-white pb-2">Partner Configuration: {editingPartner.name}</h2>
            
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black uppercase mb-1">Ollama Model</label>
                  <input
                    type="text"
                    className="w-full bg-black/5 dark:bg-white/5 border-2 border-black dark:border-white px-3 py-2 text-sm font-bold font-mono outline-none"
                    value={editingPartner?.ollamaModel || ''}
                    onChange={e => setEditingPartner({ ...editingPartner, ollamaModel: e.target.value })}
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-8">
                <button 
                  onClick={() => setEditingPartner(null)}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => updatePartner.mutate({ id: editingPartner.id, data: editingPartner })}
                  className="px-6 py-2 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
