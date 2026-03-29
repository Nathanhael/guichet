import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3001';
const EMAIL = __ENV.K6_EMAIL || 'alice@acme.com';
const PASSWORD = __ENV.K6_PASSWORD || 'password123';

export const options = {
  stages: [
    { duration: '30s', target: 10 },
    { duration: '1m', target: 50 },
    { duration: '1m', target: 50 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.05'],
  },
};

export function setup() {
  const health = http.get(`${BASE}/api/v1/health`);
  check(health, { 'setup: server reachable': (r) => r.status === 200 });
  return { email: EMAIL, password: PASSWORD };
}

export default function (data) {
  // k6 uses a per-VU cookie jar by default — cookies from login
  // are automatically sent on subsequent requests.
  const login = http.post(
    `${BASE}/api/v1/auth/login-local`,
    JSON.stringify({ email: data.email, password: data.password }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (!check(login, { 'login OK': (r) => r.status === 200 })) {
    console.error(`Login failed: ${login.status} ${login.body}`);
    return;
  }

  const input = encodeURIComponent(JSON.stringify({ partnerId: 'acme-corp' }));

  const actions = [
    () => {
      const r = http.get(`${BASE}/api/v1/health`);
      check(r, { 'health OK': (r) => r.status === 200 });
    },
    () => {
      const r = http.get(`${BASE}/api/v1/trpc/ticket.list?input=${input}`);
      check(r, { 'ticket.list OK': (r) => r.status === 200 });
    },
    () => {
      const r = http.get(`${BASE}/api/v1/trpc/stats.live?input=${input}`);
      check(r, { 'stats.live OK': (r) => r.status === 200 });
    },
    () => {
      const r = http.get(`${BASE}/api/v1/health`);
      check(r, { 'authed health OK': (r) => r.status === 200 });
    },
  ];

  const count = Math.floor(Math.random() * 3) + 3;
  for (let i = 0; i < count; i++) {
    const action = actions[Math.floor(Math.random() * actions.length)];
    action();
    sleep(Math.random() * 2 + 0.5);
  }
}
