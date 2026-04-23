import { StateCreator } from 'zustand';
import { StoreState, AppConfig, BusinessHoursStatus, Label } from '../../types';

export interface ConfigSlice {
  appConfig: AppConfig | null;
  businessHoursStatus: BusinessHoursStatus | null;
  allLabels: Label[];

  setAppConfig: (config: AppConfig) => void;
  setBusinessHoursStatus: (status: BusinessHoursStatus | null) => void;
  setAllLabels: (labels: Label[]) => void;
  removeLabelGlobally: (labelId: string) => void;
  addLabelGlobally: (label: Label) => void;
  updateLabelGlobally: (label: Label) => void;
}

export const createConfigSlice: StateCreator<StoreState, [], [], ConfigSlice> = (set) => ({
  appConfig: null,
  businessHoursStatus: null,
  allLabels: [],

  setAppConfig: (config) => set({
    appConfig: config,
    businessHoursStatus: config.businessHoursStatus ?? null,
  }),
  setBusinessHoursStatus: (status) => set({ businessHoursStatus: status }),
  setAllLabels: (labels) => set({ allLabels: labels }),
  removeLabelGlobally: (labelId) =>
    set((state) => ({ allLabels: state.allLabels.filter((l) => l.id !== labelId) })),
  addLabelGlobally: (label) =>
    set((state) => ({ allLabels: [...state.allLabels, label] })),
  updateLabelGlobally: (label) =>
    set((state) => ({
      allLabels: state.allLabels.map((l) => (l.id === label.id ? { ...l, ...label } : l)),
    })),
});
