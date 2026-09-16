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

### Si el sitio muestra "Cannot GET /" o no refleja tus ultimos cambios

Railway despliega desde una rama especifica del repo, no siempre desde la que estas
usando. En este repositorio el trabajo vive en la rama `claude/fieldproof-saas-multitenant-akand9`
(no hay rama `main`). Revisa en el dashboard de Railway, pestana **Settings → Source**
del servicio, que:

- La rama conectada sea exactamente la que contiene tus commits.
- **Auto-deploy** este activado, para que cada `git push` dispare un nuevo deploy.

Si acabas de corregir la rama o activar el auto-deploy, Railway no redespliega
retroactivamente los commits que ya existian: necesitas un push nuevo (o el boton
**Deploy** manual en la pestana **Deployments**) para que tome el codigo actual.

## Flujo de uso

- **Trabajador**: entra a `/c/<slug>`, escribe el codigo de su sitio, elige tipo de trabajo (Rutina/Proyecto), toma fotos (GPS obligatorio) o las elige de galeria (GPS opcional), y las envia. Cada foto queda con el sello de ubicacion exacta (direccion o coordenadas) y fecha/hora quemado en la esquina inferior.
- **Admin de empresa**: entra a `/c/<slug>/galeria` con el `admin_pin` de su empresa (ve todos los sitios) o con el codigo de un sitio especifico (ve solo ese sitio). Puede filtrar, descargar en lote (.zip), generar reporte PDF, exportar el Excel de cobertura, y eliminar permanentemente con confirmacion.
- **Super-admin**: entra a `/admin` con `PLATFORM_ADMIN_PASSWORD`. Crea y edita empresas, agrega/activa/desactiva sitios, y suspende o reactiva una empresa manualmente.

## App nativa (Play Store / App Store) con Capacitor

FieldProof es una app web (Express + Postgres), no nativa. Para publicarla en
las tiendas se empaqueta con [Capacitor](https://capacitorjs.com/): un WebView
nativo que carga la app en vivo desde tu dominio de produccion (no una copia
estatica), asi que ambas versiones (web y tienda) siempre usan el mismo
backend/base de datos.

Ya esta en el repo: `capacitor.config.ts`, y los proyectos nativos generados
en `android/` (Android Studio / Gradle) y `ios/` (Xcode). Antes de compilar:

1. Define en tu entorno (o en un `.env` local, no se commitea):
   ```
   CAPACITOR_SERVER_URL=https://tu-dominio-de-produccion.com
   CAPACITOR_START_PATH=/c/tu-slug-de-empresa
   ```
2. Sincroniza los cambios web hacia los proyectos nativos cada vez que cambies algo en `public/`:
   ```
   npm run cap:sync
   ```
3. Abre y compila:
   - Android: `npm run cap:android` (requiere Android Studio) → genera el `.aab` para subir a Play Console.
   - iOS: `npm run cap:ios` (requiere macOS + Xcode) → archiva y sube a App Store Connect.

Ya se agregaron los permisos nativos que la app necesita (camara y ubicacion)
en `AndroidManifest.xml` e `Info.plist`.

### Checklist para publicar

**Google Play (Android)**
- Cuenta de Google Play Console (pago unico de USD 25).
- Generar una key de firma (`keytool`) y guardarla a salvo — Play usa "App Signing", solo necesitas subir la key de subida una vez.
- Icono, capturas de pantalla (telefono y, si aplica, tablet), descripcion corta/larga, categoria.
- **Politica de privacidad publicada en una URL** (obligatoria: la app pide camara y ubicacion).
- Completar el cuestionario de "Seguridad de los datos" (que datos se recogen: fotos, ubicacion, y con que fin).
- Como es una app para trabajadores de empresas clientas (no publico general), considera "Publicacion interna/cerrada" (internal testing / closed testing en Play Console) en vez de produccion publica si no quieres que cualquiera la descargue.

**Apple App Store (iOS)**
- Cuenta de Apple Developer Program (USD 99/ano).
- Xcode + un Mac (o un servicio de build en la nube tipo Codemagic/Bitrise si no tienes Mac).
- Apple es estricta con apps que son "solo un sitio web envuelto" (guideline 4.2, minimum functionality): al usar camara y GPS nativos ya cumple mejor, pero puede pedir justificacion. Tenerlo claro en la descripcion/nota para el revisor ayuda.
- **Politica de privacidad publicada en una URL** (obligatoria) y completar la seccion de "Privacidad de la app" (App Privacy) en App Store Connect: que datos se recogen (fotos, ubicacion) y para que.
- Capturas de pantalla por tamano de dispositivo, icono, descripcion, categoria.
- Si es una herramienta interna para tus empresas clientas y no para el publico general, evalua **Apple Business Manager / distribucion a la medida (Custom Apps)** en vez de la App Store publica — evita la revision publica y el limite de "una empresa = un revisor confundido por una app de nicho".

**En ambos casos**
- Necesitas una politica de privacidad real (puedo redactar un borrador si me dices el nombre legal de la empresa y un correo de contacto).
- El dominio de produccion debe tener HTTPS valido (Capacitor con `cleartext: false` no carga `http://`).

## Publicidad y planes (gratis con anuncios / de pago sin anuncios)

La tabla `companies` ya tenia una columna `plan` (antes usada para trial/activo
del negocio). Se reutiliza ese mismo campo para el modelo de monetizacion:

- El endpoint publico `GET /api/companies/:slug` ahora responde `adsEnabled`
  (`true` salvo que `plan = 'premium'`).
- La app del trabajador (`public/c/index.html` + `app.js`) muestra un banner
  reservado (`#adBanner`) abajo de la pantalla cuando `adsEnabled` es `true`,
  y lo oculta automaticamente si la empresa esta en plan `premium`.
- Para pasar una empresa a "sin anuncios", el super-admin solo cambia su
  `plan` a `premium` desde `/admin` (ya soportado por `PATCH` de empresa en
  `src/routes/admin.js`) — no hace falta tocar codigo.

Lo que falta para produccion real (a proposito no se hizo hoy, son decisiones
de negocio):

1. **Red de anuncios**: en la app nativa (Capacitor) lo normal es Google
   AdMob (banner nativo, mejor rendimiento que un banner HTML); en la version
   web, Google AdSense u otra red de anuncios web. El `<div id="adBanner">`
   queda como el punto donde se monta el SDK que elijas.
2. **Cobro para quitar anuncios**: conectar una pasarela de pagos (Stripe es
   la mas simple de integrar) que, al pagar, actualice `plan = 'premium'`
   automaticamente via webhook (hoy ese cambio es manual desde `/admin`).
3. Decidir si el plan gratis tiene algun limite adicional (ej. cantidad de
   sitios o fotos) ademas de los anuncios, usando la columna `max_sites` que
   ya existe.

## Fuera de alcance en esta version

- Cobro/facturacion automatica: el estado activo/suspendido y el plan
  (free/premium) se manejan manual desde `/admin`; falta conectar Stripe u
  otra pasarela para que el pago cambie el plan solo.
- Red de anuncios real conectada (el banner esta reservado pero vacio: ver
  seccion "Publicidad y planes").
- Compilacion/firma real de los binarios de Play Store y App Store (requiere
  cuentas de desarrollador y, para iOS, un Mac — ver seccion "App nativa").
- Login de usuario tradicional por empresa (decidido explicitamente).
- Multi-idioma (queda en espanol).
