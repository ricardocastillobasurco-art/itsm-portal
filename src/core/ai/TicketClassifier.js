'use strict';

const { chatJSON } = require('./GroqProvider');
const logger       = require('../../utils/logger');

const SYSTEM_PROMPT = `Eres un clasificador de tickets ITSM.
Dado el título y descripción de un ticket, devuelve SOLO un objeto JSON con estos campos:
- tipo: "incidente" | "solicitud" | "problema" | "cambio"
- priority: "P1" | "P2" | "P3" | "P4"
- categoria_sugerida: string (nombre corto de la categoría, en español)
- resumen: string (máximo 20 palabras, resumen ejecutivo del ticket)
- palabras_clave: string[] (máximo 5 keywords relevantes)

Reglas de prioridad:
- P1: caída total de servicio crítico, impacto masivo
- P2: degradación severa, impacto a múltiples usuarios
- P3: problema funcional, usuario puede trabajar con limitaciones
- P4: consulta, mejora o solicitud sin urgencia

Responde ÚNICAMENTE con el JSON, sin texto adicional.`;

/**
 * Clasifica un ticket a partir de su texto.
 * @param {string} titulo
 * @param {string} descripcion
 * @returns {Promise<{tipo, priority, categoria_sugerida, resumen, palabras_clave}>}
 */
async function classify(titulo, descripcion = '') {
  const userMsg = `Título: ${titulo}\nDescripción: ${descripcion || '(sin descripción)'}`;

  try {
    const result = await chatJSON(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMsg },
      ],
      { model: 'fast', maxTokens: 256, temperature: 0.1 }
    );

    // Validación mínima
    const validTipos      = ['incidente', 'solicitud', 'problema', 'cambio'];
    const validPriorities = ['P1', 'P2', 'P3', 'P4'];

    if (!validTipos.includes(result.tipo))          result.tipo     = 'incidente';
    if (!validPriorities.includes(result.priority)) result.priority = 'P3';

    return result;
  } catch (err) {
    logger.error('TicketClassifier: error al clasificar', { titulo, error: err.message });
    return null;
  }
}

module.exports = { classify };
