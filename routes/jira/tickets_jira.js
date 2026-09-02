const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuth } = require('../../middleware/auth');
const { jira, dbQuery, upload, assignEmailHtml, sendEmail, getAutomationConfig, mapJiraStatus, mapPriority, extractAdfText, IMPACT_LABELS, URGENCY_LABELS, COMPONENT_LABELS, APP_LABELS, TIPOLOGIA_LABELS, JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, SD_ID, RT_ID, loadAgentCache, resolveJiraAccountId } = require('./helpers');
const axios = require('axios');
const FormData = require('form-data');

const auth = { username: JIRA_EMAIL, password: JIRA_TOKEN };

// ── Workspace ID de Jira Assets (cacheado) ───────────────
let _wsId = null;
async function getAssetsWorkspaceId() {
    if (_wsId) return _wsId;
    try {
        const r = await jira('GET', '/rest/assets/1.0/workspaceid');
        _wsId = r?.workspaceId || (typeof r === 'string' ? r : null);
        console.log(`ℹ️ Jira Assets workspace ID: ${_wsId}`);
    } catch (e) {
        console.warn('⚠️ No se pudo obtener workspaceId de Assets:', e.message);
    }
    if (!_wsId) {
        _wsId = 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c'; // fallback
        console.warn(`⚠️ Usando workspace ID hardcodeado: ${_wsId}`);
    }
    return _wsId;
}
// Convierte un valor del catálogo (uuid:numId o solo numId) al globalId correcto
function toGlobalId(val, wsId) {
    if (!val) return val;
    const numId = val.includes(':') ? val.split(':').pop() : val;
    return wsId ? `${wsId}:${numId}` : val;
}

router.get('/check-assets', authenticateToken, async (req, res) => {
    const wsId = await getAssetsWorkspaceId();
    res.json({ wsId, SD_ID, RT_ID, JIRA_HOST, JIRA_EMAIL, tokenOk: !!JIRA_TOKEN });
});

// Diagnóstico: ver transiciones disponibles para un ticket sin cerrarlo
router.get('/ticket/:key/transitions-debug', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
    const h = { 'Authorization': `Basic ${b64Auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
    try {
        const [r1, r2, r3, r4] = await Promise.all([
            fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/transitions?expand=transitions.fields`, { headers: h }),
            fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/transitions`, { headers: h }),
            fetch(`${JIRA_HOST}/rest/servicedeskapi/request/${key}/transition`, { headers: { ...h, 'X-ExperimentalApi': 'opt-in' } }),
            fetch(`${JIRA_HOST}/rest/api/3/issue/${key}?fields=status,assignee`, { headers: h }),
        ]);
        const [d1, d2, d3, d4] = await Promise.all([r1.json(), r2.json(), r3.json(), r4.json()]);
        res.json({
            issue: { status: d4.fields?.status?.name, assignee: d4.fields?.assignee?.displayName },
            restExpand:   { status: r1.status, transitions: (d1.transitions||[]).map(t=>({id:t.id,name:t.name})) },
            restPlain:    { status: r2.status, transitions: (d2.transitions||[]).map(t=>({id:t.id,name:t.name})) },
            serviceDeskApi: { status: r3.status, values: (d3.values||d3.transitions||[]).map(t=>({id:t.id,name:t.name})) },
        });
    } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/', authenticateToken, (req, res) => {
    res.render('service-management/tickets', {
        title: 'Tickets de Incidencias',
        user: req.user || null,
        currentUserId: req.user?.id || null
    });
});

// ============================================================

// ── Creación masiva desde archivo ──────────────────────────────────────────
router.post('/ticket/bulk', authenticateToken, async (req, res) => {
    const { rows, component, app, tipologia, impact = '618437', urgency = '618441' } = req.body;
    if (!Array.isArray(rows) || !rows.length)
        return res.status(400).json({ success: false, message: 'rows requerido' });
    if (!tipologia)
        return res.status(400).json({ success: false, message: 'Selecciona una categoría' });

    let wsId;
    try { wsId = await getAssetsWorkspaceId(); } catch (_) { wsId = null; }

    const results = [];
    for (const row of rows) {
        const { summary, reporter, assigneeEmail } = row;
        if (!summary || !reporter) {
            results.push({ summary, reporter, success: false, error: 'Faltan campos' });
            continue;
        }
        try {
            // Placeholder attachment
            let attachmentId = null;
            try {
                const placeholder = Buffer.from(`Ticket importación masiva.\nUsuario: ${reporter}\nAsunto: ${summary}`);
                const fd = new FormData();
                fd.append('file', placeholder, { filename: 'importacion.txt', contentType: 'text/plain' });
                const upRes = await axios.post(
                    `${JIRA_HOST}/rest/servicedeskapi/servicedesk/${SD_ID}/attachTemporaryFile`, fd,
                    { auth, headers: { ...fd.getHeaders(), 'X-ExperimentalApi': 'opt-in', 'X-Atlassian-Token': 'no-check' }, timeout: 15000 }
                );
                attachmentId = upRes.data?.temporaryAttachments?.[0]?.temporaryAttachmentId || null;
            } catch (_) {}

            const rfv = {
                summary,
                description: `Importación masiva.\nUsuario: ${reporter}\nServicio: ${summary}`,
                customfield_14687: [{ id: toGlobalId(component, wsId) }],
                customfield_13274: [{ id: toGlobalId(app, wsId) }],
                customfield_13283: [{ id: toGlobalId(tipologia, wsId) }],
                customfield_10246: { id: impact },
                customfield_13269: { id: urgency },
                customfield_11795: '-'
            };
            if (attachmentId) rfv.attachment = [attachmentId];

            const payload = { serviceDeskId: SD_ID, requestTypeId: RT_ID, requestFieldValues: rfv, raiseOnBehalfOf: reporter };
            let result;
            try {
                result = await jira('POST', '/rest/servicedeskapi/request', payload);
            } catch (e) {
                if (e.response?.status === 400 || e.response?.status === 401) {
                    const { raiseOnBehalfOf: _r, ...p2 } = payload;
                    result = await jira('POST', '/rest/servicedeskapi/request', p2);
                } else throw e;
            }
            const issueKey = result.issueKey;

            // Asignar a técnico
            let assignedName = null;
            let assignedDbUser = null;
            if (assigneeEmail) {
                try {
                    const agent = await resolveJiraAccountId(assigneeEmail);
                    if (agent?.accountId) {
                        await jira('PUT', `/rest/api/3/issue/${issueKey}/assignee`, { accountId: agent.accountId });
                        assignedName = agent.displayName || assigneeEmail;
                        await dbQuery(
                            `UPDATE jira_tickets SET jira_account_id=? WHERE jira_assignee=? AND (jira_account_id IS NULL OR jira_account_id='')`,
                            [agent.accountId, assigneeEmail]
                        ).catch(() => {});
                    }
                } catch (_) {}
                const dbTech = await dbQuery(`SELECT id, full_name FROM users WHERE email=? LIMIT 1`, [assigneeEmail]);
                assignedDbUser = dbTech[0] || null;
            }

            const priority = 'P3';
            const slaH = 8;
            const internalStatus = (assignedDbUser || assignedName) ? 'asignado' : 'abierto';
            const assignedAt = internalStatus === 'asignado' ? ', NOW(), NOW()' : ', NULL, NULL';

            await dbQuery(
                `INSERT INTO jira_tickets
                    (ticket_key, summary, reporter, status, internal_status, priority,
                     urgency, urgency_level, impact, component, app_item, tipologia,
                     phone, description, impact_label, jira_url, sla_deadline,
                     assigned_to, assigned_to_name, jira_assignee, assigned_at, first_response_at)
                 VALUES (?, ?, ?, 'Abierto', ?, 'P3',
                     ?, 2, ?, ?, ?, ?,
                     '-', ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? HOUR),
                     ?, ?, ?${assignedAt})`,
                [
                    issueKey, summary, reporter, internalStatus,
                    URGENCY_LABELS[urgency] || urgency,
                    IMPACT_LABELS[impact] || impact,
                    component || '', app || '', tipologia || '',
                    `Importación masiva. Servicio: ${summary}`,
                    IMPACT_LABELS[impact] || impact,
                    `${JIRA_HOST}/browse/${issueKey}`,
                    slaH,
                    assignedDbUser?.id || null,
                    assignedDbUser?.full_name || assignedName || assigneeEmail || null,
                    assigneeEmail || null
                ]
            );

            results.push({ summary, reporter, assigneeEmail, key: issueKey, success: true, assignedName: assignedDbUser?.full_name || assignedName });
        } catch (e) {
            results.push({ summary, reporter, assigneeEmail, success: false, error: e.message });
        }
    }

    const ok = results.filter(r => r.success).length;
    const fail = results.filter(r => !r.success).length;
    res.json({ success: true, results, ok, fail });
});

// ============================================================

router.post('/ticket', optionalAuth, async (req, res) => {
    const start = Date.now();
    try {

        let { summary, reporter, phone, description, component, app, tipologia, impact, urgency, attachmentId, device_code } = req.body;

        if (!summary || !reporter || !phone || !description) {
            return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
        }

        // Si no hay adjunto, subir uno genérico para cumplir la validación de Jira
        if (!attachmentId) {
            try {
                const placeholder = Buffer.from(`Ticket generado automáticamente.\nResumen: ${summary}\nUsuario: ${reporter}`);
                const fd = new FormData();
                fd.append('file', placeholder, { filename: 'sin-evidencia.txt', contentType: 'text/plain' });
                const upRes = await axios.post(
                    `${JIRA_HOST}/rest/servicedeskapi/servicedesk/${SD_ID}/attachTemporaryFile`,
                    fd,
                    { auth, headers: { ...fd.getHeaders(), 'X-ExperimentalApi': 'opt-in', 'X-Atlassian-Token': 'no-check' }, timeout: 15000 }
                );
                attachmentId = upRes.data?.temporaryAttachments?.[0]?.temporaryAttachmentId || null;
            } catch (e) {
                console.warn('⚠️ No se pudo subir adjunto genérico:', e.message);
            }
        }

        const wsId = await getAssetsWorkspaceId();
        const rfv = {
            summary,
            description,
            customfield_14687: [{ id: toGlobalId(component, wsId) }],
            customfield_13274: [{ id: toGlobalId(app,       wsId) }],
            customfield_13283: [{ id: toGlobalId(tipologia,  wsId) }],
            customfield_10246: { id: impact },
            customfield_13269: { id: urgency },
            customfield_11795: phone
        };
        if (attachmentId) rfv.attachment = [attachmentId];

        const payload = { serviceDeskId: SD_ID, requestTypeId: RT_ID, requestFieldValues: rfv, raiseOnBehalfOf: reporter };
        console.log(`📤 Jira: wsId=${wsId} comp=${toGlobalId(component,wsId)} app=${toGlobalId(app,wsId)} tip=${toGlobalId(tipologia,wsId)}`);

        let result;
        try {
            result = await jira('POST', '/rest/servicedeskapi/request', payload);
        } catch (jiraErr) {
            const status = jiraErr.response?.status;
            const errData = jiraErr.response?.data;
            console.warn(`⚠️ Intento 1 falló [${status}]:`, JSON.stringify(errData));
            if (status === 400 || status === 401) {
                // raiseOnBehalfOf falla para emails de agente Jira → reintentar sin él
                console.log(`📤 Reintento sin raiseOnBehalfOf`);
                const { raiseOnBehalfOf: _r, ...payloadNoRaise } = payload;
                result = await jira('POST', '/rest/servicedeskapi/request', payloadNoRaise);
            } else {
                throw jiraErr;
            }
        }
        const issueKey = result.issueKey;
        const elapsed = Date.now() - start;

        console.log(`✅ Ticket Jira creado: ${issueKey} en ${elapsed}ms`);

        const urgencyLevel = urgency === '618442' ? 3 : urgency === '618441' ? 2 : 1;
        const priority = urgencyLevel === 3 ? 'P1' : urgencyLevel === 2 ? 'P2' : 'P3';
        // SLA ITIL: P1=1h, P2=4h, P3=8h, P4=24h — calculado con NOW() de MySQL para evitar timezone mismatch
        const slaHours = { P1: 1, P2: 4, P3: 8, P4: 24 };
        const slaH = slaHours[priority] || 8;

        // Buscar usuario por defecto (rabasurco@stefanini.com)
        const defaultAssigneeRows = await dbQuery(
            `SELECT id, full_name FROM users WHERE email='rabasurco@stefanini.com' AND deleted_at IS NULL LIMIT 1`
        );
        const defAssignee = defaultAssigneeRows[0] || null;
        const initStatus = defAssignee ? 'asignado' : 'abierto';

        await dbQuery(
            `INSERT INTO jira_tickets
                (ticket_key, summary, reporter, device_code, status, internal_status, priority,
                 urgency, urgency_level, impact, component, app_item, tipologia,
                 phone, description, impact_label, jira_url, sla_deadline,
                 assigned_to, assigned_to_name, assigned_at, first_response_at)
             VALUES (?, ?, ?, ?, 'Abierto', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                     DATE_ADD(NOW(), INTERVAL ? HOUR),
                     ?, ?, ${defAssignee ? 'NOW(), NOW()' : 'NULL, NULL'})`,
            [
                issueKey, summary, reporter, device_code || null, initStatus,
                priority,
                URGENCY_LABELS[urgency] || urgency,
                urgencyLevel,
                IMPACT_LABELS[impact] || impact,
                COMPONENT_LABELS[component] || component,
                APP_LABELS[app] || app,
                TIPOLOGIA_LABELS[tipologia] || tipologia,
                phone, description,
                IMPACT_LABELS[impact] || impact,
                `${JIRA_HOST}/browse/${issueKey}`,
                slaH,
                defAssignee?.id || null,
                defAssignee?.full_name || null
            ]
        );

        // Registrar en historial
        dbQuery(`INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle)
                 VALUES (?, 0, ?, 'creacion', ?)`,
            [issueKey, reporter, `Incidencia creada por ${reporter}. Prioridad: ${priority}. Resumen: ${summary}`]
        ).catch(() => { });

        // Notificar en tiempo real a agentes y TV
        try {
            const io = req.app.get('io');
            if (io) {
                const payload = { key: issueKey, summary, priority, reporter, status: initStatus };
                io.to('jira:agents').emit('ticket:created', payload);
                io.to('tv:dashboard').emit('ticket:event', { action: 'created', key: issueKey, priority });
            }
        } catch (_) {}

        // Enviar correo de confirmación al reporter (no bloqueante)
        (async () => {
            try {
                const nodemailer = require('nodemailer');
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT) || 587,
                    secure: process.env.SMTP_SECURE === 'true',
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
                });
                const slaLabel = { P1: '4 horas', P2: '8 horas', P3: '24 horas', P4: '72 horas' };
                const prioBadge = { P1: '🔴 Crítico', P2: '🟠 Alto', P3: '🔵 Medio', P4: '⚪ Bajo' };
                await transporter.sendMail({
                    from: `"Service Desk TI" <${process.env.SMTP_USER}>`,
                    to: reporter,
                    subject: `[${issueKey}] Tu incidencia fue registrada — ${summary}`,
                    html: `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:580px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(9,30,66,.12);">
    <!-- Header -->
    <div style="background:#0052CC;padding:28px 32px;text-align:center;">
      <div style="font-size:28px;margin-bottom:8px;">🎫</div>
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:700;">Incidencia Registrada</h1>
      <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:13px;">Service Desk · Portal IT</p>
    </div>
    <!-- Ticket Key -->
    <div style="background:#DEEBFF;padding:16px 32px;text-align:center;border-bottom:1px solid #B3D4FF;">
      <span style="font-family:monospace;font-size:22px;font-weight:800;color:#0052CC;letter-spacing:1px;">${issueKey}</span>
    </div>
    <!-- Body -->
    <div style="padding:28px 32px;">
      <p style="color:#172B4D;font-size:14px;margin:0 0 20px;">Hola <strong>${reporter}</strong>, tu incidencia fue registrada exitosamente. El equipo de soporte la atenderá según la prioridad asignada.</p>
      <!-- Resumen -->
      <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
        <tr>
          <td style="padding:10px 14px;background:#F4F5F7;border-radius:6px 0 0 0;font-weight:700;color:#5E6C84;width:35%;">Resumen</td>
          <td style="padding:10px 14px;background:#FAFBFC;border-radius:0 6px 0 0;color:#172B4D;">${summary}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;background:#F4F5F7;font-weight:700;color:#5E6C84;">Prioridad</td>
          <td style="padding:10px 14px;background:#FAFBFC;color:#172B4D;">${prioBadge[priority] || priority} — SLA: ${slaLabel[priority] || '—'}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;background:#F4F5F7;font-weight:700;color:#5E6C84;">Descripción</td>
          <td style="padding:10px 14px;background:#FAFBFC;color:#172B4D;">${description || '—'}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;background:#F4F5F7;border-radius:0 0 0 6px;font-weight:700;color:#5E6C84;">Fecha</td>
          <td style="padding:10px 14px;background:#FAFBFC;border-radius:0 0 6px 0;color:#172B4D;">${new Date().toLocaleString('es-PE', { timeZone: 'America/Lima' })}</td>
        </tr>
      </table>
      <!-- CTA -->
      <div style="text-align:center;margin:24px 0 8px;">
        <a href="${JIRA_HOST}/browse/${issueKey}" style="display:inline-block;background:#0052CC;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:13px;font-weight:700;">Ver ticket en Jira →</a>
      </div>
    </div>
    <!-- Footer -->
    <div style="background:#F4F5F7;padding:16px 32px;text-align:center;border-top:1px solid #DFE1E6;">
      <p style="margin:0;font-size:11px;color:#5E6C84;">Este es un mensaje automático del Service Desk. No responda a este correo.</p>
    </div>
  </div>
</body>
</html>`
                });
            } catch (mailErr) {
                console.warn('⚠️ Correo de confirmación no enviado:', mailErr.message);
            }
        })();

        res.status(201).json({
            success: true,
            message: `Ticket ${issueKey} creado exitosamente`,
            data: { key: issueKey, url: `${JIRA_HOST}/browse/${issueKey}`, elapsedMs: elapsed }
        });

    } catch (error) {
        const status = error.response?.status;
        const data = error.response?.data;
        console.error(`❌ Error creando ticket [HTTP ${status}]:`, JSON.stringify(data, null, 2) || error.message);
        console.error('   JIRA_EMAIL:', JIRA_EMAIL, '| TOKEN ok:', !!JIRA_TOKEN);
        const fieldErrors = data?.errors ? Object.entries(data.errors).map(([k, v]) => `${k}: ${v}`).join('; ') : null;
        res.status(500).json({
            success: false,
            message: data?.errorMessage || fieldErrors || error.message,
            details: data
        });
    }
});


// ============================================================

router.get('/ticket/:key/jira-detail', authenticateToken, async (req, res) => {
    try {
        const data = await jira('GET',
            `/rest/servicedeskapi/request/${req.params.key}?expand=requestFieldValues,participant,status`
        );

        // servicedeskapi devuelve estructura diferente a api/v3
        const fields = data.requestFieldValues || [];
        const getSummary = () => {
            const f = fields.find(x => x.fieldId === 'summary');
            return f?.value || data.issueKey || '—';
        };

        res.json({
            success: true,
            data: {
                key: data.issueKey,
                summary: getSummary(),
                status: data.currentStatus?.status || '—',
                reporter: data.reporter?.emailAddress || data.reporter?.displayName || '—',
                created: data.createdDate?.iso8601 || null,
                assignee: null, // servicedeskapi no expone assignee — requiere token de agente
                url: `${JIRA_HOST}/browse/${data.issueKey}`
            }
        });
    } catch (error) {
        console.error('Error detalle Jira:', error.response?.status, error.response?.data);
        res.status(500).json({
            success: false,
            message: error.response?.data?.errorMessage || error.message,
            noAccess: error.response?.status === 403 || error.response?.status === 404
        });
    }
});



// Caché módulo-nivel: las opciones WP no cambian con frecuencia
let _wpCatCache = null;
let _wpCatCacheTs = 0;
const _WP_CAT_TTL = 60 * 60 * 1000;
// Expose cache reset for dev use
if (process.env.NODE_ENV !== 'production') { global._resetWpCatCache = () => { _wpCatCache = null; _wpCatCacheTs = 0; }; }

// GET /ticket/:key/wp-categories — Opciones de Resultado Workplace (customfield_15147)
router.get('/ticket/:key/wp-categories', authenticateToken, async (req, res) => {
    const { key } = req.params;

    // Devolver caché si está fresco y tiene subcategorías (si no tiene hijos, refrescar)
    const _cacheValid = _wpCatCache && Date.now() - _wpCatCacheTs < _WP_CAT_TTL && _wpCatCache.some(o => o.children?.length > 0);
    if (_cacheValid) {
        return res.json({ success: true, options: _wpCatCache });
    }

    const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
    const fetchHeaders = { 'Authorization': `Basic ${b64Auth}`, 'Accept': 'application/json' };

    // Construye jerarquía desde un array plano (padres sin optionId, hijos con optionId)
    // o desde un array realmente anidado (items con array children).
    const buildHierarchy = (raw) => {
        const isNested = raw.some(o => Array.isArray(o.children) && o.children.length > 0);
        if (isNested) {
            return raw.filter(o => !o.optionId).map(p => ({
                id: p.id, value: p.value,
                children: (p.children || []).map(c => ({ id: c.id, value: c.value }))
            }));
        }
        // Formato plano: padres = sin optionId, hijos = String(optionId) === String(parent.id)
        const parents = raw.filter(o => !o.optionId);
        return parents.map(p => ({
            id: p.id, value: p.value,
            children: raw.filter(c => String(c.optionId) === String(p.id))
                         .map(c => ({ id: c.id, value: c.value }))
        }));
    };

    const saveCache = (options) => {
        _wpCatCache = options;
        _wpCatCacheTs = Date.now();
    };

    try {
        // 1. Field Context API — para cascade select se necesita llamar por padre + hijos separado
        const ctxR = await fetch(`${JIRA_HOST}/rest/api/3/field/customfield_15147/context`, { headers: fetchHeaders });
        if (ctxR.ok) {
            const ctxData = await ctxR.json();
            const ctxId = ctxData.values?.[0]?.id;
            if (ctxId) {
                // Trae solo raíces (sin ?optionId → solo padres)
                const optR = await fetch(
                    `${JIRA_HOST}/rest/api/3/field/customfield_15147/context/${ctxId}/option?maxResults=200`,
                    { headers: fetchHeaders }
                );
                if (optR.ok) {
                    const rootFlat = (await optR.json()).values || [];
                    const parents = rootFlat.filter(o => !o.optionId);
                    if (parents.length) {
                        // Trae hijos por cada padre usando ?optionId=<parentId>
                        const options = await Promise.all(parents.map(async p => {
                            try {
                                const cR = await fetch(
                                    `${JIRA_HOST}/rest/api/3/field/customfield_15147/context/${ctxId}/option?optionId=${p.id}&maxResults=200`,
                                    { headers: fetchHeaders }
                                );
                                const children = cR.ok ? ((await cR.json()).values || []).map(c => ({ id: c.id, value: c.value })) : [];
                                return { id: p.id, value: p.value, children };
                            } catch { return { id: p.id, value: p.value, children: [] }; }
                        }));
                        saveCache(options);
                        return res.json({ success: true, options });
                    }
                }
            }
        }

        // 2. Transitions con field expansion (puede incluir subcategorías para tickets abiertos)
        const transR = await fetch(
            `${JIRA_HOST}/rest/api/3/issue/${key}/transitions?expand=transitions.fields`,
            { headers: fetchHeaders }
        );
        if (transR.ok) {
            const transData = await transR.json();
            for (const t of (transData.transitions || [])) {
                const raw = t.fields?.customfield_15147?.allowedValues;
                if (raw?.length) {
                    const options = buildHierarchy(raw);
                    if (options.some(o => o.children.length)) { saveCache(options); return res.json({ success: true, options, _transId: t.id }); }
                }
            }
        }

        // 3. Editmeta del ticket actual
        const emR = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/editmeta`, { headers: fetchHeaders });
        if (emR.ok) {
            const emData = await emR.json();
            const raw = emData.fields?.customfield_15147?.allowedValues || [];
            if (raw.length) {
                const options = buildHierarchy(raw);
                if (options.length) { saveCache(options); return res.json({ success: true, options }); }
            }
        }

        // 3.5. Buscar cualquier ticket INC en BD cuyas transiciones tengan customfield_15147 con hijos
        try {
            const anyRows = await dbQuery(
                `SELECT ticket_key FROM jira_tickets WHERE ticket_key != ? AND ticket_key LIKE 'INC-%' ORDER BY created_at DESC LIMIT 10`,
                [key]
            );
            for (const row of (anyRows || [])) {
                const oTransR = await fetch(
                    `${JIRA_HOST}/rest/api/3/issue/${row.ticket_key}/transitions?expand=transitions.fields`,
                    { headers: fetchHeaders }
                );
                if (!oTransR.ok) continue;
                const oTransData = await oTransR.json();
                for (const t of (oTransData.transitions || [])) {
                    const raw = t.fields?.customfield_15147?.allowedValues;
                    if (raw?.length) {
                        const options = buildHierarchy(raw);
                        if (options.some(o => o.children.length)) {
                            saveCache(options);
                            return res.json({ success: true, options, _transId: t.id });
                        }
                    }
                }
            }
        } catch (_) {}

        // 4. Createmeta (devuelve solo raíces sin hijos, último recurso antes del fallback estático)
        const cmR = await fetch(
            `${JIRA_HOST}/rest/api/3/issue/createmeta?projectKeys=INC&expand=projects.issuetypes.fields`,
            { headers: fetchHeaders }
        );
        if (cmR.ok) {
            const cmData = await cmR.json();
            for (const proj of (cmData.projects || [])) {
                for (const it of (proj.issuetypes || [])) {
                    const raw = it.fields?.customfield_15147?.allowedValues;
                    if (raw?.length) {
                        const options = buildHierarchy(raw);
                        if (options.length) { saveCache(options); return res.json({ success: true, options }); }
                    }
                }
            }
        }

        // 5. Fallback estático
        const STATIC_OPTS = [
            { id:'s1',  value:'Aplicativo de Negocio',        children:[] },
            { id:'s2',  value:'Citrix',                       children:[] },
            { id:'s3',  value:'Computador de Escritorio',     children:[] },
            { id:'s4',  value:'Computador Portátil',          children:[] },
            { id:'s5',  value:'Conectividad',                 children:[] },
            { id:'s6',  value:'Gestión de Proxy de Seguridad',children:[] },
            { id:'s7',  value:'Impresora',                    children:[] },
            { id:'s8',  value:'Incidencias ECO',              children:[] },
            { id:'s9',  value:'Microsoft Office 365',         children:[] },
            { id:'s10', value:'Panda',                        children:[] },
            { id:'s11', value:'Problemas de Acceso',          children:[] },
            { id:'s12', value:'Software Comercial',           children:[] },
            { id:'s13', value:'Windows',                      children:[] },
        ];
        console.warn(`[wp-categories] Todas las APIs fallaron para ${key} — usando fallback estático`);
        res.json({ success: true, options: STATIC_OPTS, _static: true });
    } catch (err) {
        console.error(`[wp-categories] Error para ${key}:`, err.message);
        res.json({ success: false, options: [], error: err.message });
    }
});

// PUT /ticket/:key/wp-category — Actualizar Resultado Workplace (customfield_15147)
router.put('/ticket/:key/wp-category', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { resultado_padre, resultado_hijo, transitionId } = req.body;
    if (!resultado_padre) return res.status(400).json({ success: false, message: 'resultado_padre requerido' });
    try {
        const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
        const headers = { 'Authorization': `Basic ${b64Auth}`, 'Content-Type': 'application/json', 'Accept': 'application/json' };
        const fieldValue = resultado_hijo
            ? { value: resultado_padre, child: { value: resultado_hijo } }
            : { value: resultado_padre };
        const okMsg = `Resultado Workplace actualizado: ${resultado_padre}${resultado_hijo ? ' > ' + resultado_hijo : ''}`;

        // Guardar siempre en BD local como fuente de verdad (Jira puede rechazar si el campo no está en pantalla de edición)
        const saveLocal = () => dbQuery(
            `UPDATE jira_tickets SET wp_resultado_padre=?, wp_resultado_hijo=? WHERE ticket_key=?`,
            [resultado_padre, resultado_hijo || null, key]
        ).catch(() => {});

        // Intentar via transición (campo en pantalla de transición, no de edición)
        if (transitionId) {
            const tR = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/transitions`, {
                method: 'POST', headers,
                body: JSON.stringify({ transition: { id: String(transitionId) }, fields: { customfield_15147: fieldValue } }),
            });
            if (tR.ok || tR.status === 204) { await saveLocal(); return res.json({ success: true, message: okMsg }); }
            const tTxt = await tR.text();
            console.warn(`[wp-category] transición ${transitionId} falló ${tR.status}: ${tTxt.slice(0,200)}`);
        }

        // Fallback: PUT directo (funciona si el campo está en pantalla de edición)
        const r = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}`, {
            method: 'PUT', headers,
            body: JSON.stringify({ fields: { customfield_15147: fieldValue } }),
        });
        await saveLocal(); // guardar local independientemente del resultado Jira
        if (r.ok || r.status === 204) return res.json({ success: true, message: okMsg });
        const txt = await r.text();
        // Si Jira rechaza pero guardamos local, igual reportamos éxito parcial
        console.warn(`[wp-category] PUT Jira ${r.status}: ${txt.slice(0,200)} — guardado local OK`);
        return res.json({ success: true, message: okMsg + ' (guardado local)' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// ============================================================


router.post('/ticket/:key/close', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const {
        comment,
        tipo_atencion   = 'remota',
        resolucion      = 'Resuelto',
        proceso         = 'WORKPLACE',
        resultado_padre = 'Workplace',
        resultado_hijo  = 'Workplace',
        masiva          = 'NO',
    } = req.body;

    if (!comment || !comment.trim()) {
        return res.status(400).json({ success: false, message: 'El comentario de cierre es obligatorio' });
    }

    let jiraClosed = false;
    let jiraError = null;

    console.log(`[close] KEY=${key} TOKEN_OK=${!!JIRA_TOKEN} TOKEN_LEN=${JIRA_TOKEN?.length}`);

    try {
        const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
        const fetchHeaders = {
            'Authorization': `Basic ${b64Auth}`,
            'Content-Type':  'application/json',
            'Accept':        'application/json',
        };

        // 0. Si el ticket está en Pendiente, primero "Reanudar" para poder cerrarlo
        try {
            const stRes = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}?fields=status`, { headers: fetchHeaders });
            if (stRes.ok) {
                const stData = await stRes.json();
                const curStatus = (stData.fields?.status?.name || '').toLowerCase();
                if (curStatus.includes('pendiente') || curStatus.includes('pending') || curStatus.includes('waiting')) {
                    console.log(`[close] Ticket en Pendiente — aplicando Reanudar primero`);
                    const rtRes = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/transitions`, { headers: fetchHeaders });
                    if (rtRes.ok) {
                        const { transitions: rt = [] } = await rtRes.json();
                        const REANUDAR = ['reanudar','retomar','resume','reopen','reabrir','continuar','volver','en curso','in progress'];
                        const reT = rt.find(t => REANUDAR.some(w => t.name.toLowerCase().includes(w)));
                        if (reT) {
                            await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/transitions`, {
                                method: 'POST', headers: fetchHeaders,
                                body: JSON.stringify({ transition: { id: reT.id } }),
                            });
                            console.log(`[close] Reanudar aplicado: "${reT.name}" — esperando propagación`);
                            await new Promise(r => setTimeout(r, 1200));
                        }
                    }
                }
            }
        } catch (_) { /* no bloquear el cierre si falla la pre-verificación */ }

        // 1. Obtener transiciones disponibles para el ticket
        const transRes = await fetch(
            `${JIRA_HOST}/rest/api/3/issue/${key}/transitions?expand=transitions.fields`,
            { headers: fetchHeaders }
        );
        if (!transRes.ok) throw new Error(`No se pudo obtener transiciones: HTTP ${transRes.status}`);
        const transData = await transRes.json();
        let allTrans = transData.transitions || [];
        console.log(`[close] GET transitions HTTP ${transRes.status} → ${allTrans.length} trans para ${key}: [${allTrans.map(t=>`${t.id}:"${t.name}"`).join(', ')||'VACÍO'}]`);

        // Fallback: Service Desk transitions API
        if (!allTrans.length) {
            try {
                const sdRes = await fetch(
                    `${JIRA_HOST}/rest/servicedeskapi/request/${key}/transition`,
                    { headers: { ...fetchHeaders, 'X-ExperimentalApi': 'opt-in' } }
                );
                if (sdRes.ok) {
                    const sdData = await sdRes.json();
                    allTrans = sdData.values || sdData.transitions || [];
                    if (allTrans.length) console.log(`[close] Service Desk API retornó ${allTrans.length} transición(es) para ${key}`);
                }
            } catch (_) {}
        }

        // Detectar si existe alguna transición de cierre real en la lista actual
        const CIERRE_EXACTO_CHK = ['resuelto', 'resolved', 'closed', 'cerrado', 'done', 'completado', 'finalizado', 'resolver', 'resolve', 'solucionar', 'cierre'];
        const EXCLUIR_CHK = ['actualizar', 'pendiente', 'derivar', 'escalar', 'rechazar', 'reanudar', 'asignar'];
        const _hasCloseTransition = (trans) => trans.some(t => {
            const n = t.name.toLowerCase();
            if (EXCLUIR_CHK.some(x => n.includes(x))) return false;
            return CIERRE_EXACTO_CHK.some(c => n.includes(c));
        }) || trans.some(t => t.id === '11');

        // Fallback: JSM solo muestra transiciones al assignee actual.
        // Si no hay transición de cierre disponible, reasignar al service account,
        // reintentar transiciones y restaurar el asignado original tras el cierre.
        let originalAssigneeId = null;
        if (!allTrans.length || !_hasCloseTransition(allTrans)) {
            try {
                const [issueRes, meRes] = await Promise.all([
                    fetch(`${JIRA_HOST}/rest/api/3/issue/${key}?fields=assignee`, { headers: fetchHeaders }),
                    fetch(`${JIRA_HOST}/rest/api/3/myself`, { headers: fetchHeaders }),
                ]);
                if (issueRes.ok && meRes.ok) {
                    const issueData = await issueRes.json();
                    const meData = await meRes.json();
                    const currentAssigneeId = issueData.fields?.assignee?.accountId || null;
                    const serviceAccountId = meData.accountId;
                    if (serviceAccountId && currentAssigneeId !== serviceAccountId) {
                        console.log(`[close] Sin transición de cierre disponible — reasignando a service account para desbloquear`);
                        originalAssigneeId = currentAssigneeId;
                        await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/assignee`, {
                            method: 'PUT', headers: fetchHeaders,
                            body: JSON.stringify({ accountId: serviceAccountId }),
                        });
                        await new Promise(r => setTimeout(r, 3000));
                        const retryRes = await fetch(
                            `${JIRA_HOST}/rest/api/3/issue/${key}/transitions?expand=transitions.fields`,
                            { headers: fetchHeaders }
                        );
                        if (retryRes.ok) {
                            allTrans = (await retryRes.json()).transitions || [];
                            console.log(`[close] Tras reasignación temporal: ${allTrans.length} transiciones: [${allTrans.map(t=>`${t.id}:"${t.name}"`).join(', ')}]`);
                        }
                    }
                }
            } catch (_) { console.warn('[close] Reasignación service account fallida:', _.message); }
        }

        // Si aún no hay transiciones y no se pudo cerrar, verificar estado actual
        if (!allTrans.length && !jiraClosed) {
            try {
                const chkRes = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}?fields=status`, { headers: fetchHeaders });
                if (chkRes.ok) {
                    const chkSt = (await chkRes.json()).fields?.status?.name || '';
                    if (/cerrado|closed|resuelto|resolved|done|finalizado|completado/i.test(chkSt)) {
                        console.log(`[close] ${key} ya en estado "${chkSt}" en Jira → sin transición necesaria`);
                        jiraClosed = true;
                    } else {
                        console.warn(`[close] ${key} sin transiciones disponibles (estado Jira: "${chkSt}") — solo cierre local`);
                        jiraError = `Sin transiciones disponibles desde estado "${chkSt}"`;
                    }
                }
            } catch (_) {}
        }

        console.log(`ℹ️  Transiciones [${key}]: ${allTrans.map(t => `${t.id}:${t.name}`).join(', ')}`);

        if (!jiraClosed) {
        // Buscar transición de cierre — reutilizar las constantes ya definidas arriba
        let transicierre = allTrans.find(t => {
            const n = t.name.toLowerCase();
            if (EXCLUIR_CHK.some(x => n.includes(x))) return false;
            return CIERRE_EXACTO_CHK.some(c => n.includes(c));
        });
        // Fallback por ID conocido (11 = RESUELTO en este proyecto Jira)
        if (!transicierre) transicierre = allTrans.find(t => t.id === '11');
        // Último recurso: primera transición que no sea de escalado/derivación
        if (!transicierre) {
            transicierre = allTrans.find(t => !EXCLUIR_CHK.some(x => t.name.toLowerCase().includes(x)));
        }

        if (!transicierre) {
            throw new Error(`Sin transición de cierre disponible para ${key} — permisos insuficientes en Jira`);
        }
        console.log(`ℹ️  Usando transición: ${transicierre.id} - "${transicierre.name}"`);

        // 2. Construir campos personalizados usando los valores del formulario
        const buildFields = (tf) => {
            const f = {};
            // Campos conocidos que siempre enviamos si están en el screen (required o no)
            const KNOWN = new Set(['customfield_13268','customfield_13270','customfield_13271','customfield_15344','resolution']);
            Object.entries(tf).forEach(([fk, fv]) => {
                // Saltar campos sin allowedValues que no conocemos (issuelinks, assignee, etc.)
                if (!fv.required && !KNOWN.has(fk)) return;
                const av = fv.allowedValues || [];
                if (fk === 'customfield_13268') {
                    const opt = av.find(o => (o.value||'').toLowerCase().includes(resolucion.toLowerCase())) || av[0];
                    if (opt) f[fk] = { id: opt.id };
                } else if (fk === 'customfield_13270') {
                    const opt = av.find(o => (o.value||'').toLowerCase().includes(proceso.toLowerCase())) || av[0];
                    if (opt) f[fk] = [{ id: opt.id }];
                } else if (fk === 'customfield_13271') {
                    f[fk] = { value: masiva };
                } else if (fk === 'customfield_15344') {
                    const parent = av.find(o => (o.value||'').toLowerCase().includes(resultado_padre.toLowerCase())) || av[0];
                    if (parent) {
                        const child = (parent.children||[]).find(c => (c.value||'').toLowerCase().includes(resultado_hijo.toLowerCase())) || parent.children?.[0];
                        f[fk] = child
                            ? { value: parent.value, child: { value: child.value } }
                            : { value: parent.value };
                    }
                } else if (fk === 'resolution') {
                    const opt = av.find(o => /done|fixed|resolved/i.test(o.name)) || av[0];
                    if (opt) f[fk] = { id: opt.id };
                } else if (fv.required && av.length) {
                    f[fk] = { id: av[0].id };
                }
            });
            return f;
        };

        const tf = transicierre.fields || {};
        const adfComment = { comment: [{ add: { body: {
            type: 'doc', version: 1,
            content: [{ type: 'paragraph', content: [{ type: 'text', text: comment.trim() }] }]
        }}}] };

        // 3. Ejecutar transición — primero con campos, si el ticket no transiciona reintentar sin campos custom
        const builtFields = buildFields(tf);
        console.log(`[close ${key}] transición "${transicierre.name}" con fields:`, JSON.stringify(builtFields));

        // Estados conocidos como "abierto" — si el ticket sigue en uno de estos tras la transición, consideramos que falló
        const openKeywords = /^(asignado|pendiente|waiting|open|abierto|nuevo|en progreso|in progress|reopened)/i;

        const _tryTransition = async (fields) => {
            const body = fields && Object.keys(fields).length
                ? { transition: { id: transicierre.id }, update: adfComment, fields }
                : { transition: { id: transicierre.id }, update: adfComment };
            const r = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/transitions`, {
                method: 'POST', headers: fetchHeaders, body: JSON.stringify(body),
            });
            const txt = await r.text();
            if (txt.trim().startsWith('<') || (!r.ok && r.status !== 204)) {
                const isHtml = txt.trim().startsWith('<');
                const err = new Error(isHtml ? `HTTP ${r.status} - WAF block`
                    : (() => { try { const j=JSON.parse(txt||'{}'); return j.errorMessages?.[0]||JSON.stringify(j.errors||{})||`HTTP ${r.status}`; } catch { return `HTTP ${r.status}`; } })());
                err.response = { status: r.status, data: txt };
                throw err;
            }
            // Verificar estado tras transición — si sigue en estado "abierto" conocido, falló
            const vR = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}?fields=status`, { headers: fetchHeaders });
            if (vR.ok) {
                const newStatus = (await vR.json()).fields?.status?.name || '';
                console.log(`[close ${key}] estado post-transición: "${newStatus}"`);
                if (openKeywords.test(newStatus)) return null; // sigue abierto
                return newStatus || 'ok'; // cualquier otro estado = cerrado/cambiado
            }
            return 'ok'; // sin verificación = asumir éxito
        };

        let closedStatus = await _tryTransition(builtFields).catch(e => {
            console.error(`[close ${key}] intento 1 error:`, e.message, e.response?.data?.slice?.(0,300) || '');
            return null;
        });
        if (!closedStatus && Object.keys(builtFields).length) {
            console.log(`[close ${key}] reintentando sin campos custom`);
            closedStatus = await _tryTransition({}).catch(e => {
                console.error(`[close ${key}] intento 2 (sin fields) error:`, e.message, e.response?.data?.slice?.(0,300) || '');
                return null;
            });
        }
        if (!closedStatus) {
            throw new Error(`No se pudo cerrar ${key} en Jira — ticket sigue abierto`);
        }
        console.log(`✅ Jira cerrado: ${key} vía "${transicierre.name}" → "${closedStatus}"`);
        jiraClosed = true;
        // Restaurar assignee original si fue reasignado para desbloquear transiciones
        if (originalAssigneeId) {
            try {
                await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/assignee`, {
                    method: 'PUT', headers: fetchHeaders,
                    body: JSON.stringify({ accountId: originalAssigneeId }),
                });
                console.log(`[close] Assignee restaurado a ${originalAssigneeId}`);
            } catch (_) {}
        }
        } // end if (!jiraClosed)
    } catch (err) {
        const respData = err.response?.data;
        const isHtml = typeof respData === 'string' && respData.trim().startsWith('<');
        const errorsStr = respData?.errors && Object.keys(respData.errors).length
            ? JSON.stringify(respData.errors)
            : null;
        jiraError = isHtml
            ? `HTTP ${err.response?.status} - bloqueo WAF`
            : (respData?.errorMessages?.[0] || respData?.errorMessage || errorsStr || err.message || 'Error desconocido');
        console.error(`❌ Error transición Jira [${err.response?.status || 'local'}]: ${jiraError}`);
    }

    const closedBy = req.user?.full_name || req.user?.username || 'Sistema';
    // Actualización local — no bloqueante: si la tabla no existe o el ticket no está en caché, no falla el cierre
    dbQuery(
        `UPDATE jira_tickets
         SET status = 'Resuelto', internal_status = 'cerrado', closed_at = NOW(),
             closed_by = ?, close_comment = ?, tipo_atencion = ?, resolved_at = IFNULL(resolved_at, NOW())
         WHERE ticket_key = ?`,
        [req.user?.username || 'sistema', comment.trim(), tipo_atencion, key]
    ).catch(() => {});
    dbQuery(`INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?, ?, ?, 'cierre', ?)`,
        [key, req.user?.id || 0, closedBy, `Ticket cerrado por ${closedBy}. Tipo: ${tipo_atencion}. ${comment.trim()}`]).catch(() => {});

    // Notificar en tiempo real
    try {
        const io = req.app.get('io');
        if (io) {
            io.to('jira:agents').emit('ticket:closed', { key, by: closedBy });
            io.to('tv:dashboard').emit('ticket:event', { action: 'closed', key });
        }
    } catch (_) {}

    // Encuesta de satisfacción (no bloqueante)
    ; (async () => {
        try {
            const cfg = await getAutomationConfig();
            if (cfg.satisfaction_enabled !== '1') return;
            const tRow = await dbQuery(`SELECT reporter FROM jira_tickets WHERE ticket_key=? LIMIT 1`, [key]);
            const reporterEmail = tRow[0]?.reporter;
            if (!reporterEmail || !reporterEmail.includes('@')) return;
            const crypto = require('crypto');
            const token = crypto.randomBytes(24).toString('hex');
            await dbQuery(`INSERT INTO itsm_surveys (ticket_key, token, reporter_email) VALUES (?,?,?)`, [key, token, reporterEmail]);
            const surveyUrl = `${process.env.API_BASE_URL || 'http://localhost:3000'}/api/jira/survey-page/${token}`;
            const html = `
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(9,30,66,.12);">
              <div style="background:linear-gradient(135deg,#0052CC,#2684FF);padding:24px;color:#fff;text-align:center;">
                <div style="font-size:22px;font-weight:700;">¿Cómo fue tu experiencia?</div>
                <div style="font-size:13px;opacity:.85;margin-top:6px;">Tu ticket <strong>${key}</strong> ha sido resuelto</div>
              </div>
              <div style="padding:28px;text-align:center;">
                <p style="font-size:15px;color:#172B4D;margin:0 0 20px;">Por favor califica la atención recibida:</p>
                <div style="display:flex;justify-content:center;gap:12px;margin-bottom:24px;">
                  ${[1, 2, 3, 4, 5].map(n => `<a href="${surveyUrl}?rating=${n}" style="display:inline-block;width:48px;height:48px;line-height:48px;background:#f4f5f7;border-radius:50%;font-size:22px;text-decoration:none;">${['😞', '😐', '🙂', '😊', '🤩'][n - 1]}</a>`).join('')}
                </div>
                <p style="font-size:12px;color:#6B778C;">O haz clic en la carita que mejor represente tu experiencia</p>
              </div>
            </div>`;
            await sendEmail(reporterEmail, `[${key}] ¿Cómo calificarías nuestra atención?`, html);
        } catch (e) { console.error('⚠️ Survey email:', e.message); }
    })();

    if (res.headersSent) return;
    res.json({
        success: true,
        jiraClosed,
        message: jiraClosed
            ? `✅ Ticket ${key} resuelto en Jira y sistema local`
            : `⚠️ Cerrado localmente. Error en Jira: ${jiraError}`,
        data: { key, url: `${JIRA_HOST}/browse/${key}` }
    });
});

// ── TRANSICIÓN: PENDIENTE → ASIGNADO (Reanudar) ───────────────────────────────
router.post('/ticket/:key/reanudar', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { comment } = req.body;

    if (!comment?.trim()) {
        return res.status(400).json({ success: false, message: 'El comentario es obligatorio' });
    }

    let jiraOk = false;
    let jiraError = null;

    try {
        const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
        const fetchHeaders = {
            'Authorization': `Basic ${b64Auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        const transRes = await fetch(
            `${JIRA_HOST}/rest/api/3/issue/${key}/transitions`,
            { headers: fetchHeaders }
        );
        if (!transRes.ok) throw new Error(`HTTP ${transRes.status} al obtener transiciones`);
        const { transitions = [] } = await transRes.json();

        console.log(`ℹ️  Transiciones reanudar [${key}]: ${transitions.map(t => `${t.id}:${t.name}`).join(', ')}`);

        const REANUDAR_WORDS = ['reanudar', 'retomar', 'resume', 'reopen', 'reabrir', 'volver', 'continuar', 'asignado', 'en curso', 'asignar'];
        const transReanudar = transitions.find(t => REANUDAR_WORDS.some(w => t.name.toLowerCase().includes(w)));

        if (!transReanudar) {
            jiraError = `Sin transición de "Reanudar" disponible para ${key}`;
        } else {
            const adfComment = { comment: [{ add: { body: {
                type: 'doc', version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: comment.trim() }] }]
            }}}] };

            const pendRes = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/transitions`, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify({ transition: { id: transReanudar.id }, update: adfComment }),
            });

            if (!pendRes.ok && pendRes.status !== 204) {
                const txt = await pendRes.text();
                throw new Error(`Jira ${pendRes.status}: ${txt.slice(0, 200)}`);
            }
            jiraOk = true;
            console.log(`✅ Reanudar Jira: ${key} → "${transReanudar.name}"`);
        }
    } catch (err) {
        jiraError = err.message;
        console.error(`❌ Reanudar Jira [${key}]:`, err.message);
    }

    try {
        await dbQuery(
            `UPDATE jira_tickets SET status = 'Asignado', internal_status = 'asignado' WHERE ticket_key = ?`,
            [key]
        );
        const userName = req.user?.full_name || req.user?.username || 'Sistema';
        dbQuery(
            `INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?, ?, ?, 'reanudar', ?)`,
            [key, req.user?.id || 0, userName, `Ticket reanudado desde Pendiente. ${comment.trim()}`]
        ).catch(() => {});
    } catch (_) {}

    res.json({
        success: true,
        jiraOk,
        message: jiraOk
            ? `✅ ${key} reanudado en Jira y sistema`
            : `⚠️ Actualizado localmente. ${jiraError || 'Jira no disponible'}`,
    });
});

// ── TRANSICIÓN: ASIGNADO → PENDIENTE ──────────────────────────────────────────
router.post('/ticket/:key/pending', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { comment } = req.body;

    if (!comment?.trim()) {
        return res.status(400).json({ success: false, message: 'El comentario es obligatorio' });
    }

    let jiraOk = false;
    let jiraError = null;

    try {
        const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
        const fetchHeaders = {
            'Authorization': `Basic ${b64Auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        const transRes = await fetch(
            `${JIRA_HOST}/rest/api/3/issue/${key}/transitions`,
            { headers: fetchHeaders }
        );
        if (!transRes.ok) throw new Error(`HTTP ${transRes.status} al obtener transiciones`);
        const { transitions = [] } = await transRes.json();

        console.log(`ℹ️  Transiciones [${key}]: ${transitions.map(t => `${t.id}:${t.name}`).join(', ')}`);

        const transPend = transitions.find(t => t.name.toLowerCase().includes('pendiente'));
        if (!transPend) {
            jiraError = `Sin transición "Pendiente" disponible para ${key} en este estado`;
        } else {
            const adfComment = { comment: [{ add: { body: {
                type: 'doc', version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: comment.trim() }] }]
            }}}] };

            const pendRes = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/transitions`, {
                method: 'POST',
                headers: fetchHeaders,
                body: JSON.stringify({ transition: { id: transPend.id }, update: adfComment }),
            });

            if (!pendRes.ok && pendRes.status !== 204) {
                const txt = await pendRes.text();
                throw new Error(`Jira ${pendRes.status}: ${txt.slice(0, 200)}`);
            }
            jiraOk = true;
            console.log(`✅ Pendiente Jira: ${key} → "${transPend.name}"`);
        }
    } catch (err) {
        jiraError = err.message;
        console.error(`❌ Pendiente Jira [${key}]:`, err.message);
    }

    try {
        await dbQuery(
            `UPDATE jira_tickets SET status = 'Pendiente', internal_status = 'pendiente' WHERE ticket_key = ?`,
            [key]
        );
        const userName = req.user?.full_name || req.user?.username || 'Sistema';
        dbQuery(
            `INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?, ?, ?, 'pendiente', ?)`,
            [key, req.user?.id || 0, userName, `Ticket puesto en Pendiente. ${comment.trim()}`]
        ).catch(() => {});
    } catch (_) {}

    res.json({
        success: true,
        jiraOk,
        message: jiraOk
            ? `✅ ${key} puesto en Pendiente en Jira y sistema`
            : `⚠️ Actualizado localmente. ${jiraError || 'Jira no disponible'}`,
    });
});

// Componentes CMDB conocidos — fallback garantizado si todas las APIs fallan
const CMDB_COMPONENTS_FALLBACK = [
    { id: 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11110', name: 'Aplicaciones',   key: 'CMDB-11110' },
    { id: 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:35007', name: 'Infraestructura', key: 'CMDB-35007' },
    { id: 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11111', name: 'Plataformas',     key: 'CMDB-11111' },
    { id: 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:12384', name: 'RED',             key: 'CMDB-12384' },
    { id: 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:12010', name: 'SOC de RED',      key: 'CMDB-12010' },
    { id: 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11277', name: 'Workplace',       key: 'CMDB-11277' },
];

// ── DERIVAR: Leer componentes CMDB disponibles (customfield_14687) ─────────────
router.get('/ticket/:key/derivar-options', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
    const h = { 'Authorization': `Basic ${b64Auth}`, 'Accept': 'application/json', 'Content-Type': 'application/json' };

    let components = [];
    const dbg = [];

    // Intento 1: Atlassian Assets Cloud API (api.atlassian.com — diseñada para server-to-server)
    try {
        const wsId = await getAssetsWorkspaceId();
        for (const ql of ['objectType = "Componentes"', 'objectType = Componentes']) {
            const r = await fetch(
                `https://api.atlassian.com/jsm/assets/workspace/${wsId}/v1/object/aql`,
                { method: 'POST', headers: h, body: JSON.stringify({ qlQuery: ql, maxResults: 50, page: 0 }) }
            );
            const txt = await r.text();
            dbg.push(`CloudAQL(${ql}): ${r.status}`);
            if (r.ok) {
                const d = JSON.parse(txt);
                const entries = d.values || d.objectEntries || [];
                if (entries.length) {
                    components = entries.map(o => ({
                        id:   o.globalId || `${wsId}:${o.id}`,
                        name: o.label || o.name || o.objectKey,
                        key:  o.objectKey,
                    }));
                    break;
                }
            }
        }
    } catch (e) { dbg.push(`CloudAQL err: ${e.message}`); }

    // Intento 2: Legacy Insight API dentro del host Jira
    if (!components.length) {
        try {
            const wsId = await getAssetsWorkspaceId();
            for (const path of [
                `/rest/insight/1.0/iql/objects?iql=${encodeURIComponent('objectType = "Componentes"')}&maxResults=50`,
                `/rest/assets/1.0/object/iql?iql=${encodeURIComponent('objectType = "Componentes"')}&maxResults=50&includeAttributes=false`,
            ]) {
                const r = await fetch(`${JIRA_HOST}${path}`, { headers: h });
                dbg.push(`InsightIQL(${path.split('?')[0]}): ${r.status}`);
                if (r.ok) {
                    const d = await r.json();
                    const entries = d.objectEntries || d.values || [];
                    if (entries.length) {
                        components = entries.map(o => ({
                            id:   o.globalId || `${wsId}:${o.id}`,
                            name: o.label || o.name || o.objectKey,
                            key:  o.objectKey,
                        }));
                        break;
                    }
                }
            }
        } catch (e) { dbg.push(`InsightIQL err: ${e.message}`); }
    }

    // Intento 3: CMDB autocomplete
    if (!components.length) {
        try {
            const FIELD_ID = 'customfield_14687';
            const CONFIG_ID = process.env.JIRA_CMDB_COMPONENT_CONFIG || '15588';
            for (const body of [{}, { searchTerm: '' }, { query: '' }]) {
                const r = await fetch(
                    `${JIRA_HOST}/rest/servicedesk/cmdb/1/field/${FIELD_ID}/config/${CONFIG_ID}/autocomplete`,
                    { method: 'POST', headers: h, body: JSON.stringify(body) }
                );
                dbg.push(`CMDBAutocomplete: ${r.status}`);
                if (r.ok) {
                    const d = await r.json();
                    const raw = d.values || d.results || (Array.isArray(d) ? d : []);
                    if (raw.length) {
                        components = raw.map(o => ({
                            id:   o.id || o.globalId || String(o.internalId || ''),
                            name: o.label || o.name || o.Name || o.objectKey,
                            key:  o.objectKey,
                        }));
                        break;
                    }
                }
            }
        } catch (e) { dbg.push(`CMDB err: ${e.message}`); }
    }

    // Fallback garantizado: lista conocida del CMDB
    if (!components.length) {
        console.warn('[derivar-options] APIs fallaron, usando fallback hardcodeado:', dbg);
        components = CMDB_COMPONENTS_FALLBACK;
    }

    const rows = await dbQuery(`SELECT component FROM jira_tickets WHERE ticket_key = ? LIMIT 1`, [key]);
    const currentComponent = rows[0]?.component || null;
    res.json({ success: true, components, currentComponent, _debug: dbg });
});

// ── DERIVAR: Cambiar Tipo de Componente (customfield_14687) ───────────────────
router.put('/ticket/:key/derivar', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { componentId, componentName, comment } = req.body;
    if (!componentId) return res.status(400).json({ success: false, message: 'componentId requerido' });

    const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
    const h = { 'Authorization': `Basic ${b64Auth}`, 'Accept': 'application/json', 'Content-Type': 'application/json' };

    let jiraOk = false;
    let jiraError = null;

    try {
        const wsId = await getAssetsWorkspaceId();
        const globalId = toGlobalId(componentId, wsId);

        // 1. Actualizar campo Tipo de Componente en Jira
        const updRes = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}`, {
            method: 'PUT', headers: h,
            body: JSON.stringify({ fields: { customfield_14687: [{ id: globalId }] } }),
        });
        if (!updRes.ok && updRes.status !== 204) {
            const txt = await updRes.text();
            throw new Error(`Jira ${updRes.status}: ${txt.slice(0, 300)}`);
        }

        // 2. Agregar comentario de derivación
        if (comment?.trim()) {
            await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/comment`, {
                method: 'POST', headers: h,
                body: JSON.stringify({ body: {
                    type: 'doc', version: 1,
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: comment.trim() }] }],
                }}),
            }).catch(() => {});
        }

        // 3. Desasignar técnico actual (el nuevo grupo lo tomará)
        await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/assignee`, {
            method: 'PUT', headers: h, body: JSON.stringify({ accountId: null }),
        }).catch(() => {});

        jiraOk = true;
        console.log(`✅ Derivar [${key}]: ${componentName} (${globalId})`);
    } catch (err) {
        jiraError = err.message;
        console.error(`❌ Derivar [${key}]:`, err.message);
    }

    try {
        const actor = req.user?.full_name || req.user?.username || 'Sistema';
        await dbQuery(
            `UPDATE jira_tickets SET component = ?, internal_status = 'derivado', assigned_to = NULL, assigned_to_name = NULL WHERE ticket_key = ?`,
            [componentName || componentId, key]
        );
        dbQuery(
            `INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?, ?, ?, 'derivacion', ?)`,
            [key, req.user?.id || 0, actor,
             `Ticket derivado al grupo "${componentName || componentId}"${comment ? '. ' + comment.trim() : ''}. Por: ${actor}`]
        ).catch(() => {});

        try {
            const io = req.app.get('io');
            if (io) {
                io.to('jira:agents').emit('ticket:derived', { key, componentName, by: actor });
                io.to('tv:dashboard').emit('ticket:event', { action: 'derived', key });
            }
        } catch (_) {}
    } catch (dbErr) {
        return res.status(500).json({ success: false, message: 'Error BD: ' + dbErr.message });
    }

    res.json({
        success: true,
        jiraOk,
        message: jiraOk
            ? `✅ Ticket ${key} derivado al grupo "${componentName}"`
            : `⚠️ Derivado localmente. Jira: ${jiraError}`,
        data: { key, componentId, componentName },
    });
});

// ── GET TRANSICIONES DISPONIBLES ──────────────────────────────────────────────
router.get('/ticket/:key/transitions', authenticateToken, async (req, res) => {
    const { key } = req.params;
    try {
        const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
        const r = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/transitions`, {
            headers: { 'Authorization': `Basic ${b64Auth}`, 'Accept': 'application/json' },
        });
        if (!r.ok) return res.status(r.status).json({ success: false, message: `Jira HTTP ${r.status}` });
        const { transitions = [] } = await r.json();
        res.json({
            success: true,
            transitions: transitions.map(t => ({ id: t.id, name: t.name, to: t.to?.name || '' })),
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ── APLICAR TRANSICIÓN GENÉRICA ───────────────────────────────────────────────
router.post('/ticket/:key/transition', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { transitionId, transitionName, comment } = req.body;
    if (!transitionId) return res.status(400).json({ success: false, message: 'transitionId requerido' });

    try {
        const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
        const fetchHeaders = {
            'Authorization': `Basic ${b64Auth}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        };

        const body = { transition: { id: String(transitionId) } };
        if (comment?.trim()) {
            body.update = { comment: [{ add: { body: {
                type: 'doc', version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: comment.trim() }] }],
            }}}] };
        }

        const r = await fetch(`${JIRA_HOST}/rest/api/3/issue/${key}/transitions`, {
            method: 'POST', headers: fetchHeaders, body: JSON.stringify(body),
        });

        if (!r.ok && r.status !== 204) {
            const txt = await r.text();
            return res.status(400).json({ success: false, message: `Jira ${r.status}: ${txt.slice(0, 200)}` });
        }

        try {
            const userName = req.user?.full_name || req.user?.username || 'Sistema';
            dbQuery(
                `INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?, ?, ?, 'transicion', ?)`,
                [key, req.user?.id || 0, userName, `Transición aplicada: ${transitionName || transitionId}`]
            ).catch(() => {});
        } catch (_) {}

        res.json({ success: true, message: `✅ Transición aplicada: ${transitionName || transitionId}` });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Página pública de encuesta (redirige al iframe/página de votación)
router.get('/survey-page/:token', async (req, res) => {
    const { token } = req.params;
    const rating = parseInt(req.query.rating) || 0;
    if (rating >= 1 && rating <= 5) {
        // Auto-submit desde email
        try {
            await dbQuery(`UPDATE itsm_surveys SET rating=?, responded_at=NOW() WHERE token=? AND rating IS NULL`, [rating, token]);
        } catch (e) { }
    }
    const emojis = ['', '😞', '😐', '🙂', '😊', '🤩'];
    const labels = ['', 'Muy malo', 'Regular', 'Bueno', 'Muy bueno', 'Excelente'];
    res.send(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Encuesta de satisfacción</title>
    <style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f5f7;display:flex;align-items:center;justify-content:center;min-height:100vh;}
    .card{background:#fff;border-radius:16px;padding:40px;max-width:480px;width:90%;box-shadow:0 8px 32px rgba(9,30,66,.15);text-align:center;}
    h1{color:#172B4D;font-size:22px;margin:0 0 8px;} p{color:#6B778C;font-size:14px;}
    .stars{display:flex;justify-content:center;gap:12px;margin:24px 0;}
    .star{font-size:40px;cursor:pointer;transition:transform .2s;text-decoration:none;}
    .star:hover,.star.active{transform:scale(1.2);}
    .thanks{color:#0052CC;font-size:18px;font-weight:700;margin-top:16px;}</style></head>
    <body><div class="card">
    ${rating ? `<div style="font-size:64px;">${emojis[rating]}</div>
    <h1>¡Gracias por tu calificación!</h1>
    <p>Registramos tu respuesta: <strong>${labels[rating]}</strong></p>
    <p style="margin-top:16px;font-size:12px;color:#aaa;">Tu opinión nos ayuda a mejorar.</p>`
            : `<h1>Califica tu experiencia</h1><p>¿Cómo fue la atención recibida?</p>
    <div class="stars">${[1, 2, 3, 4, 5].map(n => `<a class="star" href="?rating=${n}" title="${labels[n]}">${emojis[n]}</a>`).join('')}</div>`}
    </div></body></html>`);
});



// ============================================================


router.get('/queue/unassigned', authenticateToken, async (req, res) => {
    try {
        const data = await jira('GET',
            `/rest/servicedeskapi/request?serviceDeskId=${SD_ID}&requestOwnership=ALL_REQUESTS&requestStatus=OPEN_REQUESTS&limit=50&expand=requestFieldValues,status`
        );
        const items = (data.values || []).map(t => ({
            key: t.issueKey,
            summary: (t.requestFieldValues || []).find(f => f.fieldId === 'summary')?.value || '—',
            status: t.currentStatus?.status || '—',
            reporter: t.reporter?.emailAddress || t.reporter?.displayName || '—',
            created: t.createdDate?.iso8601 || null,
            url: `${JIRA_HOST}/browse/${t.issueKey}`
        }));
        res.json({ success: true, data: items, total: data.size });
    } catch (error) {
        const s = error.response?.status || 500;
        res.status(s).json({
            success: false,
            noAccess: s === 403 || s === 401,
            message: error.response?.data?.errorMessage || error.message
        });
    }
});



// ============================================================


router.get('/queue/assigned', authenticateToken, async (req, res) => {
    try {
        const data = await jira('GET',
            `/rest/servicedeskapi/request?serviceDeskId=${SD_ID}&requestOwnership=ALL_REQUESTS&requestStatus=IN_PROGRESS&limit=50&expand=requestFieldValues,status`
        );
        const items = (data.values || []).map(t => ({
            key: t.issueKey,
            summary: (t.requestFieldValues || []).find(f => f.fieldId === 'summary')?.value || '—',
            status: t.currentStatus?.status || '—',
            reporter: t.reporter?.emailAddress || t.reporter?.displayName || '—',
            created: t.createdDate?.iso8601 || null,
            url: `${JIRA_HOST}/browse/${t.issueKey}`
        }));
        res.json({ success: true, data: items, total: data.size });
    } catch (error) {
        const s = error.response?.status || 500;
        res.status(s).json({
            success: false,
            noAccess: s === 403 || s === 401,
            message: error.response?.data?.errorMessage || error.message
        });
    }
});



// ============================================================


router.put('/ticket/:key/assign', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ success: false, message: 'accountId es requerido' });
    try {
        await jira('PUT', `/rest/api/3/issue/${key}/assignee`, { accountId });
        res.json({ success: true, message: `Ticket ${key} asignado` });
    } catch (error) {
        const s = error.response?.status || 500;
        res.status(s).json({
            success: false,
            noAccess: s === 403 || s === 401,
            message: error.response?.data?.errorMessage || error.message
        });
    }
});



// ============================================================


router.put('/ticket/:key/assign-tech', authenticateToken, async (req, res) => {
    const { key } = req.params;
    const { techId, email, accountId: providedAccountId } = req.body;
    if (!techId && !email) return res.status(400).json({ success: false, message: 'techId o email requerido' });
    try {
        const techs = email
            ? await dbQuery(`SELECT id, full_name, username, email FROM users WHERE email=? LIMIT 1`, [email])
            : await dbQuery(`SELECT id, full_name, username, email FROM users WHERE id=? LIMIT 1`, [techId]);
        const tech = techs[0] || { id: null, full_name: email, username: email, email };
        const lookupEmail = tech.email || email || '';

        let resolvedAccountId = providedAccountId || null;
        let resolvedName = null;
        let jiraAssigned = false;

        // 1. Agent cache (incluye /myself para el service account)
        if (!resolvedAccountId) {
            const agent = await resolveJiraAccountId(lookupEmail);
            if (agent) { resolvedAccountId = agent.accountId; resolvedName = agent.displayName; }
        }

        // 2. DB cache de asignaciones previas
        if (!resolvedAccountId) {
            try {
                const row = await dbQuery(
                    `SELECT jira_account_id, COALESCE(assigned_to_name, jira_assignee) AS name
                     FROM jira_tickets WHERE jira_assignee=? AND jira_account_id IS NOT NULL AND jira_account_id!='' LIMIT 1`,
                    [lookupEmail]
                );
                if (row[0]?.jira_account_id) { resolvedAccountId = row[0].jira_account_id; resolvedName = row[0].name; }
            } catch (_) {}
        }

        // 3. Fetch de un ticket activo asignado a ese email en Jira
        if (!resolvedAccountId) {
            try {
                const rows = await dbQuery(
                    `SELECT ticket_key FROM jira_tickets WHERE jira_assignee=? AND ticket_key IS NOT NULL
                     AND internal_status NOT IN ('cerrado','resuelto') ORDER BY created_at DESC LIMIT 3`,
                    [lookupEmail]
                );
                for (const row of rows) {
                    try {
                        const issue = await jira('GET', `/rest/api/3/issue/${row.ticket_key}?fields=assignee`);
                        const a = issue.fields?.assignee;
                        if (a?.accountId) { resolvedAccountId = a.accountId; resolvedName = a.displayName; break; }
                    } catch (_) {}
                }
            } catch (_) {}
        }

        // Intentar PUT en Jira
        if (resolvedAccountId) {
            try {
                await jira('PUT', `/rest/api/3/issue/${key}/assignee`, { accountId: resolvedAccountId });
                jiraAssigned = true;
                await dbQuery(
                    `UPDATE jira_tickets SET jira_account_id=? WHERE jira_assignee=? AND (jira_account_id IS NULL OR jira_account_id='')`,
                    [resolvedAccountId, lookupEmail]
                ).catch(() => {});
            } catch (e) {
                console.warn(`[assign] Jira PUT falló: ${e.message}`);
            }
        }
        const techName = resolvedName || tech.full_name || tech.username || email;
        // Actualizar BD siempre (independiente de si Jira funcionó)
        await dbQuery(
            `UPDATE jira_tickets
             SET assigned_to = ?, assigned_to_name = ?, jira_assignee = ?,
                 ${resolvedAccountId ? 'jira_account_id = ?,' : ''}
                 assigned_at = NOW(), internal_status = 'asignado',
                 first_response_at = IFNULL(first_response_at, NOW())
             WHERE ticket_key = ?`,
            resolvedAccountId
                ? [tech.id, techName, lookupEmail, resolvedAccountId, key]
                : [tech.id, techName, lookupEmail, key]
        );
        const actor = req.user?.full_name || req.user?.username || 'Admin';
        dbQuery(`INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?, ?, ?, 'asignacion', ?)`,
            [key, req.user?.id || 0, actor, `Ticket asignado a ${techName} por ${actor}`]).catch(() => {});

        // Notificar en tiempo real
        try {
            const io = req.app.get('io');
            if (io) {
                io.to('jira:agents').emit('ticket:assigned', { key, techName, by: actor });
                io.to('tv:dashboard').emit('ticket:event', { action: 'assigned', key });
            }
        } catch (_) {}

        if (jiraAssigned) {
            res.json({ success: true, message: `Ticket ${key} asignado a ${techName}` });
        } else {
            res.json({ success: true, jiraWarning: true, message: `${key} asignado localmente a ${techName}. Jira no pudo actualizarse — verifica la conexión.` });
        }
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


// ============================================================

// PROXY PARA PETICIONES JIRA DIRECTAS (ej: JQL SEARCH)
router.all('/rest/*', authenticateToken, async (req, res) => {
    const restPath = '/rest/' + req.params[0];
    const qs = Object.keys(req.query).length
        ? '?' + new URLSearchParams(req.query).toString()
        : '';
    try {
        const auth = { username: JIRA_EMAIL, password: JIRA_TOKEN };
        const r = await axios({
            method: req.method,
            url: `${JIRA_HOST}${restPath}${qs}`,
            auth,
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'X-ExperimentalApi': 'opt-in',
            },
            data: ['POST', 'PUT', 'PATCH'].includes(req.method.toUpperCase()) ? req.body : undefined,
            timeout: 20000,
            validateStatus: () => true,
        });

        // Enrich reporter.emailAddress from local DB (Jira Cloud hides customer emails by privacy policy)
        const data = r.data;
        if (data?.issues?.length) {
            const keys = data.issues.map(i => i.key).filter(Boolean);
            if (keys.length) {
                try {
                    const rows = await dbQuery(
                        `SELECT ticket_key, reporter FROM jira_tickets WHERE ticket_key IN (${keys.map(() => '?').join(',')})`,
                        keys
                    );
                    const rMap = Object.fromEntries(rows.map(row => [row.ticket_key, row.reporter]));
                    data.issues.forEach(issue => {
                        const localReporter = rMap[issue.key];
                        if (!localReporter || !issue.fields) return;
                        if (!issue.fields.reporter) issue.fields.reporter = {};
                        // Prefer local DB reporter when it's a real user (not the API integration account)
                        // Jira Cloud may hide customer emails or show the API account as reporter
                        if (localReporter !== JIRA_EMAIL || !issue.fields.reporter.emailAddress) {
                            issue.fields.reporter.emailAddress = localReporter;
                        }
                    });
                } catch (_) { /* enrich is best-effort */ }
            }
        }

        res.status(r.status).json(data);
    } catch (e) {
        res.status(500).json({ message: e.message });
    }
});

// ── Sync tickets de Jira → BD local (recibe datos del browser, evita WAF server-side) ──
router.post('/sync-tickets', authenticateToken, async (req, res) => {
    try {
        const issues = req.body?.issues;
        if (!Array.isArray(issues) || !issues.length) {
            return res.json({ success: true, upserted: 0, message: 'Sin tickets para sincronizar' });
        }

        const defRows = await dbQuery(`SELECT id, full_name FROM users WHERE email=? AND deleted_at IS NULL LIMIT 1`, [JIRA_EMAIL]);
        const defUser = defRows[0] || null;
        const slaHours = { P1: 1, P2: 4, P3: 8, P4: 24 };
        let upserted = 0;

        for (const issue of issues) {
            const f = issue.fields || {};
            const priority = mapPriority(f.priority?.name || 'Medium');
            const statusName = f.status?.name || 'Open';
            const internalStatus = mapJiraStatus(statusName);
            const reporter = f.reporter?.emailAddress || f.creator?.emailAddress || '';
            const summary = f.summary || '';
            const createdAt = f.created ? new Date(f.created) : new Date();
            const slaH = slaHours[priority] || 8;

            await dbQuery(
                `INSERT INTO jira_tickets
                    (ticket_key, summary, reporter, status, internal_status, priority,
                     jira_url, sla_deadline, assigned_to, assigned_to_name, assigned_at,
                     first_response_at, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?,
                         DATE_ADD(?, INTERVAL ? HOUR),
                         ?, ?, ${defUser ? 'NOW()' : 'NULL'},
                         ${defUser ? 'NOW()' : 'NULL'}, ?)
                 ON DUPLICATE KEY UPDATE
                     summary         = VALUES(summary),
                     status          = VALUES(status),
                     internal_status = IF(internal_status IN ('cerrado','resuelto'), internal_status, VALUES(internal_status))`,
                [
                    issue.key, summary, reporter,
                    statusName, internalStatus, priority,
                    `${JIRA_HOST}/browse/${issue.key}`,
                    createdAt, slaH,
                    defUser?.id || null, defUser?.full_name || null,
                    createdAt
                ]
            );
            upserted++;
        }

        res.json({ success: true, upserted, message: `${upserted} ticket(s) sincronizados` });
    } catch (e) {
        console.error('[sync-tickets]', e.message);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ── staff_directorio: crear tabla al arrancar ──────────────────────────────────
(async () => {
    try {
        await dbQuery(`
            CREATE TABLE IF NOT EXISTS staff_directorio (
                id      INT AUTO_INCREMENT PRIMARY KEY,
                celular VARCHAR(30)  NULL,
                cip     VARCHAR(20)  NULL,
                nombre  VARCHAR(250) NOT NULL,
                INDEX idx_nombre (nombre(100)),
                INDEX idx_cip    (cip)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    } catch (_) { /* se crea con el script de importación si falla */ }
})();

// POST /api/jira/staff-phones  — lookup masivo de teléfonos por displayName de Jira
router.post('/staff-phones', authenticateToken, async (req, res) => {
    const { names } = req.body;
    if (!Array.isArray(names) || !names.length) return res.json({ results: {} });

    const results = {};

    for (const raw of names.slice(0, 60)) {
        if (!raw) continue;
        try {
            // Normalizar: quitar tildes, mayúsculas, quedarse con A-Z y espacios
            const norm = raw
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .toUpperCase().replace(/[^A-Z0-9\s]/g, '').trim();

            // Tokens significativos (> 3 chars) — máx 3 para evitar falsos negativos
            const tokens = norm.split(/\s+/).filter(t => t.length > 3).slice(0, 3);
            if (!tokens.length) { results[raw] = null; continue; }

            const where  = tokens.map(() => 'nombre LIKE ?').join(' AND ');
            const params = tokens.map(t => `%${t}%`);

            const rows = await dbQuery(
                `SELECT celular FROM staff_directorio WHERE ${where} AND celular IS NOT NULL LIMIT 1`,
                params
            );
            results[raw] = rows[0]?.celular || null;
        } catch (_) {
            results[raw] = null;
        }
    }

    res.json({ results });
});

module.exports = router;
