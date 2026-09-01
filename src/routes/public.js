const express = require('express');
const pool = require('../db/pool');
const asyncHandler = require('../utils/asyncHandler');
const { resolveCompany, requireActiveCompany } = require('../middleware/resolveCompany');
const { signUpload } = require('../services/cloudinary');
const { reverseGeocode } = require('../services/geocode');
const { sendJobNotification } = require('../services/email');

const router = express.Router();

// GET /api/companies/:slug -> marca publica de la empresa
router.get('/:slug', resolveCompany, (req, res) => {
  const c = req.company;
  res.json({
    slug: c.slug,
    name: c.name,
    industry: c.industry,
    logoUrl: c.logo_url,
    brandColor: c.brand_color,
    status: c.status
  });
});

// POST /api/companies/:slug/resolve-code -> un solo codigo, decide si es de sitio (trabajador) o admin_pin (galeria)
router.post('/:slug/resolve-code', resolveCompany, requireActiveCompany, asyncHandler(async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Escribe un codigo' });

  if (code === req.company.admin_pin) {
    return res.json({ role: 'admin' });
  }

  const { rows } = await pool.query(
    'select id, name, address from sites where company_id = $1 and site_code = $2 and active = true',
    [req.company.id, code]
  );
  if (rows.length) {
    return res.json({ role: 'site', site: rows[0] });
  }

  return res.status(404).json({ error: 'Codigo invalido' });
}));

// POST /api/companies/:slug/checkin -> valida codigo de sitio
router.post('/:slug/checkin', resolveCompany, requireActiveCompany, asyncHandler(async (req, res) => {
  const { site_code } = req.body;
  if (!site_code) return res.status(400).json({ error: 'Falta el codigo de sitio' });

  const { rows } = await pool.query(
    'select id, name, address from sites where company_id = $1 and site_code = $2 and active = true',
    [req.company.id, site_code]
  );

  if (!rows.length) return res.status(404).json({ error: 'Codigo de sitio invalido' });

  res.json({ site: rows[0] });
}));

// POST /api/companies/:slug/upload-signature -> firma de Cloudinary
router.post('/:slug/upload-signature', resolveCompany, requireActiveCompany, asyncHandler(async (req, res) => {
  const { site_code, resource_type } = req.body;
  if (!site_code) return res.status(400).json({ error: 'Falta el codigo de sitio' });

  const { rows } = await pool.query(
    'select id from sites where company_id = $1 and site_code = $2 and active = true',
    [req.company.id, site_code]
  );
  if (!rows.length) return res.status(404).json({ error: 'Codigo de sitio invalido' });

  const today = new Date().toISOString().slice(0, 10);
  const folder = `${req.company.cloudinary_folder}/${site_code}/${today}`;
  const signature = signUpload({ folder, resourceType: resource_type });

  res.json(signature);
}));

// POST /api/companies/:slug/jobs -> registra job + media, dispara correo
router.post('/:slug/jobs', resolveCompany, requireActiveCompany, asyncHandler(async (req, res) => {
  const { site_code, employee_name, job_type, media } = req.body;

  if (!site_code || !Array.isArray(media) || !media.length) {
    return res.status(400).json({ error: 'Faltan datos del trabajo o fotos' });
  }

  const { rows: siteRows } = await pool.query(
    'select id, name from sites where company_id = $1 and site_code = $2 and active = true',
    [req.company.id, site_code]
  );
  if (!siteRows.length) return res.status(404).json({ error: 'Codigo de sitio invalido' });
  const site = siteRows[0];

  const jobType = job_type === 'Proyecto' ? 'Proyecto' : 'Rutina';

  const { rows: jobRows } = await pool.query(
    'insert into jobs (site_id, employee_name, job_type) values ($1, $2, $3) returning id',
    [site.id, employee_name || null, jobType]
  );
  const jobId = jobRows[0].id;

  const insertedMedia = [];
  for (const m of media) {
    if (!m.public_id || !m.secure_url || !m.resource_type) continue;

    let gpsAddress = m.gps_address || null;
    if (!gpsAddress && m.gps_lat != null && m.gps_lng != null) {
      gpsAddress = await reverseGeocode(m.gps_lat, m.gps_lng);
    }

    const { rows } = await pool.query(
      `insert into media (job_id, cloudinary_public_id, secure_url, resource_type, gps_lat, gps_lng, gps_address)
       values ($1, $2, $3, $4, $5, $6, $7) returning *`,
      [jobId, m.public_id, m.secure_url, m.resource_type, m.gps_lat || null, m.gps_lng || null, gpsAddress]
    );
    insertedMedia.push(rows[0]);
  }

  sendJobNotification({
    to: req.company.notify_email,
    companyName: req.company.name,
    siteName: site.name,
    employeeName: employee_name,
    jobType,
    media: insertedMedia,
    appUrl: `${process.env.PUBLIC_APP_URL || ''}/c/${req.company.slug}`
  }).catch((err) => console.error('Error enviando correo de aviso:', err.message));

  res.status(201).json({ job_id: jobId, media_count: insertedMedia.length });
}));

module.exports = router;
