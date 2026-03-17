import { useEffect } from 'react';
import useStore from '../store/useStore';

export function useTheme() {
  const darkMode = useStore((s) => s.darkMode);

  useEffect(() => {
    const root = document.documentElement;
    const mode = darkMode ? 'dark' : 'light';

    // B&W Essentials
    root.style.setProperty('--glass-blur', '0px');
    root.style.setProperty('--glass-opacity', '1');
    root.style.setProperty('--glass-saturate', '100%');
    root.style.setProperty('--glass-border', darkMode ? '#ffffff' : '#000000');

    // Standard properties
    root.style.setProperty('--accent-color', darkMode ? '#ffffff' : '#000000');
    root.style.setProperty('--border-radius', '0px');

  }, [darkMode]);
}
