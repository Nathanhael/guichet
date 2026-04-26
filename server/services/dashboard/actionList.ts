/**
 * Dashboard Z1 — Action list deep service.
 *
 * Pure transform: takes raw rows already fetched at the query layer (one
 * fetch per category, partner-scoped at the DB) and folds them into the
 * 4-bucket shape consumed by the dashboard:
 *
 *   slaBreaches · abandoned · untreatedFeedback · pendingInvites
 *
 * The tRPC router is the seam where DB queries are wired in — this module
 * stays DB-agnostic so it remains fixture-testable.
 *
 * Defense-in-depth: every row's `partnerId` is verified against the input
 * `partnerId`. The DB layer should already filter, but a stray row from a
 * cross-partner JOIN must not leak into a dashboard payload.
 *
 * Window semantics: `from` inclusive, `to` inclusive. Out-of-window rows
 * are dropped (covers the "last N days" filter from the dashboard FilterBar).
 */

export interface DateWindow {
  from: Date;
  to: Date;
}

export interface RawBreachRow {
  id: string;
  partnerId: string;
  ticketId: string;
  ticketTitle: string;
  breachedAt: Date;
}

export interface RawAbandonedRow {
  id: string;
  partnerId: string;
  title: string;
  abandonedAt: Date;
}

export interface RawFeedbackRow {
  id: string;
  partnerId: string;
  type: string;
  body: string;
  submittedAt: Date;
  treated: boolean;
}

export interface RawInviteRow {
  id: string;
  partnerId: string;
  email: string;
  role: string;
  expiresAt: Date;
  claimedAt: Date | null;
}

export interface ActionListInput {
  partnerId: string;
  window: DateWindow;
  breaches: RawBreachRow[];
  abandoned: RawAbandonedRow[];
  feedback: RawFeedbackRow[];
  invites: RawInviteRow[];
  /** Defaults to `Date.now()` — pass-through for deterministic tests. */
  now?: Date;
}

export interface SlaBreachItem {
  kind: 'sla_breach';
  id: string;
  ticketId: string;
  ticketTitle: string;
  breachedAt: Date;
  linkTarget: string;
}

export interface AbandonedItem {
  kind: 'abandoned';
  id: string;
  ticketId: string;
  ticketTitle: string;
  abandonedAt: Date;
  linkTarget: string;
}

export interface FeedbackItem {
  kind: 'feedback_untreated';
  id: string;
  feedbackType: string;
  preview: string;
  submittedAt: Date;
  linkTarget: string;
}

export interface PendingInviteItem {
  kind: 'pending_invite';
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  linkTarget: string;
}

export interface ActionList {
  slaBreaches: SlaBreachItem[];
  abandoned: AbandonedItem[];
  untreatedFeedback: FeedbackItem[];
  pendingInvites: PendingInviteItem[];
}

const PREVIEW_LEN = 80;

function inWindow(t: Date, w: DateWindow): boolean {
  return t.getTime() >= w.from.getTime() && t.getTime() <= w.to.getTime();
}

function byNewestFirst<T>(getDate: (item: T) => Date) {
  return (a: T, b: T) => getDate(b).getTime() - getDate(a).getTime();
}

export function buildActionList(input: ActionListInput): ActionList {
  const { partnerId, window, breaches, abandoned, feedback, invites } = input;
  const now = input.now ?? new Date();

  const slaBreaches: SlaBreachItem[] = breaches
    .filter((r) => r.partnerId === partnerId && inWindow(r.breachedAt, window))
    .map((r): SlaBreachItem => ({
      kind: 'sla_breach',
      id: r.id,
      ticketId: r.ticketId,
      ticketTitle: r.ticketTitle,
      breachedAt: r.breachedAt,
      linkTarget: `/admin/tickets/${r.ticketId}`,
    }))
    .sort(byNewestFirst((i) => i.breachedAt));

  const abandonedItems: AbandonedItem[] = abandoned
    .filter((r) => r.partnerId === partnerId && inWindow(r.abandonedAt, window))
    .map((r): AbandonedItem => ({
      kind: 'abandoned',
      id: r.id,
      ticketId: r.id,
      ticketTitle: r.title,
      abandonedAt: r.abandonedAt,
      linkTarget: `/admin/tickets/${r.id}`,
    }))
    .sort(byNewestFirst((i) => i.abandonedAt));

  const untreatedFeedback: FeedbackItem[] = feedback
    .filter(
      (r) =>
        r.partnerId === partnerId &&
        r.treated === false &&
        inWindow(r.submittedAt, window),
    )
    .map((r): FeedbackItem => ({
      kind: 'feedback_untreated',
      id: r.id,
      feedbackType: r.type,
      preview: r.body.length > PREVIEW_LEN ? `${r.body.slice(0, PREVIEW_LEN)}…` : r.body,
      submittedAt: r.submittedAt,
      linkTarget: `/admin/feedback?focus=${r.id}`,
    }))
    .sort(byNewestFirst((i) => i.submittedAt));

  const pendingInvites: PendingInviteItem[] = invites
    .filter(
      (r) =>
        r.partnerId === partnerId &&
        r.claimedAt === null &&
        r.expiresAt.getTime() > now.getTime(),
    )
    .map((r): PendingInviteItem => ({
      kind: 'pending_invite',
      id: r.id,
      email: r.email,
      role: r.role,
      expiresAt: r.expiresAt,
      linkTarget: `/admin/team?tab=invites&focus=${r.id}`,
    }))
    .sort(byNewestFirst((i) => i.expiresAt));

  return { slaBreaches, abandoned: abandonedItems, untreatedFeedback, pendingInvites };
}
