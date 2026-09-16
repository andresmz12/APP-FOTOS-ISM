import type { CapacitorConfig } from '@capacitor/cli';

// FieldProof es una app web multi-tenant (Express + Postgres): cada empresa
// entra por su propio enlace /c/:slug. Un app nativo (Play Store / App Store)
// apunta esa URL en vivo dentro del WebView de Capacitor, en vez de empaquetar
// HTML estatico, para que use siempre el mismo backend/base de datos que la
// version web y no haya que republicar la app cada vez que cambia el sitio.
//
// Configura antes de compilar:
//   CAPACITOR_SERVER_URL  -> dominio de produccion, ej. https://app.fieldproof.com
//   CAPACITOR_START_PATH  -> ruta de entrada, ej. /c/ism (el slug de la empresa)
const serverUrl = process.env.CAPACITOR_SERVER_URL || 'https://REEMPLAZA-CON-TU-DOMINIO.com';
const startPath = process.env.CAPACITOR_START_PATH || '/c/ism';

const config: CapacitorConfig = {
  appId: 'com.fieldproof.app',
  appName: 'FieldProof',
  webDir: 'public',
  server: {
    url: `${serverUrl}${startPath}`,
    cleartext: false
  },
  android: {
    allowMixedContent: false
  },
  plugins: {
    Camera: {},
    Geolocation: {}
  }
};

export default config;
