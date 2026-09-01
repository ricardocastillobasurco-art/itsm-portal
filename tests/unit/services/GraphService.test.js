'use strict';

const GraphService = require('../../../src/services/integrations/GraphService');

const FULL_ENV = {
  MS_CLIENT_ID1:     'env-client-id',
  MS_TENANT_ID1:     'env-tenant-id',
  MS_CLIENT_SECRET1: 'env-secret',
  MAIL_SENDER:       'env@example.com',
};

function setEnv(vars) {
  Object.assign(process.env, vars);
}

function clearEnv() {
  ['MS_CLIENT_ID1', 'MS_TENANT_ID1', 'MS_CLIENT_SECRET1', 'MAIL_SENDER'].forEach(
    k => delete process.env[k]
  );
}

afterEach(clearEnv);

describe('GraphService.fromTenant()', () => {
  it('uses env vars when tenant is null', () => {
    setEnv(FULL_ENV);
    const g = GraphService.fromTenant(null);
    expect(g.clientId).toBe('env-client-id');
    expect(g.mailbox).toBe('env@example.com');
  });

  it('uses tenant.settings.graph when present', () => {
    setEnv(FULL_ENV);
    const tenant = {
      settings: {
        graph: {
          clientId:     'tenant-client',
          tenantId:     'tenant-tid',
          clientSecret: 'tenant-secret',
          mailbox:      'tenant@example.com',
        },
      },
    };
    const g = GraphService.fromTenant(tenant);
    expect(g.clientId).toBe('tenant-client');
    expect(g.mailbox).toBe('tenant@example.com');
  });

  it('falls back to env for missing graph fields', () => {
    setEnv(FULL_ENV);
    const tenant = { settings: { graph: { mailbox: 'custom@example.com' } } };
    const g = GraphService.fromTenant(tenant);
    expect(g.clientId).toBe('env-client-id');
    expect(g.mailbox).toBe('custom@example.com');
  });

  it('uses env vars when tenant has no settings', () => {
    setEnv(FULL_ENV);
    const g = GraphService.fromTenant({ settings: null });
    expect(g.clientId).toBe('env-client-id');
  });
});

describe('GraphService.isConfigured()', () => {
  it('returns true when all 4 fields are present', () => {
    const g = new GraphService({
      clientId: 'a', tenantId: 'b', clientSecret: 'c', mailbox: 'd@e.com',
    });
    expect(g.isConfigured()).toBe(true);
  });

  it('returns false when any field is missing', () => {
    expect(new GraphService({ clientId: 'a', tenantId: 'b', clientSecret: 'c', mailbox: '' }).isConfigured()).toBe(false);
    expect(new GraphService({ clientId: '',  tenantId: 'b', clientSecret: 'c', mailbox: 'd' }).isConfigured()).toBe(false);
    expect(new GraphService({ clientId: 'a', tenantId: '',  clientSecret: 'c', mailbox: 'd' }).isConfigured()).toBe(false);
    expect(new GraphService({ clientId: 'a', tenantId: 'b', clientSecret: '', mailbox: 'd'  }).isConfigured()).toBe(false);
  });

  it('returns false when built from empty env', () => {
    clearEnv();
    const g = GraphService.fromTenant(null);
    expect(g.isConfigured()).toBe(false);
  });
});

describe('GraphService.configSummary()', () => {
  it('truncates clientId and tenantId — does not expose full secrets', () => {
    const g = new GraphService({
      clientId:     '12345678-abcd-efgh',
      tenantId:     '87654321-wxyz',
      clientSecret: 'super-secret-value',
      mailbox:      'user@domain.com',
    });
    const s = g.configSummary();
    expect(s.clientId).not.toContain('abcd');
    expect(s.configured).toBe(true);
    expect(s.mailbox).toBe('user@domain.com');
    expect(s).not.toHaveProperty('clientSecret');
  });

  it('returns configured:false when not configured', () => {
    const g = new GraphService({ clientId: '', tenantId: '', clientSecret: '', mailbox: '' });
    expect(g.configSummary().configured).toBe(false);
  });
});
