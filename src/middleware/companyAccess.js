const pool = require('../db/pool');

/**
 * Verifica que la request traiga un admin_pin valido de la empresa
 * o un site_code valido de un sitio de esa empresa.
 * Adjunta req.access = { scope: 'admin' } o { scope: 'site', siteId }.
 */
async function requireCompanyAccess(req, res, next) {
  const adminPin = req.query.admin_pin || req.body.admin_pin;
  const siteCode = req.query.site_code || req.body.site_code;

  if (adminPin && adminPin === req.company.admin_pin) {
    req.access = { scope: 'admin' };
    return next();
  }

  if (siteCode) {
    const { rows } = await pool.query(
      'select id from sites where company_id = $1 and site_code = $2 and active = true',
      [req.company.id, siteCode]
    );
    if (rows.length) {
      req.access = { scope: 'site', siteId: rows[0].id };
      return next();
    }
  }

  return res.status(401).json({ error: 'Codigo de acceso invalido' });
}

module.exports = { requireCompanyAccess };
