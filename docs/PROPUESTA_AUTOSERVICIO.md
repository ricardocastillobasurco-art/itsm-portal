# Propuesta: registro autoservicio + plan gratis + soporte gestionado

> 6 de octubre de 2026 · Estado: **en construcción** — ver avance abajo.
> Objetivo: que cualquier empresa pueda registrarse sola, usar el producto gratis con límites,
> y que de ahí salgan clientes de pago y clientes de tu **servicio de soporte**.

---

## 1. Modelo comercial propuesto

| | **Gratis** | **Prueba 30 días** | **Pro** | **Soporte gestionado** |
|---|---|---|---|---|
| Para quién | Pymes que se atienden solas | Quien quiere probar todo | Empresas con su propio TI | Empresas que **te contratan** |
| Técnicos (quienes atienden) | 2 | Ilimitados | Por técnico | Tu equipo |
| Usuarios finales (reportan) | **Ilimitados** | Ilimitados | Ilimitados | Ilimitados |
| Equipos con control remoto | 15 | 50 | Por paquete | Incluidos |
| Mesa de ayuda, portal, chatbot, KB, correo a ticket | ✅ | ✅ | ✅ | ✅ |
| Control remoto (RMM) | ✅ (hasta 15) | ✅ | ✅ | ✅ |
| Reportes avanzados, activos/CMDB, marca propia | ❌ | ✅ | ✅ | ✅ |
| Soporte | Guías y comunidad | Correo | Correo | **Tu equipo resuelve** |
| Precio sugerido* | US$ 0 | US$ 0 | ~US$ 12–20 por técnico/mes + equipos extra | Por usuario o por equipo/mes, o bolsa de horas |

\* Referencia de mercado: Freshservice US$ 19–99 por técnico, Atera US$ 129–269 por técnico,
RMM US$ 1,5–6 por equipo. Un precio bajo en moneda local es tu ventaja; **definirlo es decisión tuya**.

Al terminar la prueba de 30 días, la empresa **pasa sola al plan Gratis** (no pierde datos):
así nadie se va por "se me venció".

---

## Avance (6 de octubre de 2026)

| Fase | Estado | Dónde |
|---|---|---|
| A — Registro autoservicio | ✅ Hecho | `/registro`; superadmin → **Registro** (modo invitación/abierto, invitaciones, códigos pendientes) |
| B1–B3 — Límites, prueba → Gratis | ✅ Hecho | Límites editables en superadmin → Registro; aviso en el panel; job horario |
| B4 — Inactivas 60 días | ✅ Listadas en Comercial · sin borrado automático (lo decide el superadmin) | |
| C1, C2, C4 — Planes, contratar soporte, panel comercial | ✅ Hecho | `/planes`; superadmin → **Comercial** (solicitudes, KPIs, precios) |
| C3 — Cobro | ✅ Etapa 1 manual · ⏳ Etapa 2 pasarela | Botón **Billing** de cada empresa: aviso al cliente 7 días antes; vencido → aviso al superadmin |
| D1, D3, D4 — Ayuda, checklist, bienvenida | ✅ Hecho | `/ayuda`, tarjeta "Primeros pasos", correos días 0/2/7 |
| D2 — Datos de ejemplo | ⏳ Pendiente (opcional) | |
| E3 — Legales | ✅ Borrador | `/legal/terminos`, `/legal/privacidad`; datos del titular en Comercial. **Revisión de abogado obligatoria** |
| E1, E2 — Landing y estado | ⏳ Pendiente (necesita marca, dominio y precios) | |

## 2. Lo que falta construir (plan original)

### Fase A — Registro autoservicio (núcleo) · ~3–4 sesiones mías
| # | Qué | Detalle |
|---|---|---|
| A1 | **Página "Pruébalo gratis"** | Nombre, empresa, correo, contraseña, país; acepta términos y privacidad |
| A2 | **Verificación de correo** | Código de 6 dígitos (ya existe el mecanismo de códigos) |
| A3 | **Antiabuso** | Captcha, máximo de registros por IP/día, bloqueo de correos desechables, dominio único por empresa |
| A4 | **Alta automática** | Crea la empresa (código de tickets, plan "Prueba"), su administrador, paquete inicial y **su grupo en MeshCentral** |
| A5 | **Entrada directa al asistente** | Ya existe: marca → equipo → SLA → categorías → listo |
| A6 | **Aviso al superadmin** | Correo/notificación "Nueva empresa registrada" + lista en el superadmin |

### Fase B — Límites, prueba y paso a Gratis · ~2 sesiones
| # | Qué | Detalle |
|---|---|---|
| B1 | **Límites por plan** | Técnicos activos y equipos con agente; aviso claro al llegar al límite (no se cae nada) |
| B2 | **Reloj de prueba** | Barra "te quedan X días"; correos a 7, 3 y 0 días |
| B3 | **Paso automático a Gratis** | Al vencer: se desactivan módulos Pro y técnicos sobre el límite quedan en solo lectura; **los datos se conservan** |
| B4 | **Limpieza** | Empresas de prueba sin uso 60 días: aviso y luego exportación + borrado (cumple privacidad) |

### Fase C — Conversión a pago y a tu servicio · ~2 sesiones
| # | Qué | Detalle |
|---|---|---|
| C1 | **Página "Planes"** dentro del producto | Comparativa y botón "Mejorar plan" |
| C2 | **"Contratar soporte"** | Formulario dentro del producto (usuarios, equipos, horario) → te llega como oportunidad en el superadmin |
| C3 | **Cobro** | Etapa 1: manual (transferencia, tú activas el plan desde el superadmin). Etapa 2: pasarela en línea (Culqi / Mercado Pago / Stripe) con renovación mensual |
| C4 | **Panel comercial del superadmin** | Registros por semana, empresas activas, en prueba, por vencer, convertidas |

### Fase D — Que el producto se explique solo · ~2 sesiones
| # | Qué | Detalle |
|---|---|---|
| D1 | **Centro de ayuda** | Guías cortas con capturas: primeros pasos, correo a ticket, instalar agente, SLA |
| D2 | **Datos de ejemplo** opcionales | Tickets y equipos ficticios para ver el producto "lleno" en la prueba; se borran con un clic |
| D3 | **Checklist de activación** | "1. Invita a un técnico 2. Crea tu primer ticket 3. Instala un agente" con avance |
| D4 | **Correos de bienvenida** | Día 0, 2 y 7 con un consejo cada uno |

### Fase E — Vitrina pública · ~1–2 sesiones
| # | Qué | Detalle |
|---|---|---|
| E1 | **Landing page** | Qué es, para quién, capturas, precios, preguntas frecuentes, "Pruébalo gratis" |
| E2 | **Página de estado** | Si el servicio está funcionando (genera confianza) |
| E3 | **Documentos legales** | Términos, privacidad y tratamiento de datos (borrador mío → revisión de abogado) |

**Total estimado de mi parte: ~10–12 sesiones de trabajo.**

---

## 3. Lo que te toca a ti

| Antes de abrir el registro | Por qué |
|---|---|
| **Correo de salida (SMTP)** funcionando, idealmente con dominio propio | Sin esto nadie puede verificar su cuenta |
| **MeshCentral** instalado (guía lista) | El plan gratis incluye control remoto |
| **Dominio y marca** del producto | La landing y los correos salen con tu marca |
| **Precios** definitivos | Para la página de planes |
| **Abogado**: propiedad intelectual + términos + privacidad | Requisito legal para recibir datos de terceros |
| **Respaldos** activos (guía lista) | Ya habrá datos de clientes que no son tuyos |
| **RUC/empresa** y cuenta en pasarela de pago | Solo para la fase C3 en línea |

---

## 4. Costos de operación (aproximados, verificar)

| Concepto | Hoy (3–4 clientes) | Con registro abierto (~50 empresas) |
|---|---|---|
| Railway (portal + MySQL) | Plan actual | Subir recursos del plan; vigilar uso |
| Servidor MeshCentral | US$ 6–12/mes | US$ 12–24/mes (más RAM según equipos) |
| Correo transaccional | Gratis/bajo (cuenta propia) | Servicio de envío (p. ej. Brevo, Amazon SES): bajo costo |
| Dominio | ~US$ 10–15/año | Igual |

Cuando pasen de ~100 empresas o un cliente lo exija, se evalúa la mudanza a Azure (ya documentada en `PLAN_COMERCIAL.md`).

---

## 5. Riesgos y cómo se cubren

| Riesgo | Cobertura |
|---|---|
| Registros falsos o abuso | Verificación de correo, captcha, límites por IP, correos desechables bloqueados |
| Costos por empresas gratis que no usan nada | Límites del plan + limpieza de inactivas a 60 días |
| Mucho soporte a usuarios gratis | Centro de ayuda + checklist; el soporte humano es el producto de pago |
| Un cliente gratis ve datos de otro | Aislamiento ya auditado (escáneres en 0, pruebas por empresa) |
| Caída del servicio con más carga | Pruebas automáticas antes de cada despliegue (ya activas), monitoreo y página de estado |
| Problemas legales | Términos y privacidad revisados por abogado antes de abrir |

---

## 6. Orden recomendado

1. **Ahora:** instalar MeshCentral, SMTP y respaldos; cerrar tus 3–4 clientes con acompañamiento.
2. **Fases A + B** (registro, límites, prueba) → abrir a un grupo pequeño por invitación.
3. **Fase D** (que se explique solo) con lo que aprendas de ese grupo.
4. **Fases C + E** (cobro, landing) → abrir el registro al público.

---

## 7. Decisiones que necesito de ti para empezar

1. ¿Te parecen bien los límites del plan Gratis (2 técnicos, 15 equipos, usuarios ilimitados)?
2. ¿La prueba de 30 días pasa sola a Gratis (recomendado) o se bloquea?
3. ¿Cobro manual al inicio (recomendado) o pasarela desde el principio?
4. ¿Abrimos primero **por invitación** (recomendado) o público directo?
