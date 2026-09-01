'use strict';

module.exports = {
  id:           'service-desk',
  name:         'Mesa de Servicio',
  itilPractice: 'Service Desk',
  itilCategory: 'Service Management Practices',
  itilVersion:  'v4',
  apiPrefix:    '/api/itsm',
  description:  'Punto único de contacto entre usuarios y TI: gestión de tickets, SLA, notificaciones y portal de autoservicio.',
  enabled:      true,
  capabilities: ['tickets', 'sla-tracking', 'notifications', 'portal', 'reporting', 'categories'],
  router:       () => require('../../routes/service-management/itsm'),
};
