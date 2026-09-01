'use strict';

// Esquema único y fuente de verdad para todas las integraciones.
// Cada integración define sus campos; el frontend los renderiza automáticamente.
// Para agregar una nueva integración: añadir una entrada aquí, cero cambios en vistas.

module.exports = {
  jira: {
    label:  'Jira Software',
    icon:   'bi-kanban-fill',
    color:  '#2563eb',
    fields: [
      { key: 'base_url',    label: 'URL de instancia',   type: 'url',      placeholder: 'https://empresa.atlassian.net',         required: true  },
      { key: 'project_key', label: 'Clave de proyecto',  type: 'text',     placeholder: 'IT',                                    required: false },
      { key: 'username',    label: 'Email de API',       type: 'email',    placeholder: 'admin@empresa.com',                     required: true  },
      { key: 'api_token',   label: 'API Token',          type: 'password', placeholder: 'Token de Jira Cloud',                   required: true,  sensitive: true },
    ],
  },
  microsoft_teams: {
    label:  'Microsoft Teams',
    icon:   'bi-chat-square-dots-fill',
    color:  '#7c3aed',
    fields: [
      { key: 'tenant_id',    label: 'Azure Tenant ID',   type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true  },
      { key: 'client_id',    label: 'Client ID (App)',   type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true  },
      { key: 'client_secret',label: 'Client Secret',     type: 'password', placeholder: '••••••••',                             required: true,  sensitive: true },
      { key: 'webhook_url',  label: 'Webhook URL',       type: 'url',      placeholder: 'https://outlook.office.com/webhooks/...', required: false },
    ],
  },
  intune: {
    label:  'Microsoft Intune',
    icon:   'bi-shield-check-fill',
    color:  '#059669',
    fields: [
      { key: 'tenant_id',    label: 'Azure Tenant ID', type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true  },
      { key: 'client_id',    label: 'Client ID (App)', type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true  },
      { key: 'client_secret',label: 'Client Secret',   type: 'password', placeholder: '••••••••',                             required: true,  sensitive: true },
    ],
  },
  outlook_sync: {
    label:  'Outlook / Email',
    icon:   'bi-envelope-fill',
    color:  '#d97706',
    fields: [
      { key: 'tenant_id',     label: 'Azure Tenant ID',  type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true  },
      { key: 'client_id',     label: 'Client ID (App)',  type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true  },
      { key: 'client_secret', label: 'Client Secret',    type: 'password', placeholder: '••••••••',                             required: true,  sensitive: true },
      { key: 'shared_mailbox',label: 'Buzón compartido', type: 'email',    placeholder: 'it@empresa.com',                      required: false },
    ],
  },
  api_externa: {
    label:  'API Externa / Webhook',
    icon:   'bi-plug-fill',
    color:  '#dc2626',
    fields: [
      { key: 'base_url',       label: 'URL base de la API', type: 'url',      placeholder: 'https://api.sistema.com/v1', required: true  },
      { key: 'api_key',        label: 'API Key',            type: 'password', placeholder: '••••••••',                   required: false, sensitive: true },
      { key: 'webhook_secret', label: 'Webhook Secret',     type: 'password', placeholder: '••••••••',                   required: false, sensitive: true },
    ],
  },
};
