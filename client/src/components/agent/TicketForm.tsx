import { useEffect, useState, useMemo } from 'react';
import { Send } from 'lucide-react';
import { useT } from '../../i18n';
import useStore from '../../store/useStore';
import { getSocket } from '../../hooks/useSocket';
import { PartnerManifest } from '../../types';
import { useBusinessHours } from '../../hooks/useBusinessHours';
import Button from '../ui/Button';

interface TicketFormProps {
  manifest: PartnerManifest;
}

const FIELD_LABEL = 'block text-[12px] font-medium text-[var(--color-ink-soft)] mb-1.5';
const INPUT =
  'w-full h-9 px-3 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)]';
const TEXTAREA =
  'w-full px-3 py-2 rounded-[var(--radius-btn)] bg-[var(--color-bg-elevated)] text-[13px] text-[var(--color-ink)] border border-transparent focus:border-[var(--color-accent)] focus:outline-none placeholder:text-[var(--color-ink-muted)] resize-none';

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
  const allRefsFilledIn = refFields.length === 0 || references.every((r, i) => refFields[i]?.optional || r.value.trim() !== '');

  useEffect(() => {
    const fields = selectedDept?.referenceFields || [];
    setReferences(fields.map((f) => ({ label: f.label, value: '' })));
  }, [selectedDept]);

  useEffect(() => {
    const hasSelectedDept = manifest.departments.some((d) => d.id === dept);
    if (!hasSelectedDept) {
      setDept(manifest.departments[0]?.id || '');
    }
  }, [manifest.departments, dept]);

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

  function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
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

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="flex flex-col items-center gap-5">
          <div className="h-10 w-10 rounded-full border-2 border-[var(--color-border)] border-t-[var(--color-accent)] animate-spin" />
          <p className="text-[13px] text-[var(--color-ink-soft)]">{t('waiting_for_support')}</p>

          {queuePosition && (
            <div className="rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] px-6 py-5 text-center">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-ink-muted)]">{t('queue_position')}</p>
              <p className="text-[32px] font-semibold tracking-[-0.5px] text-[var(--color-ink)] mt-1">{queuePosition.position}</p>
              {queuePosition.etaMins > 0 && (
                <p className="text-[12px] text-[var(--color-ink-muted)] mt-2">
                  {t('estimated_wait')}: ~{queuePosition.etaMins} min
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  if (manifest.departments.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <p className="text-[13px] text-[var(--color-ink-muted)]">{t('no_departments')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-[var(--radius-card)] bg-[var(--color-bg-surface)] border border-[var(--color-border)] shadow-[var(--shadow-card)] p-7">
        <h2 className="text-[22px] font-semibold tracking-[-0.2px] text-[var(--color-ink)]">
          {t('hello')}, {user.name}
        </h2>
        <p className="text-[13px] text-[var(--color-ink-muted)] mt-1 mb-6">{t('choose_dept_desc')}</p>

        <form onSubmit={handleSubmit} aria-label={t('new_ticket')} className="space-y-5">
          <div className="grid grid-cols-2 gap-2">
            {manifest.departments.map((d) => {
              const active = dept === d.id;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDept(d.id)}
                  aria-pressed={active}
                  className={`py-2.5 px-3 rounded-[var(--radius-btn)] text-[13px] font-medium transition-colors ${
                    active
                      ? 'bg-[var(--color-accent)] text-white shadow-[var(--shadow-soft)]'
                      : 'bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)] hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]'
                  }`}
                >
                  {d.name}
                </button>
              );
            })}
          </div>

          {selectedDept?.welcomeMessage && (
            <div className="rounded-[var(--radius-btn)] bg-[var(--color-accent-soft)] border-l-2 border-[var(--color-accent)] px-4 py-3 text-[13px] text-[var(--color-ink-soft)]">
              {selectedDept.welcomeMessage}
            </div>
          )}

          {refFields.length > 0 && (
            <div className={`grid gap-3 ${refFields.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
              {refFields.map((field, idx) => (
                <div key={`${field.label}-${idx}`}>
                  <label className={FIELD_LABEL}>
                    {field.label}{' '}
                    {field.optional ? (
                      <span className="text-[11px] font-normal text-[var(--color-ink-muted)]">({t('optional')})</span>
                    ) : (
                      <span className="text-[var(--color-urgent)]">*</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={references.find((r) => r.label === field.label)?.value || ''}
                    onChange={(e) => updateReference(field.label, e.target.value)}
                    required={!field.optional}
                    className={INPUT}
                  />
                </div>
              ))}
            </div>
          )}

          <div>
            <label className={FIELD_LABEL}>{t('question_problem')}</label>
            <textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('describe_problem')}
              required
              className={TEXTAREA}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            leading={<Send className="h-3.5 w-3.5" />}
            disabled={!text.trim() || !allRefsFilledIn || !canCreateTicket}
            className="w-full h-10"
          >
            {t('connect_with_support')}
          </Button>
        </form>
      </div>
    </div>
  );
}
