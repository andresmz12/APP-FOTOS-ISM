require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('./pool');

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Migracion completada: schema aplicado.');
  await pool.end();
}

migrate().catch((err) => {
  console.error('Error al migrar:', err);
  process.exit(1);
});
