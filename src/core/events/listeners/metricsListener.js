'use strict';

const { metrics } = require('../../metrics/MetricsRegistry');

module.exports = function registerMetricsListener(bus) {
  bus.on('ticket.created', ({ ticket, tenantId }) => {
    const tenant = String(tenantId ?? 'default');
    metrics.ticketsCreatedTotal.inc({ tenant, tipo: ticket.tipo || 'incidente', priority: ticket.priority || 'P3' });
    metrics.openTicketsGauge.inc({ tenant });
  });

  bus.on('ticket.updated', ({ ticket, prev, tenantId }) => {
    const tenant = String(tenantId ?? 'default');

    // Ticket resuelto/cerrado
    if (['resuelto', 'cerrado'].includes(ticket.status) && !['resuelto', 'cerrado'].includes(prev?.status)) {
      metrics.ticketsResolvedTotal.inc({ tenant });
      metrics.openTicketsGauge.dec({ tenant });
    }

    // SLA vencido
    if (ticket.slaStatus === 'vencido' && prev?.slaStatus !== 'vencido') {
      metrics.slaBreachesTotal.inc({ tenant, priority: ticket.priority || 'P3' });
    }
  });

  bus.on('ticket.deleted', ({ tenantId }) => {
    const tenant = String(tenantId ?? 'default');
    metrics.openTicketsGauge.dec({ tenant });
  });
};
