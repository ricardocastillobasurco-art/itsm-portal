'use strict';

const client = require('prom-client');

// Un único registro global — exportado como singleton
const registry = new client.Registry();

// Métricas de proceso por defecto (CPU, memoria, event loop lag, etc.)
client.collectDefaultMetrics({ register: registry, prefix: 'itsm_' });

// ── HTTP ──────────────────────────────────────────────────────────────────────

const httpRequestDuration = new client.Histogram({
  name:       'itsm_http_request_duration_seconds',
  help:       'Duración de requests HTTP en segundos',
  labelNames: ['method', 'route', 'status_code', 'tenant'],
  buckets:    [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
  registers:  [registry],
});

const httpRequestTotal = new client.Counter({
  name:       'itsm_http_requests_total',
  help:       'Total de requests HTTP',
  labelNames: ['method', 'route', 'status_code', 'tenant'],
  registers:  [registry],
});

const httpErrorsTotal = new client.Counter({
  name:       'itsm_http_errors_total',
  help:       'Total de errores HTTP (4xx y 5xx)',
  labelNames: ['method', 'route', 'status_code', 'tenant'],
  registers:  [registry],
});

// ── Negocio / ITSM ────────────────────────────────────────────────────────────

const ticketsCreatedTotal = new client.Counter({
  name:       'itsm_tickets_created_total',
  help:       'Total de tickets creados',
  labelNames: ['tenant', 'tipo', 'priority'],
  registers:  [registry],
});

const ticketsResolvedTotal = new client.Counter({
  name:       'itsm_tickets_resolved_total',
  help:       'Total de tickets resueltos',
  labelNames: ['tenant'],
  registers:  [registry],
});

const slaBreachesTotal = new client.Counter({
  name:       'itsm_sla_breaches_total',
  help:       'Total de tickets que superaron el SLA',
  labelNames: ['tenant', 'priority'],
  registers:  [registry],
});

const openTicketsGauge = new client.Gauge({
  name:       'itsm_open_tickets',
  help:       'Tickets abiertos en este momento',
  labelNames: ['tenant'],
  registers:  [registry],
});

const changesCreatedTotal = new client.Counter({
  name:       'itsm_changes_created_total',
  help:       'Total de cambios creados',
  labelNames: ['tenant', 'type'],
  registers:  [registry],
});

const aiClassificationsTotal = new client.Counter({
  name:       'itsm_ai_classifications_total',
  help:       'Total de tickets clasificados por IA',
  labelNames: ['tenant', 'success'],
  registers:  [registry],
});

const aiRequestDuration = new client.Histogram({
  name:       'itsm_ai_request_duration_seconds',
  help:       'Duración de llamadas al proveedor de IA',
  labelNames: ['operation'],
  buckets:    [0.5, 1, 2, 5, 10, 20],
  registers:  [registry],
});

module.exports = {
  registry,
  metrics: {
    httpRequestDuration,
    httpRequestTotal,
    httpErrorsTotal,
    ticketsCreatedTotal,
    ticketsResolvedTotal,
    slaBreachesTotal,
    openTicketsGauge,
    changesCreatedTotal,
    aiClassificationsTotal,
    aiRequestDuration,
  },
};
