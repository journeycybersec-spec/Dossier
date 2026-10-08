/* Mind-map canvas. World coordinates live on each node ({x,y}); the view
   {x,y,scale} maps world → screen. Nodes are HTML divs (nice text/editing);
   edges are SVG paths underneath. Everything re-lays-out on change. */
const MindMap = {
  canvas: null, nodeLayer: null, edgeLayer: null, emptyHint: null,
  view: { x: 0, y: 0, scale: 1 },   // safe default until a case is activated
  filter: { cats: new Set(), flags: new Set() },
  selected: null,           // { kind:'node'|'edge', id }
  _drag: null,              // active node drag
  _pan: null,               // active canvas pan
  _link: null,              // active link-drag { from, tmpPath }
  NODE_W: 190,

  init() {
    this.canvas    = document.getElementById('map-canvas');
    this.nodeLayer = document.getElementById('node-layer');
    this.edgeLayer = document.getElementById('edge-layer');
    this.edgeTop   = document.getElementById('edge-top');
    this.emptyHint = document.getElementById('map-empty');

    this.canvas.addEventListener('mousedown', e => this._onCanvasDown(e));
    this.canvas.addEventListener('dblclick', e => this._onDblClick(e));
    this.canvas.addEventListener('wheel', e => this._onWheel(e), { passive: false });
    window.addEventListener('mousemove', e => this._onMove(e));
    window.addEventListener('mouseup', e => this._onUp(e));
    window.addEventListener('keydown', e => this._onKey(e));

    document.getElementById('add-node').onclick = () => this._addCentered();
    document.getElementById('fit-view').onclick = () => this.fit();
    document.getElementById('filter-btn').onclick = e => { e.stopPropagation(); this._toggleFilterMenu(); };
    document.addEventListener('mousedown', e => {
      if (!e.target.closest('.filter-wrap')) document.getElementById('filter-menu').classList.add('hidden');
    });
    document.querySelectorAll('.map-switch .ms-tab').forEach(b =>
      b.onclick = () => this.switchMap(b.dataset.map));
    document.getElementById('sp-reset').onclick = () => {
      if (!confirm('Reset the Sock Puppet map to the default layout?\nThis discards changes on this map only (your investigation map is untouched).')) return;
      State.resetSockpuppet();
      this.nodeLayer.innerHTML = '';
      this.activate();
      this.fit();
    };

    this._renderLegend();
    State.on('nodes', () => this.render());
  },

  activate() {
    this.view = State.map().view;
    const key = State.caseId + ':' + State.active;
    if (this._filterKey !== key) {        // reset focus when case/map changes
      this._filterKey = key;
      this.filter.cats.clear(); this.filter.flags.clear();
      const btn = document.getElementById('filter-btn');
      if (btn) { btn.textContent = 'Filter'; btn.classList.remove('on'); }
    }
    this._syncMapSwitch();
    this.render();
  },

  switchMap(key) {
    if (key === State.active) return;
    this._closeFlagMenu && this._closeFlagMenu();
    this.selected = null;
    Inspector.close();
    State.setActiveMap(key);
    this.nodeLayer.innerHTML = '';        // drop other map's DOM
    this.activate();
  },

  _syncMapSwitch() {
    document.querySelectorAll('.map-switch .ms-tab').forEach(b =>
      b.classList.toggle('active', b.dataset.map === State.active));
    document.getElementById('sp-reset').classList.toggle('hidden', State.active !== 'sockpuppet');
  },

  /* full rebuild — drops all node DOM so rows re-render (e.g. after flag or
     category definitions change) */
  rebuild() {
    this.nodeLayer.innerHTML = '';
    this.render();
  },

  // -------------------------------------------------- coordinate transforms
  worldToScreen(wx, wy) {
    return { x: wx * this.view.scale + this.view.x, y: wy * this.view.scale + this.view.y };
  },
  screenToWorld(sx, sy) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: (sx - r.left - this.view.x) / this.view.scale,
      y: (sy - r.top - this.view.y) / this.view.scale,
    };
  },

  // -------------------------------------------------------------- rendering
  render() {
    if (!State.data) return;
    this._closeFlagMenu();
    const nodes = State.map().nodes;
    this.emptyHint.classList.toggle('hidden', nodes.length > 0);

    // nodes
    const seen = new Set();
    nodes.forEach(n => {
      seen.add(n.id);
      let el = this.nodeLayer.querySelector(`[data-id="${n.id}"]`);
      if (!el) el = this._makeNodeEl(n);
      this._paintNode(el, n);
    });
    // remove deleted
    this.nodeLayer.querySelectorAll('.node').forEach(el => {
      if (!seen.has(el.dataset.id)) el.remove();
    });

    this._renderEdges();
  },

  _makeNodeEl(n) {
    const el = document.createElement('div');
    el.className = 'node';
    el.dataset.id = n.id;
    el.innerHTML = `
      <div class="n-tab"></div>
      <div class="n-rows"></div>
      <button class="n-add" title="add field">+ field</button>
      <div class="n-foot"></div>
      <div class="n-handle" title="drag to link">◇</div>`;
    el.addEventListener('mousedown', e => this._onNodeDown(e, n));
    el.querySelector('.n-handle').addEventListener('mousedown', e => this._onLinkStart(e, n));

    // ── delegated row interactions (survive innerHTML rebuilds of .n-rows) ──
    el.addEventListener('input', e => {
      const row = e.target.closest('.n-row');
      if (!row) return;
      const r = (State.node(n.id)?.rows || []).find(x => x.id === row.dataset.row);
      if (!r) return;
      r.text = e.target.value;
      this._updateRowLink(row, r);
      State.touchSave();                 // persist, but no full re-render (keeps focus)
    });
    el.addEventListener('focusin', e => {
      if (e.target.classList.contains('n-row-in') &&
          !(this.selected?.kind === 'node' && this.selected.id === n.id)) {
        this.select('node', n.id);
      }
    });
    el.addEventListener('click', e => {
      const att = e.target.closest('.n-att');
      if (att) { e.stopPropagation(); Evidence.open(att.dataset.ev); return; }
      const flagBtn = e.target.closest('.n-row-flagbtn');
      if (flagBtn) {
        e.stopPropagation();
        this._openFlagMenu(flagBtn.closest('.n-row'), n.id, flagBtn.closest('.n-row').dataset.row);
        return;
      }
      if (e.target.closest('.n-row-del')) {
        const row = e.target.closest('.n-row');
        State.removeRow(n.id, row.dataset.row);
        this.render();
      } else if (e.target.closest('.n-add')) {
        const r = State.addRow(n.id, '');
        this.render();
        setTimeout(() => el.querySelector(`[data-row="${r.id}"] .n-row-in`)?.focus(), 0);
      }
    });

    this.nodeLayer.appendChild(el);
    return el;
  },

  _paintNode(el, n) {
    const color = typeColor(n.type);
    el.style.setProperty('--nc', color);
    el.classList.toggle('node-target', n.type === 'target');

    const tab = el.querySelector('.n-tab');
    tab.textContent = n.title || typeLabel(n.type);

    this._paintRows(el, n);

    const d = parseTs(n.timestamp);
    const foot = el.querySelector('.n-foot');
    const bits = [];
    const fls = (n.flags || []).map(f => FLAG_MAP[f]).filter(Boolean);
    if (fls.length) bits.push(`<span class="n-badge flags">` + fls.map(fl =>
      `<span class="nf" style="color:${fl.color}" title="${esc(fl.label)}">${fl.icon}</span>`).join('') + `</span>`);
    if (d) bits.push(`<span class="n-badge time">🕑 ${esc(fmtDate(d))}</span>`);
    (n.evidence || []).forEach(id => {
      const ev = State.evidence(id); if (!ev) return;
      const short = ev.filename.length > 16 ? ev.filename.slice(0, 15) + '…' : ev.filename;
      bits.push(`<button class="n-badge n-att" data-ev="${id}" title="Open ${esc(ev.filename)}">📎 ${esc(short)}</button>`);
    });
    foot.innerHTML = bits.join('');
    foot.style.display = bits.length ? '' : 'none';
    el.classList.toggle('flagged', (n.flags || []).length > 0);

    const s = this.worldToScreen(n.x, n.y);
    el.style.left = s.x + 'px';
    el.style.top = s.y + 'px';
    el.style.transform = `scale(${this.view.scale})`;
    el.classList.toggle('sel', this.selected?.kind === 'node' && this.selected.id === n.id);
    el.classList.toggle('dim', this.filterActive() && !this._matches(n));
  },

  /* Rebuild row inputs only when the set of rows changed, so typing doesn't
     wipe the focused field. */
  _paintRows(el, n) {
    const rows = n.rows || [];
    const sig = rows.map(r => r.id).join(',');
    const wrap = el.querySelector('.n-rows');
    wrap.style.display = rows.length ? '' : 'none';
    if (wrap.dataset.sig === sig) return;       // same rows → leave inputs alone
    wrap.dataset.sig = sig;
    wrap.innerHTML = rows.map(r => {
      const link = r.url || rowLink(r.text);
      const flags = r.flags || [];
      const flagCls = flags.map(f => 'flag-' + f).join(' ');
      return `<div class="n-row ${flagCls}" data-row="${r.id}">
        <span class="n-row-marks">${this._marksHtml(flags)}</span>
        <button class="n-row-flagbtn" title="flags">⚑</button>
        <input class="n-row-in" value="${esc(r.text)}"
               placeholder="${esc(this._placeholder(n.type))}" />
        <a class="n-row-link" href="${esc(link || '#')}" target="_blank" rel="noopener"
           style="display:${link ? '' : 'none'}" title="open">↗</a>
        <button class="n-row-del" title="remove field">✕</button>
        <span class="n-row-conn" title="drag to link this field to a node">◇</span>
      </div>`;
    }).join('');
  },

  _marksHtml(flags) {
    return (flags || []).map(f => FLAG_MAP[f]
      ? `<span class="rmk" style="color:${FLAG_MAP[f].color}" title="${esc(FLAG_MAP[f].label)}">${FLAG_MAP[f].icon}</span>`
      : '').join('');
  },

  _openFlagMenu(rowEl, nodeId, rowId) {
    this._closeFlagMenu();
    const get = () => (State.node(nodeId).rows || []).find(x => x.id === rowId);
    const menu = document.createElement('div');
    menu.className = 'flag-menu';
    const paint = () => {
      const r = get();
      menu.innerHTML = FLAGS.map(f =>
        `<button class="flag-menu-item ${(r.flags || []).includes(f.key) ? 'active' : ''}" data-f="${f.key}">
          <span style="color:${f.color}">${f.icon}</span> ${esc(f.label)}</button>`).join('');
    };
    paint();
    document.body.appendChild(menu);
    const br = rowEl.querySelector('.n-row-flagbtn').getBoundingClientRect();
    menu.style.left = br.left + 'px';
    menu.style.top = (br.bottom + 4) + 'px';
    menu.addEventListener('mousedown', e => e.stopPropagation());
    menu.addEventListener('click', e => {
      const it = e.target.closest('.flag-menu-item');
      if (!it) return;
      State.toggleRowFlag(nodeId, rowId, it.dataset.f);
      paint();
      this._refreshRowMarks(rowEl, nodeId, rowId);
    });
    this._flagMenu = menu;
    this._flagMenuClose = ev => { if (!menu.contains(ev.target)) this._closeFlagMenu(); };
    setTimeout(() => document.addEventListener('mousedown', this._flagMenuClose), 0);
  },
  _closeFlagMenu() {
    if (this._flagMenu) {
      this._flagMenu.remove();
      this._flagMenu = null;
      document.removeEventListener('mousedown', this._flagMenuClose);
    }
  },
  _refreshRowMarks(rowEl, nodeId, rowId) {
    const r = (State.node(nodeId).rows || []).find(x => x.id === rowId);
    rowEl.querySelector('.n-row-marks').innerHTML = this._marksHtml(r.flags);
    FLAGS.forEach(f => rowEl.classList.toggle('flag-' + f.key, (r.flags || []).includes(f.key)));
  },

  _updateRowLink(rowEl, r) {
    const link = r.url || rowLink(r.text);
    const a = rowEl.querySelector('.n-row-link');
    if (!a) return;
    a.href = link || '#';
    a.style.display = link ? '' : 'none';
  },

  _placeholder(type) {
    return ({
      emails: 'email@domain.com', usernames: 'username', phone: '+1 555 0100',
      domains: 'example.com', address: 'street, city, ZIP', related: 'name',
      social: 'platform / handle', business: 'company', images: 'source / url',
      cars: 'make model year', bio: 'detail', education: 'institution',
    }[type]) || 'value';
  },

  _renderEdges() {
    let svg = '', top = '';
    State.map().edges.forEach(e => {
      const a = State.node(e.from), b = State.node(e.to);
      if (!a || !b) return;
      const p = this._edgePath(e);
      const sel = this.selected?.kind === 'edge' && this.selected.id === e.id;
      const col = typeColor(b.type);
      const dim = this.filterActive() && (!this._matches(a) || !this._matches(b));
      svg += `<path class="edge-hit" data-edge="${e.id}" d="${p.d}"></path>`;
      svg += `<path class="${sel ? 'sel' : ''}${dim ? ' dim' : ''}" style="stroke:${col}" d="${p.d}"></path>`;
      if (e.label) svg += `<text class="edge-label" x="${p.mx}" y="${p.my}"
        style="fill:${col}">${esc(e.label)}</text>`;
      // field-edge connector stubs, drawn above the node
      top += this._stub(p.pa, sel ? 'var(--accent)' : col);
      top += this._stub(p.pb, sel ? 'var(--accent)' : col);
    });
    if (this._link && this._link.tmpD)
      svg += `<path class="linking-line" d="${this._link.tmpD}"></path>`;
    this.edgeLayer.innerHTML = svg;
    this.edgeTop.innerHTML = top;
    this.edgeLayer.querySelectorAll('[data-edge]').forEach(p => {
      p.addEventListener('mousedown', ev => {
        ev.stopPropagation();
        this.select('edge', p.dataset.edge);
      });
    });
  },

  /* Anchor point in canvas-local (== edge-layer) coordinates. If a rowId is
     given and that field exists, anchor at the field's vertical centre; else
     the node centre. Read from the real rendered box (works at any height). */
  /* node bounding box in canvas-local coords (works at any height/zoom) */
  _nodeRect(nodeId) {
    const cr = this.canvas.getBoundingClientRect();
    const el = this.nodeLayer.querySelector(`[data-id="${nodeId}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      return { left: r.left - cr.left, right: r.right - cr.left,
               top: r.top - cr.top, bottom: r.bottom - cr.top,
               cx: r.left - cr.left + r.width / 2, cy: r.top - cr.top + r.height / 2 };
    }
    const n = State.node(nodeId), s = this.worldToScreen(n.x, n.y);
    const w = this.NODE_W * this.view.scale, h = 44 * this.view.scale;
    return { left: s.x, right: s.x + w, top: s.y, bottom: s.y + h,
             cx: s.x + w / 2, cy: s.y + h / 2 };
  },

  /* vertical centre of a field row, or null if not found */
  _rowY(nodeId, rowId) {
    if (rowId == null) return null;
    const cr = this.canvas.getBoundingClientRect();
    const el = this.nodeLayer.querySelector(`[data-id="${nodeId}"] [data-row="${rowId}"]`);
    return el ? el.getBoundingClientRect().top - cr.top + el.getBoundingClientRect().height / 2 : null;
  },

  /* Anchor the line to a field's own box edge. For a row link we use the
     field pill's left/right edge (whichever faces `otherCx`) at the pill's
     centre; `borderX` is the node's outer edge so a stub can bridge the gap.
     For a node link, x === borderX. Returns {x, y, side:±1, borderX}. */
  _sideAnchor(nodeId, rowId, otherCx) {
    const box = this._nodeRect(nodeId);
    const right = otherCx >= box.cx;
    const borderX = right ? box.right : box.left;
    let x = borderX, y = box.cy;
    if (rowId != null) {
      const cr = this.canvas.getBoundingClientRect();
      const pill = this.nodeLayer.querySelector(`[data-id="${nodeId}"] [data-row="${rowId}"] .n-row-in`)
                || this.nodeLayer.querySelector(`[data-id="${nodeId}"] [data-row="${rowId}"]`);
      if (pill) {
        const r = pill.getBoundingClientRect();
        y = r.top - cr.top + r.height / 2;
        x = right ? r.right - cr.left : r.left - cr.left;
      }
    }
    return { x, y, side: right ? 1 : -1, borderX };
  },

  _edgePath(e) {
    const aBox = this._nodeRect(e.from), bBox = this._nodeRect(e.to);
    const pa = this._sideAnchor(e.from, e.fromRow, bBox.cx);
    const pb = this._sideAnchor(e.to, e.toRow, aBox.cx);
    // the curve runs border→border (fully visible); the stub bridges pill→border
    const ax = pa.borderX, ay = pa.y, bx = pb.borderX, by = pb.y;
    const dx = Math.max(30, Math.abs(bx - ax) * 0.4);
    const c1x = ax + pa.side * dx, c2x = bx + pb.side * dx;
    return {
      d: `M ${ax} ${ay} C ${c1x} ${ay}, ${c2x} ${by}, ${bx} ${by}`,
      mx: (ax + bx) / 2, my: (ay + by) / 2, pa, pb,
    };
  },

  /* short connector + port dot drawn ON TOP of the node, bridging the field
     pill edge to the node border so the link visibly starts from the field */
  _stub(anchor, col) {
    if (!anchor || Math.abs(anchor.x - anchor.borderX) < 1) return '';
    return `<line x1="${anchor.x}" y1="${anchor.y}" x2="${anchor.borderX}" y2="${anchor.y}"
              stroke="${col}" stroke-width="2"/>` +
           `<circle cx="${anchor.x}" cy="${anchor.y}" r="3" fill="${col}"/>`;
  },

  // ------------------------------------------------------------- selection
  select(kind, id) {
    this.selected = { kind, id };
    this.render();
    if (kind === 'node') Inspector.openNode(id);
    else Inspector.openEdge(id);
  },
  clearSelection() { this.selected = null; this.render(); },

  // --------------------------------------------------------- canvas events
  _onCanvasDown(e) {
    if (e.target.closest('.node') || e.target.closest('[data-edge]')) return;
    // start pan
    this._pan = { sx: e.clientX, sy: e.clientY, vx: this.view.x, vy: this.view.y };
    this.canvas.classList.add('panning');
    if (this.selected) { this.selected = null; Inspector.close(); this.render(); }
  },

  _onDblClick(e) {
    if (e.target.closest('.node')) return;
    const w = this.screenToWorld(e.clientX, e.clientY);
    const n = State.addNode({ x: w.x - this.NODE_W / 2, y: w.y - 20 });
    this.render();
    this.select('node', n.id);
    setTimeout(() => Inspector.el.querySelector('#f-title')?.select(), 30);
  },

  _addCentered() {
    const r = this.canvas.getBoundingClientRect();
    const w = this.screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    const n = State.addNode({ x: w.x - this.NODE_W / 2, y: w.y - 20 });
    this.render();
    this.select('node', n.id);
  },

  _onWheel(e) {
    e.preventDefault();
    const r = this.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const ns = Math.min(2.5, Math.max(0.2, this.view.scale * factor));
    const k = ns / this.view.scale;
    // keep the point under the cursor fixed
    this.view.x = mx - (mx - this.view.x) * k;
    this.view.y = my - (my - this.view.y) * k;
    this.view.scale = ns;
    this.render();
    State.touch();                     // persist view (no structural change)
  },

  // ----------------------------------------------------------- node drag
  _onNodeDown(e, n) {
    if (e.target.classList.contains('n-handle')) return;
    // start a link from a specific field row
    const conn = e.target.closest('.n-row-conn');
    if (conn) {
      e.stopPropagation(); e.preventDefault();
      this._link = { from: n.id, fromRow: conn.closest('.n-row').dataset.row, tmpD: '' };
      return;
    }
    // let row inputs / buttons / links / flag / attachment controls handle their own clicks
    if (e.target.closest('.n-row-in, .n-row-del, .n-row-link, .n-add, .n-row-flagbtn, .n-row-marks, .n-att')) return;
    e.stopPropagation();
    this.select('node', n.id);
    this._drag = {
      id: n.id,
      offX: e.clientX - this.worldToScreen(n.x, n.y).x,
      offY: e.clientY - this.worldToScreen(n.x, n.y).y,
      moved: false,
    };
  },

  _onLinkStart(e, n) {
    e.stopPropagation();
    e.preventDefault();
    this._link = { from: n.id, tmpD: '' };
  },

  _onMove(e) {
    if (this._pan) {
      this.view.x = this._pan.vx + (e.clientX - this._pan.sx);
      this.view.y = this._pan.vy + (e.clientY - this._pan.sy);
      this.render();
      return;
    }
    if (this._drag) {
      const n = State.node(this._drag.id);
      if (!n) { this._drag = null; return; }
      // desired top-left of the node in screen space, then back to world
      const sx = e.clientX - this._drag.offX, sy = e.clientY - this._drag.offY;
      const r = this.canvas.getBoundingClientRect();
      n.x = (sx - r.left - this.view.x) / this.view.scale;
      n.y = (sy - r.top - this.view.y) / this.view.scale;
      this._drag.moved = true;
      this.render();
      return;
    }
    if (this._link) {
      if (!State.node(this._link.from)) { this._link = null; return; }
      const r = this.canvas.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const pa = this._sideAnchor(this._link.from, this._link.fromRow, px);
      this._link.tmpD = `M ${pa.x} ${pa.y} L ${px} ${py}`;
      this._renderEdges();
    }
  },

  _onUp(e) {
    if (this._pan) { this._pan = null; this.canvas.classList.remove('panning'); State.touch(); }
    if (this._drag) {
      if (this._drag.moved) State.touch('nodes', 'events');
      this._drag = null;
    }
    if (this._link) {
      const link = this._link;
      this._link = null;
      const target = e.target.closest('.node');
      if (target && target.dataset.id !== link.from) {
        const rowEl = e.target.closest('.n-row');
        const toRow = rowEl && target.contains(rowEl) ? rowEl.dataset.row : null;
        const edge = State.addEdge(link.from, target.dataset.id,
          { fromRow: link.fromRow, toRow });
        if (edge) this.select('edge', edge.id);
        else { toast('Those fields are already linked.'); this.render(); }
      } else {
        this.render();
      }
    }
  },

  _onKey(e) {
    if (e.target.matches('input, textarea, select')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) {
      if (this.selected.kind === 'node') State.removeNode(this.selected.id);
      else State.removeEdge(this.selected.id);
      this.selected = null;
      Inspector.close();
      this.render();
    }
    if (e.key === 'Escape') { this.selected = null; Inspector.close(); this.render(); }
  },

  // ------------------------------------------------------------- fit view
  fit() {
    const ns = State.map().nodes;
    if (!ns.length) { Object.assign(this.view, { x: 60, y: 60, scale: 1 }); this.render(); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    ns.forEach(n => {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + this.NODE_W); maxY = Math.max(maxY, n.y + 90);
    });
    const r = this.canvas.getBoundingClientRect();
    const pad = 60;
    const scale = Math.min(1.4,
      (r.width - pad * 2) / (maxX - minX || 1),
      (r.height - pad * 2) / (maxY - minY || 1));
    this.view.scale = Math.max(0.2, scale);
    this.view.x = pad - minX * this.view.scale;
    this.view.y = pad - minY * this.view.scale;
    this.render();
    State.touch();
  },

  focusNode(id) {
    const key = State.mapOf(id);
    if (key && key !== State.active) this.switchMap(key);
    const n = State.node(id);
    if (!n) return;
    const r = this.canvas.getBoundingClientRect();
    this.view.x = r.width / 2 - (n.x + this.NODE_W / 2) * this.view.scale;
    this.view.y = r.height / 2 - (n.y + 20) * this.view.scale;
    this.render();
    this.select('node', id);
  },

  flashNode(id) {
    const el = this.nodeLayer.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;          // restart the animation
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  },

  // ---- filtering / focus ----
  filterActive() { return this.filter.cats.size > 0 || this.filter.flags.size > 0; },
  _matches(n) {
    if (!this.filterActive()) return true;
    if (this.filter.cats.size && !this.filter.cats.has(n.type)) return false;
    if (this.filter.flags.size && !(n.flags || []).some(f => this.filter.flags.has(f))) return false;
    return true;
  },
  _toggleFilterMenu() {
    const menu = document.getElementById('filter-menu');
    if (!menu.classList.contains('hidden')) { menu.classList.add('hidden'); return; }
    this._buildFilterMenu();
    menu.classList.remove('hidden');
  },
  _buildFilterMenu() {
    const menu = document.getElementById('filter-menu');
    const cats = [...new Set(State.map().nodes.map(n => n.type))];
    const catHtml = cats.map(c =>
      `<label class="fl-item"><input type="checkbox" data-fcat="${esc(c)}" ${this.filter.cats.has(c) ? 'checked' : ''}/>
        <span class="fl-dot" style="background:${typeColor(c)}"></span>${esc(typeLabel(c))}</label>`).join('')
      || '<div class="muted">No nodes.</div>';
    const flagHtml = FLAGS.map(f =>
      `<label class="fl-item"><input type="checkbox" data-fflag="${esc(f.key)}" ${this.filter.flags.has(f.key) ? 'checked' : ''}/>
        <span style="color:${f.color}">${f.icon}</span> ${esc(f.label)}</label>`).join('');
    menu.innerHTML = `<div class="fl-head">Show only</div>
      <div class="fl-sec">Categories</div>${catHtml}
      <div class="fl-sec">Flags</div>${flagHtml}
      <button class="btn btn-small fl-clear" id="filter-clear">Clear filters</button>`;
    menu.querySelectorAll('[data-fcat]').forEach(c => c.onchange = () => {
      c.checked ? this.filter.cats.add(c.dataset.fcat) : this.filter.cats.delete(c.dataset.fcat);
      this._afterFilterChange();
    });
    menu.querySelectorAll('[data-fflag]').forEach(c => c.onchange = () => {
      c.checked ? this.filter.flags.add(c.dataset.fflag) : this.filter.flags.delete(c.dataset.fflag);
      this._afterFilterChange();
    });
    menu.querySelector('#filter-clear').onclick = () => {
      this.filter.cats.clear(); this.filter.flags.clear();
      this._buildFilterMenu(); this._afterFilterChange();
    };
  },
  _afterFilterChange() {
    const n = this.filter.cats.size + this.filter.flags.size;
    const btn = document.getElementById('filter-btn');
    btn.textContent = n ? `Filter (${n})` : 'Filter';
    btn.classList.toggle('on', n > 0);
    this.render();
  },

  _renderLegend() {
    document.getElementById('legend').innerHTML = NODE_TYPES.map(t =>
      `<span class="lg"><span class="dot" style="background:${t.color}"></span>${t.label}</span>`
    ).join('');
  },
};
