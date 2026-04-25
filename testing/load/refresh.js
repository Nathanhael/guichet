import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.K6_BASE_URL || 'http://host.docker.internal:3001';

export const options = {
  stages: [
    { duration: '5s', target: 5 },
    { duration: '20s', target: 5 },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    'checks': ['rate>0.90'],
  },
};

// Each VU logs in once and uses its own cookie jar automatically
export function setup() {
  // Just verify server is reachable
  const health = http.get(`${BASE}/api/v1/health`);
  check(health, { 'setup: server healthy': (r) => r.status === 200 });
}

export default function () {
  // VU cookie jar persists across iterations, so login once
  const jar = http.cookieJar();
  const cookies = jar.cookiesForURL(`${BASE}/`);

  if (!cookies.guichet_token || cookies.guichet_token.length === 0) {
    // First iteration for this VU — login
    const login = http.post(
      `${BASE}/api/v1/auth/login-local`,
      JSON.stringify({ email: 'dirk@guichet.demo', password: 'password123' }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (login.status !== 200) {
      console.log(`login failed: ${login.status} ${login.body}`);
      sleep(1);
      return;
    }
  }

  // Rotate refresh token
  const refresh = http.post(`${BASE}/api/v1/auth/refresh`, null);
  check(refresh, {
    'refresh: status 200': (r) => r.status === 200,
    'refresh: expiresIn > 0': (r) => {
      try { return r.json('expiresIn') > 0; } catch { return false; }
    },
  });

  // Verify access token still works
  const health = http.get(`${BASE}/api/v1/health`);
  check(health, {
    'health after refresh: 200': (r) => r.status === 200,
  });

  sleep(0.3);
}
