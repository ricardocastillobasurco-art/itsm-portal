'use strict';

const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');
const logger = require('../../utils/logger');

// Lazy para evitar dependencias circulares en boot
function _models() {
  return require('../../models');
}

/**
 * WorkflowEngine — motor multi-step de aprobaciones.
 *
 * Uso típico:
 *   const instance = await WorkflowEngine.start('service_request', sr.id, tenantId);
 *   // instance.id se guarda; la entidad queda en 'pendiente_aprobacion'
 *
 *   const result = await WorkflowEngine.decide(approvalFlowId, { decision, comments, approverId });
 *   // result.entityStatus = nuevo estado de la entidad ('aprobado' | 'rechazado' | null)
 */
const WorkflowEngine = {

  /**
   * Inicia un workflow para una entidad.
   * Si no existe template activo para tenant+entityType → retorna null (sin bloquear).
   */
  async start(entityType, entityId, tenantId) {
    const { WorkflowTemplate, WorkflowTemplateStep, WorkflowInstance, ApprovalFlow, User } = _models();

    const template = await WorkflowTemplate.findOne({
      where:   { tenantId, entityType, isActive: true },
      include: [{ model: WorkflowTemplateStep, as: 'steps', order: [['step_order', 'ASC']] }],
      order:   [['id', 'DESC']],
    });

    if (!template || !template.steps?.length) {
      logger.debug(`[WorkflowEngine] Sin template activo para ${entityType} tenant ${tenantId}`);
      return null;
    }

    const instance = await WorkflowInstance.create({
      id:         uuidv4(),
      templateId: template.id,
      entityType,
      entityId,
      tenantId,
      currentStep: 1,
      status:      'en_curso',
    });

    const step1 = template.steps.find(s => s.stepOrder === 1);
    await _createStepFlows(instance, step1, entityId, tenantId);

    logger.info(`[WorkflowEngine] Instancia ${instance.id} iniciada (${entityType} ${entityId})`);
    return instance;
  },

  /**
   * Registra la decisión de un aprobador.
   * Retorna { instance, entityStatus } donde entityStatus puede ser:
   *   'aprobado' | 'rechazado' (cuando se cierra el workflow)
   *   null (cuando hay más pasos pendientes)
   */
  async decide(approvalFlowId, { decision, comments, approverId }) {
    const { ApprovalFlow, WorkflowInstance, WorkflowTemplate, WorkflowTemplateStep, User } = _models();

    const flow = await ApprovalFlow.findByPk(approvalFlowId);
    if (!flow) throw new Error(`ApprovalFlow ${approvalFlowId} no encontrado`);
    if (flow.status !== 'pendiente') throw new Error('Este paso ya fue procesado');

    // Registrar decisión
    await flow.update({ status: decision, comments: comments || null, decidedAt: new Date() });

    if (!flow.workflowInstanceId) {
      // Flujo legacy (sin workflow engine) — solo retornar el estado
      return { instance: null, entityStatus: decision === 'aprobado' ? 'aprobado' : 'rechazado' };
    }

    const instance = await WorkflowInstance.findByPk(flow.workflowInstanceId, {
      include: [{ model: WorkflowTemplate, as: 'template',
                  include: [{ model: WorkflowTemplateStep, as: 'steps' }] }],
    });
    if (!instance || instance.status !== 'en_curso') {
      return { instance, entityStatus: null };
    }

    // Rechazado → cerrar todo
    if (decision === 'rechazado') {
      await instance.update({ status: 'rechazado', resolvedAt: new Date(), resolvedBy: approverId });
      // Cancelar flujos pendientes del mismo paso
      await ApprovalFlow.update(
        { status: 'rechazado', comments: 'Rechazado por otro aprobador', decidedAt: new Date() },
        { where: { workflowInstanceId: instance.id, status: 'pendiente' } }
      );
      return { instance, entityStatus: 'rechazado' };
    }

    // Aprobado — verificar si todos los flujos del paso actual están aprobados
    const pendingInStep = await ApprovalFlow.count({
      where: { workflowInstanceId: instance.id, stepOrder: instance.currentStep, status: 'pendiente' },
    });

    if (pendingInStep > 0) {
      // Todavía hay aprobadores pendientes en este paso
      return { instance, entityStatus: null };
    }

    // Paso completado — buscar siguiente
    const steps    = instance.template.steps.sort((a, b) => a.stepOrder - b.stepOrder);
    const nextStep = steps.find(s => s.stepOrder > instance.currentStep);

    if (!nextStep) {
      // Último paso → workflow aprobado
      await instance.update({ status: 'aprobado', currentStep: instance.currentStep, resolvedAt: new Date(), resolvedBy: approverId });
      return { instance, entityStatus: 'aprobado' };
    }

    // Avanzar al siguiente paso
    await instance.update({ currentStep: nextStep.stepOrder });
    await _createStepFlows(instance, nextStep, instance.entityId, instance.tenantId);
    logger.info(`[WorkflowEngine] Instancia ${instance.id} avanzó a paso ${nextStep.stepOrder}`);
    return { instance, entityStatus: null };
  },

  /**
   * Cancela un workflow en curso (ej: la entidad fue cancelada).
   */
  async cancel(instanceId, cancelledBy = null) {
    const { WorkflowInstance, ApprovalFlow } = _models();
    const instance = await WorkflowInstance.findByPk(instanceId);
    if (!instance || instance.status !== 'en_curso') return;

    await instance.update({ status: 'cancelado', resolvedAt: new Date(), resolvedBy: cancelledBy });
    await ApprovalFlow.update(
      { status: 'rechazado', comments: 'Workflow cancelado', decidedAt: new Date() },
      { where: { workflowInstanceId: instanceId, status: 'pendiente' } }
    );
    logger.info(`[WorkflowEngine] Instancia ${instanceId} cancelada`);
  },

  /**
   * Devuelve la instancia activa de una entidad (o null).
   */
  async getActive(entityType, entityId) {
    const { WorkflowInstance, ApprovalFlow } = _models();
    return WorkflowInstance.findOne({
      where:   { entityType, entityId, status: 'en_curso' },
      include: [{ model: ApprovalFlow, as: 'flows', where: { status: 'pendiente' }, required: false }],
    });
  },
};

// ── Privado ───────────────────────────────────────────────────────────────────

async function _createStepFlows(instance, stepDef, entityId, tenantId) {
  const { ApprovalFlow, User } = _models();
  const approverId = await _resolveApproverId(stepDef, tenantId);

  if (!approverId) {
    logger.warn(`[WorkflowEngine] No se encontró aprobador para paso ${stepDef.id} (step ${stepDef.stepOrder})`);
    return;
  }

  await ApprovalFlow.create({
    id:                 uuidv4(),
    workflowInstanceId: instance.id,
    stepId:             stepDef.id,
    serviceRequestId:   entityId,
    approverId,
    stepOrder:          stepDef.stepOrder,
    status:             'pendiente',
  });
}

async function _resolveApproverId(stepDef, tenantId) {
  const { User } = _models();

  // Aprobador explícito
  if (stepDef.approverUserId) return stepDef.approverUserId;

  // Por rol — tomar el primer usuario activo del tenant con ese rol
  if (stepDef.approverRole) {
    const user = await User.findOne({
      where: { tenantId, role: stepDef.approverRole, isActive: true },
      order: [['createdAt', 'ASC']],
    });
    return user?.id ?? null;
  }

  return null;
}

module.exports = WorkflowEngine;
