'use strict';

module.exports = {
  id:           'problem',
  name:         'Gestión de Problemas',
  itilPractice: 'Problem Management',
  itilCategory: 'Service Management Practices',
  itilVersion:  'v4',
  apiPrefix:    '/api/problems',
  description:  'Identificación y gestión de la causa raíz de incidentes recurrentes y registro de errores conocidos.',
  enabled:      true,
  capabilities: ['create', 'read', 'update', 'delete', 'known-errors', 'rca'],
  router:       () => require('./routes'),
};
