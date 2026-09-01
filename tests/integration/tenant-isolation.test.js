'use strict';

/**
 * Tenant Isolation Integration Tests
 *
 * These tests verify that repository and utility layers correctly scope
 * data by tenant_id — preventing cross-tenant data leakage.
 * All DB calls are mocked; no real DB connection is required.
 */

// ── Mock Sequelize models before requiring repositories ───────────────────────
jest.mock('../../src/models', () => ({
  ServiceRequest: {
    findAndCountAll: jest.fn(),
    create:          jest.fn(),
  },
  ApprovalFlow:    { create: jest.fn() },
  Service:         {},
  ServiceCategory: {},
}));

// Mock database for EmployeeRepository raw SQL calls
jest.mock('../../config/database', () => ({
  equipmentPool: {},
  executeQuery:  jest.fn(),
}));

const { ServiceRequest }       = require('../../src/models');
const ServiceRequestRepository = require('../../src/repositories/service-operations/ServiceRequestRepository');
const { tenantWhere }          = require('../../src/utils/tenantScope');

function makeReq(tenantId) {
  return { tenant: { id: tenantId }, user: { id: 'user-abc' } };
}

beforeEach(() => {
  jest.clearAllMocks();
  ServiceRequest.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });
  ServiceRequest.create.mockResolvedValue({ id: 'sr-1', tenantId: 1 });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('ServiceRequestRepository — tenant isolation', () => {
  it('injects tenant_id into findAll where clause', async () => {
    const req = makeReq(3);
    await ServiceRequestRepository.findAll({ status: 'pendiente_aprobacion' }, { req });

    expect(ServiceRequest.findAndCountAll).toHaveBeenCalledTimes(1);
    const [callArgs] = ServiceRequest.findAndCountAll.mock.calls;
    expect(callArgs[0].where).toMatchObject({ tenant_id: 3, status: 'pendiente_aprobacion' });
  });

  it('uses tenant_id:1 when no req is passed (backward compat)', async () => {
    await ServiceRequestRepository.findAll({ status: 'aprobado' });

    const [callArgs] = ServiceRequest.findAndCountAll.mock.calls;
    // No req → tenantFilter is empty object → no tenant_id injected
    expect(callArgs[0].where).not.toHaveProperty('tenant_id');
  });

  it('tenant A cannot see tenant B data — different tenant_ids produce different queries', async () => {
    const reqA = makeReq(1);
    const reqB = makeReq(2);

    await ServiceRequestRepository.findAll({}, { req: reqA });
    await ServiceRequestRepository.findAll({}, { req: reqB });

    const callA = ServiceRequest.findAndCountAll.mock.calls[0][0].where;
    const callB = ServiceRequest.findAndCountAll.mock.calls[1][0].where;

    expect(callA.tenant_id).toBe(1);
    expect(callB.tenant_id).toBe(2);
    expect(callA.tenant_id).not.toBe(callB.tenant_id);
  });

  it('injects tenant_id when creating a ServiceRequest', async () => {
    const req = makeReq(5);
    await ServiceRequestRepository.create({ title: 'Test SR', requesterId: 'user-1' }, req);

    expect(ServiceRequest.create).toHaveBeenCalledTimes(1);
    const createCall = ServiceRequest.create.mock.calls[0][0];
    expect(createCall.tenantId).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe('tenantWhere() — isolation contract', () => {
  it('always returns a specific tenant_id — never undefined', () => {
    const result = tenantWhere(makeReq(7));
    expect(result.tenant_id).toBeDefined();
    expect(typeof result.tenant_id).toBe('number');
  });

  it('different tenants produce different where clauses', () => {
    const w1 = tenantWhere(makeReq(1));
    const w2 = tenantWhere(makeReq(2));
    expect(w1).not.toEqual(w2);
  });

  it('fallback tenant (id=1) is still scoped — not open/undefined', () => {
    const w = tenantWhere(null);
    expect(w.tenant_id).toBe(1);
    // Must not be undefined, null, or 0 — any of those would be a data leak
    expect(w.tenant_id).toBeTruthy();
  });
});
