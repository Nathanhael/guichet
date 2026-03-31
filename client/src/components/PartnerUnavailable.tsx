import { useStoreShallow } from '../store/useStore';

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
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-bg-base text-text-primary">
      <div className="text-center max-w-md px-8">
        <div className="w-16 h-16 border-2 border-border-heavy flex items-center justify-center mx-auto mb-6">
          <span className="text-2xl font-bold">!</span>
        </div>
        <h1 className="text-2xl font-bold uppercase tracking-tighter mb-2">Partner Unavailable</h1>
        <p className="text-sm font-bold uppercase opacity-60 tracking-widest mb-8">
          {isInactive 
            ? 'This partner is currently inactive.'
            : isPlatformOperator
              ? <>Partner <span className="font-mono">{activeMembershipId}</span> no longer exists or was deleted.</>
              : 'The partner you were connected to no longer exists. Contact your administrator.'}
        </p>
        
        {isPlatformOperator ? (
          <button
            onClick={() => setActiveMembershipId(null)}
            className="btn-primary px-6 py-3"
          >
            Back to Platform
          </button>
        ) : memberships.filter(m => m.status !== 'inactive').length > 0 ? (
          <div className="flex flex-col gap-4">
             <p className="text-xs font-bold uppercase">Switch to another partner:</p>
             <div className="flex flex-wrap justify-center gap-2">
               {memberships.filter(m => m.status !== 'inactive').map(m => (
                  <button
                    key={m.id}
                    onClick={() => setActiveMembershipId(m.id)}
                    className="btn-secondary px-4 py-2 hover:bg-bg-elevated"
                  >
                    {m.partnerName}
                  </button>
               ))}
             </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 items-center">
            {isInactive && <p className="text-xs font-bold uppercase opacity-60">Contact your administrator.</p>}
            <button
              onClick={logout}
              className="btn-secondary px-6 py-3 hover:bg-bg-elevated"
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
