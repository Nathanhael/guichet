import { useState } from 'react';
import { useStoreShallow } from '../../store/useStore';
import { useT } from '../../i18n';
import { Ticket } from '../../types';
import { usePartner } from '../../hooks/usePartner';
import { getSocket } from '../../hooks/useSocket';
import { Eye } from 'lucide-react';
import SlaIndicator from '../SlaIndicator';
import { COLOR_BG_MAP } from '../../utils/labelColors';
import LabelPicker from './LabelPicker';

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
  summary: string | null;
  showSummary: boolean;
  summarizing: boolean;
  onSummarize: (refresh?: boolean) => void;
  onDismissSummary: () => void;
  viewers: Array<{ userId: string; userName: string }>;
  closing: boolean;
  canClose: boolean;
  canSummarize: boolean;
  agentIsOnline: boolean;
  onCloseTicket: () => void;
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
  summary,
  showSummary,
  summarizing,
  onSummarize,
  onDismissSummary,
  viewers,
  closing,
  canClose,
  canSummarize,
  agentIsOnline,
  onCloseTicket,
}: ChatHeaderProps) {
  const { user, allLabels } = useStoreShallow(s => ({
    user: s.user,
    allLabels: s.allLabels,
  }));
  const t = useT();
  const { manifest } = usePartner();

  const [transferNote, setTransferNote] = useState('');
  const [copiedRef, setCopiedRef] = useState<number | null>(null);

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
                className={`w-1.5 h-1.5 rounded-full shrink-0 ${agentIsOnline ? 'bg-text-primary' : 'border border-border'}`}
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

          {/* Labels */}
          {!focusMode && !compact && (
            <>
              {(liveTicket.labels || []).map(id => {
                const info = getLabelInfo(id);
                if (!info) return null;
                return (
                  <span
                    key={id}
                    className={`text-[8px] font-mono font-bold px-1.5 py-0.5 uppercase tracking-widest ${
                      info.color && COLOR_BG_MAP[info.color]
                        ? `${COLOR_BG_MAP[info.color]} text-white`
                        : 'bg-bg-elevated text-text-primary border border-border-heavy'
                    }`}
                  >
                    {info.name}
                  </span>
                );
              })}
              {isSupport && (
                <LabelPicker ticketId={ticket.id} currentLabels={liveTicket.labels || []} allLabels={allLabels || []} />
              )}
            </>
          )}

          {/* SLA Indicator */}
          {!focusMode && !compact && isSupport && !isClosed && !liveTicket.supportJoinedAt && liveTicket.slaResponseDueAt && (
            <SlaIndicator dueAt={liveTicket.slaResponseDueAt} breached={liveTicket.slaBreached} />
          )}
        </div>

        {/* Right: actions */}
        <div className={`flex items-center gap-2 shrink-0 ${(focusMode || compact) ? 'opacity-60 hover:opacity-100' : ''}`}>
          {/* Summarize button (support/admin only) */}
          {canSummarize && !isClosed && (
            <button
              onClick={() => onSummarize()}
              disabled={summarizing}
              aria-label="Summarize conversation"
              title="AI: Summarize conversation"
              className={`text-[10px] font-bold bg-bg-surface text-text-primary hover:bg-bg-elevated border border-border hidden sm:flex items-center gap-1.5 ${(focusMode || compact) ? 'px-2 py-1' : 'px-2.5 py-1.5'}`}
            >
              {summarizing ? (
                <span className="text-[10px] font-bold opacity-40">...</span>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              )}
              {!focusMode && !compact && 'Summarize'}
            </button>
          )}

          {/* Secondary actions: Transfer + Leave (support/admin only) */}
          {isSupport && !isClosed && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <button
                  onClick={() => setShowTransferMenu(!showTransferMenu)}
                  aria-label={t('transfer') || 'Transfer'}
                  title={t('transfer') || 'Transfer'}
                  className={`text-[10px] font-bold bg-bg-surface text-text-primary hover:bg-bg-elevated border border-border ${(focusMode || compact) ? 'px-2 py-1' : 'px-3 py-1.5'}`}
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
            </div>
          )}

          {/* Primary action: Close Ticket */}
          {canClose && !isClosed && (
            <div className="border-l-2 border-border-heavy pl-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTicket();
                }}
                disabled={closing}
                className={`text-[11px] font-bold uppercase tracking-widest bg-accent-blue text-[var(--color-btn-text-inverse)] hover:bg-accent-blue/80 border-2 border-accent-blue flex items-center gap-2 ${(focusMode || compact) ? 'px-2.5 py-1' : 'px-4 py-2'}`}
              >
                {closing ? (
                  <span className="text-[10px] font-bold opacity-40 shrink-0">...</span>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {t('close') || 'Close'}
              </button>
            </div>
          )}
          {/* References — right-aligned before close */}
          {!focusMode && !compact && (ticket.references as Array<{label: string; value: string}> || []).length > 0 && (
            <div className="flex items-center gap-3 select-text">
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
          {onClose && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isSupport && ticket) {
                  getSocket().emit('support:leave', { ticketId: ticket.id, supportId: user?.id, supportName: user?.name });
                }
                onClose();
              }}
              aria-label="Close"
              className="w-7 h-7 flex items-center justify-center hover:bg-bg-elevated text-text-primary opacity-60 hover:opacity-100"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        </div>
      </div>

      {/* AI Summary Card */}
      {showSummary && summary && (
        <div className="px-6 py-3 bg-bg-elevated border-b-2 border-border-heavy">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-primary">AI Summary</span>
              </div>
              <p className="text-sm text-text-primary leading-relaxed">{summary}</p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => onSummarize(true)}
                disabled={summarizing}
                aria-label="Refresh summary"
                title="Refresh summary"
                className="w-7 h-7 flex items-center justify-center hover:bg-bg-elevated text-text-primary opacity-60 hover:opacity-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className={`h-3.5 w-3.5 ${summarizing ? 'opacity-40' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={onDismissSummary}
                aria-label="Dismiss summary"
                title="Dismiss"
                className="w-7 h-7 flex items-center justify-center hover:bg-bg-elevated text-text-primary opacity-60 hover:opacity-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
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
