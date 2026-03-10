import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default {
    PORT: process.env.PORT || 3001,
    CORS_ORIGIN: process.env.CORS_ORIGIN || 'http://localhost:5173',
    OLLAMA_HOST: process.env.OLLAMA_HOST || 'http://host.docker.internal:11434',

    // Business Logic
    BUSINESS_HOURS_START: process.env.BUSINESS_HOURS_START || '07:30',
    BUSINESS_HOURS_END: process.env.BUSINESS_HOURS_END || '22:30',
    SLA_THRESHOLD_MS: process.env.SLA_THRESHOLD_MS || 180000, // 3 minutes

    // GDPR & Retention
    GDPR_RETENTION_DAYS: process.env.GDPR_RETENTION_DAYS || 30,
    PURGE_INTERVAL_MS: process.env.PURGE_INTERVAL_MS || 24 * 60 * 60 * 1000, // 24 hours

    // Database
    DB_PATH: process.env.DB_PATH || path.join(__dirname, 'database.sqlite'),

    // Auth
    JWT_SECRET: process.env.JWT_SECRET || 'super-secret-key-replace-in-prod',
    JWT_EXPIRY: process.env.JWT_EXPIRY || '24h',

    // UI / UX
    MAX_EXPERTS_SHOWN: process.env.MAX_EXPERTS_SHOWN || 8,
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',

    // Uploads
    UPLOAD_MAX_SIZE: process.env.UPLOAD_MAX_SIZE || 5 * 1024 * 1024, // 5MB
    UPLOAD_ALLOWED_TYPES: ['image/png', 'image/jpeg', 'image/webp'],
};
