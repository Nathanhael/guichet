export const LABEL_COLORS = [
  { key: 'blue', bg: 'bg-blue-500', ring: 'ring-blue-500' },
  { key: 'indigo', bg: 'bg-indigo-500', ring: 'ring-indigo-500' },
  { key: 'purple', bg: 'bg-purple-500', ring: 'ring-purple-500' },
  { key: 'emerald', bg: 'bg-emerald-500', ring: 'ring-emerald-500' },
  { key: 'teal', bg: 'bg-teal-500', ring: 'ring-teal-500' },
  { key: 'cyan', bg: 'bg-cyan-500', ring: 'ring-cyan-500' },
  { key: 'sky', bg: 'bg-sky-500', ring: 'ring-sky-500' },
  { key: 'amber', bg: 'bg-amber-500', ring: 'ring-amber-500' },
  { key: 'orange', bg: 'bg-orange-500', ring: 'ring-orange-500' },
  { key: 'rose', bg: 'bg-rose-500', ring: 'ring-rose-500' },
  { key: 'pink', bg: 'bg-pink-500', ring: 'ring-pink-500' },
  { key: 'slate', bg: 'bg-slate-500', ring: 'ring-slate-500' },
] as const;

export type LabelColorKey = (typeof LABEL_COLORS)[number]['key'];

/** Map color key to full Tailwind bg class (avoids dynamic class purge) */
export const COLOR_BG_MAP: Record<string, string> = Object.fromEntries(
  LABEL_COLORS.map((c) => [c.key, c.bg]),
);
