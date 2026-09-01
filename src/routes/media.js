const express = require('express');
const archiver = require('archiver');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const pool = require('../db/pool');
const asyncHandler = require('../utils/asyncHandler');
const { resolveCompany, requireActiveCompany } = require('../middleware/resolveCompany');
const { requireCompanyAccess } = require('../middleware/companyAccess');
const { destroyAsset } = require('../services/cloudinary');

const router = express.Router();

router.use('/:slug', resolveCompany, requireActiveCompany);

// Construye el filtro SQL segun el alcance de acceso (admin ve todo, sitio ve solo lo suyo)
function scopeFilter(access, params) {
  if (access.scope === 'site') {
    params.push(access.siteId);
    return `and s.id = $${params.length}`;
  }
  return '';
}

function buildFilters(req, params) {
  let clauses = '';
  const { site_id, date_from, date_to, job_type, q } = req.query;

  if (site_id && req.access.scope === 'admin') {
    params.push(site_id);
    clauses += ` and s.id = $${params.length}`;
  }
  if (date_from) {
    params.push(date_from);
    clauses += ` and m.created_at >= $${params.length}`;
  }
  if (date_to) {
    params.push(date_to);
    clauses += ` and m.created_at < ($${params.length}::date + interval '1 day')`;
  }
  if (job_type) {
    params.push(job_type);
    clauses += ` and j.job_type = $${params.length}`;
  }
  if (q) {
    params.push(`%${q}%`);
    clauses += ` and (s.name ilike $${params.length} or j.employee_name ilike $${params.length} or m.gps_address ilike $${params.length})`;
  }
  return clauses;
}

async function queryMedia(req) {
  const params = [req.company.id];
  const scope = scopeFilter(req.access, params);
  const filters = buildFilters(req, params);

  const sql = `
    select m.*, j.employee_name, j.job_type, j.created_at as job_created_at,
           s.id as site_id, s.name as site_name, s.site_code
    from media m
    join jobs j on j.id = m.job_id
    join sites s on s.id = j.site_id
    where s.company_id = $1 ${scope} ${filters}
    order by m.created_at desc
  `;
  const { rows } = await pool.query(sql, params);
  return rows;
}

// GET /api/companies/:slug/media
router.get('/:slug/media', requireCompanyAccess, asyncHandler(async (req, res) => {
  const media = await queryMedia(req);

  let sites = [];
  if (req.access.scope === 'admin') {
    const { rows } = await pool.query(
      'select id, site_code, name, address, active from sites where company_id = $1 order by name',
      [req.company.id]
    );
    sites = rows;
  }

  res.json({ media, sites, scope: req.access.scope });
}));

// DELETE /api/companies/:slug/media/:id
router.delete('/:slug/media/:id', requireCompanyAccess, asyncHandler(async (req, res) => {
  const params = [req.params.id, req.company.id];
  const scope = req.access.scope === 'site' ? 'and s.id = $3' : '';
  if (scope) params.push(req.access.siteId);

  const { rows } = await pool.query(
    `select m.* from media m
     join jobs j on j.id = m.job_id
     join sites s on s.id = j.site_id
     where m.id = $1 and s.company_id = $2 ${scope}`,
    params
  );
  if (!rows.length) return res.status(404).json({ error: 'No encontrado' });

  const media = rows[0];
  await destroyAsset(media.cloudinary_public_id, media.resource_type);
  await pool.query('delete from media where id = $1', [media.id]);

  res.json({ deleted: true });
}));

// POST /api/companies/:slug/media/delete-batch
router.post('/:slug/media/delete-batch', requireCompanyAccess, asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (!ids.length) return res.status(400).json({ error: 'Sin ids' });

  const params = [ids, req.company.id];
  const scope = req.access.scope === 'site' ? 'and s.id = $3' : '';
  if (scope) params.push(req.access.siteId);

  const { rows } = await pool.query(
    `select m.* from media m
     join jobs j on j.id = m.job_id
     join sites s on s.id = j.site_id
     where m.id = any($1) and s.company_id = $2 ${scope}`,
    params
  );

  for (const media of rows) {
    await destroyAsset(media.cloudinary_public_id, media.resource_type);
  }
  await pool.query('delete from media where id = any($1)', [rows.map((r) => r.id)]);

  res.json({ deleted: rows.length });
}));

// GET /api/companies/:slug/media/zip -> descarga en lote (ids separados por coma o todos los filtrados)
router.get('/:slug/media/zip', requireCompanyAccess, asyncHandler(async (req, res) => {
  let media = await queryMedia(req);
  if (req.query.ids) {
    const idSet = new Set(req.query.ids.split(',').map((i) => Number(i)));
    media = media.filter((m) => idSet.has(m.id));
  }
  if (!media.length) return res.status(404).json({ error: 'No hay archivos para descargar' });

  res.attachment(`fieldproof-${req.company.slug}-${Date.now()}.zip`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);

  for (const m of media) {
    const ext = m.resource_type === 'video' ? 'mp4' : 'jpg';
    const filename = `${m.site_name}_${new Date(m.created_at).toISOString().slice(0, 10)}_${m.id}.${ext}`;
    archive.append(await fetchBuffer(m.secure_url), { name: filename });
  }

  archive.finalize();
}));

async function fetchBuffer(url) {
  const res = await fetch(url);
  return Buffer.from(await res.arrayBuffer());
}

// GET /api/companies/:slug/report.pdf -> una foto por pagina
router.get('/:slug/report.pdf', requireCompanyAccess, asyncHandler(async (req, res) => {
  const media = await queryMedia(req);
  const photos = media.filter((m) => m.resource_type === 'image');
  const videosSkipped = media.length - photos.length;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="reporte-${req.company.slug}.pdf"`);

  const doc = new PDFDocument({ margin: 40, autoFirstPage: false });
  doc.pipe(res);

  doc.addPage();
  doc.fontSize(20).text(`Reporte fotografico - ${req.company.name}`, { align: 'center' });
  doc.moveDown();
  doc.fontSize(11).text(`Generado el ${new Date().toLocaleString('es-MX')}`, { align: 'center' });
  doc.fontSize(11).text(`Total de fotos: ${photos.length}`, { align: 'center' });
  if (videosSkipped > 0) {
    doc.moveDown();
    doc.fillColor('gray').text(`Nota: se omitieron ${videosSkipped} video(s), el reporte PDF solo incluye fotos.`, { align: 'center' });
    doc.fillColor('black');
  }

  for (const m of photos) {
    try {
      const buffer = await fetchBuffer(m.secure_url);
      doc.addPage();
      doc.image(buffer, {
        fit: [doc.page.width - 80, doc.page.height - 160],
        align: 'center',
        valign: 'top'
      });
      const footer = `Sitio: ${m.site_name}  |  Trabajador: ${m.employee_name || 'N/A'}  |  ${new Date(m.created_at).toLocaleString('es-MX')}`;
      doc.fontSize(10).text(footer, 40, doc.page.height - 60, { align: 'center', width: doc.page.width - 80 });
    } catch (err) {
      console.error('Error agregando imagen al PDF:', err.message);
    }
  }

  doc.end();
}));

// GET /api/companies/:slug/coverage.xlsx
router.get('/:slug/coverage.xlsx', requireCompanyAccess, asyncHandler(async (req, res) => {
  const { rows: sites } = await pool.query(
    'select id, site_code, name, address, active from sites where company_id = $1 order by name',
    [req.company.id]
  );

  const { rows: stats } = await pool.query(
    `select s.id as site_id,
            count(m.*) filter (where m.resource_type = 'image') as photo_count,
            count(m.*) filter (where m.resource_type = 'video') as video_count,
            max(m.created_at) as last_upload
     from sites s
     left join jobs j on j.site_id = s.id
     left join media m on m.job_id = j.id
     where s.company_id = $1
     group by s.id`,
    [req.company.id]
  );
  const statsBySite = Object.fromEntries(stats.map((s) => [s.site_id, s]));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Cobertura');
  sheet.columns = [
    { header: 'Codigo', key: 'code', width: 14 },
    { header: 'Sitio', key: 'name', width: 30 },
    { header: 'Direccion', key: 'address', width: 34 },
    { header: 'Activo', key: 'active', width: 10 },
    { header: 'Fotos', key: 'photos', width: 10 },
    { header: 'Videos', key: 'videos', width: 10 },
    { header: 'Ultima subida', key: 'last_upload', width: 22 },
    { header: 'Estado de cobertura', key: 'coverage', width: 20 }
  ];
  sheet.getRow(1).font = { bold: true };

  const now = Date.now();
  for (const site of sites) {
    const s = statsBySite[site.id];
    const lastUpload = s && s.last_upload ? new Date(s.last_upload) : null;
    const daysSince = lastUpload ? Math.floor((now - lastUpload.getTime()) / 86400000) : null;
    let coverage = 'Sin fotos';
    if (daysSince !== null) {
      coverage = daysSince <= 2 ? 'Al dia' : daysSince <= 7 ? 'Atrasado' : 'Sin cobertura reciente';
    }

    sheet.addRow({
      code: site.site_code,
      name: site.name,
      address: site.address || '',
      active: site.active ? 'Si' : 'No',
      photos: s ? Number(s.photo_count) : 0,
      videos: s ? Number(s.video_count) : 0,
      last_upload: lastUpload ? lastUpload.toLocaleString('es-MX') : 'Nunca',
      coverage
    });
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="cobertura-${req.company.slug}.xlsx"`);
  await workbook.xlsx.write(res);
  res.end();
}));

module.exports = router;
