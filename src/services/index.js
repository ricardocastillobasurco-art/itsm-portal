'use strict';

const BaseService           = require('./BaseService');
const EmployeeService       = require('./platform/EmployeeService');
const ServiceRequestService = require('./service-operations/ServiceRequestService');
const GraphService          = require('./integrations/GraphService');

module.exports = { BaseService, EmployeeService, ServiceRequestService, GraphService };
