/**
 * WebSocket (Socket.io) load test for Guichet.
 *
 * k6 doesn't natively speak Socket.io's protocol (Engine.IO framing),
 * so we use the k6 WebSocket API with raw Engine.IO / Socket.io frames.
 *
 * Engine.IO frame types:  0=open, 2=ping, 3=pong, 4=message
 * Socket.io packet types: 0=CONNECT, 2=EVENT, 3=ACK, 42=EVENT (4+"2")
 *
 * Run via Docker:
 *   MSYS_NO_PATHCONV=1 docker run --rm --network=host \
 *     -v "$(pwd)/testing/load:/scripts" grafana/k6 run /scripts/ws.js
 *
 * Or with env override:
 *   k6 run -e K6_BASE_URL=http://localhost:3001 testing/load/ws.js
 */

import http from 'k6/http';
import ws from 'k6/ws';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE = __ENV.K6_BASE_URL || 'http://localhost:3001';
const WS_BASE = BASE.replace(/^http/, 'ws');

// Custom metrics
const wsConnections = new Counter('ws_connections');
const wsMessagesSent = new Counter('ws_messages_sent');
const wsMessagesReceived = new Counter('ws_messages_received');
const wsIdentifyDuration = new Trend('ws_identify_duration');

export const options = {
  stages: [
    { duration: '10s', target: 10 },  // ramp up to 10 concurrent WS connections
    { duration: '30s', target: 10 },  // hold 10 connections
    { duration: '10s', target: 25 },  // ramp to 25
    { duration: '30s', target: 25 },  // hold 25
    { duration: '10s', target: 0 },   // ramp down
  ],
  thresholds: {
    ws_connecting: ['p(95)<2000'],     // 95% connect under 2s
    ws_identify_duration: ['p(95)<500'], // identify handshake under 500ms
    ws_connections: ['count>0'],
  },
};

/**
 * Login once per VU and return the JWT token + partnerId.
 */
export function setup() {
  const login = http.post(
    `${BASE}/api/v1/auth/login-local`,
    JSON.stringify({ email: 'alice@acme.com', password: 'password123' }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  check(login, {
    'setup: login 200': (r) => r.status === 200,
  });

  // Extract JWT cookie from Set-Cookie header (k6 lowercases header names).
  // Parse out just the token value — the raw header includes Path=, HttpOnly, etc.
  const raw = login.headers['set-cookie'] || '';
  const tokenMatch = raw.match(/guichet_token=([^;]+)/);
  const cookies = tokenMatch ? `guichet_token=${tokenMatch[1]}` : '';

  const body = login.json();
  return {
    cookies,
    partnerId: body.user ? body.user.partnerId : 'acme-corp',
    userId: body.user ? body.user.id : '',
  };
}

export default function (data) {
  // Engine.IO handshake happens over HTTP first, then upgrades to WebSocket.
  // Socket.io v4 uses path /socket.io/ with EIO=4.
  const url = `${WS_BASE}/socket.io/?EIO=4&transport=websocket`;

  const res = ws.connect(url, { headers: { Cookie: data.cookies } }, function (socket) {
    wsConnections.add(1);
    let identified = false;
    let identifyStart = 0;

    socket.on('open', function () {
      // Engine.IO will send us packet type 0 (open) with handshake JSON
    });

    socket.on('message', function (msg) {
      wsMessagesReceived.add(1);

      // Engine.IO open packet: "0{...}"
      if (msg.startsWith('0{')) {
        // Send Socket.io CONNECT to default namespace: "40"
        socket.send('40');
        return;
      }

      // Socket.io CONNECT ACK: "40{...}" (namespace connected)
      if (msg.startsWith('40')) {
        // Now identify ourselves
        identifyStart = Date.now();
        const identifyPayload = JSON.stringify([
          'socket:identify',
          { partnerId: data.partnerId },
        ]);
        // Socket.io EVENT = "42" + JSON array
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

            // Once identified, exercise a few real-time actions:

            // 1. Join a ticket room (simulate support viewing a ticket)
            const joinPayload = JSON.stringify(['support:join', { ticketId: 'load-test-room', supportLang: 'en' }]);
            socket.send('42' + joinPayload);
            wsMessagesSent.add(1);

            // 2. Send a typing indicator
            sleep(0.5);
            const typingPayload = JSON.stringify(['typing:start', { ticketId: 'load-test-room' }]);
            socket.send('42' + typingPayload);
            wsMessagesSent.add(1);

            // 3. Leave the room
            sleep(0.5);
            const leavePayload = JSON.stringify(['support:leave', { ticketId: 'load-test-room' }]);
            socket.send('42' + leavePayload);
            wsMessagesSent.add(1);
          }
        } catch (_) {
          // ignore parse errors on unexpected frames
        }
        return;
      }

      // Engine.IO ping: "2" → reply pong: "3"
      if (msg === '2') {
        socket.send('3');
        return;
      }
    });

    // Keep connection alive for the iteration duration
    socket.setTimeout(function () {
      socket.close();
    }, 8000);
  });

  check(res, {
    'ws: connected successfully': (r) => r && r.status === 101,
  });

  sleep(1);
}
