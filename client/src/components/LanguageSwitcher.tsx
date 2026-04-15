import { useEffect, useState } from 'react';
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

  // Authenticated users get the locale-info query to render the SYNCED /
  // UNLOCK badges. Pre-auth (login page) skips it — `user` is null there.
  const utils = trpc.useUtils();
  const localeInfoQuery = trpc.user.getLocaleInfo.useQuery(undefined, {
    enabled: !!user,
  });
  const setLocale = trpc.user.setLocale.useMutation({
    onSuccess: () => utils.user.getLocaleInfo.invalidate(),
  });

  const currentLang = selectedLang || user?.lang || 'en';
  const info = localeInfoQuery.data;
  const showSyncUi = !!user && !!info?.hasSso;

  const [pendingUnlock, setPendingUnlock] = useState(false);
  useEffect(() => {
    if (!setLocale.isPending) setPendingUnlock(false);
  }, [setLocale.isPending]);

  const handlePick = (code: 'en' | 'nl' | 'fr') => {
    setSelectedLang(code);
    if (user && info?.hasSso) {
      // Persist pick + lock so SSO login doesn't overwrite it next time.
      setLocale.mutate({ lang: code, lockFromSso: true });
    } else if (user) {
      // Local-only user (platform operator): persist, no lock semantics needed.
      setLocale.mutate({ lang: code });
    }
  };

  const handleUnlock = () => {
    setPendingUnlock(true);
    setLocale.mutate({ lockFromSso: false });
  };

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
      {showSyncUi && info && !info.langLocked && (
        <span className="text-[8px] font-bold uppercase tracking-widest text-text-secondary">
          SYNCED FROM SSO
        </span>
      )}
      {showSyncUi && info?.langLocked && (
        <button
          onClick={handleUnlock}
          disabled={setLocale.isPending}
          className="text-[8px] font-bold uppercase tracking-widest text-accent-blue hover:underline disabled:opacity-40 text-left"
        >
          {pendingUnlock ? 'UNLOCKING…' : 'UNLOCK SSO SYNC'}
        </button>
      )}
    </div>
  );
}
