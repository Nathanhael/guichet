import { Request, Response } from 'express';
import crypto from 'crypto';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { getRedisClients } from '../../utils/redis.js';

// Constant-time login: pre-computed Argon2 hash for timing-safe rejection of unknown users.
// This ensures "user not found" takes the same time as "wrong password".
export const DUMMY_ARGON2_HASH = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+daw';

// ---------------------------------------------------------------------------
// IP-based rate limiter for auth endpoints (Redis-backed, multi-instance safe)
// ---------------------------------------------------------------------------
const AUTH_RATE_WINDOW_SECS = 15 * 60; // 15 minutes
const AUTH_RATE_MAX_LOGIN = 20; // max login attempts per IP per window
const AUTH_RATE_MAX_RESET = 10; // max reset-password attempts per IP per window
const AUTH_RATE_MAX_REFRESH = 30; // max refresh attempts per IP per window

// In-memory fallback rate limiter when Redis is unavailable
const memoryLimiter = new Map<string, { count: number; expiresAt: number }>();
const MEMORY_CLEANUP_INTERVAL = 60_000;

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of memoryLimiter) {
    if (val.expiresAt <= now) memoryLimiter.delete(key);
  }
}, MEMORY_CLEANUP_INTERVAL);

function fallbackRateLimit(key: string, maxAttempts: number, windowSecs: number): { allowed: boolean; retryAfterSecs: number } {
  const now = Date.now();
  const entry = memoryLimiter.get(key);

  if (entry && entry.expiresAt > now) {
    entry.count++;
    if (entry.count > maxAttempts) {
      return { allowed: false, retryAfterSecs: Math.ceil((entry.expiresAt - now) / 1000) };
    }
    return { allowed: true, retryAfterSecs: 0 };
  }

  memoryLimiter.set(key, { count: 1, expiresAt: now + windowSecs * 1000 });
  return { allowed: true, retryAfterSecs: 0 };
}

/**
 * Generic Redis-backed IP rate limiter. Falls back to in-memory rate limiting if Redis is unavailable.
 */
async function redisRateLimit(
  req: Request,
  res: Response,
  next: () => void,
  prefix: string,
  maxAttempts: number,
): Promise<void> {
  if (config.DISABLE_RATE_LIMIT) {
    next();
    return;
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  try {
    const { pubClient } = getRedisClients();
    if (!pubClient) {
      // Redis unavailable — use in-memory fallback to still enforce rate limiting
      const fallbackKey = `rate:${prefix}:${ip}`;
      const result = fallbackRateLimit(fallbackKey, maxAttempts, AUTH_RATE_WINDOW_SECS);
      if (!result.allowed) {
        logger.warn({ ip, prefix }, `[Auth] IP rate limit exceeded on ${prefix} (fallback)`);
        res.set('Retry-After', String(result.retryAfterSecs));
        res.status(429).json({ error: 'Too many attempts. Please try again later.' });
        return;
      }
      next();
      return;
    }
    const key = `rate:${prefix}:${ip}`;
    const count = await pubClient.incr(key);
    if (count === 1) {
      await pubClient.expire(key, AUTH_RATE_WINDOW_SECS);
    }
    if (count > maxAttempts) {
      const ttl = await pubClient.ttl(key);
      const retryAfterSecs = ttl > 0 ? ttl : AUTH_RATE_WINDOW_SECS;
      logger.warn({ ip, prefix, count }, `[Auth] IP rate limit exceeded on ${prefix}`);
      res.set('Retry-After', String(retryAfterSecs));
      res.status(429).json({ error: 'Too many attempts. Please try again later.' });
      return;
    }
  } catch (err) {
    // Redis error — use in-memory fallback to still enforce rate limiting
    logger.warn({ err }, '[Auth] Redis rate limit check failed, using in-memory fallback');
    const fallbackKey = `rate:${prefix}:${ip}`;
    const result = fallbackRateLimit(fallbackKey, maxAttempts, AUTH_RATE_WINDOW_SECS);
    if (!result.allowed) {
      logger.warn({ ip, prefix }, `[Auth] IP rate limit exceeded on ${prefix} (fallback)`);
      res.set('Retry-After', String(result.retryAfterSecs));
      res.status(429).json({ error: 'Too many attempts. Please try again later.' });
      return;
    }
  }
  next();
}

export function loginRateLimit(req: Request, res: Response, next: () => void): void {
  redisRateLimit(req, res, next, 'login', AUTH_RATE_MAX_LOGIN);
}

export function resetPasswordRateLimit(req: Request, res: Response, next: () => void): void {
  redisRateLimit(req, res, next, 'reset-pw', AUTH_RATE_MAX_RESET);
}

export function refreshRateLimit(req: Request, res: Response, next: () => void): void {
  redisRateLimit(req, res, next, 'refresh', AUTH_RATE_MAX_REFRESH);
}

export function setRefreshCookie(res: Response, token: string, maxAgeSecs: number): void {
  res.cookie('tessera_refresh', token, {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth/refresh',
    maxAge: maxAgeSecs * 1000,
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie('tessera_refresh', {
    httpOnly: true,
    secure: config.COOKIE_SECURE,
    sameSite: 'lax',
    path: '/api/v1/auth/refresh',
    ...(config.COOKIE_DOMAIN ? { domain: config.COOKIE_DOMAIN } : {}),
  });
}

export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return `${local[0]}***@${domain}`;
}

/**
 * M-02: Timing-safe recovery code lookup.
 * Compares codeHash against all stored hashes using timingSafeEqual
 * to avoid leaking which index matched via timing side-channel.
 */
export function findRecoveryCodeIndex(recoveryCodes: string[], codeHash: string): number {
  const codeBuffer = Buffer.from(codeHash, 'hex');
  let foundIdx = -1;
  for (let i = 0; i < recoveryCodes.length; i++) {
    const storedBuffer = Buffer.from(recoveryCodes[i], 'hex');
    if (codeBuffer.length === storedBuffer.length && crypto.timingSafeEqual(codeBuffer, storedBuffer)) {
      foundIdx = i;
      // Don't break — continue checking all codes to maintain constant time
    }
  }
  return foundIdx;
}

export const FORGOT_PW_WINDOW_SECS = 60;
export const FORGOT_PW_MAX_PER_EMAIL = 3;
