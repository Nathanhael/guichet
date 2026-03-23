/**
 * Centralized email templates for Tessera.
 * All templates follow the strict B&W design system.
 */

interface BrandContext {
  partnerName?: string;
  logoUrl?: string;
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
  const title = brand?.partnerName ? `${escapeHtml(brand.partnerName)} — Tessera` : 'Tessera';
  const logo = brand?.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.partnerName || 'Logo')}" style="max-height: 40px; margin-bottom: 10px;" />`
    : '';

  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; border: 2px solid #000; padding: 40px; color: #000; background: #fff;">
      ${logo}
      <h1 style="text-transform: uppercase; letter-spacing: -0.05em; font-weight: 900; margin-top: 0; font-size: 22px;">${escapeHtml(title)}</h1>
      ${content}
      <hr style="border: none; border-top: 1px solid #ddd; margin: 30px 0 15px;" />
      <p style="font-size: 10px; font-weight: bold; text-transform: uppercase; opacity: 0.4; margin: 0;">Tessera Platform Infrastructure</p>
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
    <p>We received a request to reset your password for your Tessera account.</p>
    ${button('Reset Password', opts.resetLink)}
    <p style="font-size: 12px; opacity: 0.6;">If you didn't request this, you can safely ignore this email. This link will expire in 1 hour.</p>
  `, opts.brand);
}

export function renderInviteNew(opts: {
  name: string;
  partnerName: string;
  tempPassword?: string;
  isLocal: boolean;
  loginUrl: string;
  brand?: BrandContext;
}): string {
  const credBlock = opts.isLocal && opts.tempPassword ? `
    <div style="background: #f4f4f4; padding: 20px; margin: 20px 0;">
      <p style="margin-top: 0; font-weight: bold; text-transform: uppercase; font-size: 12px;">Your Temporary Password</p>
      <code style="font-size: 18px; font-weight: 900; letter-spacing: 0.05em;">${escapeHtml(opts.tempPassword)}</code>
    </div>
  ` : '<p>Please sign in using your corporate Microsoft account.</p>';

  return baseLayout(`
    <p>Hello ${escapeHtml(opts.name)},</p>
    <p>Welcome to Tessera! You have been invited to join <strong>${escapeHtml(opts.partnerName)}</strong>.</p>
    ${credBlock}
    ${button('Sign In Now', opts.loginUrl)}
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
    <p>You have been granted access to <strong>${escapeHtml(opts.partnerName)}</strong> on the Tessera platform.</p>
    <p>You can sign in using your existing credentials.</p>
    ${button('Sign In Now', opts.loginUrl)}
  `, opts.brand);
}

export function renderInviteReminder(opts: {
  name: string;
  partnerName: string;
  tempPassword?: string;
  loginUrl: string;
  brand?: BrandContext;
}): string {
  const credBlock = opts.tempPassword ? `
    <div style="background: #f4f4f4; padding: 20px; margin: 20px 0;">
      <p style="margin-top: 0; font-weight: bold; text-transform: uppercase; font-size: 12px;">Your Temporary Password</p>
      <code style="font-size: 18px; font-weight: 900; letter-spacing: 0.05em;">${escapeHtml(opts.tempPassword)}</code>
    </div>
  ` : '<p>Please sign in using your existing credentials or corporate Microsoft account.</p>';

  return baseLayout(`
    <p>Hello ${escapeHtml(opts.name)},</p>
    <p>This is a reminder of your invitation to join <strong>${escapeHtml(opts.partnerName)}</strong> on Tessera.</p>
    ${credBlock}
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
    <p>Two-factor authentication has been successfully enabled on your Tessera account.</p>
    <p>From now on, you will need your authenticator app to sign in.</p>
    <p style="font-size: 12px; opacity: 0.6;">If you didn't do this, contact your administrator immediately.</p>
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
