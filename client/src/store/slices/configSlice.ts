import { StateCreator } from 'zustand';
import { StoreState, AppConfig, CannedResponse, Label } from '../../types';

export interface ConfigSlice {
  appConfig: AppConfig | null;
  cannedResponses: CannedResponse[];
  businessHoursOpen: boolean;
  allLabels: Label[];

  setAppConfig: (config: AppConfig) => void;
  setCannedResponses: (responses: CannedResponse[]) => void;
  setBusinessHoursOpen: (open: boolean) => void;
  setAllLabels: (labels: Label[]) => void;
  removeLabelGlobally: (labelId: string) => void;
  addLabelGlobally: (label: Label) => void;
}

export const createConfigSlice: StateCreator<StoreState, [], [], ConfigSlice> = (set) => ({
  appConfig: null,
  cannedResponses: [],
  businessHoursOpen: true,
  allLabels: [],

  setAppConfig: (config) => set({ appConfig: config }),
  setCannedResponses: (responses) => set({ cannedResponses: responses }),
  setBusinessHoursOpen: (open) => set({ businessHoursOpen: open }),
  setAllLabels: (labels) => set({ allLabels: labels }),
  removeLabelGlobally: (labelId) =>
    set((state) => ({ allLabels: state.allLabels.filter((l) => l.id !== labelId) })),
  addLabelGlobally: (label) =>
    set((state) => ({ allLabels: [...state.allLabels, label] })),
});
