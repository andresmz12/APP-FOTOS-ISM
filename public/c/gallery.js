(function () {
  const slug = location.pathname.split('/')[2];
  const $ = (id) => document.getElementById(id);

  const state = {
    company: null,
    credParam: null, // 'admin_pin' | 'site_code'
    credValue: null,
    scope: null,
    sites: [],
    media: [],
    selected: new Set()
  };

  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

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

  async function loadCompany() {
    const res = await fetch(`/api/companies/${slug}`);
    if (!res.ok) {
      document.body.innerHTML = '<p style="padding:20px">Empresa no encontrada.</p>';
      return;
    }
    state.company = await res.json();
    $('companyName').textContent = `${state.company.name} - Galeria`;
    applyBrandColors(state.company.brandColor);
    $('topbar').style.background = state.company.brandColor || '#17322B';
    if (state.company.logoUrl) $('logo').src = state.company.logoUrl;

    const saved = sessionStorage.getItem(`fp-cred-${slug}`);
    if (saved) {
      const { param, value } = JSON.parse(saved);
      state.credParam = param;
      state.credValue = value;
      const ok = await tryLoadMedia();
      if (ok) return;
    }
    showLogin();
  }

  function showLogin() {
    $('loginView').style.display = 'block';
    $('galleryView').style.display = 'none';
  }

  function showGallery() {
    $('loginView').style.display = 'none';
    $('galleryView').style.display = 'block';
  }

  function credQuery() {
    return `${state.credParam}=${encodeURIComponent(state.credValue)}`;
  }

  async function tryLoadMedia() {
    try {
      const res = await fetch(`/api/companies/${slug}/media?${credQuery()}`);
      if (!res.ok) return false;
      const data = await res.json();
      state.scope = data.scope;
      state.sites = data.sites;
      applyMediaData(data);
      showGallery();
      setupFilterVisibility();
      return true;
    } catch {
      return false;
    }
  }

  $('btnLogin').addEventListener('click', async () => {
    const code = $('accessCode').value.trim();
    $('loginError').textContent = '';
    if (!code) return ($('loginError').textContent = 'Escribe un codigo');

    for (const param of ['admin_pin', 'site_code']) {
      state.credParam = param;
      state.credValue = code;
      const ok = await tryLoadMedia();
      if (ok) {
        sessionStorage.setItem(`fp-cred-${slug}`, JSON.stringify({ param, value: code }));
        return;
      }
    }
    $('loginError').textContent = 'Codigo invalido';
  });

  function setupFilterVisibility() {
    const siteSelect = $('filterSite');
    if (state.scope === 'admin') {
      siteSelect.style.display = 'inline-block';
      siteSelect.innerHTML = '<option value="">Todos los sitios</option>' +
        state.sites.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    } else {
      siteSelect.style.display = 'none';
    }
  }

  function applyMediaData(data) {
    state.media = data.media;
    state.selected.clear();
    renderGrid();
  }

  function fmtDate(d) {
    return new Date(d).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function renderGrid() {
    const grid = $('mediaGrid');
    grid.innerHTML = '';
    $('countBadge').textContent = `${state.media.length} archivo(s)`;
    $('emptyState').style.display = state.media.length ? 'none' : 'block';

    state.media.forEach((m) => {
      const div = document.createElement('div');
      div.className = 'media-item';

      const thumbUrl = m.resource_type === 'video'
        ? m.secure_url.replace('/upload/', '/upload/so_1,w_400,h_400,c_fill/').replace(/\.\w+$/, '.jpg')
        : m.secure_url.replace('/upload/', '/upload/w_400,h_400,c_fill/');

      div.innerHTML = `
        <input type="checkbox" class="checkbox" data-id="${m.id}" />
        ${m.resource_type === 'video' ? '<span class="video-badge">VIDEO</span>' : ''}
        <img class="media-thumb" src="${thumbUrl}" loading="lazy" />
        <div class="meta"><strong>${m.site_name}</strong>${fmtDate(m.created_at)}<br/>${m.employee_name || ''} ${m.job_type ? '· ' + m.job_type : ''}</div>
      `;

      div.querySelector('.checkbox').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSelect(m.id, e.target.checked);
      });
      div.addEventListener('click', () => openLightbox(m));
      grid.appendChild(div);
    });
  }

  function toggleSelect(id, checked) {
    if (checked) state.selected.add(id); else state.selected.delete(id);
    $('btnDeleteSelected').style.display = state.selected.size ? 'inline-flex' : 'none';
  }

  $('btnSelectAll').addEventListener('click', () => {
    const allSelected = state.selected.size === state.media.length && state.media.length > 0;
    state.selected.clear();
    if (!allSelected) state.media.forEach((m) => state.selected.add(m.id));
    document.querySelectorAll('.checkbox').forEach((cb) => { cb.checked = !allSelected; });
    $('btnDeleteSelected').style.display = state.selected.size ? 'inline-flex' : 'none';
  });

  function openLightbox(m) {
    const content = $('lightboxContent');
    content.innerHTML = `
      ${m.resource_type === 'video'
        ? `<video src="${m.secure_url}" controls autoplay></video>`
        : `<img src="${m.secure_url}" />`}
      <div style="text-align:center;margin-top:12px">
        <button class="btn btn-danger" id="btnDeleteFromLightbox" style="width:auto;padding:10px 20px">Eliminar este archivo</button>
      </div>
    `;
    $('lightbox').style.display = 'flex';
    $('btnDeleteFromLightbox').addEventListener('click', () => {
      $('lightbox').style.display = 'none';
      pendingDeleteIds = [m.id];
      $('confirmText').textContent = 'Vas a eliminar permanentemente este archivo. Esta accion no se puede deshacer.';
      $('confirmModal').style.display = 'flex';
    });
  }
  $('btnCloseLightbox').addEventListener('click', () => { $('lightbox').style.display = 'none'; });
  $('lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('lightbox').style.display = 'none'; });

  function currentFilterQuery() {
    const params = new URLSearchParams();
    params.set(state.credParam, state.credValue);
    if (state.scope === 'admin' && $('filterSite').value) params.set('site_id', $('filterSite').value);
    if ($('filterFrom').value) params.set('date_from', $('filterFrom').value);
    if ($('filterTo').value) params.set('date_to', $('filterTo').value);
    if ($('filterJobType').value) params.set('job_type', $('filterJobType').value);
    if ($('filterSearch').value.trim()) params.set('q', $('filterSearch').value.trim());
    return params;
  }

  async function reload() {
    const res = await fetch(`/api/companies/${slug}/media?${currentFilterQuery().toString()}`);
    const data = await res.json();
    applyMediaData(data);
  }

  ['filterSite', 'filterFrom', 'filterTo', 'filterJobType'].forEach((id) => {
    $(id).addEventListener('change', reload);
  });
  let searchTimer;
  $('filterSearch').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(reload, 350);
  });

  $('btnDownloadZip').addEventListener('click', () => {
    const params = currentFilterQuery();
    if (state.selected.size) params.set('ids', [...state.selected].join(','));
    window.location.href = `/api/companies/${slug}/media/zip?${params.toString()}`;
  });

  $('btnPdf').addEventListener('click', () => {
    window.location.href = `/api/companies/${slug}/report.pdf?${currentFilterQuery().toString()}`;
  });

  $('btnXlsx').addEventListener('click', () => {
    window.location.href = `/api/companies/${slug}/coverage.xlsx?${currentFilterQuery().toString()}`;
  });

  let pendingDeleteIds = [];
  $('btnDeleteSelected').addEventListener('click', () => {
    pendingDeleteIds = [...state.selected];
    $('confirmText').textContent = `Vas a eliminar permanentemente ${pendingDeleteIds.length} archivo(s). Esta accion no se puede deshacer.`;
    $('confirmModal').style.display = 'flex';
  });
  $('btnCancelDelete').addEventListener('click', () => { $('confirmModal').style.display = 'none'; });
  $('btnConfirmDelete').addEventListener('click', async () => {
    $('confirmModal').style.display = 'none';
    try {
      if (pendingDeleteIds.length === 1) {
        await fetch(`/api/companies/${slug}/media/${pendingDeleteIds[0]}?${credQuery()}`, { method: 'DELETE' });
      } else {
        await fetch(`/api/companies/${slug}/media/delete-batch?${credQuery()}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: pendingDeleteIds })
        });
      }
      toast(`${pendingDeleteIds.length} archivo(s) eliminados`);
      await reload();
      $('btnDeleteSelected').style.display = 'none';
    } catch {
      toast('Error al eliminar', true);
    }
  });

  loadCompany();
})();
