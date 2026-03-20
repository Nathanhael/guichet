import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import useStore from '../../store/useStore';

export default function AdminCannedResponses() {
  const { activePartnerId } = useStore();
  const [newShortcut, setNewShortcut] = useState('');
  const [newText, setNewText] = useState('');

  const { data: responses, isLoading, refetch } = trpc.cannedResponse.list.useQuery(
    { partnerId: activePartnerId || '' },
    { enabled: !!activePartnerId }
  );
  const createMutation = trpc.cannedResponse.create.useMutation({
    onSuccess: () => { setNewShortcut(''); setNewText(''); refetch(); },
  });
  const deleteMutation = trpc.cannedResponse.delete.useMutation({ onSuccess: () => refetch() });

  const error = (createMutation.error || deleteMutation.error)?.message;

  const handleAdd = () => {
    if (!newShortcut.trim() || !newText.trim() || !activePartnerId) return;
    createMutation.mutate({ partnerId: activePartnerId, shortcut: newShortcut, text: newText });
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="border-b-4 border-black dark:border-white pb-4">
        <h2 className="text-4xl font-black uppercase tracking-tighter">Canned Responses</h2>
        <p className="text-sm font-bold uppercase opacity-60 mt-1 tracking-widest">Shortcuts for frequently used messages.</p>
      </div>

      {error && (
        <div className="border-2 border-black dark:border-white p-4">
          <p className="text-xs font-black uppercase tracking-widest">{error}</p>
        </div>
      )}

      <div className="border-2 border-black dark:border-white p-6">
        <h3 className="text-[10px] font-black uppercase tracking-widest mb-4">Add New Shortcut</h3>
        <div className="flex gap-4 mb-4">
          <div className="w-1/3">
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Shortcut</label>
            <input
              type="text"
              value={newShortcut}
              onChange={(e) => setNewShortcut(e.target.value)}
              placeholder="/hi"
              className="w-full bg-transparent border-2 border-black dark:border-white px-3 py-2 text-sm font-bold font-mono outline-none"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[10px] font-black uppercase tracking-widest mb-1">Full Message</label>
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              placeholder="Hello! How can I help you today?"
              className="w-full bg-transparent border-2 border-black dark:border-white px-3 py-2 text-sm font-bold outline-none"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <button
            onClick={handleAdd}
            disabled={!newShortcut.trim() || !newText.trim() || createMutation.isPending}
            className="bg-black dark:bg-white text-white dark:text-black px-6 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white disabled:opacity-30"
          >
            {createMutation.isPending ? 'Adding...' : 'Add Shortcut'}
          </button>
        </div>
      </div>

      <div className="border-2 border-black dark:border-white overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-black/5 dark:bg-white/5 border-b-2 border-black dark:border-white">
              <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest">Shortcut</th>
              <th className="px-5 py-3 text-[10px] font-black uppercase tracking-widest">Message</th>
              <th className="px-5 py-3 text-right text-[10px] font-black uppercase tracking-widest"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/20 dark:divide-white/20">
            {isLoading ? (
              <tr><td colSpan={3} className="px-5 py-8 text-center text-[10px] font-black uppercase opacity-50">Loading...</td></tr>
            ) : !responses?.length ? (
              <tr><td colSpan={3} className="px-5 py-12 text-center text-[10px] font-black uppercase opacity-50">No shortcuts yet.</td></tr>
            ) : responses.map((r) => (
              <tr key={r.id}>
                <td className="px-5 py-4">
                  <code className="text-xs font-black font-mono border border-black dark:border-white px-2 py-0.5">{r.shortcut}</code>
                </td>
                <td className="px-5 py-4 text-sm">{r.text}</td>
                <td className="px-5 py-4 text-right">
                  <button
                    onClick={() => deleteMutation.mutate(r.id)}
                    className="text-[10px] font-black uppercase tracking-widest border border-black dark:border-white px-3 py-1"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
