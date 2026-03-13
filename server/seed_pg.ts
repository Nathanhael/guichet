import bcrypt from 'bcrypt';
import { run, get } from './db.js';
import logger from './utils/logger.js';

async function seed() {
    console.log('Starting database seed...');
    
    const demoUsers = [
        { id: 'agent_jan', name: 'Agent Jan', role: 'agent', dept: 'DSC', lang: 'nl' },
        { id: 'agent_marie', name: 'Agent Marie', role: 'agent', dept: 'FOT', lang: 'fr' },
        { id: 'agent_tom', name: 'Agent Tom', role: 'agent', dept: 'DSC', lang: 'en' },
        { id: 'expert_piet', name: 'Expert Piet', role: 'expert', dept: 'DSC', lang: 'nl' },
        { id: 'expert_sophie', name: 'Expert Sophie', role: 'expert', dept: 'FOT', lang: 'fr' },
        { id: 'expert_alex', name: 'Expert Alex', role: 'expert', dept: 'FOT', lang: 'en' },
        { id: 'admin_dirk', name: 'Admin Dirk', role: 'admin', dept: 'DSC', lang: 'nl' }
    ];

    const password = 'password123';
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    for (const user of demoUsers) {
        try {
            const existing = await get('SELECT id FROM users WHERE id = $1', [user.id]);
            if (existing) {
                console.log(`User ${user.id} already exists, skipping.`);
                continue;
            }

            await run(
                'INSERT INTO users (id, name, role, dept, lang, password) VALUES ($1, $2, $3, $4, $5, $6)',
                [user.id, user.name, user.role, user.dept, user.lang, hashedPassword]
            );
            } catch (err: unknown) {
                console.error(`Error creating user ${user.id}:`, (err as Error).message);
            }
            }

            console.log('Seeding labels...');
            const demoLabels = [
            { id: 'label_billing', name: 'Billing', color: '#ef4444' },
            { id: 'label_technical', name: 'Technical', color: '#3b82f6' },
            { id: 'label_sales', name: 'Sales', color: '#10b981' }
            ];

            for (const label of demoLabels) {
            try {
                const existing = await get('SELECT id FROM labels WHERE id = $1', [label.id]);
                if (existing) continue;

                await run(
                    'INSERT INTO labels (id, name, color) VALUES ($1, $2, $3)',
                    [label.id, label.name, label.color]
                );
                console.log(`Created label: ${label.name}`);
            } catch (err: unknown) {
                console.error(`Error creating label ${label.name}:`, (err as Error).message);
            }
            }

            console.log('Database seed complete!');
            }

            seed().catch((err: unknown) => {
            console.error('Seed script failed:', (err as Error).message);
            });
