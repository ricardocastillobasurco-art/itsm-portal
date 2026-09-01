'use strict';

const crypto = require('crypto');
const logger = require('../../utils/logger');

/**
 * Structured per-request logger.
 * Adds req.id (8-char hex correlation ID) and logs on response finish:
 *   method, path, status, duration_ms, tenant_slug, user_id, req_id
 *
 * Mount AFTER tenantMiddleware and BEFORE routes so req.tenant is available.
 * For authenticated routes, user_id is populated by authenticateToken (runs later),
 * so it reads req.user at response-finish time — after auth has set it.
 */
module.exports = function requestLogger(req, res, next) {
    req.id            = crypto.randomBytes(4).toString('hex');
    req.correlationId = req.headers['x-correlation-id'] || req.id; // propagado desde llamadas upstream
    req._reqStartAt   = process.hrtime.bigint();

    res.setHeader('X-Request-Id',      req.id);
    res.setHeader('X-Correlation-Id',  req.correlationId);

    res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - req._reqStartAt) / 1e6;

        // Skip noisy health checks and static assets
        const path = req.path || '';
        if (path === '/health' || path.startsWith('/public/') || path.startsWith('/uploads/')) return;

        logger.info('request', {
            req_id:         req.id,
            correlation_id: req.correlationId,
            method:         req.method,
            path:           req.originalUrl,
            status:         res.statusCode,
            duration_ms:    Math.round(durationMs),
            tenant:         req.tenant?.slug  ?? 'default',
            user_id:        req.user?.id      ?? null,
            ip:             req.ip,
        });
    });

    next();
};
