'use strict';

module.exports = {
  id:           'knowledge',
  name:         'Gestión del Conocimiento',
  itilPractice: 'Knowledge Management',
  itilCategory: 'General Management Practices',
  itilVersion:  'v4',
  apiPrefix:    '/api/kb',
  description:  'Creación, mantenimiento y publicación de artículos de conocimiento y base de datos de errores conocidos.',
  enabled:      true,
  capabilities: ['create', 'read', 'update', 'delete', 'search', 'categories', 'faq'],
  router:       () => require('./routes'),
};
