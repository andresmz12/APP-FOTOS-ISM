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
 * Respeta el uso justo de Nominatim: solo se llama una vez por foto tomada.
 * Se usa como respaldo cuando el cliente no pudo geocodificar en el navegador.
 */
async function reverseGeocode(lat, lng) {
  if (lat == null || lng == null) return null;
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'FieldProof/1.0 (evidencia fotografica de campo)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return shortAddress(data.address, data.display_name);
  } catch (err) {
    console.error('Error en reverse geocoding:', err.message);
    return null;
  }
}

module.exports = { reverseGeocode };
