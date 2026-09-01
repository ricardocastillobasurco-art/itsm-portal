// ============================================================================
// routes/faq.js — Preguntas Frecuentes
// ============================================================================
const express = require('express');
const router  = express.Router();
const { equipmentPool, executeQuery } = require('../../config/database');
const { authenticateToken } = require('../../middleware/auth');
const { tenantWhere } = require('../../utils/tenantFilter');

// Helper: resuelve tenant_id desde auth token o query param ?tenant_id=
function resolveTenantId(req) {
    return req.user?.tenant_id || (req.query.tenant_id ? parseInt(req.query.tenant_id) : null);
}
function tenantSQL(req, alias = '') {
    const tid = resolveTenantId(req);
    if (!tid) return '';
    const col = alias ? `${alias}.tenant_id` : 'tenant_id';
    return ` AND ${col} = ${parseInt(tid)}`;
}

// Auto-migración tabla + datos iniciales
;(async () => {
    try {
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS faq_items (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                category    VARCHAR(100) NOT NULL,
                question    VARCHAR(500) NOT NULL,
                answer      TEXT         NOT NULL,
                order_num   INT          DEFAULT 0,
                views       INT          DEFAULT 0,
                active      TINYINT(1)   DEFAULT 1,
                visible     TINYINT(1)   DEFAULT 1,
                created_by  INT,
                created_at  DATETIME     DEFAULT NOW(),
                updated_at  DATETIME     DEFAULT NOW() ON UPDATE NOW()
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);
        await executeQuery(equipmentPool, `ALTER TABLE faq_items ADD COLUMN IF NOT EXISTS visible TINYINT(1) DEFAULT 1`).catch(()=>{});
        await executeQuery(equipmentPool, `
            CREATE TABLE IF NOT EXISTS faq_requests (
                id          INT AUTO_INCREMENT PRIMARY KEY,
                user_id     INT,
                user_name   VARCHAR(200),
                user_email  VARCHAR(200),
                question    VARCHAR(500) NOT NULL,
                description TEXT,
                status      VARCHAR(30)  DEFAULT 'pendiente',
                resolved_at DATETIME     NULL,
                created_at  DATETIME     DEFAULT NOW()
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `).catch(()=>{});

        const existing = await executeQuery(equipmentPool, `SELECT COUNT(*) AS n FROM faq_items`);
        if (existing[0].n === 0) {
            const seed = [
                // Incidencias
                ['Incidencias', '¿Qué es una incidencia y cuándo debo reportarla?',
                 'Una incidencia es cualquier interrupción no planificada o degradación de un servicio TI. Debes reportarla cuando:\n- Tu equipo no enciende o se reinicia solo\n- No puedes acceder a internet, correo o aplicaciones corporativas\n- Un sistema está lento o muestra errores inesperados\n\nRepórtala lo antes posible desde el portal → "Generar Incidencia".', 1],
                ['Incidencias', '¿Cómo genero una incidencia desde el portal?',
                 'Sigue estos pasos:\n1. Accede al portal e identifícate con tu correo corporativo\n2. Haz clic en "Generar Incidencia"\n3. Describe el problema con el mayor detalle posible\n4. Adjunta una captura de pantalla si puedes\n5. Selecciona la prioridad y envía\n\nRecibirás un correo de confirmación con el número de ticket.', 2],
                ['Incidencias', '¿Cuánto tiempo tarda en atenderse mi incidencia?',
                 'Los tiempos de respuesta según prioridad son:\n\n🔴 Crítica (P1): 1 hora de respuesta, 4 horas resolución\n🟠 Alta (P2): 2 horas de respuesta, 8 horas resolución\n🟡 Media (P3): 4 horas de respuesta, 24 horas resolución\n🟢 Baja (P4): 8 horas de respuesta, 72 horas resolución\n\nPuedes consultar el estado en cualquier momento desde "Consultar Ticket".', 3],
                ['Incidencias', '¿Qué hago si mi incidencia no se resuelve en el tiempo esperado?',
                 'Si supera el tiempo SLA:\n1. Consulta el estado del ticket en el portal\n2. Escribe un comentario en el ticket solicitando actualización\n3. Contacta al supervisor de TI directamente\n4. Usa el WhatsApp Bot para escalar el caso\n\nEl sistema alerta automáticamente al equipo cuando un ticket está próximo a vencer el SLA.', 4],

                // Requerimientos
                ['Requerimientos', '¿Qué es un requerimiento y en qué se diferencia de una incidencia?',
                 'Un requerimiento es una solicitud formal de algo nuevo o un cambio planificado. No implica una falla.\n\nEjemplos de requerimientos:\n✅ Solicitar una laptop nueva\n✅ Pedir acceso a un sistema\n✅ Instalar software\n✅ Configurar impresora\n\nUna incidencia es cuando algo que funcionaba deja de funcionar. Los requerimientos tienen tiempos de atención distintos.', 1],
                ['Requerimientos', '¿Cómo solicito un nuevo equipo o periférico?',
                 'Para solicitar hardware:\n1. Accede al portal → "Generar Requerimiento"\n2. Selecciona tipo: "Hardware (equipo, periférico, accesorio)"\n3. Describe el equipo que necesitas (modelo, cantidad, justificación)\n4. Indica tu número de teléfono de contacto\n5. Envía la solicitud\n\nEl equipo TI revisará la disponibilidad en inventario. Para equipos nuevos se puede requerir aprobación del área.', 2],
                ['Requerimientos', '¿Cómo solicito acceso a un sistema o aplicación?',
                 'Para solicitar acceso:\n1. Genera un requerimiento tipo "Accesos y Permisos"\n2. Especifica el sistema al que necesitas acceso (ej: SAP, Office 365, VPN)\n3. Indica el nivel de acceso requerido (lectura, escritura, admin)\n4. Adjunta la autorización de tu jefe directo si aplica\n\nLos accesos se gestionan en coordinación con el área de Seguridad TI.', 3],
                ['Requerimientos', '¿Cuánto tarda en atenderse un requerimiento?',
                 'Los tiempos varían según tipo y disponibilidad:\n\n📦 Equipos en stock: 24-48 horas\n🖥️ Equipos nuevos (compra): 5-15 días hábiles\n🔑 Accesos a sistemas: 4-8 horas (si ya tienes autorización)\n💿 Instalación de software: 2-4 horas\n\nPuedes ver el estado en "Consultar Ticket".', 4],

                // Equipos y Mantenimiento
                ['Equipos y Mantenimiento', '¿Cómo solicito mantenimiento para mi equipo?',
                 'Para solicitar mantenimiento preventivo o correctivo:\n1. Genera un requerimiento tipo "Hardware"\n2. En el resumen escribe: "Mantenimiento de equipo - [descripción del problema]"\n3. Indica el nombre del equipo, número de serie si lo tienes\n4. Describe los síntomas: lentitud, ruidos, calentamiento, etc.\n\nPara casos urgentes (equipo inoperable), genera una incidencia P2 o P1.', 1],
                ['Equipos y Mantenimiento', '¿Qué hago si mi laptop/PC no enciende?',
                 'Pasos antes de reportar:\n1. Verifica que el cable de poder esté conectado correctamente\n2. Intenta con otro tomacorriente o cargador si tienes\n3. Mantén presionado el botón de encendido 10 segundos\n4. Si tiene batería extraíble, retírala 30 segundos y vuelve a colocarla\n\nSi ningún paso funciona, genera una incidencia P2 indicando "Equipo no enciende" con el número de activo del equipo (etiqueta pegada al equipo).', 2],
                ['Equipos y Mantenimiento', '¿Con qué frecuencia se realiza mantenimiento preventivo?',
                 'El mantenimiento preventivo se realiza:\n\n🖥️ Equipos de escritorio: cada 6 meses\n💻 Laptops: cada 6 meses\n🖨️ Impresoras: trimestral\n\nEl equipo TI coordina directamente contigo para programar la fecha. También puedes solicitarlo anticipadamente si notas señales de lentitud o sobrecalentamiento.', 3],

                // Accesos y Correo
                ['Accesos y Correo', '¿Cómo recupero mi contraseña corporativa?',
                 'Opciones para recuperar tu contraseña:\n\n1. Portal de autoservicio (si está habilitado en tu organización)\n2. Contáctate con TI vía WhatsApp Bot\n3. Genera un requerimiento tipo "Accesos y Permisos" indicando "Reseteo de contraseña"\n\nPor seguridad, nunca compartas tu contraseña con nadie, incluyendo personal de TI. El equipo de TI nunca te pedirá tu contraseña.', 1],
                ['Accesos y Correo', '¿Cómo configuro mi correo corporativo en el celular?',
                 'Para configurar en Android o iOS:\n\n📱 Android (Gmail):\n1. Abre Gmail → Agregar cuenta → Exchange/Office 365\n2. Ingresa tu correo corporativo\n3. Server: outlook.office365.com\n4. Activa sincronización\n\n🍎 iOS (Mail):\n1. Configuración → Mail → Cuentas → Microsoft Exchange\n2. Ingresa correo y contraseña\n\nSi tienes problemas, genera un requerimiento tipo "Correo Corporativo".', 2],

                // General
                ['General', '¿Cuál es el horario de atención del Service Desk?',
                 'Horario de atención:\n\n📅 Lunes a Viernes: 8:00 AM – 6:00 PM\n📅 Sábados: 9:00 AM – 1:00 PM\n\nFuera del horario de atención, puedes:\n- Registrar tu ticket en el portal (se atenderá al siguiente día hábil)\n- Para incidencias críticas (P1), existe guardia 24/7\n- Usar el WhatsApp Bot para consultas básicas', 1],
                ['General', '¿Cómo consulto el estado de mis tickets?',
                 'Puedes ver el estado de tus tickets de dos formas:\n\n1. Portal web: Accede con tu correo → "Consultar Ticket"\n2. Correo electrónico: Recibirás notificaciones automáticas cuando el estado cambie\n\nEstados posibles:\n🔵 Abierto: recibido, pendiente de asignación\n🟣 Asignado: técnico asignado\n🟡 En progreso: siendo atendido\n✅ Resuelto: solución aplicada, pendiente tu confirmación\n🔒 Cerrado: ticket finalizado', 2],
                ['General', '¿Qué información debo incluir al reportar un problema?',
                 'Para una atención más rápida incluye:\n\n✅ Descripción clara del problema\n✅ Desde cuándo ocurre\n✅ Número de activo del equipo (etiqueta en el equipo)\n✅ Captura de pantalla del error (si aplica)\n✅ Qué pasos intentaste antes de reportar\n✅ Tu número de teléfono de contacto\n\nCuanta más información brindes, más rápido podemos ayudarte.', 3],
            ];
            for (const [category, question, answer, order_num] of seed) {
                await executeQuery(equipmentPool,
                    `INSERT INTO faq_items (category, question, answer, order_num) VALUES (?,?,?,?)`,
                    [category, question, answer, order_num]
                );
            }
            console.log('✅ FAQ items iniciales creados');
        }
    } catch(e) { console.error('⚠️ faq_items migration:', e.message); }
})();

// GET /api/faq — listar items
router.get('/', authenticateToken, async (req, res) => {
    try {
        const { category, q, admin } = req.query;
        const isAdmin = admin === '1';
        let sql = `SELECT id, category, question, answer, order_num, views, visible FROM faq_items WHERE active = 1${tenantSQL(req)}`;
        const params = [];
        if (!isAdmin) { sql += ` AND visible = 1`; }
        if (category) { sql += ` AND category = ?`; params.push(category); }
        if (q)        { sql += ` AND (question LIKE ? OR answer LIKE ?)`; params.push(`%${q}%`, `%${q}%`); }
        sql += ` ORDER BY category, order_num, id`;
        const rows = await executeQuery(equipmentPool, sql, params);
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// GET /api/faq/categories
router.get('/categories', authenticateToken, async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool,
            `SELECT category, COUNT(*) AS n FROM faq_items WHERE active = 1${tenantSQL(req)} GROUP BY category ORDER BY category`);
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/faq/:id/view — incrementar contador
router.post('/:id/view', async (req, res) => {
    try {
        await executeQuery(equipmentPool, `UPDATE faq_items SET views = views + 1 WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch(err) { res.json({ success: true }); }
});

// POST /api/faq — crear item (admin)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { category, question, answer, order_num = 0 } = req.body;
        if (!category || !question || !answer)
            return res.status(400).json({ success: false, error: 'category, question y answer requeridos' });
        const tid = resolveTenantId(req) || 1;
        const r = await executeQuery(equipmentPool,
            `INSERT INTO faq_items (tenant_id, category, question, answer, order_num, created_by) VALUES (?,?,?,?,?,?)`,
            [tid, category, question, answer, order_num, req.user.id]);
        res.status(201).json({ success: true, id: r.insertId });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// PUT /api/faq/:id — editar (admin)
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        const { category, question, answer, order_num, active, visible } = req.body;
        await executeQuery(equipmentPool,
            `UPDATE faq_items SET category=COALESCE(?,category), question=COALESCE(?,question),
             answer=COALESCE(?,answer), order_num=COALESCE(?,order_num),
             active=COALESCE(?,active), visible=COALESCE(?,visible)
             WHERE id = ?`,
            [category||null, question||null, answer||null, order_num??null, active??null, visible??null, req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// DELETE /api/faq/:id — desactivar (admin)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        await executeQuery(equipmentPool, `UPDATE faq_items SET active = 0 WHERE id = ?`, [req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// ── FAQ Requests ────────────────────────────────────────────────────────────
// GET /api/faq/requests — listar (admin)
router.get('/requests', authenticateToken, async (req, res) => {
    try {
        const rows = await executeQuery(equipmentPool,
            `SELECT * FROM faq_requests ORDER BY created_at DESC LIMIT 200`);
        res.json({ success: true, data: rows });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// POST /api/faq/requests — usuario envía pregunta sin respuesta
router.post('/requests', async (req, res) => {
    try {
        const { question, description, user_name, user_email } = req.body;
        if (!question?.trim()) return res.status(400).json({ success: false, error: 'La pregunta es requerida' });
        const r = await executeQuery(equipmentPool,
            `INSERT INTO faq_requests (user_id, user_name, user_email, question, description) VALUES (?,?,?,?,?)`,
            [req.user?.id||null, user_name||req.user?.full_name||'', user_email||req.user?.email||'', question.trim(), description||'']);
        res.json({ success: true, id: r.insertId });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

// PATCH /api/faq/requests/:id/status — actualizar estado (admin)
router.patch('/requests/:id/status', authenticateToken, async (req, res) => {
    try {
        const { status } = req.body;
        const resolved = status === 'resuelto' ? 'NOW()' : 'NULL';
        await executeQuery(equipmentPool,
            `UPDATE faq_requests SET status = ?, resolved_at = ${resolved} WHERE id = ?`,
            [status, req.params.id]);
        res.json({ success: true });
    } catch(err) { res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
