'use strict';

const express = require('express');
const router  = express.Router();
const { optionalAuth, authenticateToken } = require('../../middleware/auth');
const KnowledgeService = require('../../src/modules/knowledge/service/KnowledgeService');
const FAQ_SEED = require('../../src/data/faq-seed');

// ── Jira helpers (server-side) ────────────────────────────────────────────────
const axios    = require('axios');
const FormData = require('form-data');
const { jira, dbQuery, JIRA_HOST, JIRA_EMAIL, JIRA_TOKEN, SD_ID, RT_ID, resolveJiraAccountId } = require('../jira/helpers');
const SD_REQ_CHATBOT = process.env.JIRA_REQ_SD_ID || '1156';
const RT_REQ_CHATBOT = process.env.JIRA_REQ_RT_ID || '1595';
const FeatureFlagService = require('../../src/services/FeatureFlagService');
function _adf(text) {
  return { type:'doc', version:1, content:[{ type:'paragraph', content:[{ type:'text', text: String(text) }] }] };
}

// ── Image upload / OCR ────────────────────────────────────────────────────────
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');
const multer    = require('multer');
const Tesseract = require('tesseract.js');

const _chatbotUploadDir = path.join(__dirname, '../../uploads/chatbot');
try { fs.mkdirSync(_chatbotUploadDir, { recursive: true }); } catch (_) {}

const _imgUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, _chatbotUploadDir),
    filename:    (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
      cb(null, crypto.randomBytes(16).toString('hex') + ext);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype);
    cb(ok ? null : new Error('Solo se permiten imágenes JPEG, PNG o WEBP'), ok);
  },
});

async function _runOCR(imagePath) {
  const OCR_TIMEOUT = 45000;
  const ocrP  = Tesseract.recognize(imagePath, 'spa+eng', { logger: () => {} });
  const tout  = new Promise((_, r) => setTimeout(() => r(new Error('OCR timeout')), OCR_TIMEOUT));
  const { data } = await Promise.race([ocrP, tout]);
  return { text: (data.text || '').replace(/\s+/g, ' ').trim(), confidence: Math.round(data.confidence || 0) };
}

// ── FAQ engine ────────────────────────────────────────────────────────────────
let _faqTablesReady = false;
let _synMap = null;

async function _ensureFaqTables() {
  if (_faqTablesReady) return;
  await dbQuery(`CREATE TABLE IF NOT EXISTS faq_intents (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    intent_key   VARCHAR(80) NOT NULL UNIQUE,
    category     VARCHAR(50),
    title        VARCHAR(120) NOT NULL,
    response_text TEXT,
    response_type ENUM('text','greeting','api_tickets','api_directory','escalate') DEFAULT 'text',
    escalate_auto TINYINT(1) DEFAULT 0,
    active       TINYINT(1) DEFAULT 1,
    sort_order   INT DEFAULT 0,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
  await dbQuery(`CREATE TABLE IF NOT EXISTS faq_triggers (
    id        INT AUTO_INCREMENT PRIMARY KEY,
    intent_id INT NOT NULL,
    phrase    VARCHAR(300) NOT NULL,
    weight    FLOAT DEFAULT 1.0,
    INDEX idx_fti (intent_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
  await dbQuery(`CREATE TABLE IF NOT EXISTS faq_followups (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    intent_id       INT NOT NULL,
    label           VARCHAR(120) NOT NULL,
    next_intent_key VARCHAR(80),
    sort_order      INT DEFAULT 0,
    INDEX idx_ffu (intent_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
  await dbQuery(`CREATE TABLE IF NOT EXISTS faq_synonyms (
    id      INT AUTO_INCREMENT PRIMARY KEY,
    term    VARCHAR(100) NOT NULL,
    synonym VARCHAR(100) NOT NULL,
    INDEX idx_syn_t (term), INDEX idx_syn_s (synonym)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});

  const [{ synCt }] = await dbQuery('SELECT COUNT(*) AS synCt FROM faq_synonyms').catch(() => [{ synCt: 1 }]);
  if (!parseInt(synCt)) {
    const SYN_INIT = [
      ['contrasena','password'],['contrasena','clave'],['contrasena','pass'],
      ['correo','email'],['correo','mail'],['correo','outlook'],
      ['computadora','pc'],['computadora','laptop'],['computadora','portatil'],['computadora','notebook'],
      ['impresora','printer'],['impresora','imprimir'],
      ['internet','wifi'],['internet','conexion'],
      ['software','programa'],['software','aplicacion'],['software','app'],
      ['ticket','incidencia'],['ticket','requerimiento'],['ticket','solicitud'],
      ['mfa','autenticacion'],['mfa','verificacion'],
      ['pantalla','monitor'],['pantalla','display'],
      ['telefono','celular'],['telefono','movil'],
      ['cuenta','usuario'],['cuenta','login'],
      ['vpn','remoto'],['actualizacion','update'],['actualizacion','parche'],
    ];
    const sv = SYN_INIT.map(() => '(?,?)').join(',');
    await dbQuery(`INSERT INTO faq_synonyms (term,synonym) VALUES ${sv}`, SYN_INIT.flat()).catch(() => {});
  }
  _synMap = null; // forzar recarga en próximo _loadSynonyms

  // Seed si está vacío
  const [{ total }] = await dbQuery('SELECT COUNT(*) AS total FROM faq_intents');
  if (parseInt(total) === 0) {
    for (const item of FAQ_SEED) {
      const r = await dbQuery(
        `INSERT IGNORE INTO faq_intents (intent_key, category, title, response_text, response_type, escalate_auto, active, sort_order)
         VALUES (?,?,?,?,?,?,1,?)`,
        [item.key, item.category, item.title, item.response || null, item.type, item.escalate ? 1 : 0, item.sort || 0]
      );
      const intentId = r.insertId;
      if (!intentId) continue;
      if (item.triggers?.length) {
        const vals = item.triggers.map(() => '(?,?,1.0)').join(',');
        const params = item.triggers.flatMap(phrase => [intentId, phrase]);
        await dbQuery(`INSERT INTO faq_triggers (intent_id, phrase, weight) VALUES ${vals}`, params).catch(() => {});
      }
      if (item.followups?.length) {
        for (let i = 0; i < item.followups.length; i++) {
          const f = item.followups[i];
          await dbQuery('INSERT INTO faq_followups (intent_id, label, next_intent_key, sort_order) VALUES (?,?,?,?)',
            [intentId, f.label, f.next_key || null, i]).catch(() => {});
        }
      }
    }
  }
  await dbQuery(`CREATE TABLE IF NOT EXISTS chatbot_analytics (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    user_email   VARCHAR(255),
    message      TEXT NOT NULL,
    resolved_by  ENUM('faq','kb','groq','none') DEFAULT 'none',
    intent_key   VARCHAR(80) NULL,
    created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_ca_ts (created_at),
    INDEX idx_ca_email (user_email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
  // Reemplazar triggers de directorio que se reducen a 1 sola palabra (falsos positivos)
  const _badDir = ['numero de','telefono de','correo de','extension de','email de','interno de','anexo de','celular de'];
  for (const _t of _badDir) {
    await dbQuery(
      `DELETE ft FROM faq_triggers ft
       JOIN faq_intents fi ON fi.id = ft.intent_id
       WHERE fi.intent_key = 'directorio_personas' AND ft.phrase = ?`, [_t]
    ).catch(() => {});
  }
  const _dirRow = await dbQuery(`SELECT id FROM faq_intents WHERE intent_key='directorio_personas' LIMIT 1`).catch(() => []);
  if (_dirRow[0]?.id) {
    const _dirId  = _dirRow[0].id;
    const _goodDir = [
      'buscar contacto empleado','datos contacto persona','directorio empresa',
      'informacion contacto persona','comunicarme con persona',
      'quien jefe area','numero extension persona',
      'correo electronico empleado','telefono celular empleado',
      'contacto compañero trabajo'
    ];
    for (const _t of _goodDir) {
      await dbQuery(
        `INSERT IGNORE INTO faq_triggers (intent_id, phrase, weight) VALUES (?,?,1.0)`,
        [_dirId, _t]
      ).catch(() => {});
    }
  }

  _faqTablesReady = true;
}

function _normText(str) {
  return String(str).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

async function _loadSynonyms() {
  if (_synMap) return;
  _synMap = new Map();
  try {
    const rows = await dbQuery('SELECT term, synonym FROM faq_synonyms');
    for (const r of rows) {
      const t = _normText(r.term), s = _normText(r.synonym);
      _synMap.set(s, t); // synonym → canonical
      if (!_synMap.has(t)) _synMap.set(t, t); // canonical → canonical
    }
  } catch (_) {}
}

function _canon(w) { return (_synMap && _synMap.has(w)) ? _synMap.get(w) : w; }

function _words(norm) { return norm.split(' ').filter(w => w.length >= 3); }

// Levenshtein dist ≤ 1, solo palabras length ≥ 4
function _closeTo(a, b) {
  if (a === b) return true;
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) {
    let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d === 1;
  }
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  let si = 0, skip = 0;
  for (let li = 0; li < l.length && si < s.length; li++) {
    if (l[li] === s[si]) si++;
    else if (++skip > 1) return false;
  }
  return true;
}

function _scorePhrase(msgWords, msgBigrams, trigNorm) {
  const tw = _words(trigNorm).map(_canon);
  if (tw.length < 2) return 0; // trigger de 1 sola palabra → demasiado genérico
  const matched = tw.filter(w => msgWords.has(w)).length;
  let score = matched / tw.length;
  // Bigrama: bonus si dos palabras consecutivas del trigger coinciden en el mensaje
  for (let i = 0; i < tw.length - 1; i++) {
    if (msgBigrams.has(tw[i] + ' ' + tw[i + 1])) { score = Math.min(1, score * 1.2); break; }
  }
  return score;
}

async function _faqMatch(message) {
  try {
    await _ensureFaqTables();
    await _loadSynonyms();

    const msgNorm    = _normText(message);
    const rawTokens  = _words(msgNorm).map(_canon);
    const msgWords   = new Set(rawTokens);
    const msgBigrams = new Set();
    for (let i = 0; i < rawTokens.length - 1; i++) {
      msgBigrams.add(rawTokens[i] + ' ' + rawTokens[i + 1]);
    }

    const rows = await dbQuery(`
      SELECT i.id, i.intent_key, i.title, i.response_text, i.response_type, i.escalate_auto,
             t.phrase, t.weight
      FROM faq_intents i
      JOIN faq_triggers t ON t.intent_id = i.id
      WHERE i.active = 1
    `);

    // Fuzzy: para mensajes cortos (≤ 3 tokens) añadir palabras del vocabulario de triggers
    // que disten un carácter (captura typos: "conraseña" → "contrasena")
    if (rawTokens.length <= 3) {
      const trigVocab = new Set(rows.flatMap(r => _words(_normText(r.phrase)).map(_canon)));
      for (const mw of rawTokens) {
        for (const tw of trigVocab) {
          if (!msgWords.has(tw) && _closeTo(mw, tw)) msgWords.add(tw);
        }
      }
    }

    const best = {};
    for (const row of rows) {
      const score = _scorePhrase(msgWords, msgBigrams, _normText(row.phrase)) * (row.weight || 1);
      if (!best[row.intent_key] || score > best[row.intent_key].score) {
        best[row.intent_key] = { ...row, score };
      }
    }

    const sorted = Object.values(best).sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    if (!winner || winner.score < 0.50) return null;

    // Desambiguación: si los dos primeros están muy próximos, preguntar al usuario
    const runner = sorted[1];
    if (runner && runner.score >= 0.44 && (winner.score - runner.score) < 0.08) {
      return {
        ambiguous: true,
        options: [
          { intent_key: winner.intent_key, title: winner.title },
          { intent_key: runner.intent_key, title: runner.title },
        ],
      };
    }

    const followups = await dbQuery(
      'SELECT label, next_intent_key FROM faq_followups WHERE intent_id=? ORDER BY sort_order',
      [winner.id]
    );
    return { ...winner, followups: followups || [] };
  } catch (e) {
    return null;
  }
}

function _greetingByHour() {
  const h = new Date().getHours();
  if (h >= 6  && h < 12) return '¡Buenos días! ☀️ Soy **ARIA**, asistente virtual de TI. ¿En qué puedo ayudarte hoy?';
  if (h >= 12 && h < 19) return '¡Buenas tardes! 👋 Soy **ARIA**, asistente virtual de TI. ¿Qué necesitas?';
  return '¡Buenas noches! 🌙 Soy **ARIA**. Estoy disponible aunque sea tarde. ¿En qué te ayudo?';
}

function _extractPersonName(message) {
  const norm = _normText(message);
  const patterns = [
    /(?:numero|telefono|extension|correo|email|contacto|datos|informacion|anexo|celular|interno)\s+(?:de|del|de la|de los)\s+(.{3,40})/,
    /(?:buscar|encontrar|contactar|comunicarme con)\s+(?:a |al |la |el )?(.{3,40})/,
    /(?:quien es)\s+(.{3,40})/,
  ];
  for (const p of patterns) {
    const m = norm.match(p);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL   = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const GROQ_URL     = 'https://api.groq.com/openai/v1/chat/completions';

const PLATFORM_SYSTEM_PROMPT = `Eres ARIA, asistente virtual del Sistema de Gestión IT de Integratel. Orientas a los empleados sobre el uso de la plataforma y respondes consultas técnicas de TI.

## Plataforma de Autogestión IT — Guía de uso

### Módulos disponibles
- **Generar Incidencia**: Reporta fallas, interrupciones o problemas con equipos o servicios TI (PC lenta, internet caído, impresora no funciona, acceso bloqueado, etc.)
- **Generar Requerimiento**: Solicita formalmente servicios, equipos, software, accesos o recursos TI nuevos
- **Consultar Mis Tickets**: Revisa el estado de tus incidencias y requerimientos activos o cerrados
- **Herramientas TI**: Suite de herramientas digitales para el trabajo diario:
  - Impresiones: gestión de cola de impresión (filtrada por tu correo)
  - Reportes: estadísticas e informes de TI
  - Anotador: bloc de notas digital con formato
  - Flujos: diagramas de procesos BPMN
  - Pizarra: pizarra colaborativa visual
  - Proyectos: gestión de tareas con diagrama Gantt
  - Notas: editor de texto enriquecido
  - Mapas: mapas mentales interactivos
  - Archivos: gestión de archivos
  - Turnos: calendario de turnos del equipo
  - Pomodoro: temporizador de productividad
  - Eventos: calendario de eventos
  - QR: generador y lector de códigos QR
- **Base de Conocimiento**: Artículos técnicos, guías y procedimientos del equipo de TI
- **Preguntas Frecuentes (FAQ)**: Respuestas rápidas sobre servicios, equipos y procesos TI
- **Devoluciones y Garantías**: Gestiona devoluciones de equipos o activos TI
- **Encuesta de Satisfacción**: Evalúa la calidad del servicio TI recibido

### ¿Cuándo usar cada módulo?
- **Algo está roto o no funciona** → Generar Incidencia
- **Necesito algo nuevo** (equipo, acceso, software) → Generar Requerimiento
- **Ver mis solicitudes** → Consultar Mis Tickets
- **Buscar soluciones por mi cuenta** → Base de Conocimiento o FAQ
- **Herramientas de trabajo** → Herramientas TI

### Proceso para registrar una incidencia
1. Haz clic en "Generar Incidencia" en el catálogo
2. Confirma tu correo corporativo
3. Escribe o selecciona el tipo de problema
4. La descripción se auto-genera (puedes editarla)
5. Adjunta una captura si es útil
6. Haz clic en "Registrar Incidencia" → recibirás un número de ticket

### Proceso para registrar un requerimiento
1. Haz clic en "Generar Requerimiento"
2. Selecciona el tipo de requerimiento y la prioridad
3. Describe lo que necesitas
4. Adjunta documentación si aplica
5. Haz clic en "Registrar Requerimiento" → recibirás un número de ticket

## Artículos de la Base de Conocimiento relevantes para esta consulta:
{KB_CONTEXT}

## Instrucciones de comportamiento
- Responde siempre en español, de manera concisa y amigable
- Si el usuario describe un problema técnico, sugiere si debe abrir una incidencia o requerimiento
- Si hay artículos de KB relevantes, mencionálos con su título
- Si no tienes información suficiente, dilo claramente y sugiere contactar al Service Desk
- No inventes funcionalidades que no están descritas arriba
- Máximo 3-4 párrafos por respuesta`;

router.post('/message', optionalAuth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message?.trim()) return res.json({ success: false, reply: 'Mensaje vacío.' });

    // ── 1. FAQ match (antes de llamar a Groq) ────────────────────────────────
    const faqMatch = await _faqMatch(message).catch(() => null);

    if (faqMatch) {
      // Desambiguación: dos intents muy cercanos — preguntar al usuario cuál quiso decir
      if (faqMatch.ambiguous) {
        return res.json({
          success:  true,
          reply:    '¿Tu consulta es sobre alguno de estos temas?',
          followups: faqMatch.options.map(o => ({ label: o.title, next_key: o.intent_key })),
          intent:   'disambiguation',
        });
      }

      const type      = faqMatch.response_type;
      const followups = (faqMatch.followups || []).map(f => ({ label: f.label, next_key: f.next_intent_key }));

      // Saludo según hora
      if (type === 'greeting') {
        return res.json({ success: true, reply: _greetingByHour(), intent: faqMatch.intent_key, followups });
      }

      // Escalar a especialista
      if (type === 'escalate') {
        return res.json({
          success:  true,
          reply:    faqMatch.response_text,
          intent:   faqMatch.intent_key,
          escalate: true,
          followups,
        });
      }

      // Consulta de tickets del usuario
      if (type === 'api_tickets') {
        const userEmail = req.user?.email || req.user?.username;
        let tickets = [];
        let ticketList = '';
        if (userEmail) {
          tickets = await dbQuery(
            `SELECT ticket_key, summary, internal_status, priority, created_at, assigned_to_name, jira_url
             FROM jira_tickets WHERE reporter=? AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 8`,
            [userEmail]
          ).catch(() => []);
          if (tickets?.length) {
            const statusIcon = { abierto:'🔵', en_proceso:'🟡', resuelto:'✅', cerrado:'⬛', pendiente:'🟠' };
            ticketList = `Encontré **${tickets.length}** ticket(s):`;
          } else {
            ticketList = '_No tienes tickets registrados en este momento._';
          }
        } else {
          ticketList = '_Inicia sesión para ver tus tickets._';
        }
        followups.push({ label: '🎫 Nueva incidencia', _createTicket: true, _summary: 'Solicitud de soporte TI' });
        followups.push({ label: '📋 Nuevo requerimiento', _createRequirement: true, _summary: 'Nuevo requerimiento TI' });
        return res.json({ success: true, reply: ticketList, intent: faqMatch.intent_key, followups, tickets });
      }

      // Directorio de personas
      if (type === 'api_directory') {
        const name = _extractPersonName(message);
        if (name) {
          const people = await dbQuery(
            `SELECT full_name, email, phone, department, job_title
             FROM employees WHERE full_name LIKE ? AND active=1 LIMIT 3`,
            [`%${name}%`]
          ).catch(() => []);
          if (people?.length) {
            const list = people.map(p =>
              `👤 **${p.full_name}**\n📧 ${p.email || '—'}${p.phone ? '\n📞 ' + p.phone : ''}${p.department ? '\n🏢 ' + p.department : ''}${p.job_title ? ' · ' + p.job_title : ''}`
            ).join('\n\n');
            return res.json({ success: true, reply: `Encontré lo siguiente:\n\n${list}`, intent: faqMatch.intent_key, followups });
          }
          return res.json({ success: true, reply: `No encontré a nadie con el nombre **"${name}"** en el directorio. Verifica el nombre o consulta con RRHH.`, intent: faqMatch.intent_key, followups });
        }
        return res.json({ success: true, reply: faqMatch.response_text, intent: faqMatch.intent_key, followups });
      }

      // Respuesta de texto directo — inyectar followup de acción rápida según intent
      if (req.user) {
        if (faqMatch.intent_key === 'crear_incidencia') {
          followups.unshift({ label: '🎫 Crear incidencia ahora', _quickCreate: 'incident' });
        }
        if (faqMatch.intent_key === 'crear_requerimiento') {
          followups.unshift({ label: '📋 Crear requerimiento ahora', _quickCreate: 'requirement' });
        }
      }
      return res.json({ success: true, reply: faqMatch.response_text, intent: faqMatch.intent_key, followups });
    }

    // ── 2. KB directo (sin IA) ────────────────────────────────────────────────
    const KB_THRESHOLD = parseFloat(process.env.KB_DIRECT_THRESHOLD) || 0.4;
    let kbArticles = [];
    try { kbArticles = (await KnowledgeService.search(message, 5, null)) || []; } catch (_) {}

    if (kbArticles.length) {
      const qTokens = _words(_normText(message)).map(_canon);
      const scored  = kbArticles.map(a => {
        const titleWords = new Set(_words(_normText(a.title || '')).map(_canon));
        const bodyText   = (a.excerpt || String(a.content || '')).replace(/<[^>]+>/g, '').substring(0, 500);
        const bodyWords  = new Set(_words(_normText(bodyText)).map(_canon));
        const titleHits  = qTokens.filter(w => titleWords.has(w)).length / (qTokens.length || 1);
        const bodyHits   = qTokens.filter(w => bodyWords.has(w)).length / (qTokens.length || 1);
        return { a, score: titleHits * 1.5 + bodyHits * 0.5 };
      }).sort((x, y) => y.score - x.score);

      const top = scored[0];
      if (top.score >= KB_THRESHOLD) {
        const art     = top.a;
        const clean   = (art.excerpt || String(art.content || '')).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
        const snippet = clean.length > 360 ? clean.substring(0, 357) + '…' : clean;
        const proc    = /como|pasos|proceso|instalar|configurar|activar|habilitar/.test(_normText(message));
        const intro   = proc
          ? `Encontré una guía sobre **${art.title}**:`
          : `Según la Base de Conocimiento — **${art.title}**:`;
        const kbFups = [{ label: '📖 Ver Base de Conocimiento', next_key: null }];
        if (req.user) kbFups.push({ label: '🎫 Generar incidencia', _createTicket: true, _summary: message.substring(0, 200) });
        return res.json({
          success:  true,
          reply:    `${intro}\n\n${snippet}\n\n[Ver en Base de Conocimiento →](/knowledge-base)`,
          source:   'kb',
          kb_id:    art.id,
          followups: kbFups,
        });
      }
    }

    // Analytics: log queries que no resuelven FAQ ni KB
    dbQuery('INSERT INTO chatbot_analytics (user_email, message, resolved_by) VALUES (?,?,?)',
      [req.user?.email || null, message.substring(0, 500), GROQ_API_KEY ? 'groq' : 'none']).catch(() => {});

    // ── 3. Sin match en KB → Groq ─────────────────────────────────────────────
    if (!GROQ_API_KEY) {
      return res.json({ success: false, reply: 'No tengo información sobre eso. Por favor contacta al Service Desk o inicia una consulta con un especialista.' });
    }

    let kbContext = 'No se encontraron artículos específicos para esta consulta.';
    if (kbArticles.length) {
      kbContext = kbArticles.slice(0, 3).map(a =>
        `• **${a.title}**: ${(a.excerpt || String(a.content || '')).replace(/<[^>]+>/g, '').substring(0, 200)}...`
      ).join('\n');
    }

    const systemPrompt = PLATFORM_SYSTEM_PROMPT.replace('{KB_CONTEXT}', kbContext);
    const nodeFetch = (...a) => import('node-fetch').then(m => m.default(...a));
    const groqRes = await nodeFetch(GROQ_URL, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.slice(-10).map(m => ({ role: m.role, content: m.content })),
          { role: 'user', content: message }
        ],
        max_tokens:  600,
        temperature: 0.5,
      })
    });

    const groqData = await groqRes.json();
    if (!groqRes.ok) throw new Error(groqData.error?.message || 'Error Groq API');

    const reply = groqData.choices?.[0]?.message?.content?.trim() || 'No pude generar una respuesta.';
    const _isProblem = /no funciona|falla|error|problema|ca[ií]do|bloqueado|lento|da[ñn]ado|no puedo|no puede|no tengo|no abre|no responde|no arranca|se apag|pantalla|virus|crash/i.test(message);
    const groqFups = (_isProblem && req.user) ? [{ label: '🎫 Generar incidencia', _createTicket: true, _summary: message.substring(0, 200) }] : undefined;
    res.json({ success: true, reply, followups: groqFups });

  } catch (err) {
    console.error('[chatbot]', err.message);
    res.json({ success: false, reply: 'Error al procesar tu consulta. Intenta de nuevo.' });
  }
});

// ── POST /api/chatbot/analyze-image — OCR + contexto ─────────────────────────
router.post('/analyze-image', optionalAuth, _imgUpload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'No se recibió imagen' });
  const { path: filePath, filename } = req.file;

  try {
    // 1. OCR
    const { text, confidence } = await _runOCR(filePath);

    if (!text || confidence < 35) {
      return res.json({
        success:    false,
        imageToken: filename,
        confidence,
        error: 'No pude leer el texto de la imagen. Intenta con una imagen más nítida o describe el error manualmente.',
      });
    }

    // 2. Búsqueda paralela: KB + FAQ + tickets similares
    const qTokens = _words(_normText(text)).filter(w => w.length > 4).slice(0, 4);

    const [kbArticles, faqResult, similarTickets] = await Promise.all([
      KnowledgeService.search(text, 3, null).catch(() => []),
      _faqMatch(text).catch(() => null),
      (async () => {
        if (!qTokens.length) return [];
        const orClauses = qTokens.map(() => 'summary LIKE ?').join(' OR ');
        return dbQuery(
          `SELECT ticket_key, summary, internal_status FROM jira_tickets
           WHERE (${orClauses}) AND internal_status NOT IN ('cerrado','resuelto')
           ORDER BY created_at DESC LIMIT 3`,
          qTokens.map(kw => `%${kw}%`)
        ).catch(() => []);
      })(),
    ]);

    // 3. Detectar códigos de error conocidos
    const errorCodes = (text.match(/0x[0-9A-Fa-f]{4,8}|Error\s+\d{3,}|HTTP\s+[45]\d{2}|[A-Z][A-Z_]{3,}(?:\.sys|\.dll)/g) || []).slice(0, 3);

    return res.json({
      success:         true,
      text,
      confidence,
      imageToken:      filename,
      errorCodes,
      kb:              (kbArticles || []).slice(0, 2).map(a => ({ title: a.title, id: a.id })),
      faq:             (faqResult && !faqResult.ambiguous) ? { reply: faqResult.response_text, title: faqResult.title } : null,
      similar_tickets: (similarTickets || []).map(t => ({ key: t.ticket_key, summary: t.summary })),
    });

  } catch (err) {
    console.error('[chatbot/analyze-image]', err.message);
    fs.unlink(filePath, () => {});
    res.status(500).json({ success: false, error: 'Error al procesar la imagen. Intenta de nuevo.' });
  }
});

// ── GET /api/chatbot/image/:token — preview seguro ───────────────────────────
router.get('/image/:token', optionalAuth, (req, res) => {
  const token = req.params.token.replace(/[^a-zA-Z0-9._-]/g, '');
  if (!token || token.length < 8) return res.status(400).end();
  const fp = path.join(_chatbotUploadDir, token);
  if (fs.existsSync(fp)) return res.sendFile(fp);
  res.status(404).end();
});

// ── POST /api/chatbot/incident — Crear incidencia en Jira Service Desk ──────
router.post('/incident', authenticateToken, async (req, res) => {
  try {
    const { summary, priority = 'P3', outOfHours = false, imageToken } = req.body;
    if (!summary?.trim()) return res.status(400).json({ success: false, error: 'Descripción requerida' });

    const userEmail = req.user?.email || req.user?.username || '';
    const reporter  = req.user?.full_name || req.user?.username || userEmail || 'Usuario';
    const tenantId  = req.user?.tenant_id || null;
    const SLA_H     = { P1: 4, P2: 8, P3: 24, P4: 72 };
    const slaHours  = SLA_H[priority] || 24;

    // CMDB: enriquecer descripción con equipo asignado al usuario
    let _cmdbLine = '';
    try {
      const _assets = await dbQuery(`
        SELECT e.device_code, e.equipment_type, e.brand, e.model, e.operating_system
        FROM employees emp
        JOIN assignments a ON emp.id = a.employee_id
        JOIN equipment e   ON a.equipment_id = e.id
        WHERE emp.email = ? LIMIT 2
      `, [userEmail]);
      if (_assets.length) {
        _cmdbLine = '\n\nActivo(s): ' + _assets.map(a =>
          `${a.equipment_type || ''} ${a.brand || ''} ${a.model || ''}${a.device_code ? ' ('+a.device_code+')' : ''} — OS: ${a.operating_system || '—'}`
        ).join('; ');
      }
    } catch(_) {}

    // ── 1. Crear en Jira Service Desk (si token configurado o feature habilitado) ───
    const _ffJira = await FeatureFlagService.isEnabled(tenantId, 'jira').catch(() => false);
    const jiraEnabled = !!JIRA_TOKEN || _ffJira;
    let jiraKey = null;
    let jiraUrl = null;
    if (jiraEnabled) try {
      // Subir imagen adjunta como temporal si viene del chatbot con imagen
      let attachmentId = null;
      if (imageToken) {
        try {
          const safeToken = String(imageToken).replace(/[^a-zA-Z0-9._-]/g, '');
          const imgPath = path.join(_chatbotUploadDir, safeToken);
          if (fs.existsSync(imgPath)) {
            const ext  = path.extname(safeToken).toLowerCase();
            const mime = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[ext] || 'image/jpeg';
            const imgFd = new FormData();
            imgFd.append('file', fs.createReadStream(imgPath), { filename: safeToken, contentType: mime });
            const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
            const upR = await axios.post(
              `${JIRA_HOST}/rest/servicedeskapi/servicedesk/${SD_ID}/attachTemporaryFile`,
              imgFd,
              { headers: { ...imgFd.getHeaders(), Authorization: `Basic ${b64Auth}`, 'X-ExperimentalApi': 'opt-in', 'X-Atlassian-Token': 'no-check' }, timeout: 20000 }
            );
            attachmentId = upR.data?.temporaryAttachments?.[0]?.temporaryAttachmentId || null;
          }
        } catch (_imgErr) { console.warn('[chatbot/incident] image attach error:', _imgErr.message); }
      }

      const rfv = {
        summary:     summary.trim(),
        description: _adf(`Reporte via ARIA Chatbot\n\nUsuario: ${reporter} (${userEmail})\n\nProblema: ${summary.trim()}${_cmdbLine}`),
      };
      if (attachmentId) rfv.attachment = [attachmentId];

      const payload = { serviceDeskId: SD_ID, requestTypeId: RT_ID, requestFieldValues: rfv, raiseOnBehalfOf: userEmail || undefined };
      const jiraRes = await jira('POST', '/rest/servicedeskapi/request', payload);
      jiraKey = jiraRes?.issueKey || null;
      if (jiraKey) jiraUrl = `${JIRA_HOST}/browse/${jiraKey}`;
    } catch (jiraErr) {
      console.warn('[chatbot/incident] Jira API error:', jiraErr.message);
      // Si falla raiseOnBehalfOf, reintentar sin ese campo
      if (jiraErr.message?.includes('raiseOnBehalfOf') || jiraErr.response?.status === 403 || jiraErr.response?.status === 400) {
        try {
          const payload2 = {
            serviceDeskId: SD_ID, requestTypeId: RT_ID,
            requestFieldValues: {
              summary: summary.trim(),
              description: _adf(`Usuario: ${reporter} (${userEmail})\n\nProblema: ${summary.trim()}`),
            },
          };
          const r2 = await jira('POST', '/rest/servicedeskapi/request', payload2);
          jiraKey = r2?.issueKey || null;
          if (jiraKey) jiraUrl = `${JIRA_HOST}/browse/${jiraKey}`;
        } catch (e2) { console.error('[chatbot/incident] Jira retry failed:', e2.message); }
      }
    }

    // ── 2. Clave: INC-XXXX (Jira) o TK-XXXX (local) ─────────
    let key = jiraKey;
    if (!key) {
      try {
        const rows = await dbQuery(
          `SELECT COUNT(*) AS cnt FROM jira_tickets WHERE ticket_key LIKE 'TK-%'${tenantId ? ' AND tenant_id = ?' : ''}`,
          tenantId ? [tenantId] : []
        );
        key = `TK-${String((rows[0]?.cnt || 0) + 1).padStart(4, '0')}`;
      } catch (_) {
        key = `TK-${Date.now().toString().slice(-4)}`;
      }
    }

    const _initStatus = outOfHours ? 'pendiente' : 'abierto';

    await dbQuery(
      `INSERT INTO jira_tickets
         (ticket_key, summary, description, status, internal_status, priority, reporter, phone,
          sla_deadline, tenant_id, jira_url, created_at)
       VALUES (?, ?, ?, 'Abierto', ?, ?, ?, '-',
          DATE_ADD(NOW(), INTERVAL ? HOUR), ?, ?, NOW())
       ON DUPLICATE KEY UPDATE summary=VALUES(summary)`,
      [key, summary.trim(), summary.trim(), _initStatus, priority, userEmail || reporter, slaHours, tenantId, jiraUrl]
    ).catch(e => console.warn('[chatbot/incident] DB sync error:', e.message));

    await dbQuery(
      `INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle)
       VALUES (?,?,?,'creacion',?)`,
      [key, req.user?.id || 0, reporter, `Ticket ${key} creado desde ARIA Chatbot`]
    ).catch(() => {});

    if (outOfHours) {
      await dbQuery(
        `INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle)
         VALUES (?,0,'ARIA','comentario',?)`,
        [key, 'Incidencia generada fuera del horario de atención (Lun–Vie 8:00–18:00). Se encuentra en estado Pendiente y será atendida en el próximo turno laboral.']
      ).catch(() => {});
    }

    const io = req.app.get('io');
    if (io) io.to('jira:agents').emit('ticket:created', {
      key, summary: summary.trim(), priority, reporter: userEmail
    });

    res.json({ success: true, key, url: jiraUrl || '/home', isLocal: !jiraKey, outOfHours: !!outOfHours });
  } catch (e) {
    console.error('[chatbot/incident]', e.message);
    res.status(500).json({ success: false, error: 'Error al crear la incidencia' });
  }
});

// ── POST /api/chatbot/requirement — Crear requerimiento en Jira ──────────────
router.post('/requirement', authenticateToken, async (req, res) => {
  try {
    const { summary, priority = 'P3' } = req.body;
    if (!summary?.trim()) return res.status(400).json({ success: false, error: 'Descripción requerida' });

    const userEmail = req.user?.email || req.user?.username || '';
    const reporter  = req.user?.full_name || req.user?.username || userEmail || 'Usuario';
    const tenantId  = req.user?.tenant_id || null;
    const desc      = `Requerimiento vía ARIA Chatbot\n\nUsuario: ${reporter} (${userEmail})\n\nDetalle: ${summary.trim()}`;

    let jiraKey = null, jiraUrl = null;
    try {
      const payload = {
        serviceDeskId: SD_REQ_CHATBOT, requestTypeId: RT_REQ_CHATBOT,
        requestFieldValues: { summary: summary.trim(), description: _adf(desc) },
        raiseOnBehalfOf: userEmail || undefined,
      };
      const r = await jira('POST', '/rest/servicedeskapi/request', payload);
      jiraKey = r?.issueKey || null;
      if (jiraKey) jiraUrl = `${JIRA_HOST}/browse/${jiraKey}`;
    } catch (err) {
      console.warn('[chatbot/requirement] Jira error:', err.message);
      if (err.response?.status === 400 || err.response?.status === 403) {
        try {
          const r2 = await jira('POST', '/rest/servicedeskapi/request', {
            serviceDeskId: SD_REQ_CHATBOT, requestTypeId: RT_REQ_CHATBOT,
            requestFieldValues: { summary: summary.trim(), description: _adf(desc) },
          });
          jiraKey = r2?.issueKey || null;
          if (jiraKey) jiraUrl = `${JIRA_HOST}/browse/${jiraKey}`;
        } catch (e2) { console.error('[chatbot/requirement] retry failed:', e2.message); }
      }
    }

    let key = jiraKey;
    if (!key) {
      try {
        const rows = await dbQuery(
          `SELECT COUNT(*) AS cnt FROM jira_tickets WHERE ticket_key LIKE 'REQ-%'${tenantId ? ' AND tenant_id=?' : ''}`,
          tenantId ? [tenantId] : []
        );
        key = `REQ-${String((rows[0]?.cnt || 0) + 1).padStart(4, '0')}`;
      } catch (_) { key = `REQ-${Date.now().toString().slice(-4)}`; }
    }

    await dbQuery(
      `INSERT INTO jira_tickets
         (ticket_key, summary, description, status, internal_status, priority, reporter, phone,
          sla_deadline, tenant_id, jira_url, created_at)
       VALUES (?,?,?,'Abierto','abierto',?,?,'-',DATE_ADD(NOW(),INTERVAL 72 HOUR),?,?,NOW())
       ON DUPLICATE KEY UPDATE summary=VALUES(summary)`,
      [key, summary.trim(), desc, priority, userEmail || reporter, tenantId, jiraUrl]
    ).catch(e => console.warn('[chatbot/requirement] DB:', e.message));

    await dbQuery(
      `INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle) VALUES (?,?,?,'creacion',?)`,
      [key, req.user?.id || 0, reporter, `Requerimiento ${key} creado desde ARIA Chatbot`]
    ).catch(() => {});

    const io = req.app.get('io');
    if (io) io.to('jira:agents').emit('ticket:created', {
      key, summary: summary.trim(), priority, reporter: userEmail, type: 'requirement'
    });

    res.json({ success: true, key, url: jiraUrl || '/home', isLocal: !jiraKey });
  } catch (e) {
    console.error('[chatbot/requirement]', e.message);
    res.status(500).json({ success: false, error: 'Error al crear el requerimiento' });
  }
});

// ── GET /api/chatbot/tickets?q= — Buscar tickets del usuario ─────────────────
router.get('/tickets', authenticateToken, async (req, res) => {
  try {
    const q        = (req.query.q || '').trim();
    const reporter = req.user?.email || req.user?.username;
    const tenantId = req.user?.tenant_id || null;
    if (!reporter) return res.json({ success: false, error: 'Sin usuario autenticado', tickets: [] });

    const isEmailQ = q && /^[\w.+%-]+@[\w.-]+\.[a-z]{2,}$/i.test(q);
    const isKeyQ   = q && /^(TK-|IT-|INC-)\d+/i.test(q);

    let sql    = `SELECT ticket_key, summary, internal_status, priority, created_at, assigned_to_name, reporter, jira_url
                  FROM jira_tickets WHERE deleted_at IS NULL`;
    const params = [];

    if (isEmailQ) {
      // búsqueda por correo del reportero (sin restricción al usuario actual)
      sql += ' AND reporter = ?';
      params.push(q);
    } else if (isKeyQ) {
      // búsqueda por clave exacta (cualquier reportero)
      sql += ' AND ticket_key LIKE ?';
      params.push(`${q.toUpperCase()}%`);
    } else if (q) {
      // búsqueda por palabras clave — restringir al usuario actual
      sql += ' AND reporter = ? AND (summary LIKE ? OR description LIKE ?)';
      params.push(reporter, `%${q}%`, `%${q}%`);
    } else {
      // sin query: tickets del usuario actual
      sql += ' AND reporter = ?';
      params.push(reporter);
    }

    if (tenantId) { sql += ' AND tenant_id = ?'; params.push(tenantId); }
    sql += ' ORDER BY created_at DESC LIMIT 10';
    const tickets = await dbQuery(sql, params);
    res.json({ success: true, tickets: tickets || [] });
  } catch (e) {
    console.error('[chatbot/tickets]', e.message);
    res.status(500).json({ success: false, error: 'Error al buscar tickets', tickets: [] });
  }
});

// ── GET /api/chatbot/ticket/:key — Estado de ticket específico ───────────────
router.get('/ticket/:key', authenticateToken, async (req, res) => {
  try {
    const key      = req.params.key.replace(/[^A-Za-z0-9-]/g, '').toUpperCase();
    const reporter = req.user?.email || req.user?.username;
    const rows     = await dbQuery(
      `SELECT ticket_key, summary, internal_status, priority, created_at, assigned_to_name, jira_url
       FROM jira_tickets WHERE ticket_key = ? AND reporter = ? AND deleted_at IS NULL`,
      [key, reporter]
    );
    if (!rows.length) return res.json({ success: false });
    res.json({ success: true, ticket: rows[0] });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// ── GET /api/chatbot/suggest?q= — Autocompletado FAQ ─────────────────────────
router.get('/suggest', optionalAuth, async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 3) return res.json({ suggestions: [] });
    await _ensureFaqTables();
    await _loadSynonyms();
    const qWords = new Set(_words(_normText(q)).map(_canon));
    if (!qWords.size) return res.json({ suggestions: [] });
    const rows = await dbQuery(`
      SELECT DISTINCT i.intent_key, i.title, t.phrase
      FROM faq_intents i JOIN faq_triggers t ON t.intent_id = i.id
      WHERE i.active = 1
    `);
    const best = {};
    for (const row of rows) {
      const tw = _words(_normText(row.phrase)).map(_canon);
      if (!tw.length) continue;
      const score = tw.filter(w => qWords.has(w)).length / tw.length;
      if (score >= 0.3 && (!best[row.intent_key] || score > best[row.intent_key].score)) {
        best[row.intent_key] = { title: row.title, key: row.intent_key, score };
      }
    }
    const suggestions = Object.values(best).sort((a, b) => b.score - a.score).slice(0, 3);
    res.json({ suggestions });
  } catch(e) { res.json({ suggestions: [] }); }
});

// ── GET /api/chatbot/notifications — Actualizaciones recientes de tickets ─────
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const reporter = req.user?.email || req.user?.username;
    const since    = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 24 * 3600 * 1000);
    const rows     = await dbQuery(`
      SELECT ticket_key, summary, internal_status, assigned_to_name, updated_at
      FROM jira_tickets
      WHERE reporter = ? AND updated_at > ? AND deleted_at IS NULL
      ORDER BY updated_at DESC LIMIT 5
    `, [reporter, since]);
    const lbl = { abierto:'Abierto', asignado:'Asignado', en_progreso:'En progreso', resuelto:'Resuelto', cerrado:'Cerrado', pendiente:'Pendiente' };
    res.json({
      success: true,
      updates: (rows || []).map(t => ({
        key:          t.ticket_key,
        summary:      (t.summary || '').substring(0, 60),
        status:       t.internal_status,
        status_label: lbl[t.internal_status] || t.internal_status || 'Abierto',
        assigned_to:  t.assigned_to_name || null,
        updated_at:   t.updated_at,
      }))
    });
  } catch(e) { res.status(500).json({ success: false, updates: [] }); }
});

// ── GET /api/chatbot/my-assets — Equipos CMDB del usuario ────────────────────
router.get('/my-assets', authenticateToken, async (req, res) => {
  try {
    const email = req.user?.email || req.user?.username;
    const rows  = await dbQuery(`
      SELECT
        e.device_code, e.equipment_type, e.brand, e.model,
        e.serial_number, e.processor, e.operating_system,
        e.disk_capacity, e.ram_memory, e.domain, e.status,
        e.acquisition_type, e.warranty_months, e.obsolescence_years,
        emp.full_name   AS emp_name,
        emp.email       AS emp_email,
        emp.position_name,
        emp.legal_entity,
        emp.branch_office_id,
        emp.supervisor_name,
        emp.category    AS emp_category,
        a.assignment_date, a.return_date,
        a.notes         AS assign_notes,
        a.relation_type,
        a.status        AS assign_status
      FROM employees emp
      JOIN assignments a  ON emp.id = a.employee_id  AND a.deleted_at IS NULL
      JOIN equipment   e  ON a.equipment_id = e.id   AND e.deleted_at IS NULL
      WHERE emp.email = ?
        AND emp.deleted_at IS NULL
        AND a.status = 'Activo'
      ORDER BY a.assignment_date DESC
      LIMIT 5
    `, [email]);
    res.json({ success: true, assets: rows || [] });
  } catch(e) { res.json({ success: true, assets: [] }); }
});

// ── POST /api/chatbot/csat — Valoración de incidencia ─────────────────────────
router.post('/csat', authenticateToken, async (req, res) => {
  try {
    const { ticketKey, rating } = req.body;
    if (!ticketKey || !rating) return res.status(400).json({ success: false });
    const r = Math.min(5, Math.max(1, parseInt(rating) || 1));
    await dbQuery(
      `INSERT INTO ticket_history (ticket_id, user_id, user_name, evento, detalle)
       VALUES (?, ?, ?, 'csat', ?)`,
      [ticketKey, req.user?.id || 0, req.user?.full_name || req.user?.email || 'Usuario', `CSAT: ${r}/5 ⭐`]
    ).catch(() => {});
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false });
  }
});

// ── Consultas en vivo con especialista ──────────────────────────────────────
let _ccTablesReady = false;
async function _ensureCCTables() {
  if (_ccTablesReady) return;
  await dbQuery(`CREATE TABLE IF NOT EXISTS chat_consultations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_token VARCHAR(64) NOT NULL UNIQUE,
    user_email VARCHAR(255) NOT NULL,
    user_name VARCHAR(255),
    tenant_id INT NULL,
    topic TEXT,
    status ENUM('waiting','active','resolved','converted') DEFAULT 'waiting',
    specialist_id INT NULL,
    specialist_name VARCHAR(255) NULL,
    specialist_email VARCHAR(255) NULL,
    ticket_key VARCHAR(50) NULL,
    satisfaction_rating TINYINT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
  await dbQuery(`ALTER TABLE chat_consultations ADD COLUMN IF NOT EXISTS satisfaction_rating TINYINT NULL`).catch(() => {});
  await dbQuery(`CREATE TABLE IF NOT EXISTS chat_consultation_messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    consultation_id INT NOT NULL,
    sender_role ENUM('user','specialist','system') NOT NULL,
    sender_name VARCHAR(255),
    message TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_c (consultation_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`).catch(() => {});
  _ccTablesReady = true;
}

router.post('/consult', authenticateToken, async (req, res) => {
  try {
    await _ensureCCTables();
    const { topic, userEmail: bodyEmail, userName: bodyName } = req.body;
    if (!topic?.trim()) return res.status(400).json({ success: false, error: 'Describe tu consulta' });
    const token     = require('crypto').randomBytes(20).toString('hex');
    const userName  = bodyName  || req.user?.full_name || req.user?.username || req.user?.email;
    const userEmail = bodyEmail || req.user?.email || req.user?.username;
    const tenantId  = req.user?.tenant_id || null;
    await dbQuery(
      `INSERT INTO chat_consultations (session_token, user_email, user_name, tenant_id, topic, status) VALUES (?,?,?,?,?,'waiting')`,
      [token, userEmail, userName, tenantId, topic.trim()]);
    // Obtener el ID insertado (Sequelize RAW no expone insertId directamente)
    const idRows    = await dbQuery(`SELECT LAST_INSERT_ID() AS id`);
    const consultId = Number(idRows?.[0]?.id || idRows?.[0]?.['LAST_INSERT_ID()'] || 0);
    if (!consultId) throw new Error('No se obtuvo ID de la consulta creada');
    await dbQuery(
      `INSERT INTO chat_consultation_messages (consultation_id, sender_role, sender_name, message) VALUES (?,?,?,?)`,
      [consultId, 'system', 'ARIA', 'Consulta iniciada. Un especialista se conectará en breve.']);
    const io = req.app.get('io');
    if (io) io.to('jira:agents').emit('consult:new', {
      id: consultId, token, userName, userEmail, topic: topic.trim(), tenantId, createdAt: new Date().toISOString()
    });
    res.json({ success: true, id: consultId, token });
  } catch (e) {
    console.error('[chatbot/consult]', e.message);
    res.status(500).json({ success: false, error: 'Error al crear consulta' });
  }
});

router.get('/consult/:id/messages', authenticateToken, async (req, res) => {
  try {
    await _ensureCCTables();
    const since = parseInt(req.query.since) || 0;
    const rows = await dbQuery(
      `SELECT id, status, specialist_name, ticket_key, user_name, user_email FROM chat_consultations WHERE id=? LIMIT 1`, [req.params.id]);
    if (!rows?.length) return res.status(404).json({ success: false });
    // Permitir acceso al dueño de la consulta o a especialistas/admins
    const userRole  = req.user?.role || 'usuario';
    const userEmail = req.user?.email || req.user?.username;
    const isSpec    = ['administrador','especialista','agente','tecnico','superadmin'].includes(userRole);
    if (!isSpec && rows[0].user_email !== userEmail) return res.status(403).json({ success: false });
    const messages = await dbQuery(
      `SELECT id, sender_role, sender_name, message, created_at FROM chat_consultation_messages
       WHERE consultation_id=? AND id>? ORDER BY id ASC LIMIT 30`, [req.params.id, since]);
    res.json({ success: true, session: rows[0], messages: messages || [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/consult/:id/message', authenticateToken, async (req, res) => {
  try {
    await _ensureCCTables();
    const { message, role = 'user' } = req.body;
    if (!message?.trim()) return res.status(400).json({ success: false });
    const senderName = req.user?.full_name || req.user?.username || req.user?.email;
    const result = await dbQuery(
      `INSERT INTO chat_consultation_messages (consultation_id, sender_role, sender_name, message) VALUES (?,?,?,?)`,
      [req.params.id, role, senderName, message.trim()]);
    const msgId = result?.insertId || 0;
    const io = req.app.get('io');
    if (io) io.to('jira:agents').emit('consult:message', {
      consultId: parseInt(req.params.id), role, senderName, message: message.trim(), msgId, ts: new Date().toISOString()
    });
    res.json({ success: true, id: msgId });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/consult/:id/take', authenticateToken, async (req, res) => {
  try {
    await _ensureCCTables();
    const specName  = req.user?.full_name || req.user?.username;
    const specEmail = req.user?.email;
    const specId    = req.user?.id;
    await dbQuery(
      `UPDATE chat_consultations SET status='active', specialist_id=?, specialist_name=?, specialist_email=?, updated_at=NOW()
       WHERE id=? AND status='waiting'`, [specId, specName, specEmail, req.params.id]);
    await dbQuery(
      `INSERT INTO chat_consultation_messages (consultation_id, sender_role, sender_name, message) VALUES (?,?,?,?)`,
      [req.params.id, 'system', 'Sistema', `${specName} se unió a la consulta.`]);
    const io = req.app.get('io');
    if (io) io.to('jira:agents').emit('consult:taken', { consultId: parseInt(req.params.id), specialistName: specName });
    res.json({ success: true, specName });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /consults/admin-history — historial completo para administradores/especialistas
router.get('/consults/admin-history', authenticateToken, async (req, res) => {
  try {
    await _ensureCCTables();
    const role = req.user?.role || 'usuario';
    const allowed = ['administrador','especialista','agente','tecnico','superadmin'];
    if (!allowed.includes(role)) return res.status(403).json({ success: false });
    const page    = Math.max(1, parseInt(req.query.page)  || 1);
    const limit   = Math.min(50, parseInt(req.query.limit) || 10);
    const offset  = (page - 1) * limit;
    const search  = req.query.q ? `%${req.query.q}%` : null;
    const status  = req.query.status || null;
    const tenantId = req.user?.tenant_id || null;

    let where = tenantId ? 'WHERE (tenant_id=? OR tenant_id IS NULL)' : 'WHERE 1=1';
    const params = tenantId ? [tenantId] : [];
    if (status)  { where += ' AND status=?'; params.push(status); }
    if (search)  { where += ' AND (user_email LIKE ? OR user_name LIKE ? OR topic LIKE ?)'; params.push(search, search, search); }

    const rows = await dbQuery(
      `SELECT id, user_email, user_name, topic, status, specialist_name, ticket_key, satisfaction_rating, created_at, updated_at
       FROM chat_consultations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const [{ total }] = await dbQuery(
      `SELECT COUNT(*) AS total FROM chat_consultations ${where}`, params
    );
    res.json({ success: true, data: rows, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /consults/history — historial de consultas del usuario autenticado
router.get('/consults/history', authenticateToken, async (req, res) => {
  try {
    await _ensureCCTables();
    const jwtEmail = req.user?.email || req.user?.username;
    if (!jwtEmail) return res.status(400).json({ success: false });

    // Si el frontend pasa ?as_email=X (portal override), solo lo permite admin/superadmin
    const requestedEmail = (req.query.as_email || '').toLowerCase().trim();
    let email = jwtEmail;
    if (requestedEmail && requestedEmail !== jwtEmail.toLowerCase()) {
      const role = (req.user?.role || '').toLowerCase();
      if (!['admin','superadmin'].includes(role)) {
        return res.status(403).json({ success: false, error: 'Sin permisos para ver consultas de otro usuario' });
      }
      email = requestedEmail;
    }

    const page   = Math.max(1, parseInt(req.query.page)  || 1);
    const limit  = Math.min(50, parseInt(req.query.limit) || 10);
    const offset = (page - 1) * limit;

    const rows = await dbQuery(
      `SELECT id, topic, status, specialist_name, ticket_key, satisfaction_rating, created_at, updated_at
       FROM chat_consultations
       WHERE user_email=?
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [email, limit, offset]
    );
    const [{ total }] = await dbQuery(
      `SELECT COUNT(*) AS total FROM chat_consultations WHERE user_email=?`, [email]
    );
    res.json({ success: true, data: rows, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch(e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/consults/active', authenticateToken, async (req, res) => {
  try {
    await _ensureCCTables();
    const tenantId = req.user?.tenant_id || null;
    const specId   = req.user?.id;
    const waiting  = tenantId
      ? await dbQuery(
          `SELECT id, user_email, user_name, topic, created_at FROM chat_consultations
           WHERE status='waiting' AND (tenant_id=? OR tenant_id IS NULL)
             AND created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
           ORDER BY created_at DESC LIMIT 10`,
          [tenantId]
        )
      : await dbQuery(
          `SELECT id, user_email, user_name, topic, created_at FROM chat_consultations
           WHERE status='waiting'
             AND created_at >= DATE_SUB(NOW(), INTERVAL 2 HOUR)
           ORDER BY created_at DESC LIMIT 10`
        );
    const activeRows = specId ? await dbQuery(
      `SELECT id, user_email, user_name, topic FROM chat_consultations
       WHERE status='active' AND specialist_id=? ORDER BY updated_at DESC LIMIT 1`,
      [specId]
    ) : [];
    res.json({ success: true, waiting: waiting || [], active: activeRows?.[0] || null });
  } catch (e) { res.status(500).json({ success: false }); }
});

router.post('/consult/:id/resolve', authenticateToken, async (req, res) => {
  try {
    await _ensureCCTables();
    const { createTicket = false, assigneeEmail: bodyAssignee = '' } = req.body;
    const rows = await dbQuery(`SELECT * FROM chat_consultations WHERE id=? LIMIT 1`, [req.params.id]);
    if (!rows?.length) return res.status(404).json({ success: false });
    const session = rows[0];
    let ticketKey    = null;
    let jiraUrl      = null;
    let jiraErrMsg   = null;
    let assigneeName = null;
    if (createTicket) {
      const specName  = req.user?.full_name || req.user?.username;
      const specEmail = bodyAssignee || req.user?.email;
      const reporter  = session.user_email;
      const summary   = `Consulta en línea — ${reporter}`.slice(0, 200);
      const desc      = `Consulta en línea derivada a incidencia.\nUsuario: ${reporter}\nEspecialista: ${specName} (${specEmail})\n\nDetalle: ${session.topic}`;

      // ── 1. Crear via servicedeskapi/request (mismo flujo que portal → activa automación N2) ──
      // Subir adjunto placeholder (requerido por RT_ID=213)
      let attachmentId = null;
      try {
        const placeholder = Buffer.from(`Consulta chatbot\nUsuario: ${reporter}\n${session.topic}`);
        const fd = new FormData();
        fd.append('file', placeholder, { filename: 'consulta-chatbot.txt', contentType: 'text/plain' });
        const b64Auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_TOKEN}`).toString('base64');
        const upR = await axios.post(
          `${JIRA_HOST}/rest/servicedeskapi/servicedesk/${SD_ID}/attachTemporaryFile`, fd,
          { headers: { ...fd.getHeaders(), 'Authorization': `Basic ${b64Auth}`, 'X-ExperimentalApi': 'opt-in', 'X-Atlassian-Token': 'no-check' }, timeout: 15000 }
        );
        attachmentId = upR.data?.temporaryAttachments?.[0]?.temporaryAttachmentId || null;
      } catch (_) {}

      const rfv = {
        summary, description: desc,
        customfield_14687: [{ id: 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11277' }], // Workplace
        customfield_13274: [{ id: 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11280' }], // Equipo Corporativo
        customfield_13283: [{ id: 'ae0390c7-daf0-4efd-8181-99c3b55f1d1c:11538' }], // Tipología por defecto
        customfield_10246: { id: '618437' }, // Impacto: 1-5 usuarios
        customfield_13269: { id: '618441' }, // Urgencia: El error no me impide trabajar
        customfield_11795: session.phone || '-',
      };
      if (attachmentId) rfv.attachment = [attachmentId];

      const sdPayload = { serviceDeskId: SD_ID, requestTypeId: RT_ID, requestFieldValues: rfv };
      try {
        // Intentar con raiseOnBehalfOf (reporter como solicitante)
        try {
          const r1 = await jira('POST', '/rest/servicedeskapi/request', { ...sdPayload, raiseOnBehalfOf: reporter });
          ticketKey = r1?.issueKey || null;
        } catch (e1) {
          if (e1.response?.status === 400 || e1.response?.status === 401) {
            const r2 = await jira('POST', '/rest/servicedeskapi/request', sdPayload);
            ticketKey = r2?.issueKey || null;
          } else throw e1;
        }
        console.log(`[chatbot/resolve] servicedeskapi → ${ticketKey} (automación N2 se activará en ~5s)`);
      } catch (sdErr) {
        jiraErrMsg = sdErr.message;
        console.error('[chatbot/resolve] servicedeskapi error:', sdErr.response?.status, JSON.stringify(sdErr.response?.data)?.slice(0, 300));
      }

      // ── 2. Asignar al especialista (el agente logueado que tomó la consulta) ──
      if (ticketKey) {
        jiraUrl = `${JIRA_HOST}/browse/${ticketKey}`;
        assigneeName = specName || specEmail;
        // Esperar a que la automatización de Jira (N2) complete antes de asignar
        await new Promise(r => setTimeout(r, 5000));
        // Resolver accountId del agente: primero su email de plataforma, fallback a JIRA_EMAIL (siempre en caché)
        try {
          let agentAccountId = null;
          const agentCache = await resolveJiraAccountId(specEmail);
          if (agentCache?.accountId) {
            try {
              await jira('PUT', `/rest/api/3/issue/${ticketKey}/assignee`, { accountId: agentCache.accountId });
              if (agentCache.displayName) assigneeName = agentCache.displayName;
              agentAccountId = agentCache.accountId;
            } catch (_) {}
          }
          if (!agentAccountId) {
            const svc = await resolveJiraAccountId(JIRA_EMAIL);
            if (svc?.accountId) {
              await jira('PUT', `/rest/api/3/issue/${ticketKey}/assignee`, { accountId: svc.accountId });
              agentAccountId = svc.accountId;
            }
          }
        } catch (_) {}

        // ── 3. Sync BD local (completo, igual que portal) ──
        const dbTech = await dbQuery(`SELECT id, full_name FROM users WHERE email=? AND deleted_at IS NULL LIMIT 1`, [specEmail]).catch(() => []);
        const dbAgent = dbTech[0] || null;
        await dbQuery(
          `INSERT INTO jira_tickets
             (ticket_key, summary, description, status, internal_status, priority, reporter, phone,
              component, assigned_to, assigned_to_name, assigned_at, first_response_at,
              sla_deadline, jira_url, created_at)
           VALUES (?,?,?,'Abierto','asignado','P3',?,?,?,?,?,NOW(),NOW(),DATE_ADD(NOW(),INTERVAL 24 HOUR),?,NOW())
           ON DUPLICATE KEY UPDATE summary=VALUES(summary), reporter=VALUES(reporter),
             assigned_to=VALUES(assigned_to), assigned_to_name=VALUES(assigned_to_name)`,
          [ticketKey, summary, session.topic, reporter, session.phone || '-',
           'General', dbAgent?.id || null, dbAgent?.full_name || specName || specEmail,
           jiraUrl]
        ).catch(e => console.error('[chatbot/resolve] DB insert error:', e.message));

        const io2 = req.app.get('io');
        if (io2) io2.to('jira:agents').emit('ticket:created', {
          key: ticketKey, summary: summary.slice(0, 80), priority: 'P3', reporter, fromChatbot: true
        });
      }
    }
    await dbQuery(
      `UPDATE chat_consultations SET status=?, ticket_key=?, updated_at=NOW() WHERE id=?`,
      [createTicket ? 'converted' : 'resolved', ticketKey, req.params.id]);
    await dbQuery(
      `INSERT INTO chat_consultation_messages (consultation_id, sender_role, sender_name, message) VALUES (?,?,?,?)`,
      [req.params.id, 'system', 'Sistema',
       ticketKey ? `Consulta resuelta. Ticket ${ticketKey} creado y asignado a ${assigneeName || 'especialista'}.` : 'Consulta cerrada. ¡Gracias por contactarnos!']);
    const io = req.app.get('io');
    if (io) io.to('jira:agents').emit('consult:resolved', { consultId: parseInt(req.params.id), ticketKey });
    res.json({ success: true, ticketKey, jiraUrl,
      summary: ticketKey ? `Consulta en línea — ${session.user_email}` : null,
      reporter: session.user_email,
      assigneeName,
      jiraError: ticketKey ? null : (jiraErrMsg || null) });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/consult/:id/rate', authenticateToken, async (req, res) => {
  try {
    await _ensureCCTables();
    const { rating } = req.body;
    if (!rating || rating < 1 || rating > 5) return res.status(400).json({ success: false });
    await dbQuery(`UPDATE chat_consultations SET satisfaction_rating=?, updated_at=NOW() WHERE id=?`, [rating, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── GET /api/chatbot/faq/followups/:key — sugerencias para el frontend ────────
router.get('/faq/followups/:key', async (req, res) => {
  try {
    await _ensureFaqTables();
    const rows = await dbQuery(
      `SELECT f.label, f.next_intent_key
       FROM faq_followups f
       JOIN faq_intents i ON i.id = f.intent_id
       WHERE i.intent_key = ? AND i.active = 1
       ORDER BY f.sort_order`,
      [req.params.key]
    );
    res.json({ success: true, followups: rows || [] });
  } catch (e) { res.status(500).json({ success: false, followups: [] }); }
});

// ── GET /api/chatbot/faq — lista de intents para admin panel ─────────────────
router.get('/faq', authenticateToken, async (req, res) => {
  try {
    await _ensureFaqTables();
    const role = req.user?.role || '';
    if (!['administrador','superadmin'].includes(role)) return res.status(403).json({ success: false });
    const intents = await dbQuery(
      `SELECT i.id, i.intent_key, i.category, i.title, i.response_type, i.escalate_auto, i.active, i.sort_order,
              COUNT(t.id) AS trigger_count
       FROM faq_intents i LEFT JOIN faq_triggers t ON t.intent_id = i.id
       GROUP BY i.id ORDER BY i.sort_order, i.category`
    );
    res.json({ success: true, intents: intents || [] });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ── PATCH /api/chatbot/faq/:id — actualizar respuesta desde admin panel ───────
router.patch('/faq/:id', authenticateToken, async (req, res) => {
  try {
    await _ensureFaqTables();
    const role = req.user?.role || '';
    if (!['administrador','superadmin'].includes(role)) return res.status(403).json({ success: false });
    const { response_text, active } = req.body;
    if (response_text !== undefined) {
      await dbQuery('UPDATE faq_intents SET response_text=?, updated_at=NOW() WHERE id=?', [response_text, req.params.id]);
    }
    if (active !== undefined) {
      await dbQuery('UPDATE faq_intents SET active=?, updated_at=NOW() WHERE id=?', [active ? 1 : 0, req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
