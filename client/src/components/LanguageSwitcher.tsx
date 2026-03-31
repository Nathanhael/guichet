import { useStoreShallow } from '../store/useStore';

const LANGUAGES = [
  { code: 'en', label: 'EN' },
  { code: 'nl', label: 'NL' },
  { code: 'fr', label: 'FR' },
] as const;

export default function LanguageSwitcher() {
  const { user, selectedLang, setSelectedLang } = useStoreShallow(s => ({
    user: s.user,
    selectedLang: s.selectedLang,
    setSelectedLang: s.setSelectedLang
  }));
  const currentLang = selectedLang || user?.lang || 'en';

  return (
    <div className="flex items-center gap-1">
      {LANGUAGES.map((lang) => (
        <button
          key={lang.code}
          onClick={() => setSelectedLang(lang.code)}
          className={`px-2 py-1 text-[9px] font-bold border ${
            currentLang === lang.code
              ? 'bg-accent-blue text-white border-accent-blue'
              : 'bg-transparent text-text-primary border-transparent opacity-40 hover:opacity-100'
          }`}
        >
          {lang.label}
        </button>
      ))}
    </div>
  );
}
