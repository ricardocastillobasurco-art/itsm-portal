
const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuth } = require('../../middleware/auth');
const { tenantWhere } = require('../../utils/tenantFilter');
const { jira, dbQuery, upload, assignEmailHtml, sendEmail, getAutomationConfig, mapJiraStatus, mapPriority, extractAdfText, IMPACT_LABELS, URGENCY_LABELS, COMPONENT_LABELS, APP_LABELS, TIPOLOGIA_LABELS, JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, SD_ID, RT_ID } = require('./helpers');
const axios = require('axios');
const FormData = require('form-data');


router.get('/test-auth', authenticateToken, async (_req, res) => {
    try {
        const data = await jira('GET', `/rest/servicedeskapi/servicedesk/${SD_ID}`);
        res.json({ ok: true, name: data.projectName, token_length: JIRA_TOKEN?.length });
    } catch (err) {
        res.status(err.response?.status || 500).json({
            ok: false,
            http: err.response?.status,
            error: err.response?.data || err.message,
            token_length: JIRA_TOKEN?.length,
            email: JIRA_EMAIL
        });
    }
});


// ============================================================

router.get('/my-tickets', optionalAuth, async (req, res) => {
    try {
        const email = (req.query.reporter || '').trim();
        const days = parseInt(req.query.days || '0');
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.status(400).json({ success: false, error: 'reporter requerido' });

        // Determinar modo Jira vs Local según feature flag del tenant
        const tenantId = req.user?.tenant_id;
        let tenantJiraEnabled = true; // Por defecto Jira
        if (tenantId && parseInt(tenantId) !== 1) {
            try {
                const FeatureFlagService = require('../../src/services/FeatureFlagService');
                const flags = await FeatureFlagService.getAll(parseInt(tenantId));
                if (flags['jira'] !== undefined && flags['jira'].enabled === false) tenantJiraEnabled = false;
            } catch (_) {}
        }
        // Jira mode → solo tickets INC-/SD-/RT-XXXX (excluir TK-% locales)
        // Local mode → solo tickets TK-XXXX
        const ticketKeyFilter = tenantJiraEnabled
            ? ` AND jt.ticket_key NOT LIKE 'TK-%'`
            : ` AND jt.ticket_key LIKE 'TK-%'`;
        const reqKeyFilter = tenantJiraEnabled
            ? ` AND req_key NOT LIKE 'TK-%'`
            : ` AND req_key LIKE 'TK-%'`;

        // En modo Jira los tickets pueden ser de meses atrás — no aplicar filtro de días en BD
        // En modo local sí aplicar filtro de días para limitar resultados locales
        const applyDaysInDb = !tenantJiraEnabled && days > 0;

        // En modo Jira: el email del reporter ya es el filtro suficiente.
        // No aplicar tenant_id porque tickets del portal anónimo tienen tenant_id = NULL.
        // En modo local: sí aplicar tenant filter para aislar datos por empresa.
        const dbTenantFilter = tenantJiraEnabled ? '' : tenantWhere(req, 'jt');

        // Consultar BD local primero (fuente confiable)
        let dbQuery_ = `SELECT jt.ticket_key, jt.summary, jt.status, jt.priority,
                        jt.component, jt.tipologia, jt.created_at, jt.jira_url,
                        (SELECT tc.contenido FROM ticket_comments tc
                         WHERE tc.ticket_id = jt.ticket_key
                         ORDER BY tc.created_at DESC LIMIT 1) AS last_comment,
                        (SELECT tc.created_at FROM ticket_comments tc
                         WHERE tc.ticket_id = jt.ticket_key
                         ORDER BY tc.created_at DESC LIMIT 1) AS last_comment_at
                 FROM jira_tickets jt WHERE jt.reporter = ?${ticketKeyFilter}${dbTenantFilter}`;
        const dbParams = [email];
        if (applyDaysInDb) { dbQuery_ += ` AND jt.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`; dbParams.push(days); }
        dbQuery_ += ` ORDER BY jt.created_at DESC LIMIT 100`;
        let dbRows = await dbQuery(dbQuery_, dbParams);

        // Fallback: buscar por nombre (tickets legacy donde reporter = full_name)
        if (!dbRows.length) {
            const firstName = email.split('@')[0].split('.')[0].split('_')[0];
            if (firstName.length >= 3) {
                let fbSql = `SELECT jt.ticket_key, jt.summary, jt.status, jt.priority,
                             jt.component, jt.tipologia, jt.created_at, jt.jira_url,
                             (SELECT tc.contenido FROM ticket_comments tc WHERE tc.ticket_id = jt.ticket_key ORDER BY tc.created_at DESC LIMIT 1) AS last_comment,
                             (SELECT tc.created_at FROM ticket_comments tc WHERE tc.ticket_id = jt.ticket_key ORDER BY tc.created_at DESC LIMIT 1) AS last_comment_at
                             FROM jira_tickets jt WHERE LOWER(jt.reporter) LIKE ?${ticketKeyFilter}${dbTenantFilter}`;
                const fbParams = [`%${firstName.toLowerCase()}%`];
                if (applyDaysInDb) { fbSql += ` AND jt.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`; fbParams.push(days); }
                fbSql += ` ORDER BY jt.created_at DESC LIMIT 100`;
                dbRows = await dbQuery(fbSql, fbParams).catch(() => []);
            }
        }

        // Consultar también jira_requirements
        let reqQuery = `SELECT req_key, summary, status, priority, tipo, created_at, jira_url
                        FROM jira_requirements WHERE reporter = ?${reqKeyFilter}`;
        const reqParams = [email];
        if (applyDaysInDb) { reqQuery += ` AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`; reqParams.push(days); }
        reqQuery += ` ORDER BY created_at DESC LIMIT 100`;
        let reqRows = await dbQuery(reqQuery, reqParams).catch(() => []);
        if (!reqRows.length) {
            const firstName = email.split('@')[0].split('.')[0].split('_')[0];
            if (firstName.length >= 3) {
                let fbReq = `SELECT req_key, summary, status, priority, tipo, created_at, jira_url FROM jira_requirements WHERE LOWER(reporter) LIKE ?${reqKeyFilter}`;
                const fbReqP = [`%${firstName.toLowerCase()}%`];
                if (applyDaysInDb) { fbReq += ` AND created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)`; fbReqP.push(days); }
                fbReq += ` ORDER BY created_at DESC LIMIT 100`;
                reqRows = await dbQuery(fbReq, fbReqP).catch(() => []);
            }
        }

        const reqData = reqRows.map(r => ({
            id:        r.req_key,
            titulo:    r.summary,
            tipo:      'requerimiento',
            status:    mapJiraStatus(r.status || 'Abierto'),
            jiraStatus: r.status || 'Abierto',
            priority:  r.priority || 'P3',
            createdAt: r.created_at,
            jiraUrl:   r.jira_url || `${JIRA_HOST}/browse/${r.req_key}`,
            categoria: r.tipo ? { nombre: r.tipo } : null,
            lastComment: null, lastCommentAt: null,
        }));

        let data;

        // Si hay resultados en BD local, enriquecer con estados reales desde Jira API
        if (dbRows.length > 0) {
            // Enriquecer con estados frescos desde Jira (servicedeskapi — misma que /sync)
            const freshStatus = {};
            try {
                const keys = dbRows.map(t => t.ticket_key);
                // Usar servicedeskapi/request para obtener estado real de cada ticket
                await Promise.allSettled(keys.map(async key => {
                    try {
                        const d = await jira('GET',
                            `/rest/servicedeskapi/request/${key}?expand=status`
                        );
                        const st = d.currentStatus?.status || d.status?.name;
                        if (st) {
                            freshStatus[key] = { status: st };
                            await dbQuery(
                                'UPDATE jira_tickets SET status = ? WHERE ticket_key = ?',
                                [st, key]
                            ).catch(() => {});
                        }
                    } catch (_) {}
                }));
            } catch (_) { /* Si Jira falla, usar datos de BD */ }

            data = dbRows.map(t => {
                const fresh     = freshStatus[t.ticket_key];
                const jiraStatus = (fresh?.status || t.status || 'Abierto').trim();
                return {
                    id:            t.ticket_key,
                    titulo:        t.summary,
                    tipo:          (t.tipologia || t.component || '').toLowerCase().includes('requeri') ? 'requerimiento' : 'incidente',
                    status:        mapJiraStatus(jiraStatus),
                    jiraStatus,
                    priority:      fresh?.priority ? mapPriority(fresh.priority) : (t.priority || 'P3'),
                    createdAt:     t.created_at,
                    jiraUrl:       t.jira_url || `${JIRA_HOST}/browse/${t.ticket_key}`,
                    categoria:     t.component ? { nombre: t.component } : (t.tipologia ? { nombre: t.tipologia } : null),
                    lastComment:   t.last_comment   || null,
                    lastCommentAt: t.last_comment_at || null,
                };
            });
        } else {
            // Sin resultados en BD — buscar directamente en Jira API (sin filtro de días)
            try {
                let jiraIssues = [];

                // 1. JQL por email — sin restricción de proyecto ni de días
                try {
                    const jql = `reporter = "${email}" ORDER BY created DESC`;
                    const jiraData = await jira('GET',
                        `/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=summary,status,priority,comment,created,components`
                    );
                    jiraIssues = (jiraData.issues || []).map(i => {
                        const f          = i.fields;
                        const jiraStatus = f.status?.name || 'Abierto';
                        const comments   = f.comment?.comments || [];
                        const lastCmt    = comments.length ? comments[comments.length - 1] : null;
                        const component  = (f.components || [])[0]?.name || null;
                        return {
                            id:            i.key,
                            titulo:        f.summary,
                            tipo:          'incidente',
                            status:        mapJiraStatus(jiraStatus),
                            jiraStatus,
                            priority:      mapPriority(f.priority?.name),
                            createdAt:     f.created,
                            jiraUrl:       `${JIRA_HOST}/browse/${i.key}`,
                            categoria:     component ? { nombre: component } : null,
                            lastComment:   lastCmt ? extractAdfText(lastCmt.body) : null,
                            lastCommentAt: lastCmt?.created || null,
                        };
                    });
                } catch (jqlErr) {
                    console.warn('my-tickets JQL error:', jqlErr.message);
                }

                // 2. Si JQL no devuelve nada, intentar service desk API por accountId/customer
                if (!jiraIssues.length) {
                    let accountId = null;
                    try {
                        const users = await jira('GET', `/rest/api/3/user/search?query=${encodeURIComponent(email)}&maxResults=5`);
                        accountId = (Array.isArray(users) && users.find(u => u.emailAddress?.toLowerCase() === email.toLowerCase()))?.accountId || null;
                    } catch (_) {}
                    if (!accountId) {
                        try {
                            const custs = await jira('GET', `/rest/servicedeskapi/servicedesk/${SD_ID}/customer?query=${encodeURIComponent(email)}&limit=5`);
                            accountId = ((custs.values || []).find(u => u.emailAddress?.toLowerCase() === email.toLowerCase()))?.accountId || null;
                        } catch (_) {}
                    }
                    if (accountId) {
                        try {
                            const sdRes = await jira('GET',
                                `/rest/servicedeskapi/request?requestReporter=${accountId}&requestStatus=ALL_REQUESTS&limit=100&expand=requestFieldValues,status`
                            );
                            jiraIssues = (sdRes.values || []).map(item => {
                                const fields = {};
                                (item.requestFieldValues || []).forEach(f => { fields[f.fieldId] = f.value; });
                                const jiraStatus = item.currentStatus?.status || 'Abierto';
                                const component  = (item.requestFieldValues || []).find(f => f.fieldId === 'components')?.value?.[0]?.name || null;
                                return {
                                    id:            item.issueKey,
                                    titulo:        fields.summary || item.issueKey,
                                    tipo:          'incidente',
                                    status:        mapJiraStatus(jiraStatus),
                                    jiraStatus,
                                    priority:      fields.priority?.name ? mapPriority(fields.priority.name) : 'P3',
                                    createdAt:     item.createdDate?.iso8601 || null,
                                    jiraUrl:       `${JIRA_HOST}/browse/${item.issueKey}`,
                                    categoria:     component ? { nombre: component } : null,
                                    lastComment:   null, lastCommentAt: null,
                                };
                            });
                        } catch (sdErr) {
                            console.warn('my-tickets SD API error:', sdErr.message);
                        }
                    }
                }

                data = jiraIssues;
            } catch (jiraErr) {
                console.warn('my-tickets Jira error:', jiraErr.message);
                data = [];
            }
        }

        // Merge requerimientos (de jira_requirements) con incidencias
        data = [...data, ...reqData].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        res.json({ success: true, data });
    } catch(err) {
        console.error('my-tickets error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});


// ============================================================

router.get('/my-tickets/:key', async (req, res) => {
    try {
        const email = (req.query.reporter || '').trim();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
            return res.status(400).json({ success: false, error: 'reporter requerido' });
        const key = req.params.key;

        // Verificar ownership + obtener datos locales (SLA, prioridad)
        const localRows = await dbQuery(
            `SELECT * FROM jira_tickets WHERE ticket_key=? AND reporter=? LIMIT 1`, [key, email]
        );
        if (!localRows.length) return res.status(404).json({ success: false, error: 'Ticket no encontrado' });
        const loc = localRows[0];

        // Consultar Jira: detalle + comentarios
        const [jiraDetail, history] = await Promise.all([
            jira('GET', `/rest/api/3/issue/${key}?fields=status,comment`),
            dbQuery(`SELECT * FROM ticket_history WHERE ticket_id=? ORDER BY created_at ASC`, [key]),
        ]);

        const jiraStatus = jiraDetail.fields?.status?.name || loc.status || 'Abierto';
        const status     = mapJiraStatus(jiraStatus);

        // SLA
        let slaStatus = 'normal';
        if (loc.sla_deadline && !['resuelto','cerrado'].includes(status)) {
            const diff = new Date(loc.sla_deadline) - new Date();
            if (diff < 0) slaStatus = 'vencido';
            else if (diff < 2 * 3600000) slaStatus = 'riesgo';
        }

        // Comentarios de Jira
        const jiraComments = (jiraDetail.fields?.comment?.comments || []).map(c => ({
            tipo:      'comentario',
            contenido: c.body || '',
            createdAt: new Date(c.created),
            metadata:  {},
        }));

        // Historial de estados local (para timeline)
        const stateEvents = history.map(h => {
            let toStatus = null;
            if (h.evento === 'cambio_estado') {
                const m = /"([^"]+)"/.exec(h.detalle || '');
                toStatus = m ? m[1].replace('pendiente_usuario', 'pendiente') : null;
            }
            return {
                tipo:      h.evento === 'asignacion' ? 'asignacion' : 'cambio_estado',
                contenido: h.detalle || '',
                createdAt: h.created_at,
                metadata:  { to: toStatus },
            };
        });

        const allComentarios = [...stateEvents, ...jiraComments]
            .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

        res.json({
            success: true,
            data: {
                id:          key,
                titulo:      loc.summary,
                tipo:        (loc.tipologia || loc.component || '').toLowerCase().includes('requeri') ? 'requerimiento' : 'incidente',
                status,
                jiraStatus,
                priority:    loc.priority || 'P3',
                createdAt:   loc.created_at,
                resolvedAt:  loc.resolved_at || null,
                closedAt:    loc.closed_at   || null,
                slaDueAt:    loc.sla_deadline || null,
                slaStatus,
                canClose:    !['resuelto','cerrado'].includes(status),
                jiraUrl:     jiraDetail._links?.web || loc.jira_url || null,
                categoria:   loc.component ? { nombre: loc.component } : (loc.tipologia ? { nombre: loc.tipologia } : null),
                comentarios: allComentarios,
            }
        });
    } catch(err) {
        console.error('my-tickets detail error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});


// ============================================================

router.post('/my-tickets/:key/close', async (req, res) => {
    const key      = req.params.key;
    const reporter = (req.body.reporter || '').trim();
    const comment  = (req.body.comment  || '').trim();

    if (!reporter || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reporter))
        return res.status(400).json({ success: false, error: 'reporter requerido' });
    if (!comment)
        return res.status(400).json({ success: false, error: 'Comentario obligatorio para cerrar' });

    // Verificar que el ticket pertenece a este reporter
    const rows = await dbQuery(`SELECT ticket_key FROM jira_tickets WHERE ticket_key=? AND reporter=? LIMIT 1`, [key, reporter]);
    if (!rows.length) return res.status(403).json({ success: false, error: 'No tienes permiso para cerrar este ticket' });

    let jiraClosed = false, jiraError = null;
    try {
        // Reanudar si está en Pendiente
        const issueData = await jira('GET', `/rest/api/2/issue/${key}?fields=status`);
        if (/pendiente/i.test(issueData.fields?.status?.name || '')) {
            const transData = await jira('GET', `/rest/api/2/issue/${key}/transitions`);
            const reanudar = (transData.transitions || []).find(t => /reanudar|asignado/i.test(t.name));
            if (reanudar) await jira('POST', `/rest/api/2/issue/${key}/transitions`, { transition: { id: reanudar.id } });
        }

// 4. Cerrar con campos requeridos — axios directo para evitar WAF
        await axios({
            method: 'POST',
            url: `${JIRA_HOST}/rest/api/2/issue/${key}/transitions`,
            auth: { username: JIRA_EMAIL, password: JIRA_TOKEN },
            headers: {
                'Accept':       'application/json',
                'Content-Type': 'application/json',
            },
            data: {
                transition: { id: transicierre.id },
                update: {
                    comment: [{ add: { body: comment.trim() } }]
                },
                fields: {
                    customfield_13268: { id: '622351' },
                    customfield_13270: [{ id: '621420' }],
                    customfield_13271: { value: 'NO' },
                    customfield_15344: { id: '622699', child: { id: '622700' } }
                }
            },
            timeout: 25000,
            validateStatus: s => s < 500,
        });
        jiraClosed = true;
    } catch(err) {
        const respData = err.response?.data;
        const isHtml   = typeof respData === 'string' && respData.trim().startsWith('<');
        jiraError = isHtml
            ? `HTTP ${err.response?.status} - WAF/CloudFront block`
            : (respData?.errorMessage || JSON.stringify(respData?.errors || {}) || err.message);
        console.error(`❌ my-tickets close Jira [${err.response?.status}]:`,
            isHtml ? respData?.slice(0, 400) : JSON.stringify(respData, null, 2));
    }

    // Actualizar local
    dbQuery(
        `UPDATE jira_tickets SET status='Resuelto', internal_status='cerrado', closed_at=NOW(),
         closed_by=?, close_comment=?, resolved_at=IFNULL(resolved_at,NOW()) WHERE ticket_key=?`,
        [reporter, comment, key]
    ).catch(() => {});

    res.json({
        success: jiraClosed,
        jiraClosed,
        message: jiraClosed ? `Ticket ${key} cerrado en Jira` : `Error Jira: ${jiraError}`,
    });
});


// ============================================================

router.post('/my-tickets/:key/comment', async (req, res) => {
    const key      = req.params.key;
    const reporter = (req.body.reporter || '').trim();
    const comment  = (req.body.comment  || '').trim();

    if (!reporter || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reporter))
        return res.status(400).json({ success: false, error: 'reporter requerido' });
    if (!comment)
        return res.status(400).json({ success: false, error: 'Comentario vacío' });

    const rows = await dbQuery(
        `SELECT ticket_key FROM jira_tickets WHERE ticket_key=? AND reporter=? LIMIT 1`,
        [key, reporter]
    );
    if (!rows.length)
        return res.status(403).json({ success: false, error: 'No tienes permiso para comentar este ticket' });

    let jiraOk = false;
    try {
        await jira('POST', `/rest/servicedeskapi/request/${key}/comment`,
            { body: comment, public: true }
        );
        jiraOk = true;
    } catch(e) { /* guardar igual en local aunque Jira falle */ }

    await dbQuery(
        `INSERT INTO ticket_comments (ticket_id, user_id, contenido, tipo, created_at) VALUES (?,0,?,'portal_user',NOW())`,
        [key, comment]
    );

    res.json({ success: true, jiraOk, message: 'Comentario guardado' });
});



module.exports = router;
            
