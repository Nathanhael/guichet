/**
 * Shared error display component for admin views.
 * Replaces duplicated error box markup across AdminKnowledgeBase,
 * AdminCannedResponses, AdminWebhooks, and AdminLabels.
 */
export default function ErrorBox({ error }: { error?: string | null }) {
  if (!error) return null;

  return (
    <div className="border-2 border-rose-500 bg-rose-500/5 px-4 py-3 mb-6">
      <span className="text-xs font-black uppercase tracking-widest text-rose-600 dark:text-rose-400">
        {error}
      </span>
    </div>
  );
}
