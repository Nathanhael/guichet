import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

// Mock dependencies before importing the module under test
vi.mock('../../utils/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../services/sessionRevocation.js', () => ({
  isRevoked: vi.fn(),
}));

import { isTokenExpired, requireIdentified, REVOCATION_CHECK_INTERVAL_MS } from './types.js';

function makeSocket(overrides: Partial<{ tokenExp: number; userId: string; partnerId: string; lastRevocationCheck: number }> = {}): Socket {
  const emitMock = vi.fn();
  const disconnectMock = vi.fn();
  return {
    id: 'test-socket-id',
    data: {
      tokenExp: overrides.tokenExp,
      userId: overrides.userId,
      partnerId: overrides.partnerId,
      lastRevocationCheck: overrides.lastRevocationCheck,
      jti: 'test-jti',
      iat: Math.floor(Date.now() / 1000) - 100,
    },
    emit: emitMock,
    disconnect: disconnectMock,
  } as unknown as Socket;
}

describe('isTokenExpired', () => {
  it('returns false when token is not expired (exp in future)', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    const socket = makeSocket({ tokenExp: futureExp });
    expect(isTokenExpired(socket)).toBe(false);
  });

  it('returns true when token is expired (exp in past)', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
    const socket = makeSocket({ tokenExp: pastExp });
    expect(isTokenExpired(socket)).toBe(true);
  });

  it('returns true when exp is missing', () => {
    const socket = makeSocket(); // no tokenExp
    expect(isTokenExpired(socket)).toBe(true);
  });
});

describe('requireIdentified', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for an identified, non-expired socket', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    // Set lastRevocationCheck to recent time to skip the async revocation check
    const socket = makeSocket({
      tokenExp: futureExp,
      userId: 'user-123',
      partnerId: 'partner-456',
      lastRevocationCheck: Date.now(), // just checked — skip periodic check
    });

    const result = requireIdentified(socket);
    expect(result).toBe(true);
    expect(socket.emit).not.toHaveBeenCalled();
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('returns false and emits auth:expired for an expired token', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 3600;
    const socket = makeSocket({
      tokenExp: pastExp,
      userId: 'user-123',
      partnerId: 'partner-456',
    });

    const result = requireIdentified(socket);
    expect(result).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('auth:expired', { message: 'Token expired — please re-authenticate' });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('returns false and emits error for unidentified socket (no userId)', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600;
    const socket = makeSocket({
      tokenExp: futureExp,
      // no userId, no partnerId
    });

    const result = requireIdentified(socket);
    expect(result).toBe(false);
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Not authenticated — call socket:identify first' });
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('exports REVOCATION_CHECK_INTERVAL_MS as 60000', () => {
    expect(REVOCATION_CHECK_INTERVAL_MS).toBe(60 * 1000);
  });
});
