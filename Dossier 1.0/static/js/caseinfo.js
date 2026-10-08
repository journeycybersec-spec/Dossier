/* Case details modal: metadata (case #, analyst, classification, summary) +
   version history (server snapshots: save / restore / delete). */
const CaseInfo = {
  init() {
    const $ = id => document.getElementById(id);
    $('case-title').onclick = () => this.open();
    $('case-close').onclick = () => this.close();
    $('case-modal').onclick = e => { if (e.target.id === 'case-modal') this.close(); };
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !$('case-modal').classList.contains('hidden')) this.close();
    });

    const meta = () => (State.data.meta ||= {});
    $('ci-name').oninput    = e => { State.data.name = e.target.value;
      document.getElementById('case-title').textContent = e.target.value || '—'; State.touch(); };
    $('ci-number').oninput  = e => { meta().caseNumber = e.target.value; State.touch(); };
    $('ci-analyst').oninput = e => { meta().analyst = e.target.value; State.touch(); };
    $('ci-class').onchange  = e => { meta().classification = e.target.value; State.touch(); };
    $('ci-summary').oninput = e => { meta().summary = e.target.value; State.touch(); };

    $('snap-save').onclick = () => this._saveSnapshot();
  },

  open() {
    if (!State.data) return;
    const m = State.data.meta || {};
    document.getElementById('ci-name').value = State.data.name || '';
    document.getElementById('ci-number').value = m.caseNumber || '';
    document.getElementById('ci-analyst').value = m.analyst || '';
    document.getElementById('ci-class').value = m.classification || '';
    document.getElementById('ci-summary').value = m.summary || '';
    document.getElementById('case-modal').classList.remove('hidden');
    this._renderAccess();
    this._renderSnapshots();
    this._renderAudit();
  },

  async _renderAccess() {
    const canManage = App.role === 'admin' || State.data.owner === App.user;
    let users = [];
    try { users = await API.listUsers(); } catch (_) {}
    const ownerSel = document.getElementById('ci-owner');
    ownerSel.innerHTML = users.map(u => `<option ${u.name === State.data.owner ? 'selected' : ''}>${esc(u.name)}</option>`).join('');
    ownerSel.disabled = !canManage;
    const box = document.getElementById('ci-assignees');
    const asg = State.data.assignees || [];
    const others = users.filter(u => u.name !== State.data.owner);
    box.innerHTML = others.length ? others.map(u =>
      `<label class="asg"><input type="checkbox" value="${esc(u.name)}" ${asg.includes(u.name) ? 'checked' : ''} ${canManage ? '' : 'disabled'}/> ${esc(u.name)}</label>`).join('')
      : '<span class="muted">No other users to assign.</span>';
    if (canManage) {
      ownerSel.onchange = () => this._saveAccess();
      box.querySelectorAll('input').forEach(c => c.onchange = () => this._saveAccess());
    }
  },

  async _saveAccess() {
    const owner = document.getElementById('ci-owner').value;
    const assignees = [...document.querySelectorAll('#ci-assignees input:checked')].map(c => c.value);
    try {
      const r = await API.setCaseAccess(State.caseId, { owner, assignees });
      State.data.owner = r.owner; State.data.assignees = r.assignees;
      this._renderAccess();
      toast('Access updated');
    } catch (e) { toast('Access update failed: ' + e.message, true); }
  },

  async _renderAudit() {
    const list = document.getElementById('audit-list');
    list.innerHTML = '<div class="muted">Loading…</div>';
    let rows = [];
    try { rows = await API.audit(State.caseId, 200); }
    catch (e) { list.innerHTML = `<div class="muted">Could not load: ${esc(e.message)}</div>`; return; }
    if (!rows.length) { list.innerHTML = '<div class="muted">No activity yet.</div>'; return; }
    const label = a => ({
      'case.create': 'created case', 'case.edit': 'edited', 'case.delete': 'deleted case',
      'case.import': 'imported case', 'evidence.add': 'added evidence', 'evidence.delete': 'removed evidence',
      'snapshot.create': 'saved snapshot', 'snapshot.restore': 'restored snapshot',
    }[a.action] || a.action);
    list.innerHTML = rows.map(a => {
      const d = parseTs(a.ts);
      return `<div class="audit-row">
        <span class="audit-when">${d ? esc(fmtDate(d) + ' ' + fmtTime(d)) : ''}</span>
        <span class="audit-who">${esc(a.user || '?')}</span>
        <span class="audit-what">${esc(label(a))}${a.detail ? ' — ' + esc(a.detail) : ''}</span>
      </div>`;
    }).join('');
  },
  close() { document.getElementById('case-modal').classList.add('hidden'); },

  async _saveSnapshot() {
    const input = document.getElementById('snap-label');
    try {
      await State.save();                                   // flush current edits first
      await API.createSnapshot(State.caseId, input.value.trim());
      input.value = '';
      this._renderSnapshots();
      toast('Snapshot saved');
    } catch (e) { toast('Snapshot failed: ' + e.message, true); }
  },

  async _renderSnapshots() {
    const list = document.getElementById('snap-list');
    list.innerHTML = '<div class="muted">Loading…</div>';
    let snaps = [];
    try { snaps = await API.listSnapshots(State.caseId); }
    catch (e) { list.innerHTML = `<div class="muted">Could not load: ${esc(e.message)}</div>`; return; }
    if (!snaps.length) { list.innerHTML = '<div class="muted">No snapshots yet.</div>'; return; }
    list.innerHTML = snaps.map(s => {
      const d = parseTs(s.created);
      return `<div class="snap-row">
        <div class="snap-info"><b>${esc(s.label || 'Snapshot')}</b>
          <span class="muted">${d ? esc(fmtDate(d) + ' ' + fmtTime(d)) : ''} · ${fmtBytes(s.size)}</span></div>
        <div class="snap-btns">
          <button class="btn btn-small" data-restore="${esc(s.file)}">Restore</button>
          <button class="btn btn-small btn-danger" data-delsnap="${esc(s.file)}">🗑</button>
        </div></div>`;
    }).join('');
    list.querySelectorAll('[data-restore]').forEach(b => b.onclick = () => this._restore(b.dataset.restore));
    list.querySelectorAll('[data-delsnap]').forEach(b => b.onclick = () => this._delete(b.dataset.delsnap));
  },

  async _restore(file) {
    if (!confirm('Restore this snapshot? Your current case will be backed up first, then replaced.')) return;
    try {
      const data = await API.restoreSnapshot(State.caseId, file);
      State.load(State.caseId, data);          // reload restored case
      document.getElementById('case-title').textContent = data.name;
      MindMap.activate(); MindMap.rebuild();
      Timeline.render();
      if (App.activeView === 'index') Collections.render();
      App._updateHistoryButtons();
      this.open();                              // refresh fields + list
      toast('Snapshot restored');
    } catch (e) { toast('Restore failed: ' + e.message, true); }
  },

  async _delete(file) {
    if (!confirm('Delete this snapshot?')) return;
    try { await API.deleteSnapshot(State.caseId, file); this._renderSnapshots(); }
    catch (e) { toast('Delete failed: ' + e.message, true); }
  },
};
