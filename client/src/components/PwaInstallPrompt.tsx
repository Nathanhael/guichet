import { useEffect, useState } from 'react';
import { useT } from '../i18n';
import useStore from '../store/useStore';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * PWA install banner for agent users.
 * Captures the beforeinstallprompt event and shows a branded banner.
 * Only shows for agents, dismisses permanently via localStorage.
 */
export default function PwaInstallPrompt() {
  const user = useStore((s) => s.user);
  const t = useT();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('pwa-install-dismissed') === 'true');
  const [installed, setInstalled] = useState(false);

  const isAgent = user?.role === 'agent';

  useEffect(() => {
    if (!isAgent || dismissed) return;

    // Check if already installed (standalone mode)
    if (window.matchMedia('(display-mode: standalone)').matches) {
      setInstalled(true);
      return;
    }

    function handleBeforeInstall(e: Event) {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setInstalled(true);
      setDeferredPrompt(null);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [isAgent, dismissed]);

  async function handleInstall() {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstalled(true);
    }
    setDeferredPrompt(null);
  }

  function handleDismiss() {
    localStorage.setItem('pwa-install-dismissed', 'true');
    setDismissed(true);
    setDeferredPrompt(null);
  }

  // Don't render if: not agent, already dismissed, already installed, or no prompt available
  if (!isAgent || dismissed || installed || !deferredPrompt) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-bg-surface border-t-2 border-border-heavy px-4 py-3 flex items-center justify-between gap-4 animate-fade-in">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-text-primary">
          {t('pwa_install_title') || 'Install Tessera'}
        </p>
        <p className="text-[10px] text-text-muted mt-0.5">
          {t('pwa_install_body') || 'Quick access and push notifications on your device'}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleDismiss}
          className="text-[10px] font-bold uppercase text-text-muted hover:text-text-primary px-2 py-1.5"
        >
          {t('not_now') || 'Not now'}
        </button>
        <button
          onClick={handleInstall}
          className="text-[10px] font-bold uppercase bg-accent-blue text-white px-3 py-1.5 hover:bg-accent-blue-light"
        >
          {t('install') || 'Install'}
        </button>
      </div>
    </div>
  );
}
