import { useState, useEffect, useRef } from 'react';
import useStore, { useStoreShallow } from '../../store/useStore';
import { useT, useLang } from '../../i18n';
import { Ticket } from '../../types';
import { usePartner } from '../../hooks/usePartner';
import { getSocket } from '../../hooks/useSocket';
import { Search, X, Check } from 'lucide-react';
import { COLOR_BG_MAP } from '../../utils/labelColors';
import UserAvatar from '../UserAvatar';
import SlaIndicator from '../SlaIndicator';

interface ChatHeaderProps {
  ticket: Ticket;
  liveTicket: Ticket;
  isSupport: boolean;
  isClosed: boolean;
  focusMode: boolean;
  compact: boolean;
  onClose?: () => void;
  showTransferMenu: boolean;
  setShowTransferMenu: (v: boolean) => void;
  onTransfer: (departmentId?: string, note?: string) => void;
  closing: boolean;
  canClose: boolean;
  agentIsOnline: boolean;
  onCloseTicket: () => void;
  onOpenSearch?: () => void;
}

export default function ChatHeader({
  ticket,
  liveTicket,
  isSupport,
  isClosed,
  focusMode,
  compact,
  onClose,
  showTransferMenu,
  setShowTransferMenu,
  onTransfer,
  closing,
  canClose,
  agentIsOnline,
  onCloseTicket,
  onOpenSearch,
}: ChatHeaderProps) {
  const { allLabels, onlineSupportUsers } = useStoreShallow(s => ({
    allLabels: s.allLabels,
    onlineSupportUsers: s.onlineSupportUsers,
  }));
  const currentUserId = useStore(s => s.user?.id);
  const currentUserIsExternal = useStore(s => !!s.user?.isExternal);
  const currentRole = useStore(s => s.user?.role);
  // Map of userId -> live status, used to light up support avatars and keep them in sync with presence changes.
  const supportStatusById = new Map<string, 'online' | 'away'>();
  for (const u of (onlineSupportUsers || [])) {
    supportStatusById.set(u.userId, u.status);
  }
  // Resolve a participant's live status. Returns the known status, or defaults the
  // current viewer to 'online' (they're obviously connected), or undefined when we
  // have no presence info yet — undefined hides the dot instead of showing false offline.
  const resolveStatus = (userId: string): 'online' | 'away' | undefined => {
    const s = supportStatusById.get(userId);
    if (s) return s;
    if (userId === currentUserId) return 'online';
    return undefined;
  };
  // Azure B2B guest flag per participant. Authoritative source is the
  // `isExternal` field denormalized onto `tickets.participants` at join time
  // (see docs/superpowers/specs/partner-sso-b2b-guest.md). Tickets are
  // reseeded, so every participant row carries the field; no legacy
  // fallback. The viewer's own flag comes from the store because the
  // viewer may not be in the participant list (agent-side chat).
  const resolveIsExternal = (
    p: { id: string; isExternal?: boolean } | string,
  ): boolean => {
    const userId = typeof p === 'string' ? p : p.id;
    if (typeof p === 'object') return !!p.isExternal;
    if (userId === currentUserId) return currentUserIsExternal;
    return false;
  };
  const t = useT();
  const viewerLang = useLang();
  const isCrossLang = !!ticket.agentLang && ticket.agentLang !== viewerLang && isSupport;
  // Banner self-dismisses once the current support user has sent their first
  // non-whisper reply in this ticket — they've demonstrably learned the
  // auto-translate pathway, so keeping it visible is just noise.
  const hasSupportReply = useStore(s => {
    const msgs = s.messages[ticket.id] || [];
    return msgs.some(m => m.senderId === currentUserId && !m.whisper && !m.system);
  });
  const { manifest } = usePartner();

  const [transferNote, setTransferNote] = useState('');
  const [copiedRef, setCopiedRef] = useState<number | null>(null);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [optimisticLabels, setOptimisticLabels] = useState<string[]>(liveTicket.labels || []);
  const transferMenuRef = useRef<HTMLDivElement>(null);
  const labelPickerRef = useRef<HTMLDivElement>(null);

  // Sync optimistic local label state to the authoritative server list whenever
  // the ticket's labels change (server push, other client, accept/revert).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOptimisticLabels(liveTicket.labels || []);
  }, [liveTicket.labels]);

  // Close label picker on outside click or Escape
  useEffect(() => {
    if (!showLabelPicker) return;
    function handleClick(e: MouseEvent) {
      if (labelPickerRef.current && !labelPickerRef.current.contains(e.target as Node)) {
        setShowLabelPicker(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowLabelPicker(false);
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [showLabelPicker]);

  // Global shortcut: Ctrl+L / Alt+L dispatches `support:open-label-picker`
  // on SupportView. Listening here keeps the picker owner (this header)
  // free of prop-drilling from the parent view.
  useEffect(() => {
    function open() {
      setShowLabelPicker(true);
    }
    window.addEventListener('support:open-label-picker', open);
    return () => window.removeEventListener('support:open-label-picker', open);
  }, []);

  const MAX_LABELS = 50;
  const MAX_VISIBLE_LABELS = 3;

  // Strip a leading "DEPT: " prefix from the visible chip text. The stored
  // label.name is preserved in the picker popover so admins still recognize
  // their full taxonomy; this only affects what renders in the header row.
  function stripDeptPrefix(name: string): string {
    const idx = name.indexOf(':');
    return idx > 0 ? name.slice(idx + 1).trim() : name;
  }

  function toggleLabel(labelId: string) {
    const isRemoving = optimisticLabels.includes(labelId);
    if (!isRemoving && optimisticLabels.length >= MAX_LABELS) return;
    const newLabels = isRemoving
      ? optimisticLabels.filter((id) => id !== labelId)
      : [...optimisticLabels, labelId];
    setOptimisticLabels(newLabels);
    getSocket().emit('ticket:labels:update', { ticketId: ticket.id, labels: newLabels });
  }

  function removeLabel(labelId: string) {
    const newLabels = optimisticLabels.filter((id) => id !== labelId);
    setOptimisticLabels(newLabels);
    getSocket().emit('ticket:labels:update', { ticketId: ticket.id, labels: newLabels });
  }

  // Close transfer menu on outside click or Escape
  useEffect(() => {
    if (!showTransferMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (transferMenuRef.current && !transferMenuRef.current.contains(e.target as Node)) {
        setShowTransferMenu(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowTransferMenu(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showTransferMenu, setShowTransferMenu]);

  const getLabelInfo = (id: string) => (allLabels || []).find((l) => l.id === id);

  const transferDepartments = (manifest?.departments || []).filter(
    (d: { id: string; name: string }) => d.id !== ticket?.dept
  );

  function handleTransfer(departmentId?: string) {
    onTransfer(departmentId, transferNote.trim() || undefined);
    setTransferNote('');
  }

  function interpolate(template: string, vars: Record<string, string>): string {
    return template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }

  return (
    <>
      {/* Header */}
      <div className="relative border-b border-[var(--color-border)] bg-[var(--color-bg-surface)]">
        <div className={`flex items-center justify-between gap-3 px-4 ${(focusMode || compact) ? 'py-2' : 'py-3'}`}>
        {/* Left: identity + metadata */}
        <div className="flex items-center gap-2.5 min-w-0 select-text">
          {/* Department badge */}
          {!focusMode && !compact && (
            <span className="text-[11px] font-semibold px-2 py-0.5 shrink-0 rounded-[var(--radius-pill)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
              {ticket.dept}
            </span>
          )}

          {/* Name + online indicator */}
          <span className={`font-semibold text-[var(--color-ink)] truncate flex items-center gap-2 min-w-0 ${(focusMode || compact) ? 'text-sm opacity-80' : 'text-[15px]'}`}>
            {ticket.agentName}
            {isSupport && !isClosed && (
              <span
                title={agentIsOnline ? 'Agent online' : 'Agent offline'}
                className={`w-2 h-2 rounded-full shrink-0 ${agentIsOnline ? 'bg-[var(--color-ok)]' : 'bg-[var(--color-border-strong)]'}`}
              />
            )}
          </span>

          {!focusMode && !compact && ticket.agentLang && (
            <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] cursor-default shrink-0" title={`Language: ${ticket.agentLang.toUpperCase()}`}>
              {ticket.agentLang.toUpperCase()}
            </span>
          )}

          {/* Support agents — avatars. Participants JSONB only stores {id,name}, so the whole array IS the support list.
              Soft-filter by live presence: ticket.participants is sticky in the DB but the chat header should only show
              supports who are actually around right now. Self is always kept as a safety net (you're reading this view
              so you must be online). Mirrors the queue-row filter in QueueTicketRow. */}
          {!focusMode && !compact && (() => {
            const supportParticipants: Array<{ id: string; name: string; isExternal?: boolean }> = (liveTicket.participants || []).filter(
              (p: { id?: string }) => !!p?.id && (p.id === currentUserId || resolveStatus(p.id) !== undefined)
            );
            if (supportParticipants.length === 0) {
              return !isClosed ? (
                <span className="flex items-center gap-1.5 shrink-0 text-[var(--color-ink-muted)]">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-[11px] italic">
                    {t('waiting_for_support') || 'Waiting for support'}
                  </span>
                </span>
              ) : null;
            }
            // Put the primary (first joiner / supportId) first so the online-status avatar leads
            const sorted = [...supportParticipants].sort((a, b) => {
              if (a.id === liveTicket.supportId) return -1;
              if (b.id === liveTicket.supportId) return 1;
              return 0;
            });
            return (
              <span
                className="flex items-center gap-0.5 shrink-0"
                title={sorted.map((p) => (resolveIsExternal(p) ? `${p.name} (GUEST)` : p.name)).join(', ')}
              >
                {sorted.map((p) => {
                  // Self-status is already shown explicitly by the user-menu chip
                  // in the support nav, so suppress the redundant dot on the viewer's own
                  // avatar. Teammate avatars keep the dot as the only at-a-glance
                  // indicator of their availability.
                  const isSelf = p.id === currentUserId;
                  const st = resolveStatus(p.id);
                  const isExternal = resolveIsExternal(p);
                  return (
                    <span
                      key={p.id}
                      className={isExternal ? 'ring-1 ring-[var(--color-accent-amber)] ring-offset-0 inline-block' : 'inline-block'}
                      title={isExternal ? `${p.name} — external guest` : p.name}
                    >
                      <UserAvatar
                        userId={p.id}
                        name={p.name}
                        size="xs"
                        showStatus={!isSelf && st !== undefined}
                        isOnline={st === 'online'}
                      />
                    </span>
                  );
                })}
              </span>
            );
          })()}

          {/* Labels — unified slot: inline chips + overflow/add trigger sharing one popover. */}
          {isSupport && !focusMode && !compact && (allLabels || []).length > 0 && (() => {
            const visible = optimisticLabels.slice(0, MAX_VISIBLE_LABELS);
            const overflow = optimisticLabels.length - visible.length;
            const canAdd = !isClosed && optimisticLabels.length < MAX_LABELS;
            const openPicker = () => setShowLabelPicker((v) => !v);

            return (
              <div ref={labelPickerRef} className="relative flex items-center gap-1 shrink-0">
                {/* Inline visible chips */}
                {visible.map((id) => {
                  const info = getLabelInfo(id);
                  if (!info) return null;
                  const bgClass = (info.color && COLOR_BG_MAP[info.color]) || 'bg-[var(--color-bg-elevated)]';
                  const display = stripDeptPrefix(info.name);
                  return (
                    <span
                      key={id}
                      title={info.name}
                      className={`group relative inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] ${bgClass} ${info.color ? 'text-white' : 'text-[var(--color-ink-soft)]'}`}
                    >
                      {display}
                      {!isClosed && (
                        <button
                          onClick={() => removeLabel(id)}
                          aria-label={`Remove ${info.name}`}
                          title={`Remove ${info.name}`}
                          className="inline-flex items-center justify-center w-3.5 h-3.5 -my-0.5 -mr-0.5 opacity-0 group-hover:opacity-100 hover:bg-black/20 rounded-full"
                        >
                          <X size={9} strokeWidth={2.5} />
                        </button>
                      )}
                    </span>
                  );
                })}

                {/* Unified trigger: morphs by state.
                    0 labels         → ghost "+ LABEL" chip
                    1..MAX_VISIBLE   → small "+" icon button (if canAdd)
                    > MAX_VISIBLE    → "+N" overflow chip (doubles as add trigger) */}
                {optimisticLabels.length === 0 && canAdd && (
                  <button
                    onClick={openPicker}
                    aria-label={t('add_label') || 'Add label'}
                    title={t('add_label') || 'Add label'}
                    className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-transparent text-[var(--color-ink-muted)] border border-dashed border-[var(--color-border)] hover:text-[var(--color-accent)] hover:border-[var(--color-accent)] hover:border-solid"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                    {t('label') || 'Label'}
                  </button>
                )}

                {optimisticLabels.length > 0 && overflow === 0 && canAdd && (
                  <button
                    onClick={openPicker}
                    aria-label={t('add_label') || 'Add label'}
                    title={t('add_label') || 'Add label'}
                    className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-accent)]"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                )}

                {overflow > 0 && (
                  <button
                    onClick={openPicker}
                    aria-label={`${overflow} more labels`}
                    title={`${overflow} more labels`}
                    className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-[var(--radius-pill)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-accent)]"
                  >
                    +{overflow}
                  </button>
                )}

                {/* Shared popover — full taxonomy with add/remove */}
                {showLabelPicker && (
                  <div className="absolute left-0 top-full mt-1.5 bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] z-50 min-w-[220px] max-h-[280px] overflow-y-auto animate-fade-in">
                    <div className="sticky top-0 bg-[var(--color-bg-surface)] border-b border-[var(--color-border)] px-3 py-2 text-[11px] font-semibold text-[var(--color-ink-muted)]">
                      {t('labels') || 'Labels'} · {optimisticLabels.length}
                    </div>
                    {(allLabels || []).map((label) => {
                      const isActive = optimisticLabels.includes(label.id);
                      const atLimit = optimisticLabels.length >= MAX_LABELS;
                      const dotClass = COLOR_BG_MAP[label.color] || 'bg-slate-500';
                      return (
                        <button
                          key={label.id}
                          onClick={() => toggleLabel(label.id)}
                          disabled={(atLimit && !isActive) || isClosed}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-left ${((atLimit && !isActive) || isClosed) ? 'opacity-30 cursor-not-allowed' : 'hover:bg-[var(--color-hover)]'}`}
                        >
                          <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
                          <span className="text-[12px] text-[var(--color-ink)] flex-1 truncate">{label.name}</span>
                          {isActive && <Check size={12} className="text-[var(--color-accent)] shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Ticket status badge — only when closed */}
          {!focusMode && !compact && ticket.status === 'closed' && (
            <span className="text-[10px] font-semibold uppercase tracking-[0.06em] px-2 py-0.5 rounded-[var(--radius-pill)] shrink-0 bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)]">
              {t('status_closed') || 'closed'}
            </span>
          )}

          {/* SLA indicator — staff only; hidden for external agents */}
          {!focusMode && !compact && (
            <SlaIndicator ticketId={ticket.id} hidden={currentRole === 'agent'} />
          )}

        </div>

        {/* Right: actions */}
        <div className={`flex items-center gap-1.5 shrink-0 ${(focusMode || compact) ? 'opacity-60 hover:opacity-100' : ''}`}>
          {/* References — visible to both agent (who filled them in) and support */}
          {!focusMode && !compact && (ticket.references as Array<{label: string; value: string}> || []).filter(r => r.value.trim()).length > 0 && (
            <div className="flex items-center gap-3 select-text mr-1">
              {(ticket.references as Array<{label: string; value: string}>).filter(r => r.value.trim()).map((ref, i) => (
                <span
                  key={i}
                  role="button"
                  tabIndex={0}
                  title={`Click to copy ${ref.value}`}
                  onClick={() => { navigator.clipboard.writeText(ref.value); setCopiedRef(i); setTimeout(() => setCopiedRef(null), 1500); }}
                  className="flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <span className="text-[10px] font-medium uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">{ref.label}</span>
                  {copiedRef === i ? (
                    <span className="text-[11px] font-semibold text-[var(--color-ok)]">Copied!</span>
                  ) : (
                    <span className="font-mono text-[11px] text-[var(--color-ink-soft)] hover:text-[var(--color-accent)] hover:underline underline-offset-2">{ref.value}</span>
                  )}
                </span>
              ))}
            </div>
          )}

          {/* Search in conversation */}
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              aria-label={t('search_in_conversation') || 'Search in conversation'}
              title={t('search_in_conversation') || 'Search in conversation'}
              className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
            >
              <Search size={14} />
            </button>
          )}

          {/* Transfer (support/admin only) */}
          {isSupport && !isClosed && (
            <div ref={transferMenuRef} className="relative">
              <button
                onClick={() => setShowTransferMenu(!showTransferMenu)}
                aria-label={t('transfer') || 'Transfer'}
                title={t('transfer') || 'Transfer'}
                className="h-8 px-3 flex items-center text-[12px] font-medium rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
              >
                {t('transfer') || 'Transfer'}
              </button>
              {showTransferMenu && (
                <div className="absolute right-0 top-full mt-1.5 bg-[var(--color-bg-surface)] rounded-[var(--radius-card)] shadow-[var(--shadow-modal)] min-w-[220px] z-50 overflow-hidden">
                  <button
                    onClick={() => handleTransfer()}
                    className="w-full text-left px-4 py-2.5 text-[12px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-hover)] border-b border-[var(--color-border)]"
                  >
                    {t('return_to_queue') || 'Return to queue'}
                  </button>
                  {transferDepartments.length > 0 && (
                    <>
                      <div className="px-3 pt-2 pb-1">
                        <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--color-ink-muted)]">
                          {t('transfer_to_department') || 'Transfer to department'}
                        </span>
                      </div>
                      <div className="px-3 pb-2">
                        <input
                          type="text"
                          value={transferNote}
                          onChange={(e) => setTransferNote(e.target.value)}
                          placeholder={t('transfer_note_placeholder') || 'Add context...'}
                          className="w-full text-[12px] bg-[var(--color-bg-elevated)] rounded-[var(--radius-btn)] px-2.5 py-1.5 text-[var(--color-ink)] placeholder:text-[var(--color-ink-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--color-accent)]"
                        />
                      </div>
                    </>
                  )}
                  {transferDepartments.map((d: { id: string; name: string }) => (
                    <button
                      key={d.id}
                      onClick={() => handleTransfer(d.id)}
                      className="w-full text-left px-4 py-2 text-[12px] font-medium text-[var(--color-ink)] hover:bg-[var(--color-hover)]"
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Primary action: Close Ticket — support/admin or ticket owner (agent) */}
          {canClose && !isClosed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTicket();
              }}
              disabled={closing}
              className="h-8 px-3 flex items-center gap-1.5 text-[12px] font-semibold rounded-[var(--radius-btn)] bg-[var(--color-accent)] text-white hover:opacity-90 shadow-[var(--shadow-soft)]"
            >
              {closing ? (
                <span className="opacity-60 shrink-0">...</span>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              )}
              {t('close') || 'Close'}
            </button>
          )}

          {/* Leave (X) — unified icon button */}
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isSupport && ticket) {
                  const socket = getSocket();
                  if (socket) socket.emit('support:leave', { ticketId: ticket.id });
                }
                onClose();
              }}
              aria-label={t('leave') || 'Leave'}
              title={t('leave') || 'Leave'}
              className="h-8 w-8 flex items-center justify-center rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
            >
              <X size={14} strokeWidth={2} />
            </button>
          )}
        </div>
        </div>
        {isCrossLang && !hasSupportReply && !focusMode && !compact && !isClosed && (
          <div
            data-cross-lang-banner
            className="px-4 py-1.5 border-t border-[var(--color-border)] bg-[var(--color-accent-soft)] text-[11px] text-[var(--color-accent)]"
          >
            {interpolate(t('chat_cross_lang_banner'), { lang: (ticket.agentLang ?? '').toUpperCase() })}
          </div>
        )}
      </div>

      {/* Collision Detection bar intentionally removed — viewer names are surfaced elsewhere (queue sidebar, avatars). */}
    </>
  );
}
