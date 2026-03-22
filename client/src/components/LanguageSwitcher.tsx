import useStore from '../store/useStore';

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'nl', label: 'NL' },
  { code: 'fr', label: 'FR' },
] as const;

export default function LanguageSwitcher() {
  const { user, selectedLang, setSelectedLang } = useStore();
  const currentLang = selectedLang || user?.lang || 'en';

  return (
    <div className="flex items-center gap-1">
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          onClick={() => setSelectedLang(lang.code)}
          className={`px-2 py-1 text-[9px] font-black border transition-all ${
            currentLang === lang.code
              ? 'bg-black dark:bg-white text-white dark:text-black border-black dark:border-white'
              : 'bg-transparent text-black dark:text-white border-transparent opacity-40 hover:opacity-100'
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
