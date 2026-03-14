import { StateCreator } from 'zustand';
import { StoreState, ZenSettings } from '../../types';

export interface UISlice {
  dyslexicMode: boolean;
  bionicReading: boolean;
  highContrastMode: boolean;
  focusMode: boolean;
  zenSettings: ZenSettings;
  darkMode: boolean;
  selectedLang: string | null;
  notificationsEnabled: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';

  toggleDarkMode: () => void;
  toggleDyslexicMode: () => void;
  toggleBionicReading: () => void;
  toggleHighContrastMode: () => void;
  toggleFocusMode: () => void;
  updateZenSettings: (updates: Partial<ZenSettings>) => void;
  setSelectedLang: (lang: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
}

export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set) => ({
  dyslexicMode: localStorage.getItem('dyslexicMode') === 'true',
  bionicReading: localStorage.getItem('bionicReading') === 'true',
  highContrastMode: localStorage.getItem('highContrastMode') === 'true',
  focusMode: localStorage.getItem('focusMode') === 'true',
  zenSettings: JSON.parse(localStorage.getItem('zenSettings') || '{"autoBionic":true,"notificationShield":true}'),
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

  toggleHighContrastMode: () =>
    set((state) => {
      const next = !state.highContrastMode;
      localStorage.setItem('highContrastMode', String(next));
      if (next) document.documentElement.classList.add('high-contrast-mode');
      else document.documentElement.classList.remove('high-contrast-mode');
      return { highContrastMode: next };
    }),

  toggleFocusMode: () =>
    set((state) => {
      const next = !state.focusMode;
      localStorage.setItem('focusMode', String(next));
      
      // Auto-bionic logic
      if (next && state.zenSettings.autoBionic && !state.bionicReading && state.dyslexicMode) {
        localStorage.setItem('bionicReading', 'true');
        return { focusMode: next, bionicReading: true };
      }
      
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
});
