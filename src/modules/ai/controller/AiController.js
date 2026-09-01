'use strict';

const { classify }          = require('../../../core/ai/TicketClassifier');
const { search: kbSearch_ } = require('../../../core/ai/KbSemanticSearch');
const { chat: ariaChat_ }   = require('../../../core/ai/AriaChatbot');
const { KbArticle }         = require('../../../models');
const { Op }                = require('sequelize');
const { ValidationError }   = require('../../../utils/errors');

// ── POST /api/ai/classify ─────────────────────────────────────────────────────
async function classify_(req, res, next) {
  try {
    const { titulo, descripcion } = req.body;
    if (!titulo) throw new ValidationError('titulo es requerido');

    const result = await classify(titulo, descripcion);
    if (!result) return res.status(503).json({ success: false, error: 'Servicio de IA no disponible' });

    res.ok(result);
  } catch (err) { next(err); }
}

// ── POST /api/ai/kb-search ────────────────────────────────────────────────────
async function kbSearch(req, res, next) {
  try {
    const { query, limit = 10 } = req.body;
    if (!query?.trim()) throw new ValidationError('query es requerido');

    const tenantId = req.tenant?.id;

    // Carga artículos candidatos por búsqueda textual (no semántica) para luego re-rankear con IA
    const where = {
      status:    'publicado',
      deletedAt: null,
      [Op.or]:   [
        { title:   { [Op.like]: `%${query}%` } },
        { content: { [Op.like]: `%${query}%` } },
        { tags:    { [Op.like]: `%${query}%` } },
      ],
    };
    if (tenantId) where.tenantId = tenantId;

    const articles = await KbArticle.findAll({
      where,
      attributes: ['id', 'title', 'excerpt', 'content'],
      limit:      parseInt(limit) * 3, // pre-fetch más para que la IA tenga contexto suficiente
    });

    const result = await kbSearch_(query, articles, { topK: parseInt(limit) });
    res.ok(result);
  } catch (err) { next(err); }
}

// ── POST /api/ai/aria/chat ────────────────────────────────────────────────────
async function ariaChat(req, res, next) {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) throw new ValidationError('message es requerido');

    const ctx = {
      tenantName: req.tenant?.name || req.tenant?.slug,
      features:   req.tenant?.features || {},
    };

    const result = await ariaChat_(message, history, ctx);
    res.ok(result);
  } catch (err) { next(err); }
}

// ── GET /api/ai/status ────────────────────────────────────────────────────────
function status(req, res) {
  res.json({
    success:  true,
    provider: 'groq',
    enabled:  !!process.env.GROQ_API_KEY,
    features: ['classify', 'kb-search', 'aria-chat'],
  });
}

module.exports = {
  classify:  classify_,
  kbSearch,
  ariaChat,
  status,
};
