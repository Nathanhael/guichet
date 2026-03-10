import React from 'react';
import useStore from '../store/useStore';

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'nl', label: 'NL' },
  { code: 'fr', label: 'FR' },
];

export default function LanguageSwitcher() {
  const { user, selectedLang, setSelectedLang } = useStore();
  const currentLang = selectedLang || user?.lang || 'en';

  return (
    <div className="flex items-center p-0.5 rounded-lg bg-black/10 dark:bg-white/5 border border-white/5">
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          onClick={() => setSelectedLang(lang.code)}
          className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all duration-300 ${
            currentLang === lang.code
              ? 'bg-white/20 dark:bg-white/10 text-white shadow-sm ring-1 ring-white/10'
              : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
