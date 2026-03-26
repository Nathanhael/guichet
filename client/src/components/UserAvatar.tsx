
interface UserAvatarProps {
  userId: string;
  name: string;
  avatarUrl?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showStatus?: boolean;
  isOnline?: boolean;
  ringColor?: string;
}

export default function UserAvatar({ name, avatarUrl, size = 'md', showStatus = false, isOnline = true }: UserAvatarProps) {
  const sizeClasses = {
    xs: 'w-6 h-6 text-[8px]',
    sm: 'w-8 h-8 text-[10px]',
    md: 'w-10 h-10 text-xs',
    lg: 'w-14 h-14 text-xl',
  };

  const initials = name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className={`relative shrink-0 border border-border bg-bg-elevated flex items-center justify-center font-bold ${sizeClasses[size]}`}>
      {avatarUrl ? (
        <img src={avatarUrl} alt={name} className="w-full h-full object-cover" />
      ) : (
        <span className="text-text-primary uppercase">{initials}</span>
      )}

      {showStatus && (
        <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 border-2 border-bg-surface ${
            isOnline ? 'bg-accent-green' : 'bg-text-muted'
          }`}
        />
      )}
    </div>
  );
}
