'use strict';

const { authorize } = require('../../../middleware/casbin');
const { ForbiddenError } = require('../../utils/errors');

/**
 * Combina la verificación Casbin RBAC con las políticas contextuales (ABAC).
 *
 * Uso en rutas:
 *   const { requirePolicy } = require('../../middlewares/authorization/requirePolicy');
 *   router.post('/tickets', authenticateToken, requirePolicy('ticket', 'create'), ctrl.create);
 *
 * Para también aplicar una política de contexto (opcional), pasar el assert como callback:
 *   requirePolicy('ticket', 'update', async (req) => {
 *     const ticket = await TicketRepository.findById(req.params.id);
 *     TicketPolicy.assertUpdate(req, ticket);
 *   })
 */
function requirePolicy(resource, action, contextCheck = null) {
  const casbinCheck = authorize(resource, action);

  return async (req, res, next) => {
    // 1. Casbin RBAC — verifica rol → recurso → acción
    await casbinCheck(req, res, async () => {
      if (!contextCheck) return next();

      // 2. Verificación contextual (ABAC) — opcional
      try {
        await contextCheck(req);
        next();
      } catch (err) {
        if (err instanceof ForbiddenError || err.status === 403) {
          return res.status(403).json({ success: false, error: err.message });
        }
        next(err);
      }
    });
  };
}

/**
 * Construye un objeto "req-like" mínimo para pasar a las Policy classes desde servicios.
 * Útil cuando el servicio no tiene acceso al objeto req completo.
 *
 * Uso en controllers:
 *   const pCtx = policyCtx(req);
 *   await svc(req).update(id, body, pCtx);
 *
 * Uso en services:
 *   TicketPolicy.assertUpdate(pCtx, ticket);
 */
function policyCtx(req) {
  return {
    user:   req.user,
    tenant: req.tenant,
  };
}

module.exports = { requirePolicy, policyCtx };
