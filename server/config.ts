import { z } from 'zod/v4';

const configSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:3001,http://client:5173'),
    GDPR_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    AI_USAGE_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
    AUDIT_ARCHIVE_DELAY_DAYS: z.coerce.number().int().positive().default(2),
    RATINGS_COMMENT_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
    COOKIE_DOMAIN: z.string().optional(),
    // Default to true (secure). Set COOKIE_SECURE=false only for local dev (no HTTPS).
    COOKIE_SECURE: z.preprocess(v => v === 'false' || v === '0' ? false : v === 'true' || v === '1' || v === true ? true : v, z.boolean()).default(true),
    PURGE_INTERVAL_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
    SLA_SWEEP_INTERVAL_MS: z.coerce.number().int().min(0).default(60000),
    RECLAIM_TIMEOUT_MINS: z.coerce.number().int().min(0).default(5),
    JWT_SECRET: z.string().min(64, 'JWT_SECRET must be at least 64 characters for HS256 security'),
    ACCESS_TOKEN_EXPIRY: z.string().default('15m'),
    REFRESH_TOKEN_EXPIRY: z.string().default('7d'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    UPLOAD_MAX_SIZE: z.coerce.number().int().positive().default(5 * 1024 * 1024),
    UPLOAD_ALLOWED_TYPES: z.preprocess(
      (val) => (typeof val === 'string' ? val.split(',').map(s => s.trim()) : val),
      z.array(z.string().regex(
        /^(image\/[a-z0-9.+-]+|application\/(pdf|vnd\.openxmlformats-officedocument\.[a-z.]+|vnd\.ms-excel|msword|csv)|text\/(plain|csv))$/,
        'Only image/*, PDF, Office, CSV and text MIME types are allowed'
      )).default([
        'image/png', 'image/jpeg', 'image/webp',
        'application/pdf',
        'text/plain', 'text/csv', 'application/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ])
    ),
    AZURE_STORAGE_CONNECTION_STRING: z.string().optional(),
    AZURE_STORAGE_CONTAINER: z.string().default('uploads'),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    AI_ENABLED: z.coerce.boolean().default(false),
    AI_PROVIDER: z.enum(['azure', 'openai-compatible']).default('azure'),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    AI_BASE_URL: z.string().url().optional(),
    AI_API_KEY: z.string().optional(),
    AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
    AI_KEY_ENCRYPTION_SECRET: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().length(64).regex(/^[0-9a-f]+$/i, 'Must be 64-character hex string').optional(),
    ),
    FIELD_ENCRYPTION_SECRET: z.preprocess(
      (v) => (v === '' ? undefined : v),
      z.string().length(64).regex(/^[0-9a-f]+$/i, 'Must be 64-character hex string').optional(),
    ),
    PLATFORM_ADMIN_EMAIL: z.preprocess(v => v === '' ? undefined : v, z.string().email().optional()),
    // Azure Entra ID (SSO)
    AZURE_AD_TENANT_ID: z.string().optional(),
    AZURE_AD_CLIENT_ID: z.string().optional(),
    AZURE_AD_CLIENT_SECRET: z.string().optional(),
    AZURE_AD_REDIRECT_URI: z.string().url().optional(),
    // CSV list of email domains treated as internal (SSO users from these domains skip invite emails)
    INTERNAL_EMAIL_DOMAINS: z.string().optional().default(''),
    FRONTEND_URL: z.string().url().default('http://localhost:3001'),
    DISABLE_RATE_LIMIT: z.string().default('false').transform(v => v === 'true'),
    NODE_ENV: z.string().default('development'),
    DEMO_MODE: z.preprocess(v => v === 'true' || v === '1' || v === true, z.boolean()).default(false),
});

export type Config = z.infer<typeof configSchema>;

const parseResult = configSchema.safeParse({
    PORT: process.env.PORT,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    GDPR_RETENTION_DAYS: process.env.GDPR_RETENTION_DAYS,
    AI_USAGE_RETENTION_DAYS: process.env.AI_USAGE_RETENTION_DAYS,
    AUDIT_ARCHIVE_DELAY_DAYS: process.env.AUDIT_ARCHIVE_DELAY_DAYS,
    RATINGS_COMMENT_RETENTION_DAYS: process.env.RATINGS_COMMENT_RETENTION_DAYS,
    COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    PURGE_INTERVAL_MS: process.env.PURGE_INTERVAL_MS,
    SLA_SWEEP_INTERVAL_MS: process.env.SLA_SWEEP_INTERVAL_MS,
    RECLAIM_TIMEOUT_MINS: process.env.RECLAIM_TIMEOUT_MINS,
    JWT_SECRET: process.env.JWT_SECRET,
    ACCESS_TOKEN_EXPIRY: process.env.ACCESS_TOKEN_EXPIRY,
    REFRESH_TOKEN_EXPIRY: process.env.REFRESH_TOKEN_EXPIRY,
    LOG_LEVEL: process.env.LOG_LEVEL,
    UPLOAD_MAX_SIZE: process.env.UPLOAD_MAX_SIZE,
    UPLOAD_ALLOWED_TYPES: process.env.UPLOAD_ALLOWED_TYPES,
    AZURE_STORAGE_CONNECTION_STRING: process.env.AZURE_STORAGE_CONNECTION_STRING,
    AZURE_STORAGE_CONTAINER: process.env.AZURE_STORAGE_CONTAINER,
    REDIS_URL: process.env.REDIS_URL,
    AI_ENABLED: process.env.AI_ENABLED,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT,
    AI_KEY_ENCRYPTION_SECRET: process.env.AI_KEY_ENCRYPTION_SECRET,
    FIELD_ENCRYPTION_SECRET: process.env.FIELD_ENCRYPTION_SECRET,
    PLATFORM_ADMIN_EMAIL: process.env.PLATFORM_ADMIN_EMAIL,
    AZURE_AD_TENANT_ID: process.env.AZURE_AD_TENANT_ID,
    AZURE_AD_CLIENT_ID: process.env.AZURE_AD_CLIENT_ID,
    AZURE_AD_CLIENT_SECRET: process.env.AZURE_AD_CLIENT_SECRET,
    AZURE_AD_REDIRECT_URI: process.env.AZURE_AD_REDIRECT_URI,
    INTERNAL_EMAIL_DOMAINS: process.env.INTERNAL_EMAIL_DOMAINS,
    FRONTEND_URL: process.env.FRONTEND_URL,
    DISABLE_RATE_LIMIT: process.env.DISABLE_RATE_LIMIT,
    NODE_ENV: process.env.NODE_ENV,
    DEMO_MODE: process.env.DEMO_MODE,
});

if (!parseResult.success) {
    console.error('FATAL: Invalid environment configuration:');
    for (const issue of parseResult.error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
}

const config: Config = parseResult.data;

// ── Production hardening checks ──────────────────────────────────────────────
if (config.NODE_ENV === 'production') {
    const fatal: string[] = [];
    const warn: string[] = [];

    if (config.DISABLE_RATE_LIMIT)
        fatal.push('DISABLE_RATE_LIMIT is enabled — rate limiting is off');
    if (config.CORS_ORIGIN.includes('localhost'))
        fatal.push('CORS_ORIGIN contains localhost — set to your production domain(s)');
    if (config.FRONTEND_URL.includes('localhost'))
        fatal.push('FRONTEND_URL contains localhost — set to your production URL');
    if (!config.REDIS_URL.includes('@'))
        warn.push('REDIS_URL has no authentication — set a password for production');
    if (!config.COOKIE_DOMAIN)
        warn.push('COOKIE_DOMAIN is not set — cookies will be scoped to the exact hostname, which may cause issues with subdomains. Set to your root domain (e.g., "example.com")');
    if (!config.FIELD_ENCRYPTION_SECRET && !config.AI_KEY_ENCRYPTION_SECRET && config.AI_ENABLED)
        fatal.push('FIELD_ENCRYPTION_SECRET (or AI_KEY_ENCRYPTION_SECRET) is not set but AI_ENABLED is true — partner API keys would be stored unencrypted. Generate one with: openssl rand -hex 32');
    if (!config.FIELD_ENCRYPTION_SECRET && !config.AI_KEY_ENCRYPTION_SECRET && !config.AI_ENABLED)
        warn.push('FIELD_ENCRYPTION_SECRET (or AI_KEY_ENCRYPTION_SECRET) is not set — if AI is enabled later, partner API keys will not be encrypted at rest');
    if (
        config.FIELD_ENCRYPTION_SECRET &&
        config.AI_KEY_ENCRYPTION_SECRET &&
        config.FIELD_ENCRYPTION_SECRET !== config.AI_KEY_ENCRYPTION_SECRET
    )
        fatal.push('FIELD_ENCRYPTION_SECRET and AI_KEY_ENCRYPTION_SECRET are both set but differ — the encryption service prefers FIELD_ENCRYPTION_SECRET, so data encrypted with AI_KEY_ENCRYPTION_SECRET will be undecryptable. Unset one, or align both to the same value.');
    if (!config.COOKIE_SECURE)
        fatal.push('COOKIE_SECURE is false — cookies will not be sent over HTTPS');
    if (config.DEMO_MODE)
        fatal.push('DEMO_MODE is enabled — demo credentials are exposed on public endpoints');

    for (const w of warn) console.warn(`⚠ PRODUCTION WARNING: ${w}`);
    if (fatal.length) {
        for (const f of fatal) console.error(`✖ FATAL: ${f}`);
        process.exit(1);
    }
}

export default config;
