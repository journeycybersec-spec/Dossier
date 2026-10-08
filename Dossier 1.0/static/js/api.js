/* Thin wrapper over the Flask JSON API. */
const API = {
  async _json(url, opts) {
    const res = await fetch(url, opts);
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      document.dispatchEvent(new CustomEvent('tm-unauth'));
    }
    if (!res.ok) {
      let msg = res.statusText;
      try { msg = (await res.json()).error || msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  },

  authStatus()      { return this._json('/api/auth/status'); },
  authSetup(name, password) { return this._json('/api/auth/setup', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, password }) }); },
  authLogin(name, password) { return this._json('/api/auth/login', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, password }) }); },
  authLogout()      { return this._json('/api/auth/logout', { method: 'POST' }); },

  audit(caseId, limit) { const q = [];
                      if (caseId) q.push('case=' + encodeURIComponent(caseId));
                      if (limit) q.push('limit=' + limit);
                      return this._json('/api/audit' + (q.length ? '?' + q.join('&') : '')); },
  auditList(params = {}) { const q = Object.entries(params).filter(([, v]) => v != null && v !== '')
                      .map(([k, v]) => k + '=' + encodeURIComponent(v));
                      return this._json('/api/audit' + (q.length ? '?' + q.join('&') : '')); },
  verifyAudit()     { return this._json('/api/audit/verify'); },

  listUsers()       { return this._json('/api/users'); },
  addUser(name, password, role) { return this._json('/api/users', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ name, password, role }) }); },
  deleteUser(name)  { return this._json(`/api/users/${encodeURIComponent(name)}`, { method: 'DELETE' }); },
  changePassword(current, newpw) { return this._json('/api/users/password', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ current, new: newpw }) }); },
  resetUserPassword(name, newpw) { return this._json(`/api/users/${encodeURIComponent(name)}/password`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ new: newpw }) }); },
  setUserRole(name, role) { return this._json(`/api/users/${encodeURIComponent(name)}/role`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ role }) }); },
  setCaseAccess(id, access) { return this._json(`/api/cases/${id}/access`, {
                        method: 'PUT', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(access) }); },

  listCases()        { return this._json('/api/cases'); },
  createCase(name)   { return this._json('/api/cases', {
                         method: 'POST',
                         headers: { 'Content-Type': 'application/json' },
                         body: JSON.stringify({ name }) }); },
  getCase(id)        { return this._json(`/api/cases/${id}`); },
  async saveCase(id, data, baseRev, force) {
    const q = [];
    if (baseRev != null) q.push('baseRev=' + baseRev);
    if (force) q.push('force=1');
    const res = await fetch(`/api/cases/${id}${q.length ? '?' + q.join('&') : ''}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (res.status === 409) {
      const j = await res.json().catch(() => ({}));
      const e = new Error('conflict'); e.conflict = true; e.serverRev = j.serverRev; throw e;
    }
    if (res.status === 401) document.dispatchEvent(new CustomEvent('tm-unauth'));
    if (!res.ok) { let m = res.statusText; try { m = (await res.json()).error || m; } catch (_) {} throw new Error(m); }
    return res.json();
  },
  deleteCase(id)     { return this._json(`/api/cases/${id}`, { method: 'DELETE' }); },

  uploadEvidence(id, file) {
    const fd = new FormData();
    fd.append('file', file);
    return this._json(`/api/cases/${id}/evidence`, { method: 'POST', body: fd });
  },
  deleteEvidence(id, evid) {
    return this._json(`/api/cases/${id}/evidence/${evid}`, { method: 'DELETE' });
  },
  evidenceUrl(id, evid, download) {
    return `/api/cases/${id}/evidence/${evid}${download ? '?download=1' : ''}`;
  },
  exportUrl(id) { return `/api/cases/${id}/export`; },

  importCase(file) {
    const fd = new FormData();
    fd.append('file', file);
    return this._json('/api/cases/import', { method: 'POST', body: fd });
  },

  listSnapshots(id)        { return this._json(`/api/cases/${id}/snapshots`); },
  createSnapshot(id, label) { return this._json(`/api/cases/${id}/snapshots`, {
                               method: 'POST', headers: { 'Content-Type': 'application/json' },
                               body: JSON.stringify({ label }) }); },
  restoreSnapshot(id, file) { return this._json(`/api/cases/${id}/snapshots/${file}/restore`, { method: 'POST' }); },
  deleteSnapshot(id, file)  { return this._json(`/api/cases/${id}/snapshots/${file}`, { method: 'DELETE' }); },
};
