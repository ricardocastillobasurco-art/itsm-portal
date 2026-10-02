# Plan comercial y de arquitectura — ITSM Portal

> Estado al **2 de octubre de 2026**. Documento vivo: actualizar al cerrar cada fase.
> Repositorio: `ricardocastillobasurco-art/itsm-portal` (privado) · Producción actual: Railway.

---

## 1. Resumen en 30 segundos

- El producto **ya funciona** como mesa de ayuda + portal de autoservicio, con **varias empresas aisladas** en una misma instalación, y puede trabajar **solo** (gestión local TK-/RQ-) o **integrado** (Jira, Microsoft 365).
- **Todavía no está listo para vender** a una empresa externa por tres motivos: quedan datos de Integratel fijos en el código, falta infraestructura "seria" (respaldos, archivos persistentes, correo) y falta lo legal (propiedad intelectual, contratos).
- **Respuesta corta a "¿dónde lo instalo?"**: el mismo software se puede desplegar de 4 formas (sección 5). Para empezar a vender: **SaaS en Azure** para la mayoría de clientes, **instancia dedicada** para los que exigen privacidad, y **on-premise** solo si el cliente lo exige (y cobrando más). Railway queda para demo y pruebas.
- **Implementar un cliente nuevo NO requiere detener nada**: cada despliegue es independiente. Un cliente SaaS se da de alta en minutos desde el superadmin, sin viajar (sección 6).

---

## 2. Lo que ya está hecho

### Producto
| Área | Estado |
|---|---|
| Incidencias (TK-) y requerimientos (RQ-) con gestión local, sin depender de Jira | ✅ |
| Interruptor por empresa: **Modo Jira** o **gestión local** (también lo respeta el chatbot) | ✅ |
| SLA por prioridad con pausa en "pendiente de usuario", cierre automático, reapertura | ✅ |
| Asignación, reasignación, comentarios públicos e internos, timeline | ✅ |
| Adjuntos / evidencias (arrastrar, clic, **Ctrl+V** de capturas), en Jira o local | ✅ |
| Encuesta de satisfacción (CSAT) al resolver | ✅ |
| **Correo a ticket** (Microsoft 365 / Gmail / IMAP) con respuesta que se agrega al ticket | ✅ |
| Numeración por empresa (`TK-ACME-0001`) | ✅ |
| Catálogos de cierre por empresa (resolución, proceso, resultado) | ✅ |
| Portal de autoservicio, chatbot, base de conocimiento, catálogo de servicios, FAQ | ✅ |
| Reportes, indicadores, Kanban, NOC | ✅ (parte depende de Jira) |
| Recuperación de contraseña, contraseñas temporales aleatorias | ✅ |
| **Marca blanca por empresa** (nombre, logo, color, título del portal, nombre del equipo de soporte) editable por el admin | ✅ |

### Técnico / seguridad
| Área | Estado |
|---|---|
| Aislamiento por empresa (`tenant_id`) revisado en rutas, jobs, sockets y reportes; escáneres automáticos en 0 | ✅ |
| Credenciales de integraciones **cifradas** (AES-256-GCM, `CONFIG_ENCRYPTION_KEY`) | ✅ |
| Configuración ITSM por empresa y solo para administradores | ✅ |
| Migraciones automáticas al desplegar (probadas en MySQL 8) | ✅ |
| Contenedor Docker con usuario sin privilegios y healthcheck | ✅ |
| 109 pruebas automáticas + pruebas E2E de gestión local, adjuntos, catálogos y marca | ✅ |
| **CI en GitHub**: sintaxis, pruebas y migraciones en MySQL 8 en cada push (`ci.yml`) | ✅ (falta activar "Wait for CI" en Railway) |
| **Backup diario cifrado** (`backup.yml`) + script de restauración probado — ver `docs/RESPALDOS.md` | ✅ (faltan los secretos en GitHub) |

---

## 3. Lo que falta (priorizado)

### 3.1 Bloqueantes — antes del primer cliente externo
| # | Tema | Quién | Detalle |
|---|---|---|---|
| B1 | **Propiedad intelectual** | Tú | Confirmar con abogado que el software es tuyo (se desarrolló en el contexto de tu trabajo). **Sin esto no se vende.** |
| B2 | Datos de Integratel en el código | Yo | Pendiente: IDs de campos Jira (`customfield_11795` teléfono, `15147` categoría Workplace, `13268/13270/13271/15344` cierre), etiquetas de impacto/urgencia/componentes en `routes/jira/helpers.js`, colores `_WP_COLORS`, cola "Workplace" del NOC. Pasar a configuración por empresa. |
| B3 | Archivos persistentes | Tú (Railway) / Yo (código) | Ahora: Volume en `/app/uploads`. Para escalar: guardar adjuntos en **almacenamiento de objetos** (Azure Blob / S3). |
| B4 | Correo saliente | Tú | Cuenta propia de la plataforma + `SMTP_USER` / `SMTP_PASS`. Ideal: remitente por empresa. |
| B5 | Respaldos | ✅ Yo / ⏳ Tú | Hecho: backup diario cifrado, 30 días, restauración probada (`docs/RESPALDOS.md`). **Tú:** cargar los secretos `BACKUP_*` en GitHub. Pendiente (yo): exportación de datos de una empresa. |
| B6 | Rotar secretos | Tú | Nuevos tokens Jira / Azure / BD / `JWT_SECRET` / `SESSION_SECRET`. |
| B7 | Contratos | Tú (+ abogado) | Términos de servicio, política de privacidad, **contrato de tratamiento de datos** (Ley 29733 de Protección de Datos Personales – Perú), SLA de la plataforma. |
| B8 | Errores conocidos | Yo | `noc/stats` (`updated_at`), workflow `my-pending` (`createdAt`), tabla `business_rules` inexistente, módulos legados (activos/planilla). |

### 3.2 Configurable — que el cliente se configure sin programar
| # | Tema | Quién |
|---|---|---|
| C1 | Asistente de alta: logo, colores, técnicos, categorías, SLA, horario laboral | Yo |
| C2 | Calendario laboral y feriados para el cálculo de SLA; zona horaria por empresa | Yo |
| C3 | Plantillas de correo editables por empresa | Yo |
| C4 | **SSO por empresa** (Microsoft Entra ID / Google) y **2FA** | Yo (código) / Tú (registrar apps) |
| C5 | Roles y permisos ajustables por empresa | Yo |
| C6 | Subdominio por cliente (`acme.tumarca.com`) | Yo / Tú (DNS) |

### 3.3 Producto — lo que el comprador espera
- Adjuntos desde "Mis tickets" del portal del usuario final.
- Sugerencia de artículos de la base de conocimiento al escribir el problema (evita tickets).
- Aprobaciones en el catálogo de servicios.
- Reportes de SLA y satisfacción exportables (Excel/PDF) y programados.
- Canales: Microsoft Teams / Slack; app móvil (PWA) con notificaciones.
- **API pública + webhooks** con clave por empresa.
- Herramientas para técnicos: acceso remoto por empresa, inventario, scripts de diagnóstico.

### 3.4 Negocio y operación
- Planes con límites (agentes, tickets, almacenamiento) + cobro en línea (Culqi / Mercado Pago / Stripe), periodo de prueba, suspensión por impago.
- Marca, dominio, landing page con demo, manuales (usuario y administrador).
- Página de estado del servicio, alertas de caída, registro de errores (p. ej. Sentry), métricas de uso por empresa.
- **Pruebas automáticas en GitHub Actions** antes de cada despliegue (incluye migraciones en MySQL 8) y un entorno de pruebas (*staging*).

---

## 4. Arquitectura actual

```
            Usuarios (navegador)                 Correos entrantes
                   │ HTTPS                              │ IMAP / Microsoft Graph
                   ▼                                    ▼
   ┌───────────────────────────────────────────────────────────────┐
   │  Contenedor Node.js (Express + Socket.io + EJS)                │
   │  · Portal de autoservicio  · Consola de TI  · Superadmin       │
   │  · Motor local de tickets (SLA, estados, CSAT, autocierre)     │
   │  · Jobs programados (SLA, correo→ticket, reportes)             │
   │  · Migraciones automáticas al arrancar                         │
   └──────┬───────────────┬──────────────┬──────────────┬───────────┘
          │               │              │              │
     MySQL 8         /app/uploads    Redis (opcional)   Integraciones externas
   (todas las        (adjuntos)      colas Bull          · Jira Cloud / JSM
    empresas,                                            · Microsoft 365 (Graph, SSO)
    separadas por                                        · SMTP (correo saliente)
    tenant_id)                                           · IA (Groq) · MeshCentral
```

- **Multiempresa en una sola base** (`tenant_id` en cada tabla). La empresa 1 es la dueña y la plantilla para empresas nuevas.
- **Variables obligatorias** (validadas al arrancar por `scripts/utilities/check-env.js`): `EQUIPMENT_HOST/USER/PASSWORD/DATABASE`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SESSION_SECRET`, `APP_URL`, `ALLOWED_ORIGINS`, `SMTP_*`, `MS_*`, `CONFIG_ENCRYPTION_KEY`, `GROQ_API_KEY`, `METRICS_TOKEN`.
- **Ya existe `docker-compose.yml`** (app + MySQL 8 + Redis + volúmenes): es la base para instalaciones dedicadas u on-premise.

---

## 5. ¿Dónde instalarlo? Modelos de despliegue

El código es **el mismo** en los 4 modelos; cambia dónde corre y quién administra la infraestructura.

| | **A. SaaS compartido** | **B. SaaS dedicado** | **C. En la nube del cliente** | **D. On-premise** |
|---|---|---|---|---|
| Qué es | Una instalación, muchas empresas separadas por `tenant_id` | Una instalación **y una BD solo para ese cliente**, en tu nube | Tú despliegas en **la suscripción Azure/AWS del cliente** | En **servidores del cliente** (Docker Compose) |
| Quién controla los datos | Tú (proveedor) | Tú, pero aislados físicamente | **El cliente** | **El cliente** |
| Tiempo de alta | Minutos | 1–2 días | 3–5 días | 1–2 semanas |
| Actualizaciones | Automáticas, todos a la vez | Automáticas por cliente | Coordinadas con el cliente | Manuales / con acceso remoto |
| Costo para ti | Bajo (se reparte) | Medio (infra por cliente) | Bajo (paga el cliente) | Alto en soporte |
| Para quién | Pymes, startups, colegios | Medianas, sector financiero/salud | Corporativos con política "datos en casa" pero en nube | Gobierno, bancos, sin internet |
| Precio sugerido | Por agente/mes | Por agente/mes + cargo de instalación | Licencia + implementación + soporte | Licencia anual + implementación + mantenimiento (~20 %/año) |

**Referencia de mercado:** ManageEngine ServiceDesk Plus vende nube y on-premise del mismo producto; Freshservice, Jira Service Management y Zendesk son solo nube (con opciones de residencia de datos en planes empresariales). Ofrecer A + B y, bajo pedido, C/D es un diferencial real en Latinoamérica.

### 5.1 Railway vs Azure

| Criterio | Railway (hoy) | Azure |
|---|---|---|
| Facilidad / costo inicial | ⭐ Muy simple, barato | Más configuración |
| Confianza del comprador corporativo | Baja (marca poco conocida en TI corporativa) | **Alta**: muchas empresas ya tienen contrato con Microsoft |
| Región de datos | EE.UU. / Europa / Asia | Incluye regiones en Latinoamérica (p. ej. Brazil South) — elegir según cliente |
| Red privada con el cliente (VPN, Private Endpoint) | No | Sí |
| BD gestionada con backups y cifrado | Básico | Azure Database for MySQL (backups automáticos, réplica, cifrado) |
| Archivos | Volume del contenedor | Azure Blob Storage (redundante, cifrado) |
| Secretos | Variables del servicio | Key Vault |
| Firewall de aplicación (WAF) | No | Front Door / Application Gateway con WAF |
| Integración con SSO del cliente | Por código | Nativa con Entra ID (Microsoft 365) |
| Certificaciones (ISO 27001, SOC 2…) | Limitadas — verificar | Amplias (heredas las de la plataforma) |

**Recomendación:**
1. **Ahora:** Railway para demo, piloto y staging (no hace falta mudarse ya).
2. **Antes del primer cliente que pague:** producción comercial en **Azure** — Azure Container Apps (o App Service para contenedores) + Azure Database for MySQL Flexible Server + Blob Storage + Key Vault + Front Door con WAF + Application Insights.
3. Describir toda la infraestructura como código (Bicep o Terraform) para crear un entorno nuevo (modelo B o C) con un solo comando.
4. Costos: estimar con la calculadora oficial de Azure antes de fijar precios (dependen de región y tamaño).

### 5.2 Si el cliente "no quiere que su información esté expuesta"
Ofrecer, de menor a mayor costo:
1. **SaaS compartido con garantías** — cifrado en tránsito (HTTPS) y en reposo, aislamiento por empresa auditado, SSO con su Microsoft/Google, 2FA, restricción por IP, bitácora de auditoría, contrato de tratamiento de datos, exportación y borrado de sus datos al terminar.
2. **SaaS dedicado (B)** — su propia BD y almacenamiento, región a elección, acceso del proveedor solo con autorización ("break-glass") y registrado.
3. **En su nube (C)** — los datos nunca salen de su suscripción; tú tienes acceso delegado y revocable.
4. **On-premise (D)** — todo dentro de su red; requiere VPN o acceso remoto acordado para soporte y actualizaciones.

Lo que más pesa para un comprador cuidadoso: **dónde están los datos, quién puede verlos, cómo se respaldan y qué pasa si se van.** Tenerlo por escrito (anexo de seguridad) vende más que cualquier función.

### 5.3 Cambios de código para soportar B, C y D
| Cambio | Para qué | Prioridad |
|---|---|---|
| Adjuntos en almacenamiento de objetos (Blob/S3) con interfaz común | Escalar y no depender del disco | Alta |
| Imagen Docker publicada en registro privado (GHCR / Azure Container Registry) con versiones | Instalar la misma versión en cualquier lado | Alta |
| Modo "una sola empresa" (`SINGLE_TENANT=true`: oculta superadmin y multiempresa) | Instalaciones dedicadas/on-premise | Media |
| Instalador on-premise: `docker-compose` + script de configuración inicial + guía | Modelo D | Media |
| Licencia para on-premise (clave con empresa, nº de agentes y vencimiento) | Controlar uso fuera de tu nube | Media |
| Infraestructura como código (Bicep/Terraform) | Crear entornos B/C repetibles | Media |
| Bitácora de auditoría visible para el admin del cliente | Requisito de compradores corporativos | Media |

---

## 6. Playbook: "mañana una empresa quiere implementarlo"

**No se detiene nada.** Para un cliente SaaS no hace falta ir a su oficina: todo es remoto. La visita sirve para capacitar y generar confianza.

### Paso a paso (cliente SaaS)
| Día | Actividad | Quién |
|---|---|---|
| 0 | Reunión de descubrimiento: nº de técnicos y usuarios, ¿usan Jira o gestión local?, buzón de soporte, categorías, SLA, horario, ¿Microsoft 365 o Google? | Tú |
| 0 | Firma: propuesta, términos, contrato de tratamiento de datos | Tú |
| 1 | Superadmin → crear empresa (nombre, dominio, código de tickets p. ej. `ACME`) | Tú |
| 1 | Marca: logo y colores; usuarios administradores del cliente | Tú / cliente |
| 1–2 | Configuración: catálogos de cierre, categorías, SLA, catálogo de servicios, automatizaciones | Admin del cliente (con tu guía) |
| 2 | Usuarios: carga masiva o SSO con su Microsoft/Google | Tú / TI del cliente |
| 2 | Correo a ticket: conectar su buzón de soporte (`soporte@cliente.com`) y probar | TI del cliente |
| 2 | Integración: dejar **Modo Jira apagado** (gestión local) o conectar su Jira | Tú |
| 3 | Capacitación: técnicos (1 h) y administradores (1 h); guía rápida para usuarios | Tú |
| 3–14 | **Piloto** con un área; reunión semanal de ajustes | Tú / cliente |
| 15 | Salida a producción para toda la empresa; inicia facturación | Tú |

### Checklist para llevar a la reunión de descubrimiento
- [ ] Nº de técnicos (agentes) y de usuarios finales
- [ ] ¿Tienen herramienta actual? ¿migrar tickets históricos?
- [ ] Categorías / tipos de servicio y SLA por prioridad
- [ ] Horario de atención y feriados
- [ ] Buzón de soporte y proveedor de correo
- [ ] Identidad: Microsoft 365 / Google / usuarios propios
- [ ] Requisitos de seguridad: ¿datos en su país? ¿nube propia? ¿auditoría?
- [ ] Integraciones necesarias (Jira, Teams, inventario)
- [ ] Persona responsable del lado del cliente

### Si el cliente pide dedicado / su nube / on-premise
Además de lo anterior: definir infraestructura (tamaño, región o servidores), DNS y certificado, acceso remoto para soporte, ventana de actualizaciones, responsable de respaldos y acuerdo de nivel de servicio (SLA) de soporte.

---

## 7. Checklist de seguridad para vender

| Control | Estado |
|---|---|
| Aislamiento entre empresas | ✅ |
| Credenciales de integraciones cifradas | ✅ |
| HTTPS | ✅ |
| Roles: usuario / técnico / administrador / superadmin | ✅ |
| Recuperación de contraseña segura | ✅ |
| 2FA y SSO por empresa | ❌ |
| Respaldos automáticos + restauración probada | ❌ |
| Rotación de secretos | ❌ |
| WAF / protección contra ataques | ❌ (con Azure Front Door) |
| Bitácora de auditoría visible para el cliente | ⚠️ parcial |
| Exportación y borrado de datos por empresa | ❌ |
| Prueba de penetración externa | ❌ (antes de clientes grandes) |
| Documentos legales (términos, privacidad, tratamiento de datos) | ❌ |

---

## 8. Plan de trabajo: qué hago yo y qué haces tú

### Fase 1 — Quitar lo de Integratel del código *(en curso, ~75 %)*
| Yo | Tú |
|---|---|
| ✅ Catálogos de cierre por empresa | ✅ Push y verificación en producción |
| ✅ Configuración ITSM por empresa | Verificar adjuntos de Jira tras el push |
| ✅ Marca blanca: portal sin Movistar/Workplace fijos | Revisar que Integratel se vea igual (logo y "Workplace IT") |
| ⏳ Campos de Jira configurables por empresa (teléfono, categoría, cierre) — solo afecta al modo Jira | |
| ⏳ Etiquetas de impacto/urgencia/componentes y colores configurables | |

### Fase 2 — Infraestructura mínima *(en curso)*
| Yo | Tú |
|---|---|
| ✅ Backup diario cifrado + restauración probada | Cargar secretos `BACKUP_*` en GitHub y ejecutar la 1.ª copia (`docs/RESPALDOS.md`) |
| ✅ GitHub Actions: pruebas + migraciones en MySQL 8 | Railway → Settings → **Wait for CI** |
| ⏳ Corregir errores conocidos (B8) | Volume `/app/uploads` · `SMTP_USER` / `SMTP_PASS` · rotar secretos (B6) |

### Fase 3 — Listo para un cliente
| Yo | Tú |
|---|---|
| Asistente de alta, plantillas de correo, calendario/feriados | Probar el asistente con una empresa ficticia |
| SSO por empresa + 2FA | Registrar apps en Azure (Entra ID) y Google |
| Adjuntos en portal de usuario + sugerencias de base de conocimiento | Redactar textos de bienvenida y manual corto |

### Fase 4 — Mudanza a Azure y modelos dedicados
| Yo | Tú |
|---|---|
| Adjuntos en Blob Storage, imagen en registro privado | Crear suscripción Azure (cuenta de empresa) |
| Infraestructura como código (Bicep/Terraform) | Aprobar presupuesto mensual |
| Modo una sola empresa + instalador on-premise + licencia | Elegir región |

### Fase 5 — Cobro y venta
| Yo | Tú |
|---|---|
| Límites por plan, pagos, periodo de prueba | **Definir precios y planes**; cuenta en pasarela de pago (requiere RUC) |
| Landing page + empresa demo | Marca, dominio, registro de marca |
| Borrador de términos/privacidad para revisión legal | Abogado: propiedad intelectual + contratos; **1–2 clientes piloto** |

---

## 9. Próximos pasos inmediatos

**Tú (esta semana):**
1. Push de los commits pendientes y verificar adjuntos de Jira (`INC-267675`); si falla, enviar líneas `[adjuntos]` del log.
2. Volume `/app/uploads` y SMTP en Railway.
3. Consulta legal sobre propiedad intelectual.
4. Pensar: nombre de marca, 2–3 posibles clientes piloto, rango de precios.

**Yo (siguiente sesión):**
1. Terminar la Fase 1 (campos Jira y etiquetas configurables).
2. Backup diario + pruebas automáticas en GitHub (Fase 2).

---

## 10. Registro de avances
| Fecha | Avance |
|---|---|
| 2026-09 | Aislamiento multiempresa completo, cifrado de credenciales, recuperación de contraseña, planes básicos |
| 2026-09-30 | Correo a ticket, motor local TK-/RQ-, interruptor Jira/local, numeración por empresa; caída por `last_value` en MySQL 8 resuelta |
| 2026-10-02 | Adjuntos/evidencias y barra de acciones; catálogos de cierre por empresa; configuración ITSM aislada; orden "más recientes primero"; descarga robusta de adjuntos Jira |
| 2026-10-02 | Marca blanca por empresa desde la BD; CI en GitHub (pruebas + migraciones MySQL 8); backup diario cifrado con restauración probada |
