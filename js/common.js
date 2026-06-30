async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

async function requireSession() {
  try {
    const { user } = await api('GET', '/api/auth');
    return user;
  } catch (e) {
    window.location.href = '/index.html';
    return null;
  }
}

function badge(status) {
  const cls = status.replace(/\s+/g, '');
  return `<span class="badge ${cls}">${status}</span>`;
}

function renderTopbar(user) {
  const el = document.getElementById('topbar');
  if (!el) return;
  el.innerHTML = `
    <h1>Employee Certificate System</h1>
    <div class="who">
      ${user.full_name} &middot; ${user.role.replace('_',' ')}
      <button onclick="logout()">Log out</button>
    </div>
  `;
}

async function logout() {
  await api('POST', '/api/auth', { action: 'logout' });
  window.location.href = '/index.html';
}

function renderNav(user, active) {
  const el = document.getElementById('nav');
  if (!el) return;
  const tabs = [];
  tabs.push({ href: 'dashboard.html', label: 'My Requests', roles: ['employee','hr_staff','hr_director'] });
  if (user.role === 'employee') tabs.push({ href: 'new-request.html', label: 'New Request', roles: ['employee'] });
  tabs.push({ href: 'all-requests.html', label: 'All Requests', roles: ['hr_staff','hr_director'] });
  tabs.push({ href: 'approvals.html', label: 'Approvals', roles: ['hr_staff','hr_director'] });
  tabs.push({ href: 'admin.html', label: 'Admin', roles: ['admin'] });
  tabs.push({ href: 'profile.html', label: 'My Profile', roles: ['employee','hr_staff','hr_director','admin'] });

  el.innerHTML = tabs
    .filter(t => t.roles.includes(user.role))
    .map(t => `<a href="${t.href}" class="${active === t.href ? 'active' : ''}">${t.label}</a>`)
    .join('');
}
