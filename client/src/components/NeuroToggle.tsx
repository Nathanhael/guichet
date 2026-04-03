import { useStoreShallow } from '../store/useStore';
import { Type, Zap, Contrast } from 'lucide-react';

export default function NeuroToggle() {
  const {
    dyslexicMode, toggleDyslexicMode,
    bionicReading, toggleBionicReading,
    monochromeMode, toggleMonochromeMode
  } = useStoreShallow(s => ({
    dyslexicMode: s.dyslexicMode,
    toggleDyslexicMode: s.toggleDyslexicMode,
    bionicReading: s.bionicReading,
    toggleBionicReading: s.toggleBionicReading,
    monochromeMode: s.monochromeMode,
    toggleMonochromeMode: s.toggleMonochromeMode
  }));

  return (
    <div className="flex items-center p-0.5 bg-black/10 dark:bg-white/5 border border-black dark:border-white">
      {/* Monochrome Mode Button */}
      <button
        onClick={toggleMonochromeMode}
        title={monochromeMode ? 'Full Color UI' : 'Monochrome UI'}
        className={`px-2 py-1 text-[10px] font-bold ${
          monochromeMode
            ? 'bg-black/20 dark:bg-white/10 text-black dark:text-white'
            : 'text-black dark:text-white opacity-40 hover:opacity-100'
        }`}
      >
        <Contrast size={12} strokeWidth={monochromeMode ? 3 : 2} />
      </button>

      {/* Dyslexic Mode Button */}
      <button
        onClick={toggleDyslexicMode}
        title={dyslexicMode ? 'Standard font' : 'Dyslexic-friendly font'}
        className={`px-2 py-1 text-[10px] font-bold ml-0.5 ${
          dyslexicMode
            ? 'bg-black/20 dark:bg-white/10 text-black dark:text-white'
            : 'text-black dark:text-white opacity-40 hover:opacity-100'
        }`}
      >
        <Type size={12} strokeWidth={dyslexicMode ? 3 : 2} />
        {dyslexicMode && (
          <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-black dark:bg-white"></span>
          </span>
        )}
      </button>

      {/* Bionic Reading Button */}
      <button
        onClick={toggleBionicReading}
        title={bionicReading ? 'Standard text' : 'Bionic reading'}
        className={`px-2 py-1 text-[10px] font-bold ml-0.5 ${
          bionicReading
            ? 'bg-black/20 dark:bg-white/10 text-black dark:text-white'
            : 'text-black dark:text-white opacity-40 hover:opacity-100'
        }`}
      >
        <Zap size={12} fill={bionicReading ? "currentColor" : "none"} strokeWidth={bionicReading ? 2.5 : 2} />
      </button>
    </div>
  );
}
