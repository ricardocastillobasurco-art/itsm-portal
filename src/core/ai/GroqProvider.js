'use strict';

const Groq    = require('groq-sdk');
const logger  = require('../../utils/logger');
const { metrics } = require('../metrics/MetricsRegistry');

const MODELS = {
  fast:      'llama-3.1-8b-instant',   // clasificación, sugerencias rápidas
  balanced:  'llama-3.3-70b-versatile', // KB search, chat
};

let _client = null;

function getClient() {
  if (!_client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error('GROQ_API_KEY no está configurada');
    _client = new Groq({ apiKey });
  }
  return _client;
}

/**
 * Llamada genérica al chat de Groq.
 * @param {object[]} messages  - Array de { role, content }
 * @param {object}   opts
 * @param {string}   opts.model        - 'fast' | 'balanced' | model ID completo
 * @param {number}   opts.maxTokens    - default 512
 * @param {number}   opts.temperature  - default 0.2
 * @returns {Promise<string>} contenido de la respuesta
 */
async function chat(messages, { model = 'balanced', maxTokens = 512, temperature = 0.2 } = {}) {
  const resolvedModel = MODELS[model] || model;

  const timer = metrics.aiRequestDuration.startTimer({ operation: model });
  try {
    const resp = await getClient().chat.completions.create({
      model:       resolvedModel,
      messages,
      max_tokens:  maxTokens,
      temperature,
    });
    timer();
    return resp.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    timer();
    logger.error('GroqProvider error', { model: resolvedModel, message: err.message });
    throw err;
  }
}

/**
 * Variante que fuerza respuesta JSON.
 * El mensaje de sistema debe pedir JSON; esta función parsea y valida.
 */
async function chatJSON(messages, opts = {}) {
  const raw = await chat(messages, { ...opts, model: opts.model || 'fast' });

  // Extrae el bloque JSON aunque venga envuelto en markdown
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
  const jsonStr = match ? match[1] : raw;

  try {
    return JSON.parse(jsonStr);
  } catch {
    logger.warn('GroqProvider: respuesta no es JSON válido', { raw });
    throw new Error('La IA devolvió una respuesta no estructurada');
  }
}

module.exports = { chat, chatJSON, MODELS };
