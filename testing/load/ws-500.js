/**
 * 500-connection WebSocket (Socket.io) load test for Tessera.
 *
 * Ramps to 500 concurrent WebSocket connections, each:
 *   - Connecting via Engine.IO/Socket.io
 *   - Identifying with a shared JWT
 *   - Joining a ticket room, sending typing events, then leaving
 *   - Staying connected for 15s (simulating an active session)
 *
 * Run:
 *   k6 run testing/load/ws-500.js
 *
 * Via Docker:
 *   MSYS_NO_PATHCONV=1 docker run --rm --network=host \
 *     -v "$(pwd)/testing/load:/scripts" grafana/k6 run /scripts/ws-500.js
 */

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend, Rate } from 'k6/metrics';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3001';
const WS_BASE = BASE.replace(/^http/, 'ws');

// Custom metrics
const wsConnections = new Counter('ws_connections');
const wsMessagesSent = new Counter('ws_messages_sent');
const wsMessagesReceived = new Counter('ws_messages_received');
const wsIdentifyDuration = new Trend('ws_identify_duration');
const wsErrors = new Rate('ws_error_rate');

export const options = {
  stages: [
    { duration: '20s', target: 50 },    // Warm up
    { duration: '30s', target: 200 },   // Ramp to 200
    { duration: '30s', target: 500 },   // Ramp to 500
    { duration: '3m',  target: 500 },   // Hold 500 connections for 3 min
    { duration: '20s', target: 0 },     // Ramp down
  ],
  thresholds: {
    ws_connecting: ['p(95)<3000'],        // 95% connect under 3s
    ws_identify_duration: ['p(95)<2000'], // identify under 2s at scale
    ws_error_rate: ['rate<0.10'],         // <10% WS errors (connections can be flaky)
    ws_connections: ['count>0'],
  },
};

export function setup() {
  const login = http.post(
    `${BASE}/api/v1/auth/login-local`,
    JSON.stringify({ email: 'alice@acme.com', password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(login, { 'setup: login 200': (r) => r.status === 200 });

  const setCookie = login.headers['Set-Cookie'] || '';
  const cookies = Array.isArray(setCookie) ? setCookie.join('; ') : setCookie;

  const body = login.json();
  return {
    cookies,
    partnerId: body.user ? body.user.partnerId : 'acme-corp',
    userId: body.user ? body.user.id : '',
  };
}

export default function (data) {
  const url = `${WS_BASE}/socket.io/?EIO=4&transport=websocket`;
  const roomId = `load-test-room-${__VU % 50}`; // Spread across 50 rooms

  const res = ws.connect(url, { headers: { Cookie: data.cookies } }, function (socket) {
    wsConnections.add(1);
    let identified = false;
    let identifyStart = 0;

    socket.on('open', function () {
      // Engine.IO sends open packet automatically
    });

    socket.on('message', function (msg) {
      wsMessagesReceived.add(1);

      // Engine.IO open packet: "0{...}"
      if (msg.startsWith('0{')) {
        socket.send('40'); // Socket.io CONNECT to default namespace
        return;
      }

      // Socket.io CONNECT ACK: "40{...}"
      if (msg.startsWith('40')) {
        identifyStart = Date.now();
        const identifyPayload = JSON.stringify([
          'socket:identify',
          { partnerId: data.partnerId },
        ]);
        socket.send('42' + identifyPayload);
        wsMessagesSent.add(1);
        return;
      }

      // Socket.io EVENT: "42[...]"
      if (msg.startsWith('42')) {
        try {
          const payload = JSON.parse(msg.slice(2));
          const eventName = payload[0];

          if (eventName === 'identified') {
            identified = true;
            wsIdentifyDuration.add(Date.now() - identifyStart);

            // Join a ticket room
            const joinPayload = JSON.stringify(['support:join', { ticketId: roomId, supportLang: 'en' }]);
            socket.send('42' + joinPayload);
            wsMessagesSent.add(1);

            // Send periodic typing events to simulate active user
            socket.setInterval(function () {
              const typingPayload = JSON.stringify(['typing:start', { ticketId: roomId }]);
              socket.send('42' + typingPayload);
              wsMessagesSent.add(1);
            }, 3000); // Every 3s
          }
        } catch (_) {
          // Ignore parse errors
        }
        return;
      }

      // Engine.IO ping → pong
      if (msg === '2') {
        socket.send('3');
        return;
      }
    });

    // Keep connection alive for 15s (simulates active session)
    socket.setTimeout(function () {
      // Leave room before disconnecting
      if (identified) {
        const leavePayload = JSON.stringify(['support:leave', { ticketId: roomId }]);
        socket.send('42' + leavePayload);
        wsMessagesSent.add(1);
      }
      socket.close();
    }, 15000);
  });

  const ok = check(res, {
    'ws: connected (101)': (r) => r && r.status === 101,
  });
  wsErrors.add(!ok);

  sleep(1);
}
