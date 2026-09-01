const express  = require('express');
const jwt      = require('jsonwebtoken');
const { Op }   = require('sequelize');
const { equipmentPool, executeQuery } = require('../../config/database');
const { User } = require('../../src/models');
const { enqueueEmail } = require('../../src/queues/index');
const router = express.Router();
const { authenticateToken: requireAuth } = require('../../middleware/auth');

// ── MSAL — auth code flow para SSO Microsoft ─────────────────────────────────
const { _encrypt } = (() => { try { return require('../../src/services/msTokenCache'); } catch(_) { return { _encrypt: null }; } })();

let _msalClient = null;
try {
    const { ConfidentialClientApplication } = require('@azure/msal-node');
    _msalClient = new ConfidentialClientApplication({
        auth: {
            clientId:     process.env.MS_CLIENT_ID,
            authority:    `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
            clientSecret: process.env.MS_CLIENT_SECRET,
        }
    });
} catch(e) { console.warn('MSAL no disponible:', e.message); }

// Scopes del login — solo básicos para el auth code flow (el refresh token se usa
// después por acquireTokenSilent para obtener tokens Graph sin segundo login)
const MSAL_SCOPES = ['openid', 'profile', 'email', 'offline_access', 'User.Read'];

// URI dinámica: se construye desde el request para que siempre coincida con el host real
function getMsalRedirect(req) {
    if (process.env.APP_URL) return `${process.env.APP_URL}/api/auth/microsoft/callback`;
    const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
    const host  = req.headers['x-forwarded-host']  || req.get('host') || 'localhost:3000';
    return `${proto}://${host}/api/auth/microsoft/callback`;
}

function pwValid(p) {
    return p && p.length >= 6 && /[A-Z]/.test(p) && /[0-9]/.test(p) && /[^A-Za-z0-9]/.test(p);
}

// ── Auto-crear tablas auxiliares si no existen ───────────────────────────────
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS login_attempts (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                user_id    VARCHAR(100),
                ip_address VARCHAR(100),
                status     ENUM('success','failed') NOT NULL,
                created_at DATETIME DEFAULT NOW(),
                INDEX idx_user (user_id),
                INDEX idx_ip   (ip_address)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS refresh_tokens (
                id         INT AUTO_INCREMENT PRIMARY KEY,
                user_id    VARCHAR(100) NOT NULL,
                token      TEXT NOT NULL,
                expires_at DATETIME NOT NULL,
                created_at DATETIME DEFAULT NOW(),
                INDEX idx_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { console.error('auth tables migration:', e.message); }
})();

// Verificar variables de entorno
console.log('🔍 Verificando variables de entorno en auth.js:');
console.log('JWT_SECRET:', process.env.JWT_SECRET ? '✅ Definido' : '❌ NO definido');
console.log('JWT_REFRESH_SECRET:', process.env.JWT_REFRESH_SECRET ? '✅ Definido' : '❌ NO definido');

// Constantes para tokens (DEBEN estar al inicio)
const jwtExpirySeconds = 8 * 60 * 60; // 8 horas
const jwtRefreshExpirySeconds = 7 * 24 * 60 * 60; // 7 días

// Secrets con valores por defecto (SOLO PARA DESARROLLO)
const JWT_SECRET = process.env.JWT_SECRET || 'fallback_jwt_secret_dev_only';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret_dev_only';

// Funciones para generar tokens
function generateAccessToken(user) {
    return jwt.sign(
        {
            id:        user.id,
            username:  user.username,
            role:      user.role,
            tenant_id: user.tenantId ?? user.tenant_id ?? null,
        },
        JWT_SECRET,
        { expiresIn: jwtExpirySeconds }
    );
}

function generateRefreshToken(user) {
    return jwt.sign(
        {
            id: user.id
        },
        JWT_REFRESH_SECRET,
        { expiresIn: jwtRefreshExpirySeconds }
    );
}
function authenticateToken  (req, res, next) {
  const token = req.cookies.token; // Asumiendo que el token se guarda en una cookie

  if (!token) {
    return res.redirect('/login'); // Redirigir a login si no hay token
  }

  jwt.verify(token, process.env.JWT_SECRET || 'secret', (err, user) => {
    if (err) {
      return res.redirect('/login'); // Redirigir a login si el token no es válido
    }
    req.user = user; // Guardar información del usuario en la solicitud
    next(); // Continuar a la siguiente función middleware o ruta
  });
};

// GET /login -> Renderizar vista
router.get('/login', (req, res) => {
    return res.render('auth/login', { error: null });
});

// POST /login -> Validar credenciales
router.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        // Validación de datos de entrada
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Usuario y contraseña son requeridos'
            });
        }

        console.log(`🔍 Intentando login para: ${username}`);

        // Buscar usuario por username o email (Sequelize ORM)
        const userData = await User.findOne({
            where: {
                [Op.or]: [{ username }, { email: username }],
                activo: true,
            },
        });

        if (!userData) {
            console.log(`❌ Usuario no encontrado: ${username}`);
            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        console.log(`✅ Usuario encontrado: ${userData.username} (ID: ${userData.id})`);

        // Comparar contraseña con el hash almacenado
        const isPasswordValid = await userData.verificarPassword(password);
        
        const ip = req.ip || req.socket?.remoteAddress || 'unknown';

        if (!isPasswordValid) {
            console.log(`❌ Contraseña inválida para: ${userData.username}`);
            // fire-and-forget — no bloquea la respuesta
            executeQuery(equipmentPool,
                'INSERT INTO login_attempts (user_id, ip_address, status) VALUES (?, ?, ?)',
                [userData.id, ip, 'failed']
            ).catch(() => {});

            return res.status(401).json({ success: false, error: 'Credenciales inválidas' });
        }

        console.log(`✅ Contraseña válida para: ${userData.username}`);

        // Generar tokens primero para no demorar la respuesta
        const accessToken  = generateAccessToken(userData);
        const refreshToken = generateRefreshToken(userData);

        // Escrituras auxiliares en paralelo — fire-and-forget
        Promise.all([
            executeQuery(equipmentPool,
                'UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
                [userData.id]),
            executeQuery(equipmentPool,
                'INSERT INTO login_attempts (user_id, ip_address, status) VALUES (?, ?, ?)',
                [userData.id, ip, 'success']),
            executeQuery(equipmentPool,
                'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))',
                [userData.id, refreshToken, jwtRefreshExpirySeconds]),
        ]).catch(() => {});

        // Configurar cookies con los tokens
        res.cookie('accessToken', accessToken, {
            maxAge: jwtExpirySeconds * 1000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        res.cookie('refreshToken', refreshToken, {
            maxAge: jwtRefreshExpirySeconds * 1000,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'strict'
        });

        console.log(`✅ Usuario ${username} inició sesión exitosamente`);

        // Almacenar información en la sesión (si usas express-session)
        if (req.session) {
            req.session.loggedin  = true;
            req.session.userId    = userData.id;
            req.session.username  = userData.username;
            req.session.full_name = userData.nombre   || userData.full_name || '';
            req.session.role      = userData.rol      || userData.role      || '';
        }

        // Respuesta exitosa con datos del usuario (sin información sensible)
        return res.status(200).json({
            success: true,
            message: 'Inicio de sesión exitoso',
            accessToken,
            refreshToken,
            user: {
                id:           userData.id,
                username:     userData.username,
                email:        userData.email,
                full_name:    userData.nombre      || userData.full_name  || '',
                role:         userData.rol         || userData.role       || '',
                tenant_id:    userData.tenantId    ?? userData.tenant_id  ?? null,
                employee_cip: userData.employeeCip || userData.employee_cip || null,
                is_verified:  userData.isVerified  ?? userData.is_verified ?? false,
            }
        });

    } catch (error) {
        console.error('❌ Error en login:', error);
        return res.status(500).json({
            success: false,
            error: 'Error interno del servidor'
        });
    }
});

// GET /logout -> Cerrar sesión (redirect desde navbar)
router.get('/logout', async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        if (refreshToken) {
            executeQuery(equipmentPool,
                'DELETE FROM refresh_tokens WHERE token = ?',
                [refreshToken]
            ).catch(() => {});
        }
        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');
        res.clearCookie('token');
        if (req.session) req.session.destroy(() => {});
        return res.redirect('/api/auth/login');
    } catch (error) {
        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');
        return res.redirect('/api/auth/login');
    }
});

// POST /logout -> Cerrar sesión
router.post('/logout', async (req, res) => {
    try {
        const refreshToken = req.cookies.refreshToken;
        
        if (refreshToken) {
            // Eliminar refresh token de la base de datos
            await executeQuery(
                equipmentPool,
                'DELETE FROM refresh_tokens WHERE token = ?',
                [refreshToken]
            );
        }

        // Limpiar cookies
        res.clearCookie('accessToken');
        res.clearCookie('refreshToken');

        // Destruir sesión si existe
        if (req.session) {
            req.session.destroy();
        }

        return res.status(200).json({
            success: true,
            message: 'Sesión cerrada correctamente'
        });
    } catch (error) {
        console.error('❌ Error en logout:', error);
        return res.status(500).json({
            success: false,
            error: 'Error al cerrar sesión'
        });
    }
});

// ============================================================================
// GET /api/auth/perfil — Datos del usuario autenticado
// ============================================================================
router.get('/perfil', authenticateToken, async (req, res) => {
    try {
        const rows = await executeQuery(
            equipmentPool,
            `SELECT id, username, full_name, email, role, employee_cip,
                    is_active, is_verified, created_at
             FROM users WHERE id = ? AND is_active = 1 LIMIT 1`,
            [req.user.id]
        );

        if (!rows || rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Usuario no encontrado' });
        }

        return res.json({ success: true, data: rows[0] });

    } catch (error) {
        console.error('❌ Error en GET /perfil:', error);
        return res.status(500).json({ success: false, error: 'Error al obtener perfil' });
    }
});

// ============================================================================
// GET /api/auth/users — Listar todos los usuarios del sistema
// ============================================================================
router.get('/users', requireAuth, async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool,
            `SELECT id, username, full_name, email, role, is_active, created_at FROM users ORDER BY full_name ASC`
        );
        res.json({ success: true, data: rows });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// POST /api/auth/register — Crear nuevo usuario (solo admin)
// ============================================================================
router.post('/register', requireAuth, async (req, res) => {
    try {
        const { full_name, username, email, role = 'usuario', password } = req.body;
        if (!full_name || !email || !password)
            return res.status(400).json({ success: false, error: 'Faltan campos obligatorios' });

        const bcrypt = require('bcryptjs');
        const hash   = await bcrypt.hash(password, 10);
        const uname  = username || email.split('@')[0];

        const result = await executeQuery(equipmentPool,
            `INSERT INTO users (full_name, username, email, role, password_hash, is_active, is_verified, created_at)
             VALUES (?, ?, ?, ?, ?, 1, 1, NOW())`,
            [full_name, uname, email.toLowerCase(), role, hash]
        );
        res.status(201).json({ success: true, userId: result.insertId, message: 'Usuario creado' });
    } catch(err) {
        if (err.code === 'ER_DUP_ENTRY')
            return res.status(409).json({ success: false, error: 'El email o usuario ya existe' });
        res.status(500).json({ success: false, error: err.message });
    }
});

// ============================================================================
// PATCH /api/auth/users/:id/role — Cambiar rol de un usuario
// ============================================================================
router.patch('/users/:id/role', requireAuth, async (req, res) => {
    try {
        const { role } = req.body;
        const validRoles = ['usuario', 'visor', 'tecnico', 'agente', 'especialista', 'administrador'];
        if (!validRoles.includes(role))
            return res.status(400).json({ success: false, error: 'Rol no válido' });

        await executeQuery(equipmentPool,
            `UPDATE users SET role = ? WHERE id = ?`,
            [role, req.params.id]
        );
        res.json({ success: true, message: 'Rol actualizado' });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── POST /api/auth/check-employee ─────────────────────────────────────────────
router.post('/check-employee', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ success: false, error: 'email requerido' });
    try {
        const cleanEmail  = email.trim().toLowerCase();
        const emailDomain = cleanEmail.split('@')[1] || '';

        const _tenantLookup = async (tenantId) => {
            try {
                const q = tenantId
                    ? 'SELECT id, name, domain FROM tenants WHERE id = ? LIMIT 1'
                    : 'SELECT id, name, domain FROM tenants WHERE domain = ? LIMIT 1';
                const [t] = await executeQuery(equipmentPool, q, tenantId ? [tenantId] : [emailDomain]);
                return t ? { id: t.id, name: t.name, domain: t.domain } : null;
            } catch (_) { return null; }
        };

        // 1. Buscar en employees (aislado: si la BD no está disponible, continúa al fallback)
        try {
            const emp = await executeQuery(equipmentPool,
                `SELECT id, full_name, email FROM employees WHERE LOWER(email)=LOWER(?) AND is_active=1 LIMIT 1`,
                [cleanEmail]
            );
            if (emp.length) {
                const usr    = await User.findOne({ where: { email: cleanEmail } });
                const tenant = await _tenantLookup(usr?.tenant_id || null);
                return res.json({ success: true, name: emp[0].full_name, hasAccount: !!usr, tenant });
            }
        } catch(_) { /* employees table no disponible, continuar con users */ }

        // 2. Buscar en users por email o username
        const usr = await User.findOne({
            where: { [Op.or]: [{ email: cleanEmail }, { username: email.trim() }] }
        });
        if (usr) {
            const tenant = await _tenantLookup(usr.tenant_id || null);
            return res.json({ success: true, name: usr.full_name || usr.nombre || usr.username, hasAccount: true, tenant });
        }

        return res.json({ success: false, error: 'Usuario no registrado en el sistema' });
    } catch(err) {
        // BD completamente no disponible — permitir avanzar al paso de contraseña
        const name = email.trim().split('@')[0];
        return res.json({ success: true, name, hasAccount: true });
    }
});

// ── POST /api/auth/employee-setup — crear / actualizar contraseña de empleado ─
router.post('/employee-setup', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, error: 'email y password requeridos' });
    if (!pwValid(password)) return res.status(400).json({
        success: false,
        error: 'La contraseña debe tener mínimo 6 caracteres, una mayúscula, un número y un símbolo'
    });
    try {
        const emp = await executeQuery(equipmentPool,
            `SELECT id, full_name, email FROM employees WHERE LOWER(email)=LOWER(?) AND is_active=1 LIMIT 1`,
            [email.trim()]
        );
        if (!emp.length) return res.status(403).json({ success: false, error: 'Correo no autorizado' });

        const cleanEmail = email.trim().toLowerCase();
        const fullName   = emp[0].full_name || cleanEmail;
        const username   = cleanEmail.split('@')[0];

        let userData = await User.findOne({ where: { email: cleanEmail } });
        if (userData) {
            userData.password = password;
            await userData.save();
        } else {
            userData = await User.create({
                username:   username,
                nombre:     fullName,
                email:      cleanEmail,
                password:   password,
                rol:        'usuario',
                activo:     true,
                isVerified: true,
            });
        }

        enqueueEmail({ to: cleanEmail, subject: '🔐 Tus credenciales de acceso — Portal TI', template: 'bienvenida-acceso', vars: { email: cleanEmail, password: password } }).catch(() => {});

        const accessToken  = generateAccessToken(userData);
        const refreshToken = generateRefreshToken(userData);

        res.cookie('accessToken',  accessToken,  { maxAge: jwtExpirySeconds * 1000,        httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });
        res.cookie('refreshToken', refreshToken, { maxAge: jwtRefreshExpirySeconds * 1000,  httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' });

        return res.json({
            success: true,
            accessToken, refreshToken,
            user: { id: userData.id, username: userData.username, email: userData.email, full_name: fullName, role: userData.rol || 'usuario', tenant_id: userData.tenantId ?? userData.tenant_id ?? null }
        });
    } catch(err) {
        console.error('employee-setup error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── GET /auth/microsoft — iniciar SSO ─────────────────────────────────────────
router.get('/microsoft', async (req, res) => {
    if (!_msalClient) return res.redirect('/login?error=sso_no_disponible');
    try {
        const redirectUri = getMsalRedirect(req);
        req.session.msalRedirectUri = redirectUri;
        // Destino post-login en state (sobrevive el round-trip OAuth, no depende de sesión)
        const dest  = req.query.redirect || '/autogestion';
        const state = Buffer.from(JSON.stringify({ dest })).toString('base64');
        console.log('🔐 SSO inicio → dest:', dest);
        const url = await _msalClient.getAuthCodeUrl({ scopes: MSAL_SCOPES, redirectUri, state, prompt: 'select_account' });
        res.redirect(url);
    } catch(err) {
        console.error('MSAL auth URL error:', err);
        res.redirect('/login?error=sso_error');
    }
});

// ── GET /auth/microsoft/callback ─────────────────────────────────────────────
router.get('/microsoft/callback', async (req, res) => {
    if (!_msalClient) return res.redirect('/login?error=sso_no_disponible');
    const { code, error, state } = req.query;
    if (error || !code) return res.redirect(`/login?error=${encodeURIComponent(error || 'sin_codigo')}`);
    // Decodificar state para obtener destino post-login
    let dest = '/autogestion';
    try {
        if (state) {
            const s = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
            if (s.dest) dest = s.dest;
        }
    } catch(_) {}
    try {
        const redirectUri = req.session.msalRedirectUri || getMsalRedirect(req);
        const result = await _msalClient.acquireTokenByCode({ code, scopes: MSAL_SCOPES, redirectUri });
        const msEmail = (result.account?.username || result.account?.name || '').toLowerCase();
        if (!msEmail) return res.redirect('/login?error=email_no_obtenido');

        // Validar dominio corporativo
        if (!msEmail.includes('integratel')) return res.redirect('/login?error=dominio_no_autorizado');

        // ── Buscar usuario por email (SQL directo, id ASC para evitar duplicados) ──
        let userRows = await executeQuery(equipmentPool,
            `SELECT id, username, email, role, is_active FROM users WHERE LOWER(email)=? ORDER BY id ASC LIMIT 1`,
            [msEmail]
        );

        // Emails pre-autorizados como superadmin
        const SUPERADMIN_EMAILS = [
            'ricardo.castillo.opr@integratel.com.pe',
        ];

        // Emails pre-autorizados como admin (nuevos o existentes)
        const ADMIN_EMAILS = [
            'juan.urteaga.opr@integratel.com.pe',
            'jose.zevallos.opr@integratel.com.pe',
            'luis.urteaga.opr@integratel.com.pe',
        ];

        // Si no existe, crear con el rol correcto desde el inicio
        if (!userRows || !userRows.length) {
            const emp = await executeQuery(equipmentPool,
                `SELECT full_name FROM employees WHERE LOWER(email)=? AND is_active=1 LIMIT 1`, [msEmail]
            ).catch(() => []);
            const fullName = emp[0]?.full_name || result.account?.name || msEmail.split('@')[0];
            const username = msEmail.split('@')[0];
            const crypto   = require('crypto');
            const roleInicial = SUPERADMIN_EMAILS.includes(msEmail) ? 'superadmin' : ADMIN_EMAILS.includes(msEmail) ? 'admin' : 'usuario';
            await executeQuery(equipmentPool,
                `INSERT INTO users (username, full_name, email, password_hash, role, is_active, is_verified, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, 1, 1, NOW(), NOW())`,
                [username, fullName, msEmail, crypto.randomBytes(32).toString('hex'), roleInicial]
            );
            userRows = await executeQuery(equipmentPool,
                `SELECT id, username, email, role, is_active FROM users WHERE LOWER(email)=? LIMIT 1`,
                [msEmail]
            );
        }

        const userRow = userRows[0];

        // Corregir rol si no coincide con las listas autorizadas
        if (SUPERADMIN_EMAILS.includes(msEmail) && userRow.role !== 'superadmin') {
            await executeQuery(equipmentPool, 'UPDATE users SET role = ? WHERE id = ?', ['superadmin', userRow.id]);
            userRow.role = 'superadmin';
        } else if (ADMIN_EMAILS.includes(msEmail) && !['admin', 'administrador', 'superadmin'].includes(userRow.role)) {
            await executeQuery(equipmentPool, 'UPDATE users SET role = ? WHERE id = ?', ['admin', userRow.id]);
            userRow.role = 'admin';
        }
        console.log(`✅ MS login: id=${userRow.id} email=${userRow.email} role=${userRow.role}`);

        // Admins van directo al panel de administración, no al portal de usuario
        if (dest === '/autogestion' && ['admin', 'administrador', 'superadmin', 'especialista', 'agente', 'tecnico'].includes(userRow.role)) {
            dest = '/administracion';
        }

        // ── Guardar token MSAL en BD ──────────────────────────────────────────
        const homeAccountId = result.account?.homeAccountId;
        if (homeAccountId && _encrypt) {
            try {
                const serialized = _msalClient.getTokenCache().serialize();
                const encrypted  = _encrypt(serialized);
                await executeQuery(equipmentPool,
                    `UPDATE users SET ms_home_account_id=?, ms_token_cache=?, ms_scopes_granted=? WHERE id=?`,
                    [homeAccountId, encrypted, MSAL_SCOPES.join(' '), userRow.id]
                );
                console.log(`✅ Token MS guardado: user=${userRow.id} account=${homeAccountId}`);
            } catch(cacheErr) {
                console.error('[auth/callback] Error guardando token MS:', cacheErr.message);
            }
        }

        // ── Emitir JWT de plataforma ──────────────────────────────────────────
        const jwtPayload = { id: userRow.id, username: userRow.username, role: userRow.role, tenant_id: null };
        const accessToken  = require('jsonwebtoken').sign(jwtPayload, JWT_SECRET, { expiresIn: jwtExpirySeconds });
        const refreshToken = require('jsonwebtoken').sign({ id: userRow.id }, JWT_SECRET, { expiresIn: jwtRefreshExpirySeconds });

        res.cookie('accessToken',  accessToken,  { maxAge: jwtExpirySeconds * 1000,       httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });
        res.cookie('refreshToken', refreshToken, { maxAge: jwtRefreshExpirySeconds * 1000, httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' });

        if (req.session) {
            req.session.loggedin = true;
            req.session.userId   = userRow.id;
            req.session.username = userRow.username;
        }

        res.redirect(dest);
    } catch(err) {
        console.error('MSAL callback error:', err);
        res.redirect(`/login?error=${encodeURIComponent(err.message)}`);
    }
});

module.exports = router;