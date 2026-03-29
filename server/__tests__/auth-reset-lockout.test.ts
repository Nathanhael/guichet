import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Contract test: verifies that checkLockout is called in the reset-password handler
 * before the MFA verification block (SEC-1 fix).
 */
describe('reset-password lockout guard (SEC-1)', () => {
    const source = readFileSync(join(__dirname, '../routes/auth.ts'), 'utf-8');

    // Narrow to just the reset-password route handler
    const routeStart = source.indexOf("router.post('/reset-password'");
    const routeEnd = source.indexOf("router.post('", routeStart + 1);
    const handlerSource = routeEnd === -1 ? source.slice(routeStart) : source.slice(routeStart, routeEnd);

    it('calls checkLockout inside the reset-password handler', () => {
        expect(handlerSource).toContain('checkLockout(user)');
    });

    it('calls checkLockout BEFORE mfaEnabledAt check', () => {
        const lockoutPos = handlerSource.indexOf('checkLockout(user)');
        const mfaPos = handlerSource.indexOf('user.mfaEnabledAt');

        expect(lockoutPos).toBeGreaterThan(-1);
        expect(mfaPos).toBeGreaterThan(-1);
        expect(lockoutPos).toBeLessThan(mfaPos);
    });

    it('returns 423 when account is locked', () => {
        expect(handlerSource).toContain('status(423)');
    });
});
