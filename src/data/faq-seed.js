'use strict';

// FAQ seed data — fuente única de verdad para la KB del chatbot.
// Importado por: migración 20260630000029 + _ensureFaqTables() en chatbot.js
module.exports = [
  // ── GENERAL ────────────────────────────────────────────────────────────────
  {
    key: 'greeting', category: 'general', title: 'Saludo', type: 'greeting',
    response: null, escalate: false, sort: 0,
    triggers: [
      'hola','buenos dias','buenas tardes','buenas noches','buenas','hey',
      'que tal','buen dia','hello','hi','muy buenos','saludos','ola',
      'buen provecho','bien gracias'
    ],
    followups: [
      { label:'¿Cómo creo un ticket?',       next_key:'crear_incidencia' },
      { label:'Ver mis tickets',              next_key:'mis_tickets'       },
      { label:'Horario de soporte',           next_key:'horario_soporte'   },
    ]
  },
  {
    key: 'farewell', category: 'general', title: 'Despedida', type: 'text',
    response: '¡Hasta pronto! 👋 Si necesitas ayuda más adelante, estaré aquí. Que tengas un excelente día.',
    escalate: false, sort: 1,
    triggers: [
      'adios','hasta luego','chau','bye','hasta pronto','nos vemos',
      'eso es todo','listo ya termine','hasta manana','ciao','chao'
    ],
    followups: []
  },
  {
    key: 'thanks', category: 'general', title: 'Agradecimiento', type: 'text',
    response: '¡Con gusto! 😊 Para eso estoy. ¿Hay algo más en lo que pueda ayudarte?',
    escalate: false, sort: 2,
    triggers: [
      'gracias','muchas gracias','te lo agradezco','perfecto gracias',
      'genial gracias','ok gracias','listo gracias','excelente gracias',
      'thank you','thx','muy amable','te agradezco'
    ],
    followups: []
  },
  {
    key: 'que_haces', category: 'general', title: '¿Qué puedes hacer?', type: 'text',
    response: 'Soy **ARIA**, asistente virtual de TI. 🤖 Puedo ayudarte con:\n\n📋 **Tickets** — crear incidencias y requerimientos, consultar estado\n💻 **Equipos** — solicitar, reportar daños, garantías, devoluciones\n🔑 **Accesos** — contraseñas, VPN, permisos a sistemas\n📦 **Software** — Office, licencias, instalaciones\n🖨️ **Impresoras** — configuración y problemas\n📞 **Directorio** — buscar compañeros y contactos\n⏰ **Soporte** — horarios, tiempos de respuesta, escalaciones\n\nSi no puedo responderte, te conecto con un especialista. ¿En qué te ayudo?',
    escalate: false, sort: 3,
    triggers: [
      'que puedes hacer','para que sirves','en que me puedes ayudar',
      'que haces','como me ayudas','que sabes hacer','quien eres',
      'que es aria','como funciona aria','que hace el chatbot',
      'opciones','que ofrecen','ayuda'
    ],
    followups: [
      { label:'Crear un ticket',            next_key:'crear_incidencia'  },
      { label:'Problema con mi equipo',     next_key:'equipo_danado'     },
      { label:'Cambiar contraseña',         next_key:'cambiar_contrasena'},
    ]
  },

  // ── SOPORTE ─────────────────────────────────────────────────────────────────
  {
    key: 'horario_soporte', category: 'soporte', title: 'Horario de soporte', type: 'text',
    response: '⏰ **Horario de atención TI:**\n\n📅 Lunes a Viernes: 8:00 am – 6:00 pm\n📅 Sábados: 9:00 am – 1:00 pm\n🚫 Domingos y feriados: sin atención presencial\n\nPara urgencias fuera de horario puedes iniciar una consulta aquí y un especialista te responderá a la brevedad.\n\n¿Necesitas algo más?',
    escalate: false, sort: 10,
    triggers: [
      'horario soporte','que hora atienden','cuando atienden','hasta que hora',
      'horario atencion','horario helpdesk','horario ti','hay soporte sabado',
      'atienden domingo','horario servicio','a que hora abren','cuando hay soporte',
      'horario mesa ayuda','hora de atencion','horario servicio desk'
    ],
    followups: [
      { label:'Hablar con especialista', next_key:'hablar_especialista' },
      { label:'Tiempos de respuesta SLA', next_key:'sla_tiempos'        },
    ]
  },
  {
    key: 'sla_tiempos', category: 'soporte', title: 'Tiempos de respuesta SLA', type: 'text',
    response: 'Los tiempos de respuesta según prioridad son:\n\n🔴 **Crítica** — 1ª respuesta: 15 min | Resolución: 4 horas\n🟠 **Alta** — 1ª respuesta: 1 hora | Resolución: 8 horas\n🟡 **Media** — 1ª respuesta: 4 horas | Resolución: 2 días hábiles\n🟢 **Baja** — 1ª respuesta: 8 horas | Resolución: 5 días hábiles\n\n📌 Los tiempos corren en **horario hábil** (Lun–Vie 8am–6pm).\n\n¿Tienes un ticket que crees que ha excedido su SLA?',
    escalate: false, sort: 11,
    triggers: [
      'tiempo de respuesta','cuando me responden','cuanto demora','sla soporte',
      'prioridad ticket','tiempo resolucion','cuanto tardan','tiempo atencion',
      'nivel de servicio','tiempo garantizado','cuanto se demoran en responder',
      'plazo de atencion','cuanto tiempo tarda ti'
    ],
    followups: [
      { label:'Ver mis tickets activos', next_key:'mis_tickets'          },
      { label:'Hablar con especialista', next_key:'hablar_especialista'  },
    ]
  },

  // ── TICKETS ─────────────────────────────────────────────────────────────────
  {
    key: 'crear_incidencia', category: 'tickets', title: 'Crear incidencia', type: 'text',
    response: 'Para reportar un problema o falla:\n\n1️⃣ Ve al **portal de autogestión**\n2️⃣ Haz clic en **"Generar Incidencia"**\n3️⃣ Confirma tu correo corporativo\n4️⃣ Describe el problema (la descripción se auto-genera)\n5️⃣ Adjunta una captura si ayuda\n6️⃣ Haz clic en **"Registrar"** → recibirás un número de ticket\n\n💡 **¿Cuándo usar incidencia?** Cuando algo que funcionaba ya no funciona: PC lenta, internet caído, acceso bloqueado, equipo dañado, etc.\n\n¿Tienes un problema específico que quieras reportar ahora?',
    escalate: false, sort: 20,
    triggers: [
      'crear ticket','abrir ticket','reportar problema','generar incidencia',
      'abrir incidencia','hacer ticket','como reporto','quiero reportar falla',
      'tengo un problema como lo reporto','abrir solicitud','registrar incidencia',
      'crear incidencia','como creo un ticket','nuevo ticket','levantar ticket',
      'hacer una incidencia'
    ],
    followups: [
      { label:'Crear requerimiento',       next_key:'crear_requerimiento' },
      { label:'Ver mis tickets',           next_key:'mis_tickets'         },
    ]
  },
  {
    key: 'crear_requerimiento', category: 'tickets', title: 'Crear requerimiento', type: 'text',
    response: 'Para solicitar algo nuevo a TI:\n\n1️⃣ Ve al **portal de autogestión**\n2️⃣ Haz clic en **"Generar Requerimiento"**\n3️⃣ Selecciona el tipo y la prioridad\n4️⃣ Describe lo que necesitas\n5️⃣ Adjunta documentación si aplica\n6️⃣ Haz clic en **"Registrar"** → recibirás un número de ticket\n\n💡 **¿Cuándo usar requerimiento?** Cuando necesitas algo **nuevo**: equipo, acceso, software, habilitación de servicio, etc.\n\n¿Qué necesitas solicitar?',
    escalate: false, sort: 21,
    triggers: [
      'crear requerimiento','generar requerimiento','solicitar servicio',
      'pedir algo a ti','como pido a ti','nueva solicitud','solicitar recurso',
      'solicitar equipamiento','requerimiento ti','solicitud de servicio',
      'como solicito','quiero pedir','hacer requerimiento'
    ],
    followups: [
      { label:'Solicitar equipo',         next_key:'solicitar_equipo'    },
      { label:'Solicitar acceso',         next_key:'solicitar_acceso'    },
      { label:'Instalar software',        next_key:'instalar_software'   },
    ]
  },
  {
    key: 'mis_tickets', category: 'tickets', title: 'Ver mis tickets', type: 'api_tickets',
    response: 'Aquí están tus tickets activos:\n\n{TICKETS_LIST}\n\nPuedes ver el detalle completo en **"Mis Tickets"** en el portal.',
    escalate: false, sort: 22,
    triggers: [
      'mis tickets','mis incidencias','tickets abiertos','solicitudes pendientes',
      'ver mis tickets','cuantos tickets tengo','tickets activos','mis solicitudes',
      'estado de mis solicitudes','tickets que tengo','mis casos','consultar mis tickets',
      'como van mis tickets','tengo tickets abiertos','mis requerimientos pendientes'
    ],
    followups: [
      { label:'Crear nueva incidencia',   next_key:'crear_incidencia'    },
    ]
  },
  {
    key: 'estado_ticket', category: 'tickets', title: 'Estado de un ticket', type: 'text',
    response: 'Para consultar el estado de un ticket específico:\n\n1️⃣ Ve a **"Mis Tickets"** en el portal de autogestión\n2️⃣ Busca por número (ej: **TK-1234**) o por descripción\n\nAlternativamente, escríbeme el número de ticket y lo busco por ti.\n\n¿Cuál es el número de tu ticket?',
    escalate: false, sort: 23,
    triggers: [
      'estado ticket','como va mi ticket','cuando resuelven mi ticket',
      'estado de mi solicitud','buscar ticket','seguimiento ticket',
      'tk-','inc-','it-','estado de mi caso','como esta mi solicitud',
      'avance de mi ticket','resolvieron mi ticket'
    ],
    followups: [
      { label:'Ver todos mis tickets',    next_key:'mis_tickets'         },
    ]
  },

  // ── ACCESOS Y CONTRASEÑAS ───────────────────────────────────────────────────
  {
    key: 'cambiar_contrasena', category: 'accesos', title: 'Cambiar contraseña', type: 'text',
    response: '¿Qué contraseña necesitas cambiar?\n\n🖥️ **Windows / PC:** Ctrl+Alt+Del → "Cambiar contraseña". Mín. 8 caracteres, 1 mayúscula y 1 número.\n\n📧 **Correo Outlook:** Accede a account.microsoft.com con tu cuenta corporativa.\n\n🌐 **VPN:** La contraseña VPN es la misma que tu usuario de red. Si expiró, cambia primero la de Windows.\n\n🔒 **Sistema interno:** Dime cuál sistema y te oriento.\n\nSi tu usuario está **bloqueado**, no podrás cambiarlo tú mismo — dímelo y escalo con un especialista.',
    escalate: false, sort: 30,
    triggers: [
      'cambiar contrasena','cambiar clave','cambio de contrasena',
      'resetear password','reset password','olvide mi contrasena',
      'no recuerdo la contrasena','expiro contrasena','contrasena vencida',
      'como cambio la clave','renovar contrasena','actualizar contrasena',
      'cambiar pass','nueva contrasena','contrasena expirada','clave caducada'
    ],
    followups: [
      { label:'Usuario bloqueado',        next_key:'usuario_bloqueado'   },
      { label:'Problemas con VPN',        next_key:'vpn_problemas'       },
    ]
  },
  {
    key: 'usuario_bloqueado', category: 'accesos', title: 'Usuario bloqueado', type: 'escalate',
    response: '🔒 Si tu usuario está bloqueado no puedes desbloquearlo tú mismo, necesita intervención del equipo de TI.\n\nVoy a conectarte con un especialista para que lo resuelvan de inmediato.\n\n¿Puedes confirmarme tu **nombre completo** y **área** para que el especialista esté preparado?',
    escalate: true, sort: 31,
    triggers: [
      'usuario bloqueado','cuenta bloqueada','no puedo entrar a mi cuenta',
      'bloqueo de usuario','desbloquear usuario','cuenta no funciona',
      'no me deja entrar','acceso denegado windows','bloquearon mi cuenta',
      'usuario deshabilitado','cuenta deshabilitada','mi usuario no sirve'
    ],
    followups: [
      { label:'Hablar con especialista',  next_key:'hablar_especialista' },
    ]
  },
  {
    key: 'solicitar_acceso', category: 'accesos', title: 'Solicitar acceso', type: 'text',
    response: 'Para solicitar acceso a un sistema:\n\n1️⃣ Tu **jefe directo** debe aprobar el acceso primero\n2️⃣ Crea un **Requerimiento** en el portal → tipo: "Solicitud de acceso"\n3️⃣ Indica el sistema exacto y el nivel de acceso requerido\n4️⃣ TI habilita el acceso en **1–2 días hábiles** tras la aprobación\n5️⃣ Recibirás confirmación por correo\n\n⚠️ Si ya fue aprobado hace más de 2 días y no tienes acceso, puedo generar un ticket de seguimiento.\n\n¿A qué sistema necesitas acceso?',
    escalate: false, sort: 32,
    triggers: [
      'solicitar acceso','pedir acceso','necesito acceso','acceso sistema',
      'no tengo acceso','solicitar permiso','acceso carpeta','acceso aplicacion',
      'permiso sistema','habilitar acceso','dar acceso','acceso sap','acceso erp',
      'acceso sharepoint','acceso drive','acceso plataforma'
    ],
    followups: [
      { label:'Crear requerimiento',       next_key:'crear_requerimiento' },
      { label:'Hablar con especialista',   next_key:'hablar_especialista' },
    ]
  },

  // ── EQUIPOS ──────────────────────────────────────────────────────────────────
  {
    key: 'solicitar_equipo', category: 'equipos', title: 'Solicitar equipo', type: 'text',
    response: 'Para solicitar un equipo nuevo:\n\n1️⃣ Crea un **Requerimiento** en el portal de autogestión\n2️⃣ Categoría: **"Equipos y Hardware"**\n3️⃣ Indica: tipo de equipo, motivo y área\n4️⃣ Tu jefe recibirá la solicitud para aprobación\n5️⃣ ⏱️ Tiempo estimado: **2–3 días hábiles** tras aprobación\n\n¿Es reemplazo por falla o equipo nuevo (ingreso de persona)?',
    escalate: false, sort: 40,
    triggers: [
      'solicitar equipo','pedir laptop','necesito laptop','pedir computadora',
      'necesito monitor','solicitar computadora','pedir equipo','necesito teclado',
      'necesito mouse','solicitar pc','nuevo equipo','equipo nuevo',
      'pedir hardware','quiero una laptop','necesito pc nueva','solicitar notebook'
    ],
    followups: [
      { label:'Mi equipo está dañado',    next_key:'equipo_danado'       },
      { label:'Crear requerimiento',      next_key:'crear_requerimiento' },
    ]
  },
  {
    key: 'mi_equipo_asignado', category: 'equipos', title: 'Equipo asignado', type: 'text',
    response: 'Para ver qué equipo tienes asignado:\n\n1️⃣ Ve a **"Mis Activos"** en el portal de autogestión\n2️⃣ Verás: número de serie, modelo, marca y fecha de asignación\n\nSi tu equipo **no aparece** o tiene datos incorrectos, crea una **Incidencia** indicando la discrepancia para que TI lo corrija.\n\n¿Necesitas el número de serie para algo específico?',
    escalate: false, sort: 41,
    triggers: [
      'que equipo tengo','equipo asignado','cual es mi laptop','mi equipo',
      'serial de mi laptop','numero de serie equipo','equipo a mi nombre',
      'laptop asignada','mis activos','inventario personal','ver mis equipos',
      'que computadora tengo'
    ],
    followups: [
      { label:'Garantía de mi equipo',    next_key:'garantia_equipo'     },
      { label:'Mi equipo está dañado',    next_key:'equipo_danado'       },
    ]
  },
  {
    key: 'equipo_danado', category: 'equipos', title: 'Equipo dañado', type: 'text',
    response: 'Si tu equipo tiene daño físico o falla técnica:\n\n1️⃣ Crea una **Incidencia** en el portal de autogestión\n2️⃣ Categoría: **"Hardware"** → selecciona el tipo de daño\n3️⃣ Adjunta una foto del daño si puedes\n4️⃣ Un técnico te contactará para evaluar y coordinar reparación o reemplazo\n\n⚙️ Si el equipo está en **garantía vigente**, el proceso puede involucrar directamente al proveedor.\n\n¿Qué tipo de daño tiene tu equipo?',
    escalate: false, sort: 42,
    triggers: [
      'equipo danado','laptop rota','pantalla rota','teclado roto',
      'equipo no enciende','computadora lenta','pc muy lenta',
      'equipo falla','reportar dano equipo','laptop no prende',
      'disco duro falla','equipo averiado','no funciona mi laptop',
      'pantalla negra','laptop se apaga sola','pc se congela','equipo muerto'
    ],
    followups: [
      { label:'Solicitar equipo nuevo',   next_key:'solicitar_equipo'    },
      { label:'Garantía de mi equipo',    next_key:'garantia_equipo'     },
    ]
  },
  {
    key: 'perdida_equipo', category: 'equipos', title: 'Pérdida o robo de equipo', type: 'escalate',
    response: '⚠️ **Situación crítica — actuando de inmediato.**\n\n**Pasos urgentes:**\n1️⃣ Llama a **Seguridad TI**: ext. 100 (o al número de emergencias de tu empresa)\n2️⃣ TI bloqueará el equipo remotamente para proteger tu información\n3️⃣ Si fue **robo**, presenta la denuncia policial (la necesitarás para el proceso interno)\n4️⃣ Crea una Incidencia con: número de serie (si lo recuerdas), fecha y circunstancias\n\n⚡ Te conecto ahora con un especialista. ¿Puedes confirmar tu **nombre completo**?',
    escalate: true, sort: 43,
    triggers: [
      'perdi laptop','robaron laptop','robo equipo','perdi equipo',
      'extraviado laptop','perdi computadora','me robaron','laptop perdida',
      'equipo perdido','robo computadora','me robaron la laptop','perdi el equipo',
      'reporte de robo equipo','extravie mi computadora'
    ],
    followups: [
      { label:'Hablar con especialista',  next_key:'hablar_especialista' },
    ]
  },
  {
    key: 'devolucion_equipo', category: 'equipos', title: 'Devolución de equipo', type: 'text',
    response: 'Para devolver un equipo corporativo:\n\n1️⃣ Ve a **"Devoluciones"** en el portal de autogestión\n2️⃣ Selecciona el equipo a devolver\n3️⃣ Indica el motivo: fin de contrato, reemplazo, cese, etc.\n4️⃣ Un técnico coordinará la recogida o punto de entrega\n\n📋 **Antes de devolver:** haz backup de tu información personal, el equipo se formatea al recibirlo.\n\n¿Necesitas orientación sobre qué datos respaldar?',
    escalate: false, sort: 44,
    triggers: [
      'devolver equipo','entrega equipo','retorno equipo','devolucion laptop',
      'como devuelvo','entregar computadora','devolver laptop','retorno activo',
      'devolver activo','proceso devolucion','entrega de equipos','devolucion de activos'
    ],
    followups: [
      { label:'Garantía de mi equipo',    next_key:'garantia_equipo'     },
    ]
  },
  {
    key: 'garantia_equipo', category: 'equipos', title: 'Garantía de equipo', type: 'text',
    response: 'Para consultar la garantía de tu equipo:\n\n1️⃣ Ve a **"Garantías"** en el portal de autogestión\n2️⃣ Busca por número de serie o equipo asignado\n3️⃣ Verás: proveedor, fecha de vencimiento y estado\n\n📅 **Garantía vigente:** el proveedor cubre reparaciones por defectos de fábrica.\n📅 **Garantía vencida:** TI evalúa reparación o reemplazo según presupuesto disponible.\n\n¿Tienes el número de serie de tu equipo?',
    escalate: false, sort: 45,
    triggers: [
      'garantia equipo','garantia laptop','equipo en garantia','vigencia garantia',
      'cuando vence garantia','consultar garantia','garantia computadora',
      'cobertura garantia','mi equipo tiene garantia','chequear garantia'
    ],
    followups: [
      { label:'Mi equipo está dañado',    next_key:'equipo_danado'       },
      { label:'Devolver equipo',          next_key:'devolucion_equipo'   },
    ]
  },

  // ── SOFTWARE Y LICENCIAS ────────────────────────────────────────────────────
  {
    key: 'instalar_office', category: 'software', title: 'Instalar Office', type: 'text',
    response: 'Para instalar Microsoft Office en tu equipo corporativo:\n\n1️⃣ Abre el navegador y ve a **portal.office.com**\n2️⃣ Inicia sesión con tu **correo corporativo**\n3️⃣ Clic en "Instalar aplicaciones" → Office 365\n4️⃣ Ejecuta el instalador descargado (tarda aprox. 20 min)\n5️⃣ La licencia se activa automáticamente con tu cuenta\n\n⚠️ Si ves un error de **licencia**, puede que no tengas una asignada. Crea un Requerimiento solicitando licencia Office.\n\n¿Aparece algún error específico?',
    escalate: false, sort: 50,
    triggers: [
      'instalar office','como instalo office','no tengo office','word no funciona',
      'excel no abre','instalar word','instalar excel','microsoft office',
      'office 365','activar office','descargar office','office no instalado',
      'como activo office','office caducado','licencia office vencida'
    ],
    followups: [
      { label:'Solicitar licencia',       next_key:'licencias_software'  },
      { label:'Instalar otro software',   next_key:'instalar_software'   },
    ]
  },
  {
    key: 'instalar_software', category: 'software', title: 'Instalar software', type: 'text',
    response: 'Para instalar software en tu equipo corporativo:\n\n1️⃣ Crea un **Requerimiento** en el portal → categoría: **"Software"**\n2️⃣ Indica: nombre del software, versión y justificación de uso\n3️⃣ Tu jefe directo aprueba la solicitud\n4️⃣ TI instala el software o te provee el instalador autorizado\n\n⚠️ **No instales software sin autorización** — puede violar las políticas de seguridad y generar bloqueos en tu equipo.\n\n¿Qué software necesitas instalar?',
    escalate: false, sort: 51,
    triggers: [
      'instalar software','instalar programa','descargar programa',
      'necesito software','instalar aplicacion','instalar app','instalar zoom',
      'instalar autocad','instalar adobe','quiero instalar','instalar programa empresa',
      'como instalo un programa','pedir instalacion','instalar herramienta'
    ],
    followups: [
      { label:'Instalar Office',          next_key:'instalar_office'     },
      { label:'Solicitar licencia',       next_key:'licencias_software'  },
    ]
  },
  {
    key: 'licencias_software', category: 'software', title: 'Licencias de software', type: 'text',
    response: 'El módulo de **Licencias** de la plataforma administra las licencias corporativas.\n\n🔍 **Para consultar licencias disponibles:**\n• Los administradores pueden ver disponibilidad, asignaciones y vencimientos desde el panel de Licencias.\n\n📋 **Para solicitar una licencia:**\n1️⃣ Crea un **Requerimiento** indicando el software\n2️⃣ TI verifica disponibilidad y te asigna la licencia\n3️⃣ Recibirás instrucciones de activación por correo\n\n¿Qué software necesitas?',
    escalate: false, sort: 52,
    triggers: [
      'licencia software','licencias disponibles','tengo licencia',
      'licencia office','licencia adobe','necesito licencia','consultar licencia',
      'asignar licencia','licencia vencida','renovar licencia','cuantas licencias',
      'licencia disponible','pedir licencia'
    ],
    followups: [
      { label:'Instalar Office',          next_key:'instalar_office'     },
    ]
  },

  // ── VPN Y CONECTIVIDAD ──────────────────────────────────────────────────────
  {
    key: 'vpn_conectar', category: 'conectividad', title: 'Conectarse a VPN', type: 'text',
    response: 'Para conectarte a la VPN corporativa:\n\n🔧 **Primera configuración:**\n1. Descarga **Cisco AnyConnect** desde el portal de TI o pídelo al equipo de soporte\n2. Servidor: **vpn.empresa.com** (pide la dirección exacta a TI)\n3. Usuario y contraseña: los mismos que usas en Windows\n4. Acepta el certificado de seguridad si se solicita\n\n📌 No uses VPN estando dentro de la red de oficina, no es necesario.\n\n¿Es la primera vez que te conectas o ya lo usabas antes?',
    escalate: false, sort: 60,
    triggers: [
      'como conecto vpn','configurar vpn','instalar vpn','conectarme desde casa',
      'trabajo remoto vpn','acceso remoto vpn','cisco anyconnect','vpn corporativa',
      'como uso la vpn','primera vez vpn','configurar acceso remoto',
      'vpn home office','como instalo vpn','acceder desde fuera'
    ],
    followups: [
      { label:'VPN no conecta',           next_key:'vpn_problemas'       },
      { label:'Cambiar contraseña',       next_key:'cambiar_contrasena'  },
    ]
  },
  {
    key: 'vpn_problemas', category: 'conectividad', title: 'Problemas con VPN', type: 'text',
    response: 'Si la VPN no conecta, prueba estos pasos:\n\n1️⃣ **Verifica la contraseña** — es la misma que usas en Windows (puede haber expirado)\n2️⃣ **Reinicia AnyConnect** → ciérralo completamente y vuelve a abrirlo\n3️⃣ **Reinicia el servicio** → Servicios de Windows → "Cisco AnyConnect" → Reiniciar\n4️⃣ **Verifica el servidor** — el nombre del servidor puede haber cambiado\n5️⃣ **Firewall doméstico** — algunos routers bloquean VPN, prueba desde otra red\n\n🔴 Si ves un **código de error específico**, dímelo y te ayudo a interpretarlo.',
    escalate: false, sort: 61,
    triggers: [
      'vpn no conecta','vpn no funciona','error vpn','vpn caida',
      'no puedo conectar vpn','vpn falla','problema vpn','anyconnect error',
      'vpn no carga','vpn lento','vpn se desconecta','vpn da error',
      'no me conecta la vpn','vpn bloqueada'
    ],
    followups: [
      { label:'Cambiar contraseña',       next_key:'cambiar_contrasena'  },
      { label:'Hablar con especialista',  next_key:'hablar_especialista' },
    ]
  },

  // ── IMPRESORAS ───────────────────────────────────────────────────────────────
  {
    key: 'impresora_problemas', category: 'hardware', title: 'Problemas con impresoras', type: 'text',
    response: 'Para problemas con impresoras:\n\n🖨️ **Si no imprime:**\n1. Verifica que la impresora esté encendida, con papel y tóner\n2. Ve a **Herramientas TI → Impresiones** para ver tu cola de impresión\n3. Cancela trabajos atascados y vuelve a intentar\n\n🔌 **Si no aparece en red:**\n1. Verifica tu conexión de red\n2. Intenta reinstalar el controlador desde la web del fabricante\n\nSi el problema persiste, crea una **Incidencia** indicando: modelo de impresora, piso/área y el error exacto.\n\n¿Qué tipo de problema tienes?',
    escalate: false, sort: 70,
    triggers: [
      'impresora no funciona','impresora no imprime','problema impresora',
      'cola de impresion','impresora atascada','no imprime','agregar impresora',
      'impresora red','instalar impresora','impresion no sale','error impresora',
      'impresora offline','la impresora falla','impresora bloqueada','no sale la hoja'
    ],
    followups: [
      { label:'Crear incidencia',         next_key:'crear_incidencia'    },
      { label:'Hablar con especialista',  next_key:'hablar_especialista' },
    ]
  },

  // ── RRHH ────────────────────────────────────────────────────────────────────
  {
    key: 'vacaciones', category: 'rrhh', title: 'Solicitar vacaciones', type: 'text',
    response: 'Las solicitudes de vacaciones se gestionan a través del área de **RRHH**:\n\n📋 **Proceso general:**\n1. Accede al portal de RRHH (consulta a RRHH o a tu jefe el enlace)\n2. Selecciona las fechas deseadas\n3. Tu jefe directo aprueba la solicitud\n4. Recibes confirmación por correo\n\n📌 **Reglas comunes:**\n• Solicitar con mínimo **5 días hábiles** de anticipación\n• Coordinar cobertura con tu equipo durante tu ausencia\n• El número de días disponibles lo gestiona RRHH\n\n¿Tienes alguna duda específica sobre el proceso?',
    escalate: false, sort: 80,
    triggers: [
      'solicitar vacaciones','pedir vacaciones','dias de vacaciones',
      'descanso vacacional','tramite vacaciones','cuantos dias vacaciones',
      'solicitar dias libres','vacaciones pendientes','proceso vacaciones',
      'quien aprueba vacaciones','como pido mis vacaciones','dias de descanso',
      'solicitar permiso vacacional'
    ],
    followups: []
  },

  // ── DIRECTORIO ───────────────────────────────────────────────────────────────
  {
    key: 'directorio_personas', category: 'directorio', title: 'Directorio de personas', type: 'api_directory',
    response: 'Para buscar a alguien en el directorio, dime el **nombre completo** o el **área** de la persona.\n\nPor ejemplo: "número de Juan Pérez" o "correo del jefe de TI".',
    escalate: false, sort: 90,
    triggers: [
      'numero de','telefono de','correo de','extension de','contactar a',
      'como contacto a','email de','quien es el jefe de','buscar contacto',
      'directorio empresa','datos de contacto','informacion de contacto',
      'comunicarme con','interno de','anexo de','celular de'
    ],
    followups: []
  },

  // ── CONOCIMIENTO ─────────────────────────────────────────────────────────────
  {
    key: 'base_conocimiento', category: 'conocimiento', title: 'Base de conocimiento', type: 'text',
    response: 'La **Base de Conocimiento** tiene artículos técnicos, guías paso a paso y procedimientos del equipo de TI.\n\n📚 **Cómo acceder:**\n• Portal de autogestión → **"Base de Conocimiento"**\n• O dime el tema que buscas y te ayudo a encontrarlo\n\n📌 **Artículos frecuentes:**\n• Cómo conectarse a la VPN\n• Configurar correo en el móvil\n• Política de contraseñas corporativas\n• Cómo solicitar equipos\n\n¿Sobre qué tema buscas información?',
    escalate: false, sort: 100,
    triggers: [
      'base de conocimiento','articulo tecnico','guia de','manual de',
      'como hago para','buscar guia','documentacion','tutorial',
      'paso a paso','instrucciones para','aprende a','como funciona',
      'wiki ti','documentos ti','articulos de ayuda'
    ],
    followups: [
      { label:'Crear incidencia',         next_key:'crear_incidencia'    },
      { label:'Crear requerimiento',      next_key:'crear_requerimiento' },
    ]
  },

  // ── ONBOARDING ───────────────────────────────────────────────────────────────
  {
    key: 'onboarding', category: 'general', title: 'Nuevo empleado', type: 'text',
    response: '¡Bienvenido a la empresa! 🎉 Esto es lo que necesitas para empezar:\n\n1️⃣ **Correo corporativo** — pide las credenciales iniciales a RRHH\n2️⃣ **Contraseña de red** — la misma para Windows, Outlook y VPN\n3️⃣ **Accesos a sistemas** — solicita vía **Requerimiento** los sistemas que usarás en tu rol\n4️⃣ **VPN** — para trabajar desde casa (pregúntame cómo configurarla)\n5️⃣ **Directorio** — en el portal puedes buscar a tus compañeros y jefes\n\n¿Hay algo específico con lo que necesitas ayuda para comenzar?',
    escalate: false, sort: 110,
    triggers: [
      'soy nuevo','recien ingrese','primer dia','acabo de entrar',
      'comence a trabajar','nuevo empleado','nuevo ingreso','como empiezo',
      'que necesito configurar','ingrese a la empresa','entro a la empresa',
      'primer dia de trabajo','me acabo de incorporar','ingreso nuevo'
    ],
    followups: [
      { label:'Solicitar acceso a sistemas', next_key:'solicitar_acceso'   },
      { label:'Conectarme a VPN',            next_key:'vpn_conectar'       },
      { label:'Instalar Office',             next_key:'instalar_office'    },
    ]
  },

  // ── SISTEMAS ─────────────────────────────────────────────────────────────────
  {
    key: 'estado_sistemas', category: 'sistemas', title: 'Estado de sistemas', type: 'text',
    response: 'Para reportar o consultar problemas de sistemas:\n\n🔴 **Si un sistema está caído ahora:**\n1. Crea una **Incidencia** con prioridad **Alta o Crítica**\n2. Indica: sistema afectado, desde cuándo y cuántos usuarios impactados\n3. Un especialista NOC tomará el caso\n\n📋 **Mantenimientos programados** se comunican con anticipación vía correo corporativo o anuncios en el portal.\n\n¿Qué sistema está presentando problemas?',
    escalate: false, sort: 120,
    triggers: [
      'sistema caido','esta caido','hay falla general','sistema no funciona',
      'caida del sistema','problema conocido','mantenimiento programado',
      'servidor caido','servicio interrumpido','incidencia masiva',
      'todos tienen el problema','la plataforma cayo','el sistema esta caido',
      'falla de servicio'
    ],
    followups: [
      { label:'Crear incidencia urgente',  next_key:'crear_incidencia'    },
      { label:'Hablar con especialista',   next_key:'hablar_especialista' },
    ]
  },

  // ── ESCALACIÓN ───────────────────────────────────────────────────────────────
  {
    key: 'hablar_especialista', category: 'escalacion', title: 'Hablar con especialista', type: 'escalate',
    response: 'Claro, te conecto con un especialista. 👨‍💻\n\nUn miembro del equipo de soporte tomará tu consulta en breve. Por favor, descríbeme brevemente el motivo para que el especialista esté preparado cuando te atienda.',
    escalate: true, sort: 999,
    triggers: [
      'hablar con alguien','hablar con especialista','necesito un agente',
      'conectar con soporte','quiero hablar con persona','agente humano',
      'soporte en vivo','atencion personalizada','comunicarme con tecnico',
      'escalar problema','persona real','soporte humano','quiero un tecnico',
      'necesito hablar con alguien','agente de soporte'
    ],
    followups: []
  },
];
