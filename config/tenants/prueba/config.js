'use strict';

/**
 * Configuración del tenant: prueba
 * ID en BD: 9
 * Generado automáticamente desde el portal superadmin.
 * Puedes editar este archivo para ajustar la configuración del cliente.
 */
module.exports = {
    id:   9,
    slug: 'prueba',
    name: 'prueba',
    domain: 'prueba.com',

    allowedEmailDomains: ["@prueba.com"],

    features: {
        jira:           true,
        printQueue:     false,
        microsoftTools: true,
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
