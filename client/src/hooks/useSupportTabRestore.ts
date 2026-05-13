import { useCallback, useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import useStore from '../store/useStore';
import { getSocket } from './useSocket';
import { MAX_OPEN_CHATS } from '../config';
import type { Ticket } from '../types';

type TicketsQueryShape = {
  isSuccess: boolean;
  data: Ticket[] | { tickets: Ticket[]; nextCursor?: string } | undefined;
};

type UseSupportTabRestoreApi = {
  activeTab: string | null;
  setActiveTab: (id: string | null) => void;
};

// Owns the support workspace's tab-state machine:
//   - localStorage persistence of the open-tab list (partner-scoped key)
//   - localStorage persistence of the active tab (partner-scoped key)
//   - One-shot rejoin restore on first successful tickets query, merging
//     localStorage and server-owned tickets (handles same-browser refresh,
//     crash recovery, and new-device session start equally).
//   - `support:rejoin:denied` handler to prune stale tab references.
//
// Cap on open tabs comes from `MAX_OPEN_CHATS`. Tab persistence keys are
// scoped to membership ID so a user with two partners doesn't bleed
// tab state across them.
export function useSupportTabRestore(
  ticketsQuery: TicketsQueryShape,
): UseSupportTabRestoreApi {
  const {
    user,
    supportOpenTickets,
    addSupportOpenTicket,
    removeSupportOpenTicket,
    activeMembershipId,
  } = useStore(
    useShallow((s) => ({
      user: s.user,
      supportOpenTickets: s.supportOpenTickets,
      addSupportOpenTicket: s.addSupportOpenTicket,
      removeSupportOpenTicket: s.removeSupportOpenTicket,
      activeMembershipId: s.activeMembershipId,
    })),
  );

  const tabStorageKey = activeMembershipId ? `guichet:supportOpenTabs:${activeMembershipId}` : null;
  const activeTabKey = activeMembershipId ? `guichet:activeTab:${activeMembershipId}` : null;

  // Hydrate the open-tab list from localStorage on mount (partner-scoped).
  useEffect(() => {
    if (!tabStorageKey) return;
    try {
      const saved = localStorage.getItem(tabStorageKey);
      if (saved) {
        const ids = JSON.parse(saved) as string[];
        for (const id of ids) addSupportOpenTicket(id);
      }
    } catch {
      // corrupt entry — ignore, will be overwritten by next persist
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabStorageKey]);

  const [activeTab, setActiveTabRaw] = useState<string | null>(() => {
    if (!activeTabKey) return null;
    const saved = localStorage.getItem(activeTabKey);
    return saved || null;
  });

  const setActiveTab = useCallback(
    (id: string | null) => {
      setActiveTabRaw(id);
      if (activeTabKey) {
        if (id) localStorage.setItem(activeTabKey, id);
        else localStorage.removeItem(activeTabKey);
      }
    },
    [activeTabKey],
  );

  // Tab restore + silent rejoin — runs once per session after tickets load.
  // Merges two sources of truth:
  //   1. localStorage tabs (fast same-browser restore)
  //   2. Server-owned tickets where supportId === me and status !== closed
  //      (handles crash / logout / new-device where localStorage is empty)
  // Emits support:rejoin to reattach to ticket rooms silently (no "joined"
  // whispers). Rejects are pruned from the tab list via support:rejoin:denied.
  // Caps total tabs at MAX_OPEN_CHATS — overflow stays visible under OTHER
  // AGENTS in the queue until the user closes a tab to pick them up.
  //
  // Reads `ticketsQuery.data` directly rather than the zustand `tickets`
  // mirror: the mirror is populated by a separate effect in the caller that
  // commits AFTER this one fires on the same render. If we used `tickets`,
  // the one-shot guard would lock with `tickets=[]` on the first fire and
  // owned tickets would never rehydrate — they'd land in the "Claimed by
  // others" rail instead of "My Chats" on every fresh page load.
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (hasRestoredRef.current) return;
    if (!ticketsQuery.isSuccess || !user?.id) return;
    // ticketsQuery.data is `Ticket[] | { tickets, nextCursor }` — only the
    // array form carries the restore-source we need. Hold the guard until
    // we have data so a transient paginated / pre-data render can't lock
    // the one-shot with an empty source.
    if (!Array.isArray(ticketsQuery.data)) return;
    hasRestoredRef.current = true;
    const socket = getSocket();
    if (!socket) return;

    const onDenied = ({ ticketId }: { ticketId: string }) => {
      removeSupportOpenTicket(ticketId);
    };
    socket.on('support:rejoin:denied', onDenied);

    const source = ticketsQuery.data;
    const validTicketIds = new Set(source.map((tk) => tk.id));
    const rejoined = new Set<string>();

    for (const ticketId of supportOpenTickets) {
      if (validTicketIds.has(ticketId)) {
        socket.emit('support:rejoin', { ticketId });
        rejoined.add(ticketId);
      } else {
        removeSupportOpenTicket(ticketId);
      }
    }

    const owned = source
      .filter((tk) => tk.supportId === user.id && tk.status !== 'closed' && !rejoined.has(tk.id))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const available = Math.max(0, MAX_OPEN_CHATS - rejoined.size);

    for (const tk of owned.slice(0, available)) {
      addSupportOpenTicket(tk.id);
      socket.emit('support:rejoin', { ticketId: tk.id });
    }

    return () => {
      socket.off('support:rejoin:denied', onDenied);
    };
  }, [
    ticketsQuery.isSuccess,
    ticketsQuery.data,
    user?.id,
    supportOpenTickets,
    addSupportOpenTicket,
    removeSupportOpenTicket,
  ]);

  return { activeTab, setActiveTab };
}
