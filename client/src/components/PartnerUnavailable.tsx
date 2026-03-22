import useStore from '../store/useStore';

export default function PartnerUnavailable() {
  const { user, logout, activeMembershipId, setActiveMembershipId, memberships } = useStore();
  const isPlatformOperator = user?.isPlatformOperator;
  const activeMembership = memberships.find(m => m.id === activeMembershipId);
  const isInactive = activeMembership?.status === 'inactive';
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-white dark:bg-black text-black dark:text-white">
      <div className="text-center max-w-md px-8">
        <div className="w-16 h-16 border-4 border-black dark:border-white flex items-center justify-center mx-auto mb-6">
          <span className="text-2xl font-black">!</span>
        </div>
        <h1 className="text-2xl font-black uppercase tracking-tighter mb-2">Partner Unavailable</h1>
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
            className="px-6 py-3 text-[10px] font-black uppercase tracking-widest bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white hover:invert transition-all"
          >
            Back to Platform
          </button>
        ) : memberships.filter(m => m.status !== 'inactive').length > 0 ? (
          <div className="flex flex-col gap-4">
             <p className="text-xs font-black uppercase">Switch to another partner:</p>
             <div className="flex flex-wrap justify-center gap-2">
               {memberships.filter(m => m.status !== 'inactive').map(m => (
                  <button
                    key={m.id}
                    onClick={() => setActiveMembershipId(m.id)}
                    className="px-4 py-2 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-all"
                  >
                    {m.partnerName}
                  </button>
               ))}
             </div>
          </div>
        ) : (
          <div className="flex flex-col gap-4 items-center">
            {isInactive && <p className="text-xs font-black uppercase opacity-60">Contact your administrator.</p>}
            <button
              onClick={logout}
              className="px-6 py-3 text-[10px] font-black uppercase tracking-widest border-2 border-black dark:border-white hover:bg-black dark:hover:bg-white hover:text-white dark:hover:text-black transition-all"
            >
              Sign Out
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
