'use strict';

class ApiResponse {
  static success(data = null, message = 'OK', meta = {}) {
    return { success: true, data, message, ...meta };
  }

  static error(message = 'Error', code = 'INTERNAL_ERROR', details = null) {
    return { success: false, data: null, message, code, details };
  }

  static paginated(data, total, page, limit) {
    return {
      success: true,
      data,
      message: 'OK',
      meta: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit)
      }
    };
  }
}

module.exports = ApiResponse;
