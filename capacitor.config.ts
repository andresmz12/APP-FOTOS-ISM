import type { CapacitorConfig } from '@capacitor/cli';

// FieldProof es una app web (Express + Postgres). La ruta "/" es la camara
// publica (sin cuenta ni empresa: cualquiera la usa igual que Timestamp
// Camera / GPS Map Camera). Un app nativo (Play Store / App Store) apunta esa
// URL en vivo dentro del WebView de Capacitor, en vez de empaquetar HTML
// estatico, para que use siempre el mismo backend que la version web.
//
// Configura antes de compilar:
//   CAPACITOR_SERVER_URL  -> dominio de produccion, ej. https://app.fieldproof.com
//   CAPACITOR_START_PATH  -> ruta de entrada; "/" (la camara publica) por defecto.
//                            Usa /c/<slug> solo si quieres empaquetar la app
//                            de una empresa especifica en vez de la publica.
const serverUrl = process.env.CAPACITOR_SERVER_URL || 'https://REEMPLAZA-CON-TU-DOMINIO.com';
const startPath = process.env.CAPACITOR_START_PATH || '/';

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
