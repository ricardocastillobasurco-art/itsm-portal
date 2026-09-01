'use strict';
module.exports = {
    async up(qi, Sequelize) {
        await qi.createTable('rmm_software_catalog', {
            id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            name:        { type: Sequelize.STRING(120), allowNull: false },
            version:     { type: Sequelize.STRING(40),  allowNull: true },
            description: { type: Sequelize.TEXT,        allowNull: true },
            url:         { type: Sequelize.STRING(1024), allowNull: false },
            sha256:      { type: Sequelize.STRING(64),  allowNull: true },
            type:        { type: Sequelize.ENUM('exe','msi','zip','ps1'), defaultValue: 'exe' },
            silent_args: { type: Sequelize.STRING(512), allowNull: true },
            category:    { type: Sequelize.STRING(60),  defaultValue: 'General' },
            created_at:  { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
            updated_at:  { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP') },
        });

        await qi.createTable('rmm_deploy_jobs', {
            id:         { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
            catalog_id: { type: Sequelize.INTEGER, allowNull: true },
            node_id:    { type: Sequelize.STRING(128), allowNull: false },
            node_name:  { type: Sequelize.STRING(120), allowNull: true },
            app_name:   { type: Sequelize.STRING(120), allowNull: false },
            status:     { type: Sequelize.ENUM('pending','running','ok','error'), defaultValue: 'pending' },
            exit_code:  { type: Sequelize.INTEGER, allowNull: true },
            error_msg:  { type: Sequelize.TEXT, allowNull: true },
            started_by: { type: Sequelize.STRING(120), allowNull: true },
            started_at: { type: Sequelize.DATE, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
            finished_at:{ type: Sequelize.DATE, allowNull: true },
        });

        const seeds = [
            { name: 'Google Chrome', version: 'latest', description: 'Navegador Google Chrome', url: 'https://dl.google.com/chrome/install/ChromeSetup.exe', type: 'exe', silent_args: '/silent /install', category: 'Navegadores' },
            { name: 'Mozilla Firefox', version: 'latest', description: 'Navegador Mozilla Firefox', url: 'https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=es-ES', type: 'exe', silent_args: '-ms', category: 'Navegadores' },
            { name: 'Adobe Acrobat Reader', version: 'latest', description: 'Lector de PDF', url: 'https://get.adobe.com/reader/', type: 'exe', silent_args: '/sAll /rs /rps /msi EULA_ACCEPT=YES', category: 'Utilidades' },
            { name: 'VLC Media Player', version: 'latest', description: 'Reproductor multimedia', url: 'https://get.videolan.org/vlc/last/win64/vlc-3.0.21-win64.exe', type: 'exe', silent_args: '/S', category: 'Multimedia' },
            { name: '7-Zip', version: 'latest', description: 'Compresor de archivos', url: 'https://www.7-zip.org/a/7z2406-x64.exe', type: 'exe', silent_args: '/S', category: 'Utilidades' },
        ];

        for (const s of seeds) {
            await qi.sequelize.query(
                'INSERT INTO rmm_software_catalog (name, version, description, url, type, silent_args, category) VALUES (?,?,?,?,?,?,?)',
                { replacements: [s.name, s.version, s.description, s.url, s.type, s.silent_args, s.category] }
            );
        }
    },
    async down(qi) {
        await qi.dropTable('rmm_deploy_jobs');
        await qi.dropTable('rmm_software_catalog');
    },
};
