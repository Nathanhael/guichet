import { HTMLAttributes, forwardRef, ReactNode } from 'react';

type Padding = 'none' | 'sm' | 'md' | 'lg';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Panel tone. `surface` is the default; `bg` uses the canvas color (for nested shells). */
  tone?: 'surface' | 'bg';
  /** Drop the card shadow (useful for nested / outlined cards). */
  flat?: boolean;
  /** Internal padding preset. `none` leaves padding to the caller. */
  padding?: Padding;
  /** Remove the 1px border. Shadow alone is enough on dark surfaces. */
  borderless?: boolean;
  children?: ReactNode;
}

const paddings: Record<Padding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { tone = 'surface', flat = false, padding = 'none', borderless = false, className = '', children, ...rest },
  ref,
) {
  const bg = tone === 'surface' ? 'bg-[var(--color-bg-surface)]' : 'bg-[var(--color-bg-base)]';
  const border = borderless ? '' : 'border border-[var(--color-border)]';
  const shadow = flat ? '' : 'shadow-[var(--shadow-card)]';
  return (
    <div
      ref={ref}
      className={`${bg} ${border} ${shadow} rounded-[var(--radius-card)] ${paddings[padding]} ${className}`.trim()}
      {...rest}
    >
      {children}
    </div>
  );
});

export default Card;
