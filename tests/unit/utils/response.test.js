'use strict';

const ApiResponse = require('../../../src/utils/response');

describe('ApiResponse', () => {
  describe('success()', () => {
    it('returns success:true with data and default message', () => {
      const r = ApiResponse.success({ id: 1 });
      expect(r.success).toBe(true);
      expect(r.data).toEqual({ id: 1 });
      expect(r.message).toBe('OK');
    });

    it('accepts custom message', () => {
      const r = ApiResponse.success(null, 'Creado');
      expect(r.message).toBe('Creado');
    });

    it('spreads extra meta fields at root level', () => {
      const r = ApiResponse.success([], 'OK', { total: 5 });
      expect(r.total).toBe(5);
    });

    it('allows null data', () => {
      const r = ApiResponse.success(null);
      expect(r.data).toBeNull();
    });
  });

  describe('error()', () => {
    it('returns success:false with message and code', () => {
      const r = ApiResponse.error('No encontrado', 'NOT_FOUND');
      expect(r.success).toBe(false);
      expect(r.message).toBe('No encontrado');
      expect(r.code).toBe('NOT_FOUND');
      expect(r.data).toBeNull();
    });

    it('uses default code INTERNAL_ERROR', () => {
      const r = ApiResponse.error('Fallo');
      expect(r.code).toBe('INTERNAL_ERROR');
    });

    it('includes details when provided', () => {
      const r = ApiResponse.error('Inválido', 'VALIDATION_ERROR', [{ field: 'name' }]);
      expect(r.details).toEqual([{ field: 'name' }]);
    });
  });

  describe('paginated()', () => {
    it('returns correct pages count', () => {
      const r = ApiResponse.paginated([1, 2, 3], 30, 1, 10);
      expect(r.meta.pages).toBe(3);
      expect(r.meta.total).toBe(30);
      expect(r.meta.page).toBe(1);
      expect(r.meta.limit).toBe(10);
    });

    it('rounds up partial pages', () => {
      const r = ApiResponse.paginated([], 21, 1, 10);
      expect(r.meta.pages).toBe(3);
    });

    it('parses string page/limit to int', () => {
      const r = ApiResponse.paginated([], 10, '2', '5');
      expect(r.meta.page).toBe(2);
      expect(r.meta.limit).toBe(5);
    });

    it('returns success:true', () => {
      const r = ApiResponse.paginated([], 0, 1, 10);
      expect(r.success).toBe(true);
    });
  });
});
