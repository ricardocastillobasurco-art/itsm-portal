'use strict';

const { metrics } = require('../../core/metrics/MetricsRegistry');

// Rutas a ignorar para no contaminar métricas con ruido de infra
const SKIP_PATHS = new Set(['/health', '/health/live', '/health/ready', '/metrics', '/favicon.ico']);

// Normaliza rutas con parámetros dinámicos para agrupar en Prometheus
// /api/tickets/abc123 → /api/tickets/:id
function normalizePath(path) {
  return path
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '/:id')   // UUID
    .replace(/\/[0-9a-f]{24}/gi, '/:id')                   // ObjectId
    .replace(/\/\d+/g, '/:id')                             // numérico
    .split('?')[0];                                         // quita query string
}

module.exports = function httpMetrics(req, res, next) {
  const path = req.path || '';
  if (SKIP_PATHS.has(path) || path.startsWith('/public/') || path.startsWith('/uploads/')) {
    return next();
  }

  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
    const route       = normalizePath(req.originalUrl || path);
    const status      = String(res.statusCode);
    const tenant      = req.tenant?.slug ?? 'default';
    const labels      = { method: req.method, route, status_code: status, tenant };

    metrics.httpRequestDuration.observe(labels, durationSec);
    metrics.httpRequestTotal.inc(labels);

    if (res.statusCode >= 400) {
      metrics.httpErrorsTotal.inc(labels);
    }
  });

  next();
};
