import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3001';

export const options = {
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 users
    { duration: '1m', target: 50 },     // Ramp up to 50 users
    { duration: '1m', target: 50 },     // Hold at 50
    { duration: '30s', target: 0 },     // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],  // 95% under 1s
    http_req_failed: ['rate<0.05'],      // <5% failure rate
  },
};

// Run once at start — login and share token across VUs
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
    return;
  }

  const authHeaders = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.token}`,
    },
  };

  const input = encodeURIComponent(JSON.stringify({ partnerId: 'acme-corp' }));

  // Mix of endpoints to simulate real usage patterns
  const actions = [
    () => {
      const r = http.get(`${BASE}/api/v1/health`);
      check(r, { 'health OK': (r) => r.status === 200 });
    },
    () => {
      const r = http.get(`${BASE}/api/v1/trpc/ticket.list?input=${input}`, authHeaders);
      check(r, { 'ticket.list OK': (r) => r.status === 200 });
    },
    () => {
      // Login under load — tests Argon2 hashing performance
      const r = http.post(
        `${BASE}/api/v1/auth/login-local`,
        JSON.stringify({ email: 'alice@acme.com', password: 'password123' }),
        { headers: { 'Content-Type': 'application/json' } }
      );
      check(r, { 'login OK': (r) => r.status === 200 });
    },
    () => {
      const r = http.get(`${BASE}/api/v1/health`, authHeaders);
      check(r, { 'authed health OK': (r) => r.status === 200 });
    },
  ];

  // Pick a random action
  const action = actions[Math.floor(Math.random() * actions.length)];
  action();

  sleep(Math.random() * 2 + 0.5); // 0.5–2.5s between requests
}
