/**
 * Dashboard onboarding mode — pure service.
 *
 * PRD §7: a brand-new partner (zero closed tickets AND zero non-admin
 * staff) sees a 4-step checklist instead of the dashboard. Auto-hides the
 * moment the first ticket lands or the first non-admin teammate is added.
 *
 * The four steps are spec-fixed in order:
 *   Departments -> Team -> Business Hours -> SLA
 *
 * "done" rules per spec/CLAUDE.md:
 *   departments  : partner.departments has >= 1 entry
 *   team         : at least one non-admin membership
 *   businessHours: partner.businessHoursSchedule has a non-empty object
 *   sla          : at least one dept has sla.enabled && firstResponseMinutes > 0
 */

export type OnboardingStepId = 'departments' | 'team' | 'businessHours' | 'sla';

export interface OnboardingDept {
  id: string;
  name?: string;
  sla?: { enabled?: boolean; firstResponseMinutes?: number };
}

export interface OnboardingInput {
  closedTicketCount: number;
  nonAdminStaffCount: number;
  departments: OnboardingDept[];
  businessHoursSchedule: unknown;
}

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  done: boolean;
}

export interface OnboardingState {
  isNewPartner: boolean;
  steps: OnboardingStep[];
}

function isNonEmptyObject(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v !== 'object') return false;
  return Object.keys(v as Record<string, unknown>).length > 0;
}

export function buildOnboardingState(input: OnboardingInput): OnboardingState {
  const isNewPartner =
    input.closedTicketCount === 0 && input.nonAdminStaffCount === 0;

  const departmentsDone = input.departments.length > 0;
  const teamDone = input.nonAdminStaffCount > 0;
  const businessHoursDone = isNonEmptyObject(input.businessHoursSchedule);
  const slaDone = input.departments.some(
    (d) =>
      d.sla?.enabled === true && (d.sla.firstResponseMinutes ?? 0) > 0,
  );

  return {
    isNewPartner,
    steps: [
      { id: 'departments', label: 'Add your departments', done: departmentsDone },
      { id: 'team', label: 'Invite teammates', done: teamDone },
      { id: 'businessHours', label: 'Set business hours', done: businessHoursDone },
      { id: 'sla', label: 'Configure SLA', done: slaDone },
    ],
  };
}
