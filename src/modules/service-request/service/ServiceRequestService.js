'use strict';

const nodemailer = require('nodemailer');
const ServiceRequestRepository = require('../repository/ServiceRequestRepository');
const { ValidationError, NotFoundError, ForbiddenError } = require('../../../utils/errors');
const WorkflowEngine = require('../../../core/workflow/WorkflowEngine');

const STAFF_ROLES  = ['administrador', 'especialista', 'agente', 'tecnico'];
const VIEWER_ROLES = [...STAFF_ROLES, 'visor'];

class ServiceRequestService {
  constructor(tenantId) {
    this.repo = new ServiceRequestRepository(tenantId);
  }

  async findAll({ status, priority, page = 1, limit = 20, mine, userId, role } = {}) {
    const where = {};
    if (status)   where.status   = status;
    if (priority) where.priority = priority;
    if (!VIEWER_ROLES.includes(role) || mine === '1') where.requesterId = userId;

    const { count, rows } = await this.repo.findPaginated({ where, page, limit });
    return { rows, count, page: parseInt(page) };
  }

  async findById(id) {
    const sr = await this.repo.findByIdWithDetails(id);
    if (!sr) throw new NotFoundError('Solicitud no encontrada');
    return sr;
  }

  async getCatalog() {
    return this.repo.getCatalog();
  }

  async create({ title, description, serviceId, priority, dueDate, requesterEmail, softwareItems, extraData, requesterId, userEmail }) {
    if (!title) throw new ValidationError('Título requerido');

    let approvalRequired = false;
    if (serviceId) {
      const svc = await this.repo.findServiceById(serviceId);
      if (svc) approvalRequired = svc.approvalRequired;
    }

    let fullDesc = description || '';
    if (softwareItems?.length) fullDesc += `\n\n📦 Software solicitado:\n${softwareItems.map(s => `• ${s}`).join('\n')}`;
    if (extraData)              fullDesc += `\n\n📋 Detalles adicionales:\n${extraData}`;

    const sr = await this.repo.create({
      requesterId,
      serviceId:      serviceId || null,
      title,
      description:    fullDesc,
      priority:       priority || 'media',
      dueDate:        dueDate || null,
      status:         approvalRequired ? 'pendiente_aprobacion' : 'aprobado',
      requesterEmail: requesterEmail || userEmail || null,
    });

    // Intentar iniciar workflow multi-step si hay template activo
    if (approvalRequired) {
      const instance = await WorkflowEngine.start('service_request', sr.id, this.repo.tenantId);
      if (!instance) {
        // Sin template configurado → aprobación directa legacy
        await this.repo.update(sr, { status: 'aprobado' });
      }
    }

    return sr;
  }

  async update(id, updates) {
    const sr = await this.repo.findByIdSimple(id);
    if (!sr) throw new NotFoundError('Solicitud no encontrada');

    const allowed = ['title', 'description', 'status', 'priority', 'dueDate', 'rejectedReason'];
    const patch = {};
    for (const key of allowed) { if (updates[key] !== undefined) patch[key] = updates[key]; }
    if (patch.status === 'completado') patch.completedAt = new Date();

    return this.repo.update(sr, patch);
  }

  async approve(id, { decision, comments, approverId, approvalFlowId }) {
    const sr = await this.repo.findByIdSimple(id);
    if (!sr) throw new NotFoundError('Solicitud no encontrada');

    // Si viene approvalFlowId → workflow engine multi-step
    if (approvalFlowId) {
      const { entityStatus } = await WorkflowEngine.decide(approvalFlowId, { decision, comments, approverId });
      if (entityStatus) {
        await this.repo.update(sr, {
          status:         entityStatus,
          rejectedReason: entityStatus === 'rechazado' ? comments : null,
        });
      }
      return this.repo.findByIdSimple(id);
    }

    // Legacy: aprobación directa sin workflow
    await this.repo.createApproval({ serviceRequestId: sr.id, approverId, status: decision, comments });
    return this.repo.update(sr, {
      status:         decision === 'aprobado' ? 'aprobado' : 'rechazado',
      rejectedReason: decision === 'rechazado' ? comments : null,
    });
  }

  async notify(id, { mensaje, asunto }, agent) {
    if (!STAFF_ROLES.includes(agent.role)) throw new ForbiddenError('Sin permiso');

    const sr = await this.repo.findByIdForNotify(id);
    if (!sr)                throw new NotFoundError('Solicitud no encontrada');
    if (!sr.requesterEmail) throw new ValidationError('La solicitud no tiene correo de solicitante registrado');

    const subject = asunto || `Actualización de tu solicitud — ${sr.title}`;
    await _sendMail(sr.requesterEmail, subject, _buildEmail({ sr, subject, mensaje, agentName: agent.full_name || agent.email }));
    return sr.requesterEmail;
  }

  async findSoftware(term) { return this.repo.findSoftware(term); }

  async createSoftware({ nombre, version, proveedor, categoria, detalles }) {
    if (!nombre) throw new ValidationError('Nombre requerido');
    const r = await this.repo.createSoftware({ nombre, version, proveedor, categoria, detalles });
    return r.insertId;
  }

  async deactivateSoftware(id) { return this.repo.deactivateSoftware(id); }
}

// ── Helpers de email (privados) ───────────────────────────────────────────────

async function _sendMail(to, subject, html) {
  const transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  await transporter.sendMail({ from: `"Service Desk TI" <${process.env.SMTP_USER}>`, to, subject, html });
}

function _buildEmail({ sr, subject, mensaje, agentName }) {
  return `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 16px;">
<tr><td align="center">
<table width="600" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08);">
  <tr><td style="background:linear-gradient(135deg,#0052CC,#0065FF);padding:24px 32px;">
    <div style="font-size:20px;font-weight:700;color:#fff;">📋 Solicitud de Servicio TI</div>
    <div style="color:rgba(255,255,255,.8);font-size:13px;margin-top:4px;">${subject}</div>
  </td></tr>
  <tr><td style="padding:28px 32px;">
    <div style="font-size:14px;color:#374151;line-height:1.7;white-space:pre-line;">${mensaje}</div>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
    <div style="background:#f9fafb;border-radius:8px;padding:16px;">
      <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#6b7280;margin-bottom:10px;">Detalle de la solicitud</div>
      <table width="100%" style="font-size:13px;color:#374151;">
        <tr><td style="padding:4px 0;width:120px;color:#6b7280;">Solicitud:</td><td><strong>${sr.title}</strong></td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Estado:</td><td>${sr.status}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Prioridad:</td><td>${sr.priority}</td></tr>
      </table>
    </div>
    <div style="margin-top:20px;font-size:12px;color:#9ca3af;">Atendido por: ${agentName}</div>
  </td></tr>
  <tr><td style="background:#f9fafb;padding:16px 32px;text-align:center;">
    <div style="font-size:11px;color:#9ca3af;">© Service Desk TI — Responde a este correo si necesitas más ayuda</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

module.exports = ServiceRequestService;
