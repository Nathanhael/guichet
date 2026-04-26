/**
 * Dashboard Z2 — Scorecard deep service.
 *
 * Pure transform: takes pre-aggregated current + previous period rollups
 * (one row each, computed at the query layer from `daily_stats` + ratings)
 * and returns the 3-card payload consumed by the dashboard:
 *
 *   sla · csat · volume
 *
 * Each card carries `{ value, prevValue, deltaPct, band, tooltip? }` per
 * the PRD wire contract. Phase-1 colors only the SLA card; CSAT and Volume
 * stay neutral until the partner-level CSAT-target field lands.
 *
 * The query layer / tRPC router supplies pre-summed counts so this module
 * stays DB-agnostic and fixture-testable. Mirror of frontend-side rollup
 * shape — keep the two in sync until a shared package exists.
 */

import { slaColor, type SlaBand } from './slaColor.js';

export interface PeriodRollup {
  totalTickets: number;
  ticketsMetSla: number;
  ticketsWithResponse: number;
  ratingSum: number;
  ratingCount: number;
  p95ResponseMinutes: number | null;
}

export interface ScorecardInput {
  current: PeriodRollup;
  previous: PeriodRollup;
  slaConfig: { targetPct: number | null; warnPct: number };
}

export interface ScorecardCard {
  value: number | null;
  prevValue: number | null;
  deltaPct: number | null;
  band: SlaBand;
  tooltip?: string;
}

export interface Scorecard {
  sla: ScorecardCard;
  csat: ScorecardCard;
  volume: ScorecardCard;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function slaPct(r: PeriodRollup): number | null {
  if (r.ticketsWithResponse === 0) return null;
  return round1((r.ticketsMetSla / r.ticketsWithResponse) * 100);
}

function csatAvg(r: PeriodRollup): number | null {
  if (r.ratingCount === 0) return null;
  return round1(r.ratingSum / r.ratingCount);
}

function deltaPct(value: number | null, prev: number | null): number | null {
  if (value === null || prev === null) return null;
  if (prev === 0) return null;
  return round1(((value - prev) / prev) * 100);
}

export function buildScorecard(input: ScorecardInput): Scorecard {
  const { current, previous, slaConfig } = input;

  const slaValue = slaPct(current);
  const slaPrev = slaPct(previous);
  const sla: ScorecardCard = {
    value: slaValue,
    prevValue: slaPrev,
    deltaPct: deltaPct(slaValue, slaPrev),
    band: slaColor(slaValue, slaConfig.targetPct, slaConfig.warnPct),
  };
  if (current.p95ResponseMinutes !== null && current.p95ResponseMinutes !== undefined) {
    sla.tooltip = `p95 response: ${current.p95ResponseMinutes} min`;
  }

  const csatValue = csatAvg(current);
  const csatPrev = csatAvg(previous);
  const csat: ScorecardCard = {
    value: csatValue,
    prevValue: csatPrev,
    deltaPct: deltaPct(csatValue, csatPrev),
    band: 'neutral',
  };

  const volume: ScorecardCard = {
    value: current.totalTickets,
    prevValue: previous.totalTickets,
    deltaPct: deltaPct(current.totalTickets, previous.totalTickets),
    band: 'neutral',
  };

  return { sla, csat, volume };
}
