'use strict';

/**
 * Configuración del tenant: Petrotal
 * ID en BD: 5
 * Generado automáticamente desde el portal superadmin.
 * Puedes editar este archivo para ajustar la configuración del cliente.
 */
module.exports = {
    id:   5,
    slug: 'petrotal',
    name: 'Petrotal',
    domain: 'petrotal-corp.com',

    allowedEmailDomains: ["@petrotal-corp.com"],

    features: {
        jira:           false,
        printQueue:     false,
        microsoftTools: false,
        azureAD:        false,
        localTickets:   true,
    },

    branding: {
        bannerImage:  'banner-promo.jpg',
        bannerLink:   null,
        primaryColor: '#2563eb',
    },

    portal: {
        sharepoint: {
            enabled: false,
            url:     null,
        },
    },
};
