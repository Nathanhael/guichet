import React from 'react';
import { generatePalette } from '../../utils/colorUtils';

interface ThemePreviewProps {
  primaryColor: string;
  secondaryColor: string;
}

export default function ThemePreviewCard({ primaryColor, secondaryColor }: ThemePreviewProps) {
  const palette = generatePalette(primaryColor);

  // Scoped CSS variables on this wrapper — does NOT affect the rest of the page
  const scopeVars = {
    '--preview-primary': primaryColor,
    '--preview-secondary': secondaryColor,
    '--preview-50': palette['50'],
    '--preview-100': palette['100'],
    '--preview-700': palette['700'],
    '--preview-800': palette['800'],
    '--preview-900': palette['900'],
  } as React.CSSProperties;

  return (
    <div style={scopeVars} className="mt-4 rounded-2xl p-4 overflow-hidden border border-slate-200 dark:border-slate-700"
         data-testid="theme-preview">
      <div className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wider">Theme Preview</div>
      
      {/* Background gradient */}
      <div className="rounded-xl p-4 space-y-3 relative overflow-hidden"
           style={{ background: `linear-gradient(135deg, ${palette['900']}, ${palette['800']})` }}>

        {/* Mini glass card */}
        <div className="rounded-lg p-3 space-y-2 relative z-10"
             style={{
               background: `rgba(255, 255, 255, 0.1)`,
               backdropFilter: 'blur(16px)',
               border: '1px solid rgba(255, 255, 255, 0.15)',
             }}>

          {/* Sample "other" message */}
          <div className="flex items-start gap-2">
            <div className="w-6 h-6 rounded-full flex-shrink-0"
                 style={{ backgroundColor: palette['400'] }} />
            <div className="rounded-lg rounded-tl-none px-3 py-1.5 text-[10px] text-white/90 max-w-[70%]"
                 style={{ backgroundColor: palette['700'] }}>
              Hello, how can I help?
            </div>
          </div>

          {/* Sample "mine" message */}
          <div className="flex justify-end">
            <div className="rounded-lg rounded-tr-none px-3 py-1.5 text-[10px] text-white max-w-[70%]"
                 style={{ backgroundColor: primaryColor }}>
              I need help with my account
            </div>
          </div>
        </div>

        {/* Sample button */}
        <div className="flex gap-2 relative z-10">
          <div className="px-3 py-1 rounded-lg text-[10px] font-medium text-white shadow-sm"
               style={{ backgroundColor: primaryColor }}>
            Primary
          </div>
          <div className="px-3 py-1 rounded-lg text-[10px] font-medium text-white shadow-sm"
               style={{ backgroundColor: secondaryColor }}>
            Secondary
          </div>
        </div>
        
        {/* Subtle glow */}
        <div className="absolute top-0 right-0 w-32 h-32 blur-3xl rounded-full opacity-20"
             style={{ backgroundColor: primaryColor }} />
      </div>
    </div>
  );
}
