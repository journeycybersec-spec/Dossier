/* Node search + jump-to for large maps. Matches node titles, field values,
   notes and category; results drop down below the toolbar box. Keyboard:
   ↑/↓ move, Enter jumps, Esc closes. Ctrl+F focuses it. */
const MapSearch = {
  sel: -1,
  matches: [],

  init() {
    this.input = document.getElementById('map-search-input');
    this.box = document.getElementById('map-search-results');
    if (!this.input) return;

    this.input.addEventListener('input', () => this._run());
    this.input.addEventListener('focus', () => { if (this.input.value.trim()) this._run(); });
    this.input.addEventListener('keydown', e => this._onKey(e));
    document.addEventListener('mousedown', e => {
      if (!e.target.closest('.map-search')) this._close();
    });
    // Ctrl/Cmd+F → focus search (only inside a case)
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && State.data) {
        e.preventDefault();
        if (App.activeView !== 'map') App.switchView('map');
        this.input.focus();
        this.input.select();
      }
    });
  },

  // ---- matching ----------------------------------------------------------
  _run() {
    const q = this.input.value.trim().toLowerCase();
    if (!q) { this._close(); return; }
    const out = [];
    for (const n of State.map().nodes) {
      let where = null, snippet = null, score = 9;
      const title = (n.title || typeLabel(n.type));
      if (title.toLowerCase().includes(q)) { where = 'title'; snippet = title; score = 0; }
      if (where == null) {
        const row = (n.rows || []).find(r => (r.text || '').toLowerCase().includes(q));
        if (row) { where = 'field'; snippet = row.text; score = 1; }
      }
      if (where == null && typeLabel(n.type).toLowerCase().includes(q)) {
        where = 'category'; snippet = typeLabel(n.type); score = 2;
      }
      if (where == null && (n.notes || '').toLowerCase().includes(q)) {
        where = 'notes'; snippet = n.notes; score = 3;
      }
      if (where) out.push({ node: n, where, snippet, score });
    }
    out.sort((a, b) => a.score - b.score ||
      (a.node.title || '').localeCompare(b.node.title || ''));
    this.total = out.length;
    this.matches = out.slice(0, 15);
    this.sel = this.matches.length ? 0 : -1;
    this._render(q);
  },

  _render(q) {
    if (!this.matches.length) {
      this.box.innerHTML = `<div class="ms-empty">No matches</div>`;
      this.box.classList.remove('hidden');
      return;
    }
    const shown = this.matches.length;
    const count = shown < this.total
      ? `showing ${shown} of ${this.total} matches`
      : `${this.total} match${this.total === 1 ? '' : 'es'}`;
    const head = `<div class="ms-count">${count}</div>`;
    this.box.innerHTML = head + this.matches.map((m, i) => {
      const t = m.node.title || typeLabel(m.node.type);
      const label = m.where === 'title' ? '' :
        `<span class="ms-where">${m.where}:</span> ${this._hl(m.snippet, q)}`;
      return `<div class="ms-item ${i === this.sel ? 'sel' : ''}" data-i="${i}">
        <span class="ms-dot" style="background:${typeColor(m.node.type)}"></span>
        <span class="ms-title">${this._hl(t, q)}</span>
        <span class="ms-snip">${label}</span>
      </div>`;
    }).join('');
    this.box.classList.remove('hidden');
    this.box.querySelectorAll('.ms-item').forEach(el =>
      el.onclick = () => this._jump(+el.dataset.i));
  },

  _hl(text, q) {
    text = String(text || '');
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return esc(text.slice(0, 80));
    const clipStart = Math.max(0, i - 24);
    const pre = (clipStart ? '…' : '') + text.slice(clipStart, i);
    return esc(pre) + '<mark>' + esc(text.substr(i, q.length)) +
           '</mark>' + esc(text.substr(i + q.length, 40));
  },

  _onKey(e) {
    if (e.key === 'Escape') { this._close(); this.input.blur(); return; }
    if (!this.matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); this.sel = (this.sel + 1) % this.matches.length; this._render(this.input.value.trim().toLowerCase()); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.sel = (this.sel - 1 + this.matches.length) % this.matches.length; this._render(this.input.value.trim().toLowerCase()); }
    else if (e.key === 'Enter') { e.preventDefault(); if (this.sel >= 0) this._jump(this.sel); }
  },

  _jump(i) {
    const m = this.matches[i];
    if (!m) return;
    this._close();
    if (App.activeView !== 'map') App.switchView('map');
    MindMap.focusNode(m.node.id);
    setTimeout(() => MindMap.flashNode(m.node.id), 30);
  },

  _close() { this.box.classList.add('hidden'); this.box.innerHTML = ''; },
};
