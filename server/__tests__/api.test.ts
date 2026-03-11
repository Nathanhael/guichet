import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db } from '../db/sqlite.js';

describe('Protected API Routes', () => {
    let adminToken: string;
    let agentToken: string;

    const adminUser = {
        id: 'admin_api_test',
        name: 'API Admin',
        password: 'Password123!',
        role: 'admin'
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

        // Register and login an admin
        await request(app).post('/api/auth/register').send(adminUser);
        const aLogin = await request(app).post('/api/auth/login').send({ id: adminUser.id, password: adminUser.password });
        adminToken = aLogin.body.token;

        // Register and login an agent
        await request(app).post('/api/auth/register').send(agentUser);
        const agLogin = await request(app).post('/api/auth/login').send({ id: agentUser.id, password: agentUser.password });
        agentToken = agLogin.body.token;
    });

    describe('GET /api/stats', () => {
        it('should fail without token', async () => {
            const res = await request(app).get('/api/stats');
            expect(res.status).toBe(401);
        });

        it('should succeed with admin token', async () => {
            const res = await request(app)
                .get('/api/stats')
                .set('Authorization', `Bearer ${adminToken}`);
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

        it('should succeed with admin token', async () => {
            const res = await request(app)
                .post('/api/labels')
                .set('Authorization', `Bearer ${adminToken}`)
                .send({ text: 'API Test Label', color: '#e11d48' });
            expect(res.status).toBe(201);
            expect(res.body).toHaveProperty('text', 'API Test Label');
        });
    });
});
