'use strict';

const ChangeRepository = require('../repository/ChangeRepository');
const WorkflowEngine   = require('../../../core/workflow/WorkflowEngine');
const { NotFoundError, ValidationError } = require('../../../utils/errors');
const { ChangePolicy } = require('../../../core/policies');

const ALLOWED = ['title','description','type','status','priority','riskLevel',
                 'assignedTo','plannedStart','plannedEnd','actualStart','actualEnd',
                 'rollbackPlan','testPlan','implementationNotes','postImplReview',
                 'cabApprovedAt','cabApprovedBy'];

class ChangeService {
  constructor(tenantId) {
    this.repo     = new ChangeRepository(tenantId);
    this.tenantId = tenantId;
  }

  async list(filters) {
    const { count, rows } = await this.repo.findPaginated(filters);
    return { rows, count };
  }

  async getKPIs() { return this.repo.getKPIs(); }

  async getById(id, pCtx = null) {
    const ch = await this.repo.findById(id);
    if (!ch) throw new NotFoundError('Cambio no encontrado');
    if (pCtx) ChangePolicy.assertRead(pCtx, ch);
    return ch;
  }

  async create(data, pCtx = null) {
    const { title, description, type, priority, riskLevel, plannedStart, plannedEnd, rollbackPlan, testPlan, requestedBy } = data;
    if (pCtx) ChangePolicy.assertCreate(pCtx);
    if (!title) throw new ValidationError('Título requerido');
    return this.repo.create({
      title, description, type: type || 'normal',
      priority: priority || 'media', riskLevel: riskLevel || 'medio',
      requestedBy,
      plannedStart: plannedStart || null, plannedEnd: plannedEnd || null,
      rollbackPlan: rollbackPlan || null, testPlan: testPlan || null,
    });
  }

  async update(id, body, pCtx = null) {
    const ch = await this.repo.findById(id);
    if (!ch) throw new NotFoundError('Cambio no encontrado');
    if (pCtx) ChangePolicy.assertUpdate(pCtx, ch);
    const updates = {};
    for (const key of ALLOWED) { if (body[key] !== undefined) updates[key] = body[key]; }
    const updated = await this.repo.update(id, updates);
    return updated;
  }

  async submitForApproval(id, pCtx = null) {
    const ch = await this.repo.findById(id);
    if (!ch) throw new NotFoundError('Cambio no encontrado');
    if (pCtx) ChangePolicy.assertSubmitForApproval(pCtx, ch);
    if (ch.status !== 'borrador') throw new ValidationError('Solo cambios en borrador pueden enviarse a aprobación');

    await this.repo.update(id, { status: 'pendiente_aprobacion' });

    const instance = await WorkflowEngine.start('change', ch.id, this.tenantId);
    if (!instance) {
      // Sin template → aprobación automática
      await this.repo.update(id, { status: 'aprobado' });
    }

    return this.repo.findById(id);
  }

  /**
   * Procesa la decisión de un aprobador sobre un cambio.
   */
  async approve(id, { approvalFlowId, decision, comments, approverId }, pCtx = null) {
    const ch = await this.repo.findById(id);
    if (!ch) throw new NotFoundError('Cambio no encontrado');
    if (pCtx) ChangePolicy.assertApprove(pCtx, ch);

    const { entityStatus } = await WorkflowEngine.decide(approvalFlowId, { decision, comments, approverId });

    if (entityStatus) {
      await this.repo.update(id, { status: entityStatus });
    }

    return this.repo.findById(id);
  }

  async remove(id, pCtx = null) {
    const ch = await this.repo.findById(id);
    if (!ch) throw new NotFoundError('Cambio no encontrado');
    if (pCtx) ChangePolicy.assertDelete(pCtx, ch);
    const ok = await this.repo.remove(id);
    if (!ok) throw new NotFoundError('Cambio no encontrado');
  }
}

module.exports = ChangeService;
