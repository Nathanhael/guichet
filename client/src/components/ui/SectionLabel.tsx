import { HTMLAttributes, ReactNode } from 'react';

export interface SectionLabelProps extends HTMLAttributes<HTMLSpanElement> {
  /** Optional trailing accessory — a count chip, icon, etc. */
  accessory?: ReactNode;
  /** Render as <h2> / <h3> for document outline; default is an inline <span>. */
  as?: 'span' | 'h2' | 'h3' | 'h4';
  children?: ReactNode;
}

const base =
  'font-sans text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-ink-muted)]';

export default function SectionLabel({
  accessory,
  as = 'span',
  className = '',
  children,
  ...rest
}: SectionLabelProps) {
  const Wrap = as;
  return (
    <Wrap
      className={`inline-flex items-center gap-2 ${base} ${className}`.trim()}
      {...rest}
    >
      <span>{children}</span>
      {accessory}
    </Wrap>
  );
}
