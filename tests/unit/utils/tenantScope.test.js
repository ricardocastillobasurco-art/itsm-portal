'use strict';

const { tenantWhere, addTenant, tenantId } = require('../../../src/utils/tenantScope');

function mockReq(id) {
  return { tenant: { id } };
}

describe('tenantScope', () => {
  describe('tenantWhere()', () => {
    it('returns { tenant_id } from req.tenant.id', () => {
      expect(tenantWhere(mockReq(5))).toEqual({ tenant_id: 5 });
    });

    it('falls back to 1 when req is null', () => {
      expect(tenantWhere(null)).toEqual({ tenant_id: 1 });
    });

    it('falls back to 1 when req.tenant is undefined', () => {
      expect(tenantWhere({})).toEqual({ tenant_id: 1 });
    });

    it('falls back to 1 when req.tenant.id is undefined', () => {
      expect(tenantWhere({ tenant: {} })).toEqual({ tenant_id: 1 });
    });
  });

  describe('addTenant()', () => {
    it('merges tenant_id into empty options', () => {
      const result = addTenant({}, mockReq(3));
      expect(result.where).toEqual({ tenant_id: 3 });
    });

    it('merges tenant_id into existing where clause', () => {
      const result = addTenant({ where: { status: 'abierto' } }, mockReq(7));
      expect(result.where).toEqual({ status: 'abierto', tenant_id: 7 });
    });

    it('preserves other top-level options', () => {
      const result = addTenant({ include: ['assoc'], limit: 10 }, mockReq(2));
      expect(result.include).toEqual(['assoc']);
      expect(result.limit).toBe(10);
    });

    it('does not mutate original options object', () => {
      const original = { where: { status: 'ok' } };
      addTenant(original, mockReq(1));
      expect(original.where).toEqual({ status: 'ok' });
    });
  });

  describe('tenantId()', () => {
    it('returns the numeric tenant id', () => {
      expect(tenantId(mockReq(9))).toBe(9);
    });

    it('returns 1 as default for null req', () => {
      expect(tenantId(null)).toBe(1);
    });
  });
});
