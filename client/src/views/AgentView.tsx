import React, { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import ErrorBoundary from '../components/ErrorBoundary';
import { useStoreShallow } from '../store/useStore';
import { useBusinessHours } from '../hooks/useBusinessHours';
import { useT } from '../i18n';
import ChatWindow from '../components/ChatWindow';
import SystemBackground from '../components/SystemBackground';
import BusinessHoursGuard from '../components/BusinessHoursGuard';
import FeedbackModal from '../components/FeedbackModal';
import RatingModal from '../components/RatingModal';
import PartnerUnavailable from '../components/PartnerUnavailable';
import ConnectionStatus from '../components/ConnectionStatus';
import UserMenuChip from '../components/ui/UserMenuChip';
import TicketForm from '../components/agent/TicketForm';
import AgentTicketContextPanel from '../components/agent/AgentTicketContextPanel';
import { trpc } from '../utils/trpc';
import type { ChatWindowHandle } from '../types/command';

const SIDEBAR_WIDTH_KEY = 'guichet.agentSidebarWidth';
const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 320;
const SIDEBAR_DEFAULT = 240;

function readInitialWidth(): number {
  if (typeof window === 'undefined') return SIDEBAR_DEFAULT;
  const raw = window.localStorage.getItem(SIDEBAR_WIDTH_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, parsed));
}

export default function AgentView() {
  const {
    user,
    tickets,
    setTickets,
    activeTicketId,
    setActiveTicketId,
    memberships,
    activeMembershipId,
    queuePosition,
  } = useStoreShallow((s) => ({
    user: s.user,
    tickets: s.tickets,
    setTickets: s.setTickets,
    activeTicketId: s.activeTicketId,
    setActiveTicketId: s.setActiveTicketId,
    memberships: s.memberships,
    activeMembershipId: s.activeMembershipId,
    queuePosition: s.queuePosition,
  }));

  const t = useT();
  const [showFeedback, setShowFeedback] = useState(false);
  const chatWindowRef = useRef<ChatWindowHandle>(null);

  const [sidebarWidth, setSidebarWidth] = useState<number>(() => readInitialWidth());
  const dragStateRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const widthRef = useRef(sidebarWidth);

  const handleDragStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    dragStateRef.current = { startX: e.clientX, startWidth: widthRef.current };
    e.preventDefault();
  }, []);

  useEffect(() => {
    function handleMove(e: MouseEvent) {
      const drag = dragStateRef.current;
      if (!drag) return;
      const next = drag.startWidth + (e.clientX - drag.startX);
      const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next));
      widthRef.current = clamped;
      setSidebarWidth(clamped);
    }
    function handleUp() {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      try { window.localStorage.setItem(SIDEBAR_WIDTH_KEY, String(widthRef.current)); } catch { /* storage disabled */ }
    }
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, []);

  // Keep business hours store fresh even when TicketForm is unmounted (agent in active chat)
  useBusinessHours();

  const activeMembership = (memberships || []).find((m) => m.id === activeMembershipId);
  const manifest = useMemo(
    () => activeMembership?.manifest || { industry: 'general', departments: [] },
    [activeMembership?.manifest],
  );

  // Agent's non-closed ticket (1-ticket limit)
  const agentTicket = useMemo(
    () => tickets.find((tk) => tk.agentId === user?.id && tk.status !== 'closed') ?? null,
    [tickets, user?.id],
  );

  // Per-membership persistence key for the focused ticket. Without this, the
  // Zustand store reset on hard-refresh wiped the focus and the agent had to
  // hunt for the ticket they were on. SupportView already does this for its
  // tab list (`guichet:activeTab:${membershipId}`).
  const ticketStorageKey = activeMembershipId ? `guichet:activeTicket:${activeMembershipId}` : null;

  // Hydrate from localStorage when the store has no focus yet. We only honour
  // the saved id when it still matches a non-closed ticket — closed/transferred
  // tickets fall through to the auto-route below.
  useEffect(() => {
    if (!ticketStorageKey || activeTicketId) return;
    const saved = localStorage.getItem(ticketStorageKey);
    if (saved && tickets.some((tk) => tk.id === saved && tk.status !== 'closed')) {
      setActiveTicketId(saved);
    }
  }, [ticketStorageKey, activeTicketId, tickets, setActiveTicketId]);

  // Auto-route to the agent's open ticket. Agents have a 1-ticket limit and
  // cannot "leave" the chat panel — the only way out is to close the ticket.
  useEffect(() => {
    if (agentTicket && !activeTicketId) {
      setActiveTicketId(agentTicket.id);
    }
  }, [agentTicket, activeTicketId, setActiveTicketId]);

  // Persist focus changes so the next refresh lands on the same ticket.
  useEffect(() => {
    if (!ticketStorageKey) return;
    if (activeTicketId) {
      localStorage.setItem(ticketStorageKey, activeTicketId);
    } else {
      localStorage.removeItem(ticketStorageKey);
    }
  }, [ticketStorageKey, activeTicketId]);

  // tRPC ticket list
  const { data: ticketList } = trpc.ticket.list.useQuery(
    { agentId: user?.id },
    { enabled: !!user?.id },
  );

  useEffect(() => {
    if (ticketList && Array.isArray(ticketList)) {
      setTickets(ticketList);
    }
  }, [ticketList, setTickets]);

  const activeTicket = tickets.find((tk) => tk.id === activeTicketId);
  const inChat = !!activeTicket && activeTicket.status !== 'closed';

  if (!user) return null;
  if (!activeMembership) return <PartnerUnavailable />;

  return (
    <ErrorBoundary>
    <BusinessHoursGuard mode={activeTicket ? 'notice' : 'block'}>
      <div className="h-screen flex flex-row overflow-hidden bg-[var(--color-bg)] text-[var(--color-ink)] relative">
        <SystemBackground />

        {inChat && (
          <aside
            className="relative h-full bg-[var(--color-bg-surface)] border-r border-[var(--color-border)] flex flex-col flex-shrink-0 z-10"
            style={{ width: sidebarWidth }}
          >
            <div className="px-2 pt-3 pb-2 border-b border-[var(--color-border)]">
              <UserMenuChip
                showFeedback
                onFeedback={() => setShowFeedback(true)}
                confirmBeforeSwitch
              />
            </div>

            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3">
              {activeTicket && activeTicket.status !== 'closed' ? (
                <AgentTicketContextPanel
                  ticket={activeTicket}
                  onRequestClose={() => chatWindowRef.current?.triggerCloseTicket()}
                />
              ) : queuePosition && queuePosition.position > 0 && !activeTicket && agentTicket?.status === 'open' ? (
                <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-bg-elevated)] p-3 flex items-center gap-3">
                  <div className="flex items-center justify-center w-8 h-8 border border-[var(--color-border)] text-[var(--color-ink)] text-xs font-bold tabular-nums rounded-[var(--radius-btn)]">
                    {queuePosition.position}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-[var(--color-ink)] truncate">
                      {t('queue_position')}: #{queuePosition.position}
                    </p>
                    {queuePosition.etaMins > 0 && (
                      <p className="text-[11px] text-[var(--color-ink-muted)] truncate">
                        {t('estimated_wait')}: ~{queuePosition.etaMins} {t('minutes')}
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="px-3 py-2 border-t border-[var(--color-border)] flex items-center justify-end">
              <ConnectionStatus />
            </div>

            <div
              onMouseDown={handleDragStart}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-[var(--color-accent-soft)] transition-colors"
            />
          </aside>
        )}

        <main className="flex-1 overflow-hidden flex flex-col min-w-0 bg-[var(--color-bg)] relative">
          {/* Idle overlay — when no chat, float the user chip top-left so
              the workspace switcher / settings stay reachable without the
              whole sidebar chrome. Connection status tucks bottom-left. */}
          {!inChat && (
            <>
              <div className="absolute top-3 left-3 z-20 w-[220px]">
                <UserMenuChip
                  showFeedback
                  onFeedback={() => setShowFeedback(true)}
                  confirmBeforeSwitch
                />
              </div>
              <div className="absolute bottom-3 left-3 z-20">
                <ConnectionStatus />
              </div>
            </>
          )}

          {inChat ? (
            <div className="flex-1 min-h-0 w-full">
              <div className="h-full flex flex-col overflow-hidden bg-[var(--color-bg-base)]">
                <ChatWindow ref={chatWindowRef} key={activeTicket!.id} ticket={activeTicket!} hideHeader />
              </div>
            </div>
          ) : (
            <TicketForm manifest={manifest} />
          )}
        </main>
      </div>

      {showFeedback && <FeedbackModal onClose={() => setShowFeedback(false)} />}
    </BusinessHoursGuard>
    <RatingModal />
    </ErrorBoundary>
  );
}
