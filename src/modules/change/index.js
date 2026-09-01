'use strict';

module.exports = {
  id:           'change',
  name:         'Gestión de Cambios',
  itilPractice: 'Change Enablement',
  itilCategory: 'Service Management Practices',
  itilVersion:  'v4',
  apiPrefix:    '/api/changes',
  description:  'Planificación, aprobación y control de cambios en la infraestructura y servicios de TI para minimizar el riesgo.',
  enabled:      true,
  capabilities: ['create', 'read', 'update', 'delete', 'approve', 'schedule', 'cab'],
  router:       () => require('./routes'),
};
