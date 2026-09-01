'use strict';
module.exports = {
    async up(qi, Sequelize) {
        await qi.createTable('rmm_tenant_groups', {
            id:         { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            tenant_id:  { type: Sequelize.INTEGER, allowNull: false },
            mesh_id:    { type: Sequelize.STRING(128), allowNull: false },
            mesh_name:  { type: Sequelize.STRING(120), allowNull: true },
            created_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        });
        await qi.addIndex('rmm_tenant_groups', ['tenant_id'], { name: 'idx_rtg_tenant' });
        await qi.addIndex('rmm_tenant_groups', ['tenant_id', 'mesh_id'], { name: 'idx_rtg_unique', unique: true });
    },
    async down(qi) {
        await qi.dropTable('rmm_tenant_groups');
    },
};
