'use strict';

jest.mock('../../../src/services/FeatureFlagService', () => ({ getAll: jest.fn() }));

const FeatureFlagService = require('../../../src/services/FeatureFlagService');
const IntegrationConfig = require('../../../src/services/IntegrationConfigService');

describe('IntegrationConfigService — credenciales del .env solo para el tenant dueño', () => {
  const env = { ...process.env };
  beforeAll(() => {
    Object.assign(process.env, {
      JIRA_HOST: 'https://owner.atlassian.net', JIRA_EMAIL: 'owner@x.com', JIRA_API_TOKEN: 'owner-token',
      MS_CLIENT_SECRET: 'owner-secret', GROQ_API_KEY: 'platform-ai-key',
    });
  });
  afterAll(() => { process.env = env; });

  it('el tenant dueño hereda el .env', async () => {
    FeatureFlagService.getAll.mockResolvedValue({});
    const cfg = await IntegrationConfig.get(1, 'jira');
    expect(cfg).toMatchObject({ base_url: 'https://owner.atlassian.net', api_token: 'owner-token' });
  });

  it('otro tenant sin config no recibe credenciales del dueño', async () => {
    FeatureFlagService.getAll.mockResolvedValue({});
    const jira = await IntegrationConfig.get(5, 'jira');
    const teams = await IntegrationConfig.get(5, 'microsoft_teams');
    expect(jira.api_token).toBe('');
    expect(jira.base_url).toBe('');
    expect(teams.client_secret).toBe('');
  });

  it('config parcial de otro tenant no se completa con el .env', async () => {
    FeatureFlagService.getAll.mockResolvedValue({ jira: { config: { base_url: 'https://cliente.atlassian.net' } } });
    const cfg = await IntegrationConfig.get(5, 'jira');
    expect(cfg.base_url).toBe('https://cliente.atlassian.net');
    expect(cfg.api_token).toBe('');
    expect(cfg.username).toBe('');
  });

  it('la clave de IA de la plataforma se comparte', async () => {
    FeatureFlagService.getAll.mockResolvedValue({});
    const cfg = await IntegrationConfig.get(5, 'api_externa');
    expect(cfg.api_key).toBe('platform-ai-key');
  });

  it('getStatus de otro tenant no muestra valores del dueño', async () => {
    FeatureFlagService.getAll.mockResolvedValue({});
    const st = await IntegrationConfig.getStatus(5);
    expect(st.jira.configured).toBe(false);
    expect(st.jira.effectiveUri).toBeNull();
    expect(st.jira.fieldSource.api_token).toBe('empty');
  });
});
