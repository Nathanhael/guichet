import { useEffect } from 'react';
import { usePartner } from './usePartner';
import useStore from '../store/useStore';
import { generatePalette } from '../utils/colorUtils';

const DEFAULT_PRIMARY = '#a855f7';
const DEFAULT_SECONDARY = '#3b82f6';

const GLASS_DEFAULTS = {
  light: { opacity: '0.3', blur: '16px', saturate: '150%', border: 'rgba(255, 255, 255, 0.4)' },
  dark:  { opacity: '0.1', blur: '20px', saturate: '180%', border: 'rgba(255, 255, 255, 0.1)' },
};

export function useTheme() {
  const { manifest } = usePartner();
  const darkMode = useStore((s) => s.darkMode);

  useEffect(() => {
    const root = document.documentElement;
    const theme = manifest?.themeConfig || {};
    const mode = darkMode ? 'dark' : 'light';

    // Brand colors — use manifest or defaults
    const primary = manifest?.primaryColor || DEFAULT_PRIMARY;
    const secondary = manifest?.secondaryColor || DEFAULT_SECONDARY;
    root.style.setProperty('--brand-primary', primary);
    root.style.setProperty('--brand-secondary', secondary);

    // Generate and inject full palette
    const primaryPalette = generatePalette(primary);
    Object.entries(primaryPalette).forEach(([shade, color]) => {
      root.style.setProperty(`--brand-${shade}`, color);
    });

    const secondaryPalette = generatePalette(secondary);
    Object.entries(secondaryPalette).forEach(([shade, color]) => {
      root.style.setProperty(`--brand-secondary-${shade}`, color);
    });

    // Glass defaults — partner theme overrides mode defaults
    const glass = GLASS_DEFAULTS[mode];
    root.style.setProperty('--glass-blur', theme.glassBlur || glass.blur);
    root.style.setProperty('--glass-opacity', theme.glassOpacity || glass.opacity);
    root.style.setProperty('--glass-saturate', glass.saturate);
    root.style.setProperty('--glass-border', glass.border);

    // Other theme properties
    root.style.setProperty('--accent-color', theme.accentColor || '#f43f5e');
    root.style.setProperty('--border-radius', theme.borderRadius || '0.75rem');

  }, [manifest, darkMode]);
}
