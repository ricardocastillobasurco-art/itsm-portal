'use strict';

const {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError,
} = require('../../../src/utils/errors');

describe('Custom error classes', () => {
  describe('AppError', () => {
    it('sets message, statusCode, code and isOperational', () => {
      const err = new AppError('algo falló', 422, 'MY_CODE');
      expect(err.message).toBe('algo falló');
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('MY_CODE');
      expect(err.isOperational).toBe(true);
    });

    it('defaults to 500 / INTERNAL_ERROR', () => {
      const err = new AppError('fallo');
      expect(err.statusCode).toBe(500);
      expect(err.code).toBe('INTERNAL_ERROR');
    });

    it('is an instance of Error', () => {
      expect(new AppError('x')).toBeInstanceOf(Error);
    });

    it('captures a stack trace', () => {
      const err = new AppError('x');
      expect(err.stack).toBeDefined();
    });
  });

  describe('NotFoundError', () => {
    it('uses statusCode 404 and NOT_FOUND code', () => {
      const err = new NotFoundError();
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
    });

    it('accepts custom message', () => {
      const err = new NotFoundError('Ticket no encontrado');
      expect(err.message).toBe('Ticket no encontrado');
    });

    it('is an instance of AppError', () => {
      expect(new NotFoundError()).toBeInstanceOf(AppError);
    });
  });

  describe('ValidationError', () => {
    it('uses statusCode 422 and VALIDATION_ERROR code', () => {
      const err = new ValidationError();
      expect(err.statusCode).toBe(422);
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    it('stores details', () => {
      const details = [{ field: 'email', msg: 'requerido' }];
      const err = new ValidationError('Datos inválidos', details);
      expect(err.details).toEqual(details);
    });
  });

  describe('UnauthorizedError', () => {
    it('uses statusCode 401', () => {
      expect(new UnauthorizedError().statusCode).toBe(401);
    });
  });

  describe('ForbiddenError', () => {
    it('uses statusCode 403', () => {
      expect(new ForbiddenError().statusCode).toBe(403);
    });
  });

  describe('ConflictError', () => {
    it('uses statusCode 409', () => {
      expect(new ConflictError().statusCode).toBe(409);
    });
  });
});
