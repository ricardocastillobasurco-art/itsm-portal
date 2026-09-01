'use strict';

const { hasFeature, requireFeature, getFeatureMap, DEFAULTS } = require('../../../src/utils/featureFlags');

function makeReq(features) {
  return { tenant: { id: 1, plan: 'enterprise', settings: { features } } };
}

describe('hasFeature()', () => {
  it('returns true for a default-enabled feature with no override', () => {
    expect(hasFeature({ tenant: { settings: {} } }, 'itsm')).toBe(true);
  });

  it('returns false for a default-disabled feature with no override', () => {
    expect(hasFeature({ tenant: { settings: {} } }, 'cmdb')).toBe(false);
  });

  it('respects explicit tenant override → true', () => {
    expect(hasFeature(makeReq({ cmdb: true }), 'cmdb')).toBe(true);
  });

  it('respects explicit tenant override → false (disables default)', () => {
    expect(hasFeature(makeReq({ itsm: false }), 'itsm')).toBe(false);
  });

  it('returns false for unknown features', () => {
    expect(hasFeature(makeReq({}), 'nonexistent')).toBe(false);
  });

  it('falls back to defaults when req is null', () => {
    // itsm is default-enabled — should still return true
    expect(hasFeature(null, 'itsm')).toBe(DEFAULTS.itsm);
    // cmdb is default-disabled
    expect(hasFeature(null, 'cmdb')).toBe(DEFAULTS.cmdb);
  });

  it('falls back to defaults when tenant.settings is null', () => {
    expect(hasFeature({ tenant: { settings: null } }, 'itsm')).toBe(DEFAULTS.itsm);
  });
});

describe('requireFeature() middleware', () => {
  const next = jest.fn();

  beforeEach(() => next.mockReset());

  it('calls next() when feature is enabled', () => {
    const req = makeReq({ itsm: true });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    requireFeature('itsm')(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 when feature is disabled', () => {
    const req = makeReq({ cmdb: false });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    requireFeature('cmdb')(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('includes FEATURE_DISABLED code in 403 response', () => {
    const req = makeReq({});
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    requireFeature('billing')(req, res, next);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('FEATURE_DISABLED');
    expect(body.success).toBe(false);
  });
});

describe('getFeatureMap()', () => {
  it('merges defaults with tenant overrides', () => {
    const req = makeReq({ cmdb: true, itsm: false });
    const map = getFeatureMap(req);
    expect(map.cmdb).toBe(true);
    expect(map.itsm).toBe(false);
    expect(map['service-desk']).toBe(DEFAULTS['service-desk']);
  });

  it('returns defaults when tenant has no features config', () => {
    const map = getFeatureMap({ tenant: { settings: {} } });
    expect(map).toEqual(DEFAULTS);
  });
});
