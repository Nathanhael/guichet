import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../app.js';
import { db } from '../db/sqlite.js';

describe('Authentication API', () => {
    beforeAll(() => {
        db.prepare('DELETE FROM app_feedback').run();
        db.prepare('DELETE FROM ratings').run();
        db.prepare('DELETE FROM messages').run();
        db.prepare('DELETE FROM ticket_labels').run();
        db.prepare('DELETE FROM tickets').run();
        db.prepare('DELETE FROM users').run();
    });

    const testUser = {
        id: 'test_admin',
        name: 'Test Admin',
        password: 'Password123!',
        role: 'admin',
        dept: 'DSC'
    };

    it('should register a new user', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send(testUser);

        expect(res.status).toBe(201);
        expect(res.body).toHaveProperty('message', 'User registered successfully');
    });

    it('should not register a user with existing ID', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send(testUser);

        expect(res.status).toBe(400);
        expect(res.body).toHaveProperty('error', 'User already exists');
    });

    it('should login and return a JWT', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                id: testUser.id,
                password: testUser.password
            });

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('token');
        expect(res.body.user).toHaveProperty('id', testUser.id);
    });

    it('should fail login with wrong password', async () => {
        const res = await request(app)
            .post('/api/auth/login')
            .send({
                id: testUser.id,
                password: 'wrongpassword'
            });

        expect(res.status).toBe(401);
        expect(res.body).toHaveProperty('error', 'Invalid credentials');
    });
});
