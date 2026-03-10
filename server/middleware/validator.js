import { validationResult } from 'express-validator';
import logger from '../utils/logger.js';

export const validate = (req, res, next) => {
    const errors = validationResult(req);
    if (errors.isEmpty()) {
        return next();
    }

    const extractedErrors = [];
    errors.array().map(err => extractedErrors.push({ [err.path]: err.msg }));

    logger.warn({ errors: extractedErrors, url: req.url }, 'Validation failed');

    return res.status(400).json({
        errors: extractedErrors,
    });
};
