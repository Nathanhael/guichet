/**
 * Shared error display component for admin views.
 */
export default function ErrorBox({ error }: { error?: string | null }) {
  if (!error) return null;

  return (
    <div className="rounded-[var(--radius-card)] bg-[var(--color-urgent-soft)] px-4 py-3 mb-6 flex items-start gap-2.5">
      <span className="mt-0.5 inline-block w-1.5 h-1.5 rounded-full bg-[var(--color-urgent)] shrink-0" />
      <span className="text-[13px] font-medium text-[var(--color-urgent)]">
        {error}
      </span>
    </div>
  );
}
