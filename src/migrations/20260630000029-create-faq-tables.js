'use strict';

const { DataTypes } = require('sequelize');
const FAQ_SEED = require('../data/faq-seed');

module.exports = {
  async up(queryInterface) {
    const tables = await queryInterface.showAllTables();

    if (!tables.includes('faq_intents')) {
      await queryInterface.createTable('faq_intents', {
        id:           { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        intent_key:   { type: DataTypes.STRING(80), allowNull: false, unique: true },
        category:     { type: DataTypes.STRING(50), allowNull: true },
        title:        { type: DataTypes.STRING(120), allowNull: false },
        response_text:{ type: DataTypes.TEXT, allowNull: true },
        response_type:{ type: DataTypes.ENUM('text','greeting','api_tickets','api_directory','escalate'), defaultValue: 'text' },
        escalate_auto:{ type: DataTypes.BOOLEAN, defaultValue: false },
        active:       { type: DataTypes.BOOLEAN, defaultValue: true },
        sort_order:   { type: DataTypes.INTEGER, defaultValue: 0 },
        created_at:   { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        updated_at:   { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
      });
    }

    if (!tables.includes('faq_triggers')) {
      await queryInterface.createTable('faq_triggers', {
        id:        { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        intent_id: { type: DataTypes.INTEGER, allowNull: false },
        phrase:    { type: DataTypes.STRING(300), allowNull: false },
        weight:    { type: DataTypes.FLOAT, defaultValue: 1.0 },
      });
      await queryInterface.addIndex('faq_triggers', ['intent_id']);
    }

    if (!tables.includes('faq_followups')) {
      await queryInterface.createTable('faq_followups', {
        id:           { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        intent_id:    { type: DataTypes.INTEGER, allowNull: false },
        label:        { type: DataTypes.STRING(120), allowNull: false },
        next_intent_key: { type: DataTypes.STRING(80), allowNull: true },
        sort_order:   { type: DataTypes.INTEGER, defaultValue: 0 },
      });
      await queryInterface.addIndex('faq_followups', ['intent_id']);
    }

    // ── Seed solo si está vacío ──────────────────────────────────────────────
    const [[{ c }]] = await queryInterface.sequelize.query('SELECT COUNT(*) AS c FROM faq_intents');
    if (parseInt(c) > 0) return;

    for (const item of FAQ_SEED) {
      const [result] = await queryInterface.sequelize.query(
        `INSERT INTO faq_intents (intent_key, category, title, response_text, response_type, escalate_auto, active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        { replacements: [item.key, item.category, item.title, item.response || null, item.type, item.escalate ? 1 : 0, item.sort || 0] }
      );
      const intentId = result;

      if (item.triggers?.length) {
        const trigVals = item.triggers.map(phrase => `(${intentId}, ${queryInterface.sequelize.escape(phrase)}, 1.0)`).join(',');
        await queryInterface.sequelize.query(`INSERT INTO faq_triggers (intent_id, phrase, weight) VALUES ${trigVals}`);
      }

      if (item.followups?.length) {
        for (let i = 0; i < item.followups.length; i++) {
          const f = item.followups[i];
          await queryInterface.sequelize.query(
            `INSERT INTO faq_followups (intent_id, label, next_intent_key, sort_order) VALUES (?, ?, ?, ?)`,
            { replacements: [intentId, f.label, f.next_key || null, i] }
          );
        }
      }
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('faq_followups').catch(() => {});
    await queryInterface.dropTable('faq_triggers').catch(() => {});
    await queryInterface.dropTable('faq_intents').catch(() => {});
  },
};
