'use strict';

class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super(message, 404, 'NOT_FOUND');
  }
}

class ValidationError extends AppError {
  constructor(message = 'Datos inválidos', details = null) {
    super(message, 422, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class UnauthorizedError extends AppError {
  constructor(message = 'No autorizado') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Acceso denegado') {
    super(message, 403, 'FORBIDDEN');
  }
}

class ConflictError extends AppError {
  constructor(message = 'Conflicto con el estado actual') {
    super(message, 409, 'CONFLICT');
  }
}

module.exports = {
  AppError,
  NotFoundError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  ConflictError
};
