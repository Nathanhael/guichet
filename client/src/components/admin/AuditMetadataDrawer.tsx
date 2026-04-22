import { useEffect, useState } from 'react';
import { X, Check, Copy } from 'lucide-react';

export type AuditEntry = {
  id: string;
  action: string;
  actorId: string | null;
  actorName: string | null;
  partnerId?: string | null;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
  createdAt: string;
};

interface Props {
  entry: AuditEntry | null;
  onClose: () => void;
  /**
   * Called when the operator clicks a "filter by this actor/target" action in
   * the drawer. The parent wires each field to the corresponding filter state
   * so the drawer becomes a lightweight triage pivot. Omit to hide the buttons.
   */
  onFilterBy?: (field: 'actorId' | 'targetId' | 'targetType', value: string) => void;
}

export default function AuditMetadataDrawer({ entry, onClose, onFilterBy }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!entry) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entry, onClose]);

  // Reset the "copied" indicator when the drawer opens onto a different entry.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCopied(false);
  }, [entry]);

  if (!entry) return null;

  const pretty = JSON.stringify(entry.metadata ?? {}, null, 2);
  const diffRows = extractDiffRows(entry.metadata);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(pretty);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable (iframe, insecure context) — swallow silently;
      // the JSON is still visible on screen.
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/40 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        role="dialog"
        aria-label="Audit entry details"
        className="fixed top-0 right-0 h-full w-full max-w-xl bg-[var(--color-bg-surface)] shadow-[var(--shadow-modal)] z-50 overflow-y-auto flex flex-col"
      >
        <div className="flex justify-between items-start p-5 border-b border-[var(--color-border)]">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-[var(--color-ink)] font-mono break-all">{entry.action}</h3>
            <p className="text-[12px] text-[var(--color-ink-muted)] mt-1 tabular-nums">{new Date(entry.createdAt).toLocaleString()}</p>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors shrink-0"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-5 space-y-4 border-b border-[var(--color-border)]">
          <Field
            label="Actor"
            value={entry.actorName || entry.actorId || 'System'}
            action={
              onFilterBy && entry.actorId
                ? {
                    label: 'Filter by actor',
                    onClick: () => {
                      onFilterBy('actorId', entry.actorId!);
                      onClose();
                    },
                  }
                : undefined
            }
          />
          <Field
            label="Target type"
            value={entry.targetType || '—'}
            action={
              onFilterBy && entry.targetType
                ? {
                    label: 'Filter',
                    onClick: () => {
                      onFilterBy('targetType', entry.targetType!);
                      onClose();
                    },
                  }
                : undefined
            }
          />
          <Field
            label="Target id"
            value={entry.targetId || '—'}
            mono
            action={
              onFilterBy && entry.targetId
                ? {
                    label: 'Filter',
                    onClick: () => {
                      onFilterBy('targetId', entry.targetId!);
                      onClose();
                    },
                  }
                : undefined
            }
          />
          {entry.partnerId !== undefined && (
            <Field label="Partner id" value={entry.partnerId || '—'} mono />
          )}
          <Field label="Audit entry id" value={entry.id} mono />
        </div>

        {diffRows.length > 0 && (
          <div className="p-5 border-b border-[var(--color-border)]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-3">Changes</p>
            <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] overflow-hidden">
              <table
                className="w-full border-collapse"
                data-testid="audit-diff-table"
              >
                <thead>
                  <tr className="border-b border-[var(--color-border)]">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">Field</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">Before</th>
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">After</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-border)]">
                  {diffRows.map(row => (
                    <tr key={row.field}>
                      <td className="px-3 py-2 font-mono text-[11px] text-[var(--color-ink)] break-all">{row.field}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[var(--color-ink-muted)] line-through break-all">{row.before}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-[var(--color-ink)] break-all">{row.after}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="p-5 flex-1">
          <div className="flex justify-between items-center mb-3 gap-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">Metadata (JSON)</p>
            <button
              onClick={handleCopy}
              className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[12px] font-medium text-[var(--color-ink)] transition-colors"
              id="audit-drawer-copy"
            >
              {copied ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy JSON</>}
            </button>
          </div>
          <pre
            className="font-mono text-[12px] whitespace-pre-wrap break-words p-4 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] max-h-[60vh] overflow-y-auto"
            data-testid="audit-metadata-json"
          >
            {pretty}
          </pre>
        </div>
      </aside>
    </>
  );
}

type DiffRow = { field: string; before: string; after: string };

// Audit rows that represent a state change (role swap, config edit, etc.)
// tend to record before/after pairs under either old<Suffix>/new<Suffix> or
// previous<Suffix>/new<Suffix> keys. Extract those into a proper diff table so
// the reader doesn't have to parse the raw JSON mentally. Primitives are
// stringified verbatim and objects/arrays are JSON-dumped so nested values
// (e.g. a departments array) still render in a single cell.
function extractDiffRows(metadata: unknown): DiffRow[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return [];
  const obj = metadata as Record<string, unknown>;
  const rows: DiffRow[] = [];
  const matchers: Array<[RegExp, string]> = [
    [/^old([A-Z].*)$/, 'new'],
    [/^previous([A-Z].*)$/, 'new'],
  ];
  const seen = new Set<string>();
  for (const key of Object.keys(obj)) {
    for (const [pattern, counterpartPrefix] of matchers) {
      const m = key.match(pattern);
      if (!m) continue;
      const suffix = m[1];
      const newKey = `${counterpartPrefix}${suffix}`;
      if (!(newKey in obj) || seen.has(suffix)) continue;
      seen.add(suffix);
      rows.push({
        field: suffix.charAt(0).toLowerCase() + suffix.slice(1),
        before: renderValue(obj[key]),
        after: renderValue(obj[newKey]),
      });
    }
  }
  return rows;
}

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function Field({
  label,
  value,
  mono,
  action,
}: {
  label: string;
  value: string;
  mono?: boolean;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1 gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">{label}</p>
        {action && (
          <button
            type="button"
            onClick={action.onClick}
            className="text-[11px] font-medium text-[var(--color-accent)] hover:underline"
          >
            {action.label}
          </button>
        )}
      </div>
      <p className={mono ? 'font-mono text-[12px] text-[var(--color-ink)] break-all' : 'text-[13px] text-[var(--color-ink)]'}>{value}</p>
    </div>
  );
}
