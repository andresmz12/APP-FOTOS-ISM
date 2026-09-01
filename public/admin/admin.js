(function () {
  const $ = (id) => document.getElementById(id);
  let token = sessionStorage.getItem('fp-admin-token');
  let companies = [];
  let currentCompany = null;

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
    $('dPublicUrl').innerHTML = `URL trabajador: <code>${location.origin}/c/${currentCompany.slug}</code> — URL galeria: <code>${location.origin}/c/${currentCompany.slug}/galeria</code>`;
    $('btnToggleStatus').textContent = currentCompany.status === 'active' ? 'Suspender empresa' : 'Reactivar empresa';
    $('dError').textContent = '';
    showDetail();
    await loadSites();
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
    $('sitesBody').innerHTML = sites.map((s) => `
      <tr>
        <td>${s.site_code}</td>
        <td>${s.name}</td>
        <td>${s.address || '-'}</td>
        <td>${s.active ? 'Si' : 'No'}</td>
        <td><button class="btn btn-secondary" data-toggle="${s.id}" data-active="${s.active}" style="width:auto;padding:6px 12px;font-size:12px">${s.active ? 'Desactivar' : 'Activar'}</button></td>
      </tr>
    `).join('');

    document.querySelectorAll('[data-toggle]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const active = btn.dataset.active === 'true';
        await api(`/sites/${btn.dataset.toggle}`, { method: 'PATCH', body: JSON.stringify({ active: !active }) });
        await loadSites();
      });
    });
  }

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

  if (token) {
    api('/companies').then(() => showApp()).catch(() => { sessionStorage.removeItem('fp-admin-token'); showLogin(); });
  } else {
    showLogin();
  }
})();
