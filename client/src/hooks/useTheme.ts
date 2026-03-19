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
        // Standard/Default Theme (Polished)
        root.style.setProperty('--glass-blur', '16px');
        root.style.setProperty('--glass-opacity', '0.7');
        root.style.setProperty('--glass-saturate', '150%');
        root.style.setProperty('--glass-border', 'rgba(255, 255, 255, 0.15)');

        root.style.setProperty('--accent-color', '#e65649');
        root.style.setProperty('--border-radius', '12px');
        
        root.classList.remove('monochrome-mode');
      }
    } catch (err) {
      console.error('Error applying theme:', err);
    }
  }, [darkMode, monochromeMode]);
}
