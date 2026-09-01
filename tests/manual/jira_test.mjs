// ============================================================
//  jira_test.mjs  —  Valida: buscar · reasignar · cerrar
//  Uso: node jira_test.mjs
// ============================================================

// ── 1. CONFIGURA TUS CREDENCIALES ────────────────────────────
const JIRA_URL   = "https://integratelperu.atlassian.net";   // sin slash final
const EMAIL      = "rabasurco@stefanini.com";                  // tu email de Jira
const API_TOKEN  = "ATATT3xFfGF0CsD4zpePO9DVK3IF6xZBXLfUDc17x2roDm1NA6MSWGuMipHsSDgZqNt8X3abWX8fwa-xfb6_8vRlMvctBwEokPT9yDxH9fqxj1NAfzxcIMOw3ox0Syf42jraYvVxdU_Uum-fWICgYX78euayee4_s_34Cff_5TY46rFTXC5H2ZM=C8DC8440";                      // https://id.atlassian.com/manage-profile/security/api-tokens
const ASSIGNEE_EMAIL = "rabasurco@stefanini.com";            // a quien reasignar

// ── Ticket a usar en las pruebas ─────────────────────────────
// Puedes pasarlo como argumento:  node jira_test.mjs INC-12345
// O hardcodearlo aquí:
const ISSUE_KEY = process.argv[2] || "INC-XXXXX";

// ── 2. HELPERS ───────────────────────────────────────────────
const AUTH    = Buffer.from(`${EMAIL}:${API_TOKEN}`).toString("base64");
const HEADERS = {
  "Authorization": `Basic ${AUTH}`,
  "Content-Type":  "application/json",
  "Accept":        "application/json",
};

async function jira(method, path, body) {
  const res = await fetch(`${JIRA_URL}/rest/api/3${path}`, {
    method,
    headers: HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }

  if (!res.ok) {
    console.error(`\n  ✗ HTTP ${res.status} en ${method} ${path}`);
    console.error("  Detalle:", JSON.stringify(json, null, 2));
    throw new Error(`HTTP ${res.status}`);
  }
  return json;
}

function adf(text) {
  return {
    type: "doc", version: 1,
    content: [{
      type: "paragraph",
      content: [{ type: "text", text }],
    }],
  };
}

function sep(label) {
  console.log(`\n${"─".repeat(55)}`);
  console.log(`  ${label}`);
  console.log("─".repeat(55));
}

// ── 3. FLUJO 1 — BUSCAR ──────────────────────────────────────
async function buscarTicket(key) {
  sep(`FLUJO 1 · Buscar ticket: ${key}`);

  const data = await jira("GET", `/issue/${key}?fields=summary,status,assignee,priority,created,reporter`);

  console.log("  ✓ Ticket encontrado");
  console.log(`    Key       : ${data.key}`);
  console.log(`    Resumen   : ${data.fields.summary}`);
  console.log(`    Estado    : ${data.fields.status?.name}`);
  console.log(`    Prioridad : ${data.fields.priority?.name ?? "—"}`);
  console.log(`    Assignee  : ${data.fields.assignee?.emailAddress ?? "Sin asignar"}`);
  console.log(`    Reporter  : ${data.fields.reporter?.emailAddress ?? "—"}`);
  console.log(`    Creado    : ${new Date(data.fields.created).toLocaleString("es-PE")}`);

  return data;
}

// ── Buscar por JQL (reporter o assignee) ─────────────────────
async function buscarPorCorreo(email) {
  sep(`FLUJO 1b · Buscar por correo: ${email}`);

  const jql = `project = INC AND reporter = "${email}" ORDER BY created DESC`;
  const data = await jira("GET", `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=5&fields=summary,status,assignee`);

  console.log(`  ✓ Total encontrados: ${data.total}`);
  (data.issues || []).forEach(i => {
    console.log(`    ${i.key}  [${i.fields.status?.name}]  ${i.fields.summary?.slice(0, 60)}`);
  });

  return data;
}

// ── 4. FLUJO 2 — REASIGNAR ───────────────────────────────────
async function reasignar(key, email) {
  sep(`FLUJO 2 · Reasignar ${key} → ${email}`);

  // 4a. Obtener accountId del usuario
  const users = await jira("GET", `/user/search?query=${encodeURIComponent(email)}`);
  if (!users.length) throw new Error(`Usuario no encontrado: ${email}`);

  const { accountId, displayName } = users[0];
  console.log(`  ✓ Usuario encontrado: ${displayName} (${accountId})`);

  // 4b. Asignar
  await jira("PUT", `/issue/${key}/assignee`, { accountId });
  console.log(`  ✓ ${key} reasignado correctamente a ${email}`);

  return accountId;
}

// ── 5. FLUJO 3 — VER TRANSICIONES ────────────────────────────
async function verTransiciones(key) {
  sep(`FLUJO 3a · Transiciones disponibles para ${key}`);

  const data = await jira("GET", `/issue/${key}/transitions`);
  console.log("  ID    Nombre                         → Estado destino");
  data.transitions.forEach(t => {
    console.log(`  ${t.id.padEnd(6)}${t.name.padEnd(35)}→ ${t.to.name}`);
  });

  return data.transitions;
}

// ── 6. FLUJO 3 — CERRAR ──────────────────────────────────────
async function cerrar(key, transitions) {
  sep(`FLUJO 3b · Cerrar ${key}`);

  // Busca la transición "RESUELTO" o "Resolver" (cualquier variante)
  const palabrasResuelto = ["resuelto", "resolver", "resolved", "resolve"];
  const palabrasCerrar   = ["cerrar", "cerrado", "close", "closed", "done"];

  const tResuelto = transitions.find(t =>
    palabrasResuelto.some(p => t.name.toLowerCase().includes(p))
  );
  const tCerrar = transitions.find(t =>
    palabrasCerrar.some(p => t.name.toLowerCase().includes(p))
  );

  if (!tResuelto && !tCerrar) {
    console.log("  ⚠ No se encontraron transiciones de cierre.");
    console.log("    Verifica los IDs arriba y ajusta el script.");
    return;
  }

  // Paso 1: RESUELTO (si está disponible)
  if (tResuelto) {
    console.log(`  → Ejecutando transición "${tResuelto.name}" (ID: ${tResuelto.id})`);

    await jira("POST", `/issue/${key}/transitions`, {
      transition: { id: tResuelto.id },
      fields: {
        // Campos obligatorios según el MR — ajusta según tu proyecto
        customfield_13268: { value: "Resuelto" },              // Tipo de Resolución (PROD)
        customfield_13270: [{ value: "WORKPLACE" }],           // Proceso/Servicio Impactado
        customfield_13271: { value: "NO" },                    // ¿Es incidencia masiva?
      },
      update: {
        comment: [{
          add: {
            body: adf("Incidencia resuelta y cerrada desde script de validación."),
          },
        }],
      },
    });
    console.log(`  ✓ Estado → RESUELTO`);
  }

  // Paso 2: CERRADO
  if (tCerrar) {
    // Re-obtener transiciones porque cambiaron de estado
    const t2 = await jira("GET", `/issue/${key}/transitions`);
    const tC  = t2.transitions.find(t =>
      palabrasCerrar.some(p => t.name.toLowerCase().includes(p))
    );

    if (tC) {
      console.log(`  → Ejecutando transición "${tC.name}" (ID: ${tC.id})`);
      await jira("POST", `/issue/${key}/transitions`, {
        transition: { id: tC.id },
      });
      console.log(`  ✓ Estado → CERRADO`);
    } else {
      console.log("  ℹ  Transición 'Cerrar' no disponible desde el estado actual (puede que ya esté cerrado).");
    }
  }

  // Verificar estado final
  const final = await jira("GET", `/issue/${key}?fields=status`);
  console.log(`\n  Estado final: ${final.fields.status?.name}`);
}

// ── 7. RUNNER PRINCIPAL ──────────────────────────────────────
async function main() {
  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   Jira INC — Validación de flujos                   ║");
  console.log(`║   Ticket: ${ISSUE_KEY.padEnd(44)}║`);
  console.log("╚══════════════════════════════════════════════════════╝");

  if (ISSUE_KEY === "INC-XXXXX") {
    console.error("\n  ✗ Debes pasar el key del ticket:");
    console.error("    node jira_test.mjs INC-12345\n");
    process.exit(1);
  }

  try {
    // ── Flujo 1: buscar por key
    await buscarTicket(ISSUE_KEY);

    // ── Flujo 1b: buscar por correo (opcional, comenta si no necesitas)
    // await buscarPorCorreo(EMAIL);

    // ── Flujo 2: reasignar
    await reasignar(ISSUE_KEY, ASSIGNEE_EMAIL);

    // ── Flujo 3: ver transiciones y cerrar
    const transitions = await verTransiciones(ISSUE_KEY);
    await cerrar(ISSUE_KEY, transitions);

    sep("RESULTADO FINAL");
    console.log("  ✓ Los 3 flujos completados sin errores.\n");

  } catch (err) {
    sep("ERROR");
    console.error(`  ✗ ${err.message}`);
    console.error("  Revisa las credenciales, el key del ticket y los permisos.\n");
    process.exit(1);
  }
}

main();
