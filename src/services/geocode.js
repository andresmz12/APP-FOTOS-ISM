/**
 * Reverse geocoding gratuito via OpenStreetMap Nominatim (sin API key).
 * Respeta el uso justo de Nominatim: solo se llama una vez por foto tomada.
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
    return data.display_name || null;
  } catch (err) {
    console.error('Error en reverse geocoding:', err.message);
    return null;
  }
}

module.exports = { reverseGeocode };
