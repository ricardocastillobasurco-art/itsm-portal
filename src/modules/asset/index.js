'use strict';

module.exports = {
  id:           'asset',
  name:         'Gestión de Activos y Configuración (CMDB)',
  itilPractice: 'IT Asset Management',
  itilCategory: 'Service Management Practices',
  itilVersion:  'v4',
  apiPrefix:    '/api/cmdb',
  description:  'Inventario y control de activos de TI, elementos de configuración (CI) y sus relaciones en la CMDB.',
  enabled:      true,
  capabilities: ['create', 'read', 'update', 'delete', 'relationships', 'ci-types', 'discovery'],
  router:       () => require('./routes'),
};
