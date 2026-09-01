require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const publicRoutes = require('./src/routes/public');
const mediaRoutes = require('./src/routes/media');
const adminRoutes = require('./src/routes/admin');

const REQUIRED_ENV = ['DATABASE_URL', 'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET', 'PLATFORM_ADMIN_PASSWORD'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  console.warn(`ADVERTENCIA: faltan variables de entorno: ${missingEnv.join(', ')}. La subida de fotos y otras funciones fallaran hasta configurarlas.`);
}

const pool = require('./src/db/pool');
const { applySchema } = require('./src/db/migrate');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/companies', publicRoutes);
app.use('/api/companies', mediaRoutes);
app.use('/api/admin', adminRoutes);

// /admin es una ruta exacta (sin comodin) que coincide con una carpeta real en
// public/, asi que va antes de express.static: si no, el middleware estatico
// la intercepta primero y hace un redirect 301 a /admin/ antes de llegar aqui.
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

app.use(express.static(path.join(__dirname, 'public')));

// Estas van despues de express.static a proposito: /c/:slug es un comodin de
// un segmento y si fuera antes, capturaria peticiones a los propios archivos
// de la app (/c/app.js, /c/gallery.js, /c/worker.css) y les devolveria HTML
// en vez del archivo real. Al ir despues, static ya sirvio esos archivos y
// solo llegan aqui los slugs que no son un archivo existente.
app.get('/c/:slug/galeria', (req, res) => res.sendFile(path.join(__dirname, 'public', 'c', 'gallery.html')));
app.get('/c/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'c', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const port = process.env.PORT || 3000;

async function start() {
  if (process.env.DATABASE_URL) {
    try {
      await applySchema(pool);
      console.log('Schema de Postgres verificado/aplicado.');
    } catch (err) {
      console.error('No se pudo aplicar el schema de Postgres al arrancar:', err.message);
    }
  }
  app.listen(port, () => console.log(`FieldProof corriendo en el puerto ${port}`));
}

start();
