import { httpServer } from './app.js';
import config from './config.js';
import logger from './utils/logger.js';

if (process.env.NODE_ENV === 'production' && config.JWT_SECRET === 'super-secret-key-replace-in-prod') {
  logger.fatal('Cannot start server in production with default JWT_SECRET. Please set JWT_SECRET in environment.');
  process.exit(1);
}

const PORT = config.PORT || 3001;
const server = httpServer.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
});

// Graceful shutdown
const shutdown = () => {
  logger.info('Graceful shutdown initiated...');
  server.close(() => {
    logger.info('HTTP server closed.');
    // In a real app, you would also close DB connections here if using a pool.
    // Drizzle/pg pool is closed when process exits, but explicit is better.
    process.exit(0);
  });

  // Force exit after 10s
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
