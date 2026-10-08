/* Global activity / audit viewer (dashboard) with tamper-evidence check. */
const Activity = {
  LABELS: {
    'case.create': 'created case', 'case.edit': 'edited case', 'case.delete': 'deleted case',
    'case.import': 'imported case', 'evidence.add': 'added evidence', 'evidence.delete': 'removed evidence',
    'snapshot.create': 'saved snapshot', 'snapshot.restore': 'restored snapshot',
    'auth.login': 'signed in', 'auth.logout': 'signed out', 'auth.login.fail': 'failed sign-in',
    'auth.lockout': 'account locked', 'auth.setup': 'created first account',
    'user.add': 'added user', 'user.delete': 'deleted user', 'user.password': 'changed password',
  },

  init() {
    const $ = id => document.getElementById(id);
    $('activity-btn').onclick = () => this.open();
    $('activity-close').onclick = () => this.close();
    $('activity-modal').onclick = e => { if (e.target.id === 'activity-modal') this.close(); };
    $('act-search').oninput = () => this._render();
    $('act-user').onchange = () => this._render();
    $('act-action').onchange = () => this._render();
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('activity-modal').classList.contains('hidden')) this.close();
    });
  },

  async open() {
    document.getElementById('activity-modal').classList.remove('hidden');
    const list = document.getElementById('act-list');
    list.innerHTML = '<div class="muted">Loading…</div>';
    try {
      this._rows = await API.auditList({ limit: 2000 });
    } catch (e) { list.innerHTML = `<div class="muted">Could not load: ${esc(e.message)}</div>`; return; }
    // populate filter dropdowns
    const users = [...new Set(this._rows.map(r => r.user).filter(Boolean))].sort();
    const actions = [...new Set(this._rows.map(r => r.action).filter(Boolean))].sort();
    const fill = (id, vals, label) => {
      const sel = document.getElementById(id);
      sel.innerHTML = `<option value="">${label}</option>` +
        vals.map(v => `<option value="${esc(v)}">${esc(this.LABELS[v] || v)}</option>`).join('');
    };
    fill('act-user', users, 'All users');
    fill('act-action', actions, 'All actions');
    this._render();
    this._verify();
  },
  close() { document.getElementById('activity-modal').classList.add('hidden'); },

  async _verify() {
    const badge = document.getElementById('audit-verify');
    badge.textContent = '…'; badge.className = 'verify-badge';
    try {
      const v = await API.verifyAudit();
      if (v.ok) { badge.textContent = `✓ tamper-check passed (${v.count})`; badge.classList.add('ok'); }
      else { badge.textContent = `⚠ tampering detected at entry ${v.brokenAt}`; badge.classList.add('bad'); }
    } catch (_) { badge.textContent = ''; }
  },

  _render() {
    const list = document.getElementById('act-list');
    const q = (document.getElementById('act-search').value || '').trim().toLowerCase();
    const u = document.getElementById('act-user').value;
    const a = document.getElementById('act-action').value;
    const rows = (this._rows || []).filter(r =>
      (!u || r.user === u) && (!a || r.action === a) &&
      (!q || JSON.stringify(r).toLowerCase().includes(q)));
    document.getElementById('act-count').textContent =
      `${rows.length} event${rows.length === 1 ? '' : 's'}`;
    if (!rows.length) { list.innerHTML = '<div class="muted">No matching activity.</div>'; return; }
    list.innerHTML = rows.map(r => {
      const d = parseTs(r.ts);
      const what = (this.LABELS[r.action] || r.action) +
        (r.caseName ? ` · ${esc(r.caseName)}` : '') + (r.detail ? ` — ${esc(r.detail)}` : '');
      const fail = r.action.includes('fail') || r.action.includes('lockout');
      return `<div class="audit-row ${fail ? 'audit-fail' : ''}">
        <span class="audit-when">${d ? esc(fmtDate(d) + ' ' + fmtTime(d)) : ''}</span>
        <span class="audit-who">${esc(r.user || '?')}</span>
        <span class="audit-what">${what}</span>
      </div>`;
    }).join('');
  },
};
