import { useState, useEffect, useRef } from 'react';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { Ticket } from '../../types';
import { usePartner } from '../../hooks/usePartner';
import { getSocket } from '../../hooks/useSocket';
import { Eye, Search, X, Check } from 'lucide-react';
import { COLOR_BG_MAP } from '../../utils/labelColors';

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
  viewers: Array<{ userId: string; userName: string }>;
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
  viewers,
  closing,
  canClose,
  agentIsOnline,
  onCloseTicket,
  onOpenSearch,
}: ChatHeaderProps) {
  const { allLabels } = useStoreShallow(s => ({
    allLabels: s.allLabels,
  }));
  const t = useT();
  const { manifest } = usePartner();

  const [transferNote, setTransferNote] = useState('');
  const [copiedRef, setCopiedRef] = useState<number | null>(null);
  const [showLabelPicker, setShowLabelPicker] = useState(false);
  const [optimisticLabels, setOptimisticLabels] = useState<string[]>(liveTicket.labels || []);
  const transferMenuRef = useRef<HTMLDivElement>(null);
  const labelPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
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

  const MAX_LABELS = 50;

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

  return (
    <>
      {/* Header */}
      <div className="relative border-b-2 border-border-heavy bg-bg-elevated">
        <div className={`flex items-center justify-between gap-3 px-4 ${(focusMode || compact) ? 'py-2' : 'py-2.5'}`}>
        {/* Left: identity + metadata */}
        <div className="flex items-center gap-2.5 min-w-0 flex-wrap select-text">
          {/* Department badge */}
          {!focusMode && !compact && (
            <span className="text-[9px] font-mono font-bold px-2 py-0.5 shrink-0 uppercase tracking-widest bg-accent-blue/15 text-accent-blue border border-accent-blue/30">
              {ticket.dept}
            </span>
          )}

          {/* Name + online indicator */}
          <span className={`font-bold text-text-primary truncate flex items-center gap-2 min-w-0 ${(focusMode || compact) ? 'text-sm opacity-80' : 'text-[15px]'}`}>
            {ticket.agentName}
            {isSupport && !isClosed && (
              <span
                title={agentIsOnline ? 'Agent online' : 'Agent offline'}
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${agentIsOnline ? 'bg-accent-green' : 'border border-border'}`}
              />
            )}
          </span>

          {!focusMode && !compact && ticket.agentLang && (
            <span className="text-[9px] font-mono font-bold px-1 py-px border border-border text-text-muted cursor-default shrink-0" title={`Language: ${ticket.agentLang.toUpperCase()}`}>
              {ticket.agentLang.toUpperCase()}
            </span>
          )}

          {/* Separator dot */}
          {!focusMode && !compact && <span className="text-border text-[8px]">&bull;</span>}

          {/* Support agents — headset icon */}
          {!focusMode && !compact && (() => {
            const supportParticipants = (liveTicket.participants || []).filter(
              (p: { role?: string }) => p.role === 'support' || p.role === 'admin'
            );
            if (supportParticipants.length === 0) {
              return !isClosed ? (
                <span className="flex items-center gap-1.5 shrink-0 text-text-muted">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 opacity-40 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-[10px] font-mono font-bold opacity-40 italic">
                    {t('waiting_for_support') || 'Waiting for support'}
                  </span>
                </span>
              ) : null;
            }
            return (
              <span className="flex items-center gap-1.5 shrink-0" title={supportParticipants.map((p: { name: string }) => p.name).join(', ')}>
                <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-accent-blue shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                <span className="text-[10px] font-mono font-bold text-accent-blue">
                  {supportParticipants.map((p: { name: string }) => p.name).join(', ')}
                </span>
              </span>
            );
          })()}

          {/* Ticket status badge — only show resolved/closed */}
          {!focusMode && !compact && (ticket.status === 'resolved' || ticket.status === 'closed') && (
            <span className={`text-[8px] font-mono font-bold uppercase tracking-widest px-1.5 py-px border shrink-0 ${
              ticket.status === 'resolved' ? 'border-accent-blue text-accent-blue' :
              'border-border text-text-muted'
            }`}>
              {t(`status_${ticket.status}`) || ticket.status}
            </span>
          )}

        </div>

        {/* Right: actions (V2 — 32px unified, mono uppercase) */}
        <div className={`flex items-center gap-1.5 shrink-0 ${(focusMode || compact) ? 'opacity-60 hover:opacity-100' : ''}`}>
          {/* References — first item */}
          {!focusMode && !compact && (ticket.references as Array<{label: string; value: string}> || []).length > 0 && (
            <div className="flex items-center gap-3 select-text mr-1">
              {(ticket.references as Array<{label: string; value: string}>).map((ref, i) => (
                <span
                  key={i}
                  role="button"
                  tabIndex={0}
                  title={`Click to copy ${ref.value}`}
                  onClick={() => { navigator.clipboard.writeText(ref.value); setCopiedRef(i); setTimeout(() => setCopiedRef(null), 1500); }}
                  className="flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <span className="text-[8px] font-mono font-bold uppercase tracking-wider text-text-muted opacity-50">{ref.label}</span>
                  {copiedRef === i ? (
                    <span className="text-[10px] font-mono font-bold text-accent-green">Copied!</span>
                  ) : (
                    <span className="text-[11px] font-mono font-bold text-text-muted hover:text-accent-blue hover:underline underline-offset-2">{ref.value}</span>
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
              className="h-8 w-8 flex items-center justify-center bg-bg-surface border border-border text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
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
                className="h-8 px-3.5 flex items-center font-mono text-[10px] font-bold uppercase tracking-[0.12em] bg-bg-surface text-text-primary hover:bg-bg-elevated border border-border"
              >
                {t('transfer') || 'Transfer'}
              </button>
              {showTransferMenu && (
                <div className="absolute right-0 top-full mt-1 bg-bg-surface border-2 border-border-heavy min-w-[200px] z-50 overflow-hidden">
                  <button
                    onClick={() => handleTransfer()}
                    className="w-full text-left px-4 py-2.5 text-[11px] font-bold hover:bg-bg-elevated border-b border-border"
                  >
                    {t('return_to_queue') || 'Return to queue'}
                  </button>
                  {transferDepartments.length > 0 && (
                    <>
                      <div className="px-3 py-1.5">
                        <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-text-primary opacity-40">
                          {t('transfer_to_department') || 'Transfer to department'}
                        </span>
                      </div>
                      <div className="px-3 pb-2">
                        <input
                          type="text"
                          value={transferNote}
                          onChange={(e) => setTransferNote(e.target.value)}
                          placeholder={t('transfer_note_placeholder') || 'Add context...'}
                          className="w-full text-[10px] bg-bg-elevated border border-border px-2 py-1 text-text-primary placeholder:text-text-muted placeholder:opacity-40"
                        />
                      </div>
                    </>
                  )}
                  {transferDepartments.map((d: { id: string; name: string }) => (
                    <button
                      key={d.id}
                      onClick={() => handleTransfer(d.id)}
                      className="w-full text-left px-4 py-2 text-[11px] font-mono font-bold hover:bg-bg-elevated"
                    >
                      {d.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Soft separator before primary action */}
          {canClose && !isClosed && (
            <span className="w-px h-[18px] bg-border-heavy mx-1" aria-hidden="true" />
          )}

          {/* Primary action: Close Ticket */}
          {canClose && !isClosed && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onCloseTicket();
              }}
              disabled={closing}
              className="h-8 px-3.5 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.12em] bg-accent-blue text-[var(--color-btn-text-inverse)] hover:bg-accent-blue/80 border border-accent-blue"
            >
              {closing ? (
                <span className="opacity-40 shrink-0">...</span>
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
              className="h-8 w-8 flex items-center justify-center bg-bg-surface border border-border text-text-secondary hover:bg-bg-elevated hover:text-text-primary"
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          )}
        </div>
        </div>
      </div>

      {/* Label Row — support/admin only (T3) */}
      {!focusMode && !compact && isSupport && (allLabels || []).length > 0 && (
        <div className="bg-bg-surface border-b-2 border-border-heavy px-4 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[8px] font-mono font-bold uppercase tracking-[0.15em] text-text-muted opacity-40 mr-1">
            {t('labels') || 'Labels'}
          </span>
          {optimisticLabels.map((id) => {
            const info = getLabelInfo(id);
            if (!info) return null;
            const bgClass = (info.color && COLOR_BG_MAP[info.color]) || 'bg-bg-elevated';
            return (
              <span
                key={id}
                className={`group relative inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] px-2.5 py-1 ${bgClass} ${info.color ? 'text-white' : 'text-text-primary border border-border-heavy'}`}
              >
                {info.name}
                {!isClosed && (
                  <button
                    onClick={() => removeLabel(id)}
                    aria-label={`Remove ${info.name}`}
                    title={`Remove ${info.name}`}
                    className="inline-flex items-center justify-center w-3.5 h-3.5 -my-0.5 -mr-1 opacity-0 group-hover:opacity-100 hover:bg-black/25"
                  >
                    <X size={10} strokeWidth={3} />
                  </button>
                )}
              </span>
            );
          })}
          {!isClosed && (
            <div ref={labelPickerRef} className="relative">
              <button
                onClick={() => setShowLabelPicker(!showLabelPicker)}
                aria-label={t('add_label') || 'Add label'}
                title={t('add_label') || 'Add label'}
                className="inline-flex items-center gap-1 font-mono text-[9px] font-bold uppercase tracking-[0.1em] px-2 py-1 bg-bg-elevated text-text-secondary border border-dashed border-border-heavy hover:text-text-primary hover:border-solid hover:border-accent-blue"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {t('label') || 'Label'}
              </button>
              {showLabelPicker && (
                <div className="absolute left-0 top-full mt-1 bg-bg-surface border-2 border-border-heavy z-50 min-w-[180px] max-h-[240px] overflow-y-auto animate-fade-in">
                  {(allLabels || []).map((label) => {
                    const isActive = optimisticLabels.includes(label.id);
                    const atLimit = optimisticLabels.length >= MAX_LABELS;
                    const dotClass = COLOR_BG_MAP[label.color] || 'bg-slate-500';
                    return (
                      <button
                        key={label.id}
                        onClick={() => toggleLabel(label.id)}
                        disabled={atLimit && !isActive}
                        className={`w-full flex items-center gap-2 px-3 py-1.5 text-left ${atLimit && !isActive ? 'opacity-30 cursor-not-allowed' : 'hover:bg-bg-elevated'}`}
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${dotClass}`} />
                        <span className="font-mono text-[10px] text-text-primary flex-1 truncate">{label.name}</span>
                        {isActive && <Check size={12} className="text-accent-blue shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Collision Detection: who else is viewing */}
      {viewers.length > 0 && (
        <div className="bg-bg-elevated border-b-2 border-border-heavy px-4 py-2 text-sm text-text-primary flex items-center gap-2">
          <Eye className="w-4 h-4 shrink-0" />
          <span>
            {viewers.map(v => v.userName).join(' and ')} {viewers.length === 1 ? 'is' : 'are'} also viewing this ticket
          </span>
        </div>
      )}
    </>
  );
}
