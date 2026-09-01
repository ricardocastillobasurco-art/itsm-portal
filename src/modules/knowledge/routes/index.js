'use strict';

const express    = require('express');
const router     = express.Router();
const { authenticateToken, optionalAuth, requireRole } = require('../../../../middleware/auth');
const { requirePolicy }                   = require('../../../middlewares/authorization');
const ctrl       = require('../controller/KnowledgeController');
const sequelize  = require('../../../config/database');

const auth = authenticateToken;
const can  = requirePolicy;

// ── eLearning table bootstrap ─────────────────────────────────────────────────
sequelize.query(`
  CREATE TABLE IF NOT EXISTS kb_learning_resources (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    title        VARCHAR(400) NOT NULL,
    category     VARCHAR(100) DEFAULT 'general',
    author       VARCHAR(200),
    duration     VARCHAR(100),
    description  TEXT,
    content_type VARCHAR(20) DEFAULT 'url',
    content_data MEDIUMTEXT,
    file_name    VARCHAR(400),
    views        INT DEFAULT 0,
    status       VARCHAR(20) DEFAULT 'publicado',
    created_by   INT,
    created_at   DATETIME DEFAULT NOW(),
    deleted_at   DATETIME NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).catch(e => console.error('[kb_learning] table init:', e.message));

// Agregar columnas si la tabla ya existía sin ellas
sequelize.query(`ALTER TABLE kb_learning_resources ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'publicado'`).catch(() => {});
sequelize.query(`ALTER TABLE kb_learning_resources ADD COLUMN IF NOT EXISTS admin_response TEXT NULL`).catch(() => {});
// Ampliar ENUM de kb_articles para soportar revision y oculto
sequelize.query(`ALTER TABLE kb_articles MODIFY COLUMN status ENUM('borrador','publicado','archivado','revision','oculto') DEFAULT 'borrador'`).catch(() => {});

// ── eLearning endpoints ───────────────────────────────────────────────────────
router.get('/learning', optionalAuth, async (req, res, next) => {
  try {
    const { category, status, mine } = req.query;
    const isAdmin = ['administrador', 'especialista', 'agente', 'tecnico'].includes(req.user?.role);
    let sql = 'SELECT id,title,category,author,duration,description,content_type,file_name,views,status,admin_response,created_by,created_at FROM kb_learning_resources WHERE deleted_at IS NULL';
    const replacements = [];
    if (mine === '1' && req.user?.id) {
      // Solo los propios del usuario autenticado (cualquier status)
      sql += ' AND created_by = ?'; replacements.push(req.user.id);
    } else if (isAdmin && !status) {
      // Admin sin filtro: ve todo
    } else if (status) {
      sql += ' AND status = ?'; replacements.push(status);
    } else {
      // Usuario normal: solo publicados
      sql += " AND status = 'publicado'";
    }
    if (category) { sql += ' AND category = ?'; replacements.push(category); }
    sql += ' ORDER BY created_at DESC';
    const [rows] = await sequelize.query(sql, { replacements });
    res.json({ success: true, data: rows, userId: req.user?.id || null });
  } catch (e) { next(e); }
});

router.get('/learning/:id/content', optionalAuth, async (req, res, next) => {
  try {
    const [[row]] = await sequelize.query(
      'SELECT content_type, content_data, status, admin_response, created_by FROM kb_learning_resources WHERE id = ? AND deleted_at IS NULL',
      { replacements: [req.params.id] }
    );
    if (!row) return res.status(404).json({ success: false, error: 'Recurso no encontrado' });
    const isAdmin = ['administrador', 'especialista', 'agente', 'tecnico'].includes(req.user?.role);
    const isOwner = req.user?.id && row.created_by === req.user.id;
    // Bloquear acceso al contenido si no está publicado (excepto admin)
    if (row.status !== 'publicado' && !isAdmin) {
      return res.json({ success: false, status: row.status, admin_response: row.admin_response || null, blocked: true });
    }
    res.json({ success: true, data: row.content_data });
  } catch (e) { next(e); }
});

// Guardar respuesta del admin a un aporte
router.patch('/learning/:id/response', auth, async (req, res, next) => {
  try {
    const { response } = req.body;
    if (!response?.trim()) return res.status(400).json({ success: false, error: 'La respuesta no puede estar vacía' });
    await sequelize.query('UPDATE kb_learning_resources SET admin_response = ? WHERE id = ?', { replacements: [response.trim(), req.params.id] });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.post('/learning', optionalAuth, async (req, res, next) => {
  try {
    const { title, category = 'general', author, duration, description, content_type = 'url', content_data, file_name } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, error: 'El título es requerido' });
    if (!content_data?.trim()) return res.status(400).json({ success: false, error: 'El contenido es requerido' });
    // Siempre pendiente — el admin aprueba desde /gestion-documental → Aportes
    const [result] = await sequelize.query(
      'INSERT INTO kb_learning_resources (title,category,author,duration,description,content_type,content_data,file_name,created_by,status) VALUES (?,?,?,?,?,?,?,?,?,?)',
      { replacements: [title.trim(), category, author||null, duration||null, description||null, content_type, content_data.trim(), file_name||null, req.user?.id||null, 'pendiente'] }
    );
    res.json({ success: true, data: { id: result }, pendiente: true });
  } catch (e) { next(e); }
});

router.patch('/learning/:id/status', auth, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['publicado','pendiente','rechazado'].includes(status))
      return res.status(400).json({ success: false, error: 'Estado inválido' });
    await sequelize.query('UPDATE kb_learning_resources SET status = ? WHERE id = ?', { replacements: [status, req.params.id] });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.post('/learning/:id/view', optionalAuth, async (req, res, next) => {
  try {
    await sequelize.query('UPDATE kb_learning_resources SET views = views + 1 WHERE id = ?', { replacements: [req.params.id] });
    res.json({ success: true });
  } catch (e) { next(e); }
});

router.delete('/learning/:id', optionalAuth, async (req, res, next) => {
  try {
    await sequelize.query('UPDATE kb_learning_resources SET deleted_at = NOW() WHERE id = ?', { replacements: [req.params.id] });
    res.json({ success: true });
  } catch (e) { next(e); }
});

// ── Rutas específicas antes del /:id genérico ─────────────────────────────────
// Lectura pública (optionalAuth): cualquier empleado del portal puede leer
router.get('/categories',                             optionalAuth,                      ctrl.categories);
router.get('/search',                                 optionalAuth,                      ctrl.search);
router.get('/popular',                                optionalAuth,                      ctrl.popular);
router.get('/suggest',                                optionalAuth,                      ctrl.suggest);
router.get('/no-results',                             auth, can('knowledge', 'read'),    ctrl.noResults);
router.get('/procedures',                             optionalAuth,                      ctrl.getProcedures);
router.get('/procedures/:id',                         optionalAuth,                      ctrl.getProcedureById);
router.post('/procedures/draft',                      auth, async (req, res, next) => {
  try {
    const { title, description, procedure_category, content_type, content_data, file_name } = req.body;
    if (!title?.trim()) return res.status(400).json({ success: false, error: 'Título requerido' });
    const created_by = req.user?.full_name || req.user?.username || req.user?.email || '';
    await sequelize.query(
      `INSERT INTO kb_procedures (title, description, procedure_category, content_type, content_data, file_name, created_by, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0)`,
      { replacements: [title.trim(), description||'', procedure_category||'general', content_type||'text', content_data||'', file_name||'', created_by] }
    );
    res.json({ success: true });
  } catch (e) { next(e); }
});
router.post('/procedures',                            auth, can('knowledge', 'create'),  ctrl.createProcedure);
router.delete('/procedures/:id',                      auth, can('knowledge', 'delete'),  ctrl.deactivateProcedure);
router.get('/procedure-requests',                     auth, can('knowledge', 'read'),    ctrl.getProcedureRequests);
router.post('/procedure-requests',                    optionalAuth,                      ctrl.createProcedureRequest);
router.patch('/procedure-requests/:id/status',        auth, can('knowledge', 'update'),  ctrl.updateProcedureRequestStatus);

// ── CRUD artículos ────────────────────────────────────────────────────────────
router.get('/',              optionalAuth,                      ctrl.list);
router.get('/:id',           optionalAuth,                      ctrl.getOne);
// Admin-direct: bypasses casbin (role already verified by requireRole)
router.post('/admin-create', auth, requireRole('administrador', 'especialista', 'agente'), ctrl.create);
router.post('/',             auth, can('knowledge', 'create'),  ctrl.create);
router.patch('/:id',         auth, can('knowledge', 'update'),  ctrl.update);
router.delete('/:id',        auth, can('knowledge', 'delete'),  ctrl.remove);
router.post('/:id/helpful',  optionalAuth,                      ctrl.vote);
router.post('/:id/link-ticket', auth, can('knowledge', 'update'), ctrl.linkTicket);

module.exports = router;
