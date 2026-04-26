import { StateCreator } from 'zustand';
import { StoreState, RatingPromptData } from '../../types';

export interface RatingSlice {
  ratingPrompt: RatingPromptData | null;
  setRatingPrompt: (data: RatingPromptData | null) => void;
  clearRatingPrompt: () => void;
  /** Slice-owned reset for the partner-scoped lifecycle (logout). Called by the
   * authSlice orchestrator; do not call from feature code. Keep in sync with
   * `ratingInitialState`. */
  _resetRatingState: () => void;
}

const ratingInitialState: Pick<RatingSlice, 'ratingPrompt'> = {
  ratingPrompt: null,
};

export const createRatingSlice: StateCreator<StoreState, [], [], RatingSlice> = (set) => ({
  ...ratingInitialState,
  setRatingPrompt: (data) => set({ ratingPrompt: data }),
  clearRatingPrompt: () => set({ ratingPrompt: null }),
  _resetRatingState: () => set(ratingInitialState),
});
