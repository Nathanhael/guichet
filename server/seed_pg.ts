import { hashPassword } from './utils/passwords.js';
import { db } from './db.js';
import { users, partners, memberships, labels } from './db/schema.js';
import { eq } from 'drizzle-orm';
import logger from './utils/logger.js';
import type { UserRole } from './types/index.js';

async function seed() {
    console.log('Starting database seed...');

    // 1. Create partner with dynamic departments
    const partnerId = 'tessera-main';
    const existingPartner = await db.select().from(partners).where(eq(partners.id, partnerId)).limit(1);

    if (existingPartner.length === 0) {
        console.log('  Creating default partner...');
        await db.insert(partners).values({
            id: partnerId,
            name: 'Tessera Main',
            industry: 'Telecommunications',
            departments: [
                { id: 'dispatch', name: 'Dispatch', description: 'Field dispatch and routing' },
                { id: 'front-office', name: 'Front Office', description: 'Customer-facing support' },
                { id: 'billing', name: 'Billing', description: 'Invoicing and payments' }
            ],
            status: 'active',
            authMethod: 'local',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }

    // Create SSO demo partner
    const ssoPartnerId = 'enterprise-demo';
    const existingSsoPartner = await db.select().from(partners).where(eq(partners.id, ssoPartnerId)).limit(1);

    if (existingSsoPartner.length === 0) {
        console.log('  Creating SSO demo partner...');
        await db.insert(partners).values({
            id: ssoPartnerId,
            name: 'Enterprise Demo (SSO)',
            industry: 'Financial Services',
            departments: [
                { id: 'trading', name: 'Trading', description: 'Trading desk support' },
                { id: 'compliance', name: 'Compliance', description: 'Regulatory and compliance' }
            ],
            authMethod: 'sso',
            status: 'active',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
    }

    // 2. Create users and memberships
    const password = 'password123';
    const hashedPassword = await hashPassword(password);

    const demoUsers: Array<{ id: string; name: string; email: string; role: UserRole; departments: string[]; lang: string; isPlatformOperator?: boolean }> = [
        // 5 Agents (end-users / customers)
        { id: 'agent_jan',     name: 'Jan Peeters',     email: 'jan@tessera.demo',     role: 'agent',   departments: ['dispatch'],     lang: 'nl' },
        { id: 'agent_marie',   name: 'Marie Dubois',    email: 'marie@tessera.demo',   role: 'agent',   departments: ['front-office'], lang: 'fr' },
        { id: 'agent_tom',     name: 'Tom Williams',    email: 'tom@tessera.demo',     role: 'agent',   departments: ['dispatch'],     lang: 'en' },
        { id: 'agent_lisa',    name: 'Lisa Janssens',   email: 'lisa@tessera.demo',    role: 'agent',   departments: ['billing'],      lang: 'nl' },
        { id: 'agent_karim',   name: 'Karim Benali',    email: 'karim@tessera.demo',   role: 'agent',   departments: ['front-office'], lang: 'fr' },
        // 3 Support (experts)
        { id: 'expert_piet',   name: 'Piet Van Damme',  email: 'piet@tessera.demo',    role: 'support', departments: ['dispatch'],     lang: 'nl' },
        { id: 'expert_sophie', name: 'Sophie Laurent',  email: 'sophie@tessera.demo',  role: 'support', departments: ['front-office'], lang: 'fr' },
        { id: 'expert_alex',   name: 'Alex Johnson',    email: 'alex@tessera.demo',    role: 'support', departments: [],               lang: 'en' }, // generalist
        // 1 Admin
        { id: 'admin_dirk',    name: 'Dirk De Smedt',  email: 'dirk@tessera.demo',    role: 'admin',   departments: [],               lang: 'nl' },
        // 1 Platform Operator
        { id: 'platform_bart', name: 'Bart Operator',   email: 'bart@tessera.demo',    role: 'admin',   departments: [],               lang: 'nl', isPlatformOperator: true },
    ];

    for (const u of demoUsers) {
        try {
            const existing = await db.select().from(users).where(eq(users.id, u.id)).limit(1);
            if (existing.length > 0) {
                console.log(`  User ${u.id} already exists, skipping.`);
                continue;
            }

            console.log(`  Creating user ${u.id}...`);
            await db.insert(users).values({
                id: u.id,
                name: u.name,
                email: u.email,
                lang: u.lang,
                password: hashedPassword,
                isPlatformOperator: u.isPlatformOperator || false,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });

            await db.insert(memberships).values({
                id: `mem_${u.id}`,
                userId: u.id,
                partnerId: partnerId,
                role: u.role,
                departments: u.departments,
                createdAt: new Date().toISOString()
            });
            console.log(`  Created ${u.role}: ${u.name}`);
        } catch (err: unknown) {
            console.error(`Error creating ${u.id}:`, (err as Error).message);
        }
    }

    // 3. Create labels
    const demoLabels = [
        { id: 'label_billing', name: 'Billing', color: '#000000' },
        { id: 'label_technical', name: 'Technical', color: '#000000' },
        { id: 'label_urgent', name: 'Urgent', color: '#000000' },
    ];

    for (const l of demoLabels) {
        try {
            const existing = await db.select().from(labels).where(eq(labels.id, l.id)).limit(1);
            if (existing.length > 0) continue;
            await db.insert(labels).values({ id: l.id, name: l.name, color: l.color, partnerId: partnerId });
            console.log(`  Created label: ${l.name}`);
        } catch (err: unknown) {
            console.error(`Error creating label ${l.name}:`, (err as Error).message);
        }
    }

    console.log('Seed complete! All users have password: password123');
}

seed().catch((err: unknown) => {
    console.error('Seed failed:', (err as Error).message);
    process.exit(1);
});
