import React from 'react';
import { useT } from '../i18n';
import { Ticket } from '../types';

const DEPT_COLOR: Record<string, string> = {
  DSC: 'bg-purple-100 text-purple-700',
  FOT: 'bg-teal-100 text-teal-700',
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
        const time = new Date(ticket.created_at).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(ticket.created_at).toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit' });

        const getParticipantName = (p: string | { name: string }) => typeof p === 'string' ? p : p.name;
        const participantNames = (ticket.participants || []).map(getParticipantName).join(', ');

        return (
          <li
            key={ticket.id}
            onClick={() => onSelect(ticket)}
            className={`p-4 cursor-pointer transition-colors hover:bg-solarized-base2 dark:hover:bg-brand-700 ${activeId === ticket.id
              ? 'bg-solarized-base2 dark:bg-gray-700 border-l-4 border-brand-500'
              : ''
              }`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DEPT_COLOR[ticket.dept] || 'bg-gray-100 text-gray-700'}`}>
                  {ticket.dept}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[ticket.status] || STATUS_COLOR.open}`}>
                  {ticket.status}
                </span>
              </div>
              <span className="text-xs text-solarized-base1">{date} {time}</span>
            </div>

            <p className="text-sm font-medium text-solarized-base01 dark:text-gray-100 truncate">
              {ticket.title || (ticket.dare_ref ? `DARE: ${ticket.dare_ref}` : ticket.cdb_id ? `CDBID: ${ticket.cdb_id}` : t('No title'))}
            </p>

            <div className="flex items-center gap-2 mt-1 text-xs text-solarized-base1 dark:text-gray-400">
              <span>{LANG_FLAG[ticket.agent_lang as keyof typeof LANG_FLAG]} {ticket.agent_lang?.toUpperCase()}</span>
              {participantNames ? (
                <span className="text-green-600 dark:text-green-400 truncate max-w-[150px]" title={participantNames}>
                  • {participantNames}
                </span>
              ) : ticket.expert_name ? (
                <span className="text-green-600 dark:text-green-400 truncate max-w-[150px]" title={ticket.expert_name}>
                  • {ticket.expert_name}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
