import { httpServer } from './app.js'; // Updated at 2026-03-10
import config from './config.js';
import logger from './utils/logger.js';

if (process.env.NODE_ENV === 'production' && config.JWT_SECRET === 'super-secret-key-replace-in-prod') {
  logger.fatal('Cannot start server in production with default JWT_SECRET. Please set JWT_SECRET in environment.');
  process.exit(1);
}

const PORT = config.PORT;
httpServer.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
});
