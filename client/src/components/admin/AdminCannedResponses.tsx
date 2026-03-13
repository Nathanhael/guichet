import { useState } from 'react';
import { trpc } from '../../utils/trpc';

export default function AdminCannedResponses() {
  const [newShortcut, setNewShortcut] = useState('');
  const [newText, setNewText] = useState('');

  const { data: responses, isLoading, error: fetchError, refetch } = trpc.cannedResponse.list.useQuery();
  
  const createMutation = trpc.cannedResponse.create.useMutation({
    onSuccess: () => {
      setNewShortcut('');
      setNewText('');
      refetch();
    },
  });

  const deleteMutation = trpc.cannedResponse.delete.useMutation({
    onSuccess: () => {
      refetch();
    },
  });

  const addResponse = () => {
    if (!newShortcut.trim() || !newText.trim()) return;
    createMutation.mutate({ shortcut: newShortcut, text: newText });
  };

  const deleteResponse = (id: string) => {
    deleteMutation.mutate(id);
  };

  const error = fetchError?.message || createMutation.error?.message || deleteMutation.error?.message;

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-solarized-base01 dark:text-white tracking-tight">Canned Responses</h2>
          <p className="text-sm text-solarized-base1">Create shortcuts for frequently used messages.</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-2 rounded-lg bg-solarized-base2 dark:bg-brand-900/50 text-solarized-base1 hover:text-brand-500 transition-colors"
          title="Refresh"
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
        <h3 className="text-sm font-bold uppercase tracking-wider text-solarized-base1 mb-4">Add New Shortcut</h3>
        <div className="space-y-4">
          <div className="flex gap-4">
            <div className="w-1/3">
              <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase">Shortcut (e.g. /hello)</label>
              <input
                type="text"
                value={newShortcut}
                onChange={(e) => setNewShortcut(e.target.value)}
                placeholder="/hi"
                className="w-full bg-gray-50 dark:bg-brand-900 border border-gray-200 dark:border-brand-700 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:text-white"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-400 mb-1.5 uppercase">Full Message</label>
              <input
                type="text"
                value={newText}
                onChange={(e) => setNewText(e.target.value)}
                placeholder="Hello! How can I help you today?"
                className="w-full bg-gray-50 dark:bg-brand-900 border border-gray-200 dark:border-brand-700 rounded-xl px-4 py-2 text-sm focus:ring-2 focus:ring-brand-500 outline-none transition-all dark:text-white"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={addResponse}
              disabled={!newShortcut.trim() || !newText.trim() || createMutation.isPending}
              className="bg-brand-500 hover:bg-brand-600 text-white px-6 py-2 rounded-xl text-sm font-bold transition-all disabled:opacity-50 shadow-md"
            >
              {createMutation.isPending ? 'Adding...' : 'Add Response'}
            </button>
          </div>
        </div>
      </div>

      <div className="bg-solarized-base3 dark:bg-brand-800 rounded-2xl border border-solarized-base2 dark:border-brand-700 overflow-hidden shadow-sm">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-solarized-base2 dark:bg-brand-900/50">
              <th className="px-6 py-3 text-xs font-bold uppercase tracking-wider text-solarized-base1 border-b border-solarized-base2 dark:border-brand-700">Shortcut</th>
              <th className="px-6 py-3 text-xs font-bold uppercase tracking-wider text-solarized-base1 border-b border-solarized-base2 dark:border-brand-700">Full Message</th>
              <th className="px-6 py-3 text-right border-b border-solarized-base2 dark:border-brand-700"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-solarized-base2 dark:divide-brand-700">
            {isLoading ? (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-solarized-base1 animate-pulse">Loading responses...</td></tr>
            ) : !responses || responses.length === 0 ? (
              <tr><td colSpan={3} className="px-6 py-12 text-center text-solarized-base1">No canned responses yet.</td></tr>
            ) : (
              responses.map((r) => (
                <tr key={r.id} className="group hover:bg-solarized-base2/30 dark:hover:bg-brand-900/20 transition-colors">
                  <td className="px-6 py-4">
                    <code className="text-xs font-bold text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-brand-900/40 px-2 py-1 rounded">{r.shortcut}</code>
                  </td>
                  <td className="px-6 py-4 text-sm text-solarized-base01 dark:text-gray-300">{r.text}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => deleteResponse(r.id)}
                      className="opacity-0 group-hover:opacity-100 p-2 text-solarized-base1 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
