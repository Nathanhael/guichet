/**
 * Centralized email templates.
 * All templates follow the strict B&W design system.
 */

import { APP_NAME } from '../constants.js';

interface BrandContext {
  partnerName?: string;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function baseLayout(content: string, brand?: BrandContext): string {
  const title = brand?.partnerName ? `${escapeHtml(brand.partnerName)} — ${APP_NAME}` : APP_NAME;

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #000; padding: 40px; color: #000; background: #fff;">
      <h1 style="text-transform: uppercase; letter-spacing: -0.05em; font-weight: 900; margin-top: 0; font-size: 22px;">${escapeHtml(title)}</h1>
      ${content}
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0 15px;" />
      <p style="font-size: 10px; font-weight: bold; text-transform: uppercase; opacity: 0.4; margin: 0;">${APP_NAME} Platform Infrastructure</p>
    </div>
  `;
}

function button(text: string, href: string): string {
  return `
    <div style="margin: 30px 0;">
      <a href="${escapeHtml(href)}" style="display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 15px 30px; font-weight: 900; text-transform: uppercase; font-size: 12px; letter-spacing: 0.1em;">${escapeHtml(text)}</a>
    </div>
  `;
}

function heading(text: string): string {
  return `<p style="font-weight: bold; text-transform: uppercase; font-size: 14px; opacity: 0.6;">${escapeHtml(text)}</p>`;
}

function separator(): string {
  return '<hr style="border: none; border-top: 2px solid #000; margin: 20px 0;" />';
}

// ─── Templates ───────────────────────────────────────────────────────────────

export function renderPasswordReset(opts: {
  name: string;
  resetLink: string;
  brand?: BrandContext;
}): string {
  return baseLayout(`
    ${heading('Password Reset Request')}
    ${separator()}
    <p>Hello ${escapeHtml(opts.name)},</p>
    <p>We received a request to reset your password for your ${APP_NAME} account.</p>
    ${button('Reset Password', opts.resetLink)}
    <p style="font-size: 12px; opacity: 0.6;">If you didn't request this, you can safely ignore this email. This link will expire in 1 hour.</p>
  `, opts.brand);
}

export function renderInviteExisting(opts: {
  name: string;
  partnerName: string;
  loginUrl: string;
  brand?: BrandContext;
}): string {
  return baseLayout(`
    <p>Hello ${escapeHtml(opts.name)},</p>
    <p>You have been granted access to <strong>${escapeHtml(opts.partnerName)}</strong> on the ${APP_NAME} platform.</p>
    <p>You can sign in using your existing credentials.</p>
    ${button('Sign In Now', opts.loginUrl)}
  `, opts.brand);
}

export function renderInviteReminder(opts: {
  name: string;
  partnerName: string;
  loginUrl: string;
  brand?: BrandContext;
}): string {
  return baseLayout(`
    <p>Hello ${escapeHtml(opts.name)},</p>
    <p>This is a reminder of your invitation to join <strong>${escapeHtml(opts.partnerName)}</strong> on ${APP_NAME}.</p>
    <p>Please sign in using your existing credentials or corporate Microsoft account.</p>
    ${button('Sign In Now', opts.loginUrl)}
  `, opts.brand);
}

export function renderAccountLocked(opts: {
  name: string;
  lockedMinutes: number;
  brand?: BrandContext;
}): string {
  return baseLayout(`
    ${heading('Security Alert')}
    ${separator()}
    <p>Hello ${escapeHtml(opts.name)},</p>
    <p>Your account has been temporarily locked due to multiple failed login attempts.</p>
    <p>The lock will automatically expire in <strong>${opts.lockedMinutes} minutes</strong>.</p>
    <p style="font-size: 12px; opacity: 0.6;">If this wasn't you, please reset your password immediately after the lockout expires.</p>
  `, opts.brand);
}

export function renderMfaEnabled(opts: {
  name: string;
  brand?: BrandContext;
}): string {
  return baseLayout(`
    ${heading('MFA Enabled')}
    ${separator()}
    <p>Hello ${escapeHtml(opts.name)},</p>
    <p>Two-factor authentication has been successfully enabled on your ${APP_NAME} account.</p>
    <p>From now on, you will need your authenticator app to sign in.</p>
    <p style="font-size: 12px; opacity: 0.6;">If you didn't do this, contact your administrator immediately.</p>
  `, opts.brand);
}

export function renderMfaDisabledByAdmin(opts: {
  name: string;
  brand?: BrandContext;
}): string {
  return baseLayout(`
    ${heading('MFA Disabled by Administrator')}
    ${separator()}
    <p>Hello ${escapeHtml(opts.name)},</p>
    <p>A platform administrator has disabled two-factor authentication on your ${APP_NAME} account.</p>
    <p>Your account is now accessible with your password only. We strongly recommend re-enabling MFA at your earliest convenience.</p>
    <p style="font-size: 12px; opacity: 0.6;">If you did not request this change, contact your administrator immediately.</p>
  `, opts.brand);
}

export function renderAccountUnlocked(opts: {
  name: string;
  brand?: BrandContext;
}): string {
  return baseLayout(`
    ${heading('Account Unlocked')}
    ${separator()}
    <p>Hello ${escapeHtml(opts.name)},</p>
    <p>A platform administrator has unlocked your ${APP_NAME} account. You can now sign in again.</p>
    <p style="font-size: 12px; opacity: 0.6;">If your account was locked due to suspicious activity, we recommend changing your password immediately.</p>
  `, opts.brand);
}

export function renderTestEmail(opts: {
  operatorId: string;
  timestamp: string;
}): string {
  return baseLayout(`
    ${heading('System Test Email')}
    ${separator()}
    <p>This is a test email to verify your platform's mail configuration.</p>
    <p style="font-size: 12px; margin-top: 40px;">Sent by operator ${escapeHtml(opts.operatorId)} at ${escapeHtml(opts.timestamp)}</p>
  `);
}
