require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const publicRoutes = require('./src/routes/public');
const mediaRoutes = require('./src/routes/media');
const adminRoutes = require('./src/routes/admin');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/api/companies', publicRoutes);
app.use('/api/companies', mediaRoutes);
app.use('/api/admin', adminRoutes);

// Rutas amigables del frontend (SPA por carpeta)
app.get('/c/:slug', (req, res) => res.sendFile(path.join(__dirname, 'public', 'c', 'index.html')));
app.get('/c/:slug/galeria', (req, res) => res.sendFile(path.join(__dirname, 'public', 'c', 'gallery.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`FieldProof corriendo en el puerto ${port}`));
