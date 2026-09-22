// Misma logica que shortAddress() en public/c/app.js: direccion corta y legible
// en vez del display_name completo de Nominatim (que puede ser muy largo).
function shortAddress(addr, fallback) {
  if (!addr) return fallback || null;
  const street = [addr.road, addr.house_number].filter(Boolean).join(' ');
  const locality = addr.suburb || addr.neighbourhood || addr.city_district || '';
  const city = addr.city || addr.town || addr.village || addr.municipality || '';
  const state = addr.state || '';
  const parts = [...new Set([street, locality, city, state].filter(Boolean))];
  return parts.slice(0, 3).join(', ') || fallback || null;
}

/**
 * Reverse geocoding gratuito via OpenStreetMap Nominatim (sin API key).
 * En Latinoamerica muchas zonas solo tienen datos a nivel de ciudad/municipio
 * en OSM (no siempre hay calle/numero cargados), asi que la direccion puede
 * salir mas generica de lo esperado. Se usa como respaldo/gratis por defecto.
 */
async function reverseGeocodeNominatim(lat, lng) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'FieldProof/1.0 (evidencia fotografica de campo)' }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return shortAddress(data.address, data.display_name);
}

/**
 * Reverse geocoding con Google Maps (mucho mas preciso a nivel de calle en
 * la mayoria de Latinoamerica que Nominatim/OSM). Requiere GOOGLE_MAPS_API_KEY
 * con el API "Geocoding API" habilitado. Google ya devuelve la direccion
 * formateada lista para mostrar (calle, numero, ciudad, departamento/estado).
 */
async function reverseGeocodeGoogle(lat, lng, apiKey) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${apiKey}&language=es`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== 'OK' || !data.results?.length) return null;
  // Prioriza un resultado a nivel de direccion exacta (street_address/premise)
  // sobre resultados mas generales (locality, ciudad) que Google tambien
  // incluye en la misma respuesta, ordenados de mas a menos especifico.
  const precise = data.results.find((r) =>
    r.types?.some((t) => ['street_address', 'premise', 'subpremise'].includes(t))
  );
  return (precise || data.results[0]).formatted_address || null;
}

/**
 * Punto unico de reverse geocoding: usa Google si hay API key configurada
 * (mas preciso), y si no o si falla, cae a Nominatim (gratis).
 */
async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (apiKey) {
    try {
      const address = await reverseGeocodeGoogle(lat, lng, apiKey);
      if (address) return address;
    } catch (err) {
      console.error('Error en reverse geocoding con Google:', err.message);
    }
  }

  try {
    return await reverseGeocodeNominatim(lat, lng);
  } catch (err) {
    console.error('Error en reverse geocoding con Nominatim:', err.message);
    return null;
  }
}

module.exports = { reverseGeocode };
