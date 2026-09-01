'use strict';

module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/services/**/*.js',
    'src/repositories/**/*.js',
    'src/utils/**/*.js',
    '!**/node_modules/**',
  ],
  coverageDirectory: 'coverage',
  clearMocks: true,
};
