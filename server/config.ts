

export interface Config {
    PORT: number | string;
    CORS_ORIGIN: string;
    OLLAMA_HOST: string;
    BUSINESS_HOURS_START: string;
    BUSINESS_HOURS_END: string;
    SLA_THRESHOLD_MS: number;
    GDPR_RETENTION_DAYS: number;
    PURGE_INTERVAL_MS: number;
    JWT_SECRET: string;
    JWT_EXPIRY: string;
    MAX_EXPERTS_SHOWN: number;
    LOG_LEVEL: string;
    UPLOAD_MAX_SIZE: number;
    UPLOAD_ALLOWED_TYPES: string[];
    OLLAMA_MODEL?: string;
}

const config: Config = {
    PORT: process.env.PORT || 3001,
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
    OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://host.docker.internal:11434',
    BUSINESS_HOURS_START: process.env.BUSINESS_HOURS_START || '07:30',
    BUSINESS_HOURS_END: process.env.BUSINESS_HOURS_END || '22:30',
    SLA_THRESHOLD_MS: Number(process.env.SLA_THRESHOLD_MS) || 180000,
    GDPR_RETENTION_DAYS: Number(process.env.GDPR_RETENTION_DAYS) || 30,
    PURGE_INTERVAL_MS: Number(process.env.PURGE_INTERVAL_MS) || 24 * 60 * 60 * 1000,
    JWT_SECRET: process.env.JWT_SECRET || 'super-secret-key-replace-in-prod',
    JWT_EXPIRY: process.env.JWT_EXPIRY || '24h',
    MAX_EXPERTS_SHOWN: Number(process.env.MAX_EXPERTS_SHOWN) || 8,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    UPLOAD_MAX_SIZE: Number(process.env.UPLOAD_MAX_SIZE) || 5 * 1024 * 1024,
    UPLOAD_ALLOWED_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
    OLLAMA_MODEL: process.env.OLLAMA_MODEL || 'gemmatranslate4b',
};

export default config;
