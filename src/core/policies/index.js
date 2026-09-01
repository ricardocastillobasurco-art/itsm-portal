'use strict';

const { BasePolicy, ADMIN_ROLES, STAFF_ROLES, MANAGEMENT_ROLES } = require('./BasePolicy');
const TicketPolicy   = require('./TicketPolicy');
const ChangePolicy   = require('./ChangePolicy');
const AssetPolicy    = require('./AssetPolicy');
const KnowledgePolicy = require('./KnowledgePolicy');

module.exports = {
  BasePolicy,
  TicketPolicy,
  ChangePolicy,
  AssetPolicy,
  KnowledgePolicy,
  ADMIN_ROLES,
  STAFF_ROLES,
  MANAGEMENT_ROLES,
};
