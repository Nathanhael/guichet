import { useEffect } from 'react';
import useStore from '../store/useStore';

export function useTheme() {
  const darkMode = useStore((s) => s.darkMode);
  const monochromeMode = useStore((s) => s.monochromeMode);

  useEffect(() => {
    try {
      const root = document.documentElement;

      if (darkMode) {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }

      if (monochromeMode) {
        // Monochrome Essentials
        root.style.setProperty('--glass-blur', '0px');
        root.style.setProperty('--glass-opacity', '1');
        root.style.setProperty('--glass-saturate', '100%');
        root.style.setProperty('--glass-border', darkMode ? '#ffffff' : '#000000');

        root.style.setProperty('--accent-color', darkMode ? '#ffffff' : '#000000');
        root.style.setProperty('--border-radius', '0px');
        
        root.classList.add('monochrome-mode');
      } else {
        // Standard/Default Theme (Brutalist)
        root.style.setProperty('--glass-blur', '0px');
        root.style.setProperty('--glass-opacity', '1');
        root.style.setProperty('--glass-saturate', '100%');
        root.style.setProperty('--glass-border', darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)');

        root.style.setProperty('--accent-color', darkMode ? '#ffffff' : '#000000');
        root.style.setProperty('--border-radius', '0px');

        root.classList.remove('monochrome-mode');
      }
    } catch (err) {
      console.error('Error applying theme:', err);
    }
  }, [darkMode, monochromeMode]);
}
