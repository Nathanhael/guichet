import { describe, it, expect } from 'vitest';
import {
  buildScorecard,
  type PeriodRollup,
  type ScorecardInput,
} from './scorecard';

const EMPTY: PeriodRollup = {
  totalTickets: 0,
  ticketsMetSla: 0,
  ticketsWithResponse: 0,
  ratingSum: 0,
  ratingCount: 0,
  p95ResponseMinutes: null,
};

function input(overrides: Partial<ScorecardInput> = {}): ScorecardInput {
  return {
    current: { ...EMPTY },
    previous: { ...EMPTY },
    slaConfig: { targetPct: 95, warnPct: 5 },
    ...overrides,
  };
}

describe('buildScorecard', () => {
  it('returns null values and neutral bands for an empty period', () => {
    const out = buildScorecard(input());
    expect(out.sla).toMatchObject({ value: null, prevValue: null, deltaPct: null, band: 'neutral' });
    expect(out.csat).toMatchObject({ value: null, prevValue: null, deltaPct: null, band: 'neutral' });
    expect(out.volume).toMatchObject({ value: 0, prevValue: 0, deltaPct: null, band: 'neutral' });
  });

  it('computes SLA percentage from met / withResponse', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, ticketsMetSla: 47, ticketsWithResponse: 50 },
      }),
    );
    expect(out.sla.value).toBe(94);
  });

  it('returns null SLA value when no tickets had a response', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, ticketsMetSla: 0, ticketsWithResponse: 0 },
      }),
    );
    expect(out.sla.value).toBeNull();
    expect(out.sla.band).toBe('neutral');
  });

  it('paints SLA green when actual meets the target', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, ticketsMetSla: 95, ticketsWithResponse: 100 },
        slaConfig: { targetPct: 95, warnPct: 5 },
      }),
    );
    expect(out.sla.band).toBe('green');
  });

  it('paints SLA amber within the warn band', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, ticketsMetSla: 92, ticketsWithResponse: 100 },
        slaConfig: { targetPct: 95, warnPct: 5 },
      }),
    );
    expect(out.sla.band).toBe('amber');
  });

  it('paints SLA red below the warn band', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, ticketsMetSla: 80, ticketsWithResponse: 100 },
        slaConfig: { targetPct: 95, warnPct: 5 },
      }),
    );
    expect(out.sla.band).toBe('red');
  });

  it('SLA band is neutral when no target is configured', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, ticketsMetSla: 50, ticketsWithResponse: 100 },
        slaConfig: { targetPct: null, warnPct: 5 },
      }),
    );
    expect(out.sla.band).toBe('neutral');
  });

  it('exposes p95 response minutes as the SLA tooltip when present', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, ticketsMetSla: 50, ticketsWithResponse: 50, p95ResponseMinutes: 8 },
      }),
    );
    expect(out.sla.tooltip).toBe('p95 response: 8 min');
  });

  it('omits the SLA tooltip when p95 is unavailable', () => {
    const out = buildScorecard(input());
    expect(out.sla.tooltip).toBeUndefined();
  });

  it('computes CSAT from ratingSum / ratingCount and stays neutral (phase 1)', () => {
    const out = buildScorecard(
      input({ current: { ...EMPTY, ratingSum: 90, ratingCount: 20 } }),
    );
    expect(out.csat.value).toBe(4.5);
    expect(out.csat.band).toBe('neutral');
  });

  it('returns null CSAT when no ratings landed in the window', () => {
    const out = buildScorecard(input());
    expect(out.csat.value).toBeNull();
  });

  it('Volume card mirrors totalTickets and is always neutral (phase 1)', () => {
    const out = buildScorecard(
      input({ current: { ...EMPTY, totalTickets: 142 } }),
    );
    expect(out.volume.value).toBe(142);
    expect(out.volume.band).toBe('neutral');
  });

  it('computes deltaPct as percent change from previous to current', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, totalTickets: 120 },
        previous: { ...EMPTY, totalTickets: 100 },
      }),
    );
    expect(out.volume.deltaPct).toBe(20);
  });

  it('returns null deltaPct when previous is zero (avoid div by zero)', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, totalTickets: 50 },
        previous: { ...EMPTY, totalTickets: 0 },
      }),
    );
    expect(out.volume.deltaPct).toBeNull();
  });

  it('returns null deltaPct when current value is null', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, ticketsMetSla: 0, ticketsWithResponse: 0 },
        previous: { ...EMPTY, ticketsMetSla: 90, ticketsWithResponse: 100 },
      }),
    );
    expect(out.sla.value).toBeNull();
    expect(out.sla.deltaPct).toBeNull();
  });

  it('rounds SLA percentage to one decimal place', () => {
    const out = buildScorecard(
      input({
        current: { ...EMPTY, ticketsMetSla: 1, ticketsWithResponse: 3 },
      }),
    );
    expect(out.sla.value).toBe(33.3);
  });
});
