import { useT } from '../../i18n';

interface DeliveryStatusProps {
  deliveredAt?: string | null;
  readAt?: string | null;
}

export default function DeliveryStatus({ deliveredAt, readAt }: DeliveryStatusProps) {
  const t = useT();
  const isRead = !!readAt;
  const isDelivered = !!deliveredAt;
  const label = isRead ? (t('status_read')) : isDelivered ? (t('status_delivered')) : (t('status_sent'));
  const color = isRead ? 'var(--color-accent)' : 'var(--color-ink-muted)';
  const showDouble = isDelivered || isRead;

  return (
    <span title={label} aria-label={label} className="inline-flex items-center ml-1">
      <svg
        width={showDouble ? 18 : 12}
        height={14}
        viewBox={showDouble ? '0 0 18 14' : '0 0 12 14'}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <polyline
          points="1,7 4,11 10,3"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        {showDouble && (
          <polyline
            points="5,7 8,11 14,3"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
      </svg>
    </span>
  );
}
