import useStore from '../store/useStore';
import { Type, Zap } from 'lucide-react';

export default function NeuroToggle() {
  const { dyslexicMode, toggleDyslexicMode, bionicReading, toggleBionicReading } = useStore();

  return (
    <div className="flex items-center p-0.5 rounded-lg bg-black/10 dark:bg-white/5 border border-white/5">
      {/* Dyslexic Mode Button */}
      <button
        onClick={toggleDyslexicMode}
        title={dyslexicMode ? 'Standard font' : 'Dyslexic-friendly font'}
        className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all duration-300 group relative ${
          dyslexicMode 
            ? 'bg-white/20 dark:bg-white/10 text-white shadow-sm ring-1 ring-white/10' 
            : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
        }`}
      >
        <Type size={12} strokeWidth={dyslexicMode ? 3 : 2} />
        {dyslexicMode && (
          <span className="absolute -top-0.5 -right-0.5 flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
          </span>
        )}
      </button>

      {/* Bionic Reading Button */}
      {dyslexicMode && (
        <button
          onClick={toggleBionicReading}
          title={bionicReading ? 'Standard text' : 'Bionic reading'}
          className={`px-2 py-1 rounded-md text-[10px] font-bold ml-0.5 transition-all duration-500 animate-in fade-in zoom-in slide-in-from-left-4 ${
            bionicReading 
              ? 'bg-white/20 dark:bg-white/10 text-white shadow-sm ring-1 ring-white/10' 
              : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
          }`}
        >
          <Zap size={12} fill={bionicReading ? "currentColor" : "none"} strokeWidth={bionicReading ? 2.5 : 2} />
        </button>
      )}
    </div>
  );
}
