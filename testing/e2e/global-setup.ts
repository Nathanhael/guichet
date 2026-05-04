// E2E global setup — resets DB state that drifts between manual dev sessions
// and test runs. Without this, partner AI config or user.lang changes made
// via the UI persist and break tests that assume seed defaults.
//
// The leak history that motivated this hook:
//   - acme.ai_features.messageImprovement was left = 'forced' from a manual
//     test of the AI improve-diff modal; chat-flow + chat-enhancements specs
//     then failed because Enter opened the diff modal instead of sending.
//   - agent_julie.lang was left = 'nl' from a translation-feature test;
//     agent-flow's send-button regex (which assumed FR per seed.ts) didn't
//     match the resulting NL "Stuur".
//
// Keep this file minimal: only reset state that has *already* bitten us.
// Adding speculative resets here makes test boundaries vague and hides
// real test-isolation bugs in the specs themselves.
//
// We shell into the `db` container via docker compose to avoid pulling
// `pg` into host devDependencies — playwright is the only thing the host
// runs directly (per CLAUDE.md: no host npm/node/npx outside testing).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

const RESETS = [
  `UPDATE partners SET ai_enabled = false, ai_features = '{}'::jsonb WHERE id = 'acme'`,
  `UPDATE users SET lang = 'fr' WHERE id = 'agent_julie'`,
];

export default async function globalSetup(): Promise<void> {
  const sql = RESETS.join('; ') + ';';
  await exec('docker', [
    'compose', 'exec', '-T', 'db',
    'psql', '-U', 'user', '-d', 'guichet', '-c', sql,
  ]);
}
