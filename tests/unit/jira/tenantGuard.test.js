'use strict';

// La guarda protege el Jira del .env; sin JIRA_HOST no hay nada que proteger
process.env.JIRA_HOST = process.env.JIRA_HOST || 'https://owner-test.atlassian.net';

jest.mock('../../../config/database', () => ({ equipmentPool: {}, executeQuery: jest.fn() }));
jest.mock('../../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 1 }; req.tenant = req._tokenTenant; next(); },
  optionalAuth: (_q, _r, n) => n(),
}));
jest.mock('../../../src/services/IntegrationConfigService', () => ({ get: jest.fn() }));

const axios = require('axios');
const { executeQuery } = require('../../../config/database');
const IntegrationConfig = require('../../../src/services/IntegrationConfigService');
const { runWithTenant } = require('../../../src/utils/tenantContext');
const helpers = require('../../../routes/jira/helpers');

// Adaptador que nunca sale a la red: si la petición llega aquí, el guardia la dejó pasar
const passthrough = async (cfg) => ({ status: 200, data: { ok: true }, headers: {}, config: cfg });

describe('guarda Jira por tenant', () => {
  const url = `${helpers.JIRA_HOST}/rest/api/3/myself`;

  it('bloquea el Jira del .env para otro tenant', async () => {
    await expect(runWithTenant(5, () => axios.get(url, { adapter: passthrough })))
      .rejects.toMatchObject({ code: 'JIRA_TENANT_BLOCKED' });
  });

  it('permite el Jira del .env al tenant original', async () => {
    const r = await runWithTenant(1, () => axios.get(url, { adapter: passthrough }));
    expect(r.data.ok).toBe(true);
  });

  it('permite tareas sin contexto de petición (cron del tenant original)', async () => {
    const r = await axios.get(url, { adapter: passthrough });
    expect(r.data.ok).toBe(true);
  });

  it('no afecta llamadas a otros hosts', async () => {
    const r = await runWithTenant(5, () => axios.get('https://otro-jira.example.com/rest', { adapter: passthrough }));
    expect(r.data.ok).toBe(true);
  });
});

describe('getJiraConfig', () => {
  it('no presta las credenciales del .env a otro tenant sin configuración propia', async () => {
    IntegrationConfig.get.mockResolvedValue({});
    expect(await helpers.getJiraConfig(5)).toBeNull();
  });

  it('usa la configuración propia del tenant', async () => {
    IntegrationConfig.get.mockResolvedValue({ base_url: 'https://cliente.atlassian.net', username: 'u', api_token: 't' });
    expect(await helpers.getJiraConfig(5)).toEqual({ host: 'https://cliente.atlassian.net', email: 'u', token: 't' });
  });
});

describe('ticketTenantGuard', () => {
  const run = (tenantId, rowsByTable) => new Promise((resolve) => {
    executeQuery.mockImplementation(async (_pool, sql) => rowsByTable[sql.match(/FROM (\w+)/)[1]] || []);
    const req = { _tokenTenant: { id: tenantId } };
    const res = { status(c) { this.code = c; return this; }, json() { resolve(this.code); } };
    helpers.ticketTenantGuard()(req, res, () => resolve('next'), 'TK-0001');
  });

  it('deja pasar un ticket del propio tenant', async () => {
    expect(await run(5, { jira_tickets: [{ tid: 5 }] })).toBe('next');
  });

  it('responde 404 a un ticket de otro tenant', async () => {
    expect(await run(5, { jira_tickets: [{ tid: 1 }] })).toBe(404);
  });

  it('solo el tenant dueño del Jira ve claves que no están en la base', async () => {
    expect(await run(1, {})).toBe('next');
    expect(await run(5, {})).toBe(404);
  });
});
