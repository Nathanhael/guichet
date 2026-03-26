import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import { Plus, Trash2, RefreshCw } from 'lucide-react';
import ErrorBox from './ErrorBox';

export default function AdminLabels() {
  const t = useT();
  const [newText, setNewText] = useState('');
  const [newColor, setNewColor] = useState('indigo');

  const { data: labels, isLoading, error: fetchError, refetch } = trpc.label.list.useQuery();

  const createMutation = trpc.label.create.useMutation({
    onSuccess: () => {
      setNewText('');
      refetch();
    },
  });

  const deleteMutation = trpc.label.delete.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const addLabel = () => {
    if (!newText.trim()) return;
    createMutation.mutate({ text: newText, color: newColor });
  };

  const deleteLabel = (id: string) => {
    deleteMutation.mutate(id);
  };

  const colors = [
    { key: 'blue', bg: 'bg-blue-500', ring: 'ring-blue-500' },
    { key: 'indigo', bg: 'bg-indigo-500', ring: 'ring-indigo-500' },
    { key: 'purple', bg: 'bg-purple-500', ring: 'ring-purple-500' },
    { key: 'emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
    { key: 'teal', bg: 'bg-teal-500', ring: 'ring-teal-500' },
    { key: 'cyan', bg: 'bg-cyan-500', ring: 'ring-cyan-500' },
    { key: 'sky', bg: 'bg-sky-500', ring: 'ring-sky-500' },
    { key: 'amber', bg: 'bg-amber-500', ring: 'ring-amber-500' },
    { key: 'orange', bg: 'bg-orange-500', ring: 'ring-orange-500' },
    { key: 'rose', bg: 'bg-rose-500', ring: 'ring-rose-500' },
    { key: 'pink', bg: 'bg-pink-500', ring: 'ring-pink-500' },
    { key: 'slate', bg: 'bg-slate-500', ring: 'ring-slate-500' },
  ];

  const error = fetchError?.message || createMutation.error?.message || deleteMutation.error?.message;

  return (
    <div className="max-w-3xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest">{t('labels') || 'Labels'}</h2>
          <p className="text-xs uppercase opacity-60 mt-1">Categorize and tag conversations</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 hover:bg-black/5 dark:hover:bg-white/5"
          title="Refresh"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <ErrorBox error={error} />

      {/* Create new label */}
      <div className="border-2 border-black dark:border-white p-5 mb-6">
        <h3 className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-4">Create New Label</h3>
        <div className="flex items-end gap-4">
          <div className="flex-1">
            <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Name *</label>
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addLabel()}
              placeholder="e.g. Bug Report"
              className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none"
            />
          </div>
          <div>
            <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Color *</label>
            <div className="flex gap-1.5 p-1.5 border-2 border-black dark:border-white">
              {colors.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setNewColor(c.key)}
                  className={`w-6 h-6 rounded-full transition-all ${c.bg} ${
                    newColor === c.key
                      ? 'ring-2 ring-offset-2 ring-offset-white dark:ring-offset-black ' + c.ring + ' scale-110'
                      : 'opacity-50 hover:opacity-80 hover:scale-105'
                  }`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={addLabel}
            disabled={!newText.trim() || createMutation.isPending}
            className="flex items-center gap-2 px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-xs tracking-widest disabled:opacity-50 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            {createMutation.isPending ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>

      {/* Labels list */}
      <div className="border-2 border-black dark:border-white">
        <div className="grid grid-cols-[auto_1fr_60px] border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60 w-16 text-center">Color</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60">Label</div>
          <div className="px-4 py-3 text-[9px] font-black uppercase tracking-widest opacity-60"></div>
        </div>

        {isLoading ? (
          <div className="px-4 py-8 text-center text-sm opacity-40 font-black uppercase tracking-widest">
            Loading...
          </div>
        ) : !labels || labels.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm opacity-40 font-black uppercase tracking-widest">
            No labels created yet
          </div>
        ) : (
          labels.map((l) => (
            <div
              key={l.id}
              className="grid grid-cols-[auto_1fr_60px] border-b border-black/20 dark:border-white/20 group hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
            >
              <div className="px-4 py-3 w-16 flex items-center justify-center">
                <div className={`w-3.5 h-3.5 rounded-full bg-${l.color}-500 shadow-sm shadow-${l.color}-500/30`} />
              </div>
              <div className="px-4 py-3 font-bold text-sm flex items-center">{l.text}</div>
              <div className="px-4 py-3 flex items-center justify-center">
                <button
                  onClick={() => deleteLabel(l.id)}
                  disabled={deleteMutation.isPending}
                  className="w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 transition-opacity disabled:opacity-50"
                  title="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {labels && labels.length > 0 && (
        <div className="mt-3 text-[9px] font-black uppercase tracking-widest opacity-30 text-right">
          {labels.length} label{labels.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
