/* Settings modal — currently: manage custom node categories (persisted in
   localStorage via state.js). Changes re-render the map / inspector / index. */
const Settings = {
  init() {
    document.getElementById('settings-btn').onclick = () => this.open();
    const dashBtn = document.getElementById('dash-settings-btn');
    if (dashBtn) dashBtn.onclick = () => this.open();
    document.getElementById('settings-close').onclick = () => this.close();
    document.getElementById('settings-modal').onclick = e => {
      if (e.target.id === 'settings-modal') this.close();   // click backdrop
    };
    document.getElementById('cat-add-btn').onclick = () => this._add();
    document.getElementById('cat-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._add();
    });
    document.getElementById('flag-add-btn').onclick = () => this._addFlag();
    document.getElementById('flag-name').addEventListener('keydown', e => {
      if (e.key === 'Enter') this._addFlag();
    });
    document.getElementById('tpl-export').onclick = () => this._exportTemplates();
    document.getElementById('tpl-import').onchange = e => this._importTemplates(e.target.files[0]);
    document.getElementById('user-add-btn').onclick = () => this._addUser();
    document.getElementById('user-pass').addEventListener('keydown', e => { if (e.key === 'Enter') this._addUser(); });
    document.getElementById('pw-change-btn').onclick = () => this._changePassword();
    document.getElementById('pw-new').addEventListener('keydown', e => { if (e.key === 'Enter') this._changePassword(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !document.getElementById('settings-modal').classList.contains('hidden'))
        this.close();
    });
  },

  open() {
    document.getElementById('settings-modal').classList.remove('hidden');
    this._render();
    this._renderFlags();
    this._renderTemplates();
    this._renderUsers();
  },

  // ---------------------------------------------------------------- users
  async _renderUsers() {
    const admin = App.role === 'admin';
    const row = document.getElementById('user-add-row');
    if (row) row.style.display = admin ? '' : 'none';
    const list = document.getElementById('user-list');
    let users = [];
    try { users = await API.listUsers(); }
    catch (e) { list.innerHTML = `<div class="muted">Could not load users: ${esc(e.message)}</div>`; return; }
    list.innerHTML = users.map(u => {
      const d = parseTs(u.created);
      const isMe = u.name === App.user;
      const roleCtl = admin && !isMe
        ? `<select class="role-sel" data-roleuser="${esc(u.name)}">
             <option value="analyst" ${u.role !== 'admin' ? 'selected' : ''}>Analyst</option>
             <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Admin</option></select>`
        : `<span class="role-chip ${u.role === 'admin' ? 'admin' : ''}">${esc(u.role || 'analyst')}</span>`;
      return `<div class="cat-row">
        <span class="cat-label">${esc(u.name)}${isMe ? ' <span class="mine-tag">you</span>' : ''}</span>
        ${roleCtl}
        <span class="muted">${d ? 'since ' + esc(fmtDate(d)) : ''}</span>
        ${admin && !isMe ? `<button class="btn btn-small" data-resetuser="${esc(u.name)}" title="reset password">Reset pw</button>` : ''}
        ${admin && !isMe && users.length > 1 ? `<button class="cat-del" data-deluser="${esc(u.name)}" title="delete user">🗑</button>` : ''}
      </div>`;
    }).join('') || '<div class="muted">No users.</div>';
    list.querySelectorAll('[data-deluser]').forEach(b => b.onclick = () => this._deleteUser(b.dataset.deluser));
    list.querySelectorAll('[data-roleuser]').forEach(s => s.onchange = () => this._setRole(s.dataset.roleuser, s.value));
    list.querySelectorAll('[data-resetuser]').forEach(b => b.onclick = () => this._resetUser(b.dataset.resetuser));
  },

  async _resetUser(name) {
    const np = prompt(`Set a new password for “${name}” (min 4 characters):`);
    if (np == null) return;
    if (np.length < 4) { toast('Password must be at least 4 characters', true); return; }
    try { await API.resetUserPassword(name, np); toast(`Password reset for ${name}`); }
    catch (e) { toast('Reset failed: ' + e.message, true); }
  },

  async _addUser() {
    const nameEl = document.getElementById('user-name'), passEl = document.getElementById('user-pass');
    const name = nameEl.value.trim(), pass = passEl.value;
    const role = document.getElementById('user-role').value;
    if (!name) { nameEl.focus(); return; }
    if (pass.length < 4) { toast('Password must be at least 4 characters', true); return; }
    try {
      await API.addUser(name, pass, role);
      nameEl.value = ''; passEl.value = '';
      this._renderUsers();
      toast(`Added ${role} “${name}”`);
    } catch (e) { toast('Add user failed: ' + e.message, true); }
  },

  async _setRole(name, role) {
    try { await API.setUserRole(name, role); toast(`${name} is now ${role}`); }
    catch (e) { toast('Role change failed: ' + e.message, true); this._renderUsers(); }
  },

  async _deleteUser(name) {
    if (!confirm(`Delete user “${name}”?`)) return;
    try { await API.deleteUser(name); this._renderUsers(); toast('User deleted'); }
    catch (e) { toast('Delete failed: ' + e.message, true); }
  },

  async _changePassword() {
    const cur = document.getElementById('pw-current'), nw = document.getElementById('pw-new');
    if (!cur.value || nw.value.length < 4) { toast('Enter current password and a new one (4+ chars)', true); return; }
    try {
      await API.changePassword(cur.value, nw.value);
      cur.value = ''; nw.value = '';
      toast('Password updated');
    } catch (e) { toast(e.message, true); }
  },
  close() { document.getElementById('settings-modal').classList.add('hidden'); },

  _render() {
    const list = document.getElementById('cat-list');
    const custom = loadCustomCategories();
    const usage = key => State.data ? State.allNodes().filter(n => n.type === key).length : 0;

    if (!custom.length) {
      list.innerHTML = `<div class="muted" style="padding:8px 0">No custom categories yet.</div>`;
    } else {
      list.innerHTML = custom.map(c => {
        const used = usage(c.key);
        return `<div class="cat-row">
          <span class="cat-swatch" style="background:${esc(c.color)}"></span>
          <span class="cat-label">${esc(c.label)}</span>
          <span class="muted">${used ? used + ' node' + (used === 1 ? '' : 's') : 'unused'}</span>
          <button class="cat-del" data-del="${esc(c.key)}" title="delete">🗑</button>
        </div>`;
      }).join('');
      list.querySelectorAll('[data-del]').forEach(b =>
        b.onclick = () => this._delete(b.dataset.del));
    }
  },

  _add() {
    const nameEl = document.getElementById('cat-name');
    const colorEl = document.getElementById('cat-color');
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    if (NODE_TYPES.some(t => t.label.toLowerCase() === name.toLowerCase())) {
      toast('A category with that name already exists', true); return;
    }
    addCustomCategory(name, colorEl.value);
    nameEl.value = '';
    this._render();
    this._refreshViews();
    toast(`Added category “${name}”`);
  },

  _delete(key) {
    const used = State.data ? State.allNodes().filter(n => n.type === key).length : 0;
    const msg = used
      ? `Delete this category? ${used} node(s) use it and will fall back to the default style.`
      : 'Delete this category?';
    if (!confirm(msg)) return;
    removeCustomCategory(key);
    this._render();
    this._refreshViews();
  },

  // ---------------------------------------------------------- custom flags
  _renderFlags() {
    const list = document.getElementById('flag-list');
    const custom = loadCustomFlags();
    if (!custom.length) {
      list.innerHTML = `<div class="muted" style="padding:8px 0">No custom flags yet.</div>`;
      return;
    }
    list.innerHTML = custom.map(f => `<div class="cat-row">
      <span class="cat-swatch" style="background:${esc(f.color)};color:#10141a;display:grid;place-items:center;font-size:11px">${esc(f.icon || '●')}</span>
      <span class="cat-label">${esc(f.label)}</span>
      <button class="cat-del" data-delflag="${esc(f.key)}" title="delete">🗑</button>
    </div>`).join('');
    list.querySelectorAll('[data-delflag]').forEach(b =>
      b.onclick = () => this._deleteFlag(b.dataset.delflag));
  },

  _addFlag() {
    const nameEl = document.getElementById('flag-name');
    const iconEl = document.getElementById('flag-icon');
    const colorEl = document.getElementById('flag-color');
    const name = nameEl.value.trim();
    if (!name) { nameEl.focus(); return; }
    if (FLAGS.some(f => f.label.toLowerCase() === name.toLowerCase())) {
      toast('A flag with that name already exists', true); return;
    }
    addCustomFlag(name, iconEl.value.trim() || '●', colorEl.value);
    nameEl.value = ''; iconEl.value = '';
    this._renderFlags();
    this._refreshFlagViews();
    toast(`Added flag “${name}”`);
  },

  _deleteFlag(key) {
    if (!confirm('Delete this flag? It will be removed from the pickers (existing marks stay in data).')) return;
    removeCustomFlag(key);
    this._renderFlags();
    this._refreshFlagViews();
  },

  _refreshFlagViews() {
    if (!State.data) return;
    MindMap.rebuild();          // rows must rebuild to show the new flag buttons
    if (Inspector.current?.kind === 'node') Inspector.openNode(Inspector.current.id);
    if (App.activeView === 'index') Collections.render();
    if (App.activeView === 'timeline') Timeline.render();
  },

  // ---------------------------------------------------------- default maps
  _tplRows() {
    const rows = Object.values(TEMPLATES).filter(t => t.key !== 'blank')
      .map(t => ({ store: 'tpl_' + t.key, label: t.label, mapKind: 'investigation' }));
    rows.push({ store: 'sockpuppet', label: 'Sock Puppet map', mapKind: 'sockpuppet' });
    return rows;
  },

  _renderTemplates() {
    const list = document.getElementById('tpl-list');
    const open = !!State.data;
    list.innerHTML = this._tplRows().map(r => {
      const snap = getDefaultMap(r.store);
      const status = snap
        ? `<span class="muted">customized · ${snap.nodes.length} nodes</span>`
        : `<span class="muted">built-in</span>`;
      const which = r.mapKind === 'sockpuppet' ? 'Sock Puppet' : 'Investigation';
      return `<div class="tpl-row">
        <div class="tpl-info"><b>${esc(r.label)}</b> ${status}</div>
        <div class="tpl-btns">
          <button class="btn btn-small" data-tplsave="${esc(r.store)}" data-kind="${r.mapKind}" ${open ? '' : 'disabled'}>Save current ${which} map</button>
          ${snap ? `<button class="btn btn-small btn-danger" data-tplreset="${esc(r.store)}">Reset</button>` : ''}
        </div>
      </div>`;
    }).join('') + (open ? '' :
      `<div class="muted" style="margin-top:6px">Open a case to save its maps as templates.</div>`);

    list.querySelectorAll('[data-tplsave]').forEach(b =>
      b.onclick = () => this._saveTpl(b.dataset.tplsave, b.dataset.kind));
    list.querySelectorAll('[data-tplreset]').forEach(b =>
      b.onclick = () => this._resetTpl(b.dataset.tplreset));
  },

  _saveTpl(store, mapKind) {
    if (!State.data) return;
    const mp = mapKind === 'sockpuppet' ? State.data.maps.sockpuppet : State.data.maps.investigation;
    if (!mp.nodes.length && !confirm('This map is empty. Save it as the template anyway?')) return;
    saveDefaultMap(store, snapshotMap(mp));
    this._renderTemplates();
    toast(`Template saved (${mp.nodes.length} nodes)`);
  },

  _resetTpl(store) {
    if (!confirm('Reset this template to the built-in default?')) return;
    clearDefaultMap(store);
    this._renderTemplates();
    toast('Reset to built-in');
  },

  _exportTemplates() {
    const blob = new Blob([JSON.stringify(exportAllTemplates(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dossier_templates.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    toast('Exported all templates');
  },

  async _importTemplates(file) {
    if (!file) return;
    try {
      importAllTemplates(JSON.parse(await file.text()));
      this._render(); this._renderFlags(); this._renderTemplates();
      this._refreshViews(); this._refreshFlagViews();
      toast('Templates imported');
    } catch (e) { toast('Import failed: ' + e.message, true); }
    document.getElementById('tpl-import').value = '';
  },

  /* re-paint anything that renders categories */
  _refreshViews() {
    if (!State.data) return;
    MindMap._renderLegend();
    MindMap.render();
    if (Inspector.current?.kind === 'node') Inspector.openNode(Inspector.current.id);
    if (App.activeView === 'index') Collections.render();
  },
};
