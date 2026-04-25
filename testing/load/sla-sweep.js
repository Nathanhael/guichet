import http from 'k6/http';
import { check, sleep } from 'k6';

/**
 * SLA sweep worker health check.
 *
 * Parent plan: docs/superpowers/plans/2026-04-19-sla-config.md (Task 21).
 *
 * Preconditions (manual for v1):
 *   - Server is running with SLA_SWEEP_INTERVAL_MS set (default 60000).
 *   - For meaningful load signal, seed ~100 partners × 50 open tickets with
 *     SLA enabled. Without that seed data the script still validates that
 *     the sweep worker is alive and that each sweep completes in < 30s, so
 *     it doubles as a smoke test for the worker itself.
 *
 * Run:
 *   MSYS_NO_PATHCONV=1 docker run --rm \
 *     -e K6_BASE_URL=http://host.docker.internal:3001 \
 *     -v "$(pwd)/testing/load:/scripts" \
 *     grafana/k6 run /scripts/sla-sweep.js
 *
 * Checks:
 *   - `metric registered` — one-time check that the counter exists in
 *     `/metrics` output. Fails fast if the worker is misconfigured or the
 *     metric is renamed, instead of polling 90s for nothing.
 *   - `sweep ran` — the sweep counter advanced within the polling window.
 *   - `all sweeps ≤ 30s` — every observed sweep landed in the top histogram
 *     bucket (`le="30"`). This is a max check, not a true p99; one slow
 *     sweep fails it. Once `sweep ran` passes we know `total ≥ 1`, so we
 *     do not silently short-circuit on `total === 0`.
 */

const BASE = __ENV.K6_BASE_URL || 'http://host.docker.internal:3001';

export const options = {
  scenarios: {
    sweep_verification: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '120s',
    },
  },
};

function parseMetric(body, pattern) {
  const m = body.match(pattern);
  return Number((m || [])[1] || 0);
}

export default function () {
  const before = http.get(`${BASE}/metrics`);
  if (before.status !== 200) {
    console.log(`/metrics returned ${before.status} on initial read`);
    check(before, { 'metric registered': () => false });
    return;
  }
  if (!before.body.includes('guichet_sla_sweep_runs_total')) {
    check(before, { 'metric registered': () => false });
    return;
  }
  check(before, { 'metric registered': () => true });
  const runsBefore = parseMetric(before.body, /guichet_sla_sweep_runs_total\s+(\d+)/);

  // Wait for at least one sweep. Default interval is 60s, so poll for 90s
  // to give a full interval + 30s grace.
  for (let i = 0; i < 90; i++) {
    const r = http.get(`${BASE}/metrics`);
    if (r.status !== 200) {
      console.log(`/metrics returned ${r.status} during poll iteration ${i}`);
      sleep(1);
      continue;
    }
    const runs = parseMetric(r.body, /guichet_sla_sweep_runs_total\s+(\d+)/);
    if (runs > runsBefore) {
      check(r, { 'sweep ran': () => true });

      // Top histogram bucket is le="30". If every sweep completed in ≤ 30s,
      // the bucket count equals the total count. Once a sweep has run,
      // total must be ≥ 1 — a zero total here means the histogram and
      // counter drifted and that's a real bug worth surfacing.
      const inBucket = parseMetric(r.body, /guichet_sla_sweep_duration_seconds_bucket\{le="30"\}\s+(\d+)/);
      const total = parseMetric(r.body, /guichet_sla_sweep_duration_seconds_count\s+(\d+)/);
      check(r, { 'all sweeps ≤ 30s': () => total >= 1 && inBucket === total });
      return;
    }
    sleep(1);
  }
  console.log(`last observed runs=${runsBefore}, never advanced`);
  check(null, { 'sweep ran within 90s': () => false });
}
