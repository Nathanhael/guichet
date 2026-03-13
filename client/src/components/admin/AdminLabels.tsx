import { useState } from 'react';
import { trpc } from '../../utils/trpc';

export default function AdminLabels() {
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
    { key: 'blue', bg: 'bg-blue-500', text: 'text-blue-500' },
    { key: 'indigo', bg: 'bg-indigo-500', text: 'text-indigo-500' },
    { key: 'purple', bg: 'bg-purple-500', text: 'text-purple-500' },
    { key: 'emerald', bg: 'bg-emerald-500', text: 'text-emerald-500' },
    { key: 'teal', bg: 'bg-teal-500', text: 'text-teal-500' },
    { key: 'cyan', bg: 'bg-cyan-500', text: 'text-cyan-500' },
    { key: 'sky', bg: 'bg-sky-500', text: 'text-sky-500' },
    { key: 'amber', bg: 'bg-amber-500', text: 'text-amber-500' },
    { key: 'orange', bg: 'bg-orange-500', text: 'text-orange-500' },
    { key: 'rose', bg: 'bg-rose-500', text: 'text-rose-500' },
    { key: 'pink', bg: 'bg-pink-500', text: 'text-pink-500' },
    { key: 'slate', bg: 'bg-slate-500', text: 'text-slate-500' },
  ];

  const error = fetchError?.message || createMutation.error?.message || deleteMutation.error?.message;

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-solarized-base01 dark:text-white tracking-tight">Label Management</h2>
          <p className="text-sm text-solarized-base1">Manage tags for experts to categorize chats.</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-lg bg-solarized-base2 dark:bg-brand-900/50 text-solarized-base1 hover:text-brand-500 transition-colors"
          title="Refresh Labels"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-xl flex items-center gap-3 animate-shake">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-red-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-medium text-red-700 dark:text-red-300">{error}</span>
        </div>
      )}

      <div className="glass-card p-6 shadow-soft">
        <h3 className="text-sm font-bold uppercase tracking-wider text-solarized-base1 mb-4">Create New Label</h3>
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase">Label Name</label>
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="e.g. Bug Report"
              className="w-full bg-gray-50 dark:bg-brand-900 border border-gray-200 dark:border-brand-700 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-solarized-base1 mb-1.5 uppercase">Color</label>
            <div className="flex gap-2 p-1.5 bg-solarized-base3 dark:bg-brand-900 border border-solarized-base2 dark:border-brand-700 rounded-xl">
              {colors.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setNewColor(c.key)}
                  className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${c.bg} ${newColor === c.key ? 'ring-2 ring-offset-2 ring-brand-500 dark:ring-offset-brand-900 scale-110' : 'opacity-60 hover:opacity-100'}`}
                />
              ))}
            </div>
          </div>
          <button
            onClick={addLabel}
            disabled={!newText.trim() || createMutation.isPending}
            className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-brand-500/20"
          >
            {createMutation.isPending ? 'Adding...' : 'Add Label'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {isLoading ? (
          <p className="text-solarized-base1">Loading labels...</p>
        ) : !labels || labels.length === 0 ? (
          <p className="col-span-2 text-center py-12 text-solarized-base1 bg-solarized-base2 dark:bg-brand-900/40 rounded-2xl border-2 border-dashed border-solarized-base2 dark:border-brand-700">
            No labels created yet. Add one above!
          </p>
        ) : (
          labels.map((l) => (
            <div
              key={l.id}
              className="bg-solarized-base3 dark:bg-brand-800 rounded-2xl border border-solarized-base2 dark:border-brand-700 p-4 flex items-center justify-between group hover:shadow-md transition-all animate-slide-up"
            >
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full bg-${l.color}-500 shadow-sm shadow-${l.color}-500/40`} />
                <span className="font-bold text-solarized-base01 dark:text-gray-100">{l.text}</span>
              </div>
              <button
                onClick={() => deleteLabel(l.id)}
                disabled={deleteMutation.isPending}
                className="opacity-0 group-hover:opacity-100 p-2 text-solarized-base1 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-50"
                title="Delete Label"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
