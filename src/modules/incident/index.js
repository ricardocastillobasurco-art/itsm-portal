'use strict';

module.exports = {
  id:           'incident',
  name:         'Gestión de Incidentes',
  itilPractice: 'Incident Management',
  itilCategory: 'Service Management Practices',
  itilVersion:  'v4',
  apiPrefix:    '/api/itsm',
  description:  'Registro, clasificación, priorización y resolución de incidentes de TI para restaurar el servicio normal lo antes posible.',
  enabled:      true,
  capabilities: ['create', 'read', 'update', 'delete', 'comment', 'attach', 'kpis', 'categories'],
  sla: {
    p1: { responseMin: 15,  resolutionHrs: 1  },
    p2: { responseMin: 30,  resolutionHrs: 4  },
    p3: { responseMin: 120, resolutionHrs: 8  },
    p4: { responseMin: 240, resolutionHrs: 24 },
  },
  router: () => require('../tickets/routes'),
};
