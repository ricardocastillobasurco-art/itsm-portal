'use strict';

const ApiResponse = require('../utils/response');

/**
 * Attaches standardized response helpers to every res object.
 *
 *   res.ok(data, message, statusCode)    → {success:true, data, message}
 *   res.fail(message, statusCode, code)  → {success:false, data:null, message, code, error}
 *   res.paginated(data, total, page, limit) → {success:true, data, message:'OK', meta:{...}}
 *
 * Error responses include `error` as an alias for `message` so existing
 * frontend code that reads .error keeps working during migration.
 */
module.exports = function responseHelper(req, res, next) {
  res.ok = function (data = null, message = 'OK', statusCode = 200) {
    return this.status(statusCode).json(ApiResponse.success(data, message));
  };

  res.fail = function (message = 'Error interno', statusCode = 500, code = 'INTERNAL_ERROR') {
    return this.status(statusCode).json({
      ...ApiResponse.error(message, code),
      error: message,
    });
  };

  res.paginated = function (data, total, page, limit) {
    return this.json(ApiResponse.paginated(data, total, page, limit));
  };

  next();
};
