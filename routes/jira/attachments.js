
const express = require('express');
const router = express.Router();
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
                auth,
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

const diskStorage = multer.diskStorage({
    destination: (req, _file, cb) => {
        const dir = path.join(__dirname, '../uploads/tickets', req.params.key);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (_req, file, cb) => {
        const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        cb(null, `${Date.now()}_${safe}`);
    }
});
const uploadDisk = multer({
    storage: diskStorage,
    limits: { fileSize: 20 * 1024 * 1024 },  // 20 MB
    fileFilter: (_req, file, cb) => {
        // Bloquear ejecutables
        const blocked = /\.(exe|bat|sh|cmd|msi|vbs|ps1)$/i;
        if (blocked.test(file.originalname)) return cb(new Error('Tipo de archivo no permitido'));
        cb(null, true);
    }
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
    uploadDisk.single('file')(req, res, async (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message });
        if (!req.file) return res.status(400).json({ success: false, message: 'No se recibió archivo' });
        try {
            await dbQuery(
                `INSERT INTO ticket_attachments (ticket_id, user_id, filename, originalname, mimetype, size, path)
                 VALUES (?,?,?,?,?,?,?)`,
                [req.params.key, req.user?.id || 0, req.file.filename, req.file.originalname,
                 req.file.mimetype, req.file.size, req.file.path]
            );
            // Registrar en historial de comentarios como evento
            await dbQuery(
                `INSERT INTO ticket_comments (ticket_id, user_id, contenido, tipo, created_at) VALUES (?,?,?,?,NOW())`,
                [req.params.key, req.user?.id || 0,
                 `📎 Adjunto subido: ${req.file.originalname} (${(req.file.size/1024).toFixed(1)} KB)`,
                 'sistema']
            );
            res.json({ success: true, filename: req.file.filename, originalname: req.file.originalname });
        } catch(e) { res.status(500).json({ success: false, message: e.message }); }
    });
});

// GET /api/jira/ticket/:key/attachments
router.get('/ticket/:key/attachments', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(
            `SELECT ta.*, u.full_name AS uploader_name FROM ticket_attachments ta
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
            `SELECT * FROM ticket_attachments WHERE id=? AND ticket_id=? LIMIT 1`,
            [req.params.id, req.params.key]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Archivo no encontrado' });
        const file = rows[0];
        const absPath = path.resolve(file.path);
        if (!fs.existsSync(absPath)) return res.status(404).json({ success: false, message: 'Archivo eliminado del servidor' });
        const mime = file.mimetype || 'application/octet-stream';
        const inline = /^image\/|\/pdf$/.test(mime);
        res.setHeader('Content-Type', mime);
        res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.originalname)}`);
        res.sendFile(absPath);
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// DELETE /api/jira/ticket/:key/attachments/:id
router.delete('/ticket/:key/attachments/:id', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(
            `SELECT * FROM ticket_attachments WHERE id=? AND ticket_id=? LIMIT 1`,
            [req.params.id, req.params.key]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Adjunto no encontrado' });
        // Solo el uploader o admin puede eliminar
        if (rows[0].user_id !== req.user?.id && req.user?.role !== 'administrador') {
            return res.status(403).json({ success: false, message: 'Sin permiso para eliminar' });
        }
        if (fs.existsSync(rows[0].path)) fs.unlinkSync(rows[0].path);
        await dbQuery(`DELETE FROM ticket_attachments WHERE id=?`, [req.params.id]);
        res.json({ success: true });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});



module.exports = router;
            
