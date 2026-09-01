(function () {
  const $ = (id) => document.getElementById(id);
  let token = sessionStorage.getItem('fp-admin-token');
  let companies = [];
  let currentCompany = null;
  let allSites = [];
  let selectedSiteIds = new Set();

  function toast(msg, isError) {
    const el = document.createElement('div');
    el.className = 'toast' + (isError ? ' error' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  async function api(path, opts = {}) {
    const res = await fetch(`/api/admin${path}`, {
      ...opts,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(opts.headers || {})
      }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Error de red');
    return data;
  }

  function showLogin() {
    $('loginView').style.display = 'block';
    $('appView').style.display = 'none';
  }
  function showApp() {
    $('loginView').style.display = 'none';
    $('appView').style.display = 'block';
    showList();
  }

  function showList() { setView('listView'); loadCompanies(); }
  function showNewCompany() { setView('newCompanyView'); }
  function showDetail() { setView('detailView'); }
  function setView(id) {
    ['listView', 'newCompanyView', 'detailView'].forEach((v) => { $(v).style.display = v === id ? 'block' : 'none'; });
  }

  $('btnLogin').addEventListener('click', async () => {
    $('loginError').textContent = '';
    try {
      const data = await api('/login', { method: 'POST', headers: {}, body: JSON.stringify({ password: $('password').value }) });
      token = data.token;
      sessionStorage.setItem('fp-admin-token', token);
      showApp();
    } catch (err) {
      $('loginError').textContent = err.message;
    }
  });

  $('btnLogout').addEventListener('click', () => {
    sessionStorage.removeItem('fp-admin-token');
    token = null;
    showLogin();
  });

  async function loadCompanies() {
    try {
      const data = await api('/companies');
      companies = data.companies;
      renderCompanies();
    } catch (err) {
      if (err.message === 'No autorizado') { showLogin(); return; }
      toast(err.message, true);
    }
  }

  function renderCompanies() {
    $('emptyCompanies').style.display = companies.length ? 'none' : 'block';
    $('companiesBody').innerHTML = companies.map((c) => `
      <tr data-id="${c.id}">
        <td>${c.name}</td>
        <td>${c.slug}</td>
        <td>${c.industry || '-'}</td>
        <td>${c.site_count}</td>
        <td>${c.media_count}</td>
        <td>${c.plan}</td>
        <td><span class="status-pill ${c.status}">${c.status === 'active' ? 'Activa' : 'Suspendida'}</span></td>
      </tr>
    `).join('');
    document.querySelectorAll('.companies-table tbody tr').forEach((tr) => {
      tr.addEventListener('click', () => openDetail(Number(tr.dataset.id)));
    });
  }

  $('btnNewCompany').addEventListener('click', () => {
    ['ncName', 'ncSlug', 'ncIndustry', 'ncAdminPin', 'ncEmail', 'ncLogo'].forEach((id) => { $(id).value = ''; });
    $('ncColor').value = '#17322B';
    $('ncPlan').value = 'trial';
    $('ncMaxSites').value = 10;
    $('ncError').textContent = '';
    showNewCompany();
  });
  $('backFromNew').addEventListener('click', showList);
  $('backFromDetail').addEventListener('click', showList);

  $('btnCreateCompany').addEventListener('click', async () => {
    $('ncError').textContent = '';
    try {
      await api('/companies', {
        method: 'POST',
        body: JSON.stringify({
          name: $('ncName').value.trim(),
          slug: $('ncSlug').value.trim(),
          industry: $('ncIndustry').value.trim(),
          brand_color: $('ncColor').value,
          admin_pin: $('ncAdminPin').value.trim(),
          notify_email: $('ncEmail').value.trim(),
          plan: $('ncPlan').value.trim() || 'trial',
          max_sites: Number($('ncMaxSites').value) || 10,
          logo_url: $('ncLogo').value.trim()
        })
      });
      toast('Empresa creada');
      showList();
    } catch (err) {
      $('ncError').textContent = err.message;
    }
  });

  async function openDetail(id) {
    currentCompany = companies.find((c) => c.id === id);
    if (!currentCompany) return;
    $('detailName').textContent = currentCompany.name;
    $('dName').value = currentCompany.name;
    $('dIndustry').value = currentCompany.industry || '';
    $('dColor').value = currentCompany.brand_color || '#17322B';
    $('dAdminPin').value = currentCompany.admin_pin;
    $('dEmail').value = currentCompany.notify_email || '';
    $('dPlan').value = currentCompany.plan;
    $('dMaxSites').value = currentCompany.max_sites;
    $('dLogo').value = currentCompany.logo_url || '';
    renderPublicUrls(currentCompany.slug);
    $('btnToggleStatus').textContent = currentCompany.status === 'active' ? 'Suspender empresa' : 'Reactivar empresa';
    $('dError').textContent = '';
    showDetail();
    await loadSites();
  }

  function renderPublicUrls(slug) {
    const url = `${location.origin}/c/${slug}`;
    $('dPublicUrls').innerHTML = `
      <div class="link-row">
        <div>
          <span class="link-label">Enlace unico de esta empresa</span>
          <a href="${url}" target="_blank" rel="noopener">${url}</a>
          <p class="link-note">Compartelo con todos: cada quien entra con su propio codigo. El codigo de un sitio lleva a subir fotos; el PIN de administrador lleva directo a la galeria.</p>
        </div>
        <button class="btn btn-secondary" data-copy="${url}">Copiar</button>
      </div>
    `;
    $('dPublicUrls').querySelectorAll('[data-copy]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.copy);
          toast('Enlace copiado');
        } catch {
          toast('No se pudo copiar, selecciona el enlace manualmente', true);
        }
      });
    });
  }

  $('btnSaveCompany').addEventListener('click', async () => {
    $('dError').textContent = '';
    try {
      await api(`/companies/${currentCompany.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: $('dName').value.trim(),
          industry: $('dIndustry').value.trim(),
          brand_color: $('dColor').value,
          admin_pin: $('dAdminPin').value.trim(),
          notify_email: $('dEmail').value.trim(),
          plan: $('dPlan').value.trim(),
          max_sites: Number($('dMaxSites').value),
          logo_url: $('dLogo').value.trim()
        })
      });
      toast('Cambios guardados');
      await loadCompanies();
    } catch (err) {
      $('dError').textContent = err.message;
    }
  });

  $('btnToggleStatus').addEventListener('click', async () => {
    const newStatus = currentCompany.status === 'active' ? 'suspended' : 'active';
    try {
      const { company } = await api(`/companies/${currentCompany.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: newStatus })
      });
      currentCompany = company;
      $('btnToggleStatus').textContent = company.status === 'active' ? 'Suspender empresa' : 'Reactivar empresa';
      toast(newStatus === 'active' ? 'Empresa reactivada' : 'Empresa suspendida');
      await loadCompanies();
    } catch (err) {
      toast(err.message, true);
    }
  });

  async function loadSites() {
    const { sites } = await api(`/companies/${currentCompany.id}/sites`);
    allSites = sites;
    selectedSiteIds.clear();
    renderSites();
  }

  function renderSites() {
    const q = $('siteSearch').value.trim().toLowerCase();
    const filtered = q
      ? allSites.filter((s) => s.site_code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q))
      : allSites;

    $('sitesCount').textContent = `${filtered.length} sitio(s)`;
    $('emptySites').style.display = filtered.length ? 'none' : 'block';

    $('sitesBody').innerHTML = filtered.map((s) => `
      <tr>
        <td><input type="checkbox" class="row-checkbox" data-site-id="${s.id}" ${selectedSiteIds.has(s.id) ? 'checked' : ''} /></td>
        <td>${s.site_code}</td>
        <td>${s.name}</td>
        <td>${s.address || '-'}</td>
        <td>${s.active ? 'Si' : 'No'}</td>
        <td>
          <button class="btn btn-secondary" data-toggle="${s.id}" data-active="${s.active}" style="width:auto;padding:6px 12px;font-size:12px">${s.active ? 'Desactivar' : 'Activar'}</button>
          <button data-delete-site="${s.id}">Eliminar</button>
        </td>
      </tr>
    `).join('');

    document.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const active = btn.dataset.active === 'true';
        await api(`/sites/${btn.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ active: !active }) });
        await loadSites();
      });
    });

    document.querySelectorAll('.row-checkbox').forEach((cb) => {
      cb.addEventListener('change', () => {
        const id = Number(cb.dataset.siteId);
        if (cb.checked) selectedSiteIds.add(id); else selectedSiteIds.delete(id);
        $('btnDeleteSelectedSites').style.display = selectedSiteIds.size ? 'inline-flex' : 'none';
      });
    });

    document.querySelectorAll('[data-delete-site]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const site = allSites.find((s) => s.id === Number(btn.dataset.deleteSite));
        openDeleteSitesConfirm([site.id], `Vas a eliminar permanentemente el sitio "${site.name}" (${site.site_code}) y todas sus fotos/videos. Esta accion no se puede deshacer.`);
      });
    });

    $('btnDeleteSelectedSites').style.display = selectedSiteIds.size ? 'inline-flex' : 'none';
  }

  $('siteSearch').addEventListener('input', renderSites);

  $('btnSelectAllSites').addEventListener('click', () => {
    const q = $('siteSearch').value.trim().toLowerCase();
    const filtered = q
      ? allSites.filter((s) => s.site_code.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || (s.address || '').toLowerCase().includes(q))
      : allSites;
    const allSelected = filtered.length > 0 && filtered.every((s) => selectedSiteIds.has(s.id));
    if (allSelected) {
      filtered.forEach((s) => selectedSiteIds.delete(s.id));
    } else {
      filtered.forEach((s) => selectedSiteIds.add(s.id));
    }
    renderSites();
  });

  let pendingDeleteSiteIds = [];
  function openDeleteSitesConfirm(ids, message) {
    pendingDeleteSiteIds = ids;
    $('confirmDeleteSitesText').textContent = message;
    $('confirmDeleteSitesModal').style.display = 'flex';
  }
  $('btnDeleteSelectedSites').addEventListener('click', () => {
    const ids = [...selectedSiteIds];
    openDeleteSitesConfirm(ids, `Vas a eliminar permanentemente ${ids.length} sitio(s) y todas sus fotos/videos. Esta accion no se puede deshacer.`);
  });
  $('btnCancelDeleteSites').addEventListener('click', () => { $('confirmDeleteSitesModal').style.display = 'none'; });
  $('btnConfirmDeleteSites').addEventListener('click', async () => {
    $('confirmDeleteSitesModal').style.display = 'none';
    try {
      if (pendingDeleteSiteIds.length === 1) {
        await api(`/sites/${pendingDeleteSiteIds[0]}`, { method: 'DELETE' });
      } else {
        await api(`/companies/${currentCompany.id}/sites/delete-batch`, { method: 'POST', body: JSON.stringify({ ids: pendingDeleteSiteIds }) });
      }
      toast(`${pendingDeleteSiteIds.length} sitio(s) eliminados`);
      await loadSites();
      await loadCompanies();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('btnAddSite').addEventListener('click', async () => {
    $('siteError').textContent = '';
    const site_code = $('newSiteCode').value.trim();
    const name = $('newSiteName').value.trim();
    const address = $('newSiteAddress').value.trim();
    if (!site_code || !name) return ($('siteError').textContent = 'Codigo y nombre son requeridos');

    try {
      await api(`/companies/${currentCompany.id}/sites`, { method: 'POST', body: JSON.stringify({ site_code, name, address }) });
      $('newSiteCode').value = '';
      $('newSiteName').value = '';
      $('newSiteAddress').value = '';
      await loadSites();
      await loadCompanies();
      toast('Sitio agregado');
    } catch (err) {
      $('siteError').textContent = err.message;
    }
  });

  $('btnBulkUpload').addEventListener('click', async () => {
    $('bulkError').textContent = '';
    $('bulkResult').innerHTML = '';
    const fileInput = $('bulkSitesFile');
    const file = fileInput.files[0];
    if (!file) return ($('bulkError').textContent = 'Elige un archivo .xlsx o .csv primero');

    $('btnBulkUpload').disabled = true;
    $('btnBulkUpload').textContent = 'Subiendo...';
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch(`/api/admin/companies/${currentCompany.id}/sites/bulk`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Error de red');

      const parts = [`<div class="bulk-summary">✓ ${data.created} sitio(s) creados</div>`];
      if (data.columnsUsed) {
        const note = data.columnsDetected
          ? `Columnas detectadas por encabezado: locacion = "${data.columnsUsed.code}", nombre = "${data.columnsUsed.name}".`
          : `No se reconocio el encabezado de las columnas; se uso el orden por defecto (columna A = locacion, columna B = nombre). Revisa la tabla de abajo para confirmar que quedo bien.`;
        parts.push(`<p class="hint" style="margin-top:8px">${note}</p>`);
      }
      if (data.skipped && data.skipped.length) {
        parts.push(`<div class="bulk-skipped"><strong>${data.skippedCount} fila(s) omitidas:</strong><ul>${data.skipped.map((s) => `<li>${s.reason} — ${s.rowsLabel}</li>`).join('')}</ul></div>`);
      }
      $('bulkResult').innerHTML = parts.join('');
      fileInput.value = '';
      await loadSites();
      await loadCompanies();
      toast(`${data.created} sitio(s) creados`);
    } catch (err) {
      $('bulkError').textContent = err.message;
    } finally {
      $('btnBulkUpload').disabled = false;
      $('btnBulkUpload').textContent = 'Subir archivo';
    }
  });

  if (token) {
    api('/companies').then(() => showApp()).catch(() => { sessionStorage.removeItem('fp-admin-token'); showLogin(); });
  } else {
    showLogin();
  }
})();
