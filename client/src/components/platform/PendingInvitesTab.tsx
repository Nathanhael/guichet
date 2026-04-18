import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import Toast from '../Toast';

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  const mins = Math.floor(ms / 60_000);
  return `${Math.max(mins, 0)}m ago`;
}

export default function PendingInvitesTab() {
  const { data, isLoading } = trpc.platform.listPendingGuestInvites.useQuery();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const rows = data || [];

  async function copyEmail(email: string | null) {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(email);
      setToast({ message: `Copied ${email}`, type: 'success' });
    } catch {
      setToast({ message: 'Copy failed', type: 'error' });
    }
  }

  return (
    <div className="max-w-6xl space-y-6 pb-12">
      <div>
        <h2 className="text-2xl font-bold uppercase tracking-tight">Pending Entra Invites</h2>
        <p className="text-xs uppercase font-bold text-[var(--color-text-secondary)] mt-1 tracking-wide">
          External users invited in Guichet but not yet linked to Azure. Send them an Entra B2B invite.
        </p>
      </div>

      {isLoading ? (
        <div className="py-8 text-center uppercase font-bold text-[var(--color-text-muted)]">Loading</div>
      ) : rows.length === 0 ? (
        <div className="surface-card py-16 text-center">
          <p className="text-sm font-bold uppercase tracking-wide text-[var(--color-text-muted)]">No pending invites</p>
          <p className="text-[10px] uppercase text-[var(--color-text-muted)] mt-2 opacity-60">
            Every external invite is linked to an Entra account.
          </p>
        </div>
      ) : (
        <div className="surface-card overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[720px]">
            <thead>
              <tr className="bg-bg-elevated border-b border-[var(--color-border)]">
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Email</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Name</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Partner</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Role</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Invited</th>
                <th className="p-3 font-mono text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)]">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-border)]">
              {rows.map(row => (
                <tr key={row.membershipId} className="hover:bg-black/[0.02] dark:hover:bg-white/[0.02]">
                  <td className="p-3 text-xs font-mono">{row.email || '-'}</td>
                  <td className="p-3 text-xs">{row.name || '-'}</td>
                  <td className="p-3 text-xs font-bold uppercase">{row.partnerName}</td>
                  <td className="p-3 text-[10px] font-mono uppercase text-[var(--color-text-secondary)]">{row.role}</td>
                  <td className="p-3 text-[10px] font-mono text-[var(--color-text-secondary)] whitespace-nowrap">
                    {relativeAge(row.membershipCreatedAt)}
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => copyEmail(row.email)}
                      className="btn-secondary text-[10px]"
                    >
                      Copy email
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
