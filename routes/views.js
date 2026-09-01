// ============================================================================
// routes/views.js â€” Rutas de vistas del sistema
// Orden importante: rutas especÃ­ficas ANTES que rutas con parÃ¡metros (:id)
// ============================================================================

const express    = require('express');
const router     = express.Router();
const { equipmentPool, callStoredProcedure, executeQuery } = require('../config/database');
const {
    authenticateToken,
    requireRole,
    requireVerified,
    logActivity,
    optionalAuth
} = require('../middleware/auth');


// ============================================================================
// RAÃZ â€” Redirige segÃºn autenticaciÃ³n
// ============================================================================
router.get('/', authenticateToken, requireVerified, (req, res) => {
    if (req.user) return res.redirect('/autogestion');
    return res.redirect('/api/auth/login');
});

router.get('/login', authenticateToken, requireVerified, (req, res) => {
    if (req.user) return res.redirect('/autogestion');
    return res.redirect('/api/auth/login');
});

// ============================================================================
// VISTAS SIMPLES â€” Sin lÃ³gica de BD (render directo)
// ============================================================================
router.get('/requerimientos', optionalAuth, async (req, res) => {
    const tenantId = req.user?.tenant_id || (req.query.tenant ? parseInt(req.query.tenant) : null);
    // Usa la config del tenant; si no hay config registrada cae a false (seguro por defecto)
    const { loadTenantConfig } = require('../utils/tenantConfig');
    const tenantCfg = tenantId ? loadTenantConfig(tenantId) : null;
    const jiraEnabled = tenantCfg?.features?.jira ?? res.locals.jiraEnabled ?? false;
    const userForForm = req.user ? { ...req.user, tenant_id: tenantId } : null;
    res.render('admin_platform/admin_management/itsm/requerimientos/form_legacy', {
        title: 'Requerimientos', user: userForForm, reporterEmail: req.query.reporter || '',
        reporterName: req.query.name || '', embed: !!req.query.embed, jiraEnabled
    });
});

router.get('/anuncios', (req, res) => {
    let user = null;
    try {
        const jwt = require('jsonwebtoken');
        const token = req.cookies?.accessToken || req.cookies?.token;
        if (token) user = jwt.verify(token, process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only');
    } catch(e) {}
    res.render('user_platform/self_management/anuncios/index', {
        title: 'Anuncios Corporativos',
        user,
        reporterEmail: req.query.reporter || '',
        reporterName:  req.query.name    || '',
    });
});

router.get('/preguntas-frecuentes', (req, res) => {
    let user = null;
    try {
        const jwt = require('jsonwebtoken');
        const token = req.cookies?.accessToken || req.cookies?.token;
        if (token) user = jwt.verify(token, process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only');
    } catch(e) {}
    res.render('user_platform/self_management/faq/index', { title: 'Preguntas Frecuentes', user, reporterEmail: req.query.reporter || '', reporterName: req.query.name || '' });
});

router.get('/autogestion', async (req, res) => {
    let user = null;
    try {
        const jwt   = require('jsonwebtoken');
        const secret = process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only';
        // _pt = preview token (superadmin entrando al portal de un tenant sin cambiar su sesión)
        const rawToken = req.query._pt || req.cookies?.accessToken || req.cookies?.token;
        if (rawToken) {
            const decoded = jwt.verify(rawToken, secret);
            if (decoded?.id) {
                const rows = await executeQuery(equipmentPool,
                    'SELECT id, username, full_name, email, role, tenant_id FROM users WHERE id = ? LIMIT 1',
                    [decoded.id]
                );
                if (rows.length) {
                    // Si el token lleva tenant_id (preview), se usa ese; si no, el del usuario en BD
                    user = { ...rows[0], tenant_id: decoded.tenant_id ?? rows[0].tenant_id };
                } else {
                    user = decoded;
                }
            } else {
                user = decoded;
            }
        }
    } catch(e) {}
    const { loadTenantConfig } = require('../utils/tenantConfig');
    const tenantCfg = user?.tenant_id ? loadTenantConfig(user.tenant_id) : null;
    const tenantDomain = tenantCfg?.domain || null;
    res.render('user_platform/layouts/autogestion', { user, tenantCfg, tenantDomain });
});

// Preview token para superadmin — permite entrar al panel de un tenant sin cambiar su cookie
router.get('/administracion', (req, res, next) => {
    if (!req.query._pt) return next();
    try {
        const jwt     = require('jsonwebtoken');
        const decoded = jwt.verify(req.query._pt, process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only');
        if (decoded?._preview && decoded?.role === 'superadmin') {
            return res.render('admin_platform/admin_management/configuracion/administracion/index', { user: decoded });
        }
    } catch(_) {}
    next();
});
router.get('/administracion',
    authenticateToken,
    requireRole('administrador', 'especialista', 'agente', 'tecnico', 'superadmin'),
    (req, res) => {
        res.render('admin_platform/admin_management/configuracion/administracion/index', { user: req.user });
    }
);
router.get('/sccm',       (req, res) => res.render('admin_platform/admin_management/asset_management/sccm/index'));

router.get('/import-csv', authenticateToken, (req, res) => {
    res.render('admin_platform/admin_management/platform/import_csv/index', { title: 'Importar CSV', user: req.user });
});

router.get('/superadmin',
    authenticateToken,
    requireRole('superadmin'),
    (req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.render('super_admin/index', { user: req.user });
    }
);


// ============================================================================
// INDEX / DASHBOARD PRINCIPAL
// ============================================================================
router.get('/index',
    authenticateToken,
    logActivity('VIEW_DASHBOARD', 'Usuario accediÃ³ al index'),
    async (req, res) => {
        try {
            res.render('index', {
                title: 'Dashboard - Equipment Management',
                user:  req.user,
            });
        } catch (error) {
            console.error('Error cargando index:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando dashboard', user: req.user });
        }
    }
);

router.get('/dashboard',
    authenticateToken,
    logActivity('VIEW_DASHBOARD', 'Usuario accediÃ³ al dashboard'),
    async (req, res) => {
        try {
            const stats = await callStoredProcedure(equipmentPool, 'sp_dashboard_statistics', []);
            res.render('dashboard', {
                title: 'Dashboard - Equipment Management',
                user:  req.user,
                stats: {
                    employees:         stats[0][0],
                    equipment:         stats[1][0],
                    activeAssignments: stats[2][0],
                    topLocations:      stats[3],
                },
            });
        } catch (error) {
            console.error('Error cargando dashboard:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando dashboard', user: req.user });
        }
    }
);


// ============================================================================
// ANALYTICS
// ============================================================================
router.get('/analytics',
    authenticateToken,
    logActivity('VIEW_ANALYTICS', 'Usuario accediÃ³ a Analytics Dashboard'),
    (req, res) => {
        res.render('analytics', { title: 'Analytics Dashboard', user: req.user });
    }
);


// ============================================================================
// INDICATORS
// ============================================================================
router.get('/indicators',
    authenticateToken,
    logActivity('VIEW_INDICATORS', 'Usuario accediÃ³ a indicadores'),
    (req, res) => {
        res.render('indicators', { title: 'Indicadores y Reportes', user: req.user });
    }
);


// ============================================================================
// WARRANTY
// ============================================================================
router.get('/warranty', authenticateToken, (req, res) => {
    res.render('user_platform/self_management/garantias/index', { title: 'GarantÃ­as', user: req.user });
});


// ============================================================================
// ACTIVE DIRECTORY
// ============================================================================
router.get('/ad', authenticateToken, (req, res) => {
    res.render('ad', { title: 'Soporte TÃ©cnico â€” Active Directory', user: req.user });
});

router.get('/soporte', authenticateToken, (req, res) => {
    res.render('admin_platform/admin_management/asset_management/soporte/index', { title: 'Soporte TÃ©cnico â€” Active Directory', user: req.user });
});


// ============================================================================
// RECUPERO DE EQUIPOS
// ============================================================================
router.get('/recoveries', authenticateToken, (req, res) => {
    res.render('recoveries', { title: 'Recupero de Equipos', user: req.user });
});


// ============================================================================
// ALMACÃ‰N
// ============================================================================
router.get('/almacen', authenticateToken, (req, res) => {
    res.render('admin_platform/admin_management/asset_management/almacen/index', { title: 'AlmacÃ©n de Equipos', user: req.user });
});


// ============================================================================
// PERFIL DE USUARIO
// ============================================================================
router.get('/profile',
    authenticateToken,
    logActivity('VIEW_PROFILE', 'Usuario accediÃ³ a su perfil'),
    (req, res) => {
        res.render('profile', { title: 'Mi Perfil', user: req.user });
    }
);

router.get('/permissions', authenticateToken, (req, res) => {
    res.render('admin_platform/admin_management/platform/permisos/index', { title: 'Mis Permisos', user: req.user });
});


// ============================================================================
// ASIGNACIONES
// ============================================================================
router.get('/assignments',
    authenticateToken,
    logActivity('VIEW_ASSIGNMENTS', 'Usuario accediÃ³ a lista de asignaciones'),
    async (req, res) => {
        try {
            const assignments = await executeQuery(
                equipmentPool,
                'SELECT * FROM active_assignments_view ORDER BY assignment_date DESC'
            );
            res.render('assignments/listee', {
                title:       'Asignaciones Activas',
                user:        req.user,
                assignments,
            });
        } catch (error) {
            console.error('Error cargando asignaciones:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando asignaciones', user: req.user });
        }
    }
);

router.get('/almacen', authenticateToken, (req, res) => {
    res.render('almacen_recoveries', { title: 'AlmacÃ©n & Recuperos', user: req.user });
});
// ============================================================================
// REPORTES
router.get('/send-reports', authenticateToken, (req, res) =>
  res.render('admin_platform/admin_management/analytics/reports/index', { title: 'EnvÃ­o de Reportes', user: req.user })
);
router.get('/print-queue', (req, res) => res.render('admin_platform/admin_management/itsm/print_queue/index'));

router.get('/herramientas', (req, res) => {
    let user = null;
    try {
        const jwt = require('jsonwebtoken');
        const token = req.cookies?.accessToken || req.cookies?.token;
        if (token) user = jwt.verify(token, process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only');
    } catch(e) {}
    res.render('user_platform/self_management/herramientas/index', {
        title: 'Herramientas TI',
        user,
        reporterEmail: req.query.reporter || '',
        reporterName:  req.query.name    || '',
        embed: req.query.embed === '1',
    });
});

router.post('/herramientas/sql-query', async (req, res) => {
    const { sql } = req.body;
    if (!sql || typeof sql !== 'string') return res.status(400).json({ error: 'SQL requerido' });
    const stripped = sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
    const firstWord = (stripped.split(/\s+/)[0] || '').toUpperCase();
    if (firstWord !== 'SELECT' && firstWord !== 'SHOW')
        return res.status(400).json({ error: 'Solo se permiten consultas SELECT o SHOW' });
    if (/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|EXEC|EXECUTE|CALL|LOAD|INTO|OUTFILE)\b/i.test(stripped))
        return res.status(400).json({ error: 'OperaciÃ³n no permitida' });
    const limitedSQL = /\bLIMIT\b/i.test(stripped) || firstWord === 'SHOW'
        ? stripped
        : stripped + ' LIMIT 500';
    try {
        const rows = await executeQuery(equipmentPool, limitedSQL, []);
        const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
        res.json({ success: true, rows, cols, count: rows.length });
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// ============================================================================

router.get('/report-lists', authenticateToken, (req, res) =>
  res.render('report-lists', { title: 'Listas de DistribuciÃ³n', user: req.user })
);
router.get('/reports-distribution', (req, res) => res.render('admin_platform/admin_management/analytics/reports_distribution/index'));
router.get('/reports',
    authenticateToken,
    logActivity('VIEW_REPORTS', 'Usuario accediÃ³ a reportes'),
    async (req, res) => {
        try {
            const startDate  = req.query.start_date || '';
            const endDate    = req.query.end_date   || '';
            const reportType = req.query.type       || 'assignments';
            let results      = [];

            if (startDate && endDate) {
                if (reportType === 'assignments') {
                    results = await executeQuery(equipmentPool, `
                        SELECT a.*, e.full_name AS employee_name,
                               eq.device_code, eq.brand, eq.model, l.location_name
                        FROM assignments a
                        INNER JOIN employees  e  ON a.employee_id  = e.id
                        INNER JOIN equipment  eq ON a.equipment_id = eq.id
                        LEFT  JOIN locations  l  ON a.location_id  = l.id
                        WHERE a.assignment_date BETWEEN ? AND ?
                        ORDER BY a.assignment_date DESC
                    `, [startDate, endDate]);
                } else if (reportType === 'equipment') {
                    results = await executeQuery(equipmentPool,
                        'SELECT * FROM equipment WHERE created_at BETWEEN ? AND ? ORDER BY created_at DESC',
                        [startDate, endDate]
                    );
                }
            }

            res.render('reports/index', {
                title:   'Reportes',
                user:    req.user,
                results,
                filters: { startDate, endDate, reportType },
            });
        } catch (error) {
            console.error('Error generando reporte:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error generando reporte', user: req.user });
        }
    }
);


// ============================================================================
// ADMIN
// ============================================================================
router.get('/admin',
    authenticateToken,
    requireRole('administrador'),
    logActivity('VIEW_ADMIN', 'Usuario accediÃ³ al panel de administraciÃ³n'),
    async (req, res) => {
        try {
            const [users, loginStats] = await Promise.all([
                executeQuery(equipmentPool,
                    'SELECT id, username, email, full_name, role, is_active, is_verified, created_at, last_login FROM users ORDER BY created_at DESC'
                ),
                executeQuery(equipmentPool, `
                    SELECT DATE(attempted_at) AS date,
                           COUNT(*)           AS total_attempts,
                           SUM(status = 'success') AS successful,
                           SUM(status = 'failed')  AS failed
                    FROM login_attempts
                    WHERE attempted_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                    GROUP BY DATE(attempted_at)
                    ORDER BY date DESC
                `),
            ]);

            res.render('admin/index', {
                title: 'Panel de AdministraciÃ³n',
                user:  req.user,
                users,
                loginStats,
            });
        } catch (error) {
            console.error('Error cargando panel admin:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando panel de administraciÃ³n', user: req.user });
        }
    }
);


// ============================================================================
// EQUIPOS â€” lista y detalle
// IMPORTANTE: estas rutas van DESPUÃ‰S de todas las rutas sin parÃ¡metro
// para evitar que /equipment/:id capture rutas como /almacen, /recoveries, etc.
// ============================================================================
router.get('/equipment',
    authenticateToken,
    logActivity('VIEW_EQUIPMENT', 'Usuario accediÃ³ a lista de equipos'),
    async (req, res) => {
        try {
            const { status = '', brand = '', search = '' } = req.query;

            let sql    = 'SELECT * FROM equipment WHERE 1=1';
            const params = [];

            if (status) { sql += ' AND status = ?';          params.push(status); }
            if (brand)  { sql += ' AND brand LIKE ?';        params.push(`%${brand}%`); }
            if (search) {
                sql += ' AND (device_code LIKE ? OR model LIKE ? OR serial_number LIKE ?)';
                params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
            sql += ' ORDER BY created_at DESC LIMIT 100';

            const [equipment, brands] = await Promise.all([
                executeQuery(equipmentPool, sql, params),
                executeQuery(equipmentPool, 'SELECT DISTINCT brand FROM equipment ORDER BY brand'),
            ]);

            res.render('admin_platform/admin_management/asset_management/equipment/index', {
                title:   'GestiÃ³n de Equipos',
                user:    req.user,
                equipment,
                brands,
                filters: { status, brand, search },
            });
        } catch (error) {
            console.error('Error cargando equipos:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando equipos', user: req.user });
        }
    }
);

router.get('/equipment/:id',
    authenticateToken,
    logActivity('VIEW_EQUIPMENT_DETAIL', 'Usuario vio detalle de equipo'),
    async (req, res) => {
        try {
            const equipment = await executeQuery(equipmentPool,
                'SELECT * FROM equipment WHERE id = ?', [req.params.id]
            );
            if (!equipment.length) {
                return res.status(404).render('error', { title: 'Error', error: 'Equipo no encontrado', user: req.user });
            }
            const history = await callStoredProcedure(equipmentPool, 'sp_get_equipment_history', [req.params.id]);
            res.render('equipment/view', {
                title:     'Detalle de Equipo',
                user:      req.user,
                equipment: equipment[0],
                history:   history[0],
            });
        } catch (error) {
            console.error('Error cargando equipo:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando equipo', user: req.user });
        }
    }
);


// ============================================================================
// EMPLEADOS â€” lista, perfil y detalle
// IMPORTANTE: /employees/perfil va ANTES de /employees/:id
// para que no sea capturada como id = "perfil"
// ============================================================================

// Hub de Colaboradores (landing page)
router.get('/colaboradores',
    authenticateToken,
    requireVerified,
    (req, res) => {
        res.render('admin_platform/admin_management/platform/colaboradores/hub', {
            title: 'Gestión de Usuarios · IT Platform',
            user:  req.user,
        });
    }
);

// Panel completo de Colaboradores (funcional)
const _colaboradoresHandler = async (req, res) => {
    try {
        const page   = parseInt(req.query.page) || 1;
        const limit  = 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';

        let sql    = 'SELECT * FROM employees WHERE is_active = TRUE';
        const params = [];

        if (search) {
            sql += ' AND (full_name LIKE ? OR email LIKE ? OR cip LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        sql += ' ORDER BY full_name LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const [employees, totalResult] = await Promise.all([
            executeQuery(equipmentPool, sql, params),
            executeQuery(equipmentPool, 'SELECT COUNT(*) AS total FROM employees WHERE is_active = TRUE'),
        ]);

        res.render('admin_platform/admin_management/platform/colaboradores/index', {
            title:       'Empleados',
            user:        req.user,
            employees,
            currentPage: page,
            totalPages:  Math.ceil(totalResult[0].total / limit),
            search,
        });
    } catch (error) {
        console.error('Error cargando empleados:', error);
        res.status(500).render('error', { title: 'Error', error: 'Error cargando empleados', user: req.user });
    }
};

router.get('/colaboradores/panel',
    authenticateToken,
    logActivity('VIEW_EMPLOYEES', 'Usuario accedió a lista de empleados'),
    _colaboradoresHandler
);

// Perfil de empleado â€” debe estar ANTES de /:id
router.get('/empleados/perfil', authenticateToken, (req, res) => {
    res.render('employees-profile', { user: req.user });
});

router.get('/employees/:id',
    authenticateToken,
    logActivity('VIEW_EMPLOYEE_DETAIL', 'Usuario vio detalle de empleado'),
    async (req, res) => {
        try {
            const empRows = await executeQuery(equipmentPool,
                `SELECT id, cip, national_id, full_name, email, position, position_name,
                        category, state, department_id, is_active, created_at, updated_at
                 FROM employees WHERE id = ? LIMIT 1`,
                [req.params.id]);
            if (!empRows || !empRows.length) {
                return res.status(404).render('error', { title: 'Error', error: 'Empleado no encontrado', user: req.user });
            }
            const assignments = await executeQuery(equipmentPool,
                `SELECT a.id AS assignment_id, a.assignment_date, a.return_date, a.status,
                        e.device_code, e.brand, e.model, e.equipment_type, e.serial_number,
                        d.department_name, l.location_name
                 FROM assignments a
                 JOIN equipment e ON e.id = a.equipment_id
                 LEFT JOIN departments d ON d.id = a.department_id
                 LEFT JOIN locations   l ON l.id = a.location_id
                 WHERE a.employee_id = ?
                 ORDER BY a.assignment_date DESC`,
                [req.params.id]);
            res.render('admin_platform/admin_management/platform/colaboradores/detalle', {
                title:       'Detalle de Empleado',
                user:        req.user,
                employee:    empRows[0],
                assignments: assignments || [],
            });
        } catch (error) {
            console.error('Error cargando empleado:', error);
            res.status(500).render('error', { title: 'Error', error: 'Error cargando empleado', user: req.user });
        }
    }
);


// GET /itsm – Hub ITSM
router.get('/itsm', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/admin_management/itsm/hub', { title: 'ITSM · Centro de Servicios TI', user: req.user });
});

// GET /activos – Hub Gestión de Activos
router.get('/activos', authenticateToken, requireVerified,
    requireRole('administrador', 'especialista', 'agente', 'tecnico'),
    (req, res) => {
        res.render('admin_platform/admin_management/asset_management/hub', { title: 'Gestión de Activos · IT Platform', user: req.user });
    }
);

// GET /microsoft – Hub Microsoft 365 + Intune
router.get('/microsoft', authenticateToken, requireVerified,
    requireRole('administrador', 'superadmin', 'especialista'),
    (req, res) => {
        res.render('admin_platform/admin_management/microsoft/hub', {
            title: 'Microsoft 365 · Panel de Administración',
            user: req.user,
        });
    }
);

// GET /gestion-documental – Hub Gestión Documental
router.get('/gestion-documental', authenticateToken, requireVerified,
    requireRole('administrador', 'especialista', 'agente', 'tecnico'),
    (req, res) => {
        res.render('admin_platform/admin_management/documental/hub', { title: 'Gestión Documental · IT Platform', user: req.user });
    }
);
// GET /itsm/incidencias/registrar
router.get('/itsm/incidencias/registrar', authenticateToken, requireVerified, (req, res) => {
    res.render('user_platform/self_management/crear_incidencia/index', { title: 'Registrar Incidencia', user: req.user, currentUserId: req.user?.id || null });
});
// GET /itsm/noc
router.get('/itsm/noc', authenticateToken, requireVerified,
    requireRole('administrador', 'especialista', 'agente', 'tecnico'),
    (req, res) => {
        res.render('admin_platform/admin_management/itsm/noc/index', { title: 'NOC · Centro de Operaciones', user: req.user });
    }
);

// GET /itsm/incidencias/gestion
router.get('/itsm/incidencias/gestion', authenticateToken, requireVerified,
    requireRole('administrador', 'especialista', 'agente', 'tecnico'),
    (req, res) => {
        const localView = req.query.view === 'local';
        res.render('admin_platform/admin_management/itsm/incidencias/index', { title: localView ? 'GestiÃ³n Local' : 'GestiÃ³n de Incidencias', user: req.user, currentUserId: req.user?.id || null, localView });
    }
);

// GET /itsm/requerimientos/registrar
router.get('/itsm/requerimientos/registrar', authenticateToken, requireVerified, async (req, res) => {
    const tenantId = req.user?.tenant_id;
    let jiraEnabled = true;
    if (tenantId && parseInt(tenantId) !== 1) {
        try {
            const FeatureFlagService = require('../src/services/FeatureFlagService');
            const flags = await FeatureFlagService.getAll(parseInt(tenantId));
            if (flags['jira'] !== undefined && flags['jira'].enabled === false) jiraEnabled = false;
        } catch(_) {}
    }
    res.render('user_platform/self_management/crear_requerimiento/index', { title: 'Registrar Requerimiento', user: req.user, currentUserId: req.user?.id || null, jiraEnabled });
});

// GET /itsm/requerimientos/gestion
router.get('/itsm/requerimientos/gestion', authenticateToken, requireVerified,
    requireRole('administrador', 'especialista', 'agente', 'tecnico'),
    (req, res) => {
        const localView = req.query.view === 'local';
        res.render('admin_platform/admin_management/itsm/requerimientos/index', { title: localView ? 'GestiÃ³n Local' : 'GestiÃ³n de Requerimientos', user: req.user, currentUserId: req.user?.id || null, localView });
    }
);

// GET /incidencias
router.get('/incidencias', optionalAuth, async (req, res) => {
    // tenant_id: from JWT, or from ?tenant= param (superadmin visiting a tenant portal)
    const tenantId = req.user?.tenant_id || (req.query.tenant ? parseInt(req.query.tenant) : null);
    // Jira habilitado por defecto; solo se deshabilita si el flag está explícitamente en false
    let jiraEnabled = true;
    if (tenantId && parseInt(tenantId) !== 1) {
        try {
            const FeatureFlagService = require('../src/services/FeatureFlagService');
            const flags = await FeatureFlagService.getAll(parseInt(tenantId));
            if (flags['jira'] !== undefined && flags['jira'].enabled === false) jiraEnabled = false;
        } catch(_) {}
    }
    let tenantDomain = 'integratel.com.pe';
    if (tenantId && parseInt(tenantId) !== 1) {
        try {
            const { executeQuery, equipmentPool } = require('../config/database');
            const t = await executeQuery(equipmentPool, 'SELECT domain FROM tenants WHERE id = ? LIMIT 1', [parseInt(tenantId)]);
            if (t.length && t[0].domain) tenantDomain = t[0].domain;
        } catch(_) {}
    }
    const userForForm = req.user ? { ...req.user, tenant_id: tenantId } : null;
    res.render('user_platform/self_management/crear_incidencia/form_embed', {
        title: 'Gestión de Tickets',
        user: userForForm,
        reporterEmail: req.query.reporter || '',
        reporterName:  req.query.name    || '',
        embed:         !!req.query.embed,
        jiraEnabled,
        tenantDomain
    });
});

// ============================================================================
// ITSM EXTENDIDO
// ============================================================================
router.get('/solicitudes', authenticateToken, requireVerified, (_req, res) => {
    res.redirect('/catalogo');
});

router.get('/cambios', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/admin_management/itsm/cambios/index', { title: 'GestiÃ³n de Cambios', user: req.user });
});

router.get('/problemas', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/admin_management/itsm/problemas/index', { title: 'GestiÃ³n de Problemas', user: req.user });
});

router.get('/catalogo', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/admin_management/itsm/catalogo/index', { title: 'CatÃ¡logo de Servicios', user: req.user });
});

router.get('/cmdb', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/admin_management/asset_management/cmdb/index', { title: 'CMDB â€” Inventario de ConfiguraciÃ³n', user: req.user });
});

// ============================================================================
// FASE 4 â€” SOPORTE Y CONOCIMIENTO
// ============================================================================
router.get('/agent-dashboard', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/layouts/agent_dashboard', { title: 'Mi Dashboard', user: req.user });
});

router.get('/admin-dashboard', authenticateToken, requireRole('administrador'), (req, res) => {
    res.render('admin_platform/layouts/admin_dashboard', { title: 'Dashboard Administrador', user: req.user });
});

router.get('/knowledge-base', (req, res) => {
    let user = null;
    try {
        const jwt = require('jsonwebtoken');
        const token = req.cookies?.accessToken || req.cookies?.token;
        if (token) user = jwt.verify(token, process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only');
    } catch(e) {}
    res.render('user_platform/self_management/knowledge_base/index', {
        title: 'Base de Conocimiento',
        user,
        reporterEmail: req.query.reporter || '',
        reporterName:  req.query.name    || '',
    });
});

router.get('/csi', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/admin_management/analytics/csi/index', { title: 'Mejora Continua (CSI)', user: req.user });
});

router.get('/devolucion', (req, res) => {
    let user = null;
    try {
        const jwt = require('jsonwebtoken');
        const token = req.cookies?.accessToken || req.cookies?.token;
        if (token) user = jwt.verify(token, process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only');
    } catch(e) {}
    res.render('user_platform/self_management/devoluciones/index', {
        title: 'DevoluciÃ³n de Equipos',
        user,
        reporterEmail: req.query.reporter || '',
        reporterName:  req.query.name    || '',
    });
});

router.get('/reports-itsm', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/admin_management/analytics/reports_itsm/index', { title: 'Reportes ITSM', user: req.user });
});

// ============================================================================
// FASE 5-6 â€” PORTAL AUTOSERVICIO + ADMIN REGLAS
// ============================================================================

// Portal de autoservicio (rol usuario / cualquier rol)
router.get('/portal', authenticateToken, requireVerified, (req, res) => {
    res.render('user_platform/self_management/mis_tickets/index', { title: 'Portal de Autoservicio', user: req.user });
});

router.get('/portal/tickets', authenticateToken, requireVerified, (req, res) => {
    res.render('user_platform/self_management/mis_tickets/index', { title: 'Mis Tickets', user: req.user });
});

router.get('/portal/ticket/:id', authenticateToken, requireVerified, (req, res) => {
    res.render('user_platform/self_management/mis_tickets/detalle', { title: 'Detalle de Ticket', user: req.user, ticketId: req.params.id });
});

// Admin: motor de reglas
router.get('/admin/reglas', authenticateToken, requireRole('administrador'), (req, res) => {
    res.render('admin_platform/admin_management/configuracion/reglas/index', { title: 'Motor de Reglas', user: req.user });
});

// ============================================================================
// TV DASHBOARD â€” pantalla de cola de tickets (sin sidebar, auto-refresh)
// ============================================================================
router.get('/tickets/tv', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/admin_management/itsm/tickets_tv/index', { title: 'Dashboard TV â€” Cola de Tickets', user: req.user });
});

// ============================================================================
// PORTAL DE LICENCIAMIENTO M365
// ============================================================================
// Hub de Licencias (landing page)
router.get('/licencias', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/admin_management/platform/licencias/hub', { title: 'Licenciamiento · IT Platform', user: req.user });
});

// Panel completo de Licencias (funcional)
router.get('/licencias/panel', authenticateToken, requireVerified, (req, res) => {
    res.render('admin_platform/admin_management/platform/licencias/index', { title: 'Portal de Licenciamiento M365', user: req.user });
});

// ============================================================================
// RMM — Remote Management Console
// ============================================================================
router.get('/rmm', authenticateToken, requireVerified,
    requireRole('administrador', 'especialista', 'tecnico'),
    (req, res) => {
        res.render('admin_platform/admin_management/integrations/rmm/index', {
            title: 'RMM · Gestión Remota',
            user:  req.user,
        });
    }
);

// Compliance RMM
router.get('/rmm/compliance', authenticateToken, requireVerified,
    requireRole('administrador', 'especialista', 'tecnico'),
    (req, res) => {
        res.render('admin_platform/admin_management/integrations/rmm/compliance', {
            title: 'Compliance · RMM',
            user:  req.user,
        });
    }
);

// ============================================================================
// EXPORTAR
// ============================================================================
module.exports = router;

