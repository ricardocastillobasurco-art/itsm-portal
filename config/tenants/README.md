# Configuración por Tenant

Cada carpeta corresponde a un cliente/tenant del sistema.
Los cambios en una carpeta son **completamente independientes** del resto.

## Estructura

```
config/tenants/
├── integratel/
│   ├── config.js          # Config general: features, branding, dominio
│   └── integrations.js    # Jira, Azure AD, Outlook, Intune, Teams
└── petrotal/
    ├── config.js
    └── integrations.js
```

## Agregar un nuevo tenant

1. Crear carpeta: `config/tenants/<slug>/`
2. Copiar `integratel/config.js` y ajustar: id, slug, name, domain, features, branding
3. Copiar `integratel/integrations.js` y configurar cada integración
4. (Opcional) Crear `views/tenants/<slug>/` para overrides de plantillas EJS
5. Insertar el tenant en la tabla `tenants` de la BD con el mismo `id`

## Reglas

- **Credenciales** van en `.env`, no en estos archivos (tokens, passwords)
- **Un equipo por tenant** — solo modificar la carpeta del cliente asignado
- Un bug en `petrotal/config.js` solo afecta a Petrotal; Integratel sigue operando
- El loader (`utils/tenantConfig.js`) aísla errores de carga por tenant

## Variables disponibles en templates EJS

Inyectadas automáticamente por `middleware/tenantLocals.js`:

| Variable | Ejemplo |
|---|---|
| `tenantCfg` | objeto completo de config |
| `tenantCfg.features.jira` | `true` / `false` |
| `tenantCfg.features.printQueue` | `true` / `false` |
| `tenantCfg.branding.bannerImage` | `'banner-promo.jpg'` |
| `tenantCfg.branding.bannerLink` | `'https://...'` o `null` |
| `tenantCfg.name` | `'Integratel'` |
| `jiraEnabled` | shortcut para `tenantCfg.features.jira` |
| `tenantName` | shortcut para `tenantCfg.name` |
