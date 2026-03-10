import React from 'react';
import useStore from '../store/useStore';
import { useT } from '../i18n';
import { Type, Zap } from 'lucide-react';

export default function NeuroToggle() {
  const { dyslexicMode, toggleDyslexicMode, bionicReading, toggleBionicReading, darkMode } = useStore();
  const t = useT();

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-xl bg-black/10 dark:bg-white/5 backdrop-blur-sm border border-white/10">
      {/* Dyslexic Mode Button */}
      <button
        onClick={toggleDyslexicMode}
        title={dyslexicMode ? 'Standaard lettertype' : 'Dyslectisch-vriendelijk lettertype'}
        className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-300 group relative ${
          dyslexicMode 
            ? 'bg-amber-400 text-amber-950 shadow-lg shadow-amber-500/20 scale-105' 
            : 'text-slate-400 hover:text-slate-200 hover:bg-white/10'
        }`}
      >
        <Type size={18} strokeWidth={dyslexicMode ? 3 : 2} />
        {dyslexicMode && (
          <span className="absolute -top-1 -right-1 flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>
        )}
      </button>

      {/* Bionic Reading Button - Only visible when Dyslexic is ON or as a standalone upgrade? 
          The user wanted it when toggling dyslexic, let's keep it visible if dyslexic is on, 
          but maybe make it always available if it's considered a general reading aid.
          For now, keeping the requested 'toggle dyslexic that you can also toggle bionic' flow.
      */}
      {dyslexicMode && (
        <button
          onClick={toggleBionicReading}
          title={bionicReading ? 'Standaard tekst' : 'Bionisch lezen'}
          className={`w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-500 animate-in fade-in zoom-in slide-in-from-left-4 ${
            bionicReading 
              ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/20 scale-105' 
              : 'bg-white/5 text-indigo-300 hover:text-white hover:bg-white/10'
          }`}
        >
          <Zap size={18} fill={bionicReading ? "currentColor" : "none"} strokeWidth={bionicReading ? 2.5 : 2} />
        </button>
      )}
    </div>
  );
}
