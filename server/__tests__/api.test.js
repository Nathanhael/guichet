import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db } from '../db/sqlite.js';

describe('Protected API Routes', () => {
    let managerToken;
    let agentToken;

    const managerUser = {
        id: 'manager_api_test',
        name: 'API Manager',
        password: 'Password123!',
        role: 'manager'
    };

    const agentUser = {
        id: 'agent_api_test',
        name: 'API Agent',
        password: 'Password123!',
        role: 'agent',
        dept: 'DSC'
    };

    beforeAll(async () => {
        db.prepare('DELETE FROM ticket_labels').run();
        db.prepare('DELETE FROM labels').run();
        db.prepare('DELETE FROM users').run();

        // Register and login a manager
        await request(app).post('/api/auth/register').send(managerUser);
        const mLogin = await request(app).post('/api/auth/login').send({ id: managerUser.id, password: managerUser.password });
        managerToken = mLogin.body.token;

        // Register and login an agent
        await request(app).post('/api/auth/register').send(agentUser);
        const aLogin = await request(app).post('/api/auth/login').send({ id: agentUser.id, password: agentUser.password });
        agentToken = aLogin.body.token;
    });

    describe('GET /api/stats', () => {
        it('should fail without token', async () => {
            const res = await request(app).get('/api/stats');
            expect(res.status).toBe(401);
        });

        it('should succeed with manager token', async () => {
            const res = await request(app)
                .get('/api/stats')
                .set('Authorization', `Bearer ${managerToken}`);
            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('total');
        });

        it('should fail with agent token (unauthorized role)', async () => {
            const res = await request(app)
                .get('/api/stats')
                .set('Authorization', `Bearer ${agentToken}`);
            expect(res.status).toBe(403);
        });
    });

    describe('POST /api/labels', () => {
        it('should fail with agent token', async () => {
            const res = await request(app)
                .post('/api/labels')
                .set('Authorization', `Bearer ${agentToken}`)
                .send({ text: 'Test Label', color: 'blue' });
            expect(res.status).toBe(403);
        });

        it('should succeed with manager token', async () => {
            const res = await request(app)
                .post('/api/labels')
                .set('Authorization', `Bearer ${managerToken}`)
                .send({ text: 'API Test Label', color: '#e11d48' });
            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('text', 'API Test Label');
        });
    });
});
