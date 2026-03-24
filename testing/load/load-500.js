/**
 * 500-user load test for Tessera.
 *
 * Simulates 500 concurrent users with a realistic mix of:
 *   - Health checks
 *   - Authenticated ticket list queries
 *   - Login attempts (CPU-heavy due to Argon2)
 *
 * Run:
 *   k6 run testing/load/load-500.js
 *   k6 run -e K6_BASE_URL=http://localhost:3001 testing/load/load-500.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3001';

// Custom metrics
const errorRate = new Rate('error_rate');
const ticketListDuration = new Trend('ticket_list_duration');
const loginDuration = new Trend('login_duration');

export const options = {
  stages: [
    { duration: '30s', target: 50 },    // Warm up
    { duration: '30s', target: 200 },   // Ramp to 200
    { duration: '1m',  target: 500 },   // Ramp to 500
    { duration: '3m',  target: 500 },   // Hold at 500 for 3 minutes
    { duration: '30s', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'],   // 95% of requests under 2s
    http_req_failed: ['rate<0.05'],       // <5% failure rate
    error_rate: ['rate<0.05'],
    ticket_list_duration: ['p(95)<3000'], // ticket list under 3s at p95
    login_duration: ['p(95)<5000'],       // login (Argon2) under 5s at p95
  },
};

export function setup() {
  const login = http.post(
    `${BASE}/api/v1/auth/login-local`,
    JSON.stringify({ email: 'alice@acme.com', password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (login.status !== 200) {
    console.error(`Setup login failed: ${login.status} ${login.body}`);
    return { token: null };
  }

  return { token: login.json('token') };
}

export default function (data) {
  if (!data.token) {
    console.error('No auth token — skipping iteration');
    errorRate.add(1);
    return;
  }

  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.token}`,
    },
  };

  const input = encodeURIComponent(JSON.stringify({ partnerId: 'acme-corp' }));

  // Weighted action mix — reflects real usage patterns:
  //   60% read ops (ticket list, health)
  //   25% light reads (health check)
  //   15% heavy ops (login with Argon2)
  const roll = Math.random();

  if (roll < 0.40) {
    // Ticket list — most common authenticated action
    const start = Date.now();
    const r = http.get(`${BASE}/api/v1/trpc/ticket.list?input=${input}`, authHeaders);
    ticketListDuration.add(Date.now() - start);
    const ok = check(r, { 'ticket.list OK': (r) => r.status === 200 });
    errorRate.add(!ok);
  } else if (roll < 0.60) {
    // Authenticated health check
    const r = http.get(`${BASE}/api/v1/health`, authHeaders);
    const ok = check(r, { 'authed health OK': (r) => r.status === 200 });
    errorRate.add(!ok);
  } else if (roll < 0.85) {
    // Unauthenticated health check
    const r = http.get(`${BASE}/api/v1/health`);
    const ok = check(r, { 'health OK': (r) => r.status === 200 });
    errorRate.add(!ok);
  } else {
    // Login — stresses Argon2 hashing (CPU-heavy)
    const start = Date.now();
    const r = http.post(
      `${BASE}/api/v1/auth/login-local`,
      JSON.stringify({ email: 'alice@acme.com', password: 'password123' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    loginDuration.add(Date.now() - start);
    const ok = check(r, { 'login OK': (r) => r.status === 200 });
    errorRate.add(!ok);
  }

  // Think time: 1–3s between actions (realistic user pacing)
  sleep(Math.random() * 2 + 1);
}
