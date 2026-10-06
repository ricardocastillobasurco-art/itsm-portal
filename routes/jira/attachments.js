
const express = require('express');
const router = express.Router();
// Toda ruta con :key opera solo sobre tickets del tenant del usuario
router.param('key', require('./helpers').ticketTenantGuard());
const { authenticateToken, optionalAuth } = require('../../middleware/auth');
const { jira, dbQuery, upload, assignEmailHtml, sendEmail, getAutomationConfig, mapJiraStatus, mapPriority, extractAdfText, IMPACT_LABELS, URGENCY_LABELS, COMPONENT_LABELS, APP_LABELS, TIPOLOGIA_LABELS, JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, SD_ID, RT_ID } = require('./helpers');
const axios = require('axios');
const FormData = require('form-data');
const multer = require('multer');


router.post('/attachment', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió archivo' });

        const fd = new FormData();
        fd.append('file', req.file.buffer, {
            filename:    req.file.originalname,
            contentType: req.file.mimetype
        });

        const uploadRes = await axios.post(
            `${JIRA_HOST}/rest/servicedeskapi/servicedesk/${SD_ID}/attachTemporaryFile`,
            fd,
            {
                auth: { username: JIRA_EMAIL, password: JIRA_TOKEN },
                headers: {
                    ...fd.getHeaders(),
                    'X-ExperimentalApi':  'opt-in',
                    'X-Atlassian-Token':  'no-check',
                },
                timeout: 30000
            }
        );

        const attachmentId = uploadRes.data?.temporaryAttachments?.[0]?.temporaryAttachmentId;
        if (!attachmentId) throw new Error('No se obtuvo el ID del adjunto');
        res.json({ success: true, attachmentId });

    } catch (error) {
        console.error('Error subiendo adjunto:', error.response?.data || error.message);
        res.status(500).json({ success: false, message: error.response?.data?.errorMessage || error.message });
    }
});


// ============================================================

const path = require('path');
const fs   = require('fs');

const { saveLocalAttachment, localPathOf, MAX_BYTES, BLOCKED_EXT } = require('../../src/utils/ticketAttachments');
const uploadMemSingle = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES },
    fileFilter: (_req, file, cb) => BLOCKED_EXT.test(file.originalname) ? cb(new Error('Tipo de archivo no permitido')) : cb(null, true),
});

// Migración tabla adjuntos
(async () => {
    try {
        // 1. Eliminar FK que apunta a tickets(id) INT si existe
        try {
            const fks = await dbQuery(`
                SELECT CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = 'ticket_attachments'
                  AND REFERENCED_TABLE_NAME = 'tickets'`);
            for (const fk of fks) {
                await dbQuery(`ALTER TABLE ticket_attachments DROP FOREIGN KEY \`${fk.CONSTRAINT_NAME}\``);
                console.log('[Adjuntos migration] FK eliminado:', fk.CONSTRAINT_NAME);
            }
        } catch(e) { /* tabla no existe aún */ }

        // 2. Crear tabla si no existe
        await dbQuery(`CREATE TABLE IF NOT EXISTS ticket_attachments (
            id           INT AUTO_INCREMENT PRIMARY KEY,
            ticket_id    VARCHAR(50) NOT NULL,
            user_id      INT,
            filename     VARCHAR(255),
            originalname VARCHAR(255),
            mimetype     VARCHAR(100),
            size         INT,
            path         VARCHAR(500),
            created_at   DATETIME DEFAULT NOW(),
            INDEX idx_ta_ticket (ticket_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

        // 3. Agregar columnas faltantes si la tabla ya existía con esquema viejo
        const cols = [
            'originalname VARCHAR(255)',
            'mimetype VARCHAR(100)',
            'size INT',
            'path VARCHAR(500)',
            'user_id INT'
        ];
        for (const col of cols) {
            try { await dbQuery(`ALTER TABLE ticket_attachments ADD COLUMN ${col}`); }
            catch(e) { /* columna ya existe — ignorar */ }
        }

        // 4. Cambiar ticket_id a VARCHAR si está como INT
        try {
            await dbQuery(`ALTER TABLE ticket_attachments MODIFY COLUMN ticket_id VARCHAR(50) NOT NULL`);
        } catch(e) { /* ya es VARCHAR */ }

    } catch(e) { console.error('[Adjuntos migration]', e.message); }
})();

// POST /api/jira/ticket/:key/attachments
router.post('/ticket/:key/attachments', authenticateToken, (req, res) => {
    uploadMemSingle.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message });
        if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió archivo' });
        try {
            const saved = await saveLocalAttachment({ key: req.params.key, original: req.file.originalname,
                mimetype: req.file.mimetype, buffer: req.file.buffer, userId: req.user?.id });
            // Registrar en historial de comentarios como evento
            await dbQuery(
                `INSERT INTO ticket_comments /* tenant_id: ticket_key validado por router.param */ (ticket_id, user_id, contenido, tipo, created_at) VALUES (?,?,?,?,NOW())`,
                [req.params.key, req.user?.id || 0,
                 `📎 Adjunto subido: ${req.file.originalname} (${(req.file.size/1024).toFixed(1)} KB)`,
                 'sistema']
            ).catch(() => {});
            res.json({ success: true, filename: saved.filename, originalname: req.file.originalname });
        } catch(e) { res.status(e.status || 500).json({ success: false, message: e.message }); }
    });
});

// GET /api/jira/ticket/:key/attachments
router.get('/ticket/:key/attachments', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(
            `SELECT ta.*, u.full_name AS uploader_name FROM ticket_attachments ta /* tenant_id: ticket_key validado por router.param */
             LEFT JOIN users u ON u.id = ta.user_id
             WHERE ta.ticket_id = ? ORDER BY ta.created_at DESC`,
            [req.params.key]
        );
        res.json({ success: true, data: rows });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// GET /api/jira/ticket/:key/attachments/:id/download
router.get('/ticket/:key/attachments/:id/download', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(
            `SELECT * FROM ticket_attachments /* tenant_id: ticket_key validado por router.param */ WHERE id=? AND ticket_id=? LIMIT 1`,
            [req.params.id, req.params.key]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
        const file = rows[0];
        const absPath = localPathOf(file, req.params.key);
        if (!absPath) return res.status(404).json({ success: false, message: 'Archivo eliminado del servidor' });
        const mime = file.mimetype || 'application/octet-stream';
        const inline = /^image\/|\/pdf$/.test(mime);
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.originalname || file.original || file.filename)}`);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.sendFile(path.resolve(absPath));
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// DELETE /api/jira/ticket/:key/attachments/:id
router.delete('/ticket/:key/attachments/:id', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(
            `SELECT * FROM ticket_attachments /* tenant_id: ticket_key validado por router.param */ WHERE id=? AND ticket_id=? LIMIT 1`,
            [req.params.id, req.params.key]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Adjunto no encontrado' });
        // Solo el uploader o admin puede eliminar
        if (rows[0].user_id !== req.user?.id && req.user?.role !== 'administrador') {
            return res.status(403).json({ success: false, message: 'Sin permiso para eliminar' });
        }
        const abs = localPathOf(rows[0], req.params.key);
        if (abs) fs.unlinkSync(abs);
        await dbQuery(`DELETE FROM ticket_attachments /* tenant_id: ticket_key validado por router.param */ WHERE id=?`, [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});



// ══════════════════════════════════════════════════════════════════════════════
// ADJUNTOS UNIFICADOS — /api/jira/ticket/:key/files
// Ticket de Jira → los archivos se guardan en Jira (API REST) y se sirven por proxy
// (Jira exige credenciales para verlos). Ticket local (TK-/RQ-) → carpeta uploads.
// Pueden subir/ver: el personal de TI y quien reportó el ticket.
// ══════════════════════════════════════════════════════════════════════════════
const { tenantId: _tenantOf } = require('../../src/utils/tenantScope');
const _FILES_STAFF = ['administrador', 'admin', 'especialista', 'agente', 'tecnico', 'supervisor', 'superadmin'];
const _isLocalKey = (k) => /^(TK|RQ)-/i.test(String(k || ''));
const _jiraAuth = () => ({ username: JIRA_EMAIL, password: JIRA_TOKEN });
const uploadMem = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_BYTES, files: 10 },
    fileFilter: (_req, file, cb) => BLOCKED_EXT.test(file.originalname)
        ? cb(Object.assign(new Error(`Tipo de archivo no permitido: ${file.originalname}`), { status: 400 })) : cb(null, true),
});

// El ticket ya fue validado por router.param (es del tenant); aquí: TI o su reporter
async function _canTouch(req, key) {
    if (_FILES_STAFF.includes(req.user?.role)) return true;
    const table = /^RQ-/i.test(key) ? ['jira_requirements', 'req_key'] : ['jira_tickets', 'ticket_key'];
    const [row] = await dbQuery(`SELECT reporter FROM ${table[0]} /* tenant_id: clave validada por router.param */ WHERE ${table[1]} = ? LIMIT 1`, [key]);
    const me = String(req.user?.email || '').toLowerCase();
    return !!row && !!me && String(row.reporter || '').toLowerCase() === me;
}

async function _localFiles(key) {
    const rows = await dbQuery(
        `SELECT ta.*, u.full_name AS uploader_name FROM ticket_attachments ta /* tenant_id: clave validada por router.param */
         LEFT JOIN users u ON u.id = ta.user_id WHERE ta.ticket_id = ? ORDER BY ta.created_at DESC`, [key]);
    return rows.map(a => ({
        id: String(a.id), source: 'local', name: a.originalname || a.original || a.filename,
        size: a.size || a.size_bytes || 0, mime: a.mimetype || '', created: a.created_at, author: a.uploader_name || null,
        url: `/api/jira/ticket/${encodeURIComponent(key)}/attachments/${a.id}/download`,
    }));
}

// GET /api/jira/ticket/:key/files — adjuntos del ticket (Jira + locales)
router.get('/ticket/:key/files', authenticateToken, async (req, res) => {
    const { key } = req.params;
    try {
        if (!(await _canTouch(req, key))) return res.status(403).json({ success: false, message: 'Sin acceso a este ticket' });
        let files = await _localFiles(key);
        let jiraError = null;
        if (!_isLocalKey(key)) {
            try {
                const issue = await jira('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=attachment`);
                const enc = encodeURIComponent(key);
                files = (issue.fields?.attachment || []).map(a => ({
                    id: String(a.id), source: 'jira', name: a.filename, size: a.size || 0, mime: a.mimeType || '',
                    created: a.created, author: a.author?.displayName || null,
                    url: `/api/jira/ticket/${enc}/files/jira/${a.id}`,
                    thumb: /^image\//.test(a.mimeType || '') ? `/api/jira/ticket/${enc}/files/jira/${a.id}?thumb=1` : null,
                })).concat(files);
            } catch (e) {
                console.warn(`[adjuntos] Jira ${key}:`, e.code || e.response?.status || '', e.message);
                jiraError = 'No se pudo consultar los adjuntos de Jira';
            }
        }
        files.forEach(f => { if (!f.thumb && /^image\//.test(f.mime)) f.thumb = f.url; });
        res.json({ success: true, data: files, jiraError });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// POST /api/jira/ticket/:key/files — sube 1..10 archivos (campo "files")
router.post('/ticket/:key/files', authenticateToken, (req, res) => {
    uploadMem.array('files', 10)(req, res, async (err) => {
        const { key } = req.params;
        if (err) return res.status(err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500)).json({ success: false,
            message: err.code === 'LIMIT_FILE_SIZE' ? 'Cada archivo puede pesar hasta 20 MB' : err.message });
        const files = req.files || [];
        if (!files.length) return res.status(400).json({ success: false, message: 'No se recibió ningún archivo' });
        try {
            if (!(await _canTouch(req, key))) return res.status(403).json({ success: false, message: 'Sin acceso a este ticket' });
            if (_isLocalKey(key)) {
                try { await require('../../src/services/PlanService').assertCanAdd(_tenantOf(req), 'storage_gb', files.reduce((a, f) => a + f.size, 0)); }
                catch (e) { if (e.code === 'PLAN_LIMIT') return res.status(403).json({ success: false, message: e.message, code: e.code }); throw e; }
            }
            const actor = req.user?.full_name || req.user?.username || 'Usuario';
            const done = [];
            if (_isLocalKey(key)) {
                for (const f of files) {
                    await saveLocalAttachment({ key, original: f.originalname, mimetype: f.mimetype, buffer: f.buffer, userId: req.user?.id });
                    done.push(f.originalname);
                }
            } else {
                // Jira: un POST multipart con todos los archivos (cabecera anti-XSRF obligatoria)
                const fd = new FormData();
                files.forEach(f => fd.append('file', f.buffer, { filename: f.originalname, contentType: f.mimetype }));
                await axios.post(`${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(key)}/attachments`, fd, {
                    auth: _jiraAuth(), headers: { ...fd.getHeaders(), 'X-Atlassian-Token': 'no-check' },
                    maxBodyLength: Infinity, maxContentLength: Infinity, timeout: 120000,
                });
                files.forEach(f => done.push(f.originalname));
            }
            if (_isLocalKey(key)) require('../../src/services/PlanService').invalidate(_tenantOf(req));   // espacio usado actualizado
            const list = done.join(', ').slice(0, 900);
            await dbQuery(`INSERT INTO ticket_history /* tenant_id: clave validada por router.param */ (ticket_id, user_id, user_name, evento, detalle)
                           VALUES (?, ?, ?, 'adjunto', ?)`, [key, req.user?.id || 0, actor, `${actor} adjuntó: ${list}`]).catch(() => {});
            const io = req.app.get('io');
            if (io) io.to(require('../../src/utils/tenantTickets').agentsRoom(_tenantOf(req))).emit('ticket:updated', { key, attachments: done.length });
            res.json({ success: true, uploaded: done, message: done.length === 1 ? `Adjunto "${done[0]}" agregado` : `${done.length} adjuntos agregados` });
        } catch (e) {
            const status = e.response?.status;
            const msg = status === 413 ? 'Jira rechazó el archivo por su tamaño'
                : status === 403 ? 'Jira no permite adjuntar en este ticket con la cuenta configurada'
                : (e.status ? e.message : (e.response?.data?.errorMessages?.[0] || e.message));
            res.status(e.status || 502).json({ success: false, message: msg });
        }
    });
});

// Descarga un adjunto de Jira sin reenviar credenciales a otro servidor:
// redirect=false pide el archivo directo; si aun así Jira redirige (al servicio
// de medios de Atlassian, URL firmada), se sigue la redirección SIN Authorization.
// Si una ruta falla (p. ej. bloqueada por un WAF delante de Jira) se prueba la
// siguiente: API REST → ruta web /secure → API de Service Management.
async function _getNoAuthRedirect(url) {
    const r = await axios.get(url, {
        headers: { Authorization: `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64')}`, Accept: '*/*', 'X-ExperimentalApi': 'opt-in' },
        responseType: 'stream', timeout: 60000, maxRedirects: 0, validateStatus: s => s < 400,
    });
    let out = r;
    if (r.status >= 300) {
        r.data.resume();
        if (!r.headers.location) throw Object.assign(new Error(`HTTP ${r.status} sin destino`), { response: { status: 502 } });
        const loc = new URL(r.headers.location, url).toString();
        out = await axios.get(loc, { responseType: 'stream', timeout: 60000, maxRedirects: 3 });
    }
    // Una página HTML (login o bloqueo del WAF) no es el archivo
    if (/text\/html/i.test(out.headers['content-type'] || '')) {
        out.data.resume();
        throw Object.assign(new Error('Jira devolvió una página en lugar del archivo (¿WAF/login?)'), { response: { status: 502 } });
    }
    return out;
}
async function _jiraAttachmentStream(kind, id, att = {}, key = '') {
    const name = encodeURIComponent(att.filename || 'archivo');
    const urls = kind === 'thumbnail'
        ? [`${JIRA_HOST}/rest/api/3/attachment/thumbnail/${id}?redirect=false`, `${JIRA_HOST}/secure/thumbnail/${id}/${name}`]
        : [`${JIRA_HOST}/rest/api/3/attachment/content/${id}?redirect=false`, `${JIRA_HOST}/secure/attachment/${id}/${name}`]
            .concat(key ? [`${JIRA_HOST}/rest/servicedeskapi/request/${encodeURIComponent(key)}/attachment/${id}`] : []);
    let last;
    for (const u of urls) {
        try { return await _getNoAuthRedirect(u); }
        catch (e) {
            last = e;
            console.warn(`[adjuntos] ${u.replace(JIRA_HOST, '')} →`, e.response?.status || e.code || '', e.message);
        }
    }
    throw last;
}
const _attErrorPage = (msg) => `<!doctype html><meta charset="utf-8"><title>Adjunto</title>
<body style="font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;min-height:90vh;color:#334155;background:#f8fafc">
<div style="text-align:center;max-width:420px"><div style="font-size:40px">📎</div><h3 style="margin:8px 0">No se pudo abrir el adjunto</h3>
<p style="font-size:14px;color:#64748b">${String(msg).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c])}</p></div></body>`;

// GET /api/jira/ticket/:key/files/jira/:id[?thumb=1] — muestra/descarga un adjunto de Jira
router.get('/ticket/:key/files/jira/:id', authenticateToken, async (req, res) => {
    const { key, id } = req.params;
    const thumb = !!req.query.thumb;
    const fail = (status, msg) => thumb ? res.status(status).end() : res.status(status).type('html').send(_attErrorPage(msg));
    try {
        if (_isLocalKey(key) || !/^\d+$/.test(id)) return fail(404, 'El adjunto no existe.');
        if (!(await _canTouch(req, key))) return fail(403, 'No tienes acceso a este ticket.');
        // El adjunto debe pertenecer a ESTE ticket (no se sirven adjuntos de otros tickets)
        const issue = await jira('GET', `/rest/api/3/issue/${encodeURIComponent(key)}?fields=attachment`);
        const att = (issue.fields?.attachment || []).find(a => String(a.id) === id);
        if (!att) return fail(404, 'El adjunto ya no está en el ticket.');
        let r;
        try { r = await _jiraAttachmentStream(thumb ? 'thumbnail' : 'content', id, att, key); }
        catch (e) {
            // Sin miniatura en Jira (archivo muy pequeño o formato raro): se usa la imagen original
            if (!thumb || !/^image\//.test(att.mimeType || '')) throw e;
            r = await _jiraAttachmentStream('content', id, att, key);
        }
        const mime = thumb ? (r.headers['content-type'] || 'image/png') : (att.mimeType || 'application/octet-stream');
        const inline = /^image\/|\/pdf$|^text\/plain/.test(mime);
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        r.data.on('error', () => res.destroy());
        r.data.pipe(res);
    } catch (e) {
        console.warn(`[adjuntos] descarga ${key}/${id}${thumb ? ' (miniatura)' : ''}:`, e.response?.status || e.code || '', e.message);
        if (res.headersSent) return res.destroy();
        const st = e.response?.status;
        fail(st === 404 ? 404 : 502, st === 404 ? 'Jira ya no tiene este archivo.' : 'Jira no respondió al pedir el archivo. Intenta de nuevo en unos segundos.');
    }
});

module.exports = router;
            

module.exports._jiraAttachmentStream = _jiraAttachmentStream; // pruebas
