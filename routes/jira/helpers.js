
const axios = require('axios');
const multer = require('multer');
const FormData = require('form-data');
const { equipmentPool, executeQuery } = require('../../config/database');








const { authenticateToken, optionalAuth } = require('../../middleware/auth');

// ── Config (con fallback a .env para backward compat) ─────
const IntegrationConfig = require('../../src/services/IntegrationConfigService');

const JIRA_HOST  = process.env.JIRA_HOST  || 'https://integratelperu.atlassian.net';
const JIRA_EMAIL = process.env.JIRA_EMAIL || 'rabasurco@stefanini.com';
const JIRA_TOKEN = process.env.JIRA_API_TOKEN;
const SD_ID      = '23';
const RT_ID      = '213';

const auth = { username: JIRA_EMAIL, password: JIRA_TOKEN };
const _jiraAuthHeader = () =>
    `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64')}`;

/** Devuelve credenciales Jira efectivas para un tenant (o .env si tenantId=null) */
async function getJiraConfig(tenantId) {
    if (!tenantId) return { host: JIRA_HOST, email: JIRA_EMAIL, token: JIRA_TOKEN };
    const cfg = await IntegrationConfig.get(tenantId, 'jira').catch(() => ({}));
    return {
        host:  cfg.base_url   || JIRA_HOST,
        email: cfg.username   || JIRA_EMAIL,
        token: cfg.api_token  || JIRA_TOKEN,
    };
}

/** Helper de llamada Jira con soporte multi-tenant */
async function jiraForTenant(tenantId, method, path, data = null) {
    const cfg  = await getJiraConfig(tenantId);
    const head = `Basic ${Buffer.from(`${cfg.email}:${cfg.token}`).toString('base64')}`;
    const res  = await axios({
        method, url: `${cfg.host}${path}`,
        headers: {
            'Authorization': head, 'Accept': 'application/json',
            'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check',
            'X-ExperimentalApi': 'opt-in',
        },
        data, timeout: 25000, maxRedirects: 5,
        validateStatus: s => s < 500,
    });
    if (typeof res.data === 'string' && res.data.trim().startsWith('<'))
        throw Object.assign(new Error(`WAF block: HTTP ${res.status}`), { response: res });
    if (res.status >= 300)
        throw Object.assign(new Error(`Jira ${res.status}`), { response: res });
    return res.data;
}

console.log(`[jira.js] TOKEN loaded: ${!!JIRA_TOKEN} | len: ${JIRA_TOKEN?.length} | email: ${JIRA_EMAIL}`);

// ── Multer ────────────────────────────────────────────────
const upload = multer({
    storage: multer.memoryStorage(),
    limits:  { fileSize: 10 * 1024 * 1024 }
});

// ── Helper servicedeskapi ─────────────────────────────────
async function jira(method, path, data = null) {
    try {
        const res = await axios({
            method,
            url:    `${JIRA_HOST}${path}`,
headers: {
    'Authorization':     _jiraAuthHeader(),
    'Accept':            'application/json',
    'Content-Type':      'application/json',
    'X-Atlassian-Token': 'no-check',
    'X-ExperimentalApi': 'opt-in',
},
            data,
            timeout: 25000,
            maxRedirects: 5,
            validateStatus: s => s < 500,
        });
        // Detectar respuesta HTML de WAF/CloudFront
        if (typeof res.data === 'string' && res.data.trim().startsWith('<')) {
            const err = new Error(`WAF block: HTTP ${res.status}`);
            err.response = { status: res.status, data: res.data };
            throw err;
        }
        if (res.status >= 300) {
            const err = new Error(
                res.data?.errorMessage ||
                (res.data?.errorMessages||[]).join('; ') ||
                JSON.stringify(res.data?.errors || {}) ||
                `HTTP ${res.status}`
            );
            err.response = { status: res.status, data: res.data };
            throw err;
        }
        return res.data;
    } catch(e) {
        // Re-lanzar errores de axios con info del response intacta
        throw e;
    }
}

// ── Helper MySQL ──────────────────────────────────────────
async function dbQuery(sql, params = []) {
    return executeQuery(equipmentPool, sql, params);
}

// ── Caché de agentes del Service Desk ─────────────────────
// Map: email.toLowerCase() → { accountId, displayName }
let _agentCache = new Map();
let _agentCacheTs = 0;
const AGENT_TTL = 3_600_000; // 1 hora

async function loadAgentCache(force = false) {
    if (!force && _agentCache.size > 0 && Date.now() - _agentCacheTs < AGENT_TTL) {
        return _agentCache;
    }
    const fresh = new Map();

    // Siempre: service account vía /myself (infalible)
    try {
        const me = await jira('GET', '/rest/api/3/myself');
        if (me.accountId && JIRA_EMAIL) {
            fresh.set(JIRA_EMAIL.toLowerCase(), { accountId: me.accountId, displayName: me.displayName || JIRA_EMAIL });
        }
    } catch (_) {}

    // Miembros SD con email visible
    try {
        let start = 0;
        while (true) {
            const data = await jira('GET', `/rest/servicedeskapi/servicedesk/${SD_ID}/member?limit=50&start=${start}`);
            for (const u of (data.values || [])) {
                if (u.accountId && u.emailAddress) {
                    fresh.set(u.emailAddress.toLowerCase(), { accountId: u.accountId, displayName: u.displayName || '' });
                }
            }
            if (data.isLastPage !== false || !data.values?.length) break;
            start += 50;
        }
    } catch (_) {}

    if (fresh.size > 0) {
        _agentCache = fresh;
        _agentCacheTs = Date.now();
        console.log(`✅ agentCache: ${fresh.size} entradas`);
    }
    return _agentCache;
}

async function resolveJiraAccountId(email) {
    if (!email) return null;
    const cache = await loadAgentCache();
    return cache.get(email.toLowerCase()) || null;
}

// ── Migración automática ──────────────────────────────────


// ── Helper email ──────────────────────────────────────────
function assignEmailHtml(key, summary, priority, reporter, techName) {
    const prioColor = { P1:'#dc2626', P2:'#f59e0b', P3:'#3b82f6', P4:'#94a3b8' };
    const prioLabel = { P1:'🔴 P1 Crítico', P2:'🟠 P2 Alto', P3:'🔵 P3 Medio', P4:'⚪ P4 Bajo' };
    const slaLabel  = { P1:'1 hora', P2:'4 horas', P3:'8 horas', P4:'24 horas' };
    const color = prioColor[priority] || '#3b82f6';
    return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(9,30,66,.12);">
      <div style="background:linear-gradient(135deg,#0052CC,#2684FF);padding:20px 24px;color:#fff;">
        <div style="font-size:17px;font-weight:700;">📋 Nuevo ticket asignado</div>
        <div style="font-size:13px;opacity:.85;margin-top:4px;">Hola ${techName}, tienes un nuevo ticket a gestionar</div>
      </div>
      <div style="padding:24px;">
        <table style="width:100%;border-collapse:collapse;">
          <tr><td style="padding:8px 0;font-size:13px;color:#6B778C;width:130px;">Ticket</td><td style="font-size:13px;font-weight:700;color:#0052CC;">${key}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#6B778C;">Resumen</td><td style="font-size:13px;color:#172B4D;">${summary||'—'}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#6B778C;">Prioridad</td><td><span style="background:${color};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:700;">${prioLabel[priority]||priority}</span></td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#6B778C;">Reporter</td><td style="font-size:13px;color:#172B4D;">${reporter||'—'}</td></tr>
          <tr><td style="padding:8px 0;font-size:13px;color:#6B778C;">SLA</td><td style="font-size:13px;font-weight:700;color:#dc2626;">⏱ ${slaLabel[priority]||'—'}</td></tr>
        </table>
        <div style="margin-top:16px;padding:12px 16px;background:#eff6ff;border-radius:8px;font-size:12px;color:#1e40af;">
          Por favor gestiona este ticket dentro del tiempo de SLA establecido.
        </div>
      </div>
    </div>`;
}

async function sendEmail(to, subject, html) {
    const nodemailer = require('nodemailer');
    const t = nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT)||587,
        secure: process.env.SMTP_SECURE==='true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    });
    await t.sendMail({ from: `"Service Desk TI" <${process.env.SMTP_USER}>`, to, subject, html });
}

// ── Helper config automations ────────────────────────────
async function getAutomationConfig() {
    const rows = await dbQuery(`SELECT \`key\`, value FROM itsm_automations`);
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

// ── P1 escalation background check (cada 5 min) ──────────


// ── Labels ────────────────────────────────────────────────
const IMPACT_LABELS = {
    '618437': 'De 1 a 5 usuarios afectados',
    '618438': 'De 6 a 19 usuarios afectados',
    '618439': 'De 20 a más usuarios afectados'
};
const URGENCY_LABELS = {
    '618440': 'Inconvenientes con formato de aplicación',
    '618441': 'El error no me impide trabajar',
    '618442': 'No puedo trabajar por este error'
};
const _CTX = 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c';
const _c = id => `${_CTX}:${id}`;
const COMPONENT_LABELS = {
    [_c('11277')]: 'Workplace',
    [_c('11278')]: 'Accesos / Conectividad',
    [_c('11279')]: 'Consultas Generales',
};
const APP_LABELS = {
    [_c('11280')]: 'Equipo Corporativo',
    [_c('11281')]: 'Microsoft 365',
    [_c('11282')]: 'Servicios de impresión',
    [_c('11283')]: 'Software Comercial / Utilitario',
    [_c('11284')]: 'Impresora',
};
const TIPOLOGIA_LABELS = {
    // Accesos / Conectividad
    [_c('11538')]:'+Simple Residencial – No se puede acceder a la aplicación',
    [_c('11689')]:'Citrix – Error al cargar aplicación desde fuera de la red corporativa',
    [_c('11690')]:'Citrix – Error de conectividad desde fuera de la red corporativa',
    [_c('11692')]:'Citrix – No se puede cambiar la contraseña desde fuera de la red corporativa',
    [_c('11693')]:'Citrix – Problemas con doble autenticación desde fuera de la red corporativa',
    [_c('11694')]:'Citrix – Problemas para iniciar sesión desde fuera de la red corporativa',
    [_c('11704')]:'Credenciales – Problemas con usuario/contraseña de red',
    [_c('11744')]:'Gescab – No se puede acceder a la aplicación',
    [_c('11745')]:'Gescab – Versión del sistema desactualizada',
    [_c('11762')]:'ISIS – No se puede acceder a la aplicación',
    [_c('11442')]:'Red corporativa – Intermitencia en TEFWIFINT',
    [_c('11444')]:'Red corporativa – Intermitencia general',
    [_c('11446')]:'Red corporativa – Lentitud en TEFWIFINT',
    [_c('11448')]:'Red corporativa – Lentitud general',
    [_c('11450')]:'Red corporativa – No hay conexión en TEFWIFINT',
    [_c('11452')]:'Red corporativa – No hay conexión general',
    [_c('11499')]:'SAP – No se puede acceder a la aplicación',
    [_c('11513')]:'SRM – No se puede acceder a la aplicación',
    // Consultas Generales
    [_c('11420')]:'Procedimientos - Instrucciones',
    // Equipo Corporativo
    [_c('11570')]:'Almacenamiento - Disco D lleno',
    [_c('11571')]:'Almacenamiento – Disco C lleno',
    [_c('11573')]:'Audio – Problemas con el audio',
    [_c('11697')]:'Conectividad – Problemas con internet',
    [_c('11698')]:'Conectividad – Sin acceso a Escritorio Remoto',
    [_c('11699')]:'Conectividad – Sin acceso a red corporativa',
    [_c('11750')]:'Hardware – Pantalla rota o dañada',
    [_c('11751')]:'Hardware – Problemas con el cargador',
    [_c('11752')]:'Hardware – Problemas con la batería',
    [_c('11753')]:'Hardware – Problemas con mouse',
    [_c('11754')]:'Hardware – Problemas con teclado',
    [_c('11755')]:'Hardware – Sonido extraño en el equipo',
    [_c('11777')]:'Inicio de sesión – Actualizaciones fallidas',
    [_c('11778')]:'Inicio de sesión – Fecha y hora desactualizadas',
    [_c('11779')]:'Inicio de sesión – Mensaje de activación de licencia',
    [_c('11780')]:'Inicio de sesión – No carga sistema operativo',
    [_c('11781')]:'Inicio de sesión – Problemas para iniciar sesión',
    [_c('11353')]:'Navegadores – Google Chrome',
    [_c('11354')]:'Navegadores – Microsoft Edge',
    [_c('11378')]:'Otros problemas',
    [_c('11408')]:'Post Renovación Tecnológica – INCIDENCIAS RT',
    [_c('11459')]:'Rendimiento – No cargan sistemas comerciales',
    [_c('11535')]:'Rendimiento – No responde, no enciende equipo',
    [_c('11461')]:'Rendimiento – Reinicios constantes',
    [_c('11464')]:'Rendimiento – Sistema lento o congelado',
    [_c('11637')]:'Seguridad – Alerta de virus',
    [_c('11652')]:'Software Telefónica – No cargan aplicaciones',
    // Microsoft 365
    [_c('11728')]:'Excel – Error al guardar en OneDrive',
    [_c('11729')]:'Excel – No puedo abrir archivos compartidos',
    [_c('11730')]:'Excel – No responde o se cierra solo',
    [_c('11731')]:'Excel – Problemas con macros o fórmulas',
    [_c('11790')]:'MFA – Cambio de número móvil',
    [_c('11791')]:'MFA – No puedo configurar MFA en nuevo dispositivo',
    [_c('11792')]:'MFA – No recibo el código en el teléfono',
    [_c('11793')]:'MFA – Problemas con Microsoft Authenticator',
    [_c('11361')]:'O365 Otros – Access no responde',
    [_c('11362')]:'O365 Otros – PowerPoint no carga presentaciones',
    [_c('11363')]:'O365 Otros – Problemas con Word',
    [_c('11845')]:'Office 365 - Consulta sobre migración',
    [_c('11844')]:'Office 365 - Problemas técnicos en migración',
    [_c('11365')]:'Office365 Web – Error al abrir documentos desde SharePoint',
    [_c('11366')]:'Office365 Web – No puedo acceder a Office 365 en navegador',
    [_c('11367')]:'Office365 Web – Word en línea no guarda cambios',
    [_c('11368')]:'OneDrive – No arranca al iniciar sesión',
    [_c('11369')]:'OneDrive – No puedo compartir documentos',
    [_c('11370')]:'OneDrive – No puedo sincronizar archivos',
    [_c('11371')]:'OneDrive – No tengo espacio en OneDrive',
    [_c('11372')]:'OneNote – Errores de acceso y autenticación',
    [_c('11374')]:'OneNote – Pérdida de datos o contenido',
    [_c('11373')]:'OneNote – Problemas de sincronización',
    [_c('11379')]:'Outlook – Firma de correo desconfigurada',
    [_c('11533')]:'Outlook – Mensaje de "Buzón lleno"',
    [_c('11380')]:'Outlook – No puedo enviar o recibir correos',
    [_c('11381')]:'Outlook – No puedo iniciar sesión',
    [_c('11382')]:'Outlook – No sincroniza correos',
    [_c('11647')]:'SharePoint – Error al sincronizar con OneDrive',
    [_c('11648')]:'SharePoint – No puedo acceder a un sitio',
    [_c('11649')]:'SharePoint – No puedo cargar archivos',
    [_c('11650')]:'SharePoint – No tengo permisos para editar',
    [_c('11655')]:'Teams – Necesito crear grupos',
    [_c('11656')]:'Teams – No puedo iniciar sesión',
    [_c('11657')]:'Teams – No se pueden programar reuniones',
    [_c('11658')]:'Teams – Teams se cierra inesperadamente',
    [_c('11667')]:'Workplace Facebook – No puedo acceder',
    // Servicios de impresión
    [_c('11770')]:'Impresora – Código PIN',
    [_c('11771')]:'Impresora – No imprime',
    [_c('12267')]:'Impresora – No llega el escaneado (bandeja)',
    [_c('12268')]:'Impresora – No llega el escaneado (correo)',
    // Software Comercial / Utilitario
    [_c('11590')]:'Bizagi – No puedo acceder a la aplicación',
    [_c('11686')]:'Centro de Software – No permite instalar app',
    [_c('11688')]:'Checkpoint – No puedo acceder a la aplicación',
    [_c('11691')]:'Citrix – No puedo acceder a la aplicación',
    [_c('11740')]:'FortiClient – No puedo acceder a la aplicación',
    [_c('11749')]:'Google Earth Pro – No puedo acceder a la aplicación',
    [_c('11769')]:'IZArc – No puedo acceder a la aplicación',
    [_c('11335')]:'Microsoft Forms – Errores de conexión',
    [_c('11336')]:'Microsoft Forms – Problemas de permisos',
    [_c('11337')]:'Microsoft Project – Errores de acceso y autenticación',
    [_c('11338')]:'Microsoft Project – Fallos de sincronización',
    [_c('11339')]:'Microsoft Project – Problemas de instalación y activación',
    [_c('11340')]:'Microsoft Visio – Errores de acceso y autenticación',
    [_c('11341')]:'Microsoft Visio – Fallos de sincronización',
    [_c('11342')]:'Microsoft Visio – Problemas de instalación y activación',
    [_c('11359')]:'Notepad++ – No puedo acceder a la aplicación',
    [_c('11375')]:'Oracle – No puedo acceder a la aplicación',
    [_c('11377')]:'Otro software comercial – No puedo acceder',
    [_c('11410')]:'Power Apps – Errores de conexión',
    [_c('11412')]:'Power Apps – Problemas de permisos',
    [_c('11414')]:'Power Automate – Errores de conexión',
    [_c('11416')]:'Power Automate – Problemas de permisos',
    [_c('11418')]:'Power BI – No puedo acceder a la aplicación',
    [_c('11512')]:'SQL Management/Server – No puedo acceder',
    [_c('11659')]:'Teradata – No puedo acceder a la aplicación',
    [_c('11666')]:'WinSCP – No puedo acceder a la aplicación',
};




function mapJiraStatus(name) {
    const s = (name || '').toLowerCase();
    if (s.includes('progreso') || s.includes('progress'))          return 'en_progreso';
    if (s.includes('resuelto') || s.includes('resolved'))          return 'resuelto';
    if (s.includes('cerrado')  || s.includes('closed') || s.includes('done')) return 'cerrado';
    if (s.includes('esperando')|| s.includes('waiting') || s.includes('pendiente') || s.includes('pending')) return 'pendiente';
    if (s.includes('asignado') || s.includes('assigned') || s.includes('n1') || s.includes('n2') || s.includes('n3')) return 'asignado';
    return 'abierto';
}
function mapPriority(name) {
    const p = (name || '').toLowerCase();
    if (p.includes('critical') || p.includes('highest') || p.includes('crÃ­tico') || p.includes('critico') || p === 'p1') return 'P1';
    if (p.includes('high') || p.includes('alto') || p.includes('alta') || p === 'p2') return 'P2';
    if (p.includes('medium') || p.includes('media') || p.includes('medio') || p === 'p3') return 'P3';
    if (p.includes('low') || p.includes('lowest') || p.includes('bajo') || p.includes('baja') || p === 'p4') return 'P4';
    return 'P3';
}
function extractAdfText(body) {
    if (!body) return '';
    if (typeof body === 'string') return body;
    try {
        const parts = [];
        const walk = n => { if (n.text) parts.push(n.text); (n.content||[]).forEach(walk); };
        walk(body);
        return parts.join(' ');
    } catch(e) { return ''; }
}

module.exports = {
    JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, SD_ID, RT_ID,
    getJiraConfig, jiraForTenant,
    jira, dbQuery, sendEmail, getAutomationConfig, assignEmailHtml,
    upload, mapJiraStatus, mapPriority, extractAdfText,
    IMPACT_LABELS, URGENCY_LABELS, COMPONENT_LABELS, APP_LABELS, TIPOLOGIA_LABELS,
    loadAgentCache, resolveJiraAccountId
};
