import nodemailer from 'nodemailer';
import { db } from '../db.js';
import { systemSettings, users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import logger from '../utils/logger.js';
import config from '../config.js';
import { APP_NAME } from '../constants.js';
import { decrypt } from './encryption.js';

export type NotificationType = 'accountLocked' | 'mfaEnabled' | 'mfaDisabled' | 'passwordChanged';

// Runtime shape — fields are plaintext after getConfig() has decrypted the
// stored ciphertext. Never persist this shape; see StoredMailConfig.
export interface MailConfig {
  provider: 'none' | 'smtp' | 'resend' | 'sendgrid';
  apiKey?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPass?: string;
  smtpSecure?: boolean;
  fromEmail: string;
  fromName: string;
}

// On-disk JSONB shape for system_settings.value where key='mail_config'.
// Plaintext `smtpPass` / `apiKey` are kept on the type only for backward-compat
// reading of rows written before this change; nothing writes them anymore.
export interface StoredMailConfig extends Omit<MailConfig, 'smtpPass' | 'apiKey'> {
  encryptedSmtpPass?: string;
  encryptedApiKey?: string;
  /** @deprecated Legacy plaintext — lazy-upgraded on next updateMailConfig. */
  smtpPass?: string;
  /** @deprecated Legacy plaintext — lazy-upgraded on next updateMailConfig. */
  apiKey?: string;
}

export class MailService {
  private static async getConfig(): Promise<MailConfig | null> {
    try {
      const results = await db.select().from(systemSettings).where(eq(systemSettings.key, 'mail_config')).limit(1);
      if (results.length === 0) return null;
      const stored = results[0].value as StoredMailConfig;

      // Copy non-secret fields verbatim.
      const { encryptedSmtpPass, encryptedApiKey, smtpPass: legacySmtpPass, apiKey: legacyApiKey, ...rest } = stored;
      const out: MailConfig = { ...rest } as MailConfig;

      // SMTP password — prefer encrypted, fall back to legacy plaintext.
      if (encryptedSmtpPass) {
        try {
          out.smtpPass = decrypt(encryptedSmtpPass);
        } catch (err) {
          logger.error({ err }, '[MailService] Failed to decrypt smtpPass — disabling mail');
          return null;
        }
      } else if (legacySmtpPass) {
        logger.warn('[MailService] mail_config.smtpPass is stored as plaintext — will be upgraded on next save or at next boot');
        out.smtpPass = legacySmtpPass;
      }

      // Provider API key — same rule.
      if (encryptedApiKey) {
        try {
          out.apiKey = decrypt(encryptedApiKey);
        } catch (err) {
          logger.error({ err }, '[MailService] Failed to decrypt apiKey — disabling mail');
          return null;
        }
      } else if (legacyApiKey) {
        logger.warn('[MailService] mail_config.apiKey is stored as plaintext — will be upgraded on next save or at next boot');
        out.apiKey = legacyApiKey;
      }

      return out;
    } catch (err) {
      logger.error({ err }, '[MailService] Failed to fetch config from DB');
      return null;
    }
  }

  private static async getTransporter(config: MailConfig) {
    if (config.provider === 'smtp') {
      return nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        // When not using implicit TLS (secure: false, typically port 587), require STARTTLS
        // to prevent MITM TLS stripping attacks
        ...(!config.smtpSecure && { requireTLS: true }),
        auth: {
          user: config.smtpUser,
          pass: config.smtpPass,
        },
      });
    } else if (config.provider === 'resend') {
      // Resend provides an SMTP interface or API. For simplicity, we use their SMTP if API not integrated.
      // But usually people want the API. For this 'Clean Slate' we'll stick to SMTP-compatible for now
      // or implement basic fetch for their API.
      return nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        auth: {
          user: 'resend',
          pass: config.apiKey,
        },
      });
    } else if (config.provider === 'sendgrid') {
      return nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        secure: false,
        requireTLS: true, // Force STARTTLS to prevent MITM TLS stripping
        auth: {
          user: 'apikey',
          pass: config.apiKey,
        },
      });
    }
    return null;
  }

  static async sendMail(to: string, subject: string, html: string) {
    const config = await this.getConfig();
    if (!config || config.provider === 'none') {
      logger.warn({ subject }, '[MailService] Mail suppressed: No provider configured');
      return false;
    }

    try {
      const transporter = await this.getTransporter(config);
      if (!transporter) return false;

      const info = await transporter.sendMail({
        from: `"${config.fromName}" <${config.fromEmail}>`,
        to,
        subject,
        html,
      });

      logger.info({ messageId: info.messageId }, '[MailService] Email sent successfully');
      return true;
    } catch (err) {
      logger.error({ err, subject }, '[MailService] Failed to send email');
      return false;
    }
  }

  static async sendPasswordReset(email: string, name: string, token: string, brand?: { partnerName?: string }) {
    const { renderPasswordReset } = await import('./mailTemplates.js');
    const resetLink = `${config.FRONTEND_URL}/reset-password?token=${token}`;
    const html = renderPasswordReset({ name, resetLink, brand });
    return this.sendMail(email, `Reset your ${APP_NAME} Password`, html);
  }

  /** Check if a user has opted out of a notification type. Missing key = opted in (default true). */
  static async shouldNotify(userId: string, notificationType: NotificationType): Promise<boolean> {
    try {
      const rows = await db.select({ prefs: users.notificationPreferences })
        .from(users).where(eq(users.id, userId)).limit(1);
      const prefs = (rows[0]?.prefs ?? {}) as Record<string, boolean>;
      return prefs[notificationType] !== false; // default true when key missing
    } catch {
      return true; // fail-open: send if we can't check
    }
  }

  static async sendAccountLocked(email: string, name: string, lockedMinutes: number, userId?: string) {
    if (userId && !(await this.shouldNotify(userId, 'accountLocked'))) return false;
    const { renderAccountLocked } = await import('./mailTemplates.js');
    const html = renderAccountLocked({ name, lockedMinutes });
    return this.sendMail(email, `${APP_NAME} — Account Temporarily Locked`, html);
  }

  static async sendMfaEnabled(email: string, name: string, userId?: string) {
    if (userId && !(await this.shouldNotify(userId, 'mfaEnabled'))) return false;
    const { renderMfaEnabled } = await import('./mailTemplates.js');
    const html = renderMfaEnabled({ name });
    return this.sendMail(email, `${APP_NAME} — Two-Factor Authentication Enabled`, html);
  }

  static async sendMfaDisabledByAdmin(email: string, name: string, userId?: string) {
    if (userId && !(await this.shouldNotify(userId, 'mfaDisabled'))) return false;
    const { renderMfaDisabledByAdmin } = await import('./mailTemplates.js');
    const html = renderMfaDisabledByAdmin({ name });
    return this.sendMail(email, `${APP_NAME} — Two-Factor Authentication Disabled`, html);
  }

  static async sendAccountUnlocked(email: string, name: string) {
    // Account unlock is always sent (security-critical, no opt-out)
    const { renderAccountUnlocked } = await import('./mailTemplates.js');
    const html = renderAccountUnlocked({ name });
    return this.sendMail(email, `${APP_NAME} — Account Unlocked`, html);
  }
}
