// server/__tests__/routes/metricsAuth.test.ts
//
// Guards the /metrics auth path. Prometheus can't emit custom headers in
// scrape_configs — it supports `authorization: { type: Bearer, ... }`
// natively. If the handler drops Bearer support, dev Prometheus scraping
// silently 403s again and dashboards render empty.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('/metrics endpoint auth', () => {
  const appSource = readFileSync(join(__dirname, '../../app.ts'), 'utf-8');

  // Grab the /metrics handler body so later regex checks don't match
  // unrelated code elsewhere in app.ts.
  const metricsHandlerMatch = appSource.match(
    /app\.get\('\/metrics'[\s\S]*?\n\}\);/,
  );
  const metricsHandler = metricsHandlerMatch?.[0] ?? '';

  it('handler block is locatable', () => {
    expect(metricsHandler).not.toBe('');
  });

  it('accepts Authorization: Bearer <token> for Prometheus native scraping', () => {
    expect(metricsHandler).toMatch(/authorization/i);
    expect(metricsHandler).toMatch(/startsWith\(['"]Bearer\s/);
    expect(metricsHandler).toMatch(/slice\(7\)/);
  });

  it('still accepts the legacy X-Metrics-Token header', () => {
    expect(metricsHandler).toMatch(/x-metrics-token/i);
  });

  it('preserves the 127.0.0.1 / ::1 localhost bypass', () => {
    expect(metricsHandler).toMatch(/127\.0\.0\.1/);
    expect(metricsHandler).toMatch(/::1/);
    expect(metricsHandler).toMatch(/::ffff:127\.0\.0\.1/);
  });

  it('fails closed when METRICS_TOKEN is not configured and caller is non-local', () => {
    expect(metricsHandler).toMatch(/!isLocal[\s\S]{0,200}status\(403\)/);
  });

  it('rejects non-localhost callers with mismatched token', () => {
    expect(metricsHandler).toMatch(/tokenHeader\s*!==\s*config\.METRICS_TOKEN[\s\S]{0,80}!isLocal/);
  });
});
