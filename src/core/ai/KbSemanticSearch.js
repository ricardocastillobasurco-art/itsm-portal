'use strict';

const { chat }  = require('./GroqProvider');
const logger    = require('../../utils/logger');

const MAX_CONTEXT_CHARS = 6000; // límite de contexto enviado al LLM

/**
 * Dado un fragmento de texto de query y una lista de artículos de KB,
 * usa el LLM para identificar los más relevantes y generar una respuesta directa.
 *
 * @param {string}   query     - Pregunta o descripción del problema
 * @param {object[]} articles  - Array de { id, title, excerpt|content }
 * @param {object}   opts
 * @param {number}   opts.topK - Cuántos artículos retornar rankeados (default 3)
 * @returns {Promise<{ answer: string, articles: {id, title, relevance}[] }>}
 */
async function search(query, articles, { topK = 3 } = {}) {
  if (!articles?.length) return { answer: 'No hay artículos disponibles en la base de conocimiento.', articles: [] };

  // Construir contexto recortado para no exceder tokens
  let contextBlocks = '';
  for (const art of articles) {
    const text    = art.excerpt || (art.content || '').slice(0, 500);
    const block   = `[ID:${art.id}] ${art.title}\n${text}\n\n`;
    if ((contextBlocks + block).length > MAX_CONTEXT_CHARS) break;
    contextBlocks += block;
  }

  const systemPrompt = `Eres ARIA, el asistente de base de conocimiento ITSM.
Se te proporcionan artículos de la KB en formato [ID:N] Título\nResumen.
Tu tarea:
1. Identifica los ${topK} artículos más relevantes para la consulta del usuario.
2. Genera una respuesta directa y concisa (máximo 3 oraciones) basada en esos artículos.
3. Responde en este formato JSON exacto:
{
  "answer": "respuesta directa aquí",
  "articles": [
    { "id": <number>, "title": "...", "relevance": "alta|media|baja" }
  ]
}
Solo incluye artículos realmente relevantes (mínimo 1, máximo ${topK}).
Responde ÚNICAMENTE con el JSON.`;

  const userMsg = `Consulta: ${query}\n\nArtículos disponibles:\n${contextBlocks}`;

  try {
    const raw  = await chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMsg },
      ],
      { model: 'balanced', maxTokens: 512, temperature: 0.3 }
    );

    // Parse JSON (puede venir en bloque markdown)
    const match   = raw.match(/```(?:json)?\s*([\s\S]*?)```/) || raw.match(/(\{[\s\S]*\})/);
    const jsonStr = match ? match[1] : raw;
    return JSON.parse(jsonStr);
  } catch (err) {
    logger.error('KbSemanticSearch: error', { query, error: err.message });
    return { answer: 'No pude procesar la búsqueda semántica en este momento.', articles: [] };
  }
}

module.exports = { search };
