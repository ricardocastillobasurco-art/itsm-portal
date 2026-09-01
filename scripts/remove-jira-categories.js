require('dotenv').config();
const { executeQuery, equipmentPool } = require('../config/database');
const db = (sql, p = []) => executeQuery(equipmentPool, sql, p);

const JIRA_IDS = [83, 102, 104, 132, 170, 175];

async function run() {
    await db(`DELETE FROM ticket_categories WHERE parent_id IN (${JIRA_IDS.join(',')})`);
    await db(`DELETE FROM ticket_categories WHERE id IN (${JIRA_IDS.join(',')})`);
    const rem = await db(`SELECT COUNT(*) as n FROM ticket_categories`);
    console.log('✅ Listo. Filas restantes:', rem[0].n);
    process.exit(0);
}
run().catch(e => { console.error('❌', e.message); process.exit(1); });