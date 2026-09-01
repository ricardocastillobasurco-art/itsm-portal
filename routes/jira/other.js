
const express = require('express');
const router = express.Router();
const { authenticateToken, optionalAuth } = require('../../middleware/auth');
const { jira, dbQuery, upload, assignEmailHtml, sendEmail, getAutomationConfig, mapJiraStatus, mapPriority, extractAdfText, IMPACT_LABELS, URGENCY_LABELS, COMPONENT_LABELS, APP_LABELS, TIPOLOGIA_LABELS, JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, SD_ID, RT_ID } = require('./helpers');
const axios = require('axios');
const FormData = require('form-data');


// TEST AUTH — abre en el navegador: /api/jira/test-auth

// ============================================================

// VIEW

// ============================================================

// GET /api/jira/tickets — Lista desde MySQL

// ============================================================

// GET /api/jira/my-tickets — Lista desde Jira API v3 (estado real), fallback a BD local

// ============================================================

// GET /api/jira/my-tickets/:key — Detalle real desde Jira (servicedeskapi)

// ============================================================

// POST /api/jira/my-tickets/:key/close — Cerrar ticket en Jira (reporter valida ownership)

// ============================================================

// POST /api/jira/my-tickets/:key/comment — Comentar desde portal (sin auth, valida reporter)

// ============================================================

// GET /api/jira/employee-info?email= — Info equipo del empleado

// ============================================================

// GET /api/jira/ticket/:key — Detalle desde MySQL local

// ============================================================

// GET /api/jira/ticket/:key/jira-detail
// Usa servicedeskapi (funciona con token actual)

// ============================================================

// POST /api/jira/attachment

// ============================================================

// POST /api/jira/ticket — Crear en Jira + MySQL

// ============================================================

// POST /api/jira/ticket/:key/close
// transitionId 11 = RESUELTO (confirmado en tu proyecto)

// ============================================================

// GET /api/jira/sync — Sincroniza tickets de Jira → MySQL

// ============================================================

router.get('/sync', authenticateToken, async (_req, res) => {
    const limit = 50;
    let start   = 0;
    let synced  = 0;
    let errors  = 0;
    let usedOwnership = 'ALL_REQUESTS';

    // Helper: extrae label legible de un valor de campo Jira
    const extractLabel = v => {
        if (!v) return '—';
        if (Array.isArray(v))         return v.map(x => x.label || x.value || String(x)).join(', ');
        if (typeof v === 'object')    return v.label || v.value || '—';
        return String(v);
    };

    const fetchPage = async (ownership, s) =>
        jira('GET', `/rest/servicedeskapi/request?serviceDeskId=${SD_ID}&requestOwnership=${ownership}&limit=${limit}&start=${s}&expand=requestFieldValues,status`);

    try {
        let isLastPage = false;
        while (!isLastPage) {
            let data;
            try {
                data = await fetchPage(usedOwnership, start);
            } catch (err) {
                if (err.response?.status === 403 && usedOwnership === 'ALL_REQUESTS') {
                    usedOwnership = 'PARTICIPATED_REQUESTS';
                    data = await fetchPage(usedOwnership, start);
                } else throw err;
            }

            const items = data.values || [];
            isLastPage  = data.isLastPage === true || items.length < limit;

            for (const item of items) {
                try {
                    const f = {};
                    (item.requestFieldValues || []).forEach(field => { f[field.fieldId] = field.value; });

                    const issueKey  = item.issueKey;
                    const summary   = f['summary'] || '—';
                    const reporter  = item.reporter?.emailAddress || item.reporter?.displayName || '—';
                    const statusVal = item.currentStatus?.status || 'Abierto';
                    const created   = item.createdDate?.iso8601 ? new Date(item.createdDate.iso8601) : new Date();

                    const component = extractLabel(f['customfield_14687']);
                    const app       = extractLabel(f['customfield_13274']);
                    const tipologia = extractLabel(f['customfield_13283']);
                    const impact    = extractLabel(f['customfield_10246']);
                    const urgency   = extractLabel(f['customfield_13269']);
                    const phone     = f['customfield_11795'] || null;
                    const desc      = extractLabel(f['description']);

                    const urgencyLevel =
                        urgency.toLowerCase().includes('no puedo')      ? 3 :
                        urgency.toLowerCase().includes('no me impide')  ? 2 : 1;

                    await dbQuery(`
                        INSERT INTO jira_tickets
                            (ticket_key, summary, reporter, status, urgency, urgency_level,
                             impact, component, app_item, tipologia, phone, description,
                             impact_label, jira_url, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        ON DUPLICATE KEY UPDATE
                            summary       = VALUES(summary),
                            status        = VALUES(status),
                            reporter      = VALUES(reporter),
                            urgency       = VALUES(urgency),
                            urgency_level = VALUES(urgency_level),
                            impact        = VALUES(impact),
                            impact_label  = VALUES(impact_label),
                            component     = VALUES(component),
                            app_item      = VALUES(app_item),
                            tipologia     = VALUES(tipologia)
                    `, [
                        issueKey, summary, reporter, statusVal,
                        urgency, urgencyLevel,
                        impact, component, app, tipologia,
                        phone, desc,
                        impact,
                        `${JIRA_HOST}/browse/${issueKey}`,
                        created
                    ]);
                    synced++;
                } catch (itemErr) {
                    console.error(`❌ Sync error ${item.issueKey}:`, itemErr.message);
                    errors++;
                }
            }

            start += limit;
            if (items.length === 0) break;
        }

        console.log(`✅ Sync Jira: ${synced} sincronizados (modo: ${usedOwnership})`);
        res.json({
            success: true,
            synced,
            errors,
            ownership: usedOwnership,
            message: `${synced} tickets sincronizados${errors ? `, ${errors} errores` : ''}`
        });

    } catch (error) {
        console.error('❌ Error sync Jira:', error.response?.data || error.message);
        res.status(500).json({
            success:  false,
            message:  error.response?.data?.errorMessage || error.message,
            noAccess: error.response?.status === 403
        });
    }
});


// ============================================================

// GET /api/jira/queue/unassigned

// ============================================================

// GET /api/jira/queue/assigned

// ============================================================

// GET /api/jira/agents

// ============================================================

// PUT /api/jira/ticket/:key/assign

// ============================================================

// GET /api/jira/technicians — Lista técnicos (usuarios activos)

// ============================================================

// PUT /api/jira/ticket/:key/take — Autoasignación

// ============================================================

// PUT /api/jira/ticket/:key/assign-tech — Asignar a técnico

// ============================================================

// PUT /api/jira/ticket/:key/internal-status — Cambiar estado

// ============================================================

// POST /api/jira/specialists — Crear especialista (usuario técnico)

// ============================================================

// POST /api/jira/ticket/:key/comment — Agregar comentario

// ============================================================

// GET /api/jira/ticket/:key/history — Timeline del ticket

// ============================================================

// GET /api/jira/software-catalog — Autocompletado software

// ============================================================

// PUT /api/jira/ticket/:key/recategorize — Recategorizar

// ============================================================

// POST /api/jira/ticket/:key/send-email — Notificar al usuario

// ============================================================

// GET /api/jira/stats — KPIs por técnico y SLA

// ============================================================

// GET /api/jira/alerts — Solo alertas (para polling ligero)

// ============================================================

// GET /api/jira/report — Exportación de datos filtrados

// ============================================================

// POST /api/jira/report/send-email — Enviar reporte por correo

// ============================================================

// ticket_categories CRUD

// ============================================================

// POST /api/jira/ticket/:key/reopen — Re-apertura de ticket cerrado

// ============================================================

// GET /api/jira/survey-results — Resultados de encuestas

// ============================================================

// GET  /api/jira/automations  — Leer configuración
// PUT  /api/jira/automations  — Guardar configuración

// ============================================================

// GET  /api/jira/survey/:token  — Ver encuesta (público)
// POST /api/jira/survey/:token  — Enviar calificación (público)

// ============================================================

// KB SUGERIDA — búsqueda por palabras clave

// ============================================================

// ADMINISTRACIÓN DE ROLES DE USUARIOS

// ============================================================

// ADJUNTOS EN TICKETS (almacenamiento local)

// ============================================================

// REQUERIMIENTOS — Portal 1156 / RT 1595


module.exports = router;
            
