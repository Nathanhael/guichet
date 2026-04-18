import express from 'express';
import config from '../../config.js';
import logger from '../../utils/logger.js';
import { registerSessionRoutes } from './session.js';
import { registerDevLoginRoutes } from './devLogin.js';

const router = express.Router();
logger.info('[Auth] Routes file loaded');

registerSessionRoutes(router);

// Gate dev-login at mount time so the route literal does not exist in
// production. The in-handler NODE_ENV check stays as defense in depth.
if (config.NODE_ENV !== 'production') {
  registerDevLoginRoutes(router);
}

export default router;
