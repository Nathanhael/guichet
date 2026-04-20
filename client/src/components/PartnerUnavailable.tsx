import { useStoreShallow } from '../store/useStore';
import Button from './ui/Button';

export default function PartnerUnavailable() {
  const { user, logout, activeMembershipId, setActiveMembershipId, memberships } = useStoreShallow(s => ({
    user: s.user,
    logout: s.logout,
    activeMembershipId: s.activeMembershipId,
    setActiveMembershipId: s.setActiveMembershipId,
    memberships: s.memberships
  }));
  const isPlatformOperator = user?.isPlatformOperator;
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const isInactive = activeMembership?.status === 'inactive';
  const activeOptions = memberships.filter(m => m.status !== 'inactive');
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-[var(--color-bg-base)] text-[var(--color-ink)]">
      <div className="text-center max-w-md px-8">
        <div className="w-14 h-14 rounded-full bg-[var(--color-urgent-soft)] flex items-center justify-center mx-auto mb-5">
          <span className="text-2xl text-[var(--color-urgent)]">!</span>
        </div>
        <h1 className="text-[22px] font-semibold tracking-[-0.2px] mb-2">Partner unavailable</h1>
        <p className="text-[13px] text-[var(--color-ink-muted)] mb-8 leading-relaxed">
          {isInactive
            ? 'This partner is currently inactive.'
            : isPlatformOperator
              ? <>Partner <span className="font-mono text-[var(--color-ink-soft)]">{activeMembershipId}</span> no longer exists or was deleted.</>
              : 'The partner you were connected to no longer exists. Contact your administrator.'}
        </p>

        {isPlatformOperator ? (
          <Button variant="primary" size="md" onClick={() => setActiveMembershipId(null)}>
            Back to Platform
          </Button>
        ) : activeOptions.length > 0 ? (
          <div className="flex flex-col gap-4">
            <p className="text-[12px] text-[var(--color-ink-soft)]">Switch to another partner:</p>
            <div className="flex flex-wrap justify-center gap-2">
              {activeOptions.map(m => (
                <Button
                  key={m.id}
                  variant="secondary"
                  size="md"
                  onClick={() => setActiveMembershipId(m.id)}
                >
                  {m.partnerName}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 items-center">
            {isInactive && <p className="text-[12px] text-[var(--color-ink-muted)]">Contact your administrator.</p>}
            <Button variant="secondary" size="md" onClick={logout}>
              Sign Out
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
