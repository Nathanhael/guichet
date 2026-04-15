import { useStoreShallow } from '../store/useStore';
import { trpc } from '../utils/trpc';

// Native-language labels. No flag emojis in source — Rolldown's
// hash-placeholder resolver panicked on flag codepoints at certain byte
// offsets; text labels avoid the trap AND match the brutalist "no
// decorative glyphs" spec.
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

  // Authenticated users get the locale-info query to render the "SYNCED FROM
  // SSO" badge. Pre-auth (login page) skips it — `user` is null there.
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
      // Persist pick + silent lock so the next SSO login does not overwrite
      // the user's choice. There is no user-facing unlock affordance — an
      // admin would flip `users.lang_locked` directly on the rare occasion
      // someone needs to re-enable SSO-driven sync.
      setLocale.mutate({ lang: code, lockFromSso: true });
    } else if (user) {
      // Local-only user (platform operator with no external_id): persist,
      // no lock semantics needed.
      setLocale.mutate({ lang: code });
    }
  };

  const showBadge = !!user && !!info?.hasSso && !info.langLocked;

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        {LANGUAGES.map((lang) => (
          <button
            key={lang.code}
            onClick={() => handlePick(lang.code)}
            className={`px-2 py-1 text-[9px] font-bold border ${
              currentLang === lang.code
                ? 'bg-accent-blue text-[var(--color-btn-text-inverse)] border-accent-blue'
                : 'bg-transparent text-text-primary border-transparent opacity-40 hover:opacity-100'
            }`}
          >
            {lang.label}
          </button>
        ))}
      </div>
      {showBadge && (
        <span className="text-[8px] font-bold uppercase tracking-widest text-text-secondary">
          SYNCED FROM SSO
        </span>
      )}
    </div>
  );
}
