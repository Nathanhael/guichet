import { StateCreator } from 'zustand';
import { StoreState, ZenSettings } from '../../types';
import { trpcVanilla } from '../../utils/trpc';

export type ViewMode = 'normal' | 'split-grid' | 'split-stack' | 'focus';

export interface LightboxImage {
  url: string;
  name: string;
}

export interface UISlice {
  dyslexicMode: boolean;
  bionicReading: boolean;
  monochromeMode: boolean;
  focusMode: boolean;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  prefsModifiedLocally: boolean;
  zenSettings: ZenSettings;
  darkMode: boolean;
  selectedLang: string | null;
  notificationsEnabled: boolean;
  soundEnabled: boolean;
  connectionStatus: 'connected' | 'disconnected' | 'reconnecting';
  agentStatus: string;
  setAgentStatus: (status: string) => void;
  rightSidebarExpanded: boolean;
  toggleRightSidebar: () => void;
  lightboxImages: LightboxImage[];
  lightboxIndex: number | null;
  openLightbox: (images: LightboxImage[], startIndex: number) => void;
  closeLightbox: () => void;
  navigateLightbox: (delta: 1 | -1) => void;

  toggleDarkMode: () => void;
  toggleDyslexicMode: () => void;
  toggleBionicReading: () => void;
  toggleMonochromeMode: () => void;
  toggleFocusMode: () => void;
  toggleSoundEnabled: () => void;
  updateZenSettings: (updates: Partial<ZenSettings>) => void;
  setSelectedLang: (lang: string) => void;
  setNotificationsEnabled: (enabled: boolean) => void;
  setConnectionStatus: (status: 'connected' | 'disconnected' | 'reconnecting') => void;
  hydrateAccessibilityPrefs: (prefs: { dyslexicMode?: boolean; bionicReading?: boolean; monochromeMode?: boolean; focusMode?: boolean }) => void;
  /** Slice-owned reset for the session-scoped lifecycle (logout). Resets only
   * transient session state; device preferences (dark mode, language,
   * accessibility toggles) are intentionally preserved so they survive a
   * logout on a personal device. Called by the authSlice orchestrator; do not
   * call from feature code. */
  _resetUIState: () => void;
}

/**
 * Session-scoped UI fields that reset on logout. Intentionally narrow:
 * device-pref toggles (dark mode, lang, dyslexic/bionic/monochrome/focus,
 * sound, notifications, zen, sidebar) persist across logout.
 */
const uiResetState: Pick<
  UISlice,
  'agentStatus' | 'lightboxImages' | 'lightboxIndex' | 'prefsModifiedLocally' | 'connectionStatus'
> = {
  agentStatus: 'online',
  lightboxImages: [],
  lightboxIndex: null,
  prefsModifiedLocally: false,
  connectionStatus: 'disconnected',
};

export const createUISlice: StateCreator<StoreState, [], [], UISlice> = (set, get) => ({
  dyslexicMode: (() => {
    const v = localStorage.getItem('dyslexicMode') === 'true';
    if (v) document.documentElement.classList.add('dyslexic-mode');
    return v;
  })(),
  bionicReading: localStorage.getItem('bionicReading') === 'true',
  monochromeMode: localStorage.getItem('monochromeMode') === 'true',
  focusMode: localStorage.getItem('focusMode') === 'true',
  viewMode: (localStorage.getItem('viewMode') as ViewMode) || 'normal',
  prefsModifiedLocally: false,
  zenSettings: { autoBionic: false, notificationShield: false },
  darkMode: localStorage.getItem('darkMode') === 'true',
  selectedLang: localStorage.getItem('selectedLang') || null,
  notificationsEnabled: localStorage.getItem('notificationsEnabled') === 'true',
  soundEnabled: localStorage.getItem('soundEnabled') !== 'false',
  connectionStatus: 'disconnected',
  agentStatus: 'online',
  rightSidebarExpanded: localStorage.getItem('rightSidebarExpanded') === 'true',
  lightboxImages: [],
  lightboxIndex: null,

  openLightbox: (images, startIndex) =>
    set({ lightboxImages: images, lightboxIndex: Math.max(0, Math.min(startIndex, images.length - 1)) }),
  closeLightbox: () => set({ lightboxImages: [], lightboxIndex: null }),
  navigateLightbox: (delta) =>
    set((state) => {
      if (state.lightboxIndex === null || state.lightboxImages.length === 0) return {};
      const n = state.lightboxImages.length;
      const next = (state.lightboxIndex + delta + n) % n;
      return { lightboxIndex: next };
    }),

  toggleRightSidebar: () =>
    set((state) => {
      const next = !state.rightSidebarExpanded;
      localStorage.setItem('rightSidebarExpanded', String(next));
      return { rightSidebarExpanded: next };
    }),

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
      trpcVanilla.user.updateAccessibilityPrefs.mutate({ dyslexicMode: next }).catch((err: unknown) => { console.error('[uiSlice] Failed to persist dyslexicMode:', err); });
      return { dyslexicMode: next, prefsModifiedLocally: true };
    }),
  toggleBionicReading: () =>
    set((state) => {
      const next = !state.bionicReading;
      localStorage.setItem('bionicReading', String(next));
      trpcVanilla.user.updateAccessibilityPrefs.mutate({ bionicReading: next }).catch((err: unknown) => { console.error('[uiSlice] Failed to persist bionicReading:', err); });
      return { bionicReading: next, prefsModifiedLocally: true };
    }),
  toggleMonochromeMode: () =>
    set((state) => {
      const next = !state.monochromeMode;
      localStorage.setItem('monochromeMode', String(next));
      if (next) document.documentElement.classList.add('monochrome-mode');
      else document.documentElement.classList.remove('monochrome-mode');
      trpcVanilla.user.updateAccessibilityPrefs.mutate({ monochromeMode: next }).catch((err: unknown) => { console.error('[uiSlice] Failed to persist monochromeMode:', err); });
      return { monochromeMode: next, prefsModifiedLocally: true };
    }),
  toggleFocusMode: () =>
    set((state) => {
      const newFocus = !state.focusMode;
      localStorage.setItem('focusMode', String(newFocus));
      localStorage.setItem('viewMode', newFocus ? 'focus' : 'normal');
      trpcVanilla.user.updateAccessibilityPrefs.mutate({ focusMode: newFocus }).catch((err: unknown) => { console.error('[uiSlice] Failed to persist focusMode:', err); });
      return { focusMode: newFocus, viewMode: newFocus ? 'focus' : 'normal', prefsModifiedLocally: true };
    }),

  toggleSoundEnabled: () =>
    set((state) => {
      const next = !state.soundEnabled;
      localStorage.setItem('soundEnabled', String(next));
      return { soundEnabled: next };
    }),

  setViewMode: (mode) => {
    localStorage.setItem('viewMode', mode);
    const isFocus = mode === 'focus';
    localStorage.setItem('focusMode', String(isFocus));
    set({ viewMode: mode, focusMode: isFocus });
  },

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

  setAgentStatus: (status) => set({ agentStatus: status }),

  hydrateAccessibilityPrefs: (prefs) => {
    if (get().prefsModifiedLocally) return; // don't overwrite local changes made this session
    set(() => {
      const dyslexicMode = prefs.dyslexicMode ?? false;
      const bionicReading = prefs.bionicReading ?? false;
      const monochromeMode = prefs.monochromeMode ?? false;
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
    });
  },

  _resetUIState: () => set(uiResetState),
});
