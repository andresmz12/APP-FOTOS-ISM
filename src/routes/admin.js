const express = require('express');
const pool = require('../db/pool');
const asyncHandler = require('../utils/asyncHandler');
const { requirePlatformAuth } = require('../middleware/platformAuth');
const { sign } = require('../utils/token');

const router = express.Router();

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  if (!process.env.PLATFORM_ADMIN_PASSWORD) {
    return res.status(500).json({ error: 'PLATFORM_ADMIN_PASSWORD no esta configurada en el servidor' });
  }
  if (password !== process.env.PLATFORM_ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Contrasena incorrecta' });
  }
  const token = sign({ role: 'platform-admin' });
  res.json({ token });
});

router.use(requirePlatformAuth);

// GET /api/admin/companies
router.get('/companies', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    select c.*,
           count(distinct s.id) as site_count,
           count(distinct m.id) as media_count
    from companies c
    left join sites s on s.company_id = c.id
    left join jobs j on j.site_id = s.id
    left join media m on m.job_id = j.id
    group by c.id
    order by c.created_at desc
  `);
  res.json({ companies: rows });
}));

// POST /api/admin/companies
router.post('/companies', asyncHandler(async (req, res) => {
  const { name, industry, admin_pin, notify_email, brand_color, plan, max_sites, logo_url } = req.body;
  if (!name || !admin_pin) {
    return res.status(400).json({ error: 'Nombre y admin_pin son requeridos' });
  }

  let slug = req.body.slug ? slugify(req.body.slug) : slugify(name);
  const { rows: existing } = await pool.query('select 1 from companies where slug = $1', [slug]);
  if (existing.length) slug = `${slug}-${Date.now().toString(36).slice(-4)}`;

  const cloudinaryFolder = `fieldproof/${slug}`;

  const { rows } = await pool.query(
    `insert into companies (slug, name, industry, admin_pin, notify_email, brand_color, plan, max_sites, logo_url, cloudinary_folder)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning *`,
    [slug, name, industry || null, admin_pin, notify_email || null, brand_color || '#17322B', plan || 'trial', max_sites || 10, logo_url || null, cloudinaryFolder]
  );

  res.status(201).json({ company: rows[0] });
}));

// PATCH /api/admin/companies/:id
router.patch('/companies/:id', asyncHandler(async (req, res) => {
  const allowed = ['name', 'industry', 'logo_url', 'brand_color', 'status', 'admin_pin', 'notify_email', 'plan', 'max_sites'];
  const updates = [];
  const params = [];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      params.push(req.body[key]);
      updates.push(`${key} = $${params.length}`);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nada para actualizar' });

  params.push(req.params.id);
  const { rows } = await pool.query(
    `update companies set ${updates.join(', ')} where id = $${params.length} returning *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Empresa no encontrada' });

  res.json({ company: rows[0] });
}));

// GET /api/admin/companies/:id/sites
router.get('/companies/:id/sites', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('select * from sites where company_id = $1 order by name', [req.params.id]);
  res.json({ sites: rows });
}));

// POST /api/admin/companies/:id/sites
router.post('/companies/:id/sites', asyncHandler(async (req, res) => {
  const { site_code, name, address } = req.body;
  if (!site_code || !name) return res.status(400).json({ error: 'site_code y name son requeridos' });

  try {
    const { rows } = await pool.query(
      'insert into sites (company_id, site_code, name, address) values ($1, $2, $3, $4) returning *',
      [req.params.id, site_code, name, address || null]
    );
    res.status(201).json({ site: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un sitio con ese codigo en esta empresa' });
    throw err;
  }
}));

// PATCH /api/admin/sites/:id
router.patch('/sites/:id', asyncHandler(async (req, res) => {
  const allowed = ['site_code', 'name', 'address', 'active'];
  const updates = [];
  const params = [];

  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      params.push(req.body[key]);
      updates.push(`${key} = $${params.length}`);
    }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nada para actualizar' });

  params.push(req.params.id);
  const { rows } = await pool.query(
    `update sites set ${updates.join(', ')} where id = $${params.length} returning *`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'Sitio no encontrado' });

  res.json({ site: rows[0] });
}));

module.exports = router;
