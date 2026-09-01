# FieldProof

SaaS multi-tenant de evidencia fotografica de campo. Cada empresa clienta
(limpieza, mantenimiento, inspecciones, construccion, etc.) tiene su propio
sitio de trabajo, acceso por codigo (sin login tradicional) y aislamiento
total de datos por `company_id`.

## Stack

- Node.js + Express (API REST + sirve el frontend estatico)
- PostgreSQL (Railway, via `DATABASE_URL`)
- Cloudinary (cuenta central, subida firmada, una carpeta por empresa/sitio/fecha)
- SendGrid (correo de aviso al admin de cada empresa)
- Frontend: HTML/CSS/JS vanilla, PWA instalable
- PDF: `pdfkit` (generado en el servidor) · Excel: `exceljs` · ZIP: `archiver`

## Estructura de carpetas

```
server.js                  punto de entrada Express
src/
  db/                       schema.sql, pool de conexion, script de migracion
  middleware/               resolucion de empresa por slug, auth de admin de empresa, auth de super-admin
  routes/
    public.js               marca publica, checkin, firma de subida, registro de jobs (trabajador)
    media.js                galeria, borrado, zip, reporte PDF, excel de cobertura (admin de empresa)
    admin.js                login y CRUD de empresas/sitios (super-admin)
  services/                 cloudinary.js, email.js (SendGrid), geocode.js (Nominatim)
  utils/                    asyncHandler, firma de token de sesion del super-admin
public/
  manifest.json, sw.js, icons/     PWA
  c/                                flujo del trabajador (index.html/app.js) y galeria (gallery.html/js)
  admin/                            panel de super-admin
```

## Configuracion

1. Copia `.env.example` a `.env` y completa las variables:
   - `DATABASE_URL`: la inyecta Railway automaticamente al conectar el plugin de Postgres.
   - `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`: de tu cuenta central de Cloudinary (Dashboard → Account Details). No se usa unsigned preset: toda subida pasa por una firma generada en el backend.
   - `SENDGRID_API_KEY` y `SENDGRID_FROM_EMAIL`: crea una API key en el panel de SendGrid (Settings → API Keys) y verifica el dominio o correo remitente en Sender Authentication.
   - `PLATFORM_ADMIN_PASSWORD`: la contrasena unica para entrar a `/admin` (tu panel de super-admin).
   - `SESSION_SECRET`: cadena aleatoria larga para firmar el token de sesion del super-admin.
   - `PUBLIC_APP_URL`: URL publica de la app en Railway, se usa en los correos de aviso.

2. Instala dependencias:
   ```
   npm install
   ```

3. Aplica el schema de Postgres:
   ```
   npm run migrate
   ```

4. Arranca en local:
   ```
   npm start
   ```

## Despliegue en Railway

1. Crea un proyecto en Railway y agrega el plugin de PostgreSQL (esto define `DATABASE_URL` automaticamente).
2. Conecta este repositorio como servicio Node.
3. Define las variables de entorno de `.env.example` en el servicio (menos `DATABASE_URL`, que ya la inyecta Railway).
4. El `Procfile` incluye una fase `release: npm run migrate` que aplica el schema en cada deploy, y `web: node server.js` para levantar el servidor.
5. Una vez desplegado, entra a `https://tu-app.up.railway.app/admin` con `PLATFORM_ADMIN_PASSWORD` y crea tu primera empresa. La URL del trabajador queda en `/c/<slug>` y la de galeria en `/c/<slug>/galeria`, disponibles de inmediato sin redeploy.

## Flujo de uso

- **Trabajador**: entra a `/c/<slug>`, escribe el codigo de su sitio, elige tipo de trabajo (Rutina/Proyecto), toma fotos (GPS obligatorio) o las elige de galeria (GPS opcional), y las envia. Cada foto queda con el sello de sitio/direccion/fecha quemado en la esquina inferior.
- **Admin de empresa**: entra a `/c/<slug>/galeria` con el `admin_pin` de su empresa (ve todos los sitios) o con el codigo de un sitio especifico (ve solo ese sitio). Puede filtrar, descargar en lote (.zip), generar reporte PDF, exportar el Excel de cobertura, y eliminar permanentemente con confirmacion.
- **Super-admin**: entra a `/admin` con `PLATFORM_ADMIN_PASSWORD`. Crea y edita empresas, agrega/activa/desactiva sitios, y suspende o reactiva una empresa manualmente.

## Fuera de alcance en esta version

- Cobro/facturacion automatica: el estado activo/suspendido se maneja manual desde `/admin`.
- Login de usuario tradicional por empresa (decidido explicitamente).
- Multi-idioma (queda en espanol).
