// @ts-ignore nodemailer types may not be installed
import nodemailer from 'nodemailer';
import { db } from '../db.js';
import { systemSettings } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import logger from '../utils/logger.js';

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

export class MailService {
  private static async getConfig(): Promise<MailConfig | null> {
    try {
      const results = await db.select().from(systemSettings).where(eq(systemSettings.key, 'mail_config')).limit(1);
      if (results.length === 0) return null;
      return results[0].value as MailConfig;
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

  static async sendPasswordReset(email: string, name: string, token: string) {
    // In a real app, this would be your frontend URL
    const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:3001'}/reset-password?token=${token}`;
    
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #000; padding: 40px; color: #000;">
        <h1 style="text-transform: uppercase; letter-spacing: -0.05em; font-weight: 900; margin-top: 0;">Tessera</h1>
        <p style="font-weight: bold; text-transform: uppercase; font-size: 14px; opacity: 0.6;">Password Reset Request</p>
        <hr style="border: none; border-top: 2px solid #000; margin: 20px 0;" />
        <p>Hello ${name},</p>
        <p>We received a request to reset your password for your Tessera account.</p>
        <div style="margin: 30px 0;">
          <a href="${resetLink}" style="display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 15px 30px; font-weight: 900; text-transform: uppercase; font-size: 12px; letter-spacing: 0.1em;">Reset Password</a>
        </div>
        <p style="font-size: 12px; opacity: 0.6;">If you didn't request this, you can safely ignore this email. This link will expire in 1 hour.</p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
        <p style="font-size: 10px; font-weight: bold; text-transform: uppercase; opacity: 0.4;">Tessera Platform Infrastructure</p>
      </div>
    `;

    return this.sendMail(email, 'Reset your Tessera Password', html);
  }
}
