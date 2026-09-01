'use strict';

const CircuitBreaker = require('opossum');
const axios  = require('axios');
const logger = require('../../../utils/logger');

const JIRA_HOST  = process.env.JIRA_HOST;
const JIRA_EMAIL = process.env.JIRA_EMAIL;
const JIRA_TOKEN = process.env.JIRA_API_TOKEN;
const SD_ID      = process.env.JIRA_SD_ID || '23';

function _authHeader() {
  return `Basic ${Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64')}`;
}

async function createJiraIssue({ ticket }) {
  if (!JIRA_HOST || !JIRA_TOKEN) throw new Error('Jira no configurado');

  const res = await axios.post(
    `${JIRA_HOST}/rest/servicedeskapi/request`,
    {
      serviceDeskId:    SD_ID,
      requestTypeId:    process.env.JIRA_RT_ID || '213',
      requestFieldValues: {
        summary:     ticket.titulo,
        description: ticket.descripcion || '',
      },
    },
    {
      headers: {
        Authorization:     _authHeader(),
        'Content-Type':    'application/json',
        'X-Atlassian-Token': 'no-check',
        'X-ExperimentalApi': 'opt-in',
      },
      timeout: 15000,
    },
  );

  return res.data;
}

const breaker = new CircuitBreaker(createJiraIssue, {
  timeout:                  15000,
  errorThresholdPercentage: 50,
  resetTimeout:             30000,
  name:                     'jira-create-issue',
});

breaker.on('open',     () => logger.warn('[jiraListener] Circuit breaker ABIERTO — Jira no disponible'));
breaker.on('halfOpen', () => logger.info('[jiraListener] Circuit breaker SEMI-ABIERTO — probando Jira'));
breaker.on('close',    () => logger.info('[jiraListener] Circuit breaker CERRADO — Jira recuperado'));

module.exports = function registerJiraListener(bus) {
  bus.on('ticket.created', async ({ ticket, tenantId }) => {
    if (!JIRA_HOST || !JIRA_TOKEN) return;

    try {
      const result = await breaker.fire({ ticket });
      logger.info(`[jiraListener] Ticket ${ticket.id} sincronizado → Jira ${result?.issueKey}`);
    } catch (err) {
      // Circuit breaker abierto o error de Jira — no bloquear la operación
      logger.warn(`[jiraListener] Fallo sync Jira para ticket ${ticket.id}: ${err.message}`);
    }
  });
};
