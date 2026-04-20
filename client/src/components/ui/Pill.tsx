import { HTMLAttributes, ReactNode, MouseEvent } from 'react';
import { X } from 'lucide-react';

type Tone = 'accent' | 'urgent' | 'ok' | 'muted' | 'whisper' | 'neutral';

export interface PillProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'onRemove'> {
  tone?: Tone;
  /** Show dismiss X button; caller handles the mutation. */
  onRemove?: (e: MouseEvent<HTMLButtonElement>) => void;
  removeLabel?: string;
  leading?: ReactNode;
  children?: ReactNode;
}

const tones: Record<Tone, string> = {
  accent: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  urgent: 'bg-[var(--color-urgent-soft)] text-[var(--color-urgent)]',
  ok: 'bg-[var(--color-ok-soft)] text-[var(--color-ok)]',
  whisper: 'bg-[var(--color-whisper-bg)] text-[var(--color-whisper-ink)]',
  muted: 'bg-[var(--color-bg-elevated)] text-[var(--color-ink-muted)]',
  neutral: 'bg-[var(--color-bg-elevated)] text-[var(--color-ink-soft)]',
};

export default function Pill({
  tone = 'neutral',
  onRemove,
  removeLabel = 'Remove',
  leading,
  children,
  className = '',
  ...rest
}: PillProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-2 py-0.5 text-[11px] font-semibold leading-none ${tones[tone]} ${className}`.trim()}
      {...rest}
    >
      {leading}
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={removeLabel}
          className="ml-0.5 -mr-0.5 inline-flex items-center justify-center rounded-full opacity-60 hover:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-current"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
