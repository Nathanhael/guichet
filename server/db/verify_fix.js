import { db, run, get, query, transaction } from '../db.js';
import { v4 as uuidv4 } from 'uuid';

async function verifyFixes() {
    console.log('--- Verifying Fixes ---');

    try {
        // 1. Verify NOCASE collation
        console.log('Testing Label Name Uniqueness (Case-Insensitive)...');
        run('INSERT OR IGNORE INTO labels (id, name, color) VALUES (?, ?, ?)', ['test_l1', 'Verification', 'blue']);
        try {
            run('INSERT INTO labels (id, name, color) VALUES (?, ?, ?)', ['test_l2', 'verification', 'red']);
            console.error('FAIL: Label name check is still case-sensitive!');
        } catch (err) {
            console.log('SUCCESS: Case-variant label blocked correctly:', err.message);
        }

        // 2. Verify DELETE CASCADE
        console.log('Testing Delete Cascade...');
        const tId = 'test_ticket_' + Date.now();
        const lId = 'test_l1';

        // Ensure user exists for FK
        run('INSERT OR IGNORE INTO users (id, name, role) VALUES (?, ?, ?)', ['test_u1', 'Test User', 'agent']);

        run('INSERT INTO tickets (id, dept, agentId, createdAt, status) VALUES (?, ?, ?, ?, ?)', [tId, 'DSC', 'test_u1', new Date().toISOString(), 'open']);
        run('INSERT INTO ticket_labels (ticketId, labelId) VALUES (?, ?)', [tId, lId]);

        console.log('Label assigned to ticket. Deleting label...');
        run('DELETE FROM labels WHERE id = ?', [lId]);

        const count = get('SELECT COUNT(*) as count FROM ticket_labels WHERE ticketId = ? AND labelId = ?', [tId, lId]).count;
        if (count === 0) {
            console.log('SUCCESS: ticket_labels entry deleted automatically via CASCADE.');
        } else {
            console.error('FAIL: ticket_labels entry still exists!');
        }

        // Clean up
        run('DELETE FROM tickets WHERE id = ?', [tId]);
        run('DELETE FROM users WHERE id = ?', [test_u1]);

    } catch (err) {
        console.error('Verification failed with error:', err.message);
    }
}

// Note: This script is intended to be run in the server environment context.
// For now, I'll just keep it as a proof-of-concept verification plan.
