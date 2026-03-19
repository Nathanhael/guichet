import { StateCreator } from 'zustand';
import { StoreState, ZenSettings } from '../../types';

export interface UISlice {
  dyslexicMode: boolean;
  bionicReading: boolean;
  monochromeMode: boolean;
  focusMode: boolean;
  zenSettings: ZenSettings;
  darkMode: boolean;
  selectedLang: string | null;
  notificationsEnabled: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';

  toggleDarkMode: () => void;
  toggleDyslexicMode: () => void;
  toggleBionicReading: () => void;
  toggleMonochromeMode: () => void;
  toggleFocusMode: () => void;
  updateZenSettings: (updates: Partial<ZenSettings>) => void;
  setSelectedLang: (lang: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
}

export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
  dyslexicMode: false,
  bionicReading: false,
  monochromeMode: localStorage.getItem('monochromeMode') !== 'false', // Default to true for now to keep the current look
  focusMode: false,
  zenSettings: { autoBionic: false, notificationShield: false },
  darkMode: localStorage.getItem('darkMode') === 'true',
  selectedLang: localStorage.getItem('selectedLang') || null,
  notificationsEnabled: localStorage.getItem('notificationsEnabled') !== 'false',
  connectionStatus: 'disconnected',

  toggleDarkMode: () =>
    set((state) => {
      const next = !state.darkMode;
      localStorage.setItem('darkMode', String(next));
      if (next) document.documentElement.classList.add('dark');
      else document.documentElement.classList.remove('dark');
      return { darkMode: next };
    }),

  toggleDyslexicMode: () => {},
  toggleBionicReading: () => {},
  toggleMonochromeMode: () =>
    set((state) => {
      const next = !state.monochromeMode;
      localStorage.setItem('monochromeMode', String(next));
      if (next) document.documentElement.classList.add('monochrome-mode');
      else document.documentElement.classList.remove('monochrome-mode');
      return { monochromeMode: next };
    }),
  toggleFocusMode: () => {},

  updateZenSettings: (updates) =>
    set((state) => {
      const next = { ...state.zenSettings, ...updates };
      localStorage.setItem('zenSettings', JSON.stringify(next));
      return { zenSettings: next };
    }),

  setSelectedLang: (lang) => {
    localStorage.setItem('selectedLang', lang);
    set({ selectedLang: lang });
  },

  setNotificationsEnabled: (enabled) => {
    localStorage.setItem('notificationsEnabled', String(enabled));
    set({ notificationsEnabled: enabled });
  },

  setConnectionStatus: (status) => set({ connectionStatus: status }),
});
