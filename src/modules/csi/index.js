'use strict';

module.exports = {
  id:           'csi',
  name:         'Mejora Continua del Servicio',
  itilPractice: 'Continual Improvement',
  itilCategory: 'General Management Practices',
  itilVersion:  'v4',
  apiPrefix:    '/api/csi',
  description:  'Registro y seguimiento de iniciativas de mejora continua alineadas con objetivos de negocio y métricas ITIL.',
  enabled:      true,
  capabilities: ['create', 'read', 'update', 'delete', 'kpis', 'initiatives'],
  router:       () => require('../../routes/analytics/csi'),
};
