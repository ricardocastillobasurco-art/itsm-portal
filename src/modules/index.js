'use strict';

const MODULES = [
  require('./incident'),
  require('./service-request'),
  require('./change'),
  require('./problem'),
  require('./knowledge'),
  require('./asset'),
  require('./csi'),
  require('./service-desk'),
];

const registry = {
  all()     { return MODULES; },
  get(id)   { return MODULES.find(m => m.id === id) || null; },
  enabled() { return MODULES.filter(m => m.enabled); },

  registerRoutes(app) {
    for (const mod of this.enabled()) {
      try {
        const router = mod.router();
        app.use(mod.apiPrefix, router);
      } catch (err) {
        console.warn(`[modules] Could not load router for "${mod.id}": ${err.message}`);
      }
    }
  },
};

module.exports = registry;
