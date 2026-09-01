'use strict';

const crypto      = require('crypto');
const ApiResponse = require('../src/utils/response');
const logger      = require('../utils/logger');

module.exports = function setupErrorHandlers(app) {
  // 404 — Ruta no encontrada
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({
        ...ApiResponse.error('Endpoint no encontrado', 'NOT_FOUND'),
        error: 'Endpoint no encontrado',
        path:  req.originalUrl,
      });
    }
    res.status(404).render('404', {
      requestedPath: req.originalUrl,
      user: req.user || null,
    });
  });

  // 500 — Error global
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    const errorId    = crypto.randomBytes(4).toString('hex');
    const statusCode = err.statusCode || err.status || 500;
    const message    = err.isOperational ? err.message : 'Error interno del servidor';
    const code       = err.code || 'INTERNAL_ERROR';

    logger.error('unhandled_error', {
      error_id:  errorId,
      req_id:    req.id ?? null,
      method:    req.method,
      path:      req.originalUrl,
      status:    statusCode,
      tenant:    req.tenant?.slug ?? 'default',
      user_id:   req.user?.id    ?? null,
      message:   err.message,
      stack:     err.stack,
    });

    if (req.path.startsWith('/api/')) {
      return res.status(statusCode).json({
        ...ApiResponse.error(message, code),
        error:    message,
        error_id: errorId,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
      });
    }

    res.status(statusCode).render('error', {
      title:    'Error del servidor',
      error:    message,
      error_id: errorId,
      user:     req.user || null,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  });
};
