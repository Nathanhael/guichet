import { useState, useEffect } from 'react';
import { trpc } from '../../utils/trpc';
import { useT } from '../../i18n';

export default function PlatformAuditLog() {
  const t = useT();
  const [page, setPage] = useState(0);
  const [filterAction, setFilterAction] = useState('');
  const [filterPartnerId, setFilterPartnerId] = useState('');
  const [filterActorId, setFilterActorId] = useState('');
  const [filterTargetId, setFilterTargetId] = useState('');
  const [debouncedTargetId, setDebouncedTargetId] = useState('');
  
  // Date filtering state
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  
  const LIMIT = 50;

  // Debounce the target ID search
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedTargetId(filterTargetId);
      setPage(0); // Reset page on new search
    }, 500);
    return () => clearTimeout(handler);
  }, [filterTargetId]);

  // Reset page when dates change
  useEffect(() => {
    setPage(0);
  }, [dateFrom, dateTo]);

  const { data: partners } = trpc.platform.listPartners.useQuery();

  const queryParams = {
    limit: LIMIT,
    offset: page * LIMIT,
    action: filterAction || undefined,
    partnerId: filterPartnerId || undefined,
    actorId: filterActorId || undefined,
    targetId: debouncedTargetId || undefined,
    // Add date params to the query
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading } = trpc.platform.getAuditLog.useQuery(queryParams);
  const utils = trpc.useUtils();

  async function handleExport() {
    try {
      const currentParams = {
        action: filterAction || undefined,
        partnerId: filterPartnerId || undefined,
        actorId: filterActorId || undefined,
        targetId: debouncedTargetId || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
      };

      const fullLog = await utils.platform.exportAuditLog.fetch(currentParams);

      if (!fullLog || fullLog.length === 0) return alert(t('no_data_export'));

      const headers = [t('col_time'), t('col_action'), t('col_actor'), t('col_partner_id'), t('col_target_type'), t('col_target_id'), t('col_metadata')];
      const rows = fullLog.map(l => [
        new Date(l.createdAt).toISOString(),
        l.action,
        l.actorName || t('system'),
        l.partnerId || '',
        l.targetType || '',
        l.targetId || '',
        JSON.stringify(l.metadata).replace(/"/g, '""')
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map(r => r.map(cell => `"${cell}"`).join(','))
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.setAttribute('download', `tessera_audit_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error(err);
      alert(t('export_failed'));
    }
  }

  // Derive unique actors from loaded log entries
  const actors = data
    ? Array.from(new Map(data.filter(l => l.actorId && l.actorName).map(l => [l.actorId, l.actorName])).entries())
    : [];

  return (
    <div className="max-w-6xl space-y-6 pb-12">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tighter">{t('audit_log_title')}</h2>
          <p className="text-xs uppercase font-bold opacity-60 mt-1 tracking-widest">{t('audit_log_desc')}</p>
        </div>
        <button 
          onClick={handleExport}
          className="px-6 py-2 bg-black dark:bg-white text-white dark:text-black border-2 border-black dark:border-white font-black uppercase text-[10px] tracking-widest hover:invert"
        >
          {t('export_csv')}
        </button>
      </div>

      <div className="flex flex-col gap-3 bg-black/5 dark:bg-white/5 p-4 border-2 border-black dark:border-white">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="space-y-1">
            <label className="text-[8px] font-black uppercase opacity-60 ml-1">{t('action_type')}</label>
            <select
              value={filterAction}
              onChange={e => { setFilterAction(e.target.value); setPage(0); }}
              className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-2 text-xs font-black uppercase tracking-widest outline-none"
            >
              <option value="">{t('all_actions')}</option>
              <option value="partner.config_updated">Config Updated</option>
              <option value="partner.deactivated">Partner Deactivated</option>
              <option value="partner.reactivated">Partner Reactivated</option>
              <option value="partner.deleted">Partner Deleted</option>
              <option value="member.added">Member Added</option>
              <option value="member.invited">Member Invited</option>
              <option value="member.removed">Member Removed</option>
              <option value="member.updated">Member Updated</option>
              <option value="user.deleted">User Deleted</option>
              <option value="gdpr.purge">GDPR Purge</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] font-black uppercase opacity-60 ml-1">{t('partner_context')}</label>
            <select
              value={filterPartnerId}
              onChange={e => { setFilterPartnerId(e.target.value); setPage(0); }}
              className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-2 text-xs font-black uppercase tracking-widest outline-none"
            >
              <option value="">{t('all_partners')}</option>
              {(partners || []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] font-black uppercase opacity-60 ml-1">{t('actor_who')}</label>
            <select
              value={filterActorId}
              onChange={e => { setFilterActorId(e.target.value); setPage(0); }}
              className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-2 text-xs font-black uppercase tracking-widest outline-none"
            >
              <option value="">{t('all_actors')}</option>
              {actors.map(([id, name]) => (
                <option key={id!} value={id!}>{name}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-[8px] font-black uppercase opacity-60 ml-1">{t('target_id_subject')}</label>
            <input 
              type="text" 
              placeholder={t('search_target_id')}
              value={filterTargetId}
              onChange={e => setFilterTargetId(e.target.value)}
              className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-2 text-xs font-bold outline-none"
            />
          </div>
        </div>
        
        {/* Date Filters Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-3 border-t border-black/10 dark:border-white/10">
          <div className="space-y-1">
            <label className="text-[8px] font-black uppercase opacity-60 ml-1">From Date</label>
            <div className="flex gap-2">
              <input 
                type="date" 
                value={dateFrom}
                onChange={e => { setDateFrom(e.target.value); setPage(0); }}
                className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-2 text-xs font-bold outline-none"
              />
              {dateFrom && (
                <button 
                  onClick={() => { setDateFrom(''); setPage(0); }}
                  className="px-3 border-2 border-black dark:border-white bg-white dark:bg-black hover:invert text-[10px] font-black uppercase tracking-widest"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[8px] font-black uppercase opacity-60 ml-1">To Date</label>
            <div className="flex gap-2">
              <input 
                type="date" 
                value={dateTo}
                min={dateFrom}
                onChange={e => { setDateTo(e.target.value); setPage(0); }}
                className="w-full border-2 border-black dark:border-white bg-white dark:bg-black p-2 text-xs font-bold outline-none"
              />
              {dateTo && (
                <button 
                  onClick={() => { setDateTo(''); setPage(0); }}
                  className="px-3 border-2 border-black dark:border-white bg-white dark:bg-black hover:invert text-[10px] font-black uppercase tracking-widest"
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
      </div>


      {isLoading ? (
        <div className="py-8 text-center uppercase font-black opacity-50">{t('loading_log')}</div>
      ) : (
        <div className="border-2 border-black dark:border-white overflow-x-auto custom-scrollbar flex-1 mb-[72px]">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead className="bg-white dark:bg-black border-b-2 border-black dark:border-white">
              <tr className="bg-black/5 dark:bg-white/5">
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('col_time')}</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('col_action')}</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('col_actor')}</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('col_partner_id')}</th>
                <th className="p-3 text-[10px] font-black uppercase tracking-widest">{t('col_details')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10 dark:divide-white/10">
              {data?.map((log) => (
                <tr key={log.id} className="hover:bg-black/5 dark:hover:bg-white/5">
                  <td className="p-3 text-[10px] font-mono whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleString()}
                  </td>
                  <td className="p-3 text-xs font-bold uppercase">{log.action}</td>
                  <td className="p-3 text-xs uppercase">{log.actorName || <span className="opacity-50">{t('system')}</span>}</td>
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

      {/* Enterprise Sticky Footer Pagination */}
      <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-black border-t-4 border-black dark:border-white p-4 z-20 shadow-[0_-8px_0_0_rgba(0,0,0,1)] dark:shadow-[0_-8px_0_0_rgba(255,255,255,1)]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest opacity-60">
            <div className="flex items-center gap-2">
              <span>{t('records_per_page')}</span>
              <span className="border-b-2 border-current pb-0.5">{LIMIT}</span>
            </div>
            <span>|</span>
            <span>{t('page_indicator')} {page + 1}</span>
          </div>

          <div className="flex gap-4">
            <button 
              disabled={page === 0}
              onClick={() => setPage(p => p - 1)}
              className="px-8 py-3 border-2 border-black dark:border-white disabled:opacity-30 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors font-black uppercase text-[10px] tracking-widest"
            >
              ← {t('newer')}
            </button>
            <button 
              disabled={(data?.length || 0) < LIMIT}
              onClick={() => setPage(p => p + 1)}
              className="px-8 py-3 border-2 border-black dark:border-white disabled:opacity-30 hover:bg-black hover:text-white dark:hover:bg-white dark:hover:text-black transition-colors font-black uppercase text-[10px] tracking-widest"
            >
              {t('older')} →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}