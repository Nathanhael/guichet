import { useT } from '../i18n';
import { Ticket } from '../types';
import { getTicketTime } from '../utils/dateUtils';

const DEPT_COLOR: Record<string, string> = {
  DSC: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  FOT: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
};

const STATUS_COLOR: Record<string, string> = {
  open: 'bg-yellow-100 text-yellow-700',
  active: 'bg-green-100 text-green-700',
  closed: 'bg-solarized-base2 text-solarized-base1',
};

const LANG_FLAG: Record<string, string> = { nl: '🇧🇪', fr: '🇫🇷', en: '🇬🇧' };

interface TicketListProps {
  tickets: Ticket[];
  onSelect: (ticket: Ticket) => void;
  activeId: string | null;
}

export default function TicketList({ tickets, onSelect, activeId }: TicketListProps) {
  const t = useT();
  if (tickets.length === 0) {
    return <p className="text-solarized-base1 text-sm p-4 text-center">{t('no_tickets')}</p>;
  }

  return (
    <ul className="divide-y divide-solarized-base2 dark:divide-gray-700">
      {tickets.map((ticket) => {
        const time = getTicketTime(ticket.createdAt);

        return (
          <li
            key={ticket.id}
            onClick={() => onSelect(ticket)}
            className={`p-4 cursor-pointer transition-colors hover:bg-solarized-base2 dark:hover:bg-brand-700 ${activeId === ticket.id
              ? 'bg-solarized-base2 dark:bg-gray-700 border-l-4 border-brand-500'
              : ''
              }`}
          >
            <div className="flex justify-between gap-3">
              {/* Left side: Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DEPT_COLOR[ticket.dept] || 'bg-gray-100 text-gray-700'}`}>
                    {ticket.dept}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[ticket.status] || STATUS_COLOR.open}`}>
                    {ticket.status}
                  </span>
                </div>
                <p className="text-sm font-semibold text-solarized-base01 dark:text-gray-100 truncate">
                  {ticket.agentName || (ticket.dareRef ? `DARE: ${ticket.dareRef}` : ticket.cdbId ? `CDBID: ${ticket.cdbId}` : t('No title'))}
                </p>
                {ticket.ref1 && (
                  <p className="text-[11px] text-solarized-base1 dark:text-gray-400 mt-0.5">
                    {ticket.ref1}
                  </p>
                )}
                <div className="mt-1 text-xs text-solarized-base1 dark:text-gray-400 flex items-center gap-2">
                  <span>{LANG_FLAG[ticket.agentLang as keyof typeof LANG_FLAG]} {ticket.agentLang?.toUpperCase()}</span>
                  <span className="text-solarized-base1 opacity-50">•</span>
                  <span>{time}</span>
                </div>
              </div>

              {/* Right side: Actions/Bubbles */}
              <div className="flex flex-col items-end shrink-0 gap-2">
                {ticket.participants && Array.isArray(ticket.participants) && ticket.participants.length > 0 && (
                  <div className="flex items-center -space-x-1.5 overflow-hidden">
                    {ticket.participants.map((p, idx) => {
                      const pObj = typeof p === 'object' ? p : { name: p || 'Unknown', avatar: null };
                      const pName = pObj.name;
                      const pAvatar = (pObj as any).avatar;
                      return (
                        <div
                          key={idx}
                          title={pName}
                          className="w-5 h-5 rounded-full border border-white dark:border-gray-700 bg-brand-50 dark:bg-brand-900 flex items-center justify-center text-[9px] font-bold shadow-sm overflow-hidden"
                        >
                          {pAvatar ? (
                            <img src={pAvatar} alt={pName} className="w-full h-full object-cover" />
                          ) : (
                            <span className="text-brand-700 dark:text-brand-300">
                              {pName.toString().split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
