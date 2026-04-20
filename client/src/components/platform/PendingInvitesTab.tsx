import { useState } from 'react';
import { Copy } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import Toast from '../Toast';
import ConfirmDialog from '../ConfirmDialog';
import Button from '../ui/Button';

function relativeAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours > 0) return `${hours}h ago`;
  const mins = Math.floor(ms / 60_000);
  return `${Math.max(mins, 0)}m ago`;
}

const TH = 'px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]';
const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)]';

export default function PendingInvitesTab() {
  const { data, isLoading } = trpc.platform.listPendingGuestInvites.useQuery();
  const utils = trpc.useUtils();
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<
    { membershipId: string; email: string; partnerName: string } | null
  >(null);

  const revokeMutation = trpc.platform.revokePendingInvite.useMutation({
    onSuccess: () => {
      setToast({ message: 'Invite revoked', type: 'success' });
      utils.platform.listPendingGuestInvites.invalidate();
    },
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

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
        <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">Pending Entra Invites</h2>
        <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">
          External users invited in Guichet but not yet linked to Azure. Send them an Entra B2B invite.
        </p>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-[13px] text-[var(--color-ink-muted)]">Loading…</div>
      ) : rows.length === 0 ? (
        <div className={`${CARD} py-16 text-center`}>
          <p className="text-[14px] font-medium text-[var(--color-ink)]">No pending invites</p>
          <p className="text-[12px] text-[var(--color-ink-muted)] mt-2">
            Every external invite is linked to an Entra account.
          </p>
        </div>
      ) : (
        <div className={`${CARD} overflow-hidden`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[720px]">
              <thead>
                <tr className="bg-[var(--color-bg-elevated)] border-b border-[var(--color-border)]">
                  <th className={TH}>Email</th>
                  <th className={TH}>Name</th>
                  <th className={TH}>Partner</th>
                  <th className={TH}>Role</th>
                  <th className={TH}>Invited</th>
                  <th className={TH}>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.membershipId} className="border-b border-[var(--color-border)] last:border-b-0 hover:bg-[var(--color-hover)] transition-colors">
                    <td className="px-4 py-3 text-[13px] text-[var(--color-ink)]">{row.email || '—'}</td>
                    <td className="px-4 py-3 text-[13px] text-[var(--color-ink)]">{row.name || '—'}</td>
                    <td className="px-4 py-3 text-[13px] font-medium text-[var(--color-ink)]">{row.partnerName}</td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-ink-soft)]">{row.role}</td>
                    <td className="px-4 py-3 text-[12px] text-[var(--color-ink-soft)] whitespace-nowrap">
                      {relativeAge(row.membershipCreatedAt)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          leading={<Copy className="h-3.5 w-3.5" />}
                          onClick={() => copyEmail(row.email)}
                        >
                          Copy email
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => setConfirmRevoke({
                            membershipId: row.membershipId,
                            email: row.email || '(no email)',
                            partnerName: row.partnerName,
                          })}
                        >
                          Revoke
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {confirmRevoke && (
        <ConfirmDialog
          title="Revoke pending invite"
          message={`Revoke the invite for ${confirmRevoke.email} at ${confirmRevoke.partnerName}? The membership will be deleted. If this is their only membership, the user record will be soft-deleted so the email can be re-invited.`}
          confirmLabel="Revoke"
          onConfirm={() => {
            revokeMutation.mutate({ membershipId: confirmRevoke.membershipId });
            setConfirmRevoke(null);
          }}
          onCancel={() => setConfirmRevoke(null)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
