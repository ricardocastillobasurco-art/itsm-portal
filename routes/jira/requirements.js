
const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuth } = require('../../middleware/auth');
const { jira, dbQuery, upload, assignEmailHtml, sendEmail, getAutomationConfig, mapJiraStatus, mapPriority, extractAdfText, IMPACT_LABELS, URGENCY_LABELS, COMPONENT_LABELS, APP_LABELS, TIPOLOGIA_LABELS, JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, SD_ID, RT_ID } = require('./helpers');
const axios = require('axios');
const FormData = require('form-data');


const SD_REQ_ID = process.env.JIRA_REQ_SD_ID || '1156';
const RT_REQ_ID = process.env.JIRA_REQ_RT_ID || '1595';

let _reqTypesCache = null;
let _reqTypesCacheTs = 0;
const _REQ_TYPES_TTL = 60 * 60 * 1000;

// Constantes descubiertas del proyecto REQ
const ASSETS_WORKSPACE  = 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c';
const REQ_PROJECT_KEY   = process.env.JIRA_REQ_PROJECT    || 'REQ';
const REQ_ISSUETYPE_ID  = process.env.JIRA_REQ_ISSUETYPE  || '10360'; // Requerimiento

// Busca el objeto Assets "Personal" del empleado por email
async function findAssetsPerson(email) {
    const ws = ASSETS_WORKSPACE;
    const queries = [
        `"Email" = "${email}"`,
        `"Correo" = "${email}"`,
        `"Correo electrónico" = "${email}"`,
        `Name = "${email.split('@')[0]}"`,
    ];
    for (const qlQuery of queries) {
        try {
            const r = await axios({
                method: 'POST',
                url: `${JIRA_HOST}/gateway/api/jsm/assets/workspace/${ws}/v1/object/aql`,
                auth,
                headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-ExperimentalApi': 'opt-in' },
                data: { qlQuery, page: 1, maxResults: 1, includeAttributes: false },
                timeout: 10000,
            });
            const objs = r.data?.values || r.data?.objectEntries || [];
            if (objs.length > 0) {
                const objectId = String(objs[0].id || objs[0].objectId || '');
                if (objectId) {
                    console.log(`✅ Assets person found (${qlQuery}): objectId=${objectId}`);
                    return { workspaceId: ws, id: `${ws}:${objectId}`, objectId };
                }
            }
        } catch(e) { console.warn(`⚠️ Assets AQL [${qlQuery}]:`, e.response?.status, e.message); }
    }
    console.warn('⚠️ Assets person not found for:', email);
    return null;
}

(async () => {
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS jira_requirements (
                id                INT PRIMARY KEY AUTO_INCREMENT,
                req_key           VARCHAR(50)  NOT NULL UNIQUE,
                summary           VARCHAR(500) NOT NULL,
                description       TEXT,
                reporter          VARCHAR(255),
                tipo              VARCHAR(100),
                priority          ENUM('P1','P2','P3','P4') DEFAULT 'P3',
                status            VARCHAR(100) DEFAULT 'Abierto',
                internal_status   ENUM('abierto','asignado','en_progreso','pendiente_usuario','resuelto','cerrado') DEFAULT 'abierto',
                assigned_to       INT DEFAULT NULL,
                assigned_to_name  VARCHAR(100) DEFAULT NULL,
                assigned_at       DATETIME DEFAULT NULL,
                first_response_at DATETIME DEFAULT NULL,
                resolved_at       DATETIME DEFAULT NULL,
                sla_deadline      DATETIME DEFAULT NULL,
                resolution_note   TEXT DEFAULT NULL,
                closed_at         DATETIME DEFAULT NULL,
                closed_by         VARCHAR(100) DEFAULT NULL,
                close_comment     TEXT DEFAULT NULL,
                phone             VARCHAR(50),
                jira_url          VARCHAR(500),
                created_at        DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at        DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_req_status  (internal_status),
                INDEX idx_req_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
    } catch(e) { console.error('⚠️ jira_requirements migration:', e.message); }
})();

// GET /api/jira/requirements
router.get('/requirements', authenticateToken, async (_req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT jr.*, u.full_name AS tech_name
            FROM jira_requirements jr
            LEFT JOIN users u ON u.id = jr.assigned_to
            ORDER BY jr.created_at DESC LIMIT 500`);
        res.json({ success: true, data: rows.map(r => ({
            key:              r.req_key,
            summary:          r.summary,
            description:      r.description,
            tipo:             r.tipo,
            reporter:         r.reporter,
            priority:         r.priority || 'P3',
            status:           r.status,
            internal_status:  r.internal_status || 'abierto',
            assigned_to:      r.assigned_to,
            assigned_to_name: r.tech_name || r.assigned_to_name || null,
            assigned_at:      r.assigned_at,
            first_response_at: r.first_response_at,
            resolved_at:      r.resolved_at,
            sla_deadline:     r.sla_deadline,
            created:          r.created_at,
            closed_at:        r.closed_at,
            url:              r.jira_url
        })) });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

const _REQ_TYPES_FALLBACK = [
    { id: null, name: 'Aplicaciones Colaborativas',              description: '' },
    { id: null, name: 'Aplicaciones Empresariales',              description: '' },
    { id: null, name: 'Configuración de Equipos',                description: '' },
    { id: null, name: 'Gestión de Accesorios de RED',            description: '' },
    { id: null, name: 'Gestión de Componentes y Periféricos',    description: '' },
    { id: null, name: 'Gestión de Configuración General',        description: '' },
    { id: null, name: 'Gestión de Configuración General Interno',description: '' },
    { id: null, name: 'Gestión de Correo Exchange Online',       description: '' },
    { id: null, name: 'Gestión de Correo Exchange Online Interno',description:'' },
    { id: null, name: 'Gestión de Cuentas',                      description: '' },
    { id: null, name: 'Gestión de Entra ID (Azure AD)',          description: '' },
    { id: null, name: 'Gestión de Equipos',                      description: '' },
    { id: null, name: 'Gestión de Equipos (Terceros)',           description: '' },
    { id: null, name: 'Gestión de Licencias',                    description: '' },
    { id: null, name: 'Gestión de Personal',                     description: '' },
    { id: null, name: 'Gestión de Seguridad (Defender / Purview)',description:'' },
    { id: null, name: 'Gestión de SharePoint Online',            description: '' },
    { id: null, name: 'Gestión RPA',                             description: '' },
    { id: null, name: 'Gestión Software',                        description: '' },
    { id: null, name: 'Gestión Software - Especial',             description: '' },
    { id: null, name: 'Logística y Traslados',                   description: '' },
    { id: null, name: 'No Catalogado',                           description: '' },
    { id: null, name: 'Reportes y Seguridad',                    description: '' },
];

// GET /api/jira/requesttypes
router.get('/requesttypes', authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user?.tenant_id;
        if (tenantId && parseInt(tenantId) !== 1) {
            const FeatureFlagService = require('../../src/services/FeatureFlagService');
            const hasJira = await FeatureFlagService.isEnabled(parseInt(tenantId), 'jira');
            if (!hasJira) return res.json({ success: false, code: 'JIRA_NOT_CONFIGURED', data: [] });
        }

        const now = Date.now();
        if (_reqTypesCache && (now - _reqTypesCacheTs) < _REQ_TYPES_TTL)
            return res.json({ success: true, data: _reqTypesCache });

        // Intentar sin groupId (el parámetro ?groupId= puede ser bloqueado por WAF)
        let types = [];
        try {
            const result = await jira('GET', `/rest/servicedeskapi/servicedesk/${SD_REQ_ID}/requesttype`);
            types = (result.values || []).map(t => ({
                id:          String(t.id),
                name:        t.name,
                description: t.description || '',
            }));
        } catch(apiErr) {
            console.warn('⚠️ requesttype API bloqueada, usando fallback:', apiErr.message);
            types = _REQ_TYPES_FALLBACK;
        }

        _reqTypesCache = types;
        _reqTypesCacheTs = now;
        res.json({ success: true, data: types });
    } catch(e) {
        console.error('❌ Error fetching request types:', e.message);
        res.json({ success: true, data: _REQ_TYPES_FALLBACK });
    }
});

// POST /api/jira/requirement
router.post('/requirement', optionalAuth, async (req, res) => {
    const start = Date.now();
    try {
        const tenantId = req.user?.tenant_id;
        if (tenantId && parseInt(tenantId) !== 1) {
            const FeatureFlagService = require('../../src/services/FeatureFlagService');
            const hasJira = await FeatureFlagService.isEnabled(parseInt(tenantId), 'jira');
            if (!hasJira) return res.status(422).json({ success: false, code: 'JIRA_NOT_CONFIGURED', message: 'Integración con Jira no configurada para este tenant. Contacta al administrador.' });
        }

        let { summary, reporter, phone, description, tipo, priority = 'P3', attachmentId, requestTypeId, requestTypeName } = req.body;
        if (!summary || !reporter || !description)
            return res.status(400).json({ success: false, message: 'Faltan campos: summary, reporter, description' });

        if (requestTypeName && !tipo) tipo = requestTypeName;

        let reqKey;

        if (requestTypeId) {
            // Crear vía Service Desk API (enruta correctamente según tipo de requerimiento)
            const sdResult = await jira('POST', '/rest/servicedeskapi/request', {
                serviceDeskId:      String(SD_REQ_ID),
                requestTypeId:      String(requestTypeId),
                raiseOnBehalfOf:    reporter,
                requestFieldValues: { summary, description },
            });
            reqKey = sdResult.issueKey;
            if (!reqKey) throw new Error('Service Desk API no devolvió issueKey: ' + JSON.stringify(sdResult));
        } else {
            // Ruta legacy: crear vía REST API v2
            const assetsPerson = await findAssetsPerson(reporter);
            const issueFields = {
                project:     { key: REQ_PROJECT_KEY },
                issuetype:   { id: REQ_ISSUETYPE_ID },
                summary,
                description: `${description}\n\nSolicitante: ${reporter}\nTipo: ${tipo || 'General'}\nTeléfono: ${phone || '-'}`,
            };
            if (assetsPerson) issueFields.customfield_17777 = [assetsPerson];
            const result = await jira('POST', '/rest/api/2/issue', { fields: issueFields });
            reqKey = result.key;
        }

        console.log(`✅ Requerimiento creado: ${reqKey}`);

        const slaHours = { P1: 4, P2: 8, P3: 24, P4: 72 };
        const slaDeadline = new Date(Date.now() + (slaHours[priority] || 24) * 3600000);

        await dbQuery(`
            INSERT INTO jira_requirements (req_key, summary, description, reporter, tipo, priority, status, internal_status, phone, jira_url, sla_deadline)
            VALUES (?, ?, ?, ?, ?, ?, 'Abierto', 'abierto', ?, ?, ?)`,
            [reqKey, summary, description, reporter, tipo || null, priority, phone || null, `${JIRA_HOST}/browse/${reqKey}`, slaDeadline]);

        // Confirmation email (non-blocking)
        const displayName = reporter.split('@')[0];
        ;(async () => {
            try {
                const nodemailer = require('nodemailer');
                const t = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT)||587, secure: process.env.SMTP_SECURE==='true', auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
                await t.sendMail({
                    from: `"Service Desk TI" <${process.env.SMTP_USER}>`, to: reporter,
                    subject: `[${reqKey}] Tu requerimiento fue registrado — ${summary}`,
                    html: `<div style="font-family:sans-serif;max-width:580px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(9,30,66,.12);">
<div style="background:#6366f1;padding:28px 32px;text-align:center;"><div style="font-size:28px;">📋</div><h1 style="color:#fff;margin:8px 0 0;font-size:20px;">Requerimiento Registrado</h1></div>
<div style="background:#EEF2FF;padding:16px 32px;text-align:center;border-bottom:1px solid #C7D2FE;"><span style="font-family:monospace;font-size:22px;font-weight:800;color:#4338CA;">${reqKey}</span></div>
<div style="padding:28px 32px;"><p style="font-size:14px;color:#172B4D;">Hola <strong>${displayName}</strong>, tu requerimiento fue registrado. El equipo lo atenderá según prioridad.</p>
<table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:16px;">
<tr><td style="padding:10px 14px;background:#F4F5F7;font-weight:700;color:#5E6C84;width:35%;">Resumen</td><td style="padding:10px 14px;background:#FAFBFC;">${summary}</td></tr>
<tr><td style="padding:10px 14px;background:#F4F5F7;font-weight:700;color:#5E6C84;">Tipo</td><td style="padding:10px 14px;background:#FAFBFC;">${tipo||'—'}</td></tr>
</table>
<div style="text-align:center;margin-top:24px;"><a href="${JIRA_HOST}/browse/${reqKey}" style="background:#6366f1;color:#fff;padding:12px 28px;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;">Ver en Jira →</a></div></div>
<div style="background:#F4F5F7;padding:14px 32px;text-align:center;font-size:11px;color:#5E6C84;">Mensaje automático. No responda a este correo.</div></div>`
                });
            } catch(e) { console.warn('⚠️ Email req:', e.message); }
        })();

        res.status(201).json({ success: true, message: `Requerimiento ${reqKey} creado`, data: { key: reqKey, url: `${JIRA_HOST}/browse/${reqKey}`, elapsedMs: Date.now()-start } });
    } catch(err) {
        const d = err.response?.data;
        const msg = d?.errorMessage || (d?.errorMessages||[]).join('; ') || JSON.stringify(d) || err.message;
        console.error('❌ Error creando requerimiento:', msg, d);
        res.status(500).json({ success: false, message: msg, details: d });
    }
});

// PATCH /api/jira/requirement/:key
router.patch('/requirement/:key', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { internal_status, assigned_to, assigned_to_name, resolution_note } = req.body;
    try {
        const sets = [], vals = [];
        if (internal_status) {
            sets.push('internal_status = ?'); vals.push(internal_status);
            if (['resuelto','cerrado'].includes(internal_status)) { sets.push('resolved_at = IFNULL(resolved_at, NOW())'); sets.push('closed_at = NOW()'); }
            if (['asignado','en_progreso'].includes(internal_status)) { sets.push('first_response_at = IFNULL(first_response_at, NOW())'); }
        }
        if (assigned_to)     { sets.push('assigned_to = ?', 'assigned_to_name = ?', 'assigned_at = IFNULL(assigned_at, NOW())'); vals.push(assigned_to, assigned_to_name||''); }
        if (resolution_note) { sets.push('resolution_note = ?'); vals.push(resolution_note); }
        if (!sets.length)    return res.status(400).json({ success: false, message: 'Nada que actualizar' });
        vals.push(key);
        await dbQuery(`UPDATE jira_requirements SET ${sets.join(', ')} WHERE req_key = ?`, vals);
        res.json({ success: true, message: `Requerimiento ${key} actualizado` });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /api/jira/requirement/:key/close
router.post('/requirement/:key/close', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { comment } = req.body;
    if (!comment?.trim()) return res.status(400).json({ success: false, message: 'Comentario requerido' });
    let jiraClosed = false;
    try {
        await jira('POST', `/rest/servicedeskapi/request/${key}/transition`, { id: '11', additionalComment: { body: comment.trim() } });
        jiraClosed = true;
    } catch(e) { console.error('⚠️ Jira close req:', e.response?.data || e.message); }
    try {
        const closedBy = req.user?.full_name || req.user?.username || 'Sistema';
        await dbQuery(`UPDATE jira_requirements SET internal_status='cerrado', status='Resuelto', closed_at=NOW(), closed_by=?, close_comment=?, resolved_at=IFNULL(resolved_at,NOW()) WHERE req_key=?`,
            [closedBy, comment.trim(), key]);
    } catch(e) { return res.status(500).json({ success: false, message: e.message }); }
    res.json({ success: true, jiraClosed, data: { key, url: `${JIRA_HOST}/browse/${key}` } });
});

// PUT /api/jira/requirement/:key/take
router.put('/requirement/:key/take', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const userId = req.user?.id, userName = req.user?.full_name || req.user?.username || 'Técnico';
    try {
        await dbQuery(`UPDATE jira_requirements SET assigned_to=?, assigned_to_name=?, assigned_at=NOW(), internal_status='asignado', first_response_at=IFNULL(first_response_at,NOW()) WHERE req_key=?`, [userId, userName, key]);
        res.json({ success: true, message: `${key} tomado por ${userName}` });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /api/jira/requirements/sync
router.get('/requirements/sync', authenticateToken, async (_req, res) => {
    let synced = 0, errors = 0;
    try {
        const data = await jira('GET', `/rest/servicedeskapi/request?serviceDeskId=${SD_REQ_ID}&limit=100&expand=requestFieldValues,status`);
        for (const item of (data.values || [])) {
            try {
                const fields = {};
                (item.requestFieldValues || []).forEach(f => { fields[f.fieldId] = f.value; });
                const reqKey  = item.issueKey;
                const summary = fields['summary'] || '—';
                const reporter = item.reporter?.emailAddress || item.reporter?.displayName || '—';
                const status  = item.currentStatus?.status || 'Abierto';
                const created = item.createdDate?.iso8601 ? new Date(item.createdDate.iso8601) : new Date();
                await dbQuery(`INSERT INTO jira_requirements (req_key, summary, reporter, status, jira_url, created_at) VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE summary=VALUES(summary), status=VALUES(status), reporter=VALUES(reporter)`,
                    [reqKey, summary, reporter, status, `${JIRA_HOST}/browse/${reqKey}`, created]);
                synced++;
            } catch(e) { errors++; }
        }
        res.json({ success: true, synced, errors });
    } catch(err) { res.status(500).json({ success: false, message: err.response?.data?.errorMessage || err.message }); }
});

// GET /api/jira/req-stats
router.get('/req-stats', authenticateToken, async (_req, res) => {
    try {
        const [total, open, closed, byTipo, byTech] = await Promise.all([
            dbQuery(`SELECT COUNT(*) AS n FROM jira_requirements`),
            dbQuery(`SELECT COUNT(*) AS n FROM jira_requirements WHERE internal_status NOT IN ('resuelto','cerrado')`),
            dbQuery(`SELECT COUNT(*) AS n FROM jira_requirements WHERE internal_status IN ('resuelto','cerrado')`),
            dbQuery(`SELECT IFNULL(tipo,'Sin tipo') AS tipo, COUNT(*) AS n FROM jira_requirements GROUP BY tipo ORDER BY n DESC LIMIT 8`),
            dbQuery(`SELECT IFNULL(assigned_to_name,'Sin asignar') AS tech, COUNT(*) AS n FROM jira_requirements GROUP BY assigned_to ORDER BY n DESC LIMIT 8`),
        ]);
        res.json({ success: true, data: { total: total[0].n, open: open[0].n, closed: closed[0].n, byTipo, byTech } });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /api/jira/req-fields — buscar proyecto del portal 1156 y workspaces de Assets
router.get('/req-fields', authenticateToken, async (req, res) => {
    const jiraGet = async (path) => {
        const r = await axios({ method:'GET', url:`${JIRA_HOST}${path}`, auth,
            headers:{ 'Accept':'application/json', 'X-ExperimentalApi':'opt-in' }, timeout:20000 });
        return r.data;
    };
    try {
        const issueKey = req.query.key;
        const [byId, bySearch, issueR, workspaces] = await Promise.allSettled([
            jiraGet(`/rest/api/2/project/${SD_REQ_ID}`),                        // project ID = 1156?
            jiraGet('/rest/api/2/project/search?query=aplicaci&maxResults=20'), // buscar por nombre
            issueKey ? jiraGet(`/rest/api/2/issue/${issueKey}?fields=project,issuetype,summary,customfield_17777`) : Promise.resolve(null),
            jiraGet('/rest/assets/1.0/workspaces'),                             // Assets workspaces
        ]);
        res.json({
            projectById:  byId.status       === 'fulfilled' ? byId.value       : { error: byId.reason?.message },
            searchResult: bySearch.status   === 'fulfilled' ? bySearch.value   : { error: bySearch.reason?.message },
            issue:        issueR.status     === 'fulfilled' ? issueR.value     : null,
            workspaces:   workspaces.status === 'fulfilled' ? workspaces.value : { error: workspaces.reason?.message },
            SD_REQ_ID, RT_REQ_ID,
        });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});

// ── GET assignee: Jira no tiene GET /assignee — se obtiene desde los fields del issue ──
router.get('/rest/api/:version/issue/:key/assignee', authenticateToken, async (req, res) => {
    const { version, key } = req.params;
    try {
        const r = await axios({
            method: 'GET',
            url: `${JIRA_HOST}/rest/api/${version}/issue/${key}?fields=assignee`,
            auth,
            headers: { 'Accept': 'application/json' },
            timeout: 15000,
            validateStatus: () => true,
        });
        if (!r.data?.fields) return res.status(r.status).json(r.data);
        // Devolver solo el objeto assignee (puede ser null si no tiene asignado)
        res.status(200).json(r.data.fields.assignee || null);
    } catch(e) {
        res.status(500).json({ message: e.message });
    }
});

// ── Proxy genérico REST → reenvía cualquier llamada directa a Jira ──────────
router.all('/rest/*', authenticateToken, async (req, res) => {
    const restPath = '/rest/' + req.params[0];
    const qs       = Object.keys(req.query).length
        ? '?' + new URLSearchParams(req.query).toString()
        : '';
    try {
        const r = await axios({
            method: req.method,
            url:    `${JIRA_HOST}${restPath}${qs}`,
            auth,
            headers: {
                'Accept':            'application/json',
                'Content-Type':      'application/json',
                'X-ExperimentalApi': 'opt-in',
                'X-Atlassian-Token': 'no-check',
            },
            data: ['POST','PUT','PATCH'].includes(req.method.toUpperCase()) ? req.body : undefined,
            timeout: 20000,
            validateStatus: () => true,
        });
        res.status(r.status).json(r.data);
    } catch(e) {
        res.status(500).json({ message: e.message });
    }
});


router.get('/test-close/:key', authenticateToken, async (req, res) => {
    const key = req.params.key;
    try {
        // Paso 1: ver transiciones disponibles
        const trans = await axios({
            method: 'GET',
            url: `${JIRA_HOST}/rest/api/2/issue/${key}/transitions`,
            auth: { username: JIRA_EMAIL, password: JIRA_TOKEN },
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            timeout: 15000,
            validateStatus: () => true,
        });

        // Paso 2: intentar POST de transición con el ID 11
        const closeAttempt = await axios({
            method: 'POST',
            url: `${JIRA_HOST}/rest/api/2/issue/${key}/transitions`,
            auth: { username: JIRA_EMAIL, password: JIRA_TOKEN },
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
            data: { transition: { id: '11' } },
            timeout: 15000,
            validateStatus: () => true,
        });

        res.json({
            email: JIRA_EMAIL,
            getTransitions: {
                status: trans.status,
                isHtml: typeof trans.data === 'string' && trans.data.includes('<HTML>'),
                data: typeof trans.data === 'string' ? trans.data.slice(0, 200) : trans.data,
            },
            postTransition: {
                status: closeAttempt.status,
                isHtml: typeof closeAttempt.data === 'string' && closeAttempt.data.includes('<HTML>'),
                data: typeof closeAttempt.data === 'string' ? closeAttempt.data.slice(0, 200) : closeAttempt.data,
            }
        });
    } catch(e) {
        res.status(500).json({ error: e.message });
    }
});
module.exports = router;


module.exports = router;
            
