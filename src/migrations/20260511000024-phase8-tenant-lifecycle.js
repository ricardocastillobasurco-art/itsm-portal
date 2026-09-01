'use strict';
const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    const addIdxSafe = async (table, cols, opts) => {
      try { await queryInterface.addIndex(table, cols, opts); }
      catch (e) { if (!e.message.includes('Duplicate key name')) throw e; }
    };

    // 1. tenant_id en sla_policies
    if (tables.includes('sla_policies')) {
      const slaCols = await queryInterface.describeTable('sla_policies').catch(() => null);
      if (slaCols && !slaCols.tenant_id) {
        await queryInterface.addColumn('sla_policies', 'tenant_id', {
          type:         DataTypes.INTEGER.UNSIGNED,
          allowNull:    true,
          defaultValue: null,
          references:   { model: 'tenants', key: 'id' },
          onDelete:     'CASCADE',
          after:        'id',
        });
        await addIdxSafe('sla_policies', ['tenant_id'], { name: 'idx_sla_policies_tenant_id' });
        await queryInterface.sequelize.query(
          'UPDATE sla_policies SET tenant_id = 1 WHERE tenant_id IS NULL'
        );
      }
    }

    // 2. tenant_id en approval_flows
    if (tables.includes('approval_flows')) {
      const afCols = await queryInterface.describeTable('approval_flows').catch(() => null);
      if (afCols && !afCols.tenant_id) {
        await queryInterface.addColumn('approval_flows', 'tenant_id', {
          type:         DataTypes.INTEGER.UNSIGNED,
          allowNull:    true,
          defaultValue: null,
          after:        'id',
        });
        await addIdxSafe('approval_flows', ['tenant_id'], { name: 'idx_af_tenant_id' });
      }
    }

    // 3. suspended_at en tenants
    if (tables.includes('tenants')) {
      const tCols = await queryInterface.describeTable('tenants').catch(() => null);
      if (tCols && !tCols.suspended_at) {
        await queryInterface.addColumn('tenants', 'suspended_at', {
          type:         DataTypes.DATE,
          allowNull:    true,
          defaultValue: null,
        });
      }
    }

    // 4. Tabla tenant_audit_log
    if (!tables.includes('tenant_audit_log')) {
      await queryInterface.createTable('tenant_audit_log', {
        id:         { type: DataTypes.INTEGER.UNSIGNED, autoIncrement: true, primaryKey: true },
        tenant_id:  { type: DataTypes.INTEGER.UNSIGNED, allowNull: false,
                      references: { model: 'tenants', key: 'id' }, onDelete: 'CASCADE' },
        event:      { type: DataTypes.STRING(100), allowNull: false },
        actor_id:   { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
        metadata:   { type: DataTypes.JSON, allowNull: true },
        created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      });
      await addIdxSafe('tenant_audit_log', ['tenant_id', 'created_at'],
        { name: 'idx_tal_tenant_created' });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tenant_audit_log').catch(() => {});
    await queryInterface.removeColumn('tenants', 'suspended_at').catch(() => {});
    await queryInterface.removeColumn('sla_policies', 'tenant_id').catch(() => {});
  },
};
