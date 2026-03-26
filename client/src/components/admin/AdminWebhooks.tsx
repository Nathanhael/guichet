import { useState } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';
import {
  Plus, Trash2, RefreshCw, Pencil, X, Check, Webhook,
  Play, Eye, EyeOff, KeyRound, ChevronDown, ChevronUp,
} from 'lucide-react';

const ALL_EVENTS = [
  'ticket.created',
  'ticket.closed',
  'ticket.assigned',
  'ticket.reopened',
  'message.created',
  'rating.submitted',
  'user.created',
  'user.deleted',
  '*',
] as const;

type WebhookEvent = (typeof ALL_EVENTS)[number];

export default function AdminWebhooks() {
  const t = useT();
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

  const { data: hooks, isLoading, error: fetchError, refetch } = trpc.webhook.list.useQuery();

  const createMutation = trpc.webhook.create.useMutation({
    onSuccess: (data) => {
      setRevealedSecret(data.secret);
      setNewUrl('');
      setNewDesc('');
      setNewEvents([]);
      setShowCreate(false);
      refetch();
    },
  });

  const updateMutation = trpc.webhook.update.useMutation({
    onSuccess: () => {
      setEditingId(null);
      refetch();
    },
  });

  const deleteMutation = trpc.webhook.delete.useMutation({
    onSuccess: () => refetch(),
  });

  const regenMutation = trpc.webhook.regenerateSecret.useMutation({
    onSuccess: (data) => {
      setRevealedSecret(data.secret);
      refetch();
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
    if (!newUrl.trim() || newEvents.length === 0) return;
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
            className={`px-2 py-1 text-[9px] font-black uppercase tracking-widest border ${
              selected.includes(e)
                ? 'border-black dark:border-white bg-black dark:bg-white text-white dark:text-black'
                : 'border-black/20 dark:border-white/20 opacity-50 hover:opacity-80'
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
          <h2 className="text-lg font-black uppercase tracking-widest">{t('webhooks')}</h2>
          <p className="text-xs uppercase opacity-60 mt-1">{t('webhooks_desc')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="flex items-center gap-2 px-4 py-2 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-[10px] tracking-widest"
          >
            <Plus className="h-3.5 w-3.5" /> New Webhook
          </button>
          <button onClick={() => refetch()} className="p-2 hover:bg-black/5 dark:hover:bg-white/5" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="border-2 border-rose-500 bg-rose-500/5 px-4 py-3 mb-6">
          <span className="text-xs font-black uppercase tracking-widest text-rose-600 dark:text-rose-400">{error}</span>
        </div>
      )}

      {/* Secret reveal banner */}
      {revealedSecret && (
        <div className="border-2 border-amber-500 bg-amber-500/5 px-4 py-3 mb-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[9px] font-black uppercase tracking-widest text-amber-700 dark:text-amber-300 mb-1">
                Signing Secret — copy now, it won't be shown again
              </p>
              <code className="text-xs font-mono bg-black/10 dark:bg-white/10 px-2 py-1 select-all break-all">{revealedSecret}</code>
            </div>
            <button onClick={() => setRevealedSecret(null)} className="p-1 shrink-0 hover:bg-black/10 dark:hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="border-2 border-black dark:border-white p-5 mb-6">
          <h3 className="text-[9px] font-black uppercase tracking-widest opacity-60 mb-4">New Webhook Endpoint</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">URL *</label>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://your-server.com/webhook"
                className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none"
              />
            </div>
            <div>
              <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-1.5">Description</label>
              <input
                type="text"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="e.g. Slack notifications"
                className="w-full border-2 border-black dark:border-white bg-transparent p-2.5 text-sm font-bold placeholder:opacity-30 outline-none"
              />
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-[9px] font-black uppercase tracking-widest opacity-60 mb-2">Events *</label>
            <EventChips events={ALL_EVENTS} selected={newEvents} onToggle={(e) => toggleEvent(newEvents, e, setNewEvents)} />
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 text-[10px] font-black uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/5">
              Cancel
            </button>
            <button
              onClick={addHook}
              disabled={!newUrl.trim() || newEvents.length === 0 || createMutation.isPending}
              className="flex items-center gap-2 px-6 py-2.5 bg-black dark:bg-white text-white dark:text-black font-black uppercase text-xs tracking-widest disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> {createMutation.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      )}

      {/* Webhooks list */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="border-2 border-black dark:border-white px-4 py-8 text-center text-sm opacity-40 font-black uppercase tracking-widest">
            Loading...
          </div>
        ) : !hooks || hooks.length === 0 ? (
          <div className="border-2 border-black dark:border-white px-4 py-8 text-center text-sm opacity-40 font-black uppercase tracking-widest">
            No webhooks configured
          </div>
        ) : (
          hooks.map((h) => (
            <div key={h.id} className="border-2 border-black dark:border-white">
              {editingId === h.id ? (
                /* Edit form */
                <div className="p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
                    <div>
                      <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">URL</label>
                      <input type="url" value={editUrl} onChange={(e) => setEditUrl(e.target.value)}
                        className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold outline-none" />
                    </div>
                    <div>
                      <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">Description</label>
                      <input type="text" value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                        className="w-full border-2 border-black dark:border-white bg-transparent p-2 text-sm font-bold placeholder:opacity-30 outline-none" />
                    </div>
                  </div>
                  <div className="mb-3">
                    <label className="block text-[8px] font-black uppercase tracking-widest opacity-40 mb-1">Events</label>
                    <EventChips events={ALL_EVENTS} selected={editEvents} onToggle={(e) => toggleEvent(editEvents, e, setEditEvents)} />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setEditingId(null)}
                      className="flex items-center gap-1.5 px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-black/5 dark:hover:bg-white/5">
                      <X className="h-3 w-3" /> Cancel
                    </button>
                    <button onClick={saveEdit}
                      disabled={!editUrl.trim() || editEvents.length === 0 || updateMutation.isPending}
                      className="flex items-center gap-1.5 px-4 py-2 bg-black dark:bg-white text-white dark:text-black text-[10px] font-black uppercase tracking-widest disabled:opacity-50">
                      <Check className="h-3 w-3" /> {updateMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Header row */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-black/10 dark:border-white/10">
                    <div className="flex items-center gap-3 min-w-0">
                      <Webhook className="h-4 w-4 shrink-0 opacity-40" />
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{h.url}</p>
                        {h.description && <p className="text-[9px] opacity-50 truncate">{h.description}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className={`text-[8px] font-black uppercase tracking-widest px-2 py-0.5 ${
                        h.active ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'bg-black/5 dark:bg-white/5 opacity-40'
                      }`}>
                        {h.active ? 'Active' : 'Paused'}
                      </span>
                      <button
                        onClick={() => updateMutation.mutate({ id: h.id, active: !h.active })}
                        className="w-7 h-7 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10"
                        title={h.active ? 'Pause' : 'Activate'}
                      >
                        {h.active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => testMutation.mutate({ id: h.id })}
                        disabled={testMutation.isPending}
                        className="w-7 h-7 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10"
                        title="Send test event"
                      >
                        <Play className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => regenMutation.mutate({ id: h.id })}
                        disabled={regenMutation.isPending}
                        className="w-7 h-7 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10"
                        title="Regenerate secret"
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => startEdit(h)}
                        className="w-7 h-7 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10" title="Edit">
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => deleteMutation.mutate({ id: h.id })} disabled={deleteMutation.isPending}
                        className="w-7 h-7 flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-50" title="Delete">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Events row */}
                  <div className="px-4 py-2 flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {((h.events as string[]) || []).map((e) => (
                        <span key={e} className="px-1.5 py-0.5 bg-black/5 dark:bg-white/5 text-[8px] font-black uppercase tracking-widest">
                          {e === '*' ? 'ALL EVENTS' : e}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => setLogsWebhookId(logsWebhookId === h.id ? null : h.id)}
                      className="flex items-center gap-1 text-[9px] font-black uppercase tracking-widest opacity-50 hover:opacity-100"
                    >
                      Logs {logsWebhookId === h.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                    </button>
                  </div>

                  {/* Logs panel */}
                  {logsWebhookId === h.id && (
                    <div className="border-t border-black/10 dark:border-white/10 px-4 py-3 bg-black/[0.02] dark:bg-white/[0.02]">
                      <p className="text-[8px] font-black uppercase tracking-widest opacity-40 mb-2">Recent Deliveries</p>
                      {logsQuery.isLoading ? (
                        <p className="text-xs opacity-40">Loading...</p>
                      ) : !logsQuery.data || logsQuery.data.length === 0 ? (
                        <p className="text-xs opacity-40 italic">No deliveries yet</p>
                      ) : (
                        <div className="space-y-1 max-h-48 overflow-y-auto">
                          {logsQuery.data.map((log) => (
                            <div key={log.id} className="flex items-center gap-3 text-[10px] py-1 border-b border-black/5 dark:border-white/5 last:border-0">
                              <span className={`font-mono font-bold w-8 text-center ${
                                log.statusCode && log.statusCode >= 200 && log.statusCode < 300
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : log.error
                                    ? 'text-rose-600 dark:text-rose-400'
                                    : 'opacity-50'
                              }`}>
                                {log.statusCode || 'ERR'}
                              </span>
                              <span className="font-bold uppercase">{log.event}</span>
                              <span className="opacity-40">{log.durationMs}ms</span>
                              {log.error && <span className="text-rose-500 truncate max-w-48">{log.error}</span>}
                              <span className="ml-auto opacity-30">{new Date(log.createdAt).toLocaleTimeString()}</span>
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
        <div className="mt-3 text-[9px] font-black uppercase tracking-widest opacity-30 text-right">
          {hooks.length} webhook{hooks.length !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}
