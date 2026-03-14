import { create } from 'zustand';
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

export default useStore;
