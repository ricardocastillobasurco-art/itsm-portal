'use strict';

/**
 * Configuración del tenant: Integratel
 * Equipo responsable: [equipo-integratel]
 * ID en BD: 1
 */
module.exports = {
    id:   1,
    slug: 'integratel',
    name: 'Integratel',
    domain: 'integratel.com.pe',

    allowedEmailDomains: ['@integratel.com.pe', '@stefanini.com'],

    features: {
        jira:          true,
        printQueue:    true,
        microsoftTools:true,
        azureAD:       true,
        localTickets:  false,
    },

    branding: {
        bannerImage:    'banner-promo.jpg',
        bannerLink:     'https://integratelcorp.sharepoint.com/',
        primaryColor:   '#2563eb',
    },

    portal: {
        sharepoint: {
            enabled: true,
            url:     'https://integratelcorp.sharepoint.com/',
        },
    },
};
