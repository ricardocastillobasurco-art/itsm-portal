'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const tables = await queryInterface.showAllTables();
    if (!tables.includes('tickets')) return;
    const cols = await queryInterface.describeTable('tickets').catch(() => null);
    if (!cols) return;

    if (!cols.ai_summary) {
      await queryInterface.addColumn('tickets', 'ai_summary', {
        type:         Sequelize.STRING(500),
        allowNull:    true,
        defaultValue: null,
        after:        'metadata',
      });
    }
    if (!cols.ai_keywords) {
      await queryInterface.addColumn('tickets', 'ai_keywords', {
        type:         Sequelize.STRING(500),
        allowNull:    true,
        defaultValue: null,
        after:        'ai_summary',
      });
    }
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tickets', 'ai_summary').catch(() => {});
    await queryInterface.removeColumn('tickets', 'ai_keywords').catch(() => {});
  },
};
