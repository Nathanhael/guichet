/**
 * Tessera database seed script.
 *
 * Truncates all tables, then seeds initial data.
 * The platform operator is auto-created by the bootstrap service
 * on server startup from PLATFORM_ADMIN_EMAIL env var.
 *
 * Usage: docker compose exec server npx tsx seed.ts
 */
import { db } from './db.js';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   Tessera Database Seed                          ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── 1. TRUNCATE ALL TABLES ─────────────────────────────────────────────────
  console.log('① Truncating all tables...');
  await db.execute(sql`
    TRUNCATE TABLE
      webhook_logs, webhooks, ai_usage_log, daily_ai_usage, ai_prompt_templates,
      saved_views, refresh_tokens, ticket_labels, ratings, app_feedback,
      messages, tickets, archived_tickets, audit_archive, audit_log,
      daily_stats, topic_alerts, canned_responses, kb_articles,
      partner_group_mappings, labels, memberships, system_settings,
      daily_agent_status, agent_status_log, push_subscriptions,
      users, partners
    CASCADE
  `);
  console.log('   All tables truncated.\n');

  // ── Done ───────────────────────────────────────────────────────────────────
  console.log('Done. Database is clean.');
  console.log('Restart the server to trigger platform operator bootstrap.\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
