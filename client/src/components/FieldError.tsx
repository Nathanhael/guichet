export default function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-[11px] text-[var(--color-urgent)] mt-1">{error}</p>;
}
