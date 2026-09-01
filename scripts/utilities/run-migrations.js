'use strict';
require('dotenv').config();
const { Umzug, SequelizeStorage } = require('umzug');
const { Sequelize } = require('sequelize');
const path = require('path');

const sequelize = require('../../src/config/database');

const umzug = new Umzug({
  migrations: {
    glob: path.join(__dirname, '../../src/migrations/*.js'),
    resolve: ({ name, path: mPath, context }) => {
      const migration = require(mPath);
      return { name, up: () => migration.up(context, Sequelize), down: () => migration.down(context, Sequelize) };
    },
  },
  context:  sequelize.getQueryInterface(),
  storage:  new SequelizeStorage({ sequelize }),
  logger:   console,
});

umzug.up()
  .then(migrations => {
    if (migrations.length === 0) {
      console.log('✅ No hay migraciones pendientes.');
    } else {
      console.log(`✅ ${migrations.length} migración(es) ejecutada(s):`);
      migrations.forEach(m => console.log('  +', m.name));
    }
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  });
