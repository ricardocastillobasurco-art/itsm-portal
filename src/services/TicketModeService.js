'use strict';

// Única regla para decidir si una empresa gestiona sus tickets en Jira o en la
// gestión local. La decide el interruptor "Modo Integración Jira" del superadmin
// (tenant_features 'jira'):
//   - Activado   → 'jira'  (si la empresa tiene un Jira utilizable)
//   - Desactivado → 'local'
//   - Sin definir → el tenant dueño usa Jira si está configurado; el resto, local.
// Todo canal (portal, panel de TI, chatbot, correo, API) debe consultar aquí.

const FeatureFlagService = require('./FeatureFlagService');

const OWNER_TENANT_ID = 1;

function ownerJiraConfigured() {
  return !!(process.env.JIRA_HOST && process.env.JIRA_EMAIL && (process.env.JIRA_API_TOKEN || process.env.JIRA_TOKEN));
}

// Jira que la empresa puede usar de verdad: el dueño usa el del .env; los demás,
// el suyo propio (Conexiones → Jira). Sin Jira utilizable, se usa la gestión local.
async function jiraUsable(tid) {
  if (tid === OWNER_TENANT_ID) return ownerJiraConfigured();
  try {
    const { getJiraConfig } = require('../../routes/jira/helpers');
    return !!(await getJiraConfig(tid));
  } catch (_) { return false; }
}

async function ticketMode(tenantId) {
  const tid = Number(tenantId) || OWNER_TENANT_ID;
  let flag;
  try { flag = (await FeatureFlagService.getAll(tid)).jira; } catch (_) { flag = undefined; }
  if (flag && flag.enabled === false) return 'local';
  const wantsJira = flag ? flag.enabled === true : tid === OWNER_TENANT_ID;
  return wantsJira && await jiraUsable(tid) ? 'jira' : 'local';
}

const isLocal = async (tenantId) => (await ticketMode(tenantId)) === 'local';

module.exports = { ticketMode, isLocal, OWNER_TENANT_ID };
