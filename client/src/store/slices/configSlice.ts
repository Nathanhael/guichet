import { StateCreator } from 'zustand';
import { StoreState, AppConfig, BusinessHoursStatus, Label } from '../../types';

export interface ConfigSlice {
  appConfig: AppConfig | null;
  businessHoursStatus: BusinessHoursStatus | null;
  businessHoursOpen: boolean;
  allLabels: Label[];

  setAppConfig: (config: AppConfig) => void;
  setBusinessHoursStatus: (status: BusinessHoursStatus | null) => void;
  setBusinessHoursOpen: (open: boolean) => void;
  setAllLabels: (labels: Label[]) => void;
  removeLabelGlobally: (labelId: string) => void;
  addLabelGlobally: (label: Label) => void;
}

export const createConfigSlice: StateCreator<StoreState, [], [], ConfigSlice> = (set) => ({
  appConfig: null,
  businessHoursStatus: null,
  businessHoursOpen: true,
  allLabels: [],

  setAppConfig: (config) => set({
    appConfig: config,
    businessHoursStatus: config.businessHoursStatus ?? null,
    businessHoursOpen: config.businessHoursStatus?.isOpen ?? true,
  }),
  setBusinessHoursStatus: (status) => set({
    businessHoursStatus: status,
    businessHoursOpen: status?.isOpen ?? true,
  }),
  setBusinessHoursOpen: (open) => set((state) => ({
    businessHoursOpen: open,
    businessHoursStatus: state.businessHoursStatus
      ? { ...state.businessHoursStatus, isOpen: open }
      : {
          isOpen: open,
          timezone: 'Europe/Brussels',
          source: 'default',
          evaluatedAt: new Date().toISOString(),
        },
  })),
  setAllLabels: (labels) => set({ allLabels: labels }),
  removeLabelGlobally: (labelId) =>
    set((state) => ({ allLabels: state.allLabels.filter((l) => l.id !== labelId) })),
  addLabelGlobally: (label) =>
    set((state) => ({ allLabels: [...state.allLabels, label] })),
});
