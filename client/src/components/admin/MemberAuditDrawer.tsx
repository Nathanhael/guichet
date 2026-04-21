import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { trpc } from '../../utils/trpc';
import AuditMetadataDrawer, { AuditEntry } from './AuditMetadataDrawer';

interface Props {
  userId: string | null;
  userName?: string;
  departments?: Array<{ id: string; name: string }>;
  onClose: () => void;
}

// Pull role/department facets out of the audit row's metadata. The audit
// service stores snapshots (not diffs) so each row tells us what the state
// *became* at that moment — sequential rows read chronologically reveal the
// evolution without needing a drill-in.
function extractFacets(entry: { metadata: unknown }): {
  role?: string;
  departments?: string[];
  oldRole?: string;
  newRole?: string;
} {
  const m = entry.metadata as Record<string, unknown> | null;
  if (!m || typeof m !== 'object') return {};
  const out: { role?: string; departments?: string[]; oldRole?: string; newRole?: string } = {};
  if (typeof m.role === 'string') out.role = m.role;
  if (typeof m.oldRole === 'string') out.oldRole = m.oldRole;
  if (typeof m.newRole === 'string') out.newRole = m.newRole;
  if (Array.isArray(m.departments) && m.departments.every((d) => typeof d === 'string')) {
    out.departments = m.departments as string[];
  }
  return out;
}

// Per-user audit trail. Shows rows where this user is the target (member
// invites/updates/removals, SSO role syncs, etc.) — narrower than the full
// partner audit page and deep-linked from member rows and the admin chips.
export default function MemberAuditDrawer({ userId, userName, departments, onClose }: Props) {
  const deptNameFor = (id: string) => departments?.find((d) => d.id === id)?.name ?? id;
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  const query = trpc.partner.audit.getAuditLog.useQuery(
    { targetType: 'user', targetId: userId || '', limit: 50 },
    { enabled: !!userId },
  );

  useEffect(() => {
    if (!userId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !selected) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [userId, onClose, selected]);

  if (!userId) return null;

  const entries = (query.data?.items as AuditEntry[] | undefined) ?? [];

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Member audit history"
        className="fixed top-0 right-0 h-full w-full max-w-xl bg-[var(--color-bg-surface)] shadow-[var(--shadow-modal)] z-50 overflow-y-auto flex flex-col"
      >
        <div className="flex justify-between items-start p-5 border-b border-[var(--color-border)]">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-[var(--color-ink)]">Member audit</h3>
            <p className="text-[12px] text-[var(--color-ink-muted)] mt-1 truncate">{userName || userId}</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 flex-1">
          {query.isLoading ? (
            <p className="text-[13px] text-[var(--color-ink-muted)]">Loading…</p>
          ) : query.error ? (
            <p className="text-[13px] text-[var(--color-urgent)]">{query.error.message}</p>
          ) : entries.length === 0 ? (
            <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] px-4 py-10 text-center">
              <p className="text-[13px] font-medium text-[var(--color-ink-soft)] mb-1">No audit history</p>
              <p className="text-[12px] text-[var(--color-ink-muted)]">
                No audit entries reference this user yet.
              </p>
            </div>
          ) : (
            <ul
              className="divide-y divide-[var(--color-border)] rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] overflow-hidden"
              data-testid="member-audit-list"
            >
              {entries.map((entry) => {
                const facets = extractFacets(entry);
                const roleLabel = facets.oldRole && facets.newRole && facets.oldRole !== facets.newRole
                  ? `${facets.oldRole} → ${facets.newRole}`
                  : facets.role ?? facets.newRole;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(entry)}
                      className="w-full text-left px-4 py-3 hover:bg-[var(--color-hover)] focus:outline-none focus:bg-[var(--color-hover)] transition-colors"
                    >
                      <div className="flex justify-between items-start gap-3 mb-1">
                        <span className="font-mono text-[12px] font-semibold text-[var(--color-ink)] break-all">
                          {entry.action}
                        </span>
                        <span className="text-[11px] text-[var(--color-ink-muted)] shrink-0 tabular-nums">
                          {new Date(entry.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-[11px] text-[var(--color-ink-muted)]">
                        {entry.actorName || entry.actorId || 'System'}
                      </p>
                      {(roleLabel || (facets.departments && facets.departments.length > 0)) && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {roleLabel && (
                            <span className="inline-flex items-center px-1.5 h-5 rounded-[var(--radius-pill)] bg-[var(--color-bg-surface)] text-[10px] font-medium text-[var(--color-ink)] capitalize">
                              {roleLabel}
                            </span>
                          )}
                          {facets.departments && facets.departments.length === 0 && (
                            <span className="text-[10px] italic text-[var(--color-ink-muted)]">no departments</span>
                          )}
                          {facets.departments?.map((id) => (
                            <span
                              key={id}
                              className="inline-flex items-center px-1.5 h-5 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[10px] font-medium text-[var(--color-accent)]"
                            >
                              {deptNameFor(id)}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

      <AuditMetadataDrawer entry={selected} onClose={() => setSelected(null)} />
    </>
  );
}
