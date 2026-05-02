import { describe, it, expect } from 'vitest';
import {
  buildActionList,
  type ActionListInput,
  type RawBreachRow,
  type RawAbandonedRow,
  type RawFeedbackRow,
  type RawInviteRow,
} from './actionList';

const PARTNER = 'p-1';
const OTHER_PARTNER = 'p-2';
const NOW = new Date('2026-04-25T10:00:00Z');
const WINDOW_FROM = new Date('2026-04-18T00:00:00Z');

function baseInput(overrides: Partial<ActionListInput> = {}): ActionListInput {
  return {
    partnerId: PARTNER,
    // Anchor `now` so invite-expiry filtering is deterministic — without
    // this, buildActionList falls back to real `Date.now()` and the test's
    // hardcoded `i-fresh` expiresAt drifts into the past as wallclock
    // advances. The `now` opt is documented on ActionListInput precisely
    // for this case.
    now: NOW,
    window: { from: WINDOW_FROM, to: NOW },
    breaches: [],
    abandoned: [],
    feedback: [],
    invites: [],
    ...overrides,
  };
}

const breach = (over: Partial<RawBreachRow> = {}): RawBreachRow => ({
  id: 'b-1',
  partnerId: PARTNER,
  ticketId: 't-1',
  ticketTitle: 'Login broken',
  breachedAt: new Date('2026-04-24T09:00:00Z'),
  ...over,
});

const abandoned = (over: Partial<RawAbandonedRow> = {}): RawAbandonedRow => ({
  id: 't-7',
  partnerId: PARTNER,
  title: 'Customer left chat',
  abandonedAt: new Date('2026-04-23T12:00:00Z'),
  ...over,
});

const feedback = (over: Partial<RawFeedbackRow> = {}): RawFeedbackRow => ({
  id: 'f-1',
  partnerId: PARTNER,
  type: 'bug',
  body: 'Cannot upload attachment',
  submittedAt: new Date('2026-04-22T09:00:00Z'),
  treated: false,
  ...over,
});

const invite = (over: Partial<RawInviteRow> = {}): RawInviteRow => ({
  id: 'i-1',
  partnerId: PARTNER,
  email: 'new@partner.com',
  role: 'support',
  expiresAt: new Date('2026-05-22T09:00:00Z'),
  claimedAt: null,
  ...over,
});

describe('buildActionList', () => {
  it('returns four empty arrays when no rows are supplied', () => {
    const out = buildActionList(baseInput());
    expect(out).toEqual({
      slaBreaches: [],
      abandoned: [],
      untreatedFeedback: [],
      pendingInvites: [],
    });
  });

  it('shapes a breach row with the correct kind, link target, and metadata', () => {
    const out = buildActionList(baseInput({ breaches: [breach()] }));
    expect(out.slaBreaches).toHaveLength(1);
    expect(out.slaBreaches[0]).toMatchObject({
      kind: 'sla_breach',
      id: 'b-1',
      ticketId: 't-1',
      ticketTitle: 'Login broken',
      linkTarget: '/admin/tickets/t-1',
    });
    expect(out.slaBreaches[0].breachedAt.toISOString()).toBe(
      '2026-04-24T09:00:00.000Z',
    );
  });

  it('shapes an abandoned ticket row with linkTarget to the ticket', () => {
    const out = buildActionList(baseInput({ abandoned: [abandoned()] }));
    expect(out.abandoned[0]).toMatchObject({
      kind: 'abandoned',
      id: 't-7',
      ticketId: 't-7',
      ticketTitle: 'Customer left chat',
      linkTarget: '/admin/tickets/t-7',
    });
  });

  it('shapes feedback with linkTarget to the AdminFeedback tab focused on the item', () => {
    const out = buildActionList(baseInput({ feedback: [feedback()] }));
    expect(out.untreatedFeedback[0]).toMatchObject({
      kind: 'feedback_untreated',
      id: 'f-1',
      feedbackType: 'bug',
      linkTarget: '/admin/feedback?focus=f-1',
    });
  });

  it('shapes a pending invite with linkTarget to the AdminTeam Pending Invites tab', () => {
    const out = buildActionList(baseInput({ invites: [invite()] }));
    expect(out.pendingInvites[0]).toMatchObject({
      kind: 'pending_invite',
      id: 'i-1',
      email: 'new@partner.com',
      role: 'support',
      linkTarget: '/admin/team?tab=invites&focus=i-1',
    });
  });

  it('drops feedback rows where treated=true', () => {
    const out = buildActionList(
      baseInput({
        feedback: [
          feedback({ id: 'f-1', treated: false }),
          feedback({ id: 'f-2', treated: true }),
        ],
      }),
    );
    expect(out.untreatedFeedback.map((r) => r.id)).toEqual(['f-1']);
  });

  it('drops invites that are already claimed', () => {
    const out = buildActionList(
      baseInput({
        invites: [
          invite({ id: 'i-1', claimedAt: null }),
          invite({ id: 'i-2', claimedAt: new Date('2026-04-23T08:00:00Z') }),
        ],
      }),
    );
    expect(out.pendingInvites.map((r) => r.id)).toEqual(['i-1']);
  });

  it('drops invites whose expiresAt is before now', () => {
    const out = buildActionList(
      baseInput({
        invites: [
          invite({ id: 'i-fresh', expiresAt: new Date('2026-05-01T00:00:00Z') }),
          invite({ id: 'i-stale', expiresAt: new Date('2026-04-20T00:00:00Z') }),
        ],
      }),
    );
    expect(out.pendingInvites.map((r) => r.id)).toEqual(['i-fresh']);
  });

  it('drops breaches whose breachedAt is outside the window', () => {
    const out = buildActionList(
      baseInput({
        breaches: [
          breach({ id: 'b-in', breachedAt: new Date('2026-04-24T09:00:00Z') }),
          breach({ id: 'b-old', breachedAt: new Date('2026-04-10T00:00:00Z') }),
          breach({ id: 'b-future', breachedAt: new Date('2026-04-26T09:00:00Z') }),
        ],
      }),
    );
    expect(out.slaBreaches.map((r) => r.id)).toEqual(['b-in']);
  });

  it('drops abandoned rows outside the window', () => {
    const out = buildActionList(
      baseInput({
        abandoned: [
          abandoned({ id: 't-in', abandonedAt: new Date('2026-04-23T12:00:00Z') }),
          abandoned({ id: 't-old', abandonedAt: new Date('2026-04-01T00:00:00Z') }),
        ],
      }),
    );
    expect(out.abandoned.map((r) => r.id)).toEqual(['t-in']);
  });

  it('ignores rows with a mismatched partnerId (defense in depth)', () => {
    const out = buildActionList(
      baseInput({
        breaches: [
          breach({ id: 'b-mine', partnerId: PARTNER }),
          breach({ id: 'b-other', partnerId: OTHER_PARTNER }),
        ],
        abandoned: [
          abandoned({ id: 't-mine', partnerId: PARTNER }),
          abandoned({ id: 't-other', partnerId: OTHER_PARTNER }),
        ],
        feedback: [
          feedback({ id: 'f-mine', partnerId: PARTNER }),
          feedback({ id: 'f-other', partnerId: OTHER_PARTNER }),
        ],
        invites: [
          invite({ id: 'i-mine', partnerId: PARTNER }),
          invite({ id: 'i-other', partnerId: OTHER_PARTNER }),
        ],
      }),
    );
    expect(out.slaBreaches.map((r) => r.id)).toEqual(['b-mine']);
    expect(out.abandoned.map((r) => r.id)).toEqual(['t-mine']);
    expect(out.untreatedFeedback.map((r) => r.id)).toEqual(['f-mine']);
    expect(out.pendingInvites.map((r) => r.id)).toEqual(['i-mine']);
  });

  it('sorts each list most-recent first', () => {
    const out = buildActionList(
      baseInput({
        breaches: [
          breach({ id: 'b-old', breachedAt: new Date('2026-04-19T00:00:00Z') }),
          breach({ id: 'b-new', breachedAt: new Date('2026-04-24T09:00:00Z') }),
          breach({ id: 'b-mid', breachedAt: new Date('2026-04-22T00:00:00Z') }),
        ],
      }),
    );
    expect(out.slaBreaches.map((r) => r.id)).toEqual(['b-new', 'b-mid', 'b-old']);
  });
});
