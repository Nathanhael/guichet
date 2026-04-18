import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import {
  Plus, Trash2, RefreshCw, Pencil, X, Check, Webhook,
  Play, Eye, EyeOff, KeyRound, ChevronDown, ChevronUp,
} from 'lucide-react';
import ErrorBox from './ErrorBox';
import FieldError from '../FieldError';
import { webhookCreateSchema, validateForm, FieldErrors } from '../../validation/adminSchemas';
import { useIsExternalAdmin } from '../../hooks/useIsExternalAdmin';

const ALL_EVENTS = [
  'ticket.created',
  'ticket.closed',
  'ticket.assigned',
  'ticket.reopened',
  'message.created',
  'rating.submitted',
  'user.created',
  'user.deleted',
  // Cross-tenant compliance signal. Fires when verifyAuditChain detects a
  // hash mismatch in the WORM archive — subscribe the partner's on-call or
  // compliance channel so the incident reaches the right humans.
  'audit.chain_broken',
  '*',
] as const;

type WebhookEvent = (typeof ALL_EVENTS)[number];

export default function AdminWebhooks() {
  const t = useT();
  const isExternal = useIsExternalAdmin();
  const guestTooltip = t('guest_admin_disabled_tooltip');
  const guestTooltipShort = t('guest_admin_disabled_tooltip_short');
  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newEvents, setNewEvents] = useState<WebhookEvent[]>([]);

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editEvents, setEditEvents] = useState<WebhookEvent[]>([]);

  // Logs expand
  const [logsWebhookId, setLogsWebhookId] = useState<string | null>(null);

  // Secret display
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const utils = trpc.useUtils();
  const { data: hooks, isLoading, error: fetchError } = trpc.webhook.list.useQuery();
  const invalidate = () => utils.webhook.list.invalidate();

  const createMutation = trpc.webhook.create.useMutation({
    onSuccess: (data) => {
      setRevealedSecret(data.secret);
      setNewUrl('');
      setNewDesc('');
      setNewEvents([]);
      setShowCreate(false);
      invalidate();
    },
  });

  const updateMutation = trpc.webhook.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      invalidate();
    },
  });

  const deleteMutation = trpc.webhook.delete.useMutation({
    onSuccess: invalidate,
  });

  const regenMutation = trpc.webhook.regenerateSecret.useMutation({
    onSuccess: (data) => {
      setRevealedSecret(data.secret);
      invalidate();
    },
  });

  const testMutation = trpc.webhook.test.useMutation();

  const logsQuery = trpc.webhook.logs.useQuery(
    { webhookId: logsWebhookId || '' },
    { enabled: !!logsWebhookId }
  );

  const toggleEvent = (events: WebhookEvent[], event: WebhookEvent, setter: (e: WebhookEvent[]) => void) => {
    if (event === '*') {
      setter(events.includes('*') ? [] : ['*']);
      return;
    }
    const without = events.filter((e) => e !== '*');
    setter(without.includes(event) ? without.filter((e) => e !== event) : [...without, event]);
  };

  const addHook = () => {
    const errors = validateForm(webhookCreateSchema, { url: newUrl.trim(), events: newEvents, description: newDesc || undefined });
    if (errors) { setFieldErrors(errors); return; }
    setFieldErrors({});
    createMutation.mutate({
      url: newUrl.trim(),
      events: newEvents,
      description: newDesc.trim() || undefined,
    });
  };

  const startEdit = (h: { id: string; url: string; events?: unknown; description: string | null }) => {
    setEditingId(h.id);
    setEditUrl(h.url);
    setEditDesc(h.description || '');
    setEditEvents((h.events as WebhookEvent[]) || []);
  };

  const saveEdit = () => {
    if (!editingId || !editUrl.trim() || editEvents.length === 0) return;
    updateMutation.mutate({
      id: editingId,
      url: editUrl.trim(),
      events: editEvents,
      description: editDesc.trim() || null,
    });
  };

  const error = fetchError?.message || createMutation.error?.message || updateMutation.error?.message || deleteMutation.error?.message;

  function EventChips({ events, selected, onToggle }: { events: readonly string[]; selected: string[]; onToggle: (e: WebhookEvent) => void }) {
    return (
      <div className="flex flex-wrap gap-1">
        {events.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onToggle(e as WebhookEvent)}
            className={`px-2 py-1 text-[9px] font-bold uppercase tracking-wide border ${
              selected.includes(e)
                ? 'border-[var(--color-border)] bg-[var(--color-text-primary)] text-[var(--color-bg-base)]'
                : 'border-[var(--color-border)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
          >
            {e === '*' ? 'ALL' : e}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-bold uppercase tracking-wide">{t('webhooks')}</h2>
          <p className="text-xs uppercase text-[var(--color-text-secondary)] mt-1">{t('webhooks_desc')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(!showCreate)}
            disabled={isExternal}
            aria-disabled={isExternal || undefined}
            title={isExternal ? guestTooltip : undefined}
            data-guest-disabled={isExternal || undefined}
            className="btn-primary"
          >
            <Plus className="h-3.5 w-3.5" /> New Webhook
          </button>
          <button onClick={() => invalidate()} className="p-2 hover:bg-[var(--color-accent-blue)] hover:text-white" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <ErrorBox error={error} />

      {/* Secret reveal banner */}
      {revealedSecret && (
        <div className="border border-[var(--color-border)] bg-black/[0.02] dark:bg-white/[0.02] px-4 py-3 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] mb-1">
                Signing Secret — copy now, it won't be shown again
              </p>
              <code className="text-xs font-mono bg-bg-elevated px-2 py-1 select-all break-all">{revealedSecret}</code>
            </div>
            <button onClick={() => setRevealedSecret(null)} className="p-1 shrink-0 hover:bg-[var(--color-accent-blue)] hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="surface-card p-5 mb-6">
          <h3 className="font-mono text-[9px] uppercase text-[var(--color-text-muted)] tracking-wide mb-4">New Webhook Endpoint</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="mono-label mb-1.5 block">URL *</label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => { setNewUrl(e.target.value); setFieldErrors({}); }}
                placeholder="https://your-server.com/webhook"
                className={`input-field w-full ${fieldErrors.url ? 'border-[var(--color-accent-red)]' : ''}`}
              />
              <FieldError error={fieldErrors.url} />
            </div>
            <div>
              <label className="mono-label mb-1.5 block">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="e.g. Slack notifications"
                className="input-field w-full"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="mono-label mb-2 block">Events *</label>
            <EventChips events={ALL_EVENTS} selected={newEvents} onToggle={(e) => { toggleEvent(newEvents, e, setNewEvents); setFieldErrors({}); }} />
            <FieldError error={fieldErrors.events} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="btn-secondary">
              Cancel
            </button>
            <button
              onClick={addHook}
              disabled={isExternal || !newUrl.trim() || newEvents.length === 0 || createMutation.isPending}
              aria-disabled={isExternal || undefined}
              title={isExternal ? guestTooltip : undefined}
              data-guest-disabled={isExternal || undefined}
              className="btn-primary disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Webhooks list */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="surface-card px-4 py-8 text-center text-sm text-[var(--color-text-muted)] font-bold uppercase tracking-wide">
            Loading...
          </div>
        ) : !hooks || hooks.length === 0 ? (
          <div className="surface-card px-4 py-8 text-center text-sm text-[var(--color-text-muted)] font-bold uppercase tracking-wide">
            No webhooks configured
          </div>
        ) : (
          hooks.map((h) => (
            <div key={h.id} className="surface-card">
              {editingId === h.id ? (
                /* Edit form */
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="mono-label mb-1 block">URL</label>
                      <input type="url" value={editUrl} onChange={(e) => setEditUrl(e.target.value)}
                        className="input-field w-full" />
                    </div>
                    <div>
                      <label className="mono-label mb-1 block">Description</label>
                      <input type="text" value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                        className="input-field w-full" />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="mono-label mb-1 block">Events</label>
                    <EventChips events={ALL_EVENTS} selected={editEvents} onToggle={(e) => toggleEvent(editEvents, e, setEditEvents)} />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)}
                      className="btn-secondary">
                      <X className="h-3 w-3" /> Cancel
                    </button>
                    <button onClick={saveEdit}
                      disabled={isExternal || !editUrl.trim() || editEvents.length === 0 || updateMutation.isPending}
                      aria-disabled={isExternal || undefined}
                      title={isExternal ? guestTooltip : undefined}
                      data-guest-disabled={isExternal || undefined}
                      className="btn-primary disabled:opacity-50">
                      <Check className="h-3 w-3" /> {updateMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Header row */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)]">
                    <div className="flex items-center gap-3 min-w-0">
                      <Webhook className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{h.url}</p>
                        {h.description && <p className="text-[9px] text-[var(--color-text-muted)] truncate">{h.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={`text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 ${
                        h.active ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'
                      }`}>
                        {h.active ? 'Active' : 'Paused'}
                      </span>
                      <button
                        onClick={() => updateMutation.mutate({ id: h.id, active: !h.active })}
                        disabled={isExternal}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className="w-7 h-7 flex items-center justify-center hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isExternal ? guestTooltip : (h.active ? 'Pause' : 'Activate')}
                      >
                        {h.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => testMutation.mutate({ id: h.id })}
                        disabled={isExternal || testMutation.isPending}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className="w-7 h-7 flex items-center justify-center hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isExternal ? guestTooltip : 'Send test event'}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => regenMutation.mutate({ id: h.id })}
                        disabled={isExternal || regenMutation.isPending}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className="w-7 h-7 flex items-center justify-center hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isExternal ? guestTooltipShort : 'Regenerate secret'}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => startEdit(h)}
                        disabled={isExternal}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className="w-7 h-7 flex items-center justify-center hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                        title={isExternal ? guestTooltip : 'Edit'}>
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deleteMutation.mutate({ id: h.id })}
                        disabled={isExternal || deleteMutation.isPending}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className="w-7 h-7 flex items-center justify-center hover:bg-[var(--color-accent-blue)] hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                        title={isExternal ? guestTooltip : 'Delete'}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Events row */}
                  <div className="px-4 py-2 flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {((h.events as string[]) || []).map((e) => (
                        <span key={e} className="px-1.5 py-0.5 bg-bg-elevated text-[8px] font-bold uppercase tracking-wide">
                          {e === '*' ? 'ALL EVENTS' : e}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => setLogsWebhookId(logsWebhookId === h.id ? null : h.id)}
                      className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wide text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    >
                      Logs {logsWebhookId === h.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>

                  {/* Logs panel */}
                  {logsWebhookId === h.id && (
                    <div className="border-t border-[var(--color-border)] px-4 py-3 bg-black/[0.02] dark:bg-white/[0.02]">
                      <p className="font-mono text-[8px] uppercase tracking-wide text-[var(--color-text-muted)] mb-2">Recent Deliveries</p>
                      {logsQuery.isLoading ? (
                        <p className="text-xs text-[var(--color-text-muted)]">Loading...</p>
                      ) : !logsQuery.data || logsQuery.data.length === 0 ? (
                        <p className="text-xs text-[var(--color-text-muted)] italic">No deliveries yet</p>
                      ) : (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {logsQuery.data.map((log) => (
                            <div key={log.id} className="flex items-center gap-3 text-[10px] py-1 border-b border-[var(--color-border)] last:border-0">
                              <span className={`font-mono font-bold w-8 text-center ${
                                log.statusCode && log.statusCode >= 200 && log.statusCode < 300
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : log.error
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'text-[var(--color-text-muted)]'
                              }`}>
                                {log.statusCode || 'ERR'}
                              </span>
                              <span className="font-bold uppercase">{log.event}</span>
                              <span className="text-[var(--color-text-muted)]">{log.durationMs}ms</span>
                              {log.error && <span className="text-rose-500 truncate max-w-48">{log.error}</span>}
                              <span className="ml-auto text-[var(--color-text-muted)]">{new Date(log.createdAt).toLocaleTimeString()}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </div>

      {hooks && hooks.length > 0 && (
        <div className="mt-3 font-mono text-[9px] uppercase tracking-wide text-[var(--color-text-muted)] text-right">
          {hooks.length} webhook{hooks.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
