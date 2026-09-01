'use strict';

/**
 * Configuración del tenant: datatec
 * ID en BD: 6
 * Generado automáticamente desde el portal superadmin.
 * Puedes editar este archivo para ajustar la configuración del cliente.
 */
module.exports = {
    id:   6,
    slug: 'datatec',
    name: 'datatec',
    domain: '',

    allowedEmailDomains: [],

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
