import argon2 from 'argon2';
import { COMMON_PASSWORDS } from './commonPasswords.js';

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

/** Max number of previous password hashes to retain for reuse prevention */
export const PASSWORD_HISTORY_LIMIT = 5;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password);
}

// ─── Password strength validation ────────────────────────────────────────────

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates password strength against security policy.
 * Rules:
 *   - Minimum 10 characters
 *   - At least 1 uppercase letter
 *   - At least 1 lowercase letter
 *   - At least 1 digit
 *   - At least 1 special character
 *   - Not in common password list
 *   - Does not contain user's email prefix or name
 */
export function validatePasswordStrength(
  password: string,
  context?: { email?: string; name?: string }
): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length > 128) {
    errors.push('Password must not exceed 128 characters');
  }
  if (password.length < 10) {
    errors.push('Password must be at least 10 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one digit');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    errors.push('Password is too common');
  }

  // Context-aware checks
  if (context?.email) {
    const emailPrefix = context.email.split('@')[0]?.toLowerCase();
    if (emailPrefix && emailPrefix.length >= 3 && password.toLowerCase().includes(emailPrefix)) {
      errors.push('Password must not contain your email address');
    }
  }
  if (context?.name) {
    const nameLower = context.name.toLowerCase();
    if (nameLower.length >= 3 && password.toLowerCase().includes(nameLower)) {
      errors.push('Password must not contain your name');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Checks if a password was used in the user's recent password history.
 * @param password - The new plaintext password
 * @param history - Array of previous argon2 hashes (most recent first)
 * @returns true if the password matches any hash in history
 */
export async function isPasswordReused(password: string, history: string[]): Promise<boolean> {
  for (const hash of history.slice(0, PASSWORD_HISTORY_LIMIT)) {
    try {
      if (await argon2.verify(hash, password)) return true;
    } catch {
      // Skip malformed hashes
    }
  }
  return false;
}
