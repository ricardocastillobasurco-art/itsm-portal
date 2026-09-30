'use strict';

const { modulesForTenant, hasModule, ALL_MODULES, PLANS } = require('../../../src/config/plans');

jest.mock('../../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1' }; req.tenant = req._tenantFromToken; next(); },
}));
const requireModule = require('../../../middleware/requireModule');

describe('modulesForTenant()', () => {
  it('gives the owner tenant (id 1) every module regardless of plan', () => {
    expect([...modulesForTenant({ id: 1, plan: 'starter' })].sort()).toEqual([...ALL_MODULES].sort());
  });

  it('treats a missing tenant as the owner tenant', () => {
    expect(modulesForTenant(null).size).toBe(ALL_MODULES.length);
  });

  it('limits a starter tenant to helpdesk', () => {
    expect([...modulesForTenant({ id: 7, plan: 'starter' })]).toEqual(['helpdesk']);
  });

  it('gives professional its modules but not RMM or Microsoft', () => {
    const mods = modulesForTenant({ id: 7, plan: 'professional' });
    expect(mods.has('activos')).toBe(true);
    expect(mods.has('rmm')).toBe(false);
    expect(mods.has('microsoft')).toBe(false);
  });

  it('falls back to trial (all modules) for unknown plans', () => {
    expect(modulesForTenant({ id: 7, plan: 'plan-que-no-existe' }).size).toBe(PLANS.trial.modules.length);
  });

  it('never grants owner-only modules to other tenants', () => {
    const mods = modulesForTenant({ id: 7, plan: 'enterprise', settings: { extraModules: ['impresion', 'microsoft'] } });
    expect(mods.has('impresion')).toBe(false);
    expect(mods.has('microsoft')).toBe(false);
    expect(mods.has('rmm')).toBe(true);
  });

  it('adds valid extraModules and ignores unknown ones', () => {
    const mods = modulesForTenant({ id: 7, plan: 'starter', settings: { extraModules: ['rmm', 'inventado'] } });
    expect(mods.has('rmm')).toBe(true);
    expect(mods.has('inventado')).toBe(false);
  });

  it('hasModule() mirrors modulesForTenant()', () => {
    expect(hasModule({ id: 7, plan: 'starter' }, 'activos')).toBe(false);
    expect(hasModule({ id: 7, plan: 'enterprise' }, 'activos')).toBe(true);
  });
});

describe('requireModule()', () => {
  const run = (req) => new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(body) { resolve({ status: this.statusCode, body }); },
      send(body) { resolve({ status: this.statusCode, body }); },
    };
    requireModule('activos')(req, res, () => resolve({ status: 'next' }));
  });

  it('throws on an unknown module key', () => {
    expect(() => requireModule('no-existe')).toThrow();
  });

  it('lets the request through when the plan includes the module', async () => {
    const r = await run({ originalUrl: '/api/equipment', user: { id: 1 }, tenant: { id: 7, plan: 'professional' } });
    expect(r.status).toBe('next');
  });

  it('returns 403 JSON for API requests when the plan lacks the module', async () => {
    const r = await run({ originalUrl: '/api/equipment', user: { id: 1 }, tenant: { id: 7, plan: 'starter' } });
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ success: false, module: 'activos', upgradeRequired: true });
  });

  it('authenticates first and uses the tenant from the token, not the host', async () => {
    const r = await run({ originalUrl: '/api/equipment', tenant: { id: 1 }, _tenantFromToken: { id: 7, plan: 'starter' } });
    expect(r.status).toBe(403);
  });
});
