/* App shell: landing/case picker, open a case, tab switching, export/import. */
const App = {
  activeView: 'map',

  async init() {
    Inspector.init();
    MindMap.init();
    Timeline.init();
    Collections.init();
    Evidence.init();
    Exporter.init();
    Settings.init();
    MapSearch.init();
    CaseInfo.init();
    Activity.init();

    // undo / redo
    document.getElementById('undo-btn').onclick = () => { State.undo(); };
    document.getElementById('redo-btn').onclick = () => { State.redo(); };
    document.addEventListener('keydown', e => {
      if (!State.data) return;
      if (e.target.matches('input, textarea, select')) return;   // let fields do native undo
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); State.undo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); State.redo(); }
    });
    State.on('reload', () => this._onReload());
    State.on('history', () => this._updateHistoryButtons());
    State.on('conflict', () => this._handleConflict());

    // browser back/forward navigation within the SPA
    window.addEventListener('popstate', e => this._onPop(e));

    // idle auto-lock
    this._armIdle();

    // launcher actions
    document.getElementById('create-case').onclick = () => this.createCase();
    document.getElementById('new-case-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') this.createCase();
    });
    document.getElementById('import-file').onchange = e => this.importCase(e.target.files[0]);
    this._initTemplatePicker();
    document.getElementById('new-case-toggle').onclick = () => {
      const p = document.getElementById('new-case-panel');
      p.classList.toggle('hidden');
      if (!p.classList.contains('hidden')) {
        const an = document.getElementById('new-case-analyst');
        if (!an.value && this.user) an.value = this.user;   // default analyst to current user
        document.getElementById('new-case-name').focus();
      }
    };
    document.getElementById('case-search').oninput = () => this._renderCaseTable();
    document.getElementById('case-sort').onchange = () => this._renderCaseTable();

    // workspace chrome
    document.getElementById('back-btn').onclick = () => this.toLauncher();
    document.querySelectorAll('.tab').forEach(tab =>
      tab.onclick = () => this.switchView(tab.dataset.view));

    // auth
    Auth.init();
    document.getElementById('logout-btn').onclick = () => this.logout();
    try {
      const st = await API.authStatus();
      if (st.authenticated) this.enterApp();
      else Auth.show(st.configured);
    } catch (e) {
      Auth.show(false);
    }
  },

  /* called after successful login/setup → show the case-management screen */
  async enterApp() {
    this._authed = true;
    document.getElementById('auth').classList.add('hidden');
    document.getElementById('workspace').classList.add('hidden');
    document.getElementById('launcher').classList.remove('hidden');
    // seed history: a base + a guard entry so Back stays in the app
    history.replaceState({ tmview: 'dash' }, '');
    history.pushState({ tmview: 'dash' }, '');
    try {
      const st = await API.authStatus();
      this.user = st.user || ''; this.role = st.role || 'analyst';
      document.getElementById('dash-username').textContent =
        st.user ? `👤 ${st.user}${this.role === 'admin' ? ' · admin' : ''}` : '';
      const sub = document.querySelector('.dash-sub');
      if (sub) sub.textContent = st.encrypted ? 'Case management · 🔒 encrypted' : 'Case management';
    } catch (_) {}
    if (this._resetIdle) this._resetIdle();   // start the inactivity timer
    this.refreshCaseList();
  },

  async logout() {
    if (State.caseId) { clearTimeout(State._saveTimer); await State.save(); }
    State.caseId = null; State.data = null;
    this._authed = false;
    clearTimeout(this._idleTimer);
    try { await API.authLogout(); } catch (_) {}
    Auth.show(true);
  },

  // ---- idle auto-lock ----
  _IDLE_MS: 15 * 60 * 1000,
  _armIdle() {
    this._resetIdle = () => {
      clearTimeout(this._idleTimer);
      if (this._authed) this._idleTimer = setTimeout(() => this.lock(), this._IDLE_MS);
    };
    ['mousemove', 'keydown', 'click', 'wheel', 'touchstart'].forEach(ev =>
      document.addEventListener(ev, this._resetIdle, { passive: true }));
  },
  async lock() {
    if (!this._authed) return;
    if (State.caseId) { clearTimeout(State._saveTimer); try { await State.save(); } catch (_) {} }
    State.caseId = null; State.data = null;
    this._authed = false;
    clearTimeout(this._idleTimer);
    try { await API.authLogout(); } catch (_) {}
    Auth.show(true);
    toast('Locked after inactivity — sign in to continue');
  },

  // ---- SPA history handling ----
  _onPop(e) {
    if (!this._authed) return;
    const st = e.state || {};
    const inWorkspace = !document.getElementById('workspace').classList.contains('hidden');
    if (st.tmview === 'case' && st.id) {
      if (State.caseId !== st.id || !inWorkspace) this._loadCase(st.id);
    } else {                                   // target = dashboard
      if (inWorkspace) this._showDashboard();
      else {                                   // already on dashboard → don't leave the app
        history.pushState({ tmview: 'dash' }, '');
        const t = Date.now();
        if (!this._lastGuard || t - this._lastGuard > 4000) { this._lastGuard = t; toast('Use “Log out” to leave Dossier'); }
      }
    }
  },

  async _showDashboard() {
    if (State.caseId) { clearTimeout(State._saveTimer); await State.save(); }
    document.getElementById('workspace').classList.add('hidden');
    document.getElementById('launcher').classList.remove('hidden');
    Inspector.close();
    this.refreshCaseList();
  },

  // ----------------------------------------------------------- dashboard
  async refreshCaseList() {
    try { this._cases = await API.listCases(); }
    catch (e) {
      document.getElementById('case-list').innerHTML =
        `<div class="case-empty">Could not load cases: ${esc(e.message)}</div>`;
      return;
    }
    this._renderCaseTable();
  },

  _tlpChip(cls) {
    if (!cls) return '';
    const k = (cls.split(':')[1] || '').toLowerCase().replace(/\W/g, '');
    return `<span class="tlp-chip tlp-${esc(k)}">${esc(cls)}</span>`;
  },

  _renderCaseTable() {
    const wrap = document.getElementById('case-list');
    const q = (document.getElementById('case-search').value || '').trim().toLowerCase();
    const sort = document.getElementById('case-sort').value;
    let cases = (this._cases || []).filter(c =>
      !q || (c.name + ' ' + (c.caseNumber || '') + ' ' + (c.analyst || '')).toLowerCase().includes(q));
    cases.sort((a, b) => {
      if (sort === 'name') return (a.name || '').localeCompare(b.name || '');
      if (sort === 'nodes') return (b.nodeCount || 0) - (a.nodeCount || 0);
      if (sort === 'created') return (b.created || '').localeCompare(a.created || '');
      return (b.modified || '').localeCompare(a.modified || '');
    });

    document.getElementById('case-count').textContent =
      `${cases.length} case${cases.length === 1 ? '' : 's'}`;

    if (!this._cases.length) {
      wrap.innerHTML = `<div class="case-empty">No cases yet — click “＋ New case” to start.</div>`;
      return;
    }
    if (!cases.length) { wrap.innerHTML = `<div class="case-empty">No cases match “${esc(q)}”.</div>`; return; }

    const TLP = ['', 'TLP:CLEAR', 'TLP:GREEN', 'TLP:AMBER', 'TLP:AMBER+STRICT', 'TLP:RED'];
    const rows = cases.map(c => {
      if (this._editing === c.id) {
        const opts = TLP.map(t => `<option value="${esc(t)}" ${t === (c.classification || '') ? 'selected' : ''}>${t ? esc(t) : '— class —'}</option>`).join('');
        return `<tr class="ct-edit"><td colspan="7">
          <div class="ct-editform">
            <input class="cx-name" value="${esc(c.name)}" placeholder="Case name" />
            <input class="cx-num" value="${esc(c.caseNumber || '')}" placeholder="Case #" />
            <input class="cx-analyst" value="${esc(c.analyst || '')}" placeholder="Analyst" />
            <select class="cx-class">${opts}</select>
            <button class="btn btn-small btn-primary cx-save" data-save="${c.id}">Save</button>
            <button class="btn btn-small cx-cancel">Cancel</button>
          </div></td></tr>`;
      }
      const d = parseTs(c.modified);
      const mine = c.owner === this.user;
      return `<tr data-open="${c.id}">
        <td class="ct-name">${esc(c.name)} ${this._tlpChip(c.classification)}</td>
        <td class="mono">${esc(c.caseNumber || '—')}</td>
        <td>${esc(c.owner || '—')}${mine ? ' <span class="mine-tag">you</span>' : ''}</td>
        <td class="ct-num">${c.nodeCount}</td>
        <td class="ct-num">${c.evidenceCount}</td>
        <td class="ct-date">${d ? esc(fmtDate(d) + ' ' + fmtTime(d)) : '—'}</td>
        <td class="ct-act">
          <button class="cr-edit" data-edit="${c.id}" title="Edit details">✎</button>
          ${c.canDelete ? `<button class="cr-del" data-del="${c.id}" title="Delete case">🗑</button>` : ''}
        </td>
      </tr>`;
    }).join('');
    wrap.innerHTML = `<table class="case-table"><thead><tr>
        <th>Case</th><th>Case #</th><th>Owner</th><th>Entities</th><th>Evidence</th><th>Modified</th><th></th>
      </tr></thead><tbody>${rows}</tbody></table>`;

    wrap.querySelectorAll('[data-open]').forEach(row =>
      row.onclick = e => {
        if (e.target.closest('[data-del]') || e.target.closest('[data-edit]')) return;
        this.openCase(row.dataset.open);
      });
    wrap.querySelectorAll('[data-edit]').forEach(b =>
      b.onclick = e => { e.stopPropagation(); this._editing = b.dataset.edit; this._renderCaseTable(); });
    wrap.querySelectorAll('.cx-cancel').forEach(b =>
      b.onclick = () => { this._editing = null; this._renderCaseTable(); });
    wrap.querySelectorAll('[data-save]').forEach(b =>
      b.onclick = () => this._saveRowEdit(b.dataset.save));
    wrap.querySelectorAll('[data-del]').forEach(b =>
      b.onclick = async e => {
        e.stopPropagation();
        if (!confirm('Delete this case and all its evidence? This cannot be undone.')) return;
        await API.deleteCase(b.dataset.del);
        this.refreshCaseList();
      });
  },

  async _saveRowEdit(id) {
    const row = document.querySelector('.ct-edit');
    const name = row.querySelector('.cx-name').value.trim() || 'Untitled incident';
    const caseNumber = row.querySelector('.cx-num').value.trim();
    const analyst = row.querySelector('.cx-analyst').value.trim();
    const classification = row.querySelector('.cx-class').value;
    try {
      const data = await API.getCase(id);          // round-trip full case (keeps maps/events)
      data.name = name;
      data.meta = Object.assign({}, data.meta, { caseNumber, analyst, classification });
      await API.saveCase(id, data);
      this._editing = null;
      await this.refreshCaseList();
      toast('Case updated');
    } catch (e) { toast('Save failed: ' + e.message, true); }
  },

  _initTemplatePicker() {
    const sel = document.getElementById('template-select');
    let opts = Object.values(TEMPLATES)
      .map(t => `<option value="${t.key}">${esc(t.label)}</option>`);
    if (getDefaultMap('investigation'))
      opts.unshift(`<option value="mydefault">My saved default</option>`);
    sel.innerHTML = opts.join('');
    sel.value = getDefaultTemplate();
    if (!sel.value) sel.value = 'blank';
    const hint = document.getElementById('template-default-hint');
    const paint = () => {
      hint.textContent = sel.value === getDefaultTemplate()
        ? '★ default for new investigations' : '';
    };
    sel.onchange = () => { setDefaultTemplate(sel.value); paint(); };
    paint();
  },

  async createCase() {
    const input = document.getElementById('new-case-name');
    const numEl = document.getElementById('new-case-number');
    const anEl = document.getElementById('new-case-analyst');
    const name = input.value.trim() || 'Untitled incident';
    const tplKey = document.getElementById('template-select').value || 'blank';
    try {
      const { id, case: data } = await API.createCase(name);
      data.meta = { caseNumber: numEl.value.trim(), analyst: anEl.value.trim() };
      input.value = ''; numEl.value = ''; anEl.value = '';
      document.getElementById('new-case-panel').classList.add('hidden');
      const built = buildTemplateMap(tplKey);   // applies per-template overrides
      data.nodes = built.nodes; data.edges = built.edges;
      this._enter(id, data);
      this._pushCase(id);
      State.touch('nodes');          // persist meta (+ any template) to disk
      if (built.nodes.length) MindMap.fit();
    } catch (e) { toast('Could not create case: ' + e.message, true); }
  },

  async importCase(file) {
    if (!file) return;
    toast('Importing…');
    try {
      const { id, case: data } = await API.importCase(file);
      toast('Imported ' + (data.name || 'case'));
      this._enter(id, data);
      this._pushCase(id);
    } catch (e) { toast('Import failed: ' + e.message, true); }
    document.getElementById('import-file').value = '';
  },

  async openCase(id) {
    await this._loadCase(id);
    if (State.caseId === id) this._pushCase(id);   // add a Back target
  },

  async _loadCase(id) {   // load + show, WITHOUT touching history (used by popstate too)
    try {
      const data = await API.getCase(id);
      this._enter(id, data);
    } catch (e) { toast('Could not open case: ' + e.message, true); }
  },

  _pushCase(id) { if (this._authed) history.pushState({ tmview: 'case', id }, ''); },

  // ----------------------------------------------------------- workspace
  _enter(id, data) {
    State.load(id, data);
    document.getElementById('launcher').classList.add('hidden');
    document.getElementById('workspace').classList.remove('hidden');
    document.getElementById('case-title').textContent = data.name;
    setSaveState('saved');
    Inspector.close();
    this.switchView('map');
    MindMap.activate();
    this._updateHistoryButtons();
  },

  /* after an undo/redo (or snapshot restore) rebuild the visible views */
  _onReload() {
    document.getElementById('case-title').textContent = State.data.name || '—';
    MindMap.rebuild();
    Timeline.render();
    if (this.activeView === 'index') Collections.render();
    Inspector.close();
    this._updateHistoryButtons();
  },

  _updateHistoryButtons() {
    const u = document.getElementById('undo-btn'), r = document.getElementById('redo-btn');
    if (u) u.disabled = !State.canUndo();
    if (r) r.disabled = !State.canRedo();
  },

  /* another user saved this case since we loaded it → let the analyst choose */
  async _handleConflict() {
    if (this._conflictOpen) return;
    this._conflictOpen = true;
    const keepTheirs = confirm(
      'This case was changed by someone else since you opened it.\n\n' +
      'OK = load the latest version (discards your unsaved changes)\n' +
      'Cancel = overwrite with your version');
    try {
      if (keepTheirs) {
        const id = State.caseId;
        const data = await API.getCase(id);
        State.load(id, data);
        this._onReload();
        toast('Loaded the latest version');
      } else {
        State._conflict = false;
        await State.save(true);          // force-overwrite
        toast('Saved — your version now wins');
      }
    } catch (e) { toast('Could not resolve conflict: ' + e.message, true); }
    State._conflict = false;
    this._conflictOpen = false;
  },

  toLauncher() {
    // if we're on a case history entry, go back so browser history stays in sync
    if (history.state && history.state.tmview === 'case') history.back();  // → popstate → _showDashboard
    else this._showDashboard();
  },

  switchView(view) {
    this.activeView = view;
    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('active', t.dataset.view === view));
    document.getElementById('view-map').classList.toggle('hidden', view !== 'map');
    document.getElementById('view-timeline').classList.toggle('hidden', view !== 'timeline');
    document.getElementById('view-index').classList.toggle('hidden', view !== 'index');
    document.getElementById('view-evidence').classList.toggle('hidden', view !== 'evidence');

    if (view === 'map') MindMap.activate();
    else if (view === 'timeline') Timeline.activate();
    else if (view === 'index') Collections.activate();
    else if (view === 'evidence') Evidence.activate();
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
window.addEventListener('beforeunload', () => {
  if (State.caseId) { clearTimeout(State._saveTimer); navigator.sendBeacon &&
    navigator.sendBeacon(`/api/cases/${State.caseId}`, new Blob([JSON.stringify(State.data)],
      { type: 'application/json' })); }
});
