export default function FieldError({ error }: { error?: string }) {
  if (!error) return null;
  return <p className="text-[9px] font-bold uppercase tracking-widest text-[var(--color-accent-red)] mt-1">{error}</p>;
}
