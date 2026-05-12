import { HTMLAttributes, useEffect, useState } from 'react';

type Shape = 'round' | 'squircle';

export interface AvatarProps extends Omit<HTMLAttributes<HTMLDivElement>, 'color'> {
  name: string;
  /** Optional image source. When present, replaces the initials. */
  src?: string | null;
  /** Diameter in px. Spec sizes: 44 (context), 40 (chat), 32 (row/message), 30 (navbar), 26 (assignment). */
  size?: number;
  shape?: Shape;
  /** Explicit background color override. Defaults to a hash of the name. */
  color?: string;
  /** Show an online/away dot in the bottom-right corner. */
  statusDot?: 'online' | 'away' | 'offline' | null;
  /** Alt text for the image; defaults to name. */
  alt?: string;
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Deterministic color hash. Spins over Guichet's accent family so avatars
// stay in-palette even when the partner brand changes.
const PALETTE = [
  '#5b5bd6', // indigo
  '#0ea5b7', // teal
  '#8b5cf6', // violet
  '#f59e0b', // amber
  '#ec4899', // rose
  '#10b981', // emerald
  '#6366f1', // indigo-600
  '#ef4444', // red
];

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const idx = Math.abs(h) % PALETTE.length;
  return PALETTE[idx];
}

const STATUS_DOT_COLOR: Record<NonNullable<AvatarProps['statusDot']>, string> = {
  online: 'var(--color-ok)',
  away: '#f59e0b',
  offline: 'var(--color-ink-muted)',
};

export default function Avatar({
  name,
  src,
  size = 32,
  shape = 'round',
  color,
  statusDot,
  alt,
  className = '',
  style,
  ...rest
}: AvatarProps) {
  // Avatar URLs come from users.avatar_url (SSO photo sync). When the file is
  // missing (user re-onboarded, storage gap, stale cache) the <img> renders a
  // broken-image icon permanently. Track error and fall back to initials.
  const [imgError, setImgError] = useState(false);
  useEffect(() => { setImgError(false); }, [src]);
  const showImg = !!src && !imgError;
  const usesHashedBg = !color && !showImg;
  const bg = color ?? hashColor(name);
  const radius = shape === 'round' ? 999 : 8;
  const font = Math.max(10, Math.round(size * 0.4));
  const dotSize = Math.max(8, Math.round(size * 0.28));

  return (
    <div
      aria-label={alt ?? name}
      className={`relative inline-flex items-center justify-center overflow-visible text-white font-semibold shrink-0 select-none ${usesHashedBg ? 'avatar-swatch' : ''} ${className}`.trim()}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: showImg ? undefined : bg,
        fontSize: font,
        ...style,
      }}
      {...rest}
    >
      {showImg ? (
        <img
          src={src!}
          alt={alt ?? name}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          onError={() => setImgError(true)}
          style={{ width: size, height: size, borderRadius: radius, objectFit: 'cover' }}
        />
      ) : (
        <span style={{ letterSpacing: 0.2 }}>{initialsOf(name)}</span>
      )}
      {statusDot ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: -2,
            bottom: -2,
            width: dotSize,
            height: dotSize,
            borderRadius: 999,
            background: STATUS_DOT_COLOR[statusDot],
            boxShadow: '0 0 0 2px var(--color-bg-surface)',
          }}
        />
      ) : null}
    </div>
  );
}
