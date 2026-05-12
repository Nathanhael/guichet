import express from 'express';
import logger from '../../utils/logger.js';
import { registerSessionRoutes } from './session.js';

const router = express.Router();
logger.info('[Auth] Routes file loaded');

registerSessionRoutes(router);

export default router;
