import { z } from 'zod/v4';

const configSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    CORS_ORIGIN: z.string().default('http://localhost:5173,http://localhost:3001,http://client:5173'),
    OLLAMA_HOST: z.string().url().default('http://host.docker.internal:11434'),
    BUSINESS_HOURS_START: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').default('07:30'),
    BUSINESS_HOURS_END: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').default('22:30'),
    SLA_THRESHOLD_MS: z.coerce.number().int().positive().default(180000),
    GDPR_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    AUDIT_ARCHIVE_DELAY_DAYS: z.coerce.number().int().positive().default(2),
    COOKIE_DOMAIN: z.string().optional(),
    // Default to true (secure). Set COOKIE_SECURE=false only for local dev (no HTTPS).
    COOKIE_SECURE: z.preprocess(v => v === 'false' || v === '0' ? false : v === 'true' || v === '1' || v === true ? true : v, z.boolean()).default(true),
    PURGE_INTERVAL_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters for security'),
    JWT_EXPIRY: z.string().default('24h'),
    MAX_EXPERTS_SHOWN: z.coerce.number().int().positive().default(8),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    UPLOAD_MAX_SIZE: z.coerce.number().int().positive().default(5 * 1024 * 1024),
    UPLOAD_ALLOWED_TYPES: z.preprocess(
      (val) => (typeof val === 'string' ? val.split(',').map(s => s.trim()) : val),
      z.array(z.string()).default(['image/png', 'image/jpeg', 'image/webp'])
    ),
    OLLAMA_MODEL: z.string().default('translategemma:4b'),
    METRICS_TOKEN: z.string().optional(),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    AI_ENABLED: z.coerce.boolean().default(false),
    AI_PROVIDER: z.enum(['ollama', 'azure', 'openai-compatible', 'gemini', 'anthropic']).default('ollama'),
    AI_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
    OLLAMA_KEEPALIVE: z.string().default('30m'),
    AI_BASE_URL: z.string().url().optional(),
    AI_API_KEY: z.string().optional(),
    AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
    PLATFORM_ADMIN_EMAIL: z.preprocess(v => v === '' ? undefined : v, z.string().email().optional()),
    PLATFORM_ADMIN_PASSWORD: z.preprocess(v => v === '' ? undefined : v, z.string().min(8).optional()),
    REQUIRE_PLATFORM_STEP_UP: z.preprocess(v => v === 'true' || v === '1' || v === true, z.boolean()).default(false),
    PLATFORM_STEP_UP_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
    // Azure Entra ID (SSO)
    AZURE_AD_TENANT_ID: z.string().optional(),
    AZURE_AD_CLIENT_ID: z.string().optional(),
    AZURE_AD_CLIENT_SECRET: z.string().optional(),
    AZURE_AD_REDIRECT_URI: z.string().url().optional(),
});

export type Config = z.infer<typeof configSchema>;

const parseResult = configSchema.safeParse({
    PORT: process.env.PORT,
    CORS_ORIGIN: process.env.CORS_ORIGIN,
    OLLAMA_HOST: process.env.OLLAMA_HOST,
    BUSINESS_HOURS_START: process.env.BUSINESS_HOURS_START,
    BUSINESS_HOURS_END: process.env.BUSINESS_HOURS_END,
    SLA_THRESHOLD_MS: process.env.SLA_THRESHOLD_MS,
    GDPR_RETENTION_DAYS: process.env.GDPR_RETENTION_DAYS,
    AUDIT_ARCHIVE_DELAY_DAYS: process.env.AUDIT_ARCHIVE_DELAY_DAYS,
    COOKIE_DOMAIN: process.env.COOKIE_DOMAIN,
    COOKIE_SECURE: process.env.COOKIE_SECURE,
    PURGE_INTERVAL_MS: process.env.PURGE_INTERVAL_MS,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRY: process.env.JWT_EXPIRY,
    MAX_EXPERTS_SHOWN: process.env.MAX_EXPERTS_SHOWN,
    LOG_LEVEL: process.env.LOG_LEVEL,
    UPLOAD_MAX_SIZE: process.env.UPLOAD_MAX_SIZE,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    METRICS_TOKEN: process.env.METRICS_TOKEN,
    REDIS_URL: process.env.REDIS_URL,
    AI_ENABLED: process.env.AI_ENABLED,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_TIMEOUT_MS: process.env.AI_TIMEOUT_MS,
    OLLAMA_KEEPALIVE: process.env.OLLAMA_KEEPALIVE,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT,
    PLATFORM_ADMIN_EMAIL: process.env.PLATFORM_ADMIN_EMAIL,
    PLATFORM_ADMIN_PASSWORD: process.env.PLATFORM_ADMIN_PASSWORD,
    REQUIRE_PLATFORM_STEP_UP: process.env.REQUIRE_PLATFORM_STEP_UP,
    PLATFORM_STEP_UP_WINDOW_MINUTES: process.env.PLATFORM_STEP_UP_WINDOW_MINUTES,
    AZURE_AD_TENANT_ID: process.env.AZURE_AD_TENANT_ID,
    AZURE_AD_CLIENT_ID: process.env.AZURE_AD_CLIENT_ID,
    AZURE_AD_CLIENT_SECRET: process.env.AZURE_AD_CLIENT_SECRET,
    AZURE_AD_REDIRECT_URI: process.env.AZURE_AD_REDIRECT_URI,
});

if (!parseResult.success) {
    console.error('FATAL: Invalid environment configuration:');
    for (const issue of parseResult.error.issues) {
        console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
}

const config: Config = parseResult.data;

export default config;
