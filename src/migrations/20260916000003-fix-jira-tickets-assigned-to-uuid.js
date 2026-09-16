'use strict';

// jira_tickets.assigned_to era INT pero users.id es UUID (CHAR 36).
// ALTER a VARCHAR(36) para que funcione el take/assign con usuarios UUID.
module.exports = {
    async up(queryInterface) {
        const q = sql => queryInterface.sequelize.query(sql);
        await q(`ALTER TABLE jira_tickets MODIFY COLUMN assigned_to VARCHAR(36) DEFAULT NULL`);
        await q(`ALTER TABLE jira_requirements MODIFY COLUMN assigned_to VARCHAR(36) DEFAULT NULL`).catch(() => {});
    },
    async down(queryInterface) {
        const q = sql => queryInterface.sequelize.query(sql);
        await q(`ALTER TABLE jira_tickets MODIFY COLUMN assigned_to INT DEFAULT NULL`).catch(() => {});
        await q(`ALTER TABLE jira_requirements MODIFY COLUMN assigned_to INT DEFAULT NULL`).catch(() => {});
    },
};
