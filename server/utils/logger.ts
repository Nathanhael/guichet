import pino from 'pino';

// Pretty logging is opt-in via LOG_PRETTY=true. We deliberately do NOT key off
// `NODE_ENV !== 'production'` because the Azure trial runs NODE_ENV=development
// (to bypass prod hardening) but installs only prod dependencies — so
// pino-pretty isn't on the module path and pino crashes at boot. Local docker
// compose sets LOG_PRETTY=true; trial + real prod leave it unset → JSON logs.
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    transport: process.env.LOG_PRETTY === 'true' ? {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        },
    } : undefined,
});

export default logger;
