(function () {
  const slug = location.pathname.split('/')[2];
  if (!slug) {
    document.body.innerHTML = '<p style="padding:20px">Falta el identificador de empresa en la URL.</p>';
    return;
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  const state = {
    company: null,
    site: null,
    employeeName: '',
    jobType: 'Rutina',
    files: [] // { id, kind, file, blob, previewUrl, lat, lng, address, status, progress }
  };

  let currentGeo = null; // se resuelve una vez al entrar al paso de fotos, se reusa para todo el lote

  const $ = (id) => document.getElementById(id);
  const steps = { 1: $('step1'), 2: $('step2'), 3: $('step3'), 4: $('step4') };
  const stepOrder = [1, 2, 3, 4];
  let currentStepNum = 1;

  // Calcula si un color de marca es claro u oscuro y define variables CSS
  // de texto con contraste seguro, para que un color de marca palido (o
  // blanco) no deje texto blanco invisible sobre fondo blanco.
  function applyBrandColors(hex) {
    const color = hex || '#17322B';
    document.documentElement.style.setProperty('--brand', color);

    const clean = color.replace('#', '');
    let light = false;
    if (clean.length === 6) {
      const r = parseInt(clean.slice(0, 2), 16);
      const g = parseInt(clean.slice(2, 4), 16);
      const b = parseInt(clean.slice(4, 6), 16);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      light = luminance > 0.6;
    }

    document.documentElement.style.setProperty('--brand-fg', light ? '#12181a' : '#ffffff');
    document.documentElement.style.setProperty('--brand-fg-soft', light ? 'rgba(18,24,26,.62)' : 'rgba(255,255,255,.62)');
    document.documentElement.style.setProperty('--brand-text', light ? '#12181a' : color);
  }

  // --- Transiciones direccionales tipo app nativa entre pasos ---
  // transitionGen evita que dos transiciones superpuestas (ej. navegacion
  // rapida antes de que termine la limpieza de la anterior) dejen un paso
  // viejo visible encimado con el nuevo.
  let transitionGen = 0;

  function cleanupStep(el) {
    el.classList.remove('active', 'anim-enter-fwd', 'anim-enter-back', 'anim-exit-fwd', 'anim-exit-back', 'anim-center');
    el.style.position = '';
    el.style.top = '';
    el.style.left = '';
    el.style.width = '';
  }

  function goToStep(n) {
    if (n === currentStepNum) return;
    transitionGen++;
    const gen = transitionGen;
    const forward = stepOrder.indexOf(n) > stepOrder.indexOf(currentStepNum);
    const currentEl = steps[currentStepNum];
    const nextEl = steps[n];

    // Por si una transicion anterior no alcanzo a limpiar su paso saliente,
    // se fuerza de inmediato aqui antes de arrancar la nueva.
    Object.values(steps).forEach((el) => {
      if (el !== currentEl && el !== nextEl) cleanupStep(el);
    });

    nextEl.classList.add('active');
    nextEl.classList.add(forward ? 'anim-enter-fwd' : 'anim-enter-back');

    if (currentEl) {
      currentEl.style.position = 'absolute';
      currentEl.style.top = '0';
      currentEl.style.left = '0';
      currentEl.style.width = '100%';
    }

    void nextEl.offsetWidth; // fuerza reflow para que la transicion inicial no se salte

    requestAnimationFrame(() => {
      if (gen !== transitionGen) return;
      nextEl.classList.remove('anim-enter-fwd', 'anim-enter-back');
      nextEl.classList.add('anim-center');
      if (currentEl) currentEl.classList.add(forward ? 'anim-exit-fwd' : 'anim-exit-back');
    });

    setTimeout(() => {
      if (gen !== transitionGen) return; // ya arranco otra transicion, esta limpieza ya no aplica
      if (currentEl && currentEl !== nextEl) cleanupStep(currentEl);
      nextEl.classList.remove('anim-center');
    }, 340);

    currentStepNum = n;
    window.scrollTo(0, 0);

    const progress = $('stepProgress');
    if (progress) {
      progress.style.display = n === 4 ? 'none' : 'flex';
      progress.querySelectorAll('.step-dot').forEach((dot) => {
        const dotStep = Number(dot.dataset.step);
        dot.classList.toggle('active', dotStep === n);
        dot.classList.toggle('done', dotStep < n);
      });
    }
  }

  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  async function api(path, opts) {
    const res = await fetch(`/api/companies/${slug}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
  }

  // --- Carga de marca de la empresa ---
  async function loadCompany() {
    try {
      const c = await api('');
      state.company = c;
      $('companyName').textContent = c.name;
      document.title = `${c.name} - FieldProof`;
      applyBrandColors(c.brandColor);
      $('topbar').style.background = c.brandColor || '#17322B';
      if (c.logoUrl) $('logo').src = c.logoUrl;
      if (c.status !== 'active') {
        $('suspendedBanner').style.display = 'block';
        document.querySelectorAll('#keypad button').forEach((b) => { b.disabled = true; });
      }
    } catch (err) {
      $('companyName').textContent = 'Empresa no encontrada';
      $('step1').innerHTML = '<div class="card">No se encontro esta empresa. Verifica el enlace.</div>';
    }
  }
  loadCompany();

  // --- Paso 1: teclado numerico con deteccion en vivo. Sin boton "Continuar":
  // en cuanto el codigo escrito coincide con un sitio o con el admin_pin de
  // la empresa, avanza solo. Si es el PIN de admin, se manda directo a la
  // galeria (guardando la credencial para que no tenga que volver a escribirla).
  let codeBuffer = '';
  let codeCheckTimer = null;
  let codeResolved = false;

  function buildKeypad() {
    const kp = $('keypad');
    kp.innerHTML = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '#', '0', 'back'];
    keys.forEach((k) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      if (k === 'back') {
        btn.className = 'ghost';
        btn.innerHTML = '<svg viewBox="0 0 20 20" fill="none"><path d="M8 5H16a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8l-5-5 5-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M11 8.5l3 3m0-3-3 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
        btn.addEventListener('click', () => codePress('back'));
      } else {
        btn.textContent = k;
        btn.addEventListener('click', () => codePress(k));
      }
      kp.appendChild(btn);
    });
  }
  buildKeypad();

  function renderCodeDisplay() {
    $('siteCode').value = codeBuffer;
  }

  function codePress(k) {
    if (codeResolved) return; // ya se encontro coincidencia, esperando avanzar/redirigir
    if (k === 'back') {
      codeBuffer = codeBuffer.slice(0, -1);
    } else if (codeBuffer.length < 8) {
      codeBuffer += k;
    }
    renderCodeDisplay();
    $('step1Error').textContent = '';
    $('siteConfirm').classList.add('hidden');

    clearTimeout(codeCheckTimer);
    if (codeBuffer.length >= 2) {
      codeCheckTimer = setTimeout(() => checkCode(codeBuffer), 300);
    }
  }

  async function checkCode(code) {
    try {
      const result = await api('/resolve-code', { method: 'POST', body: JSON.stringify({ code }) });
      if (code !== codeBuffer) return; // el usuario siguio escribiendo mientras se resolvia
      codeResolved = true;

      if (result.role === 'admin') {
        sessionStorage.setItem(`fp-cred-${slug}`, JSON.stringify({ param: 'admin_pin', value: code }));
        $('siteConfirmName').textContent = 'Entrando como administrador...';
        $('siteConfirm').classList.remove('hidden');
        setTimeout(() => { location.href = `/c/${slug}/galeria`; }, 400);
        return;
      }

      // Se usa site.site_code (el valor real guardado, ej. "#2160") y no lo
      // que el trabajador escribio en el teclado (podria faltarle el "#"),
      // para que las llamadas siguientes (firma de subida, registro del
      // trabajo) coincidan exacto con lo que espera el backend.
      const { site } = result;
      state.site = { ...site };
      $('siteNameDisplay').textContent = site.name;
      $('siteAddressDisplay').textContent = site.address || '';

      $('siteConfirmName').textContent = site.name;
      $('siteConfirm').classList.remove('hidden');
      setTimeout(() => goToStep(2), 450);
    } catch (err) {
      // codigo aun incompleto o invalido: no se muestra error mientras se sigue
      // escribiendo, solo si ya se alcanzo el largo maximo sin coincidencia
      if (code === codeBuffer && codeBuffer.length >= 8) {
        $('step1Error').textContent = 'Codigo no reconocido';
      }
    }
  }

  // --- Paso 2: detalles ---
  document.querySelectorAll('.job-type-option').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.job-type-option').forEach((o) => o.classList.remove('selected'));
      el.classList.add('selected');
      state.jobType = el.dataset.value;
    });
  });
  $('btnBackTo1').addEventListener('click', () => {
    codeBuffer = '';
    codeResolved = false;
    clearTimeout(codeCheckTimer);
    renderCodeDisplay();
    $('siteConfirm').classList.add('hidden');
    goToStep(1);
  });
  $('btnToStep3').addEventListener('click', () => {
    state.employeeName = $('employeeName').value.trim();
    goToStep(3);
    requestLocation();
  });

  // --- Paso 3: fotos ---
  $('btnBackTo2').addEventListener('click', () => goToStep(2));

  // ============================================================
  // GEOLOCALIZACION: se resuelve una sola vez al entrar al paso de
  // fotos (no hasta que tocas "tomar foto"), con reintento automatico
  // en dos etapas: primero alta precision (GPS real), y si falla o
  // tarda, un segundo intento con precision mas baja (wifi/red) antes
  // de rendirse — esto es lo que mas falla en Android bajo techo o con
  // mala senal, aunque la ubicacion este activada.
  // ============================================================

  function setPhotoControlsEnabled(enabled) {
    $('btnTakePhoto').disabled = !enabled;
    // "Elegir de galeria" siempre esta disponible, no depende del GPS
    $('btnPickGallery').disabled = false;
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
        // Primer intento con alta precision fallo o tardo: reintenta con
        // precision mas baja antes de rendirse.
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
      return 'Se nego el permiso de ubicacion. En Android: Ajustes → Apps → (este navegador) → Permisos → Ubicacion → permitir. Luego reintenta.';
    }
    if (err && err.code === 3) {
      return 'Se tardo demasiado en obtener tu ubicacion (senal debil). Si puedes, sal a un lugar mas despejado y reintenta.';
    }
    if (err && err.code === 2) {
      return 'No se pudo determinar tu ubicacion en este momento. Revisa que el GPS este activado y reintenta.';
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

  // Construye una direccion corta y legible a partir de los componentes de Nominatim
  // en vez de usar display_name completo (que puede tener 100+ caracteres y desbordar el sello).
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

  // Recorta el texto con "..." si no cabe en el ancho disponible del sello
  function truncateToWidth(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) {
      t = t.slice(0, -1);
    }
    return t + '…';
  }

  const MAX_PHOTO_DIMENSION = 2200; // limita el lado mayor para subidas rapidas y confiables en campo

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

        const lines = [
          state.site.name,
          address || (lat && lng ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : 'Ubicacion no disponible'),
          new Date().toLocaleString('es-MX')
        ];

        const pad = Math.round(width * 0.02);
        const lineHeight = Math.round(width * 0.028);
        const fontSize = Math.round(width * 0.022);
        const boxHeight = lineHeight * lines.length + pad;

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, height - boxHeight, width, boxHeight);

        ctx.fillStyle = '#fff';
        ctx.font = `600 ${fontSize}px sans-serif`;
        const maxTextWidth = width - pad * 2;
        lines.forEach((line, i) => {
          const text = truncateToWidth(ctx, line, maxTextWidth);
          ctx.fillText(text, pad, height - boxHeight + pad / 2 + lineHeight * (i + 1) - lineHeight * 0.3);
        });

        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
      };
      img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('No se pudo procesar la foto')); };
      img.src = objectUrl;
    });
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList);
    if (!files.length) return;

    const loc = currentGeo || { lat: null, lng: null, address: null };

    for (const file of files) {
      const isVideo = file.type.startsWith('video/');
      const id = Math.random().toString(36).slice(2);
      const entry = { id, kind: isVideo ? 'video' : 'image', file, lat: loc.lat, lng: loc.lng, address: loc.address, status: 'ready', progress: 0 };

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
      state.files.push(entry);
    }
    renderThumbs();
  }

  function renderThumbs() {
    const grid = $('thumbGrid');
    grid.innerHTML = '';
    state.files.forEach((f) => {
      const div = document.createElement('div');
      div.className = 'thumb';
      div.dataset.id = f.id;
      div.innerHTML = f.kind === 'video'
        ? `<video src="${f.previewUrl}" muted></video>`
        : `<img src="${f.previewUrl}" />`;
      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.innerHTML = '<svg viewBox="0 0 20 20" fill="none"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      remove.onclick = () => {
        URL.revokeObjectURL(f.previewUrl);
        state.files = state.files.filter((x) => x.id !== f.id);
        renderThumbs();
      };
      div.appendChild(remove);
      if (f.status !== 'ready') {
        const status = document.createElement('div');
        status.className = 'status' + (f.status === 'local' ? ' status-warn' : '');
        status.textContent = f.status === 'uploading' ? 'Subiendo...'
          : f.status === 'done' ? 'Listo'
          : f.status === 'local' ? 'Guardado en tu telefono'
          : 'Error';
        div.appendChild(status);
      }
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.style.width = `${f.status === 'done' ? 100 : f.progress || 0}%`;
      div.appendChild(bar);
      grid.appendChild(div);
    });
  }

  function updateThumbProgress(id, pct) {
    const bar = document.querySelector(`.thumb[data-id="${id}"] .progress-bar`);
    if (bar) bar.style.width = `${pct}%`;
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
  // "Elegir de galeria" no espera el GPS: si ya esta listo lo usa, si no, sube sin coordenadas
  $('galleryInput').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });

  function uploadOne(entry) {
    return new Promise(async (resolve, reject) => {
      const resourceType = entry.kind === 'video' ? 'video' : 'image';
      let sig;
      try {
        sig = await api('/upload-signature', {
          method: 'POST',
          body: JSON.stringify({ site_code: state.site.site_code, resource_type: resourceType })
        });
      } catch (err) {
        return reject(err);
      }

      const filename = entry.kind === 'video'
        ? entry.file.name
        : entry.file.name.replace(/\.\w+$/, '') + '.jpg';

      const form = new FormData();
      form.append('file', entry.blob, filename);
      form.append('api_key', sig.apiKey);
      form.append('timestamp', sig.timestamp);
      form.append('signature', sig.signature);
      form.append('folder', sig.folder);

      // XMLHttpRequest en vez de fetch para poder mostrar progreso real de
      // subida por archivo (barra de progreso en cada miniatura).
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `https://api.cloudinary.com/v1_1/${sig.cloudName}/${resourceType}/upload`);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          entry.progress = Math.round((e.loaded / e.total) * 100);
          updateThumbProgress(entry.id, entry.progress);
        }
      };
      xhr.onload = () => {
        let data;
        try { data = JSON.parse(xhr.responseText); } catch { data = {}; }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({
            public_id: data.public_id,
            secure_url: data.secure_url,
            resource_type: resourceType,
            gps_lat: entry.lat,
            gps_lng: entry.lng,
            gps_address: entry.address
          });
        } else {
          reject(new Error(data.error?.message || 'Error subiendo archivo'));
        }
      };
      xhr.onerror = () => reject(new Error('Error de red subiendo archivo'));
      xhr.send(form);
    });
  }

  // Si la nube no responde (cuenta de Cloudinary mal configurada, sin
  // internet, etc.), en vez de solo mostrar un error tecnico se descarga la
  // foto/video directo al telefono del trabajador y se avisa claramente que
  // NO quedo subida al sistema, para que la evidencia no se pierda.
  function downloadLocally(entry) {
    try {
      const a = document.createElement('a');
      a.href = entry.previewUrl;
      a.download = entry.file.name || `evidencia-${entry.id}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err) {
      console.error('No se pudo guardar localmente:', err.message);
    }
  }

  $('btnSubmit').addEventListener('click', async () => {
    $('step3Error').textContent = '';
    if (!state.files.length) return ($('step3Error').textContent = 'Agrega al menos una foto o video');

    $('btnSubmit').disabled = true;
    $('submitLabel').innerHTML = '<span class="spinner"></span> Subiendo...';

    // Una vez que UNA subida falla, se asume que la nube no esta disponible
    // y el resto de archivos pendientes se guardan localmente de una vez, en
    // vez de hacerlos esperar cada uno su propio intento fallido.
    let cloudFailed = false;

    for (const entry of state.files) {
      if (entry.status === 'done' && entry.uploadedMedia) continue;
      if (entry.status === 'local') continue; // ya se guardo en el telefono, no se reintenta solo

      if (cloudFailed) {
        downloadLocally(entry);
        entry.status = 'local';
        renderThumbs();
        continue;
      }

      entry.status = 'uploading';
      renderThumbs();
      try {
        entry.uploadedMedia = await uploadOne(entry);
        entry.status = 'done';
      } catch (err) {
        cloudFailed = true;
        downloadLocally(entry);
        entry.status = 'local';
      }
      renderThumbs();
    }

    const uploaded = state.files.map((f) => f.uploadedMedia).filter(Boolean);
    const localCount = state.files.filter((f) => f.status === 'local').length;

    try {
      if (uploaded.length) {
        await api('/jobs', {
          method: 'POST',
          body: JSON.stringify({
            site_code: state.site.site_code,
            employee_name: state.employeeName,
            job_type: state.jobType,
            media: uploaded
          })
        });
      }

      if (cloudFailed) {
        $('step3Error').textContent = `No se pudo conectar con la nube: ${localCount} archivo(s) se guardaron en tu telefono pero NO quedaron en el sistema. Avisa a tu administrador y, cuando haya conexion, vuelve a intentar subirlas desde "Galeria".`;
        toast('No se pudo subir a la nube. Se guardo en tu telefono.', true);
      } else {
        state.files.forEach((f) => URL.revokeObjectURL(f.previewUrl));
        $('successSummary').textContent = `${uploaded.length} archivo(s) enviados para ${state.site.name}.`;
        goToStep(4);
      }
    } catch (err) {
      $('step3Error').textContent = `${err.message}. Toca "Enviar evidencia" para reintentar; lo ya subido no se duplicara.`;
      toast(err.message, true);
    } finally {
      $('btnSubmit').disabled = false;
      $('submitLabel').textContent = 'Enviar evidencia';
    }
  });

  function startNewJob(sameSite) {
    state.files.forEach((f) => f.previewUrl && URL.revokeObjectURL(f.previewUrl));
    state.files = [];
    renderThumbs();
    if (sameSite) {
      goToStep(3);
      requestLocation();
    } else {
      state.site = null;
      state.employeeName = '';
      $('employeeName').value = '';
      codeBuffer = '';
      codeResolved = false;
      clearTimeout(codeCheckTimer);
      renderCodeDisplay();
      $('siteConfirm').classList.add('hidden');
      goToStep(1);
    }
  }
  $('btnSameSite').addEventListener('click', () => startNewJob(true));
  $('btnNewSite').addEventListener('click', () => startNewJob(false));
})();
