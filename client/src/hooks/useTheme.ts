import { useEffect } from 'react';
import useStore from '../store/useStore';

export function useTheme() {
  const darkMode = useStore((s) => s.darkMode);
  const monochromeMode = useStore((s) => s.monochromeMode);

  useEffect(() => {
    try {
      const root = document.documentElement;

      root.classList.toggle('dark', darkMode);
      root.classList.toggle('monochrome-mode', monochromeMode);
    } catch (err) {
      console.error('Error applying theme:', err);
    }
  }, [darkMode, monochromeMode]);
}
