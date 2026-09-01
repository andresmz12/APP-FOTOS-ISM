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
    files: [] // { id, kind, file, blob, previewUrl, lat, lng, address, status }
  };

  const $ = (id) => document.getElementById(id);
  const steps = { 1: $('step1'), 2: $('step2'), 3: $('step3'), 4: $('step4') };

  function goToStep(n) {
    Object.values(steps).forEach((el) => el.classList.remove('active'));
    steps[n].classList.add('active');
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
      document.documentElement.style.setProperty('--brand', c.brandColor || '#17322B');
      $('topbar').style.background = c.brandColor || '#17322B';
      if (c.logoUrl) $('logo').src = c.logoUrl;
      if (c.status !== 'active') {
        $('suspendedBanner').style.display = 'block';
        $('btnCheckin').disabled = true;
      }
    } catch (err) {
      $('companyName').textContent = 'Empresa no encontrada';
      $('step1').innerHTML = '<div class="card">No se encontro esta empresa. Verifica el enlace.</div>';
    }
  }
  loadCompany();

  // --- Paso 1: checkin ---
  $('btnCheckin').addEventListener('click', async () => {
    const code = $('siteCode').value.trim();
    $('step1Error').textContent = '';
    if (!code) return ($('step1Error').textContent = 'Escribe el codigo de tu sitio');

    $('btnCheckin').disabled = true;
    try {
      const { site } = await api('/checkin', { method: 'POST', body: JSON.stringify({ site_code: code }) });
      state.site = { ...site, site_code: code };
      $('siteNameDisplay').textContent = site.name;
      $('siteAddressDisplay').textContent = site.address || '';
      goToStep(2);
    } catch (err) {
      $('step1Error').textContent = err.message;
    } finally {
      $('btnCheckin').disabled = false;
    }
  });

  // --- Paso 2: detalles ---
  document.querySelectorAll('.job-type-option').forEach((el) => {
    el.addEventListener('click', () => {
      document.querySelectorAll('.job-type-option').forEach((o) => o.classList.remove('selected'));
      el.classList.add('selected');
      state.jobType = el.dataset.value;
    });
  });
  $('btnBackTo1').addEventListener('click', () => goToStep(1));
  $('btnToStep3').addEventListener('click', () => {
    state.employeeName = $('employeeName').value.trim();
    goToStep(3);
  });

  // --- Paso 3: fotos ---
  $('btnBackTo2').addEventListener('click', () => goToStep(2));

  function getLocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Tu navegador no soporta geolocalizacion'));
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => reject(new Error('Debes permitir el acceso a tu ubicacion para tomar fotos')),
        { enableHighAccuracy: true, timeout: 15000 }
      );
    });
  }

  async function reverseGeocodeClient(lat, lng) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`);
      const data = await res.json();
      return data.display_name || null;
    } catch {
      return null;
    }
  }

  function stampImage(file, { lat, lng, address }) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const lines = [
          state.site.name,
          address || (lat && lng ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : 'Ubicacion no disponible'),
          new Date().toLocaleString('es-MX')
        ];

        const pad = Math.round(img.width * 0.02);
        const lineHeight = Math.round(img.width * 0.028);
        const fontSize = Math.round(img.width * 0.022);
        const boxHeight = lineHeight * lines.length + pad;

        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(0, img.height - boxHeight, img.width, boxHeight);

        ctx.fillStyle = '#fff';
        ctx.font = `600 ${fontSize}px sans-serif`;
        lines.forEach((line, i) => {
          ctx.fillText(line, pad, img.height - boxHeight + pad / 2 + lineHeight * (i + 1) - lineHeight * 0.3);
        });

        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function addFiles(fileList, requireGps) {
    const files = Array.from(fileList);
    if (!files.length) return;

    let loc = { lat: null, lng: null };
    if (requireGps) {
      try {
        toast('Obteniendo ubicacion...');
        loc = await getLocation();
      } catch (err) {
        $('step3Error').textContent = err.message;
        return;
      }
    } else {
      try { loc = await getLocation(); } catch { /* opcional */ }
    }

    let address = null;
    if (loc.lat && loc.lng) address = await reverseGeocodeClient(loc.lat, loc.lng);

    for (const file of files) {
      const isVideo = file.type.startsWith('video/');
      const id = Math.random().toString(36).slice(2);
      const entry = { id, kind: isVideo ? 'video' : 'image', file, lat: loc.lat, lng: loc.lng, address, status: 'ready' };

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
      div.innerHTML = f.kind === 'video'
        ? `<video src="${f.previewUrl}" muted></video>`
        : `<img src="${f.previewUrl}" />`;
      const remove = document.createElement('button');
      remove.className = 'remove';
      remove.textContent = '✕';
      remove.onclick = () => {
        state.files = state.files.filter((x) => x.id !== f.id);
        renderThumbs();
      };
      div.appendChild(remove);
      if (f.status !== 'ready') {
        const status = document.createElement('div');
        status.className = 'status';
        status.textContent = f.status === 'uploading' ? 'Subiendo...' : f.status === 'done' ? 'Listo' : 'Error';
        div.appendChild(status);
      }
      grid.appendChild(div);
    });
  }

  $('btnTakePhoto').addEventListener('click', () => $('cameraInput').click());
  $('btnPickGallery').addEventListener('click', () => $('galleryInput').click());
  $('cameraInput').addEventListener('change', (e) => { addFiles(e.target.files, true); e.target.value = ''; });
  $('galleryInput').addEventListener('change', (e) => { addFiles(e.target.files, false); e.target.value = ''; });

  async function uploadOne(entry) {
    const resourceType = entry.kind === 'video' ? 'video' : 'image';
    const sig = await api('/upload-signature', {
      method: 'POST',
      body: JSON.stringify({ site_code: state.site.site_code, resource_type: resourceType })
    });

    const form = new FormData();
    form.append('file', entry.blob, entry.file.name);
    form.append('api_key', sig.apiKey);
    form.append('timestamp', sig.timestamp);
    form.append('signature', sig.signature);
    form.append('folder', sig.folder);

    const uploadRes = await fetch(`https://api.cloudinary.com/v1_1/${sig.cloudName}/${resourceType}/upload`, {
      method: 'POST',
      body: form
    });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) throw new Error(uploadData.error?.message || 'Error subiendo archivo');

    return {
      public_id: uploadData.public_id,
      secure_url: uploadData.secure_url,
      resource_type: resourceType,
      gps_lat: entry.lat,
      gps_lng: entry.lng,
      gps_address: entry.address
    };
  }

  $('btnSubmit').addEventListener('click', async () => {
    $('step3Error').textContent = '';
    if (!state.files.length) return ($('step3Error').textContent = 'Agrega al menos una foto o video');

    $('btnSubmit').disabled = true;
    $('submitLabel').innerHTML = '<span class="spinner"></span> Subiendo...';

    try {
      const uploaded = [];
      for (const entry of state.files) {
        entry.status = 'uploading';
        renderThumbs();
        try {
          const media = await uploadOne(entry);
          entry.status = 'done';
          uploaded.push(media);
        } catch (err) {
          entry.status = 'error';
          renderThumbs();
          throw err;
        }
        renderThumbs();
      }

      await api('/jobs', {
        method: 'POST',
        body: JSON.stringify({
          site_code: state.site.site_code,
          employee_name: state.employeeName,
          job_type: state.jobType,
          media: uploaded
        })
      });

      $('successSummary').textContent = `${uploaded.length} archivo(s) enviados para ${state.site.name}.`;
      goToStep(4);
    } catch (err) {
      $('step3Error').textContent = err.message;
      toast(err.message, true);
    } finally {
      $('btnSubmit').disabled = false;
      $('submitLabel').textContent = 'Enviar evidencia';
    }
  });

  $('btnNewJob').addEventListener('click', () => {
    state.files = [];
    state.employeeName = '';
    $('employeeName').value = '';
    renderThumbs();
    goToStep(2);
  });
})();
