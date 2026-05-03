import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leading?: ReactNode;
  trailing?: ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-1.5 font-sans font-medium rounded-[var(--radius-btn)] ' +
  'transition-[opacity,background-color,color,box-shadow] duration-150 ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent)] ' +
  'disabled:opacity-40 disabled:cursor-not-allowed';

const variants: Record<Variant, string> = {
  primary:
    'bg-[var(--color-accent)] text-[var(--color-btn-text-inverse)] border border-transparent hover:opacity-90 active:opacity-80',
  secondary:
    'bg-[var(--color-bg-surface)] text-[var(--color-ink)] border border-[var(--color-border-strong)] ' +
    'shadow-[var(--shadow-soft)] hover:bg-[var(--color-hover)]',
  danger:
    'bg-transparent text-[var(--color-urgent)] border border-[var(--color-urgent)] ' +
    'hover:bg-[var(--color-urgent)] hover:text-[var(--color-btn-text-inverse)]',
  ghost:
    'bg-transparent text-[var(--color-ink-soft)] border border-transparent hover:bg-[var(--color-hover)] hover:text-[var(--color-ink)]',
};

const sizes: Record<Size, string> = {
  sm: 'text-[12px] px-2.5 py-1',
  md: 'text-[13px] px-3.5 py-1.5',
};

const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', leading, trailing, className = '', type = 'button', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`.trim()}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </button>
  );
});

export default Button;
