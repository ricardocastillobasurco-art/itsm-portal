'use strict';

const BaseRepository           = require('./BaseRepository');
const TenantBaseRepository     = require('./TenantBaseRepository');
const TenantRepository         = require('./platform/TenantRepository');
const EmployeeRepository       = require('./platform/EmployeeRepository');
const ServiceRequestRepository = require('./service-operations/ServiceRequestRepository');

module.exports = {
  BaseRepository,
  TenantBaseRepository,
  TenantRepository,
  EmployeeRepository,
  ServiceRequestRepository,
};
