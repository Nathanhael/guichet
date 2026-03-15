import { generatePalette } from '../../utils/colorUtils';

interface ThemePreviewProps {
  primaryColor: string;
  secondaryColor: string;
}

export default function ThemePreviewCard({ primaryColor, secondaryColor }: ThemePreviewProps) {
  const palette = generatePalette(primaryColor);

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
    <div style={scopeVars} className="mt-4 rounded-2xl p-4 overflow-hidden"
         data-testid="theme-preview">
      <div className="rounded-xl p-4 space-y-3"
           style={{ background: `linear-gradient(135deg, ${palette['900']}, ${palette['800']})` }}>
        <div className="rounded-lg p-3 space-y-2"
             style={{
               background: 'rgba(255, 255, 255, 0.1)',
               backdropFilter: 'blur(16px)',
               border: '1px solid rgba(255, 255, 255, 0.15)',
             }}>
          <div className="flex items-start gap-2">
            <div className="w-6 h-6 rounded-full flex-shrink-0"
                 style={{ backgroundColor: palette['400'] }} />
            <div className="rounded-lg rounded-tl-none px-3 py-1.5 text-xs text-white/90 max-w-[70%]"
                 style={{ backgroundColor: palette['700'] }}>
              Hello, how can I help?
            </div>
          </div>
          <div className="flex justify-end">
            <div className="rounded-lg rounded-tr-none px-3 py-1.5 text-xs text-white max-w-[70%]"
                 style={{ backgroundColor: primaryColor }}>
              I need help with my account
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="px-3 py-1 rounded-lg text-xs font-medium text-white"
               style={{ backgroundColor: primaryColor }}>
            Primary
          </div>
          <div className="px-3 py-1 rounded-lg text-xs font-medium text-white"
               style={{ backgroundColor: secondaryColor }}>
            Secondary
          </div>
        </div>
      </div>
    </div>
  );
}
