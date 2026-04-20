import { useStoreShallow } from '../store/useStore';
import { trpc } from '../utils/trpc';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'fr', label: 'Francais' },
] as const;

export default function LanguageSwitcher() {
  const { user, selectedLang, setSelectedLang } = useStoreShallow((s) => ({
    user: s.user,
    selectedLang: s.selectedLang,
    setSelectedLang: s.setSelectedLang,
  }));

  const utils = trpc.useUtils();
  const localeInfoQuery = trpc.user.getLocaleInfo.useQuery(undefined, {
    enabled: !!user,
  });
  const setLocale = trpc.user.setLocale.useMutation({
    onSuccess: () => utils.user.getLocaleInfo.invalidate(),
  });

  const currentLang = selectedLang || user?.lang || 'en';
  const info = localeInfoQuery.data;

  const handlePick = (code: 'en' | 'nl' | 'fr') => {
    setSelectedLang(code);
    if (user && info?.hasSso) {
      setLocale.mutate({ lang: code, lockFromSso: true });
    } else if (user) {
      setLocale.mutate({ lang: code });
    }
  };

  const showBadge = !!user && !!info?.hasSso && !info.langLocked;

  return (
    <div className="flex flex-col gap-1 items-end">
      <div className="flex items-center gap-1">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handlePick(lang.code)}
            className={`px-2 py-1 text-[11px] font-medium rounded-[var(--radius-btn)] transition-colors ${
              currentLang === lang.code
                ? 'bg-[var(--color-accent)] text-white'
                : 'text-[var(--color-ink-soft)] hover:text-[var(--color-ink)] hover:bg-[var(--color-hover)]'
            }`}
          >
            {lang.label}
          </button>
        ))}
      </div>
      {showBadge && (
        <span className="text-[10px] text-[var(--color-ink-muted)]">
          Synced from SSO
        </span>
      )}
    </div>
  );
}
