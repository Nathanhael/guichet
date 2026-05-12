import { useState, useEffect } from 'react';
import { Info, X } from 'lucide-react';
import { trpc } from '../utils/trpc';
import { useT } from '../i18n';
import { useStoreShallow } from '../store/useStore';
import AiDisclosureModal from './AiDisclosureModal';

/**
 * Discoverability bar that surfaces the AI disclosure + opt-out toggle to
 * the worker once per workspace session. The opt-out toggle itself lives in
 * the profile menu (UserMenuChip); this banner makes sure workers know it
 * exists.
 *
 * Hidden conditions:
 * - User not logged in
 * - User has no active partner membership (platform-operator cockpit)
 * - Partner has no AI features enabled
 * - User has dismissed this banner in this workspace (localStorage)
 *
 * Dismiss is per-(user, partner) so a workspace switch surfaces it again
 * for the new partner — different employer, potentially different policy.
 */
export default function AiDisclosureBanner() {
  const { user, activeMembershipId } = useStoreShallow((s) => ({
    user: s.user,
    activeMembershipId: s.activeMembershipId,
  }));
  const t = useT();

  const dismissKey = user && activeMembershipId
    ? `ai_disclosure_dismissed:${user.id}:${activeMembershipId}`
    : null;

  const [dismissed, setDismissed] = useState<boolean>(() => {
    if (!dismissKey || typeof window === 'undefined') return false;
    return window.localStorage.getItem(dismissKey) === '1';
  });
  useEffect(() => {
    if (!dismissKey || typeof window === 'undefined') return;
    setDismissed(window.localStorage.getItem(dismissKey) === '1');
  }, [dismissKey]);

  const [modalOpen, setModalOpen] = useState(false);

  const aiCfg = trpc.ai.getEffectiveConfig.useQuery(undefined, {
    enabled: !!user && !!activeMembershipId,
  });

  const anyAiOn = !!aiCfg.data && (
    aiCfg.data.translation === true ||
    aiCfg.data.voiceTranscription === true ||
    aiCfg.data.cannedTranslation === true ||
    (aiCfg.data.partnerMessageImprovement && aiCfg.data.partnerMessageImprovement !== 'off')
  );

  if (!user || !activeMembershipId || !anyAiOn || dismissed) return null;

  function handleDismiss() {
    if (dismissKey && typeof window !== 'undefined') {
      window.localStorage.setItem(dismissKey, '1');
    }
    setDismissed(true);
  }

  return (
    <>
      <div
        role="status"
        className="flex items-start gap-2 px-3 py-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)] text-[12px]"
      >
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0 text-[var(--color-accent)]" aria-hidden />
        <p className="flex-1 leading-snug text-[var(--color-ink-soft)]">
          {t('ai_banner_text')}{' '}
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="underline text-[var(--color-accent)] hover:text-[var(--color-ink)]"
          >
            {t('ai_banner_more')}
          </button>
        </p>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t('dismiss')}
          className="shrink-0 inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-btn)] text-[var(--color-ink-muted)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <AiDisclosureModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}
