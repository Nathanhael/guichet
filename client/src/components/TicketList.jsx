import React from 'react';
import { useT } from '../i18n';

const DEPT_COLOR = {
  DSC: 'bg-purple-100 text-purple-700',
  FOT: 'bg-teal-100 text-teal-700',
};

const STATUS_COLOR = {
  open: 'bg-yellow-100 text-yellow-700',
  active: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-500',
};

const LANG_FLAG = { nl: '🇧🇪', fr: '🇫🇷', en: '🇬🇧' };

export default function TicketList({ tickets, onSelect, activeId }) {
  const t = useT();
  if (tickets.length === 0) {
    return <p className="text-gray-400 text-sm p-4 text-center">{t('no_tickets')}</p>;
  }

  return (
    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
      {tickets.map((ticket) => {
        const time = new Date(ticket.createdAt).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
        const date = new Date(ticket.createdAt).toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit' });

        return (
          <li
            key={ticket.id}
            onClick={() => onSelect(ticket)}
            className={`p-4 cursor-pointer transition-colors hover:bg-brand-50 dark:hover:bg-brand-700 ${activeId === ticket.id
              ? 'bg-brand-50 dark:bg-gray-700 border-l-4 border-brand-500'
              : ''
              }`}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${DEPT_COLOR[ticket.dept]}`}>
                  {ticket.dept}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_COLOR[ticket.status] || STATUS_COLOR.open}`}>
                  {ticket.status}
                </span>
              </div>
              <span className="text-xs text-gray-400">{date} {time}</span>
            </div>

            <p className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
              {ticket.title || (ticket.dareRef ? `DARE: ${ticket.dareRef}` : ticket.cdbId ? `CDBID: ${ticket.cdbId}` : t('No title'))}
            </p>

            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
              <span>{LANG_FLAG[ticket.agentLang]} {ticket.agentLang?.toUpperCase()}</span>
              {ticket.participants && ticket.participants.length > 0 ? (
                <span className="text-green-600 dark:text-green-400 truncate max-w-[150px]" title={ticket.participants.map(p => p.name).join(', ')}>
                  • {ticket.participants.map(p => p.name).join(', ')}
                </span>
              ) : ticket.expertName ? (
                <span className="text-green-600 dark:text-green-400 truncate max-w-[150px]" title={ticket.expertName}>
                  • {ticket.expertName}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
