const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const pool = require('../db/pool');
const asyncHandler = require('../utils/asyncHandler');
const { requirePlatformAuth } = require('../middleware/platformAuth');
const { sign } = require('../utils/token');
const { destroyAsset } = require('../services/cloudinary');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

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

// Encuentra la columna que corresponde a "locacion" o "nombre" leyendo el
// texto del encabezado (fila 1), en vez de asumir un orden de columnas fijo
// -- distintos archivos traen el orden distinto (algunos ponen el nombre
// primero, otros el codigo primero).
const LOCATION_KEYWORDS = ['locacion', 'locación', 'ubicacion', 'ubicación', 'codigo', 'código', 'code', 'location', 'store', 'tienda', 'sitio', 'numero', 'número'];
const NAME_KEYWORDS = ['nombre', 'name'];

function findColumnByKeywords(headers, keywords) {
  for (let col = 1; col < headers.length; col++) {
    const h = headers[col];
    if (h && keywords.some((k) => h.includes(k))) return col;
  }
  return null;
}

function detectColumns(headerRow) {
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? '').trim().toLowerCase();
  });

  let codeCol = findColumnByKeywords(headers, LOCATION_KEYWORDS);
  let nameCol = findColumnByKeywords(headers, NAME_KEYWORDS);

  // Si no se reconoce el encabezado de alguna columna (o ambas apuntan a la
  // misma), se usa el orden por defecto: columna A = locacion, columna B = nombre.
  let detected = true;
  if (!codeCol || !nameCol || codeCol === nameCol) {
    codeCol = 1;
    nameCol = 2;
    detected = false;
  }

  return {
    codeCol,
    nameCol,
    detected,
    codeLabel: headers[codeCol] || `columna ${codeCol}`,
    nameLabel: headers[nameCol] || `columna ${nameCol}`
  };
}

// Agrupa filas omitidas por el mismo motivo para no mostrar decenas de
// lineas identicas (ej. muchos "codigo duplicado" del mismo tipo de error).
function summarizeSkipped(skippedRaw) {
  const groups = new Map();
  for (const s of skippedRaw) {
    if (!groups.has(s.reason)) groups.set(s.reason, []);
    groups.get(s.reason).push(s.row);
  }
  return [...groups.entries()].map(([reason, rows]) => ({
    reason,
    rowsLabel: rows.length > 3 ? `${rows.length} filas (${rows[0]}-${rows[rows.length - 1]})` : `fila(s) ${rows.join(', ')}`
  }));
}

// POST /api/admin/companies/:id/sites/bulk -> carga masiva desde Excel/CSV
// con dos columnas: Locacion (codigo) y Nombre. La primera fila se asume
// como encabezado y se ignora (se usa para detectar cual columna es cual).
router.post('/companies/:id/sites/bulk', upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Falta el archivo' });

  const workbook = new ExcelJS.Workbook();
  const isCsv = /\.csv$/i.test(req.file.originalname);

  try {
    if (isCsv) {
      // map identity evita que exceljs convierta valores como "0077" en el
      // numero 77, perdiendo el cero a la izquierda (solo pasa en CSV; en
      // xlsx el tipo de celda ya viene definido en el archivo).
      await workbook.csv.read(Readable.from(req.file.buffer), { map: (value) => value });
    } else {
      await workbook.xlsx.load(req.file.buffer);
    }
  } catch (err) {
    return res.status(400).json({ error: 'No se pudo leer el archivo. Usa un .xlsx o .csv valido.' });
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount < 2) {
    return res.status(400).json({ error: 'El archivo no tiene filas de datos (solo se detecto el encabezado o esta vacio).' });
  }

  const { codeCol, nameCol, detected, codeLabel, nameLabel } = detectColumns(sheet.getRow(1));

  const createdSites = [];
  const skippedRaw = [];

  for (let i = 2; i <= sheet.rowCount; i++) {
    const row = sheet.getRow(i);
    const siteCode = String(row.getCell(codeCol).value ?? '').trim();
    const name = String(row.getCell(nameCol).value ?? '').trim();

    if (!siteCode && !name) continue; // fila vacia, se ignora sin reportar

    if (!siteCode) { skippedRaw.push({ row: i, reason: 'Falta la locacion (codigo)' }); continue; }
    if (!name) { skippedRaw.push({ row: i, reason: `Falta el nombre para la locacion ${siteCode}` }); continue; }

    try {
      const { rows } = await pool.query(
        'insert into sites (company_id, site_code, name) values ($1, $2, $3) returning *',
        [req.params.id, siteCode, name]
      );
      createdSites.push(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        skippedRaw.push({ row: i, reason: `Codigo de locacion duplicado: ${siteCode}` });
      } else {
        throw err;
      }
    }
  }

  res.json({
    created: createdSites.length,
    sites: createdSites,
    skipped: summarizeSkipped(skippedRaw),
    skippedCount: skippedRaw.length,
    columnsDetected: detected,
    columnsUsed: { code: codeLabel, name: nameLabel }
  });
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

// Borra en Cloudinary todas las fotos/videos de los sitios dados, antes de
// borrar los sitios (el borrado en cascada de la base de datos se encarga
// de las filas de jobs/media, pero no de los archivos reales en Cloudinary).
async function destroySitesMedia(siteIds) {
  if (!siteIds.length) return;
  const { rows } = await pool.query(
    `select m.cloudinary_public_id, m.resource_type
     from media m
     join jobs j on j.id = m.job_id
     where j.site_id = any($1)`,
    [siteIds]
  );
  for (const m of rows) {
    try {
      await destroyAsset(m.cloudinary_public_id, m.resource_type);
    } catch (err) {
      console.error('Error borrando asset de Cloudinary al eliminar sitio:', err.message);
    }
  }
}

// DELETE /api/admin/sites/:id -> borrado permanente de un sitio (y sus fotos)
router.delete('/sites/:id', asyncHandler(async (req, res) => {
  const siteId = Number(req.params.id);
  await destroySitesMedia([siteId]);
  const { rows } = await pool.query('delete from sites where id = $1 returning id', [siteId]);
  if (!rows.length) return res.status(404).json({ error: 'Sitio no encontrado' });
  res.json({ deleted: true });
}));

// POST /api/admin/companies/:id/sites/delete-batch -> borrado permanente en lote
router.post('/companies/:id/sites/delete-batch', asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Sin ids' });

  await destroySitesMedia(ids);
  const { rows } = await pool.query(
    'delete from sites where id = any($1) and company_id = $2 returning id',
    [ids, req.params.id]
  );
  res.json({ deleted: rows.length });
}));

module.exports = router;
