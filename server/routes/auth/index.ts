import express from 'express';
import logger from '../../utils/logger.js';
import { registerLoginRoutes } from './login.js';
import { registerPasswordRoutes } from './password.js';
import { registerSessionRoutes } from './session.js';

const router = express.Router();
logger.info('[Auth] Routes file loaded');

registerPasswordRoutes(router);
registerLoginRoutes(router);
registerSessionRoutes(router);

export default router;
