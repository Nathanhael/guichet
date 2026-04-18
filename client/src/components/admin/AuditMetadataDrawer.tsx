import { useEffect, useState } from 'react';

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
}

export default function AuditMetadataDrawer({ entry, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!entry) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [entry, onClose]);

  useEffect(() => {
    setCopied(false);
  }, [entry]);

  if (!entry) return null;

  const pretty = JSON.stringify(entry.metadata ?? {}, null, 2);

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
        className="fixed top-0 right-0 h-full w-full max-w-xl bg-[var(--color-bg-surface)] border-l border-[var(--color-border-heavy)] z-50 overflow-y-auto flex flex-col"
      >
        <div className="flex justify-between items-start p-6 border-b border-[var(--color-border)]">
          <div>
            <h3 className="text-lg font-bold uppercase tracking-wide">{entry.action}</h3>
            <p className="mono-label mt-2">{new Date(entry.createdAt).toLocaleString()}</p>
          </div>
          <button
            onClick={onClose}
            className="btn-secondary"
            aria-label="Close"
          >
            Close
          </button>
        </div>

        <div className="p-6 space-y-4 border-b border-[var(--color-border)]">
          <Field label="Actor" value={entry.actorName || entry.actorId || 'System'} />
          <Field label="Target type" value={entry.targetType || '—'} />
          <Field label="Target id" value={entry.targetId || '—'} mono />
          {entry.partnerId !== undefined && (
            <Field label="Partner id" value={entry.partnerId || '—'} mono />
          )}
          <Field label="Audit entry id" value={entry.id} mono />
        </div>

        <div className="p-6 flex-1">
          <div className="flex justify-between items-center mb-3">
            <p className="mono-label">Metadata (JSON)</p>
            <button
              onClick={handleCopy}
              className="btn-secondary"
              id="audit-drawer-copy"
            >
              {copied ? 'Copied!' : 'Copy JSON'}
            </button>
          </div>
          <pre
            className="font-mono text-xs whitespace-pre-wrap break-words p-4 border border-[var(--color-border)] bg-[var(--color-bg-base)] max-h-[60vh] overflow-y-auto"
            data-testid="audit-metadata-json"
          >
            {pretty}
          </pre>
        </div>
      </aside>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="mono-label mb-1">{label}</p>
      <p className={mono ? 'font-mono text-xs break-all' : 'text-sm'}>{value}</p>
    </div>
  );
}
