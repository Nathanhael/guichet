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
  hydrateAccessibilityPrefs: (prefs: { dyslexicMode?: boolean; bionicReading?: boolean; monochromeMode?: boolean; focusMode?: boolean }) => void;
}

export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
  dyslexicMode: (() => {
    const v = localStorage.getItem('dyslexicMode') === 'true';
    if (v) document.documentElement.classList.add('dyslexic-mode');
    return v;
  })(),
  bionicReading: localStorage.getItem('bionicReading') === 'true',
  monochromeMode: localStorage.getItem('monochromeMode') !== 'false', // Default to true for now to keep the current look
  focusMode: localStorage.getItem('focusMode') === 'true',
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

  toggleDyslexicMode: () =>
    set((state) => {
      const next = !state.dyslexicMode;
      localStorage.setItem('dyslexicMode', String(next));
      if (next) document.documentElement.classList.add('dyslexic-mode');
      else document.documentElement.classList.remove('dyslexic-mode');
      return { dyslexicMode: next };
    }),
  toggleBionicReading: () =>
    set((state) => {
      const next = !state.bionicReading;
      localStorage.setItem('bionicReading', String(next));
      return { bionicReading: next };
    }),
  toggleMonochromeMode: () =>
    set((state) => {
      const next = !state.monochromeMode;
      localStorage.setItem('monochromeMode', String(next));
      if (next) document.documentElement.classList.add('monochrome-mode');
      else document.documentElement.classList.remove('monochrome-mode');
      return { monochromeMode: next };
    }),
  toggleFocusMode: () =>
    set((state) => {
      const next = !state.focusMode;
      localStorage.setItem('focusMode', String(next));
      return { focusMode: next };
    }),

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

  hydrateAccessibilityPrefs: (prefs) =>
    set(() => {
      const dyslexicMode = prefs.dyslexicMode ?? false;
      const bionicReading = prefs.bionicReading ?? false;
      const monochromeMode = prefs.monochromeMode ?? true;
      const focusMode = prefs.focusMode ?? false;

      localStorage.setItem('dyslexicMode', String(dyslexicMode));
      localStorage.setItem('bionicReading', String(bionicReading));
      localStorage.setItem('monochromeMode', String(monochromeMode));
      localStorage.setItem('focusMode', String(focusMode));

      if (dyslexicMode) document.documentElement.classList.add('dyslexic-mode');
      else document.documentElement.classList.remove('dyslexic-mode');

      if (monochromeMode) document.documentElement.classList.add('monochrome-mode');
      else document.documentElement.classList.remove('monochrome-mode');

      return { dyslexicMode, bionicReading, monochromeMode, focusMode };
    }),
});
