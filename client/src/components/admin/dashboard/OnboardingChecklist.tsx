/**
 * Dashboard onboarding mode — 4-step setup checklist.
 *
 * Replaces the dashboard for brand-new partners (zero closed tickets, zero
 * non-admin staff). Auto-hides when the server flips `isNewPartner=false` —
 * the gate is in `DashboardView`. Each step is a real `<a>` so middle-click
 * works and screen readers announce a link.
 */

export type OnboardingStepId = 'departments' | 'team' | 'businessHours' | 'sla';

export interface OnboardingChecklistData {
  isNewPartner: boolean;
  steps: { id: OnboardingStepId; label: string; done: boolean }[];
}

export interface OnboardingChecklistProps {
  data: OnboardingChecklistData;
}

const STEP_HREF: Record<OnboardingStepId, string> = {
  departments: '/admin/departments',
  team: '/admin/team',
  businessHours: '/admin/business_hours',
  sla: '/admin/departments',
};

const ROW =
  'flex items-center gap-3 px-4 py-3 rounded-[var(--radius-card)] bg-[var(--color-bg-elevated)] hover:bg-[var(--color-hover)] transition-colors no-underline';
const CHECK_DONE = 'inline-flex items-center justify-center w-6 h-6 rounded-full bg-[var(--color-ok,green)] text-white text-[12px]';
const CHECK_PENDING = 'inline-flex items-center justify-center w-6 h-6 rounded-full border border-[var(--color-border)] text-[var(--color-ink-muted)] text-[12px]';

export function OnboardingChecklist({ data }: OnboardingChecklistProps) {
  const doneCount = data.steps.filter((s) => s.done).length;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[16px] font-semibold text-[var(--color-ink)]">
          Welcome — let's get you set up
        </h2>
        <span data-testid="onboarding-progress" className="text-[12px] text-[var(--color-ink-muted)]">
          {doneCount} of {data.steps.length} complete
        </span>
      </div>
      <ol className="flex flex-col gap-2">
        {data.steps.map((step, index) => (
          <li
            key={step.id}
            data-testid={`onboarding-step-${step.id}`}
            data-step-id={step.id}
            data-done={step.done ? 'true' : 'false'}
          >
            <a href={STEP_HREF[step.id]} className={ROW}>
              <span className={step.done ? CHECK_DONE : CHECK_PENDING}>
                {step.done ? '✓' : index + 1}
              </span>
              <span className="text-[13px] text-[var(--color-ink)]">{step.label}</span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default OnboardingChecklist;
