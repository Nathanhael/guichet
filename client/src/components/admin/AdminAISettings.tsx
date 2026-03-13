import { useState, useEffect } from 'react';
import { useT } from '../../i18n';
import { trpc } from '../../utils/trpc';
import { Panel, Skeleton } from './DashboardHelpers';
import { motion } from 'framer-motion';
import { Save, Bot, Sparkles, ShieldCheck, User, LifeBuoy } from 'lucide-react';

export default function AdminAISettings() {
  const t = useT();
  const [aiRules, setAiRules] = useState('');
  const [agentStrategy, setAgentStrategy] = useState('');
  const [supportStrategy, setSupportStrategy] = useState('');
  const [enableActionable, setEnableActionable] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  const { data: manifest, isLoading, refetch } = trpc.partner.getManifest.useQuery();
  
  const updateRulesMutation = trpc.partner.updateAIRules.useMutation({
    onSuccess: () => refetch()
  });

  const updateStrategiesMutation = trpc.partner.updateAIStrategies.useMutation({
    onSuccess: () => {
      setIsDirty(false);
      refetch();
      alert('AI Persona & Strategies updated successfully!');
    }
  });

  useEffect(() => {
    if (manifest) {
      setAiRules(manifest.aiRules || '');
      setAgentStrategy(manifest.agentPromptStrategy || '');
      setSupportStrategy(manifest.supportPromptStrategy || '');
      setEnableActionable(!!manifest.enableActionableAi);
    }
  }, [manifest]);

  const handleSave = () => {
    // Save everything
    updateStrategiesMutation.mutate({
      agentPromptStrategy: agentStrategy,
      supportPromptStrategy: supportStrategy,
      enableActionableAi: enableActionable
    });
    updateRulesMutation.mutate({ aiRules });
  };

  if (isLoading) return <div className="p-6"><Skeleton className="h-96 w-full rounded-3xl" /></div>;

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-fade-in pb-20">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-solarized-base01 dark:text-white tracking-tight flex items-center gap-2">
            <Bot className="text-accent-500" />
            AI Persona & Context
          </h2>
          <p className="text-sm text-solarized-base1 dark:text-gray-400 mt-1">
            Configure how the AI behaves and what industry knowledge it applies to your project.
          </p>
        </div>
        <button
          disabled={!isDirty || updateStrategiesMutation.isLoading}
          onClick={handleSave}
          className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold transition-all ${
            isDirty 
              ? 'bg-accent-500 text-white shadow-lg shadow-accent-500/20 hover:-translate-y-0.5' 
              : 'bg-gray-200 dark:bg-brand-800 text-gray-400 cursor-not-allowed'
          }`}
        >
          <Save size={18} />
          {updateStrategiesMutation.isLoading ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-4 border-white/10 bg-white/5">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles size={18} className="text-amber-400" />
            <h4 className="text-xs font-black uppercase tracking-widest text-gray-500">Industry</h4>
          </div>
          <p className="text-lg font-bold capitalize">{manifest?.industry || 'General'}</p>
        </div>
        <div className="glass-card p-4 border-white/10 bg-white/5">
          <div className="flex items-center gap-3 mb-2">
            <ShieldCheck size={18} className="text-emerald-400" />
            <h4 className="text-xs font-black uppercase tracking-widest text-gray-500">AI Status</h4>
          </div>
          <p className="text-lg font-bold">{manifest?.aiEnabled ? 'Active' : 'Disabled'}</p>
        </div>
        <div className="glass-card p-4 border-white/10 bg-white/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot size={18} className="text-blue-400" />
              <h4 className="text-xs font-black uppercase tracking-widest text-gray-500">Actionable AI</h4>
            </div>
            <button
              onClick={() => { setEnableActionable(!enableActionable); setIsDirty(true); }}
              className={`w-8 h-4 rounded-full relative transition-colors ${enableActionable ? 'bg-accent-500' : 'bg-gray-600'}`}
            >
              <div className={`absolute top-0.5 w-2 h-2 bg-white rounded-full transition-all ${enableActionable ? 'left-5' : 'left-1'}`} />
            </button>
          </div>
          <p className="text-lg font-bold mt-2">{enableActionable ? 'Enabled' : 'Disabled'}</p>
        </div>
      </div>

      <Panel title="Global Domain Context">
        <textarea
          value={aiRules}
          onChange={(e) => { setAiRules(e.target.value); setIsDirty(true); }}
          rows={4}
          className="w-full bg-solarized-base3/50 dark:bg-black/20 border-2 border-solarized-base2 dark:border-brand-700 rounded-2xl px-5 py-4 text-sm font-medium focus:border-accent-500 outline-none transition-all custom-scrollbar resize-none"
          placeholder="General rules for all roles..."
        />
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Agent Improvement Strategy">
          <div className="flex items-center gap-2 mb-4 text-solarized-base1 dark:text-gray-400">
            <User size={16} />
            <span className="text-xs font-bold uppercase tracking-wider">Role: Agent (Non-Technical)</span>
          </div>
          <textarea
            value={agentStrategy}
            onChange={(e) => { setAgentStrategy(e.target.value); setIsDirty(true); }}
            rows={8}
            className="w-full bg-solarized-base3/50 dark:bg-black/20 border-2 border-solarized-base2 dark:border-brand-700 rounded-2xl px-5 py-4 text-sm font-medium focus:border-accent-500 outline-none transition-all custom-scrollbar resize-none"
            placeholder="How should the AI improve agent messages?"
          />
          <p className="text-[10px] text-gray-500 mt-2 italic">Applied when an agent sends a message to support.</p>
        </Panel>

        <Panel title="Support Resolution Strategy">
          <div className="flex items-center gap-2 mb-4 text-solarized-base1 dark:text-gray-400">
            <LifeBuoy size={16} />
            <span className="text-xs font-bold uppercase tracking-wider">Role: Support (Technical)</span>
          </div>
          <textarea
            value={supportStrategy}
            onChange={(e) => { setSupportStrategy(e.target.value); setIsDirty(true); }}
            rows={8}
            className="w-full bg-solarized-base3/50 dark:bg-black/20 border-2 border-solarized-base2 dark:border-brand-700 rounded-2xl px-5 py-4 text-sm font-medium focus:border-accent-500 outline-none transition-all custom-scrollbar resize-none"
            placeholder="How should the AI transform support specialist replies?"
          />
          <p className="text-[10px] text-gray-500 mt-2 italic">Applied when support sends a message to an agent.</p>
        </Panel>
      </div>

      <div className="bg-accent-500/5 border border-accent-500/20 rounded-3xl p-6">
        <h3 className="text-sm font-bold text-accent-400 flex items-center gap-2 mb-2">
          <Sparkles size={16} />
          The Actionable Framework
        </h3>
        <p className="text-xs text-gray-400 leading-relaxed">
          When **Actionable AI** is enabled, the AI will attempt to split support replies into three distinct sections: 
          technical steps for the agent, a script for the customer, and a simple summary. Use the strategy editors above to 
          define the exact format you want.
        </p>
      </div>
    </div>
  );
}
