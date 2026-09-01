const pool = require('../db/pool');

/**
 * Resuelve la empresa a partir del :slug en la URL y la adjunta a req.company.
 * Todas las rutas de empresa deben usar esto para nunca confiar en un
 * company_id que venga del cliente.
 */
async function resolveCompany(req, res, next) {
  const { slug } = req.params;
  const { rows } = await pool.query('select * from companies where slug = $1', [slug]);
  if (!rows.length) {
    return res.status(404).json({ error: 'Empresa no encontrada' });
  }
  req.company = rows[0];
  next();
}

function requireActiveCompany(req, res, next) {
  if (req.company.status !== 'active') {
    return res.status(403).json({ error: 'Esta cuenta esta suspendida. Contacta al administrador.' });
  }
  next();
}

module.exports = { resolveCompany, requireActiveCompany };
