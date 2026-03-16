import ws from 'k6/ws';
import { check, sleep } from 'k6';

export const options = {
    stages: [
        { duration: '30s', target: 50 },  // Ramp up to 50 users
        { duration: '1m', target: 50 },   // Stay at 50
        { duration: '30s', target: 0 },   // Ramp down
    ],
    thresholds: {
        'ws_connecting': ['p(95)<200'], // 95% of connections should be under 200ms
    },
};

const BASE_URL = __ENV.SERVER_URL || 'ws://lb:80';

export default function () {
    const url = `${BASE_URL}/socket.io/?EIO=4&transport=websocket`;
    
    const params = { tags: { my_tag: 'socketio' } };

    const res = ws.connect(url, params, function (socket) {
        socket.on('open', function () {
            // Socket.io handshake (Open)
            // 40 is the standard "connect" packet for Socket.io v4
            socket.send('40');
            
            // Mock identification
            const agentId = `k6-agent-${__VU}`;
            const identifyPayload = JSON.stringify(['socket:identify', { userId: agentId, name: `K6 Agent ${__VU}`, role: 'agent' }]);
            socket.send(`42${identifyPayload}`);
        });

        socket.on('message', function (data) {
            // Handle incoming messages
            if (data === '2') {
                // Heartbeat ping from server
                socket.send('3'); // Heartbeat pong
            }
            
            if (data.startsWith('42["socket:identified"')) {
                // Once identified, simulate creating a ticket
                const ticketPayload = JSON.stringify(['ticket:new', {
                    agentId: `k6-agent-${__VU}`,
                    agentLang: 'en',
                    dept: 'DSC',
                    text: 'K6 Stress Test Ticket message'
                }]);
                socket.send(`42${ticketPayload}`);
            }
        });

        socket.on('close', () => console.log('WebSocket closed'));
        socket.on('error', (e) => console.log('WebSocket error: ', e.error()));

        socket.setTimeout(function () {
            socket.close();
        }, 30000); // Stay connected for 30s
    });

    check(res, { 'status is 101': (r) => r && r.status === 101 });
}
