import { useEffect, useState, useMemo } from 'react';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import { getSocket } from '../../hooks/useSocket';
import { PartnerManifest } from '../../types';
import { useBusinessHours } from '../../hooks/useBusinessHours';

interface TicketFormProps {
  manifest: PartnerManifest;
}

/**
 * Ticket creation form for agents.
 * Department selector → dynamic reference fields → problem textarea → submit.
 */
export default function TicketForm({ manifest }: TicketFormProps) {
  const user = useStore((s) => s.user);
  const queuePosition = useStore((s) => s.queuePosition);
  const setQueuePosition = useStore((s) => s.setQueuePosition);
  const { status: businessHoursStatus } = useBusinessHours();
  const canCreateTicket = businessHoursStatus?.isOpen ?? true;
  const t = useT();

  const [dept, setDept] = useState(manifest.departments[0]?.id || '');
  const [references, setReferences] = useState<Array<{ label: string; value: string }>>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedDept = useMemo(
    () => manifest.departments.find((d) => d.id === dept),
    [manifest.departments, dept],
  );
  const refFields = selectedDept?.referenceFields || [];
  const allRefsFilledIn = refFields.length === 0 || references.every((r) => r.value.trim() !== '');

  // Sync references when department changes
  useEffect(() => {
    const fields = selectedDept?.referenceFields || [];
    setReferences(fields.map((f) => ({ label: f.label, value: '' })));
  }, [selectedDept]);

  // If selected department is removed from manifest, fall back to first
  useEffect(() => {
    const hasSelectedDept = manifest.departments.some((d) => d.id === dept);
    if (!hasSelectedDept) {
      setDept(manifest.departments[0]?.id || '');
    }
  }, [manifest.departments, dept]);

  // Socket listeners for ticket creation result
  useEffect(() => {
    const s = getSocket();
    const onCreated = () => {
      setReferences((prev) => prev.map((r) => ({ ...r, value: '' })));
      setText('');
      setLoading(false);
      setQueuePosition(null);
    };
    const onError = () => {
      setLoading(false);
      setQueuePosition(null);
    };
    s.on('ticket:created:self', onCreated);
    s.on('error', onError);
    s.on('hours:closed', onError);
    return () => {
      s.off('ticket:created:self', onCreated);
      s.off('error', onError);
      s.off('hours:closed', onError);
    };
  }, [setQueuePosition]);

  function updateReference(label: string, value: string) {
    setReferences((prev) => prev.map((r) => (r.label === label ? { ...r, value } : r)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !text.trim() || !allRefsFilledIn || !canCreateTicket) return;
    setLoading(true);
    getSocket().emit('ticket:new', {
      dept,
      agentLang: user.lang,
      references: references.filter((r) => r.value.trim() !== ''),
      text: text.trim(),
    });
  }

  if (!user) return null;

  // Loading / waiting state
  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 border-4 border-black dark:border-white border-t-transparent animate-spin" />
          <p className="text-sm opacity-60 mt-1 font-black uppercase tracking-widest">{t('waiting_for_support')}</p>

          {queuePosition && (
            <div className="border-2 border-black dark:border-white px-6 py-4 text-center mt-4">
              <p className="text-[10px] font-black uppercase tracking-widest opacity-60">{t('queue_position')}</p>
              <p className="text-4xl font-black mt-1">{queuePosition.position}</p>
              {queuePosition.etaMins > 0 && (
                <p className="text-xs mt-2 opacity-60">
                  {t('estimated_wait')}: ~{queuePosition.etaMins} min
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // No departments configured
  if (manifest.departments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-sm opacity-40 font-black uppercase tracking-widest">{t('no_departments')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg border-2 border-black dark:border-white p-8">
        <h2 className="text-2xl font-black uppercase tracking-tight mb-2">
          {t('hello')}, {user.name}
        </h2>
        <p className="text-sm opacity-60 mb-8">{t('choose_dept_desc')}</p>

        <form onSubmit={handleSubmit} aria-label={t('new_ticket')} className="space-y-6">
          {/* Department grid */}
          <div className="grid grid-cols-2 gap-3">
            {manifest.departments.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDept(d.id)}
                className={`py-3 px-4 border-2 font-black text-sm uppercase tracking-widest ${
                  dept === d.id
                    ? 'border-black dark:border-white bg-black dark:bg-white text-white dark:text-black'
                    : 'border-black/30 dark:border-white/30 hover:border-black dark:hover:border-white'
                }`}
              >
                {d.name}
              </button>
            ))}
          </div>

          {/* Department welcome message */}
          {selectedDept?.welcomeMessage && (
            <div className="border-l-4 border-black dark:border-white pl-4 py-2 text-sm opacity-80">
              {selectedDept.welcomeMessage}
            </div>
          )}

          {/* Reference fields */}
          {refFields.length > 0 && (
            <div className="space-y-4">
              <div className={`grid gap-4 ${refFields.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {refFields.map((field, idx) => (
                  <div key={`${field.label}-${idx}`} className="space-y-1.5">
                    <label className="text-[10px] uppercase font-black tracking-widest opacity-60">
                      {field.label} *
                    </label>
                    <input
                      type="text"
                      value={references.find((r) => r.label === field.label)?.value || ''}
                      onChange={(e) => updateReference(field.label, e.target.value)}
                      required
                      className="w-full border-2 border-black dark:border-white px-4 py-2.5 text-sm bg-transparent outline-none"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Problem description */}
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-black tracking-widest opacity-60">
              {t('question_problem')}
            </label>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('describe_problem')}
              required
              className="w-full border-2 border-black dark:border-white px-4 py-3 text-sm bg-transparent outline-none resize-none"
            />
          </div>

          <button
            type="submit"
            disabled={!text.trim() || !allRefsFilledIn || !canCreateTicket}
            className="w-full border-2 border-black dark:border-white bg-black dark:bg-white text-white dark:text-black py-4 font-black uppercase tracking-widest text-sm disabled:opacity-30"
          >
            {t('connect_with_support')}
          </button>
        </form>
      </div>
    </div>
  );
}
