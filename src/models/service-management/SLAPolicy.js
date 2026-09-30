const { DataTypes } = require('sequelize');
const sequelize = require('../../config/database');

const SLAPolicy = sequelize.define('SLAPolicy', {
    id:                 { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    tenantId:           { type: DataTypes.INTEGER, allowNull: true, defaultValue: 1, field: 'tenant_id' },
    // Único por (tenant_id, prioridad) — índice sla_policies_tenant_prioridad_unique
    prioridad:          { type: DataTypes.ENUM('P1','P2','P3','P4'), allowNull: false },
    tiempoRespuestaH:   { type: DataTypes.DECIMAL(5,2), allowNull: false },
    tiempoResolucionH:  { type: DataTypes.DECIMAL(5,2), allowNull: false },
}, { tableName: 'sla_policies', timestamps: true, underscored: true });

// Política del tenant para una prioridad; si el tenant no definió la suya, usa la de la plataforma (tenant 1)
SLAPolicy.forTenant = async function (tenantId, prioridad) {
    const tid = Number(tenantId) || 1;
    return (await SLAPolicy.findOne({ where: { tenantId: tid, prioridad } }))
        || (tid !== 1 ? await SLAPolicy.findOne({ where: { tenantId: 1, prioridad } }) : null);
};

module.exports = SLAPolicy;
