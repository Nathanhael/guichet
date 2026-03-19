import { db } from '../db';
import { partners, memberships, tickets } from '../db/schema';
import { sql } from 'drizzle-orm';

// simple slugify helper
function makeSlug(text: string) {
  return text.toString().toLowerCase().trim()
    .replace(/\s+/g, '-')           // Replace spaces with -
    .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
    .replace(/\-\-+/g, '-')         // Replace multiple - with single -
    .replace(/^-+/, '')             // Trim - from start of text
    .replace(/-+$/, '');            // Trim - from end of text
}

async function run() {
  console.log('Starting migration for Multi-Partner Team Management...');

  try {
    // 1. Migrate partners.departments
    console.log('Migrating partners.departments...');
    const allPartners = await db.select().from(partners);
    for (const p of allPartners) {
      if (p.departments && Array.isArray(p.departments)) {
        const newDepts = p.departments.map((d: any) => {
          if (d.label && !d.name) {
            return {
              id: makeSlug(d.label),
              name: d.label,
              description: d.description || ''
            };
          }
          if (d.id && d.id !== d.id.toLowerCase()) {
            return {
              ...d,
              id: d.id.toLowerCase()
            };
          }
          return d;
        });

        await db.update(partners)
          .set({ departments: newDepts })
          .where(sql`${partners.id} = ${p.id}`);
      }
    }
    console.log('partners.departments migrated.');

    // 2. Migrate memberships.dept -> memberships.departments
    console.log('Migrating memberships.departments...');
    const allMemberships = await db.select().from(memberships);
    for (const m of allMemberships) {
      if (m.dept && (!m.departments || m.departments.length === 0)) {
        const newDepts = [m.dept.toLowerCase()];
        await db.update(memberships)
          .set({ departments: newDepts })
          .where(sql`${memberships.id} = ${m.id}`);
      }
    }
    console.log('memberships.departments migrated.');

    // 3. Migrate tickets.dept to lowercase slugs
    console.log('Migrating tickets.dept...');
    const allTickets = await db.select().from(tickets);
    for (const t of allTickets) {
      if (t.dept && t.dept !== t.dept.toLowerCase()) {
        await db.update(tickets)
          .set({ dept: t.dept.toLowerCase() })
          .where(sql`${tickets.id} = ${t.id}`);
      }
    }
    console.log('tickets.dept migrated.');

    console.log('Migration completed successfully.');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

run();