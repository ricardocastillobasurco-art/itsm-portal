'use strict';

const { getAccessToken, GraphAuthError } = require('../src/services/graphClient');

module.exports = async (req, res, next) => {
  if (!req.user?.id) {
    return res.status(401).json({ success: false, msReauth: false, error: 'No autenticado' });
  }
  try {
    req.graphToken = await getAccessToken(req.user.id);
    next();
  } catch (e) {
    if (e.msReauth || e instanceof GraphAuthError) {
      return res.status(401).json({
        success:  false,
        msReauth: true,
        error:    e.message || 'Sesión Microsoft expirada. Inicia sesión con Microsoft.',
      });
    }
    console.error('[requireGraphToken]', e.message);
    return res.status(500).json({ success: false, error: 'Error al obtener token Microsoft.' });
  }
};
