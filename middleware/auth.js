// middleware/auth.js - Middleware de autenticación (CORREGIDO)

const jwt            = require('jsonwebtoken');
const { equipmentPool, executeQuery } = require('../config/database');
const tenantRepo     = require('../src/repositories/platform/TenantRepository');

// Secrets (deben coincidir con los de auth.js)
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret_dev_only';

// ============================================
// Middleware: Verificar autenticación (Token JWT)
// ============================================
const authenticateToken = async (req, res, next) => {
    try {
        // Obtener token: cookie (browser) o Authorization: Bearer <token> (API/integrations)
        const authHeader = req.headers.authorization;
        const token = req.cookies.accessToken
                   || req.cookies.token
                   || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

        if (!token) {
            console.log('⚠️ No se encontró token en la petición');
            
            // Si es una petición API, devolver JSON
            if (req.originalUrl.startsWith('/api/')) {
                return res.status(401).json({ 
                    success: false,
                    error: 'No autenticado. Token no proporcionado.' 
                });
            }
            
            // Si es una vista, redirigir al login
            return res.redirect('/api/auth/login');
        }

        // Verificar el token
        jwt.verify(token, JWT_SECRET, async (err, decoded) => {
            if (err) {
                console.log('❌ Token inválido o expirado:', err.message);

                // Solo limpiar cookies si el token vino de ahí (no limpiar en Bearer requests)
                if (!authHeader) {
                    res.clearCookie('accessToken');
                    res.clearCookie('token');
                }
                
                if (req.originalUrl.startsWith('/api/')) {
                    return res.status(401).json({ 
                        success: false,
                        error: 'Token inválido o expirado',
                        expired: err.name === 'TokenExpiredError'
                    });
                }
                
                return res.redirect('/api/auth/login');
            }

            try {
                // Buscar usuario en la base de datos para verificar que siga activo
                const userQuery = 'SELECT * FROM users WHERE id = ? AND is_active = 1 LIMIT 1';
                const userResult = await executeQuery(equipmentPool, userQuery, [decoded.id]);

                if (!userResult || userResult.length === 0) {
                    console.log(`❌ Usuario no encontrado o inactivo: ID ${decoded.id}`);
                    
                    if (req.originalUrl.startsWith('/api/')) {
                        return res.status(401).json({ 
                            success: false,
                            error: 'Usuario no encontrado o inactivo' 
                        });
                    }
                    
                    return res.redirect('/api/auth/login');
                }

                // Adjuntar usuario completo a la request
                // 'admin' es alias de 'administrador' — normalizar para que todos los checks funcionen
                const rawRole = userResult[0].role;
                req.user = {
                    id: userResult[0].id,
                    username: userResult[0].username,
                    email: userResult[0].email,
                    full_name: userResult[0].full_name,
                    role: rawRole === 'admin' ? 'administrador' : rawRole,
                    employee_cip: userResult[0].employee_cip,
                    is_verified: userResult[0].is_verified,
                    tenant_id: userResult[0].tenant_id || null,
                };

                // Resolver tenant real desde BD (sobreescribe el guess del tenantMiddleware)
                try {
                    const tid = userResult[0].tenant_id;
                    const tenant = tid
                        ? (await tenantRepo.findById(tid) || tenantRepo.default())
                        : tenantRepo.default();
                    req.tenant = tenant;
                    if (res.locals) res.locals.tenant = tenant;
                } catch (_) {
                    // No bloquear autenticación si falla la lookup de tenant
                }

                // Actualizar sesión si existe
                if (req.session) {
                    req.session.userId = req.user.id;
                    req.session.username = req.user.username;
                    req.session.role = req.user.role;
                    req.session.loggedin = true;
                }

                console.log(`✅ Usuario autenticado: ${req.user.username} (${req.user.role})`);
                next();

            } catch (dbError) {
                console.error('❌ Error al verificar usuario en BD:', dbError);
                
                if (req.originalUrl.startsWith('/api/')) {
                    return res.status(500).json({ 
                        success: false,
                        error: 'Error de autenticación' 
                    });
                }
                
                return res.redirect('/api/auth/login');
            }
        });

    } catch (error) {
        console.error('❌ Error en authenticateToken:', error);
        
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(500).json({ 
                success: false,
                error: 'Error de autenticación' 
            });
        }
        
        return res.redirect('/api/auth/login');
    }
};

// ============================================
// Middleware: Verificar roles específicos
// ============================================
const requireRole = (...allowedRoles) => {
    return (req, res, next) => {
        if (!req.user) {
            console.log('⚠️ requireRole: Usuario no autenticado');
            
            if (req.originalUrl.startsWith('/api/')) {
                return res.status(401).json({ 
                    success: false,
                    error: 'No autenticado' 
                });
            }
            
            return res.redirect('/api/auth/login');
        }

        if (req.user.role === 'superadmin') return next();

        if (!allowedRoles.includes(req.user.role)) {
            console.log(`⛔ Acceso denegado. Usuario ${req.user.username} (${req.user.role}) intentó acceder a recurso que requiere: ${allowedRoles.join(', ')}`);
            
            if (req.originalUrl.startsWith('/api/')) {
                return res.status(403).json({ 
                    success: false,
                    error: 'No tienes permisos para acceder a este recurso',
                    requiredRoles: allowedRoles,
                    userRole: req.user.role
                });
            }
            
            // Para vistas, renderizar página de error si existe, o enviar HTML simple
            return res.status(403).send(`
                <html>
                <head>
                    <title>Acceso Denegado</title>
                    <meta charset="UTF-8">
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            display: flex;
                            justify-content: center;
                            align-items: center;
                            height: 100vh;
                            margin: 0;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        }
                        .error-box {
                            background: white;
                            padding: 40px;
                            border-radius: 20px;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                            text-align: center;
                            max-width: 500px;
                        }
                        h1 { color: #dc3545; margin-bottom: 20px; }
                        p { color: #666; margin-bottom: 15px; }
                        .btn {
                            display: inline-block;
                            padding: 12px 30px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                            text-decoration: none;
                            border-radius: 10px;
                            margin-top: 20px;
                            transition: transform 0.2s;
                        }
                        .btn:hover { transform: translateY(-2px); }
                    </style>
                </head>
                <body>
                    <div class="error-box">
                        <h1>⛔ Acceso Denegado</h1>
                        <p>No tienes permisos suficientes para acceder a este recurso.</p>
                        <p><strong>Tu rol:</strong> ${req.user.role}</p>
                        <p><strong>Roles requeridos:</strong> ${allowedRoles.join(', ')}</p>
                        <a href="/dashboard" class="btn">← Volver al Dashboard</a>
                    </div>
                </body>
                </html>
            `);
        }

        console.log(`✅ Acceso autorizado para ${req.user.username} (${req.user.role})`);
        next();
    };
};

// ============================================
// Middleware: Verificar cuenta verificada
// ============================================
const requireVerified = (req, res, next) => {
    if (!req.user) {
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(401).json({ 
                success: false,
                error: 'No autenticado' 
            });
        }
        return res.redirect('/api/auth/login');
    }

    if (!req.user.is_verified) {
        console.log(`⚠️ Usuario no verificado: ${req.user.username}`);
        
        if (req.originalUrl.startsWith('/api/')) {
            return res.status(403).json({ 
                success: false,
                error: 'Debes verificar tu cuenta para acceder a este recurso',
                verified: false
            });
        }
        
        return res.status(403).send(`
            <html>
            <head>
                <title>Cuenta No Verificada</title>
                <meta charset="UTF-8">
                <style>
                    body {
                        font-family: Arial, sans-serif;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        height: 100vh;
                        margin: 0;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    }
                    .warning-box {
                        background: white;
                        padding: 40px;
                        border-radius: 20px;
                        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                        text-align: center;
                        max-width: 500px;
                    }
                    h1 { color: #ffc107; margin-bottom: 20px; }
                    p { color: #666; margin-bottom: 15px; }
                    .btn {
                        display: inline-block;
                        padding: 12px 30px;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        color: white;
                        text-decoration: none;
                        border-radius: 10px;
                        margin: 5px;
                        transition: transform 0.2s;
                    }
                    .btn:hover { transform: translateY(-2px); }
                </style>
            </head>
            <body>
                <div class="warning-box">
                    <h1>⚠️ Cuenta No Verificada</h1>
                    <p>Debes verificar tu cuenta de email antes de acceder a este recurso.</p>
                    <a href="/dashboard" class="btn">← Volver al Dashboard</a>
                </div>
            </body>
            </html>
        `);
    }

    next();
};

// ============================================
// Middleware: Opcional - No requiere auth pero agrega user si existe
// ============================================
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = req.cookies.accessToken
                   || req.cookies.token
                   || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);

        if (!token) {
            return next(); // Continuar sin usuario
        }

        jwt.verify(token, JWT_SECRET, async (err, decoded) => {
            if (err) {
                return next(); // Token inválido, continuar sin usuario
            }

            try {
                const userQuery = 'SELECT * FROM users WHERE id = ? AND is_active = 1 LIMIT 1';
                const userResult = await executeQuery(equipmentPool, userQuery, [decoded.id]);

                if (userResult && userResult.length > 0) {
                    req.user = {
                        id: userResult[0].id,
                        username: userResult[0].username,
                        email: userResult[0].email,
                        full_name: userResult[0].full_name,
                        role: userResult[0].role,
                        employee_cip: userResult[0].employee_cip,
                        tenant_id: userResult[0].tenant_id || null
                    };
                }
            } catch (error) {
                console.error('Error en optionalAuth:', error);
            }

            next();
        });

    } catch (error) {
        console.error('Error en optionalAuth:', error);
        next();
    }
};

// ============================================
// Middleware: Registrar actividad en audit_logs (via AuditLog model)
// ============================================
const { logAudit } = require('../src/utils/audit');

const logActivity = (action, recurso = null) => {
    return (req, res, next) => {
        next();
        if (req.user) logAudit(req, action, recurso);
    };
};

const logout = async (req, res) => {
    // Destruir la sesión y eliminar la cookie de JWT
    req.session.destroy((err) => {
        if (err) {
            return console.error("Error destroying session:", err);
        }
        console.log("The session has been destroyed!");
    });

    res.cookie('accessToken', '', { maxAge: 0 }); // Eliminar cookie del token
    res.redirect('/'); // Redirigir a la página de inicio
};

// ============================================
// EXPORTAR MIDDLEWARES
// ============================================
module.exports = {
    authenticateToken,
    logout,
    requireRole,
    requireVerified,
    optionalAuth,
    logActivity,
    
    // Alias para compatibilidad
    isAuthenticated: authenticateToken,
    hasRole: requireRole,
    isVerified: requireVerified
};