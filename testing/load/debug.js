import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.K6_BASE_URL || 'http://host.docker.internal:3001';

export const options = { vus: 1, iterations: 1 };

export default function () {
  // Login
  const login = http.post(
    `${BASE}/api/v1/auth/login-local`,
    JSON.stringify({ email: 'dirk@guichet.demo', password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );
  console.log(`login: status=${login.status} body=${login.body.substring(0, 300)}`);

  // Show cookies
  const jar = http.cookieJar();
  const cookies = jar.cookiesForURL(`${BASE}/`);
  console.log(`cookies: ${JSON.stringify(cookies)}`);

  // Try refresh
  const refreshCookies = jar.cookiesForURL(`${BASE}/api/auth/refresh`);
  console.log(`refresh path cookies: ${JSON.stringify(refreshCookies)}`);

  const refresh = http.post(`${BASE}/api/v1/auth/refresh`, null, {
    headers: { 'Content-Type': 'application/json' },
  });
  console.log(`refresh: status=${refresh.status} body=${refresh.body}`);
}
