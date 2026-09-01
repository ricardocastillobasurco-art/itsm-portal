'use strict';

module.exports = {
  id:           'service-request',
  name:         'Gestión de Solicitudes de Servicio',
  itilPractice: 'Service Request Management',
  itilCategory: 'Service Management Practices',
  itilVersion:  'v4',
  apiPrefix:    '/api/service-requests',
  description:  'Gestión del ciclo de vida de las solicitudes de servicio, incluyendo aprobaciones, catálogo y flujos de trabajo.',
  enabled:      true,
  capabilities: ['create', 'read', 'update', 'approve', 'catalog', 'software', 'notify'],
  router:       () => require('./routes'),
};
