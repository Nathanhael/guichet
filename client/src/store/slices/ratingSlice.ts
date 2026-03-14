import { StateCreator } from 'zustand';
import { StoreState, RatingPromptData } from '../../types';

export interface RatingSlice {
  ratingPrompt: RatingPromptData | null;
  setRatingPrompt: (data: RatingPromptData | null) => void;
  clearRatingPrompt: () => void;
}

export const createRatingSlice: StateCreator<StoreState, [], [], RatingSlice> = (set) => ({
  ratingPrompt: null,
  setRatingPrompt: (data) => set({ ratingPrompt: data }),
  clearRatingPrompt: () => set({ ratingPrompt: null }),
});
