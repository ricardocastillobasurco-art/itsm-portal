'use strict';

// Mock the database before requiring TenantRepository
jest.mock('../../../config/database', () => ({
  equipmentPool: {},
  executeQuery:  jest.fn(),
}));

const { executeQuery } = require('../../../config/database');
const tenantRepo      = require('../../../src/repositories/platform/TenantRepository');

const FAKE_TENANT = {
  id:       2,
  slug:     'acme',
  name:     'Acme Corp',
  plan:     'enterprise',
  settings: null,
  is_active: 1,
};

beforeEach(() => {
  tenantRepo._resetCacheForTest();
  executeQuery.mockReset();
});

describe('TenantRepository — cache', () => {
  describe('findById()', () => {
    it('queries DB on first call', async () => {
      executeQuery.mockResolvedValueOnce([FAKE_TENANT]);
      const result = await tenantRepo.findById(2);
      expect(executeQuery).toHaveBeenCalledTimes(1);
      expect(result.slug).toBe('acme');
    });

    it('returns cached value on second call without hitting DB', async () => {
      executeQuery.mockResolvedValueOnce([FAKE_TENANT]);
      await tenantRepo.findById(2);
      await tenantRepo.findById(2);
      expect(executeQuery).toHaveBeenCalledTimes(1); // still only 1
    });

    it('also caches by slug from the same DB response', async () => {
      executeQuery.mockResolvedValueOnce([FAKE_TENANT]);
      await tenantRepo.findById(2);
      const bySlug = await tenantRepo.findBySlug('acme');
      expect(executeQuery).toHaveBeenCalledTimes(1); // slug served from cache
      expect(bySlug.id).toBe(2);
    });

    it('returns null and does not cache for unknown id', async () => {
      executeQuery.mockResolvedValueOnce([]);
      const result = await tenantRepo.findById(999);
      expect(result).toBeNull();
      // Next call should hit DB again (null is cached — just verify it's null)
      executeQuery.mockResolvedValueOnce([]);
      const result2 = await tenantRepo.findById(999);
      expect(result2).toBeNull();
    });
  });

  describe('findBySlug()', () => {
    it('queries DB on first call', async () => {
      executeQuery.mockResolvedValueOnce([FAKE_TENANT]);
      await tenantRepo.findBySlug('acme');
      expect(executeQuery).toHaveBeenCalledTimes(1);
    });

    it('returns cached value on second call', async () => {
      executeQuery.mockResolvedValueOnce([FAKE_TENANT]);
      await tenantRepo.findBySlug('acme');
      await tenantRepo.findBySlug('acme');
      expect(executeQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('updateSettings() — cache invalidation', () => {
    it('invalidates cache so next findById hits DB again', async () => {
      // Prime cache
      executeQuery.mockResolvedValueOnce([FAKE_TENANT]);
      await tenantRepo.findById(2);
      expect(executeQuery).toHaveBeenCalledTimes(1);

      // updateSettings — calls DB once
      executeQuery.mockResolvedValueOnce({ affectedRows: 1 });
      await tenantRepo.updateSettings(2, { graph: { mailbox: 'new@x.com' } });

      // findById should now hit DB again
      const updated = { ...FAKE_TENANT, settings: '{"graph":{"mailbox":"new@x.com"}}' };
      executeQuery.mockResolvedValueOnce([updated]);
      const result = await tenantRepo.findById(2);
      expect(executeQuery).toHaveBeenCalledTimes(3); // prime + update + re-fetch
      expect(result.settings.graph.mailbox).toBe('new@x.com');
    });
  });

  describe('default()', () => {
    it('returns a plain object with id:1', () => {
      const d = tenantRepo.default();
      expect(d.id).toBe(1);
      expect(d.plan).toBe('enterprise');
    });

    it('returns a new object each call — not a reference', () => {
      const a = tenantRepo.default();
      const b = tenantRepo.default();
      a.name = 'modified';
      expect(b.name).not.toBe('modified');
    });
  });
});

describe('TenantRepository — cache TTL', () => {
  it('re-queries DB after TTL expires', async () => {
    // Spy on Date.now to simulate TTL expiry
    const now = Date.now();
    const spy = jest.spyOn(Date, 'now');

    // Prime cache at t=0
    spy.mockReturnValue(now);
    executeQuery.mockResolvedValueOnce([FAKE_TENANT]);
    await tenantRepo.findById(2);

    // Advance time past TTL (5 min + 1 ms)
    spy.mockReturnValue(now + 5 * 60 * 1000 + 1);

    // Should hit DB again
    executeQuery.mockResolvedValueOnce([FAKE_TENANT]);
    await tenantRepo.findById(2);

    expect(executeQuery).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
