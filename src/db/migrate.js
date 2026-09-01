const fs = require('fs');
const path = require('path');

// Idempotente: schema.sql usa "create table if not exists" en todo,
// asi que se puede llamar de forma segura en cada arranque del servidor,
// sin depender de que la plataforma de hosting ejecute una fase de
// release por separado (Railway no siempre corre la linea "release:"
// de un Procfile como si lo hace Heroku).
async function applySchema(pool) {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

if (require.main === module) {
  require('dotenv').config();
  const pool = require('./pool');
  applySchema(pool)
    .then(() => {
      console.log('Migracion completada: schema aplicado.');
      return pool.end();
    })
    .catch((err) => {
      console.error('Error al migrar:', err);
      process.exit(1);
    });
}

module.exports = { applySchema };
