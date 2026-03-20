import { useState } from 'react';
import { trpc } from '../../utils/trpc';

export default function PlatformAuditLog() {
  const [page, setPage] = useState(0);
  const [filterAction, setFilterAction] = useState('');
  const [filterPartnerId, setFilterPartnerId] = useState('');
  const [filterActorId, setFilterActorId] = useState('');
  const LIMIT = 50;

  const { data: partners } = trpc.platform.listPartners.useQuery();

  const { data, isLoading } = trpc.platform.getAuditLog.useQuery({
    limit: LIMIT,
    offset: page * LIMIT,
    action: filterAction || undefined,
    partnerId: filterPartnerId || undefined,
    actorId: filterActorId || undefined,
  });

  // Derive unique actors from loaded log entries
  const actors = data
    ? Array.from(new Map(data.filter(l => l.actorId && l.actorName).map(l => [l.actorId, l.actorName])).entries())
    : [];

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest">Audit Log</h2>
          <p className="text-xs uppercase opacity-60 mt-1">System-wide activity tracker</p>
        </div>
        <div className="flex gap-2">
          <select
            value={filterAction}
            onChange={e => { setFilterAction(e.target.value); setPage(0); }}
            className="border-2 border-black dark:border-white bg-transparent p-2 text-xs font-black uppercase tracking-widest"
          >
            <option value="">All Actions</option>
            <option value="partner.config_updated">Config Updated</option>
            <option value="partner.deactivated">Partner Deactivated</option>
            <option value="partner.reactivated">Partner Reactivated</option>
            <option value="partner.deleted">Partner Deleted</option>
            <option value="member.added">Member Added</option>
            <option value="member.invited">Member Invited</option>
            <option value="member.removed">Member Removed</option>
            <option value="member.updated">Member Updated</option>
            <option value="gdpr.purge">GDPR Purge</option>
          </select>
          <select
            value={filterPartnerId}
            onChange={e => { setFilterPartnerId(e.target.value); setPage(0); }}
            className="border-2 border-black dark:border-white bg-transparent p-2 text-xs font-black uppercase tracking-widest"
          >
            <option value="">All Partners</option>
            {(partners || []).map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select
            value={filterActorId}
            onChange={e => { setFilterActorId(e.target.value); setPage(0); }}
            className="border-2 border-black dark:border-white bg-transparent p-2 text-xs font-black uppercase tracking-widest"
          >
            <option value="">All Actors</option>
            {actors.map(([id, name]) => (
              <option key={id!} value={id!}>{name}</option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="py-8 text-center uppercase font-black opacity-50">Loading Log...</div>
      ) : (
        <div className="border border-black dark:border-white overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-black dark:border-white bg-black/5 dark:bg-white/5">
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">Time</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">Action</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">Actor</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">Partner ID</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/20 dark:divide-white/20">
              {data?.map((log) => (
                <tr key={log.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                  <td className="p-3 text-[10px] font-mono whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3 text-xs font-bold uppercase">{log.action}</td>
                  <td className="p-3 text-xs uppercase">{log.actorName || <span className="opacity-50">System</span>}</td>
                  <td className="p-3 text-xs font-mono opacity-80">{log.partnerId || '-'}</td>
                  <td className="p-3 text-[10px] font-mono opacity-80 max-w-xs truncate" title={JSON.stringify(log.metadata)}>
                    {JSON.stringify(log.metadata)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex justify-between items-center text-xs font-black uppercase mt-4">
        <button 
          disabled={page === 0}
          onClick={() => setPage(p => p - 1)}
          className="px-4 py-2 border border-black dark:border-white disabled:opacity-30"
        >
          Newer
        </button>
        <button 
          disabled={(data?.length || 0) < LIMIT}
          onClick={() => setPage(p => p + 1)}
          className="px-4 py-2 border border-black dark:border-white disabled:opacity-30"
        >
          Older
        </button>
      </div>
    </div>
  );
}