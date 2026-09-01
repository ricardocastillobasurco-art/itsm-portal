const express = require('express');
const router = express.Router();

// ============================================================================
// IMPORTS DE RUTAS — por dominio
// ============================================================================

// Platform
const authRoutes            = require('./platform/auth');
const permissionsRoutes     = require('./platform/permissions');
const employeesRoutes       = require('./platform/employees');
const businessRulesRouter   = require('./platform/business-rules');
const licensesRouter        = require('./platform/licenses');
const tenantGraphRouter     = require('./platform/tenant-graph');
const dataCenterRouter      = require('./platform/data-center');

// Asset Management
const equipmentRoutes       = require('./asset-management/equipment');
const assignmentsRoutes     = require('./asset-management/assignments');
const locationsRoutes       = require('./asset-management/locations');
const departmentsRoutes     = require('./asset-management/departments');
const recoveriesRouter      = require('./asset-management/recoveries');
const almacenRouter         = require('./asset-management/almacen');
const warrantyRouter        = require('./asset-management/warranty');
const soporteRouter         = require('./asset-management/soporte');
const cmdbRouter            = require('./asset-management/cmdb');

// Service Management (ITSM core)
const itsmRouter            = require('./service-management/itsm');
const changesRouter         = require('./service-management/changes');
const problemsRouter        = require('./service-management/problems');
const printQueueRouter      = require('./service-management/print-queue');

// Service Operations
const serviceRequestsRouter = require('./service-operations/service-requests');
const catalogRouter         = require('./service-operations/catalog');

// Experience
const portalRouter          = require('./experience/portal');
const knowledgeBaseRouter   = require('./experience/knowledge-base');
const faqRouter             = require('./experience/faq');
const notificationsRouter   = require('./experience/notifications');
const chatbotRouter         = require('./experience/chatbot');

// Analytics
const dashboardRoutes       = require('./analytics/dashboard');
const dashboardStatsRouter  = require('./analytics/dashboard-stats');
const dashboardGraphsRouter = require('./analytics/dashboard-graphs');
const indicatorsRouter      = require('./analytics/indicators');
const csiRouter             = require('./analytics/csi');
const reportsRouter         = require('./analytics/reports');
const reportsItsmRouter     = require('./analytics/reports-itsm');
const reportListsRouter     = require('./analytics/report-lists');

// Integrations
const integracionesRouter   = require('./platform/integrations');
const jiraRoutes            = require('./jira');
const outlookSyncRouter     = require('./integrations/outlook-sync');
const adRouter              = require('./integrations/ad');
const herramientasRouter    = require('./integrations/herramientas');
const msGraphRouter         = require('./integrations/ms-graph');
const rmmRouter             = require('./integrations/meshcentral');

// Rate Limiter para login — configurable vía LOGIN_RATE_LIMIT en .env
const rateLimit = require('express-rate-limit');
const loginLimiter = rateLimit({
    windowMs:        parseInt(process.env.LOGIN_RATE_WINDOW_MS  || String(15 * 60 * 1000)),
    max:             parseInt(process.env.LOGIN_RATE_LIMIT      || (process.env.NODE_ENV === 'production' ? 5 : 9999)),
    message:         'Demasiados intentos de login. Intenta de nuevo en 15 minutos.',
    standardHeaders: true,
    legacyHeaders:   false,
});

// ============================================================================
// REGISTRO DE RUTAS
// ============================================================================

// Platform
router.use('/auth',           loginLimiter, authRoutes);
router.use('/permissions',    permissionsRoutes);
router.use('/employees',      employeesRoutes);
router.use('/business-rules', businessRulesRouter);
router.use('/licenses',       licensesRouter);
router.use('/tenant-graph',   tenantGraphRouter);
router.use('/data-center',    dataCenterRouter);

// Asset Management
router.use('/equipment',      equipmentRoutes);
router.use('/locations',      locationsRoutes);
router.use('/departments',    departmentsRoutes);
router.use('/assignments',    assignmentsRoutes);
router.use('/recoveries',     recoveriesRouter);
router.use('/almacen',        almacenRouter);
router.use('/warranty',       warrantyRouter);
router.use('/soporte',        soporteRouter);
router.use('/cmdb',           cmdbRouter);

// Service Management
router.use('/itsm',           itsmRouter);
router.use('/changes',        changesRouter);
router.use('/problems',       problemsRouter);
router.use('/print-queue',    printQueueRouter);

// Service Operations
router.use('/service-requests', serviceRequestsRouter);
router.use('/catalog',          catalogRouter);

// Experience
router.use('/portal',         portalRouter);
router.use('/kb',             knowledgeBaseRouter);
router.use('/faq',            faqRouter);
router.use('/notifications',  notificationsRouter);
router.use('/chatbot',        chatbotRouter);

// Analytics
router.use('/dashboard',      dashboardRoutes);
router.use('/dashboard',      dashboardStatsRouter);
router.use('/dashboard',      dashboardGraphsRouter);
router.use('/indicators',     indicatorsRouter);
router.use('/csi',            csiRouter);
router.use('/reports',        reportsRouter);
router.use('/mailer',         reportsRouter);
router.use('/reports-itsm',   reportsItsmRouter);
router.use('/report-lists',   reportListsRouter);

// Integrations
router.use('/integraciones',  integracionesRouter);
router.use('/jira',           jiraRoutes);
router.use('/outlook-sync',   outlookSyncRouter);
router.use('/ad',             adRouter);
router.use('/herramientas',   herramientasRouter);
router.use('/ms',             msGraphRouter);
router.use('/rmm',            rmmRouter);

// ============================================================================
// ITIL v4 MODULE REGISTRY
// ============================================================================
const modules = require('../src/modules');

router.get('/modules', (req, res) => {
    const list = modules.enabled().map(({ id, name, itilPractice, itilCategory, itilVersion, apiPrefix, description, capabilities, enabled }) => ({
        id, name, itilPractice, itilCategory, itilVersion, apiPrefix, description, capabilities, enabled,
    }));
    res.json({ success: true, data: list, total: list.length });
});

// ============================================================================
// FEATURE FLAGS
// ============================================================================
const { getFeatureMap } = require('../src/utils/featureFlags');

router.get('/features', (req, res) => {
    res.json({ success: true, data: getFeatureMap(req), tenant: req.tenant?.slug ?? 'default' });
});

// Info general de la API
const { optionalAuth } = require('../middleware/auth');
router.get('/', optionalAuth, (req, res) => {
    res.json({
        message:       'API REST - Equipment Management System',
        version:       '1.0.0',
        authenticated: !!req.user,
        endpoints: {
            auth:        '/api/auth',
            employees:   '/api/employees',
            equipment:   '/api/equipment',
            assignments: '/api/assignments',
            dashboard:   '/api/dashboard',
            locations:   '/api/locations',
            departments: '/api/departments',
            recoveries:  '/api/recoveries',
            almacen:     '/api/almacen',
            ad:          '/api/ad',
            soporte:     '/api/soporte',
            sccm:        '/api/outlook-sync',
        },
    });
});

// Configuración del cliente
router.get('/config', (req, res) => {
    res.json({
        apiUrl:   process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
        version:  '1.0.0',
        features: { authentication: true, roleBasedAccess: true, auditLog: true },
    });
});

module.exports = router;
