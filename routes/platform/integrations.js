'use strict';

const express            = require('express');
const router             = express.Router();
const { authenticateToken } = require('../../middleware/auth');
const FeatureFlagService = require('../../src/services/FeatureFlagService');
const INTEGRATIONS       = require('../../src/config/integrations');

router.use(authenticateToken);

// GET /api/integraciones — features habilitadas + config para el tenant actual
router.get('/', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.fail('Sin tenant asociado', 400);

    const featMap = await FeatureFlagService.getAll(tenantId);
    const result  = {};

    for (const [key, schema] of Object.entries(INTEGRATIONS)) {
      const feat = featMap[key] || {};
      result[key] = {
        enabled: feat.enabled ?? false,
        config:  feat.config  || {},
        schema: {
          label:  schema.label,
          icon:   schema.icon,
          color:  schema.color,
          fields: schema.fields.map(f => ({
            key:         f.key,
            label:       f.label,
            type:        f.type,
            placeholder: (f.sensitive && feat.config?.[f.key]) ? '••••••• (guardado)' : f.placeholder,
            required:    f.required,
            sensitive:   f.sensitive ?? false,
          })),
        },
      };
    }
    res.ok(result);
  } catch (e) { next(e); }
});

// GET /api/integraciones/schema — solo los schemas, sin config (para SSA y devs)
router.get('/schema', (_req, res) => {
  const schema = {};
  for (const [key, s] of Object.entries(INTEGRATIONS)) {
    schema[key] = { label: s.label, icon: s.icon, color: s.color, fields: s.fields };
  }
  res.ok(schema);
});

// PUT /api/integraciones/:name — guarda config del tenant actual para una integración
router.put('/:name', async (req, res, next) => {
  try {
    const tenantId = req.user?.tenant_id;
    if (!tenantId) return res.fail('Sin tenant asociado', 400);

    const { name } = req.params;
    if (!INTEGRATIONS[name]) return res.fail(`Integración desconocida: ${name}`, 400);

    const schema  = INTEGRATIONS[name];
    const { config = {} } = req.body;

    // Leer config actual para no borrar campos sensibles con placeholders
    const featMap = await FeatureFlagService.getAll(tenantId);
    const current = featMap[name] || {};
    const merged  = { ...(current.config || {}) };

    for (const field of schema.fields) {
      const val = config[field.key];
      if (val === undefined || val === '') continue;
      if (field.sensitive && val === '••••••• (guardado)') continue;
      merged[field.key] = val;
    }

    const record = await FeatureFlagService.set(tenantId, name, current.enabled ?? false, merged);
    res.ok(record, 'Configuración guardada');
  } catch (e) { next(e); }
});

module.exports = router;
