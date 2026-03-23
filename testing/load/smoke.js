import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3001';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests under 500ms
    http_req_failed: ['rate<0.01'],     // <1% failure rate
  },
};

export default function () {
  // 1. Health check — DB connectivity
  const health = http.get(`${BASE}/api/v1/health`);
  check(health, {
    'health: status 200': (r) => r.status === 200,
    'health: DB connected': (r) => r.json('status') === 'ok',
  });

  // 2. Login (local auth) — uses seeded Acme Corp admin
  const login = http.post(
    `${BASE}/api/v1/auth/login-local`,
    JSON.stringify({ email: 'alice@acme.com', password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(login, {
    'login: status 200': (r) => r.status === 200,
    'login: has token': (r) => !!r.json('token'),
  });

  if (login.status === 200) {
    const token = login.json('token');
    const authHeaders = {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    };

    // 3. tRPC: fetch ticket list (requires partnerId input)
    const input = encodeURIComponent(JSON.stringify({ partnerId: 'acme-corp' }));
    const tickets = http.get(`${BASE}/api/v1/trpc/ticket.list?input=${input}`, authHeaders);
    check(tickets, {
      'tickets: status 200': (r) => r.status === 200,
    });

    // 4. Authenticated health — confirms token is valid
    const authedHealth = http.get(`${BASE}/api/v1/health`, authHeaders);
    check(authedHealth, {
      'authed health: status 200': (r) => r.status === 200,
    });
  }

  sleep(1);
}
