'use strict';

// Amplía el ENUM 'role' para incluir todos los roles usados en la app
// y añade la columna tenant_id que faltaba en la definición original.

module.exports = {
    async up(queryInterface, Sequelize) {
        const qi = queryInterface;

        // 1. Ampliar ENUM (MySQL requiere redefinir todo el ENUM)
        await qi.sequelize.query(`
            ALTER TABLE users
            MODIFY COLUMN role ENUM(
                'admin',
                'agente',
                'usuario',
                'supervisor',
                'administrador',
                'especialista',
                'tecnico',
                'superadmin'
            ) NOT NULL DEFAULT 'usuario'
        `);

        // 2. Añadir tenant_id si no existe
        const tableDesc = await qi.describeTable('users');
        if (!tableDesc.tenant_id) {
            await qi.addColumn('users', 'tenant_id', {
                type:         Sequelize.DataTypes.INTEGER,
                allowNull:    true,
                defaultValue: null,
                after:        'role',
            });
        }
    },

    async down(queryInterface) {
        await queryInterface.sequelize.query(`
            ALTER TABLE users
            MODIFY COLUMN role ENUM('admin','agente','usuario','supervisor')
            NOT NULL DEFAULT 'usuario'
        `);
        await queryInterface.removeColumn('users', 'tenant_id').catch(() => {});
    },
};
