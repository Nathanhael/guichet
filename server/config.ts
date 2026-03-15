import { z } from 'zod/v4';

const configSchema = z.object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    CORS_ORIGIN: z.string()
        .refine((val) => val !== '*' && !val.includes('*'), { message: 'Wildcard CORS origins are not allowed' })
        .default('http://localhost:5173'),
    OLLAMA_HOST: z.string().url().default('http://host.docker.internal:11434'),
    BUSINESS_HOURS_START: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').default('07:30'),
    BUSINESS_HOURS_END: z.string().regex(/^\d{2}:\d{2}$/, 'Must be HH:MM format').default('22:30'),
    SLA_THRESHOLD_MS: z.coerce.number().int().positive().default(180000),
    GDPR_RETENTION_DAYS: z.coerce.number().int().positive().default(30),
    PURGE_INTERVAL_MS: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
    JWT_SECRET: z.string(),
    JWT_EXPIRY: z.string().default('24h'),
    MAX_EXPERTS_SHOWN: z.coerce.number().int().positive().default(8),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    UPLOAD_MAX_SIZE: z.coerce.number().int().positive().default(5 * 1024 * 1024),
    UPLOAD_ALLOWED_TYPES: z.array(z.string()).default(['image/png', 'image/jpeg', 'image/webp']),
    OLLAMA_MODEL: z.string().default('translategemma:4b'),
    METRICS_TOKEN: z.string().optional(),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    AI_PROVIDER: z.enum(['ollama', 'azure', 'openai-compatible', 'gemini', 'anthropic']).default('ollama'),
    AI_BASE_URL: z.string().url().optional(),
    AI_API_KEY: z.string().optional(),
    AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
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
    PURGE_INTERVAL_MS: process.env.PURGE_INTERVAL_MS,
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRY: process.env.JWT_EXPIRY,
    MAX_EXPERTS_SHOWN: process.env.MAX_EXPERTS_SHOWN,
    LOG_LEVEL: process.env.LOG_LEVEL,
    UPLOAD_MAX_SIZE: process.env.UPLOAD_MAX_SIZE,
    OLLAMA_MODEL: process.env.OLLAMA_MODEL,
    METRICS_TOKEN: process.env.METRICS_TOKEN,
    REDIS_URL: process.env.REDIS_URL,
    AI_PROVIDER: process.env.AI_PROVIDER,
    AI_BASE_URL: process.env.AI_BASE_URL,
    AI_API_KEY: process.env.AI_API_KEY,
    AZURE_OPENAI_DEPLOYMENT: process.env.AZURE_OPENAI_DEPLOYMENT,
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
