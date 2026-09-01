
const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuth } = require('../../middleware/auth');
const { tenantWhere, tenantParam } = require('../../utils/tenantFilter');
const { jira, dbQuery, upload, assignEmailHtml, sendEmail, getAutomationConfig, mapJiraStatus, mapPriority, extractAdfText, IMPACT_LABELS, URGENCY_LABELS, COMPONENT_LABELS, APP_LABELS, TIPOLOGIA_LABELS, JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, SD_ID, RT_ID } = require('./helpers');
const axios = require('axios');
const FormData = require('form-data');


router.get('/', authenticateToken, (req, res) => {
    res.render('service-management/tickets', {
        title: 'Tickets de Incidencias',
        user: req.user || null,
        currentUserId: req.user?.id || null
    });
});


// ============================================================


router.get('/tickets', authenticateToken, async (req, res) => {
    try {
        // ?source=local → solo TK-% (vista local sin Jira)
        // ?all=1        → incluye resueltos y cerrados (para reportes)
        const localOnly = req.query.source === 'local';
        const includeAll = req.query.all === '1';

        let where = localOnly
            ? `jt.ticket_key LIKE 'TK-%'`
            : `(jt.ticket_key LIKE 'INC-%' OR jt.ticket_key LIKE 'TK-%')`;
        if (!includeAll) where += ` AND jt.internal_status NOT IN ('resuelto','cerrado')`;
        where += tenantWhere(req, 'jt');

        const tickets = await dbQuery(
            `SELECT jt.*, u.full_name AS tech_name
             FROM jira_tickets jt
             LEFT JOIN users u ON u.id = jt.assigned_to AND jt.assigned_to IS NOT NULL AND jt.assigned_to > 0 AND u.deleted_at IS NULL
             WHERE ${where}
             ORDER BY jt.created_at DESC LIMIT 500`
        );
        const data = tickets.map(t => ({
            key:             t.ticket_key,
            summary:         t.summary,
            status:          t.status,
            internal_status: t.internal_status || 'abierto',
            priority:        t.priority || 'P3',
            reporter:        t.reporter,
            urgency:         t.urgency,
            urgency_level:   t.urgency_level,
            impact:          t.impact,
            component:       t.component,
            app_item:        t.app_item,
            tipologia:       t.tipologia,
            assigned_to:     t.assigned_to,
            assigned_to_name:t.tech_name || t.assigned_to_name || null,
            assigned_at:     t.assigned_at,
            first_response_at: t.first_response_at,
            resolved_at:     t.resolved_at,
            sla_deadline:    t.sla_deadline,
            resolution_note: t.resolution_note,
            created:         t.created_at,
            closed_at:       t.closed_at,
            url:             t.jira_url
        }));
        res.json({ success: true, data });
    } catch (error) {
        console.error('Error listando tickets:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ── Helpers para my-tickets ──────────────────────────────────


// ============================================================


router.get('/ticket/:key', authenticateToken, async (req, res) => {
    try {
        const rows = await dbQuery(
            `SELECT * FROM jira_tickets WHERE ticket_key = ?`,
            [req.params.key]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Ticket no encontrado en sistema local' });
        }
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});



// ============================================================


router.put('/ticket/:key/take', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const userId   = req.user?.id;
    const userName = req.user?.full_name || req.user?.username || 'Técnico';
    try {
        const rows = await dbQuery(`SELECT internal_status FROM jira_tickets WHERE ticket_key = ?`, [key]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
        if (rows[0].internal_status !== 'abierto')
            return res.status(400).json({ success: false, message: 'Solo se pueden tomar tickets en estado Abierto' });

        await dbQuery(
            `UPDATE jira_tickets
             SET assigned_to = ?, assigned_to_name = ?, assigned_at = NOW(),
                 internal_status = 'asignado', first_response_at = IFNULL(first_response_at, NOW())
             WHERE ticket_key = ?`,
            [userId, userName, key]
        );
        dbQuery(`INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?, ?, ?, 'asignacion', ?)`,
            [key, userId, userName, `Ticket tomado por ${userName}`]).catch(()=>{});
        // Notificación de asignación la gestiona Jira directamente
        res.json({ success: true, message: `Ticket ${key} asignado a ${userName}` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});



// ============================================================


router.put('/ticket/:key/internal-status', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { status, note } = req.body;
    const validStatuses = ['abierto','asignado','en_progreso','pendiente_usuario','resuelto','cerrado'];
    if (!validStatuses.includes(status))
        return res.status(400).json({ success: false, message: 'Estado inválido' });
    try {
        const extra = status === 'resuelto'
            ? `, resolved_at = NOW(), resolution_note = ${note ? '?' : 'resolution_note'}`
            : '';
        const params = status === 'resuelto' && note
            ? [status, note, key]
            : [status, key];
        await dbQuery(
            `UPDATE jira_tickets SET internal_status = ?${extra} WHERE ticket_key = ?`,
            params
        );
        const actor2 = req.user?.full_name || req.user?.username || 'Sistema';
        dbQuery(`INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?, ?, ?, 'cambio_estado', ?)`,
            [key, req.user?.id||0, actor2, `Estado cambiado a "${status}" por ${actor2}${note ? '. Nota: '+note : ''}`]).catch(()=>{});
        res.json({ success: true, message: `Estado actualizado a ${status}` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});



// ============================================================


router.post('/ticket/:key/comment', authenticateToken, async (req, res) => {
    const { comment, tipo = 'comentario' } = req.body;
    if (!comment?.trim()) return res.status(400).json({ success: false, message: 'Comentario vacío' });
    try {
        const userName = req.user?.full_name || req.user?.username || 'Sistema';
        const esInterno = tipo === 'interno';
        await dbQuery(
            `INSERT INTO ticket_comments (ticket_id, user_id, contenido, tipo, created_at)
             VALUES (?, ?, ?, ?, NOW())`,
            [req.params.key, req.user?.id||0, comment.trim(), tipo]
        );
        // Registrar first_response_at si aún no está seteado (solo comentarios públicos del técnico)
        if (!esInterno && req.user?.id) {
            await dbQuery(
                `UPDATE jira_tickets SET first_response_at = IFNULL(first_response_at, NOW())
                 WHERE ticket_key = ?`,
                [req.params.key]
            );
        }
        res.status(201).json({ success: true, author: userName });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// GET /api/jira/ticket/:key/comments — Obtener comentarios (internos solo para técnicos)
router.get('/ticket/:key/comments', authenticateToken, async (req, res) => {
    try {
        // Los comentarios internos solo los ven usuarios autenticados con role != 'reporter'
        const showInternal = req.user?.role !== 'reporter';
        const rows = await dbQuery(
            `SELECT tc.*, u.full_name AS author_name, u.username
             FROM ticket_comments tc
             LEFT JOIN users u ON u.id = tc.user_id
             WHERE tc.ticket_id = ? ${showInternal ? '' : "AND tc.tipo != 'interno'"}
             ORDER BY tc.created_at ASC`,
            [req.params.key]
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});



// ============================================================


router.get('/ticket/:key/history', authenticateToken, async (req, res) => {
    try {
        const [ticket, history, comments] = await Promise.all([
            dbQuery(`SELECT jt.*, u.full_name AS tech_name
                     FROM jira_tickets jt LEFT JOIN users u ON u.id = jt.assigned_to
                     WHERE jt.ticket_key = ? LIMIT 1`, [req.params.key]),
            dbQuery(`SELECT * FROM ticket_history WHERE ticket_id = ? ORDER BY created_at ASC`, [req.params.key]),
            dbQuery(`SELECT tc.*, u.full_name AS author_name
                     FROM ticket_comments tc LEFT JOIN users u ON u.id = tc.user_id
                     WHERE tc.ticket_id = ? ORDER BY tc.created_at ASC`, [req.params.key])
        ]);

        // Si no está en jira_tickets, buscar en jira_requirements
        if (!ticket.length) {
            const reqRows = await dbQuery(
                `SELECT req_key AS ticket_key, summary, reporter, priority, status,
                        tipo AS component, created_at, jira_url
                 FROM jira_requirements WHERE req_key = ? LIMIT 1`,
                [req.params.key]
            );

            // Ticket en BD local — devolver con historial vacío
            if (reqRows.length) {
                const r = reqRows[0];
                return res.json({
                    success: true,
                    data: {
                        ticket: {
                            key: r.ticket_key, summary: r.summary, reporter: r.reporter,
                            priority: r.priority, internal_status: r.status,
                            created_at: r.created_at, assigned_at: null,
                            resolved_at: null, closed_at: null,
                            sla_deadline: null, tech_name: null,
                            description: null, tipo_atencion: null,
                            close_comment: null, closed_by: null
                        },
                        metrics: { timeUnassigned: null, timeTotal: null, slaOk: null },
                        history: history || [], comments: comments || []
                    }
                });
            }

            // No está en BD local → consultar Jira API directamente
            if (JIRA_TOKEN) {
                try {
                    const _auth = { username: JIRA_EMAIL, password: JIRA_TOKEN };
                    const [issueResp, clResp] = await Promise.all([
                        axios.get(`${JIRA_HOST}/rest/api/3/issue/${req.params.key}?fields=summary,reporter,priority,status,created`, { auth: _auth }),
                        axios.get(`${JIRA_HOST}/rest/api/3/issue/${req.params.key}/changelog?maxResults=100`, { auth: _auth })
                    ]);
                    const f  = issueResp.data.fields || {};
                    const cl = clResp.data.values   || [];
                    const jiraHistory = cl
                        .map(ch => ({
                            ticket_id:  req.params.key,
                            user_name:  ch.author?.displayName || ch.author?.emailAddress || '—',
                            evento:     'cambio_estado',
                            detalle:    (ch.items || []).map(i => `${i.field}: ${i.fromString||'—'} → ${i.toString||'—'}`).join('; '),
                            created_at: ch.created
                        }))
                        .filter(e => e.detalle);
                    return res.json({
                        success: true,
                        data: {
                            ticket: {
                                key:             req.params.key,
                                summary:         f.summary || '',
                                reporter:        f.reporter?.displayName || f.reporter?.emailAddress || '',
                                priority:        f.priority?.name || '',
                                internal_status: f.status?.name  || '',
                                created_at:      f.created || null
                            },
                            metrics: {},
                            history: jiraHistory,
                            comments: []
                        }
                    });
                } catch (_jiraErr) {
                    console.error('[timeline] Jira API error for', req.params.key, _jiraErr.message);
                }
            }

            return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
        }
        const t = ticket[0];

        // Calcular tiempos
        const created   = t.created_at ? new Date(t.created_at) : null;
        const assigned  = t.assigned_at ? new Date(t.assigned_at) : null;
        const resolved  = t.resolved_at ? new Date(t.resolved_at) : null;
        const closed    = t.closed_at   ? new Date(t.closed_at)   : null;
        const now       = new Date();
        const msToH = ms => ms > 0 ? (ms / 3600000).toFixed(1) + 'h' : '—';
        const msToHN= ms => ms > 0 ? parseFloat((ms/3600000).toFixed(1)) : 0;

        const timeUnassigned = assigned && created ? msToHN(assigned - created) : null;
        const timeTotal      = (resolved || closed) && created ? msToHN((resolved||closed) - created) : msToHN(now - created);
        const slaOk          = t.sla_deadline && (resolved||closed) ? new Date(resolved||closed) <= new Date(t.sla_deadline) : null;

        res.json({
            success: true,
            data: {
                ticket: {
                    key: t.ticket_key, summary: t.summary, reporter: t.reporter,
                    priority: t.priority, internal_status: t.internal_status,
                    created_at: t.created_at, assigned_at: t.assigned_at,
                    resolved_at: t.resolved_at, closed_at: t.closed_at,
                    sla_deadline: t.sla_deadline, tech_name: t.tech_name,
                    description: t.description, tipo_atencion: t.tipo_atencion,
                    close_comment: t.close_comment, closed_by: t.closed_by
                },
                metrics: { timeUnassigned, timeTotal, slaOk },
                history, comments
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});



// ============================================================


router.put('/ticket/:key/recategorize', authenticateToken, async (req, res) => {
    const { component, component_id, app, app_id, tipologia, tipologia_id, priority } = req.body;
    try {
        await dbQuery(
            `UPDATE jira_tickets SET
                component=COALESCE(?,component), component_id=COALESCE(?,component_id),
                app_item=COALESCE(?,app_item), app_id=COALESCE(?,app_id),
                tipologia=COALESCE(?,tipologia), tipologia_id=COALESCE(?,tipologia_id),
                priority=COALESCE(?,priority)
             WHERE ticket_key=?`,
            [component, component_id, app, app_id, tipologia, tipologia_id, priority, req.params.key]
        );
        // Log como comentario de sistema
        const user = req.user?.full_name || req.user?.username || 'Sistema';
        await dbQuery(
            `INSERT INTO ticket_comments (ticket_id, user_id, contenido, tipo, created_at)
             VALUES (?, ?, ?, 'cambio_estado', NOW())`,
            [req.params.key, req.user?.id||0, `Recategorizado por ${user}: ${tipologia||''}${priority?' | Prioridad: '+priority:''}`]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});



// ============================================================


router.post('/ticket/:key/send-email', authenticateToken, async (req, res) => {
    const { message } = req.body;
    try {
        const rows = await dbQuery(`SELECT * FROM jira_tickets WHERE ticket_key=?`, [req.params.key]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
        const t = rows[0];
        const techName = req.user?.full_name || req.user?.username || 'Soporte TI';
        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT)||587,
            secure: process.env.SMTP_SECURE==='true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
        await transporter.sendMail({
            from: `"${techName} - Soporte TI" <${process.env.SMTP_USER}>`,
            to: t.reporter,
            subject: `[${req.params.key}] Actualización de tu incidencia`,
            html: `
                <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
                    <div style="background:#0052CC;padding:20px;border-radius:8px 8px 0 0;">
                        <h2 style="color:#fff;margin:0;">Actualización de incidencia</h2>
                    </div>
                    <div style="background:#f4f5f7;padding:20px;border-radius:0 0 8px 8px;">
                        <p><strong>Ticket:</strong> ${req.params.key}</p>
                        <p><strong>Resumen:</strong> ${t.summary}</p>
                        <p><strong>Estado:</strong> ${t.internal_status||t.status}</p>
                        <hr>
                        <p><strong>Mensaje del especialista:</strong></p>
                        <p>${message||'Tu incidencia está siendo atendida.'}</p>
                        <p style="color:#5e6c84;font-size:12px;">Atendido por: ${techName}</p>
                    </div>
                </div>`
        });
        res.json({ success: true, message: `Correo enviado a ${t.reporter}` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});



// ============================================================


router.post('/ticket/:key/reopen', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { motivo = 'Reabierto por el usuario' } = req.body;
    try {
        const rows = await dbQuery(`SELECT internal_status, reporter FROM jira_tickets WHERE ticket_key=? LIMIT 1`, [key]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Ticket no encontrado' });
        if (!['cerrado','resuelto'].includes(rows[0].internal_status))
            return res.status(400).json({ success: false, message: 'Solo se pueden reabrir tickets cerrados o resueltos' });
        const actor = req.user?.full_name || req.user?.username || 'Sistema';
        // Recalcular SLA desde ahora
        const tRow = await dbQuery(`SELECT priority FROM jira_tickets WHERE ticket_key=? LIMIT 1`, [key]);
        const slaHours = { P1:1, P2:4, P3:8, P4:24 };
        const newSla = new Date(Date.now() + (slaHours[tRow[0]?.priority] || 8) * 3600000);
        await dbQuery(
            `UPDATE jira_tickets SET internal_status='abierto', assigned_to=NULL, assigned_to_name=NULL,
             assigned_at=NULL, resolved_at=NULL, closed_at=NULL, sla_deadline=?,
             escalation_notified_at=NULL
             WHERE ticket_key=?`,
            [newSla, key]
        );
        dbQuery(`INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?,?,?,'reapertura',?)`,
            [key, req.user?.id||0, actor, `Ticket reabierto por ${actor}. Motivo: ${motivo}`]).catch(()=>{});
        res.json({ success: true, message: `Ticket ${key} reabierto. Nuevo SLA asignado.` });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});



// ── Crear incidencia local (TK-NNN) ─────────────────────────────────────────
router.post('/ticket/create-local', authenticateToken, async (req, res) => {
    const { summary, description = '', priority = 'P3' } = req.body;
    if (!summary?.trim()) return res.status(400).json({ success: false, message: 'El resumen es obligatorio' });

    const SLA_H = { P1: 1, P2: 4, P3: 8, P4: 24 };
    const slaH = SLA_H[priority] || 8;
    const reporter = req.user?.full_name || req.user?.nombre || req.user?.username || 'Usuario local';

    try {
        // Calcular siguiente número TK
        const rows = await dbQuery(
            `SELECT ticket_key FROM jira_tickets WHERE ticket_key LIKE 'TK-%' ORDER BY id DESC LIMIT 1`
        );
        let nextNum = 1;
        if (rows.length) {
            const m = rows[0].ticket_key.match(/TK-(\d+)/);
            if (m) nextNum = parseInt(m[1], 10) + 1;
        }
        const ticketKey = `TK-${String(nextNum).padStart(3, '0')}`;

        const tenantId = req.user?.tenant_id || null;
        await dbQuery(
            `INSERT INTO jira_tickets
                (ticket_key, summary, reporter, status, internal_status, priority, description, sla_deadline, tenant_id)
             VALUES (?, ?, ?, 'Abierto', 'abierto', ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR), ?)`,
            [ticketKey, summary.trim(), reporter, priority, description.trim(), slaH, tenantId]
        );
        await dbQuery(
            `INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?,?,?,'creacion',?)`,
            [ticketKey, req.user?.id || 0, reporter, `Ticket ${ticketKey} creado por ${reporter}`]
        ).catch(() => {});

        res.json({ success: true, key: ticketKey, message: `Ticket ${ticketKey} creado` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
