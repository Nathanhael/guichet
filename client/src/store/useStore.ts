import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { StoreState } from '../types';
import { createAuthSlice } from './slices/authSlice';
import { createTicketSlice } from './slices/ticketSlice';
import { createMessageSlice } from './slices/messageSlice';
import { createUISlice } from './slices/uiSlice';
import { createConfigSlice } from './slices/configSlice';
import { createRatingSlice } from './slices/ratingSlice';

const useStore = create<StoreState>((...a) => ({
  ...createAuthSlice(...a),
  ...createTicketSlice(...a),
  ...createMessageSlice(...a),
  ...createUISlice(...a),
  ...createConfigSlice(...a),
  ...createRatingSlice(...a),
}));

/**
 * ME-06: Shallow selector hook to prevent unnecessary re-renders.
 *
 * PERFORMANCE: All six slices share one store. Components using `useStore()` without
 * a selector re-render on ANY state change (including real-time message events).
 *
 * ALWAYS use a selector:
 *   const { tickets, activeTicketId } = useStoreShallow(s => ({ tickets: s.tickets, activeTicketId: s.activeTicketId }));
 *
 * Or for single values:
 *   const user = useStore(s => s.user);
 *
 * NEVER use bare `useStore()` — it subscribes to the entire store.
 */
export function useStoreShallow<T>(selector: (state: StoreState) => T): T {
  return useStore(useShallow(selector));
}

export default useStore;
