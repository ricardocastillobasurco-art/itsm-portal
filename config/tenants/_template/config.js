'use strict';

/**
 * PLANTILLA para nuevo tenant — copiar esta carpeta completa y renombrar.
 * Instrucciones:
 *  1. cp -r config/tenants/_template config/tenants/<slug>
 *  2. Ajustar todos los campos con los datos del cliente
 *  3. Insertar en BD: INSERT INTO tenants (id, slug, name, ...) VALUES (...)
 *  4. Reiniciar el servidor
 */
module.exports = {
    id:   0,                          // ← ID en tabla tenants (BD)
    slug: 'nuevo-cliente',            // ← Debe coincidir con nombre de carpeta
    name: 'Nombre del Cliente',
    domain: 'cliente.com',

    allowedEmailDomains: ['@cliente.com'],

    features: {
        jira:          false,         // ← ¿tiene integración Jira?
        printQueue:    false,         // ← ¿cola de impresión (Azure AD)?
        microsoftTools:false,         // ← ¿Teams, Intune, Outlook masivo?
        azureAD:       false,         // ← ¿autenticación SSO Azure?
        localTickets:  true,          // ← sistema local TK- siempre disponible
    },

    branding: {
        bannerImage:    'banner-promo.jpg',   // ← archivo en public/images/
        bannerLink:     null,                 // ← URL al click, null = sin link
        primaryColor:   '#2563eb',
    },

    portal: {
        sharepoint: {
            enabled: false,
            url:     null,
        },
    },
};
