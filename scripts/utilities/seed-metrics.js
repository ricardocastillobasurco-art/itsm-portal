#!/usr/bin/env node
/**
 * seed-metrics.js — Genera tráfico HTTP real para poblar Prometheus/Grafana
 * Uso: node scripts/utilities/seed-metrics.js [rondas]
 * Requiere que el servidor esté corriendo en localhost:3000
 */
'use strict';

require('dotenv').config();
const http = require('http');

const PORT   = parseInt(process.env.PORT || '3000', 10);
const ROUNDS = parseInt(process.argv[2] || '5', 10);

let cookieJar = '';

// ── HTTP helper con cookie jar ───────────────────────────────────────────────

function req(method, path, body = null) {
  return new Promise((resolve) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'localhost',
      port:     PORT,
      path,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        ...(cookieJar   ? { Cookie: cookieJar } : {}),
        ...(payload     ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const r = http.request(opts, (res) => {
      // Capturar cookies de Set-Cookie
      const sc = res.headers['set-cookie'];
      if (sc) cookieJar = sc.map(c => c.split(';')[0]).join('; ');

      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(data); } catch { parsed = {}; }
        resolve({ status: res.statusCode, body: parsed, location: res.headers.location });
      });
    });
    r.on('error', () => resolve({ status: 0, body: {} }));
    if (payload) r.write(payload);
    r.end();
  });
}

const get  = (path)       => req('GET',  path);
const post = (path, body) => req('POST', path, body);

// ── Login con cookie ─────────────────────────────────────────────────────────

async function login() {
  const res = await post('/api/auth/login', { username: 'admin', password: 'Admin123!' });
  if (res.status === 200 && cookieJar) {
    console.log('✅ Sesión iniciada (cookie auth)');
    return true;
  }
  console.log(`⚠️  Login devolvió ${res.status} — generando solo tráfico anónimo`);
  return false;
}

// ── Tickets de demo ──────────────────────────────────────────────────────────

const TICKETS = [
  { titulo: 'Impresora HP sin papel en piso 3',          tipo: 'incidente',  priority: 'P4' },
  { titulo: 'Sin acceso a VPN desde casa',               tipo: 'incidente',  priority: 'P2', descripcion: 'Error: Authentication failed al conectar FortiClient.' },
  { titulo: 'Solicitud laptop para nuevo desarrollador', tipo: 'solicitud',  priority: 'P4' },
  { titulo: 'Outlook no sincroniza bandeja de entrada',  tipo: 'incidente',  priority: 'P3', descripcion: 'Outlook se congela al abrir adjuntos de más de 5MB.' },
  { titulo: 'Acceso SharePoint proyecto Alpha',          tipo: 'solicitud',  priority: 'P4' },
  { titulo: 'Servidor de archivos caído',                tipo: 'incidente',  priority: 'P1', descripcion: '¡URGENTE! \\\\FILESERVER01 no responde. 40 usuarios afectados.' },
  { titulo: 'PC lenta al arrancar Windows',              tipo: 'incidente',  priority: 'P3', descripcion: 'Tarda 8+ minutos en llegar al escritorio después de Windows Hello.' },
  { titulo: 'Error 403 en sistema de nómina',            tipo: 'incidente',  priority: 'P2', descripcion: 'Todo el departamento de RRHH sin acceso al sistema de nómina.' },
  { titulo: 'Instalación Adobe Acrobat Pro',             tipo: 'solicitud',  priority: 'P4' },
  { titulo: 'WiFi corporativo no conecta en sala 2B',    tipo: 'incidente',  priority: 'P3' },
];

// ── Endpoints para tráfico ───────────────────────────────────────────────────

const READ_ENDPOINTS = [
  '/health',
  '/health/live',
  '/health/ready',
  '/api/features',
  '/api/ai/status',
  '/api/modules',
  '/api/itsm/tickets',
  '/api/itsm/tickets/kpis',
  '/api/itsm/tickets/categories',
  '/api/changes',
  '/api/service-requests',
  '/api/cmdb',
  '/api/kb',
  '/api/kb/popular',
  '/api/kb/categories',
  '/api/dashboard/stats',
  '/api/employees',
  // 404s intencionales para métricas de error
  '/api/tickets/uuid-inexistente-404',
  '/api/changes/uuid-inexistente-404',
];

// ── Main ─────────────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n🚀 seed-metrics — ${ROUNDS} rondas contra localhost:${PORT}\n`);

  const loggedIn = await login();
  let   totalHits = 0, totalTickets = 0;

  for (let round = 1; round <= ROUNDS; round++) {
    process.stdout.write(`\n── Ronda ${round}/${ROUNDS} — GET endpoints: `);

    for (const path of READ_ENDPOINTS) {
      const r = await get(path);
      process.stdout.write(`${r.status} `);
      totalHits++;
    }

    if (loggedIn) {
      process.stdout.write('\n              POST tickets:  ');
      for (const body of TICKETS) {
        const r = await post('/api/itsm/tickets', { ...body, descripcion: body.descripcion || 'Descripción de prueba generada por seed-metrics.' });
        process.stdout.write(`${r.status} `);
        if (r.status === 200 || r.status === 201) totalTickets++;
        totalHits++;
      }

      // Clasificación IA (opcional, requiere GROQ_API_KEY)
      if (process.env.GROQ_API_KEY) {
        const ai = await post('/api/ai/classify', { titulo: 'PC lenta al iniciar', descripcion: 'La PC tarda 8 minutos en arrancar Windows 11.' });
        if (ai.body?.data) {
          console.log(`\n              🤖 IA: tipo=${ai.body.data.tipo} priority=${ai.body.data.priority}`);
        }
      }
    }
    console.log();

    if (round < ROUNDS) await new Promise(r => setTimeout(r, 800));
  }

  console.log(`\n${'─'.repeat(55)}`);
  console.log(`✅ ${totalHits} requests HTTP generados`);
  console.log(`🎫 ${totalTickets} tickets creados en BD`);
  console.log(`\n📊 Prometheus: http://localhost:9090`);
  console.log(`   → Query: itsm_http_requests_total`);
  console.log(`   → Query: itsm_tickets_created_total`);
  console.log(`\n📈 Grafana: http://localhost:3001`);
  console.log(`   → Dashboard: "ITSM Platform — Overview"\n`);
}

run().catch(e => { console.error('Error:', e.message); process.exit(1); });
