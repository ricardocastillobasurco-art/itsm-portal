'use strict';

const env = process.env.NODE_ENV || 'development';

const configs = {
  development: () => require('./development'),
  production:  () => require('./production'),
  testing:     () => require('./testing'),
  test:        () => require('./testing'),
};

const loader = configs[env] || configs.development;

module.exports = loader();
