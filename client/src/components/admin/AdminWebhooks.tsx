import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import {
  Plus, Trash2, RefreshCw, Pencil, X, Check, Webhook,
  Play, Eye, EyeOff, KeyRound, ChevronDown, ChevronUp,
} from 'lucide-react';
import ErrorBox from './ErrorBox';
import Toast from '../Toast';
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
  'audit.chain_broken',
  '*',
] as const;

type WebhookEvent = (typeof ALL_EVENTS)[number];

const CARD = 'rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] shadow-[var(--shadow-card)]';
const INPUT = 'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const ICON_BTN = 'w-8 h-8 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const LABEL = 'text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5 block';
const PRIMARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-accent)] hover:brightness-110 text-white text-[13px] font-medium shadow-[var(--shadow-soft)] disabled:opacity-50 transition-all';
const SECONDARY_BTN = 'h-9 px-4 inline-flex items-center gap-1.5 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] text-[var(--color-ink)] text-[13px] font-medium transition-colors';

function EventChips({ events, selected, onToggle }: { events: readonly string[]; selected: string[]; onToggle: (e: WebhookEvent) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {events.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => onToggle(e as WebhookEvent)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-[var(--radius-pill)] transition-colors ${
            selected.includes(e)
              ? 'bg-[var(--color-accent)] text-white shadow-[var(--shadow-soft)]'
              : 'bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          {e === '*' ? 'ALL' : e}
        </button>
      ))}
    </div>
  );
}

export default function AdminWebhooks() {
  const t = useT();
  const isExternal = useIsExternalAdmin();
  const guestTooltip = t('guest_admin_disabled_tooltip');
  const guestTooltipShort = t('guest_admin_disabled_tooltip_short');

  const [showCreate, setShowCreate] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newEvents, setNewEvents] = useState<WebhookEvent[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editEvents, setEditEvents] = useState<WebhookEvent[]>([]);

  const [logsWebhookId, setLogsWebhookId] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

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

  const testMutation = trpc.webhook.test.useMutation({
    onSuccess: () => setToast({ message: 'Test event dispatched', type: 'success' }),
    onError: (err) => setToast({ message: err.message, type: 'error' }),
  });

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


  return (
    <div className="max-w-5xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">{t('webhooks')}</h2>
          <p className="text-[13px] text-[var(--color-ink-muted)] mt-1">{t('webhooks_desc')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(!showCreate)}
            disabled={isExternal}
            aria-disabled={isExternal || undefined}
            title={isExternal ? guestTooltip : undefined}
            data-guest-disabled={isExternal || undefined}
            className={PRIMARY_BTN}
          >
            <Plus className="h-3.5 w-3.5" /> New Webhook
          </button>
          <button
            onClick={() => invalidate()}
            className="w-9 h-9 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors"
            title={t('refresh') || 'Refresh'}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <ErrorBox error={error} />

      {/* Secret reveal banner */}
      {revealedSecret && (
        <div className="rounded-[var(--radius-card)] bg-[var(--color-accent-soft)] px-4 py-3 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-accent)] mb-1.5">
                Signing Secret — copy now, it won't be shown again
              </p>
              <code className="text-[12px] font-mono bg-[var(--color-bg-surface)] px-2 py-1 rounded-[var(--radius-btn)] select-all break-all text-[var(--color-ink)] inline-block">{revealedSecret}</code>
            </div>
            <button
              onClick={() => setRevealedSecret(null)}
              className="w-8 h-8 flex items-center justify-center rounded-full text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)] transition-colors shrink-0"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className={`${CARD} p-5 mb-6`}>
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-4">New Webhook Endpoint</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className={LABEL}>URL *</label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => { setNewUrl(e.target.value); setFieldErrors({}); }}
                placeholder="https://your-server.com/webhook"
                className={`${INPUT} ${fieldErrors.url ? 'border-[var(--color-urgent)]' : ''}`}
              />
              <FieldError error={fieldErrors.url} />
            </div>
            <div>
              <label className={LABEL}>Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="e.g. Slack notifications"
                className={INPUT}
              />
            </div>
          </div>
          <div className="mb-4">
            <label className={LABEL}>Events *</label>
            <EventChips events={ALL_EVENTS} selected={newEvents} onToggle={(e) => { toggleEvent(newEvents, e, setNewEvents); setFieldErrors({}); }} />
            <FieldError error={fieldErrors.events} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className={SECONDARY_BTN}>Cancel</button>
            <button
              onClick={addHook}
              disabled={isExternal || !newUrl.trim() || newEvents.length === 0 || createMutation.isPending}
              aria-disabled={isExternal || undefined}
              title={isExternal ? guestTooltip : undefined}
              data-guest-disabled={isExternal || undefined}
              className={PRIMARY_BTN}
            >
              <Plus className="h-3.5 w-3.5" /> {createMutation.isPending ? 'Creating…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Webhooks list */}
      <div className="space-y-3">
        {isLoading ? (
          <div className={`${CARD} px-4 py-8 text-center text-[13px] text-[var(--color-ink-muted)]`}>
            {t('loading') || 'Loading…'}
          </div>
        ) : !hooks || hooks.length === 0 ? (
          <div className={`${CARD} px-4 py-12 text-center`}>
            <Webhook className="h-10 w-10 mx-auto text-[var(--color-ink-muted)] opacity-50 mb-3" strokeWidth={1.5} />
            <p className="text-[13px] text-[var(--color-ink-muted)]">No webhooks configured</p>
          </div>
        ) : (
          hooks.map((h) => (
            <div key={h.id} className={CARD}>
              {editingId === h.id ? (
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className={LABEL}>URL</label>
                      <input type="url" value={editUrl} onChange={(e) => setEditUrl(e.target.value)} className={INPUT} />
                    </div>
                    <div>
                      <label className={LABEL}>Description</label>
                      <input type="text" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} className={INPUT} />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className={LABEL}>Events</label>
                    <EventChips events={ALL_EVENTS} selected={editEvents} onToggle={(e) => toggleEvent(editEvents, e, setEditEvents)} />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)} className={SECONDARY_BTN}>
                      <X className="h-3 w-3" /> Cancel
                    </button>
                    <button
                      onClick={saveEdit}
                      disabled={isExternal || !editUrl.trim() || editEvents.length === 0 || updateMutation.isPending}
                      aria-disabled={isExternal || undefined}
                      title={isExternal ? guestTooltip : undefined}
                      data-guest-disabled={isExternal || undefined}
                      className={PRIMARY_BTN}
                    >
                      <Check className="h-3 w-3" /> {updateMutation.isPending ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border)] gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Webhook className="h-4 w-4 shrink-0 text-[var(--color-ink-muted)]" />
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-[var(--color-ink)] truncate">{h.url}</p>
                        {h.description && <p className="text-[12px] text-[var(--color-ink-muted)] truncate mt-0.5">{h.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] ${
                        h.active
                          ? 'bg-[color-mix(in_srgb,var(--color-ok)_14%,transparent)] text-[var(--color-ok)]'
                          : 'bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)]'
                      }`}>
                        {h.active ? 'Active' : 'Paused'}
                      </span>
                      <button
                        onClick={() => updateMutation.mutate({ id: h.id, active: !h.active })}
                        disabled={isExternal}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className={ICON_BTN}
                        title={isExternal ? guestTooltip : (h.active ? 'Pause' : 'Activate')}
                      >
                        {h.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => testMutation.mutate({ id: h.id })}
                        disabled={isExternal || testMutation.isPending}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className={ICON_BTN}
                        title={isExternal ? guestTooltip : 'Send test event'}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => regenMutation.mutate({ id: h.id })}
                        disabled={isExternal || regenMutation.isPending}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className={ICON_BTN}
                        title={isExternal ? guestTooltipShort : 'Regenerate secret'}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => startEdit(h)}
                        disabled={isExternal}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className={ICON_BTN}
                        title={isExternal ? guestTooltip : 'Edit'}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => deleteMutation.mutate({ id: h.id })}
                        disabled={isExternal || deleteMutation.isPending}
                        aria-disabled={isExternal || undefined}
                        data-guest-disabled={isExternal || undefined}
                        className={ICON_BTN}
                        title={isExternal ? guestTooltip : 'Delete'}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex flex-wrap gap-1.5">
                      {((h.events as string[]) || []).map((e) => (
                        <span key={e} className="px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[11px] text-[var(--color-ink-soft)]">
                          {e === '*' ? 'ALL EVENTS' : e}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => setLogsWebhookId(logsWebhookId === h.id ? null : h.id)}
                      className="flex items-center gap-1 text-[12px] font-medium text-[var(--color-ink-muted)] hover:text-[var(--color-ink)] transition-colors"
                    >
                      Logs {logsWebhookId === h.id ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>

                  {logsWebhookId === h.id && (
                    <div className="border-t border-[var(--color-border)] px-4 py-3 bg-[var(--color-bg-elevated)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)] mb-2">Recent Deliveries</p>
                      {logsQuery.isLoading ? (
                        <p className="text-[12px] text-[var(--color-ink-muted)]">Loading…</p>
                      ) : !logsQuery.data || logsQuery.data.length === 0 ? (
                        <p className="text-[12px] text-[var(--color-ink-muted)] italic">No deliveries yet</p>
                      ) : (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {logsQuery.data.map((log) => {
                            const ok = log.statusCode && log.statusCode >= 200 && log.statusCode < 300;
                            return (
                              <div key={log.id} className="flex items-center gap-3 text-[12px] py-1.5 border-b border-[var(--color-border)] last:border-0">
                                <span className={`font-mono font-medium w-10 text-center tabular-nums ${
                                  ok
                                    ? 'text-[var(--color-ok)]'
                                    : log.error
                                      ? 'text-[var(--color-urgent)]'
                                      : 'text-[var(--color-ink-muted)]'
                                }`}>
                                  {log.statusCode || 'ERR'}
                                </span>
                                <span className="font-medium text-[var(--color-ink)]">{log.event}</span>
                                <span className="text-[var(--color-ink-muted)] tabular-nums">{log.durationMs}ms</span>
                                {log.error && <span className="text-[var(--color-urgent)] truncate max-w-48">{log.error}</span>}
                                <span className="ml-auto text-[var(--color-ink-muted)] tabular-nums">{new Date(log.createdAt).toLocaleTimeString()}</span>
                              </div>
                            );
                          })}
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
        <div className="mt-3 text-[12px] text-[var(--color-ink-muted)] text-right">
          {hooks.length} webhook{hooks.length !== 1 ? 's' : ''}
        </div>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
