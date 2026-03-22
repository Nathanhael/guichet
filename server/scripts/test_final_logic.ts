import { db } from '../db.js';
import { auditLog } from '../db/schema.js';
import { desc, and, sql } from 'drizzle-orm';

async function testFilter(dateFrom: string, dateTo: string) {
  console.log(`\n--- TEST: From ${dateFrom} To ${dateTo} ---`);
  
  const conditions = [
    sql`${auditLog.createdAt}::date BETWEEN ${dateFrom}::date AND ${dateTo}::date`
  ];

  const query = db.select({
    id: auditLog.id,
    createdAt: auditLog.createdAt,
  })
  .from(auditLog)
  .where(and(...conditions))
  .orderBy(desc(auditLog.createdAt));

  console.log('Generated SQL:', query.toSQL().sql);
  console.log('Params:', query.toSQL().params);

  const results = await query;
  console.log(`Results found: ${results.length}`);
  if (results.length > 0) {
    console.log('Sample result:', results[0]);
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  await testFilter(today, today);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
