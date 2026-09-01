// ============================================================================
// src/models/index.js — Carga automática de modelos y asociaciones
// ============================================================================

const sequelize = require('../config/database');

// Platform
const Tenant              = require('./platform/Tenant');
const TenantFeature       = require('./platform/TenantFeature');
const TenantCustomField   = require('./platform/TenantCustomField');
const TenantViewOverride  = require('./platform/TenantViewOverride');
const WorkflowTemplate     = require('./platform/WorkflowTemplate');
const WorkflowTemplateStep = require('./platform/WorkflowTemplateStep');
const WorkflowInstance     = require('./platform/WorkflowInstance');
const Role             = require('./platform/Role');
const Permission       = require('./platform/Permission');
const User             = require('./platform/User');
const AuditLog         = require('./platform/AuditLog');
const BusinessRule     = require('./platform/BusinessRule');

// Service Management
const Category         = require('./service-management/Category');
const SLAPolicy        = require('./service-management/SLAPolicy');
const Ticket           = require('./service-management/Ticket');
const TicketComment    = require('./service-management/TicketComment');
const TicketAttachment = require('./service-management/TicketAttachment');
const TicketSurvey     = require('./service-management/TicketSurvey');
const Change           = require('./service-management/Change');
const Problem          = require('./service-management/Problem');
const KnownError       = require('./service-management/KnownError');

// Service Operations
const ServiceRequest   = require('./service-operations/ServiceRequest');
const ApprovalFlow     = require('./service-operations/ApprovalFlow');
const ServiceCategory  = require('./service-operations/ServiceCategory');
const Service          = require('./service-operations/Service');

// Experience
const Notification     = require('./experience/Notification');
const KbCategory       = require('./experience/KbCategory');
const KbArticle        = require('./experience/KbArticle');

// Analytics
const CsiInitiative    = require('./analytics/CsiInitiative');
const ReportJob        = require('./analytics/ReportJob');

// Asset Management (CMDB)
const CiType           = require('./asset-management/CiType');
const ConfigItem       = require('./asset-management/ConfigItem');
const CiRelationship   = require('./asset-management/CiRelationship');

// ============================================================================
// ASOCIACIONES
// ============================================================================

// Workflow
WorkflowTemplate.hasMany(WorkflowTemplateStep, { foreignKey: 'template_id', as: 'steps' });
WorkflowTemplateStep.belongsTo(WorkflowTemplate, { foreignKey: 'template_id', as: 'template' });

WorkflowTemplate.hasMany(WorkflowInstance, { foreignKey: 'template_id', as: 'instances' });
WorkflowInstance.belongsTo(WorkflowTemplate, { foreignKey: 'template_id', as: 'template' });

WorkflowInstance.hasMany(ApprovalFlow, { foreignKey: 'workflow_instance_id', as: 'flows' });
ApprovalFlow.belongsTo(WorkflowInstance, { foreignKey: 'workflow_instance_id', as: 'workflowInstance' });

Tenant.hasMany(WorkflowTemplate, { foreignKey: 'tenant_id', as: 'workflowTemplates' });
WorkflowTemplate.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });

// Tenant ↔ TenantFeature / TenantCustomField / TenantViewOverride (1:N / 1:1)
Tenant.hasMany(TenantFeature,      { foreignKey: 'tenant_id', as: 'features' });
TenantFeature.belongsTo(Tenant,    { foreignKey: 'tenant_id', as: 'tenant' });

Tenant.hasMany(TenantCustomField,  { foreignKey: 'tenant_id', as: 'customFields' });
TenantCustomField.belongsTo(Tenant,{ foreignKey: 'tenant_id', as: 'tenant' });

Tenant.hasOne(TenantViewOverride,  { foreignKey: 'tenant_id', as: 'viewOverride' });
TenantViewOverride.belongsTo(Tenant,{ foreignKey: 'tenant_id', as: 'tenant' });

// Tenant ↔ User (1:N)
Tenant.hasMany(User,           { foreignKey: 'tenant_id', as: 'usuarios' });
User.belongsTo(Tenant,         { foreignKey: 'tenant_id', as: 'tenant' });

// Tenant ↔ ITSM entities (1:N)
Tenant.hasMany(Ticket,         { foreignKey: 'tenant_id', as: 'tickets' });
Ticket.belongsTo(Tenant,       { foreignKey: 'tenant_id', as: 'tenant' });

Tenant.hasMany(ServiceRequest, { foreignKey: 'tenant_id', as: 'solicitudes' });
ServiceRequest.belongsTo(Tenant, { foreignKey: 'tenant_id', as: 'tenant' });

Tenant.hasMany(Change,         { foreignKey: 'tenant_id', as: 'cambios' });
Change.belongsTo(Tenant,       { foreignKey: 'tenant_id', as: 'tenant' });

Tenant.hasMany(Problem,        { foreignKey: 'tenant_id', as: 'problemas' });
Problem.belongsTo(Tenant,      { foreignKey: 'tenant_id', as: 'tenant' });

// Role ↔ Permission (1:N)
Role.hasMany(Permission, { foreignKey: 'roleId', as: 'permisos' });
Permission.belongsTo(Role, { foreignKey: 'roleId', as: 'rol' });

// User ↔ AuditLog (1:N)
User.hasMany(AuditLog, { foreignKey: 'userId', as: 'logs' });
AuditLog.belongsTo(User, { foreignKey: 'userId', as: 'usuario' });

// Ticket ↔ Category (N:1)
Ticket.belongsTo(Category, { foreignKey: 'categoryId', as: 'categoria' });
Category.hasMany(Ticket,   { foreignKey: 'categoryId', as: 'tickets' });

// Ticket ↔ TicketComment (1:N)
Ticket.hasMany(TicketComment,       { foreignKey: 'ticketId', as: 'comentarios' });
TicketComment.belongsTo(Ticket,     { foreignKey: 'ticketId', as: 'ticket' });

// Ticket ↔ TicketAttachment (1:N)
Ticket.hasMany(TicketAttachment,    { foreignKey: 'ticketId', as: 'adjuntos' });
TicketAttachment.belongsTo(Ticket,  { foreignKey: 'ticketId', as: 'ticket' });

// Ticket ↔ TicketSurvey (1:1)
Ticket.hasOne(TicketSurvey, { foreignKey: 'ticketId', as: 'encuesta' });
TicketSurvey.belongsTo(Ticket, { foreignKey: 'ticketId', as: 'ticket' });

// ServiceRequest ↔ ApprovalFlow (1:N)
ServiceRequest.hasMany(ApprovalFlow,   { foreignKey: 'serviceRequestId', as: 'approvals' });
ApprovalFlow.belongsTo(ServiceRequest, { foreignKey: 'serviceRequestId', as: 'solicitud' });

// ServiceRequest ↔ Service (N:1)
ServiceRequest.belongsTo(Service, { foreignKey: 'serviceId', as: 'service' });
Service.hasMany(ServiceRequest,   { foreignKey: 'serviceId', as: 'solicitudes' });

// ServiceCategory ↔ Service (1:N)
ServiceCategory.hasMany(Service,   { foreignKey: 'categoryId', as: 'servicios' });
Service.belongsTo(ServiceCategory, { foreignKey: 'categoryId', as: 'categoria' });

// Problem ↔ KnownError (1:N)
Problem.hasMany(KnownError,   { foreignKey: 'problemId', as: 'erroresConocidos' });
KnownError.belongsTo(Problem, { foreignKey: 'problemId', as: 'problema' });

// KbCategory ↔ KbArticle (1:N)
KbCategory.hasMany(KbArticle,   { foreignKey: 'kbCategoryId', as: 'articulos' });
KbArticle.belongsTo(KbCategory, { foreignKey: 'kbCategoryId', as: 'categoria' });

// Tenant ↔ ConfigItem (1:N)
Tenant.hasMany(ConfigItem,    { foreignKey: 'tenant_id', as: 'configItems' });
ConfigItem.belongsTo(Tenant,  { foreignKey: 'tenant_id', as: 'tenant' });

// Tenant ↔ KbArticle (1:N)
Tenant.hasMany(KbArticle,     { foreignKey: 'tenant_id', as: 'articulos' });
KbArticle.belongsTo(Tenant,   { foreignKey: 'tenant_id', as: 'tenant' });

// CiType ↔ ConfigItem (1:N)
CiType.hasMany(ConfigItem,   { foreignKey: 'ciTypeId', as: 'configItems' });
ConfigItem.belongsTo(CiType, { foreignKey: 'ciTypeId', as: 'tipo' });

// ============================================================================
// EXPORTAR
// ============================================================================

module.exports = {
    sequelize,
    Tenant,
    TenantFeature,
    TenantCustomField,
    TenantViewOverride,
    WorkflowTemplate,
    WorkflowTemplateStep,
    WorkflowInstance,
    Role,
    Permission,
    User,
    AuditLog,
    BusinessRule,
    Category,
    SLAPolicy,
    Ticket,
    TicketComment,
    TicketAttachment,
    TicketSurvey,
    ServiceRequest,
    ApprovalFlow,
    Change,
    Problem,
    KnownError,
    ServiceCategory,
    Service,
    CiType,
    ConfigItem,
    CiRelationship,
    Notification,
    KbCategory,
    KbArticle,
    CsiInitiative,
    ReportJob,
};
