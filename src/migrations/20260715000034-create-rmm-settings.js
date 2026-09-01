'use strict';

const DEFAULTS = [
    { key: 'mesh_url',        value: '',  label: 'URL interna de MeshCentral (ej. https://mesh.local)',         is_secret: 0 },
    { key: 'mesh_public_url', value: '',  label: 'URL pública de MeshCentral (para iframe; puede ser igual)',   is_secret: 0 },
    { key: 'mesh_user',       value: '',  label: 'Usuario administrador MeshCentral',                           is_secret: 0 },
    { key: 'mesh_pass',       value: '',  label: 'Contraseña administrador MeshCentral',                        is_secret: 1 },
];

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('rmm_settings', {
            key:       { type: Sequelize.STRING(100), primaryKey: true, allowNull: false },
            value:     { type: Sequelize.TEXT,        allowNull: true,  defaultValue: null },
            label:     { type: Sequelize.STRING(200), allowNull: true },
            is_secret: { type: Sequelize.TINYINT,    allowNull: false, defaultValue: 0 },
            updated_at:{ type: Sequelize.DATE,        allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
        });

        for (const row of DEFAULTS) {
            await queryInterface.bulkInsert('rmm_settings', [{
                key:        row.key,
                value:      row.value || null,
                label:      row.label,
                is_secret:  row.is_secret,
                updated_at: new Date(),
            }]);
        }
    },

    async down(queryInterface) {
        await queryInterface.dropTable('rmm_settings');
    },
};
