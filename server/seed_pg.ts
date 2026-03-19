import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { users, partners, memberships, labels } from './db/schema.js';
import { eq } from 'drizzle-orm';
import logger from './utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

async function seed() {
    console.log('🌱 Starting database seed (schema-aware)...');
    
    // 1. Ensure Default Partner exists
    const defaultPartnerId = 'tessera-main';
    const existingPartner = await db.select().from(partners).where(eq(partners.id, defaultPartnerId)).limit(1);
    
    if (existingPartner.length === 0) {
        console.log('  - Creating default partner...');
        await db.insert(partners).values({
            id: defaultPartnerId,
            name: 'Tessera Main',
            industry: 'Telecommunications',
            departments: JSON.stringify([
                { id: 'DSC', label: 'Dispatch' },
                { id: 'FOT', label: 'Front Office' }
            ]),
            aiProvider: 'ollama',
            ollamaModel: 'translategemma:4b',
            aiEnabled: true,
            createdAt: new Date().toISOString()
        });
    }

    const demoUsers = [
        { id: 'agent_jan', name: 'Agent Jan', role: 'agent', dept: 'DSC', lang: 'nl', isPlatformOperator: false },
        { id: 'agent_marie', name: 'Agent Marie', role: 'agent', dept: 'FOT', lang: 'fr', isPlatformOperator: false },
        { id: 'agent_tom', name: 'Agent Tom', role: 'agent', dept: 'DSC', lang: 'en', isPlatformOperator: false },
        { id: 'expert_piet', name: 'Expert Piet', role: 'support', dept: 'DSC', lang: 'nl', isPlatformOperator: false },
        { id: 'expert_sophie', name: 'Expert Sophie', role: 'support', dept: 'FOT', lang: 'fr', isPlatformOperator: false },
        { id: 'expert_alex', name: 'Expert Alex', role: 'support', dept: 'FOT', lang: 'en', isPlatformOperator: false },
        { id: 'admin_dirk', name: 'Admin Dirk', role: 'admin', dept: 'DSC', lang: 'nl', isPlatformOperator: false },
        { id: 'platform_bart', name: 'Platform Bart', role: 'platform_operator', dept: 'GLOBAL', lang: 'nl', isPlatformOperator: true }
    ];

    const password = 'password123';
    const hashedPassword = await bcrypt.hash(password, 10);

    for (const u of demoUsers) {
        try {
            const existing = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
            if (existing.length > 0) {
                console.log(`  - User ${u.id} already exists, skipping.`);
            } else {
                console.log(`  - Creating user ${u.id}...`);
                await db.insert(users).values({
                    id: u.id,
                    name: u.name,
                    lang: u.lang as any,
                    password: hashedPassword,
                    isPlatformOperator: u.isPlatformOperator
                });
            }

            // Ensure membership exists
            const existingMem = await db.select().from(memberships)
                .where(eq(memberships.userId, u.id))
                .limit(1);
            
            if (existingMem.length === 0) {
                console.log(`  - Creating membership for ${u.id}...`);
                await db.insert(memberships).values({
                    id: `mem_${u.id}`,
                    userId: u.id,
                    partnerId: defaultPartnerId,
                    role: u.role as any,
                    dept: u.dept,
                    createdAt: new Date().toISOString()
                });
            }
        } catch (err: unknown) {
            console.error(`❌ Error creating user/membership ${u.id}:`, (err as Error).message);
        }
    }

    console.log('🌱 Seeding labels...');
    const demoLabels = [
        { id: 'label_billing', name: 'Billing', color: '#ef4444' },
        { id: 'label_technical', name: 'Technical', color: '#3b82f6' },
        { id: 'label_sales', name: 'Sales', color: '#10b981' }
    ];

    for (const l of demoLabels) {
        try {
            const existing = await db.select().from(labels).where(eq(labels.id, l.id)).limit(1);
            if (existing.length > 0) continue;

            await db.insert(labels).values({
                id: l.id,
                name: l.name,
                color: l.color,
                partnerId: defaultPartnerId
            });
            console.log(`  - Created label: ${l.name}`);
        } catch (err: unknown) {
            console.error(`❌ Error creating label ${l.name}:`, (err as Error).message);
        }
    }

    console.log('✅ Database seed complete!');
}

seed().catch((err: unknown) => {
    console.error('❌ Seed script failed:', (err as Error).message);
    process.exit(1);
});
