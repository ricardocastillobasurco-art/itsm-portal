'use strict';

const { Router } = require('express');
const { authenticateToken } = require('../../../../middleware/auth');
const WorkflowEngine = require('../../../core/workflow/WorkflowEngine');
const { WorkflowTemplate, WorkflowTemplateStep, WorkflowInstance, ApprovalFlow } = require('../../../models');

const router = Router();
router.use(authenticateToken);

// ── Templates ─────────────────────────────────────────────────────────────────

// GET /api/workflow/templates
router.get('/templates', async (req, res, next) => {
  try {
    const tenantId = req.tenant.id;
    const rows = await WorkflowTemplate.findAll({
      where:   { tenantId },
      include: [{ model: WorkflowTemplateStep, as: 'steps', order: [['step_order', 'ASC']] }],
      order:   [['id', 'ASC']],
    });
    res.ok(rows);
  } catch (e) { next(e); }
});

// POST /api/workflow/templates
router.post('/templates', async (req, res, next) => {
  try {
    const { entityType, name, description, steps = [] } = req.body;
    if (!entityType || !name) return res.fail('entityType y name son requeridos', 422);

    const template = await WorkflowTemplate.create({
      tenantId: req.tenant.id,
      entityType, name, description: description || null,
    });

    if (steps.length) {
      await WorkflowTemplateStep.bulkCreate(
        steps.map((s, i) => ({
          templateId:       template.id,
          stepOrder:        s.stepOrder    || i + 1,
          stepName:         s.stepName     || `Paso ${i + 1}`,
          approverRole:     s.approverRole || null,
          approverUserId:   s.approverUserId || null,
          autoApproveHours: s.autoApproveHours || null,
        }))
      );
    }

    const full = await WorkflowTemplate.findByPk(template.id, {
      include: [{ model: WorkflowTemplateStep, as: 'steps' }],
    });
    res.ok(full, 'Template creado', 201);
  } catch (e) { next(e); }
});

// PATCH /api/workflow/templates/:id
router.patch('/templates/:id', async (req, res, next) => {
  try {
    const tmpl = await WorkflowTemplate.findOne({
      where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!tmpl) return res.fail('Template no encontrado', 404);

    const allowed = ['name', 'description', 'isActive'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    await tmpl.update(updates);
    res.ok(tmpl);
  } catch (e) { next(e); }
});

// DELETE /api/workflow/templates/:id  (soft-desactiva)
router.delete('/templates/:id', async (req, res, next) => {
  try {
    const tmpl = await WorkflowTemplate.findOne({
      where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!tmpl) return res.fail('Template no encontrado', 404);
    await tmpl.update({ isActive: false });
    res.ok(null, 'Template desactivado');
  } catch (e) { next(e); }
});

// POST /api/workflow/templates/:id/steps
router.post('/templates/:id/steps', async (req, res, next) => {
  try {
    const tmpl = await WorkflowTemplate.findOne({
      where: { id: req.params.id, tenantId: req.tenant.id },
    });
    if (!tmpl) return res.fail('Template no encontrado', 404);

    const { stepOrder, stepName, approverRole, approverUserId, autoApproveHours } = req.body;
    const step = await WorkflowTemplateStep.create({
      templateId: tmpl.id, stepOrder, stepName,
      approverRole: approverRole || null,
      approverUserId: approverUserId || null,
      autoApproveHours: autoApproveHours || null,
    });
    res.ok(step, 'Paso añadido', 201);
  } catch (e) { next(e); }
});

// DELETE /api/workflow/templates/:id/steps/:stepId
router.delete('/templates/:id/steps/:stepId', async (req, res, next) => {
  try {
    const step = await WorkflowTemplateStep.findOne({
      where: { id: req.params.stepId, templateId: req.params.id },
    });
    if (!step) return res.fail('Paso no encontrado', 404);
    await step.destroy();
    res.ok(null, 'Paso eliminado');
  } catch (e) { next(e); }
});

// ── Instances ─────────────────────────────────────────────────────────────────

// GET /api/workflow/instances?entity_type=&entity_id=
router.get('/instances', async (req, res, next) => {
  try {
    const where = { tenantId: req.tenant.id };
    if (req.query.entity_type) where.entityType = req.query.entity_type;
    if (req.query.entity_id)   where.entityId   = req.query.entity_id;
    if (req.query.status)      where.status      = req.query.status;

    const rows = await WorkflowInstance.findAll({
      where,
      include: [{ model: ApprovalFlow, as: 'flows' }],
      order:   [['createdAt', 'DESC']],
      limit:   50,
    });
    res.ok(rows);
  } catch (e) { next(e); }
});

// POST /api/workflow/instances/:instanceId/cancel
router.post('/instances/:instanceId/cancel', async (req, res, next) => {
  try {
    await WorkflowEngine.cancel(req.params.instanceId, req.user?.id);
    res.ok(null, 'Workflow cancelado');
  } catch (e) { next(e); }
});

// ── Approve / Reject ──────────────────────────────────────────────────────────

// POST /api/workflow/approve/:approvalFlowId
router.post('/approve/:approvalFlowId', async (req, res, next) => {
  try {
    const { decision, comments } = req.body;
    if (!['aprobado', 'rechazado'].includes(decision)) {
      return res.fail('decision debe ser aprobado o rechazado', 422);
    }

    const { instance, entityStatus } = await WorkflowEngine.decide(req.params.approvalFlowId, {
      decision, comments, approverId: req.user?.id,
    });

    res.ok({ instance, entityStatus }, entityStatus
      ? `Workflow ${entityStatus}`
      : 'Paso aprobado, esperando siguiente aprobador'
    );
  } catch (e) { next(e); }
});

// GET /api/workflow/my-pending  — flujos pendientes del usuario autenticado
router.get('/my-pending', async (req, res, next) => {
  try {
    const flows = await ApprovalFlow.findAll({
      where:  { approverId: req.user?.id, status: 'pendiente' },
      order:  [['createdAt', 'ASC']],
      limit:  100,
    });
    res.ok(flows);
  } catch (e) { next(e); }
});

module.exports = router;
