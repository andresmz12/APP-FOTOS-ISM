(function () {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const $ = (id) => document.getElementById(id);
  const files = []; // { id, kind, blob, previewUrl }
  let currentGeo = null; // se resuelve una vez al cargar la pagina, se reusa para todas las fotos de la sesion

  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ============================================================
  // GEOLOCALIZACION: igual que en la app de trabajador (public/c/app.js),
  // con reintento automatico en dos etapas (alta precision primero, baja
  // precision despues) antes de mostrar el error.
  // ============================================================

  function setPhotoControlsEnabled(enabled) {
    $('btnTakePhoto').disabled = !enabled;
    $('btnPickGallery').disabled = false; // no depende del GPS
  }

  function requestLocation() {
    currentGeo = null;
    setPhotoControlsEnabled(false);
    const banner = $('geoBanner');
    banner.className = 'geo-banner geo-loading';
    banner.innerHTML = '<svg class="icon spin" viewBox="0 0 20 20" fill="none"><path d="M17 10a7 7 0 1 1-2.05-4.95" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg><span>Obteniendo tu ubicacion...</span>';

    if (!navigator.geolocation) {
      showGeoError('Tu navegador no soporta geolocalizacion.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => handleGeoSuccess(pos),
      () => {
        navigator.geolocation.getCurrentPosition(
          (pos) => handleGeoSuccess(pos),
          (err2) => showGeoError(geoErrorMessage(err2)),
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 120000 }
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  async function handleGeoSuccess(pos) {
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const address = await reverseGeocodeClient(lat, lng);
    currentGeo = { lat, lng, address: address || `${lat.toFixed(6)}, ${lng.toFixed(6)}` };

    const banner = $('geoBanner');
    banner.className = 'geo-banner geo-ok';
    banner.innerHTML = `<svg class="icon" viewBox="0 0 20 20" fill="none"><path d="M10 18s6-5.2 6-9.6A6 6 0 1 0 4 8.4C4 12.8 10 18 10 18Z" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 8.4l1.7 1.7 3.3-3.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${currentGeo.address}</span>`;
    setPhotoControlsEnabled(true);
  }

  function geoErrorMessage(err) {
    if (err && err.code === 1) {
      return 'Se nego el permiso de ubicacion. Revisa los permisos del sitio/app y reintenta.';
    }
    if (err && err.code === 3) {
      return 'Se tardo demasiado en obtener tu ubicacion (senal debil). Reintenta en un lugar mas despejado.';
    }
    if (err && err.code === 2) {
      return 'No se pudo determinar tu ubicacion. Revisa que el GPS este activado y reintenta.';
    }
    return 'No pudimos obtener tu ubicacion. Revisa que este activada y reintenta.';
  }

  function showGeoError(msg) {
    currentGeo = null;
    setPhotoControlsEnabled(false);
    const banner = $('geoBanner');
    banner.className = 'geo-banner geo-error';
    banner.innerHTML = `<svg class="icon" viewBox="0 0 20 20" fill="none"><path d="M10 18s6-5.2 6-9.6A6 6 0 1 0 4 8.4C4 12.8 10 18 10 18Z" stroke="currentColor" stroke-width="1.6"/><path d="M7.5 6.9l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg><span>${msg}</span><button class="geo-retry" id="btnGeoRetry" type="button">Reintentar</button>`;
    $('btnGeoRetry').addEventListener('click', requestLocation);
  }

  function shortAddress(addr, fallback) {
    if (!addr) return fallback || null;
    const street = [addr.road, addr.house_number].filter(Boolean).join(' ');
    const locality = addr.suburb || addr.neighbourhood || addr.city_district || '';
    const city = addr.city || addr.town || addr.village || addr.municipality || '';
    const state = addr.state || '';
    const parts = [...new Set([street, locality, city, state].filter(Boolean))];
    return parts.slice(0, 3).join(', ') || fallback || null;
  }

  async function reverseGeocodeClient(lat, lng) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
      const data = await res.json();
      return shortAddress(data.address, data.display_name);
    } catch {
      return null;
    }
  }

  requestLocation();

  // ============================================================
  // SELLO ESTILO "TIMESTAMP CAMERA": icono de mapa a la izquierda + direccion,
  // coordenadas exactas y fecha/hora a la derecha, quemado en la foto.
  // Identico al de public/c/app.js (app del trabajador).
  // ============================================================

  function truncateToWidth(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }

  function drawMapIcon(ctx, x, y, size) {
    const r = Math.round(size * 0.16);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + size, y, x + size, y + size, r);
    ctx.arcTo(x + size, y + size, x, y + size, r);
    ctx.arcTo(x, y + size, x, y, r);
    ctx.arcTo(x, y, x + size, y, r);
    ctx.closePath();
    ctx.clip();

    const grad = ctx.createLinearGradient(x, y, x + size, y + size);
    grad.addColorStop(0, '#6b8f7c');
    grad.addColorStop(0.45, '#3f6553');
    grad.addColorStop(1, '#1f3b30');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, size, size);

    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = Math.max(1, size * 0.012);
    for (let i = 1; i < 3; i++) {
      const gx = x + (size / 3) * i;
      ctx.beginPath(); ctx.moveTo(gx, y); ctx.lineTo(gx, y + size); ctx.stroke();
      const gy = y + (size / 3) * i;
      ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + size, gy); ctx.stroke();
    }
    ctx.restore();

    const cx = x + size / 2;
    const cy = y + size * 0.42;
    const pr = size * 0.17;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(cx - pr * 0.95, cy + pr * 0.55);
    ctx.lineTo(cx + pr * 0.95, cy + pr * 0.55);
    ctx.lineTo(cx, cy + pr * 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1f3b30';
    ctx.beginPath();
    ctx.arc(cx, cy, pr * 0.4, 0, Math.PI * 2);
    ctx.fill();
  }

  const MAX_PHOTO_DIMENSION = 2200;

  function stampImage(file, { lat, lng, address }) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(objectUrl);

        let width = img.naturalWidth;
        let height = img.naturalHeight;
        if (Math.max(width, height) > MAX_PHOTO_DIMENSION) {
          const scale = MAX_PHOTO_DIMENSION / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        const hasCoords = lat != null && lng != null;
        const coordsText = hasCoords ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : null;
        const addressText = address || coordsText || 'Ubicacion no disponible';
        const dateText = new Date().toLocaleString('es-MX');

        const pad = Math.round(width * 0.025);
        const mapSize = Math.round(width * 0.16);
        const barHeight = mapSize + pad * 2;

        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(0, height - barHeight, width, barHeight);

        const mapX = pad;
        const mapY = height - barHeight + pad;
        drawMapIcon(ctx, mapX, mapY, mapSize);

        const textX = mapX + mapSize + pad;
        const maxTextWidth = width - textX - pad;
        const addressSize = Math.round(width * 0.026);
        const smallSize = Math.round(width * 0.02);
        const lineGap = Math.round(mapSize * 0.08);

        const showCoordsLine = Boolean(address && coordsText);
        const lineCount = showCoordsLine ? 3 : 2;
        const blockHeight = addressSize + smallSize * (lineCount - 1) + lineGap * (lineCount - 1);
        let cursorY = mapY + (mapSize - blockHeight) / 2 + addressSize * 0.8;

        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = '#fff';
        ctx.font = `700 ${addressSize}px sans-serif`;
        ctx.fillText(truncateToWidth(ctx, addressText, maxTextWidth), textX, cursorY);

        ctx.fillStyle = 'rgba(255,255,255,.8)';
        if (showCoordsLine) {
          cursorY += smallSize + lineGap;
          ctx.font = `500 ${smallSize}px ui-monospace, SFMono-Regular, monospace`;
          ctx.fillText(truncateToWidth(ctx, coordsText, maxTextWidth), textX, cursorY);
          ctx.font = `500 ${smallSize}px sans-serif`;
        } else {
          ctx.font = `500 ${smallSize}px sans-serif`;
        }
        cursorY += smallSize + lineGap;
        ctx.fillText(truncateToWidth(ctx, dateText, maxTextWidth), textX, cursorY);

        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('No se pudo procesar la foto')); };
      img.src = objectUrl;
    });
  }

  // ============================================================
  // Captura, miniaturas y guardado directo en el telefono (sin cuenta, sin
  // empresa, sin subir a ningun servidor: la app publica es 100% local).
  // ============================================================

  async function addFiles(fileList) {
    const list = Array.from(fileList);
    if (!list.length) return;

    const loc = currentGeo || { lat: null, lng: null, address: null };

    for (const file of list) {
      const isVideo = file.type.startsWith('video/');
      const id = Math.random().toString(36).slice(2);
      const entry = { id, kind: isVideo ? 'video' : 'image', file };

      if (!isVideo) {
        try {
          entry.blob = await stampImage(file, loc);
        } catch {
          entry.blob = file;
        }
      } else {
        entry.blob = file;
      }
      entry.previewUrl = URL.createObjectURL(entry.blob);
      files.unshift(entry); // las mas recientes primero
    }
    renderThumbs();
  }

  async function saveToDevice(entry) {
    const filename = (entry.file.name || `foto-${entry.id}`).replace(/\.\w+$/, entry.kind === 'video' ? '' : '.jpg');

    if (navigator.share && navigator.canShare) {
      try {
        const shareFile = new File([entry.blob], filename, { type: entry.blob.type });
        if (navigator.canShare({ files: [shareFile] })) {
          await navigator.share({ files: [shareFile] });
          return;
        }
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }

    const a = document.createElement('a');
    a.href = entry.previewUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function renderThumbs() {
    const grid = $('thumbGrid');
    grid.innerHTML = '';
    files.forEach((f) => {
      const div = document.createElement('div');
      div.className = 'thumb';
      div.innerHTML = f.kind === 'video'
        ? `<video src="${f.previewUrl}" muted></video>`
        : `<img src="${f.previewUrl}" />`;

      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.title = 'Eliminar';
      remove.innerHTML = '<svg viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      remove.onclick = () => {
        URL.revokeObjectURL(f.previewUrl);
        const idx = files.findIndex((x) => x.id === f.id);
        if (idx !== -1) files.splice(idx, 1);
        renderThumbs();
      };
      div.appendChild(remove);

      const save = document.createElement('button');
      save.className = 'save-btn';
      save.title = 'Guardar en el telefono';
      save.innerHTML = '<svg viewBox="0 0 20 20" fill="none"><path d="M10 3v10m0 0l-4-4m4 4l4-4M4 16h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      save.onclick = () => saveToDevice(f);
      div.appendChild(save);

      grid.appendChild(div);
    });
  }

  $('btnTakePhoto').addEventListener('click', () => $('cameraInput').click());
  $('btnPickGallery').addEventListener('click', () => $('galleryInput').click());
  $('cameraInput').addEventListener('change', (e) => {
    if (!currentGeo) {
      toast('Espera a que se obtenga tu ubicacion antes de tomar la foto.');
      e.target.value = '';
      return;
    }
    addFiles(e.target.files);
    e.target.value = '';
  });
  $('galleryInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

  // ============================================================
  // Plan gratis con anuncios / premium sin anuncios. Como esta app publica
  // no tiene cuentas, el estado "premium" se guarda en este telefono
  // (localStorage). El cobro real (Stripe/AdMob) todavia no esta conectado:
  // ver README, seccion "Publicidad y planes".
  // ============================================================

  const PREMIUM_KEY = 'fp_premium';
  function isPremium() {
    try { return localStorage.getItem(PREMIUM_KEY) === '1'; } catch { return false; }
  }

  function refreshAdBanner() {
    const banner = $('adBanner');
    if (banner) banner.classList.toggle('hidden', isPremium());
  }
  refreshAdBanner();

  const adRemoveLink = $('adRemoveLink');
  if (adRemoveLink) {
    adRemoveLink.addEventListener('click', (e) => {
      e.preventDefault();
      toast('Muy pronto podras pagar para quitar los anuncios. Todavia no esta disponible.');
    });
  }
})();
