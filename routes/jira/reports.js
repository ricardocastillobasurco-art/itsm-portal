
const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuth } = require('../../middleware/auth');
const { jira, dbQuery, upload, assignEmailHtml, sendEmail, getAutomationConfig, mapJiraStatus, mapPriority, extractAdfText, IMPACT_LABELS, URGENCY_LABELS, COMPONENT_LABELS, APP_LABELS, TIPOLOGIA_LABELS, JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, SD_ID, RT_ID, loadAgentCache } = require('./helpers');
const { getSettings: getItsmSettings } = require('./config_itsm');
const { tenantWhere } = require('../../utils/tenantFilter');
const axios = require('axios');
const FormData = require('form-data');


// ── Auto-migration + precarga de caché de agentes ─────────────────────────────
(async () => {
    try { await dbQuery(`ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS jira_assignee VARCHAR(200) DEFAULT NULL`); } catch(e) {}
    try { await dbQuery(`ALTER TABLE jira_tickets ADD COLUMN IF NOT EXISTS jira_account_id VARCHAR(200) DEFAULT NULL`); } catch(e) {}
    // Precargar caché de agentes Jira al arrancar
    setTimeout(() => loadAgentCache().catch(() => {}), 3000);
})();

// ── Refrescar caché de agentes ─────────────────────────────────────────────────
router.post('/agents-cache/refresh', authenticateToken, async (_req, res) => {
    try {
        const cache = await loadAgentCache(true);
        res.json({ success: true, count: cache.size, agents: [...cache.entries()].map(([email, v]) => ({ email, ...v })) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.get('/stats/backlog', authenticateToken, async (req, res) => {
    try {
        const tw = tenantWhere(req);
        const [openRows, resolvedRows, slaRows] = await Promise.all([
            dbQuery(`SELECT COUNT(*) AS cnt FROM jira_tickets WHERE internal_status NOT IN ('resuelto','cerrado')${tw}`),
            dbQuery(`SELECT COUNT(*) AS cnt FROM jira_tickets WHERE internal_status IN ('resuelto','cerrado') AND DATE(resolved_at) = CURDATE()${tw}`),
            dbQuery(`SELECT SUM(resolved_at IS NOT NULL AND resolved_at <= sla_deadline) AS ok, COUNT(*) AS total FROM jira_tickets WHERE resolved_at IS NOT NULL AND sla_deadline IS NOT NULL${tw}`)
        ]);
        const open     = Number(openRows[0]?.cnt     ?? 0);
        const resolved = Number(resolvedRows[0]?.cnt ?? 0);
        const slaOk    = Number(slaRows[0]?.ok       ?? 0);
        const slaTotal = Number(slaRows[0]?.total    ?? 0);
        const sla_pct  = slaTotal > 0 ? Math.round((slaOk / slaTotal) * 100) : null;
        res.json({ open, resolved, sla_pct });
    } catch (e) {
        res.json({ open: null, resolved: null, sla_pct: null });
    }
});

router.get('/stats', authenticateToken, async (_req, res) => {
    try {
        const [byTech, slaStats, unassigned30, weekly, topReporters, topEquipos, topCategorias] = await Promise.all([
            // Por técnico — combina asignaciones locales Y técnicos de Jira
            dbQuery(`
                SELECT
                    COALESCE(u.full_name, jt.jira_assignee, 'Sin asignar') AS tech,
                    u.id AS tech_id,
                    COUNT(jt.id) AS total,
                    SUM(jt.internal_status IN ('resuelto','cerrado')) AS resolved,
                    SUM(jt.internal_status NOT IN ('resuelto','cerrado')) AS open,
                    AVG(TIMESTAMPDIFF(MINUTE, jt.created_at, jt.resolved_at)) AS avg_min
                FROM jira_tickets jt
                LEFT JOIN users u ON u.id = jt.assigned_to
                WHERE jt.assigned_to IS NOT NULL OR jt.jira_assignee IS NOT NULL
                GROUP BY COALESCE(u.full_name, jt.jira_assignee)
                ORDER BY resolved DESC
            `),
            // SLA cumplimiento
            dbQuery(`
                SELECT
                    SUM(resolved_at IS NOT NULL AND resolved_at <= sla_deadline) AS dentro_sla,
                    SUM(resolved_at IS NOT NULL AND resolved_at > sla_deadline)  AS fuera_sla,
                    SUM(resolved_at IS NULL AND NOW() > sla_deadline)            AS vencidos_abiertos
                FROM jira_tickets WHERE sla_deadline IS NOT NULL
            `),
            // Sin asignar más de 30 min
            dbQuery(`
                SELECT COUNT(*) AS cnt FROM jira_tickets
                WHERE assigned_to IS NULL
                  AND internal_status = 'abierto'
                  AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) > 30
            `),
            // Semanal por técnico (últimos 7 días)
            dbQuery(`
                SELECT
                    COALESCE(u.full_name, jt.jira_assignee, 'Sin asignar') AS tech,
                    SUM(jt.internal_status IN ('resuelto','cerrado') AND jt.resolved_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))  AS semana,
                    SUM(jt.internal_status IN ('resuelto','cerrado') AND jt.resolved_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)) AS mes
                FROM jira_tickets jt
                LEFT JOIN users u ON u.id = jt.assigned_to
                WHERE jt.assigned_to IS NOT NULL OR jt.jira_assignee IS NOT NULL
                GROUP BY COALESCE(u.full_name, jt.jira_assignee)
                ORDER BY semana DESC
            `),
            // Top reporters
            dbQuery(`
                SELECT reporter, COUNT(*) AS total
                FROM jira_tickets
                WHERE reporter IS NOT NULL AND reporter != ''
                GROUP BY reporter ORDER BY total DESC LIMIT 10
            `),
            // Top equipos (desde campo summary o tipologia — usamos reporter como proxy de equipo asignado via employee)
            dbQuery(`
                SELECT COALESCE(tipologia, component, 'Sin categoría') AS equipo_label,
                       COUNT(*) AS total
                FROM jira_tickets
                WHERE tipologia IS NOT NULL OR component IS NOT NULL
                GROUP BY equipo_label ORDER BY total DESC LIMIT 10
            `),
            // Top categorías (summary de la categoría elegida)
            dbQuery(`
                SELECT summary, COUNT(*) AS total
                FROM jira_tickets
                WHERE summary IS NOT NULL AND summary != ''
                GROUP BY summary ORDER BY total DESC LIMIT 10
            `)
        ]);
        // MTTR
        const mttrRows = await dbQuery(`
            SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at)) AS mttr_min
            FROM jira_tickets WHERE resolved_at IS NOT NULL
        `);
        // Evolución diaria últimos 30 días
        const evolucion = await dbQuery(`
            SELECT DATE(created_at) AS dia, COUNT(*) AS total,
                   SUM(internal_status='cerrado') AS cerrados
            FROM jira_tickets
            WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
            GROUP BY DATE(created_at) ORDER BY dia ASC
        `);
        // Alertas en tiempo real
        const [alertaSLA, alertaCriticos, alertaSinAsignar] = await Promise.all([
            dbQuery(`SELECT COUNT(*) AS cnt FROM jira_tickets
                     WHERE sla_deadline IS NOT NULL AND resolved_at IS NULL
                       AND TIMESTAMPDIFF(MINUTE, NOW(), sla_deadline) BETWEEN 0 AND 10`),
            dbQuery(`SELECT COUNT(*) AS cnt FROM jira_tickets
                     WHERE priority='P1' AND internal_status NOT IN ('resuelto','cerrado')`),
            dbQuery(`SELECT COUNT(*) AS cnt FROM jira_tickets
                     WHERE assigned_to IS NULL AND internal_status='abierto'
                       AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) > 30`)
        ]);
        const mttr_min = mttrRows[0]?.mttr_min || 0;

        // Distribución por prioridad y estado
        const [porPrioridad, porEstado] = await Promise.all([
            dbQuery(`SELECT priority, COUNT(*) AS total FROM jira_tickets
                     WHERE internal_status NOT IN ('cerrado','resuelto') GROUP BY priority ORDER BY priority`),
            dbQuery(`SELECT internal_status, COUNT(*) AS total FROM jira_tickets
                     WHERE internal_status NOT IN ('cerrado') GROUP BY internal_status ORDER BY total DESC`)
        ]);

        // Tickets en riesgo / breach de SLA
        const slaBreachTickets = await dbQuery(`
            SELECT jt.ticket_key,
                   SUBSTRING(jt.summary, 1, 55) AS summary,
                   jt.priority,
                   COALESCE(jt.assigned_to_name, jt.jira_assignee, 'Sin asignar') AS tech,
                   jt.internal_status,
                   CASE
                     WHEN NOW() > jt.sla_deadline THEN 0
                     ELSE GREATEST(0, LEAST(100, ROUND(
                       (1 - GREATEST(0, TIMESTAMPDIFF(MINUTE, NOW(), jt.sla_deadline)) /
                            NULLIF(TIMESTAMPDIFF(MINUTE, jt.created_at, jt.sla_deadline), 0)) * 100
                     , 0)))
                   END AS sla_pct,
                   ROUND(TIMESTAMPDIFF(MINUTE, jt.created_at, NOW()) / 60, 1) AS mttr_h
            FROM jira_tickets jt
            WHERE jt.sla_deadline IS NOT NULL
              AND jt.internal_status NOT IN ('cerrado','resuelto')
              AND jt.sla_deadline <= DATE_ADD(NOW(), INTERVAL 4 HOUR)
            ORDER BY jt.sla_deadline ASC
            LIMIT 10
        `);

        // MTTR por categoría
        const mttrByCat = await dbQuery(`
            SELECT COALESCE(tipologia, component, 'General') AS cat,
                   ROUND(AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at)) / 60, 1) AS mttr_h
            FROM jira_tickets
            WHERE resolved_at IS NOT NULL
            GROUP BY cat
            ORDER BY mttr_h DESC
            LIMIT 6
        `);

        // CSAT y FCR
        const [csatRows, fcrRows] = await Promise.all([
            dbQuery(`SELECT ROUND(AVG(rating), 1) AS avg_rating FROM ticket_surveys WHERE rating > 0 AND skipped = 0`).catch(() => [{}]),
            dbQuery(`SELECT COUNT(*) AS total, SUM(TIMESTAMPDIFF(HOUR, created_at, resolved_at) < 8) AS fcr FROM jira_tickets WHERE resolved_at IS NOT NULL`).catch(() => [{}])
        ]);
        const fcr_total = Number(fcrRows[0]?.total) || 0;
        const fcr_pct = fcr_total > 0 ? Math.round(Number(fcrRows[0]?.fcr || 0) / fcr_total * 100) : 0;

        res.json({ success: true, data: {
            byTech, slaStats: slaStats[0], unassigned30: unassigned30[0]?.cnt||0,
            weekly, topReporters, topEquipos, topCategorias, evolucion,
            porPrioridad, porEstado,
            mttr: mttr_min < 60 ? Math.round(mttr_min)+'min' : (mttr_min/60).toFixed(1)+'h',
            alertas: {
                slaPorVencer: alertaSLA[0]?.cnt||0,
                criticos:     alertaCriticos[0]?.cnt||0,
                sinAsignar:   alertaSinAsignar[0]?.cnt||0
            },
            slaBreachTickets,
            mttrByCat,
            csat: Number(csatRows[0]?.avg_rating) || 0,
            fcr_pct
        }});
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// ── Indicadores de técnicos locales ──────────────────────────
router.get('/local/stats', authenticateToken, async (_req, res) => {
    try {
        const [techStats, summary, byStatus, byPriority, evolucion, mttrByCat, csatRows] = await Promise.all([
            // Por técnico
            dbQuery(`
                SELECT u.id, u.full_name AS tech, u.email, u.role,
                    COUNT(jt.id)                                                        AS total,
                    SUM(jt.internal_status = 'abierto')                                AS open_tickets,
                    SUM(jt.internal_status = 'en_progreso')                            AS in_progress,
                    SUM(jt.internal_status = 'pendiente_usuario')                      AS pendiente,
                    SUM(jt.internal_status IN ('resuelto','cerrado'))                  AS resolved,
                    AVG(TIMESTAMPDIFF(MINUTE, jt.created_at, jt.resolved_at))         AS avg_min,
                    SUM(jt.resolved_at IS NOT NULL AND jt.resolved_at <= jt.sla_deadline) AS sla_ok,
                    SUM(jt.resolved_at IS NOT NULL AND jt.resolved_at >  jt.sla_deadline) AS sla_bad
                FROM users u
                LEFT JOIN jira_tickets jt ON jt.assigned_to = u.id AND jt.ticket_key LIKE 'TK-%'
                WHERE u.is_active = 1 AND u.deleted_at IS NULL
                  AND u.role IN ('especialista','administrador','agente','tecnico')
                GROUP BY u.id
                ORDER BY (SUM(jt.internal_status NOT IN ('resuelto','cerrado','abierto'))) DESC, total DESC
            `),
            // Resumen global (TK-%)
            dbQuery(`
                SELECT
                    COUNT(*) AS total,
                    SUM(internal_status NOT IN ('resuelto','cerrado'))           AS activos,
                    SUM(internal_status = 'abierto' AND assigned_to IS NULL)    AS sin_asignar,
                    SUM(internal_status IN ('resuelto','cerrado'))               AS cerrados,
                    SUM(priority = 'P1' AND internal_status NOT IN ('resuelto','cerrado')) AS p1_activos,
                    SUM(resolved_at IS NOT NULL AND resolved_at <= sla_deadline) AS sla_ok,
                    SUM(resolved_at IS NOT NULL AND resolved_at >  sla_deadline) AS sla_bad,
                    AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at))          AS mttr_min,
                    SUM(MONTH(created_at)=MONTH(NOW()) AND YEAR(created_at)=YEAR(NOW())) AS este_mes
                FROM jira_tickets WHERE ticket_key LIKE 'TK-%'
            `),
            // Por estado activos
            dbQuery(`
                SELECT internal_status, COUNT(*) AS total
                FROM jira_tickets WHERE internal_status != 'cerrado' AND ticket_key LIKE 'TK-%'
                GROUP BY internal_status ORDER BY total DESC
            `),
            // Por prioridad (todos)
            dbQuery(`
                SELECT priority, COUNT(*) AS total
                FROM jira_tickets WHERE ticket_key LIKE 'TK-%'
                GROUP BY priority ORDER BY FIELD(priority,'P1','P2','P3','P4')
            `),
            // Evolución diaria últimos 30 días
            dbQuery(`
                SELECT DATE(created_at) AS dia,
                       COUNT(*) AS total,
                       SUM(internal_status IN ('resuelto','cerrado')) AS cerrados
                FROM jira_tickets
                WHERE ticket_key LIKE 'TK-%'
                  AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                GROUP BY DATE(created_at) ORDER BY dia ASC
            `),
            // MTTR por categoría
            dbQuery(`
                SELECT COALESCE(tipologia, component, 'General') AS cat,
                       ROUND(AVG(TIMESTAMPDIFF(MINUTE, created_at, resolved_at)) / 60, 1) AS mttr_h,
                       COUNT(*) AS total
                FROM jira_tickets
                WHERE ticket_key LIKE 'TK-%' AND resolved_at IS NOT NULL
                GROUP BY cat ORDER BY mttr_h DESC LIMIT 8
            `),
            // CSAT de itsm_surveys
            dbQuery(`SELECT ROUND(AVG(rating),1) AS avg_rating, COUNT(*) AS total FROM itsm_surveys WHERE rating IS NOT NULL`).catch(()=>[{}])
        ]);

        const s = summary[0] || {};
        const slaOk = Number(s.sla_ok)||0, slaBad = Number(s.sla_bad)||0;
        const slaPct = (slaOk+slaBad)>0 ? Math.round(slaOk/(slaOk+slaBad)*100) : 100;
        const mttr_min = Number(s.mttr_min)||0;

        res.json({ success: true, data: {
            techStats,
            summary: {
                total:       Number(s.total)||0,
                activos:     Number(s.activos)||0,
                sin_asignar: Number(s.sin_asignar)||0,
                cerrados:    Number(s.cerrados)||0,
                p1_activos:  Number(s.p1_activos)||0,
                sla_pct:     slaPct,
                este_mes:    Number(s.este_mes)||0,
                mttr:        mttr_min < 60 ? Math.round(mttr_min)+'min' : (mttr_min/60).toFixed(1)+'h',
                csat:        Number(csatRows[0]?.avg_rating)||0,
            },
            byStatus,
            byPriority,
            evolucion,
            mttrByCat,
        }});
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

// ============================================================

router.get('/alerts', authenticateToken, async (req, res) => {
    try {
        const _cfg   = getItsmSettings();
        const _win   = Math.max(1, parseInt(_cfg?.alerts?.window_minutes) || 10);
        // source=local → solo TK-%; default → todos (INC-% + TK-%)
        const srcFilter = req.query.source === 'local' ? `AND ticket_key LIKE 'TK-%'` : '';
        const [sla, criticos, sinAsignar, breachRows] = await Promise.all([
            dbQuery(`SELECT COUNT(*) AS cnt FROM jira_tickets
                     WHERE sla_deadline IS NOT NULL AND resolved_at IS NULL
                       AND TIMESTAMPDIFF(MINUTE, NOW(), sla_deadline) BETWEEN 0 AND ${_win} ${srcFilter}`),
            dbQuery(`SELECT COUNT(*) AS cnt FROM jira_tickets
                     WHERE priority='P1' AND internal_status NOT IN ('resuelto','cerrado') ${srcFilter}`),
            dbQuery(`SELECT COUNT(*) AS cnt FROM jira_tickets
                     WHERE assigned_to IS NULL AND internal_status='abierto'
                       AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) > 30 ${srcFilter}`),
            dbQuery(`SELECT ticket_key FROM jira_tickets
                     WHERE sla_deadline IS NOT NULL AND resolved_at IS NULL AND sla_deadline < NOW() ${srcFilter}
                     ORDER BY sla_deadline ASC LIMIT 20`)
        ]);
        res.json({ success: true, data: {
            slaPorVencer: sla[0]?.cnt||0,
            criticos:     criticos[0]?.cnt||0,
            sinAsignar:   sinAsignar[0]?.cnt||0,
            breachKeys:   breachRows.map(r => r.ticket_key)
        }});
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// KPIs del dashboard admin — Jira Workplace directo
router.get('/dashboard/kpis', authenticateToken, async (_req, res) => {
    try {
        const today = new Date().toISOString().slice(0, 10);
        const [sinAsigR, resueltosR] = await Promise.all([
            jira('GET', `/rest/api/3/search?jql=${encodeURIComponent('project = INC AND "Tipo de Componente" = Workplace AND status not in ("Cerrado","Closed","Resuelto","Resolved","Done","Cancelado","Cancelled") AND assignee is EMPTY')}&maxResults=0`),
            jira('GET', `/rest/api/3/search?jql=${encodeURIComponent(`project = INC AND "Tipo de Componente" = Workplace AND resolutiondate >= "${today}"`)}&maxResults=0`),
        ]);
        res.json({ success: true, sin_asignar: sinAsigR.total ?? 0, resueltos_hoy: resueltosR.total ?? 0 });
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

router.get('/noc/stats', authenticateToken, async (_req, res) => {
    try {
        const [abiertos, breach, sinAsig, p1, topTecs, porPrio, recientes] = await Promise.all([
            dbQuery(`SELECT COUNT(*) AS n FROM jira_tickets WHERE internal_status NOT IN ('resuelto','cerrado')`),
            dbQuery(`SELECT COUNT(*) AS n FROM jira_tickets WHERE sla_deadline IS NOT NULL AND resolved_at IS NULL AND sla_deadline < NOW()`),
            dbQuery(`SELECT COUNT(*) AS n FROM jira_tickets WHERE assigned_to IS NULL AND internal_status='abierto' AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) > 30`),
            dbQuery(`SELECT COUNT(*) AS n FROM jira_tickets WHERE priority='P1' AND internal_status NOT IN ('resuelto','cerrado')`),
            dbQuery(`SELECT assigned_to_name AS nombre, COUNT(*) AS resueltos FROM jira_tickets WHERE DATE(resolved_at) = CURDATE() AND assigned_to_name IS NOT NULL GROUP BY assigned_to_name ORDER BY resueltos DESC LIMIT 5`),
            dbQuery(`SELECT priority, COUNT(*) AS n FROM jira_tickets WHERE internal_status NOT IN ('resuelto','cerrado') GROUP BY priority ORDER BY FIELD(priority,'P1','P2','P3','P4') LIMIT 6`),
            dbQuery(`SELECT ticket_key, summary, priority, internal_status, assigned_to_name, created_at FROM jira_tickets WHERE internal_status NOT IN ('resuelto','cerrado') ORDER BY created_at DESC LIMIT 8`)
        ]);

        // Resueltos hoy desde Jira API directamente
        let resueltos_hoy = 0;
        try {
            const today = new Date().toISOString().slice(0, 10);
            const r = await jira('GET', `/rest/api/3/search?jql=${encodeURIComponent(`project = INC AND resolutiondate >= "${today}"`)}&maxResults=0`);
            resueltos_hoy = r.total ?? 0;
        } catch (_) {
            const [fb] = await dbQuery(`SELECT COUNT(*) AS n FROM jira_tickets WHERE internal_status IN ('resuelto','cerrado') AND DATE(COALESCE(resolved_at,updated_at)) = CURDATE()`);
            resueltos_hoy = Number(fb?.n ?? 0);
        }

        res.json({ success: true, ts: Date.now(), data: {
            abiertos:      abiertos[0]?.n  || 0,
            breach:        breach[0]?.n    || 0,
            resueltos_hoy,
            sin_asignar:   sinAsig[0]?.n   || 0,
            p1_criticos:   p1[0]?.n        || 0,
            top_tecnicos:  topTecs,
            por_prioridad: porPrio,
            recientes
        }});
    } catch(e) {
        res.status(500).json({ success: false, error: e.message });
    }
});


// ============================================================

router.get('/report', authenticateToken, async (req, res) => {
    const { estado, prioridad, agente, desde, hasta, q } = req.query;
    try {
        let sql = `SELECT jt.ticket_key, jt.summary, jt.reporter, jt.priority,
                          jt.internal_status, jt.status, jt.assigned_to_name,
                          jt.created_at, jt.resolved_at, jt.closed_at,
                          jt.tipo_atencion, jt.sla_deadline, jt.description,
                          jt.component, jt.tipologia,
                          TIMESTAMPDIFF(MINUTE, jt.created_at, COALESCE(jt.resolved_at, NOW())) AS min_total
                   FROM jira_tickets jt WHERE 1=1`;
        const params = [];
        if (estado)   { sql += ' AND jt.internal_status=?';    params.push(estado); }
        if (prioridad){ sql += ' AND jt.priority=?';           params.push(prioridad); }
        if (agente)   { sql += ' AND jt.assigned_to=?';        params.push(agente); }
        if (desde)    { sql += ' AND DATE(jt.created_at)>=?';  params.push(desde); }
        if (hasta)    { sql += ' AND DATE(jt.created_at)<=?';  params.push(hasta); }
        if (q)        { sql += ' AND (jt.ticket_key LIKE ? OR jt.summary LIKE ? OR jt.reporter LIKE ?)';
                        params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
        sql += ' ORDER BY jt.created_at DESC LIMIT 5000';
        const rows = await dbQuery(sql, params);
        res.json({ success: true, data: rows, total: rows.length });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// ============================================================

router.post('/report/send-email', authenticateToken, async (req, res) => {
    const { to, desde, hasta, asunto } = req.body;
    try {
        const rows = await dbQuery(`
            SELECT ticket_key, summary, reporter, priority, internal_status,
                   assigned_to_name, created_at, resolved_at
            FROM jira_tickets
            WHERE DATE(created_at) BETWEEN ? AND ?
            ORDER BY created_at DESC`, [desde||'2000-01-01', hasta||'2099-01-01']);

        const nodemailer = require('nodemailer');
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT)||587,
            secure: process.env.SMTP_SECURE==='true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        });
        const tableRows = rows.map(r=>`<tr>
            <td style="padding:6px 10px;border:1px solid #dfe1e6;">${r.ticket_key}</td>
            <td style="padding:6px 10px;border:1px solid #dfe1e6;">${r.summary}</td>
            <td style="padding:6px 10px;border:1px solid #dfe1e6;">${r.reporter||'—'}</td>
            <td style="padding:6px 10px;border:1px solid #dfe1e6;">${r.priority||'—'}</td>
            <td style="padding:6px 10px;border:1px solid #dfe1e6;">${r.internal_status||'—'}</td>
            <td style="padding:6px 10px;border:1px solid #dfe1e6;">${r.assigned_to_name||'Sin asignar'}</td>
            <td style="padding:6px 10px;border:1px solid #dfe1e6;">${r.created_at?new Date(r.created_at).toLocaleDateString('es-PE'):'—'}</td>
        </tr>`).join('');
        await transporter.sendMail({
            from: `"Service Desk TI" <${process.env.SMTP_USER}>`,
            to: to || process.env.SMTP_USER,
            subject: asunto || `Reporte ITSM — ${desde} al ${hasta}`,
            html: `<html><body style="font-family:Arial,sans-serif;">
                <h2 style="color:#0052CC;">Reporte de Incidencias</h2>
                <p>Período: <strong>${desde}</strong> al <strong>${hasta}</strong> · Total: <strong>${rows.length}</strong></p>
                <table style="border-collapse:collapse;width:100%;font-size:12px;">
                <thead><tr style="background:#0052CC;color:#fff;">
                    <th style="padding:8px 10px;">Clave</th><th style="padding:8px 10px;">Resumen</th>
                    <th style="padding:8px 10px;">Reporter</th><th style="padding:8px 10px;">Prioridad</th>
                    <th style="padding:8px 10px;">Estado</th><th style="padding:8px 10px;">Técnico</th>
                    <th style="padding:8px 10px;">Fecha</th>
                </tr></thead><tbody>${tableRows}</tbody></table>
            </body></html>`
        });
        res.json({ success: true, message: `Reporte enviado a ${to}`, total: rows.length });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// ============================================================

router.get('/survey-results', authenticateToken, async (_req, res) => {
    try {
        const rows = await dbQuery(`
            SELECT s.ticket_key, s.reporter_email, s.rating, s.comment,
                   s.sent_at, s.responded_at,
                   jt.summary
            FROM itsm_surveys s
            LEFT JOIN jira_tickets jt ON jt.ticket_key = s.ticket_key
            ORDER BY s.sent_at DESC LIMIT 100
        `);
        const stats = await dbQuery(`
            SELECT COUNT(*) AS total,
                   SUM(rating IS NOT NULL) AS respondidas,
                   ROUND(AVG(rating), 1) AS promedio
            FROM itsm_surveys
        `);
        res.json({ success: true, data: rows, stats: stats[0] });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});


// ============================================================

router.get('/survey/:token', async (req, res) => {
    try {
        const rows = await dbQuery(`SELECT * FROM itsm_surveys WHERE token=? LIMIT 1`, [req.params.token]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Encuesta no encontrada' });
        res.json({ success: true, data: rows[0] });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});

router.post('/survey/:token', async (req, res) => {
    try {
        const { rating, comment = '' } = req.body;
        if (!rating || rating < 1 || rating > 5) return res.status(400).json({ success: false, message: 'Rating inválido (1-5)' });
        const rows = await dbQuery(`SELECT * FROM itsm_surveys WHERE token=? AND rating IS NULL LIMIT 1`, [req.params.token]);
        if (!rows.length) return res.status(400).json({ success: false, message: 'Encuesta ya respondida o no existe' });
        await dbQuery(`UPDATE itsm_surveys SET rating=?, comment=?, responded_at=NOW() WHERE token=?`, [rating, comment, req.params.token]);
        res.json({ success: true, message: '¡Gracias por tu calificación!' });
    } catch(e) { res.status(500).json({ success: false, message: e.message }); }
});


// ============================================================

router.get('/kb/suggest', authenticateToken, async (req, res) => {
    const q = (req.query.q || '').trim();
    if (q.length < 3) return res.json({ success: true, data: [] });
    try {
        // Busca en knowledge_base_articles si existe, si no retorna vacío
        const words = q.split(/\s+/).filter(w => w.length > 2).slice(0, 5);
        if (!words.length) return res.json({ success: true, data: [] });

        const conditions = words.map(() => '(titulo LIKE ? OR contenido LIKE ? OR tags LIKE ?)').join(' OR ');
        const params = words.flatMap(w => [`%${w}%`, `%${w}%`, `%${w}%`]);

        let rows = [];
        try {
            rows = await dbQuery(
                `SELECT id, titulo, resumen, url_slug, vistas FROM knowledge_base_articles
                 WHERE is_published = 1 AND (${conditions})
                 ORDER BY vistas DESC LIMIT 4`,
                params
            );
        } catch(tableErr) {
            // Tabla no existe aún — retorna vacío silenciosamente
            if (!tableErr.message.includes("doesn't exist")) throw tableErr;
        }
        res.json({ success: true, data: rows });
    } catch(e) { res.status(500).json({ success: false, data: [], message: e.message }); }
});



// ── Roster de técnicos conocidos (DB activos + histórico Jira) ───────────────
router.get('/techs-roster', authenticateToken, async (_req, res) => {
    try {
        const fromUsers = await dbQuery(`
            SELECT full_name AS name, email FROM users
            WHERE is_active=1 AND deleted_at IS NULL
              AND role IN ('administrador','especialista','agente','tecnico')
            ORDER BY full_name`);
        const fromJira = await dbQuery(`
            SELECT
              COALESCE(MAX(assigned_to_name), jira_assignee) AS name,
              jira_assignee AS email,
              MAX(jira_account_id) AS accountId
            FROM jira_tickets
            WHERE jira_assignee IS NOT NULL AND jira_assignee LIKE '%@%'
            GROUP BY jira_assignee
            ORDER BY name`);
        const seen = new Set();
        const merged = [];
        for (const t of [...fromUsers, ...fromJira]) {
            const k = (t.email || '').toLowerCase();
            if (k && !seen.has(k)) { seen.add(k); merged.push(t); }
        }
        res.json({ success: true, data: merged });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ── Import assignees desde CSV/JSON ──────────────────────────
// Body: { rows: [{ticket_key, assignee}] }
router.post('/import-assignees', authenticateToken, async (req, res) => {
    try {
        const rows = req.body?.rows;
        if (!Array.isArray(rows) || !rows.length)
            return res.status(400).json({ success: false, message: 'Se esperan rows: [{ticket_key, assignee}]' });

        let updated = 0, skipped = 0;
        for (const r of rows) {
            const key = (r.ticket_key || '').trim();
            const val = (r.assignee || '').trim();
            if (!key || !val) { skipped++; continue; }
            const result = await dbQuery(
                `UPDATE jira_tickets SET jira_assignee = ? WHERE ticket_key = ?`, [val, key]
            );
            if (result.affectedRows > 0) updated++;
            else skipped++;
        }
        res.json({ success: true, updated, skipped, message: `${updated} asignaciones importadas` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ── Sync assignees desde Jira (api/2 → api/3 fallback) ───────
router.post('/sync-assignees', authenticateToken, async (_req, res) => {
    try {
        const keys = await dbQuery(`SELECT ticket_key FROM jira_tickets WHERE jira_assignee IS NULL OR jira_assignee = ''`);
        if (!keys.length) return res.json({ success: true, updated: 0, message: 'Todos los tickets ya tienen assignee de Jira' });

        const BATCH = 50;
        let updated = 0;
        let errors  = 0;
        let lastErr = '';

        for (let i = 0; i < keys.length; i += BATCH) {
            const batch = keys.slice(i, i + BATCH).map(r => r.ticket_key);
            const jql   = `key in (${batch.map(k=>`"${k}"`).join(',')})`;

            let issues = [];
            try {
                // Intenta api/2 primero (menos restrictivo que api/3 ante WAF)
                const data = await jira('GET', `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=assignee&maxResults=${BATCH}`);
                issues = data.issues || [];
            } catch (e2) {
                try {
                    // Fallback a api/3
                    const data = await jira('GET', `/rest/api/3/search?jql=${encodeURIComponent(jql)}&fields=assignee&maxResults=${BATCH}`);
                    issues = data.issues || [];
                } catch (e3) {
                    errors++;
                    lastErr = e3.message;
                    console.warn(`[sync-assignees] batch ${i} error:`, e3.message);
                }
            }

            for (const issue of issues) {
                const a = issue.fields?.assignee;
                if (!a) continue;
                const name = a.emailAddress || a.displayName || null;
                if (!name) continue;
                await dbQuery(
                    `UPDATE jira_tickets SET jira_assignee = ?, jira_account_id = COALESCE(?, jira_account_id) WHERE ticket_key = ?`,
                    [name, a.accountId || null, issue.key]
                );
                updated++;
            }
        }

        if (errors && !updated) {
            return res.status(500).json({ success: false, message: `No se pudo conectar con Jira: ${lastErr}` });
        }

        res.json({ success: true, updated, errors, total: keys.length,
            message: updated ? `${updated} tickets actualizados con assignee de Jira` : `Jira no devolvió assignees — los tickets pueden no tener agente asignado` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ── Stats en tiempo real desde Jira API ─────────────────────────────────────
let _statsLiveCache = null;
let _statsLiveCacheTs = 0;
const STATS_LIVE_TTL = 5 * 60 * 1000; // 5 min

async function jiraSearchAll(jql, fields = [], maxResults = 500) {
    const issues = [];
    let nextPageToken;
    while (issues.length < maxResults) {
        const body = { jql, fields, maxResults: Math.min(100, maxResults - issues.length) };
        if (nextPageToken) body.nextPageToken = nextPageToken;
        const data = await jira('POST', '/rest/api/3/search/jql', body);
        const batch = data.issues || [];
        issues.push(...batch);
        if (!batch.length || data.isLast !== false || !data.nextPageToken) break;
        nextPageToken = data.nextPageToken;
    }
    return issues;
}

const _SLA_HRS = { P1: 1, P2: 4, P3: 8, P4: 24 };

router.get('/stats-live', authenticateToken, async (_req, res) => {
    if (_statsLiveCache && Date.now() - _statsLiveCacheTs < STATS_LIVE_TTL) {
        return res.json({ success: true, data: _statsLiveCache });
    }
    try {
        const FIELDS = ['summary','status','assignee','reporter','priority','created','resolutiondate','components'];
        const [activeIssues, recentIssues] = await Promise.all([
            jiraSearchAll(
                'project = INC AND "Tipo de Componente" = Workplace AND status IN ("Asignado N2",Pendiente) ORDER BY created ASC',
                FIELDS, 500
            ),
            jiraSearchAll(
                'project = INC AND "Tipo de Componente" = Workplace AND created >= -30d ORDER BY created ASC',
                FIELDS, 500
            )
        ]);

        // Deduplicar
        const seen = new Set();
        const allIssues = [];
        for (const i of [...activeIssues, ...recentIssues]) {
            if (!seen.has(i.key)) { seen.add(i.key); allIssues.push(i); }
        }

        const nowMs = Date.now();
        const now7d  = nowMs - 7 * 86400000;
        const now30d = nowMs - 30 * 86400000;

        const processed = allIssues.map(issue => {
            const f = issue.fields;
            const priority    = mapPriority(f.priority?.name || '');
            const createdMs   = new Date(f.created).getTime();
            const resolvedMs  = f.resolutiondate ? new Date(f.resolutiondate).getTime() : null;
            const slaMs       = createdMs + (_SLA_HRS[priority] || 8) * 3600000;
            const isResolved  = !!resolvedMs;
            const slaBreach   = isResolved && resolvedMs > slaMs;
            const isVencido   = !isResolved && nowMs > slaMs;
            const mttr_min    = resolvedMs ? (resolvedMs - createdMs) / 60000 : null;
            return {
                key:           issue.key,
                summary:       f.summary || '',
                status:        f.status?.name || '',
                priority,
                assigneeEmail: f.assignee?.emailAddress || null,
                assigneeName:  f.assignee?.displayName  || null,
                reporterEmail: f.reporter?.emailAddress || null,
                createdStr:    f.created,
                resolvedStr:   f.resolutiondate || null,
                createdMs, resolvedMs, slaMs,
                isResolved, slaBreach, isVencido, mttr_min,
                component: f.components?.[0]?.name || null
            };
        });

        const openTix     = processed.filter(t => !t.isResolved);
        const resolvedTix = processed.filter(t =>  t.isResolved);

        // KPI SLA
        const dentroSla       = resolvedTix.filter(t => !t.slaBreach).length;
        const fueraSla        = resolvedTix.filter(t =>  t.slaBreach).length;
        const vencidosAbiertos = openTix.filter(t => t.isVencido).length;
        const sinAsignar30    = openTix.filter(t => !t.assigneeEmail && (nowMs - t.createdMs) > 1800000).length;

        // MTTR
        const mttrTix    = resolvedTix.filter(t => t.mttr_min > 0);
        const avgMttrMin = mttrTix.length ? mttrTix.reduce((s, t) => s + t.mttr_min, 0) / mttrTix.length : 0;
        const mttr       = avgMttrMin < 60 ? Math.round(avgMttrMin) + 'min' : (avgMttrMin / 60).toFixed(1) + 'h';

        // Evolución por día
        const evolMap = {};
        for (const t of processed) {
            const d = t.createdStr.slice(0, 10);
            if (!evolMap[d]) evolMap[d] = { dia: d, total: 0, cerrados: 0 };
            evolMap[d].total++;
            if (t.resolvedStr) {
                const rd = t.resolvedStr.slice(0, 10);
                if (!evolMap[rd]) evolMap[rd] = { dia: rd, total: 0, cerrados: 0 };
                evolMap[rd].cerrados++;
            }
        }
        const evolucion = Object.values(evolMap).sort((a, b) => a.dia.localeCompare(b.dia));

        // Por estado
        const estadoMap = {};
        for (const t of processed) {
            const ist = mapJiraStatus(t.status);
            if (ist === 'cerrado') continue;
            estadoMap[ist] = (estadoMap[ist] || 0) + 1;
        }
        const porEstado = Object.entries(estadoMap)
            .map(([internal_status, total]) => ({ internal_status, total }))
            .sort((a, b) => b.total - a.total);

        // Por prioridad (sólo abiertos)
        const priorMap = {};
        for (const t of openTix) priorMap[t.priority] = (priorMap[t.priority] || 0) + 1;
        const porPrioridad = Object.entries(priorMap)
            .map(([priority, total]) => ({ priority, total }))
            .sort((a, b) => a.priority.localeCompare(b.priority));

        // Por técnico
        const techMap = {};
        for (const t of processed) {
            const k = t.assigneeEmail || t.assigneeName;
            if (!k) continue;
            if (!techMap[k]) techMap[k] = { tech: t.assigneeName, total: 0, resolved: 0, open: 0, mttr_sum: 0, mttr_cnt: 0 };
            techMap[k].total++;
            if (t.isResolved) { techMap[k].resolved++; if (t.mttr_min) { techMap[k].mttr_sum += t.mttr_min; techMap[k].mttr_cnt++; } }
            else techMap[k].open++;
        }
        const byTech = Object.values(techMap)
            .map(t => ({ tech: t.tech, total: t.total, resolved: t.resolved, open: t.open,
                avg_min: t.mttr_cnt > 0 ? t.mttr_sum / t.mttr_cnt : null }))
            .sort((a, b) => b.resolved - a.resolved).slice(0, 15);

        // Semana/mes por técnico
        const weekMap = {};
        for (const t of resolvedTix) {
            const k = t.assigneeEmail || t.assigneeName;
            if (!k || !t.assigneeName) continue;
            if (!weekMap[k]) weekMap[k] = { tech: t.assigneeName, semana: 0, mes: 0 };
            if (t.resolvedMs >= now7d)  weekMap[k].semana++;
            if (t.resolvedMs >= now30d) weekMap[k].mes++;
        }
        const weekly = Object.values(weekMap).filter(w => w.mes > 0).sort((a, b) => b.semana - a.semana);

        // Top reporters
        const repMap = {};
        for (const t of processed) {
            if (!t.reporterEmail) continue;
            repMap[t.reporterEmail] = (repMap[t.reporterEmail] || 0) + 1;
        }
        const topReporters = Object.entries(repMap)
            .map(([reporter, total]) => ({ reporter, total }))
            .sort((a, b) => b.total - a.total).slice(0, 10);

        // Top equipos (por componente Jira)
        const equipoMap = {};
        for (const t of processed) {
            const lbl = t.component || 'Sin categoría';
            equipoMap[lbl] = (equipoMap[lbl] || 0) + 1;
        }
        const topEquipos = Object.entries(equipoMap)
            .map(([equipo_label, total]) => ({ equipo_label, total }))
            .sort((a, b) => b.total - a.total).slice(0, 10);

        // Top categorías (por summary)
        const catMap = {};
        for (const t of processed) {
            if (!t.summary) continue;
            catMap[t.summary] = (catMap[t.summary] || 0) + 1;
        }
        const topCategorias = Object.entries(catMap)
            .map(([summary, total]) => ({ summary, total }))
            .sort((a, b) => b.total - a.total).slice(0, 10);

        // Tickets en riesgo SLA (breach o próximos 4h)
        const now4h = nowMs + 4 * 3600000;
        const slaBreachTickets = openTix
            .filter(t => t.slaMs <= now4h)
            .sort((a, b) => a.slaMs - b.slaMs).slice(0, 10)
            .map(t => {
                const span    = Math.max(1, t.slaMs - t.createdMs);
                const sla_pct = nowMs > t.slaMs ? 0 :
                    Math.max(0, Math.min(100, Math.round((1 - (t.slaMs - nowMs) / span) * 100)));
                return {
                    ticket_key:      t.key,
                    summary:         t.summary.slice(0, 55),
                    priority:        t.priority,
                    tech:            t.assigneeName || 'Sin asignar',
                    internal_status: mapJiraStatus(t.status),
                    sla_pct,
                    mttr_h:          ((nowMs - t.createdMs) / 3600000).toFixed(1)
                };
            });

        // MTTR por categoría
        const mttrCatMap = {};
        for (const t of resolvedTix) {
            if (!t.mttr_min) continue;
            const cat = t.component || 'General';
            if (!mttrCatMap[cat]) mttrCatMap[cat] = { sum: 0, cnt: 0 };
            mttrCatMap[cat].sum += t.mttr_min;
            mttrCatMap[cat].cnt++;
        }
        const mttrByCat = Object.entries(mttrCatMap)
            .map(([cat, v]) => ({ cat, mttr_h: +(v.sum / v.cnt / 60).toFixed(1) }))
            .sort((a, b) => b.mttr_h - a.mttr_h).slice(0, 6);

        // FCR: resueltos dentro de SLA como proxy de resolución primer contacto
        const fcr_pct = resolvedTix.length > 0
            ? Math.round(resolvedTix.filter(t => !t.slaBreach).length / resolvedTix.length * 100)
            : 0;

        // CSAT desde BD local (complementario)
        let csat = 0;
        try {
            const cs = await dbQuery(`SELECT ROUND(AVG(rating),1) AS v FROM ticket_surveys WHERE rating>0 AND skipped=0`);
            csat = Number(cs[0]?.v) || 0;
        } catch (_) {}

        const data = {
            byTech, weekly, topReporters, topEquipos, topCategorias, evolucion,
            porPrioridad, porEstado, mttr, slaBreachTickets, mttrByCat, csat, fcr_pct,
            unassigned30: sinAsignar30,
            slaStats: { dentro_sla: dentroSla, fuera_sla: fueraSla, vencidos_abiertos: vencidosAbiertos },
            alertas: {
                slaPorVencer: openTix.filter(t => { const m = (t.slaMs - nowMs) / 60000; return m >= 0 && m <= 10; }).length,
                criticos:     openTix.filter(t => t.priority === 'P1').length,
                sinAsignar:   openTix.filter(t => !t.assigneeEmail).length
            }
        };
        _statsLiveCache = data;
        _statsLiveCacheTs = Date.now();
        res.json({ success: true, data });
    } catch (e) {
        console.error('[stats-live]', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;
            
