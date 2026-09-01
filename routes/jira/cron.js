
const { dbQuery, getAutomationConfig, sendEmail } = require('./helpers');
module.exports = function startCron() {
    setInterval(async () => {
    try {
        const cfg = await getAutomationConfig();
        if (cfg.p1_escalation_enabled !== '1' || !cfg.p1_escalation_email) return;
        const mins = parseInt(cfg.p1_escalation_minutes) || 30;
        const tickets = await dbQuery(`
            SELECT ticket_key, summary, reporter, created_at
            FROM jira_tickets
            WHERE priority = 'P1'
              AND assigned_to IS NULL
              AND internal_status NOT IN ('cerrado','resuelto')
              AND escalation_notified_at IS NULL
              AND TIMESTAMPDIFF(MINUTE, created_at, NOW()) >= ?
        `, [mins]);
        for (const t of tickets) {
            const age = Math.round((Date.now() - new Date(t.created_at)) / 60000);
            const html = `
            <div style="font-family:sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(9,30,66,.12);">
              <div style="background:#dc2626;padding:20px 24px;color:#fff;">
                <div style="font-size:18px;font-weight:700;">🚨 Escalación P1 — Sin asignar</div>
                <div style="font-size:13px;opacity:.85;margin-top:4px;">${t.ticket_key} lleva ${age} min sin técnico asignado</div>
              </div>
              <div style="padding:24px;">
                <p style="margin:0 0 8px;font-size:14px;color:#172B4D;"><strong>Ticket:</strong> ${t.ticket_key}</p>
                <p style="margin:0 0 8px;font-size:14px;color:#172B4D;"><strong>Resumen:</strong> ${t.summary}</p>
                <p style="margin:0 0 8px;font-size:14px;color:#172B4D;"><strong>Reporter:</strong> ${t.reporter||'—'}</p>
                <p style="margin:0 0 16px;font-size:14px;color:#172B4D;"><strong>Creado:</strong> ${new Date(t.created_at).toLocaleString('es-PE')}</p>
                <div style="background:#fee2e2;border-radius:8px;padding:12px 16px;font-size:13px;color:#991b1b;font-weight:600;">
                  ⚠️ Este incidente P1 requiere asignación inmediata.
                </div>
              </div>
            </div>`;
            await sendEmail(cfg.p1_escalation_email, `🚨 ESCALACIÓN P1: ${t.ticket_key} sin asignar (${age} min)`, html);
            await dbQuery(`UPDATE jira_tickets SET escalation_notified_at = NOW() WHERE ticket_key = ?`, [t.ticket_key]);
            console.log(`📧 Escalación P1 enviada para ${t.ticket_key}`);
        }
    } catch(e) { console.error('⚠️ P1 escalation check:', e.message); }
}, 5 * 60 * 1000);
};
