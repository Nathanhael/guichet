import { useState } from 'react';
import useStore from '../store/useStore';
import { trpc } from '../utils/trpc';
import { motion, AnimatePresence } from 'framer-motion';
import DarkModeToggle from '../components/DarkModeToggle';
import LanguageSwitcher from '../components/LanguageSwitcher';

export default function PlatformView() {
  const { logout } = useStore();
  const [editingPartner, setEditingPartner] = useState<any>(null);
  
  const { data: partners, isLoading, refetch } = trpc.platform.listPartners.useQuery();
  const upsertMutation = trpc.platform.upsertPartner.useMutation({
    onSuccess: () => {
      refetch();
      setEditingPartner(null);
    }
  });

  if (isLoading || !partners) return <div className="p-10 text-white">Loading Platform Data...</div>;

  return (
    <div className="h-screen flex flex-col bg-brand-950 text-white overflow-hidden">
      <nav className="px-6 py-4 flex items-center justify-between border-b border-white/10 bg-brand-900/50 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold tracking-tighter">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-accent-400 to-rose-400">Platform Operator</span>
          </h1>
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-white/10 border border-white/10 uppercase tracking-widest text-gray-400">Global Admin</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-black/20 p-1 rounded-xl border border-white/5">
            <LanguageSwitcher />
            <DarkModeToggle />
          </div>
          <button onClick={logout} className="px-4 py-2 bg-rose-500/10 text-rose-400 rounded-xl hover:bg-rose-500/20 transition-all font-bold text-sm">Logout</button>
        </div>
      </nav>

      <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-3xl font-bold">Partner Ecosystem</h2>
              <p className="text-gray-400 mt-1">Manage tenants, branding, and industry-specific AI rules.</p>
            </div>
            <button 
              onClick={() => setEditingPartner({ id: '', name: '', industry: 'general', primaryColor: '#a855f7', secondaryColor: '#3b82f6', ref1Label: 'Reference 1', ref2Label: 'Reference 2', aiRules: '', departments: '[]' })}
              className="px-6 py-3 bg-accent-500 text-white rounded-2xl font-bold shadow-lg shadow-accent-500/20 hover:-translate-y-0.5 transition-all"
            >
              + Create New Partner
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {partners.map(p => (
              <motion.div 
                key={p.id}
                whileHover={{ y: -5 }}
                className="glass-card p-6 border-white/10 bg-white/5 flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div 
                      className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-xl" 
                      style={{ 
                        backgroundColor: (p.primaryColor || '#a855f7') + '22', 
                        color: p.primaryColor || '#a855f7', 
                        border: `1px solid ${p.primaryColor || '#a855f7'}44` 
                      }}
                    >
                      {p.name.charAt(0)}
                    </div>
                    <span className="text-[10px] uppercase font-black tracking-widest text-gray-500">{p.id}</span>
                  </div>
                  <h3 className="text-lg font-bold">{p.name}</h3>
                  <p className="text-sm text-gray-400 capitalize mb-4">{p.industry}</p>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Ollama Model</label>
                      <input
                        type="text"
                        placeholder="e.g. gemma2:2b"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
                        value={editingPartner.ollamaModel || ''}
                        onChange={e => setEditingPartner({ ...editingPartner, ollamaModel: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Theme Config (JSON)</label>
                      <input
                        type="text"
                        placeholder='{"glassBlur": "20px"}'
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm"
                        value={typeof editingPartner.themeConfig === 'string' ? editingPartner.themeConfig : JSON.stringify(editingPartner.themeConfig || {})}
                        onChange={e => setEditingPartner({ ...editingPartner, themeConfig: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex gap-3 pt-4">
                    <div className="w-6 h-6 rounded-full" style={{ backgroundColor: p.primaryColor || '#a855f7' }} title="Primary" />
                    <div className="w-6 h-6 rounded-full" style={{ backgroundColor: p.secondaryColor || '#3b82f6' }} title="Secondary" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button 
                    onClick={() => setEditingPartner(p)}
                    className="flex-1 py-2 bg-white/10 rounded-xl text-xs font-bold hover:bg-white/20 transition-all"
                  >
                    Configure
                  </button>
                  <button 
                    onClick={() => {
                      // Login as this partner (shortcut for operator)
                      // We need to find a membership for this partner
                      window.location.reload(); // Simple way to force refresh with new context if we added logic to memberships
                    }}
                    className="flex-1 py-2 bg-accent-500/10 text-accent-400 rounded-xl text-xs font-bold hover:bg-accent-500/20 transition-all border border-accent-500/20"
                  >
                    Enter Workspace
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </main>

      <AnimatePresence>
        {editingPartner && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 backdrop-blur-2xl bg-black/60">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-brand-900 border border-white/10 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl"
            >
              <div className="p-8 border-b border-white/5 bg-white/5 flex items-center justify-between">
                <h3 className="text-xl font-bold">{editingPartner.id ? 'Edit Partner' : 'New Partner'}</h3>
                <button onClick={() => setEditingPartner(null)} className="text-gray-400 hover:text-white">✕</button>
              </div>
              
              <div className="p-8 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Partner ID</label>
                    <input 
                      disabled={!!editingPartner.id}
                      value={editingPartner.id} 
                      onChange={e => setEditingPartner({...editingPartner, id: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-sm focus:border-accent-500 outline-none"
                      placeholder="e.g. healthcare-01"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Display Name</label>
                    <input 
                      value={editingPartner.name} 
                      onChange={e => setEditingPartner({...editingPartner, name: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-sm focus:border-accent-500 outline-none"
                      placeholder="e.g. General Hospital"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Industry</label>
                    <input 
                      value={editingPartner.industry} 
                      onChange={e => setEditingPartner({...editingPartner, industry: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-sm focus:border-accent-500 outline-none"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Primary</label>
                      <input 
                        type="color"
                        value={editingPartner.primaryColor} 
                        onChange={e => setEditingPartner({...editingPartner, primaryColor: e.target.value})}
                        className="w-full h-10 bg-black/20 border border-white/10 rounded-xl px-1 py-1 cursor-pointer"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Secondary</label>
                      <input 
                        type="color"
                        value={editingPartner.secondaryColor} 
                        onChange={e => setEditingPartner({...editingPartner, secondaryColor: e.target.value})}
                        className="w-full h-10 bg-black/20 border border-white/10 rounded-xl px-1 py-1 cursor-pointer"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Ref 1 Label</label>
                    <input 
                      value={editingPartner.ref1Label} 
                      onChange={e => setEditingPartner({...editingPartner, ref1Label: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-sm focus:border-accent-500 outline-none"
                      placeholder="e.g. Patient ID"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Ref 2 Label</label>
                    <input 
                      value={editingPartner.ref2Label} 
                      onChange={e => setEditingPartner({...editingPartner, ref2Label: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-sm focus:border-accent-500 outline-none"
                      placeholder="e.g. Case Number"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">AI Domain Rules</label>
                  <textarea 
                    value={editingPartner.aiRules} 
                    onChange={e => setEditingPartner({...editingPartner, aiRules: e.target.value})}
                    rows={2}
                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-accent-500 outline-none resize-none"
                    placeholder="e.g. You are a medical support assistant..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Agent Strategy</label>
                    <textarea 
                      value={editingPartner.agentPromptStrategy} 
                      onChange={e => setEditingPartner({...editingPartner, agentPromptStrategy: e.target.value})}
                      rows={3}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-accent-500 outline-none resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Support Strategy</label>
                    <textarea 
                      value={editingPartner.supportPromptStrategy} 
                      onChange={e => setEditingPartner({...editingPartner, supportPromptStrategy: e.target.value})}
                      rows={3}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-sm focus:border-accent-500 outline-none resize-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Ollama Model</label>
                    <input 
                      value={editingPartner.ollamaModel} 
                      onChange={e => setEditingPartner({...editingPartner, ollamaModel: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-sm focus:border-accent-500 outline-none"
                      placeholder="e.g. gemma2:2b"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] uppercase font-black text-gray-500 mb-1.5 tracking-widest">Theme Config (JSON)</label>
                    <input 
                      value={typeof editingPartner.themeConfig === 'string' ? editingPartner.themeConfig : JSON.stringify(editingPartner.themeConfig || {})} 
                      onChange={e => setEditingPartner({...editingPartner, themeConfig: e.target.value})}
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-2 text-sm focus:border-accent-500 outline-none"
                      placeholder='{"glassBlur":"20px"}'
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3 bg-white/5 p-4 rounded-2xl border border-white/5">
                  <div className="flex-1">
                    <h4 className="text-sm font-bold">Enable AI Pipeline</h4>
                    <p className="text-xs text-gray-400">Improvement, Translation, Sentiment, and Summaries</p>
                  </div>
                  <button
                    onClick={() => setEditingPartner({...editingPartner, aiEnabled: !editingPartner.aiEnabled})}
                    className={`w-12 h-6 rounded-full transition-colors relative ${editingPartner.aiEnabled ? 'bg-accent-500' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${editingPartner.aiEnabled ? 'left-7' : 'left-1'}`} />
                  </button>
                </div>
              </div>

              <div className="p-8 bg-black/20 flex gap-3">
                <button 
                  onClick={() => setEditingPartner(null)}
                  className="flex-1 py-3 bg-white/5 rounded-2xl font-bold hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => upsertMutation.mutate(editingPartner)}
                  className="flex-1 py-3 bg-accent-500 text-white rounded-2xl font-bold shadow-lg shadow-accent-500/20 hover:-translate-y-0.5 transition-all"
                >
                  Save Partner Configuration
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
