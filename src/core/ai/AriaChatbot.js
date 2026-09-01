'use strict';

const { chat } = require('./GroqProvider');
const logger   = require('../../utils/logger');

const MAX_HISTORY = 10; // pares usuario/asistente que se mantienen en contexto

function buildSystemPrompt(tenantName, features = {}) {
  const featureList = [
    'tickets de incidentes',
    'solicitudes de servicio',
    features.changes    ? 'gestión de cambios'           : null,
    features.cmdb       ? 'inventario CMDB'              : null,
    features.knowledge  ? 'base de conocimiento'         : null,
  ].filter(Boolean).join(', ');

  return `Eres ARIA, asistente virtual de soporte TI de ${tenantName || 'la organización'}.
Ayudas a los usuarios a: ${featureList}.

Reglas:
- Responde siempre en español, de forma clara y empática.
- Si el usuario describe un problema, pregunta por detalles clave (sistema afectado, mensaje de error, desde cuándo).
- Si puedes resolver con información de la KB, hazlo directamente.
- Si el problema requiere un ticket, guía al usuario para crearlo e indica qué información incluir.
- Nunca inventes políticas o procedimientos; si no sabes, di "te recomiendo contactar al equipo de TI directamente".
- Respuestas cortas (máximo 4 oraciones) salvo que el usuario pida más detalle.
- No uses formato markdown en tus respuestas (el usuario puede estar en chat de texto plano).`;
}

/**
 * Envía un mensaje al chatbot ARIA y devuelve la respuesta + historial actualizado.
 *
 * @param {string}   userMessage   - Mensaje del usuario
 * @param {object[]} history       - Historial previo de { role, content }
 * @param {object}   ctx
 * @param {string}   ctx.tenantName  - Nombre del tenant para personalizar el prompt
 * @param {object}   ctx.features    - Features activas del tenant (changes, cmdb, knowledge)
 * @returns {Promise<{ reply: string, history: object[] }>}
 */
async function chat_(userMessage, history = [], ctx = {}) {
  const systemPrompt = buildSystemPrompt(ctx.tenantName, ctx.features);

  // Recorta historial si es muy largo
  const trimmedHistory = history.slice(-MAX_HISTORY * 2);

  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimmedHistory,
    { role: 'user', content: userMessage },
  ];

  try {
    const reply = await chat(messages, { model: 'balanced', maxTokens: 400, temperature: 0.5 });

    const updatedHistory = [
      ...trimmedHistory,
      { role: 'user',      content: userMessage },
      { role: 'assistant', content: reply },
    ];

    return { reply, history: updatedHistory };
  } catch (err) {
    logger.error('AriaChatbot: error', { error: err.message });
    return {
      reply:   'Lo siento, estoy teniendo dificultades técnicas en este momento. Por favor intenta de nuevo en unos minutos.',
      history: trimmedHistory,
    };
  }
}

module.exports = { chat: chat_ };
