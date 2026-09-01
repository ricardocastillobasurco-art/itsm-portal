'use strict';
module.exports = {
    async up(qi, Sequelize) {
        await qi.createTable('rmm_alert_rules', {
            id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            name:        { type: Sequelize.STRING(120), allowNull: false },
            metric:      { type: Sequelize.ENUM('offline','cpu','ram','disk','updates_age','service_down','antivirus','firewall','bitlocker'), allowNull: false },
            operator:    { type: Sequelize.ENUM('gt','lt','eq','gte','lte'), defaultValue: 'gt' },
            threshold:   { type: Sequelize.DECIMAL(10,2), allowNull: true },
            param:       { type: Sequelize.STRING(120), allowNull: true }, // nombre servicio, disco, etc.
            severity:    { type: Sequelize.ENUM('info','warning','critical'), defaultValue: 'warning' },
            auto_ticket: { type: Sequelize.TINYINT(1), defaultValue: 0 },
            enabled:     { type: Sequelize.TINYINT(1), defaultValue: 1 },
            created_at:  { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        });

        await qi.createTable('rmm_alerts', {
            id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            rule_id:     { type: Sequelize.INTEGER, allowNull: true },
            rule_name:   { type: Sequelize.STRING(120), allowNull: false },
            node_id:     { type: Sequelize.STRING(128), allowNull: false },
            node_name:   { type: Sequelize.STRING(120), allowNull: true },
            metric:      { type: Sequelize.STRING(60),  allowNull: false },
            severity:    { type: Sequelize.ENUM('info','warning','critical'), defaultValue: 'warning' },
            value:       { type: Sequelize.STRING(200), allowNull: true },
            message:     { type: Sequelize.STRING(512), allowNull: false },
            status:      { type: Sequelize.ENUM('open','acknowledged','resolved'), defaultValue: 'open' },
            ack_by:      { type: Sequelize.STRING(120), allowNull: true },
            fired_at:    { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
            resolved_at: { type: Sequelize.DATE, allowNull: true },
        });

        // Índice para evitar alertas duplicadas open por mismo nodo+métrica+param
        await qi.addIndex('rmm_alerts', ['node_id', 'metric', 'status'], { name: 'idx_rmm_alert_open' });

        // Reglas por defecto
        const rules = [
            { name: 'Dispositivo offline',       metric: 'offline',       operator: 'gt', threshold: 5,  param: null,   severity: 'critical', auto_ticket: 0 },
            { name: 'CPU crítica (>90%)',         metric: 'cpu',           operator: 'gt', threshold: 90, param: null,   severity: 'critical', auto_ticket: 0 },
            { name: 'RAM alta (>85%)',            metric: 'ram',           operator: 'gt', threshold: 85, param: null,   severity: 'warning',  auto_ticket: 0 },
            { name: 'Disco bajo (<10% libre)',    metric: 'disk',          operator: 'lt', threshold: 10, param: null,   severity: 'critical', auto_ticket: 0 },
            { name: 'Sin parches >30 días',       metric: 'updates_age',   operator: 'gt', threshold: 30, param: null,   severity: 'warning',  auto_ticket: 0 },
        ];
        for (const r of rules) {
            await qi.sequelize.query(
                'INSERT INTO rmm_alert_rules (name, metric, operator, threshold, param, severity, auto_ticket, enabled) VALUES (?,?,?,?,?,?,?,1)',
                { replacements: [r.name, r.metric, r.operator, r.threshold, r.param, r.severity, r.auto_ticket] }
            );
        }
    },
    async down(qi) {
        await qi.dropTable('rmm_alerts');
        await qi.dropTable('rmm_alert_rules');
    },
};
