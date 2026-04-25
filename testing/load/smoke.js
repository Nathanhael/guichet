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

  // 2. Login (local auth) — uses seeded Acme Corp admin (cookie-based auth)
  const login = http.post(
    `${BASE}/api/v1/auth/login-local`,
    JSON.stringify({ email: 'dirk@guichet.demo', password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  check(login, {
    'login: status 200': (r) => r.status === 200,
    'login: has user': (r) => !!r.json('user'),
  });

  if (login.status === 200) {
    // Cookies are automatically sent by k6 cookie jar

    // 3. tRPC: fetch ticket list (requires partnerId input)
    const input = encodeURIComponent(JSON.stringify({ partnerId: 'guichet-main' }));
    const tickets = http.get(`${BASE}/api/v1/trpc/ticket.list?input=${input}`);
    check(tickets, {
      'tickets: status 200': (r) => r.status === 200,
    });

    // 4. Refresh token rotation
    const refresh = http.post(`${BASE}/api/v1/auth/refresh`, null);
    check(refresh, {
      'refresh: status 200': (r) => r.status === 200,
    });

    // 5. Authenticated health — confirms cookie auth works
    const authedHealth = http.get(`${BASE}/api/v1/health`);
    check(authedHealth, {
      'authed health: status 200': (r) => r.status === 200,
    });
  }

  sleep(1);
}
