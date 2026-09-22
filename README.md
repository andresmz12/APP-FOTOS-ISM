# FieldProof

Dos productos en un mismo repo:

1. **Camara publica** (`/`, `public/index.html` + `camera.js`): una app de
   "timestamp camera" para cualquier persona, gratis, sin cuenta ni registro.
   Toma la foto, se quema la ubicacion exacta y la fecha/hora, y se guarda
   directo en el telefono (no sube nada a ningun servidor). Es la puerta de
   entrada de la app y lo que se publica en Play Store / App Store.
2. **SaaS multi-tenant de evidencia de campo** (`/c/<slug>`): para empresas
   (limpieza, mantenimiento, inspecciones, construccion, etc.) que necesitan
   organizar las fotos de varios sitios/trabajadores, con aislamiento total
   de datos por `company_id` y backend en la nube (Cloudinary + Postgres).
   Sigue disponible para quien lo necesite, enlazado desde la camara publica,
   pero ya no es el punto de entrada principal.

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
  index.html, camera.js, camera.css    camara publica (sin cuenta, sin empresa)
  manifest.json, sw.js, icons/         PWA
  c/                                    flujo del trabajador (index.html/app.js) y galeria (gallery.html/js) por empresa
  admin/                                panel de super-admin
```

## Configuracion

1. Copia `.env.example` a `.env` y completa las variables:
   - `DATABASE_URL`: la inyecta Railway automaticamente al conectar el plugin de Postgres.
   - `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET`: de tu cuenta central de Cloudinary (Dashboard → Account Details). No se usa unsigned preset: toda subida pasa por una firma generada en el backend.
   - `SENDGRID_API_KEY` y `SENDGRID_FROM_EMAIL`: crea una API key en el panel de SendGrid (Settings → API Keys) y verifica el dominio o correo remitente en Sender Authentication.
   - `PLATFORM_ADMIN_PASSWORD`: la contrasena unica para entrar a `/admin` (tu panel de super-admin).
   - `SESSION_SECRET`: cadena aleatoria larga para firmar el token de sesion del super-admin.
   - `PUBLIC_APP_URL`: URL publica de la app en Railway, se usa en los correos de aviso.
   - `GOOGLE_MAPS_API_KEY` (opcional): si la defines, la direccion que se quema en las fotos usa Google Maps Geocoding en vez de Nominatim/OpenStreetMap. Da direcciones exactas a nivel de calle en muchas mas zonas de Latinoamerica (Nominatim, al ser gratis y basado en OSM, en varias ciudades/barrios solo tiene datos a nivel de municipio). Se activa en <https://console.cloud.google.com/> habilitando "Geocoding API" y creando una API key — Google da USD 200/mes de credito gratis, que cubre miles de fotos. Sin esta variable, la app sigue funcionando igual pero con Nominatim (gratis, menos preciso en algunas zonas).

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

- **Cualquier persona (camara publica)**: entra a `/`, la app pide ubicacion una vez, toca "Tomar foto" y la guarda/comparte directo desde el telefono (boton de guardar en cada miniatura). No hay cuenta, ni empresa, ni conexion a un backend — 100% en el navegador/app.
- **Trabajador de una empresa clienta**: entra a `/c/<slug>`, escribe el codigo de su sitio, elige tipo de trabajo (Rutina/Proyecto), toma fotos (GPS obligatorio) o las elige de galeria (GPS opcional), y las envia a la nube de su empresa. Cada foto queda con el mismo sello de ubicacion exacta y fecha/hora quemado en la esquina inferior.
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
   CAPACITOR_START_PATH=/
   ```
   (`/` abre la camara publica — es lo que se sube a las tiendas. Solo usa
   `/c/<slug>` si en cambio quieres empaquetar la app de una empresa especifica.)
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
- Completar el cuestionario de "Seguridad de los datos" (que datos se recogen: fotos, ubicacion, y con que fin — para la camara publica, aclarar que las fotos NO salen del telefono).
- Como ahora es una camara de uso general (publico, no solo para tus empresas clientas), esta lista para produccion publica normal, igual que cualquier app de camara/GPS del Play Store.

**Apple App Store (iOS)**
- Cuenta de Apple Developer Program (USD 99/ano).
- Xcode + un Mac (o un servicio de build en la nube tipo Codemagic/Bitrise si no tienes Mac).
- Apple es estricta con apps que son "solo un sitio web envuelto" (guideline 4.2, minimum functionality). La camara publica ya no es solo un sitio: usa camara y GPS nativos, funciona sin conexion (no depende de un backend) y guarda directo al rollo de fotos, que es justo el tipo de funcionalidad que Apple espera de una app de camara.
- **Politica de privacidad publicada en una URL** (obligatoria) y completar la seccion de "Privacidad de la app" (App Privacy) en App Store Connect: que datos se recogen (fotos, ubicacion) y para que — para la camara publica, la respuesta honesta es "ninguno sale del dispositivo".
- Capturas de pantalla por tamano de dispositivo, icono, descripcion, categoria.
- Si mas adelante quieres publicar tambien una version dedicada para una empresa clienta especifica (con su marca, apuntando a `/c/<slug>`), esa si conviene evaluarla como **Apple Business Manager / Custom Apps** en vez de App Store publica.

**En ambos casos**
- Necesitas una politica de privacidad real (puedo redactar un borrador si me dices el nombre legal de la empresa y un correo de contacto).
- El dominio de produccion debe tener HTTPS valido (Capacitor con `cleartext: false` no carga `http://`).

## Publicidad y planes (gratis con anuncios / de pago sin anuncios)

Hay dos modelos de "plan" distintos porque son dos productos distintos:

**Camara publica (`/`)**: no tiene cuentas, asi que el estado "premium" se
guarda por telefono en `localStorage` (`fp_premium`, ver `camera.js`). El
banner `#adBanner` se muestra siempre que ese valor no sea `'1'`. El enlace
"Quitar anuncios" hoy solo avisa que la compra todavia no esta disponible
(ver "Fuera de alcance"): falta conectar una compra real.

**SaaS por empresa (`/c/<slug>`)**: la tabla `companies` ya tenia una columna
`plan` (antes usada para trial/activo del negocio). Se reutiliza ese mismo
campo: `GET /api/companies/:slug` responde `adsEnabled` (`true` salvo que
`plan = 'premium'`), y la app del trabajador oculta su banner cuando la
empresa esta en plan `premium`. El super-admin cambia el plan de una empresa
desde `/admin` (ya soportado por `PATCH` en `src/routes/admin.js`).

Lo que falta para produccion real (a proposito no se hizo hoy, son decisiones
de negocio):

1. **Red de anuncios**: en la app nativa (Capacitor) lo normal es Google
   AdMob (banner nativo, mejor rendimiento que un banner HTML); en la version
   web, Google AdSense u otra red de anuncios web. Cada `<div id="adBanner">`
   (camara publica y app de trabajador) queda como el punto donde se monta
   el SDK que elijas.
2. **Cobro para quitar anuncios**:
   - Camara publica: lo natural es una compra dentro de la app (Google Play
     Billing / Apple In-App Purchase) que, al completarse, guarde
     `fp_premium=1` en el dispositivo. Como no hay cuenta de usuario, esa
     compra no se sincroniza entre dispositivos a menos que se agregue algun
     tipo de identidad (correo, restaurar compra, etc.).
   - SaaS por empresa: conectar una pasarela de pagos (Stripe es la mas
     simple) que, al pagar, actualice `plan = 'premium'` via webhook (hoy es
     manual desde `/admin`).
3. Decidir si el plan gratis del SaaS tiene algun limite adicional (ej.
   cantidad de sitios o fotos) ademas de los anuncios, usando la columna
   `max_sites` que ya existe.

## Fuera de alcance en esta version

- Compra real para quitar anuncios en la camara publica (Google Play Billing
  / Apple In-App Purchase): el enlace "Quitar anuncios" hoy solo informa que
  todavia no esta disponible.
- Cobro/facturacion automatica del SaaS: el estado activo/suspendido y el
  plan (free/premium) se manejan manual desde `/admin`; falta conectar
  Stripe u otra pasarela para que el pago cambie el plan solo.
- Red de anuncios real conectada (los banners estan reservados pero vacios:
  ver seccion "Publicidad y planes").
- Compilacion/firma real de los binarios de Play Store y App Store (requiere
  cuentas de desarrollador y, para iOS, un Mac — ver seccion "App nativa").
- Login de usuario tradicional por empresa (decidido explicitamente).
- Multi-idioma (queda en espanol).
