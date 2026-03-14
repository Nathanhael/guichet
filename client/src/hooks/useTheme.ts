import { useEffect } from 'react';
import useStore from '../store/useStore';
import { usePartner } from './usePartner';

export function useTheme() {
  const { manifest } = usePartner();
  const { darkMode } = useStore();

  useEffect(() => {
    if (!manifest) return;

    const root = document.documentElement;
    const theme = manifest.themeConfig || {};

    // Base colors from manifest (primary/secondary)
    root.style.setProperty('--brand-primary', manifest.primaryColor || '#a855f7');
    root.style.setProperty('--brand-secondary', manifest.secondaryColor || '#3b82f6');

    // Advanced theme config
    if (theme.glassBlur) root.style.setProperty('--glass-blur', theme.glassBlur);
    else root.style.setProperty('--glass-blur', '16px');

    if (theme.glassOpacity) root.style.setProperty('--glass-opacity', theme.glassOpacity);
    else root.style.setProperty('--glass-opacity', darkMode ? '0.1' : '0.3');

    if (theme.accentColor) root.style.setProperty('--accent-color', theme.accentColor);
    else root.style.setProperty('--accent-color', '#f43f5e');

    if (theme.borderRadius) root.style.setProperty('--border-radius', theme.borderRadius);
    else root.style.setProperty('--border-radius', '0.75rem');

  }, [manifest, darkMode]);
}
