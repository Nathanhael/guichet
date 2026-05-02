import { describe, it, expect } from 'vitest';
import {
  buildOnboardingState,
  type OnboardingInput,
} from './onboarding';

function input(over: Partial<OnboardingInput> = {}): OnboardingInput {
  return {
    closedTicketCount: 0,
    nonAdminStaffCount: 0,
    departments: [],
    businessHoursSchedule: null,
    ...over,
  };
}

describe('buildOnboardingState', () => {
  it('flags isNewPartner=true when there are zero closed tickets and zero non-admin staff', () => {
    const out = buildOnboardingState(input());
    expect(out.isNewPartner).toBe(true);
  });

  it('flags isNewPartner=false as soon as one closed ticket exists (auto-hide trigger)', () => {
    const out = buildOnboardingState(input({ closedTicketCount: 1 }));
    expect(out.isNewPartner).toBe(false);
  });

  it('flags isNewPartner=false when at least one non-admin staff member exists', () => {
    const out = buildOnboardingState(input({ nonAdminStaffCount: 1 }));
    expect(out.isNewPartner).toBe(false);
  });

  it('returns the four canonical steps in the spec-defined order', () => {
    const out = buildOnboardingState(input());
    expect(out.steps.map((s) => s.id)).toEqual([
      'departments',
      'team',
      'businessHours',
      'sla',
    ]);
  });

  it('marks the departments step done when at least one dept is configured', () => {
    const out = buildOnboardingState(
      input({ departments: [{ id: 'sales', name: 'Sales' }] }),
    );
    const step = out.steps.find((s) => s.id === 'departments')!;
    expect(step.done).toBe(true);
  });

  it('marks the team step done when nonAdminStaffCount > 0', () => {
    const out = buildOnboardingState(input({ nonAdminStaffCount: 2 }));
    expect(out.steps.find((s) => s.id === 'team')!.done).toBe(true);
  });

  it('marks the business-hours step done when a schedule object is set', () => {
    const out = buildOnboardingState(
      input({ businessHoursSchedule: { timezone: 'Europe/Brussels' } }),
    );
    expect(out.steps.find((s) => s.id === 'businessHours')!.done).toBe(true);
  });

  it('marks the SLA step done when at least one dept has SLA enabled with a positive threshold', () => {
    const out = buildOnboardingState(
      input({
        departments: [
          {
            id: 'sales',
            name: 'Sales',
            sla: { enabled: true, firstResponseMinutes: 30 },
          },
        ],
      }),
    );
    expect(out.steps.find((s) => s.id === 'sla')!.done).toBe(true);
  });

  it('SLA step stays not-done when the dept has SLA disabled', () => {
    const out = buildOnboardingState(
      input({
        departments: [
          {
            id: 'sales',
            name: 'Sales',
            sla: { enabled: false, firstResponseMinutes: 30 },
          },
        ],
      }),
    );
    expect(out.steps.find((s) => s.id === 'sla')!.done).toBe(false);
  });

  it('SLA step stays not-done when the dept has zero firstResponseMinutes', () => {
    const out = buildOnboardingState(
      input({
        departments: [
          {
            id: 'sales',
            name: 'Sales',
            sla: { enabled: true, firstResponseMinutes: 0 },
          },
        ],
      }),
    );
    expect(out.steps.find((s) => s.id === 'sla')!.done).toBe(false);
  });

  it('an empty businessHoursSchedule object does not count as configured', () => {
    const out = buildOnboardingState(input({ businessHoursSchedule: {} }));
    expect(out.steps.find((s) => s.id === 'businessHours')!.done).toBe(false);
  });
});
