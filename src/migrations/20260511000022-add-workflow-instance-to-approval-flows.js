'use strict';

const { DataTypes } = require('sequelize');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('approval_flows')) return;
    const cols = await queryInterface.describeTable('approval_flows').catch(() => null);
    if (!cols) return;

    if (!cols.workflow_instance_id) {
      await queryInterface.addColumn('approval_flows', 'workflow_instance_id', {
        type:         DataTypes.CHAR(36),
        allowNull:    true,
        defaultValue: null,
        after:        'id',
      });
    }

    if (!cols.step_id) {
      await queryInterface.addColumn('approval_flows', 'step_id', {
        type:         DataTypes.INTEGER.UNSIGNED,
        allowNull:    true,
        defaultValue: null,
        after:        'workflow_instance_id',
        references:   { model: 'workflow_template_steps', key: 'id' },
        onDelete:     'SET NULL',
      });
    }

    await queryInterface.addIndex('approval_flows', ['workflow_instance_id'],
      { name: 'idx_af_workflow_instance' })
      .catch(e => { if (!e.message.includes('Duplicate key name')) throw e; });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('approval_flows', 'idx_af_workflow_instance').catch(() => {});
    await queryInterface.removeColumn('approval_flows', 'step_id').catch(() => {});
    await queryInterface.removeColumn('approval_flows', 'workflow_instance_id').catch(() => {});
  },
};
