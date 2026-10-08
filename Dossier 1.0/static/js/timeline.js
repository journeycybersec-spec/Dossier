/* Timeline view. Merges standalone events with node timestamps, sorts
   chronologically, groups by day. Each entry expands to reveal the node's
   details (full time, fields, notes, evidence). */
const Timeline = {
  includeNodes: true,
  mode: 'list',                 // 'list' | 'graphic'
  expanded: new Set(),          // keys "node:<id>" / "event:<id>" currently open

  init() {
    document.getElementById('add-event').onclick = () => this._addEvent();
    document.getElementById('tl-expand-all').onclick = () => this._toggleAll();
    const chk = document.getElementById('tl-include-nodes');
    chk.onchange = () => { this.includeNodes = chk.checked; this.render(); };
    document.querySelectorAll('[data-tlmode]').forEach(b => b.onclick = () => {
      this.mode = b.dataset.tlmode;
      document.querySelectorAll('[data-tlmode]').forEach(x => x.classList.toggle('active', x === b));
      this.render();
    });
    State.on('events', () => { if (App.activeView === 'timeline') this.render(); });
  },

  activate() { this.render(); },

  _key(it) { return `${it.kind}:${it.id}`; },

  /* flag markers for an item, taken from its source node */
  _marks(it) {
    const n = it.nodeId ? State.node(it.nodeId) : null;
    return (n ? n.flags || [] : []).map(f => FLAG_MAP[f]
      ? `<span class="tl-mark" style="color:${FLAG_MAP[f].color}" title="${esc(FLAG_MAP[f].label)}">${FLAG_MAP[f].icon}</span>`
      : '').join('');
  },

  _collect() {
    const items = [];
    State.data.events.forEach(e => {
      items.push({ kind: 'event', id: e.id, ts: e.timestamp,
                   title: e.title, notes: e.notes, nodeId: e.nodeId });
    });
    if (this.includeNodes) {
      State.invMap().nodes.forEach(n => {
        if (!n.timestamp) return;
        items.push({ kind: 'node', id: n.id, ts: n.timestamp,
                     title: n.title, notes: n.notes, nodeType: n.type, nodeId: n.id });
      });
    }
    items.sort((a, b) => {
      const da = parseTs(a.ts), db = parseTs(b.ts);
      if (da && db) return da - db;
      if (da) return -1; if (db) return 1; return 0;
    });
    return items;
  },

  /* the expandable detail block for an item, built from its source node */
  _detail(it) {
    const d = parseTs(it.ts);
    const bits = [];
    if (d) bits.push(`<div class="tl-d-row"><span class="tl-d-k">Time</span>
      <span class="mono">${esc(fmtDate(d))} ${esc(fmtTime(d))}</span></div>`);

    const n = it.nodeId ? State.node(it.nodeId) : null;
    if (n) {
      const rows = (n.rows || []).map(r => r.text).filter(Boolean);
      if (rows.length) bits.push(`<div class="tl-d-row"><span class="tl-d-k">Fields</span>
        <span class="tl-fields">${rows.map(r => `<span class="tl-field">${esc(r)}</span>`).join('')}</span></div>`);
      const evs = (n.evidence || []).map(id => State.evidence(id)).filter(Boolean);
      if (evs.length) bits.push(`<div class="tl-d-row"><span class="tl-d-k">Evidence</span>
        <span>${evs.map(e => `📎 ${esc(e.filename)}`).join('<br>')}</span></div>`);
    }
    if (it.kind === 'node' && n) {
      // notes for a node are edited here on the timeline
      bits.push(`<div class="tl-d-row"><span class="tl-d-k">Notes</span>
        <textarea class="tl-note-edit" data-node="${n.id}"
          placeholder="Add notes for this node…">${esc(n.notes || '')}</textarea></div>`);
    } else if (it.notes) {
      bits.push(`<div class="tl-d-row"><span class="tl-d-k">Notes</span>
        <span class="tl-notes">${esc(it.notes)}</span></div>`);
    }
    return bits.length ? `<div class="tl-detail">${bits.join('')}</div>` : '';
  },

  render() {
    const root = document.getElementById('timeline');
    const items = this._collect();
    document.getElementById('tl-count').textContent =
      `${items.length} entr${items.length === 1 ? 'y' : 'ies'}`;

    root.classList.toggle('graphic', this.mode === 'graphic');
    document.getElementById('tl-expand-all').style.display = this.mode === 'graphic' ? 'none' : '';
    if (this.mode === 'graphic') { this.renderGraphic(items); return; }

    this._syncExpandLabel(items);

    if (!items.length) {
      root.innerHTML = `<div class="tl-empty">No events yet.<br>
        Add timestamps to mind-map nodes, or click “+ Event”.</div>`;
      return;
    }

    let html = '', curDay = null;
    items.forEach(it => {
      const d = parseTs(it.ts);
      const dayLabel = d ? fmtDate(d) : 'Undated';
      if (dayLabel !== curDay) {
        if (curDay !== null) html += '</div>';
        html += `<div class="tl-day"><div class="tl-day-label">${esc(dayLabel)}</div>`;
        curDay = dayLabel;
      }
      const key = this._key(it);
      const open = this.expanded.has(key);
      const fromNode = it.kind === 'node';
      const tag = fromNode
        ? `<span class="tl-tag" data-node="${it.nodeId}" style="color:${typeColor(it.nodeType)}">
             ◆ ${esc(typeLabel(it.nodeType))} node · open on map</span>`
        : (it.nodeId
            ? `<span class="tl-tag" data-node="${it.nodeId}">◆ linked node · open on map</span>`
            : '');
      const editAttr = fromNode ? `data-open-node="${it.id}"` : `data-open-event="${it.id}"`;
      html += `
        <div class="tl-item ${fromNode ? 'from-node' : ''}" data-key="${key}">
          <div class="tl-time">${esc(d ? fmtTime(d) : '')}</div>
          <div class="tl-body">
            <div class="tl-ttl" data-toggle="${key}">
              <span class="tl-caret">${open ? '▾' : '▸'}</span>${esc(it.title || '(untitled)')}
              ${this._marks(it)}</div>
            ${open ? this._detail(it) : ''}
            ${tag}
          </div>
          <div class="tl-actions">
            <button class="btn btn-small" ${editAttr}>Edit</button>
          </div>
        </div>`;
    });
    html += '</div>';
    root.innerHTML = html;

    root.querySelectorAll('[data-toggle]').forEach(h =>
      h.onclick = () => {
        const k = h.dataset.toggle;
        this.expanded.has(k) ? this.expanded.delete(k) : this.expanded.add(k);
        this.render();
      });
    root.querySelectorAll('.tl-note-edit').forEach(ta => {
      ta.onclick = e => e.stopPropagation();        // don't toggle collapse
      ta.oninput = () => {
        const n = State.node(ta.dataset.node);
        if (n) { n.notes = ta.value; State.touchSave(); }   // save, no re-render → keep focus
      };
    });
    root.querySelectorAll('[data-open-event]').forEach(b =>
      b.onclick = () => Inspector.openEvent(b.dataset.openEvent));
    root.querySelectorAll('[data-open-node]').forEach(b =>
      b.onclick = () => Inspector.openNode(b.dataset.openNode));
    root.querySelectorAll('.tl-tag[data-node]').forEach(t =>
      t.onclick = () => { App.switchView('map'); MindMap.focusNode(t.dataset.node); });
  },

  _toggleAll() {
    const items = this._collect();
    const allOpen = items.length && items.every(it => this.expanded.has(this._key(it)));
    this.expanded = allOpen ? new Set() : new Set(items.map(it => this._key(it)));
    this.render();
  },

  _syncExpandLabel(items) {
    const btn = document.getElementById('tl-expand-all');
    const allOpen = items.length && items.every(it => this.expanded.has(this._key(it)));
    btn.textContent = allOpen ? 'Collapse all' : 'Expand all';
  },

  /* jump here from a node and flash its entry (used by the inspector) */
  highlight(nodeId) {
    this.expanded.add(`node:${nodeId}`);
    this.render();
    const el = document.querySelector(`#timeline [data-key="node:${nodeId}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.add('flash');
      setTimeout(() => el.classList.remove('flash'), 1600);
    }
  },

  /* horizontal, time-scaled visual timeline */
  renderGraphic(items) {
    const root = document.getElementById('timeline');
    const dated = items.map(it => ({ it, t: parseTs(it.ts) })).filter(o => o.t)
      .map(o => ({ it: o.it, t: o.t.getTime() })).sort((a, b) => a.t - b.t);
    const undated = items.length - dated.length;

    if (!dated.length) {
      root.innerHTML = `<div class="tl-empty">No dated entries to graph.<br>
        Add a date to a node or event.</div>`;
      return;
    }

    const PAD = 70, cardW = 150, gap = 14, laneH = 72, baseGap = 30;
    const avail = Math.max(640, root.clientWidth - 40);
    const W = Math.max(avail, dated.length * 155);
    const min = dated[0].t, max = dated[dated.length - 1].t, range = max - min;
    const xOf = (t, i) => range > 0
      ? PAD + (W - 2 * PAD) * (t - min) / range
      : PAD + (W - 2 * PAD) * (dated.length > 1 ? i / (dated.length - 1) : 0.5);

    // lane packing: first free lane whose last card ends before this x
    const laneEnds = [];
    const placed = dated.map(({ it, t }, i) => {
      const x = xOf(t, i);
      let lane = laneEnds.findIndex(end => x - cardW / 2 - gap >= end);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = x + cardW / 2;
      return { it, t, x, lane };
    });
    const topRows = Math.ceil(laneEnds.length / 2), botRows = Math.floor(laneEnds.length / 2);
    const spineY = baseGap + topRows * laneH;
    const H = spineY + baseGap + botRows * laneH + 30;

    let html = `<div class="tl-canvas" style="width:${W}px;height:${H}px">`;
    html += `<div class="tl-spine" style="top:${spineY}px;width:${W - PAD}px;left:${PAD / 2}px"></div>`;

    // date ticks
    const ticks = Math.min(8, Math.max(2, Math.floor(W / 180)));
    for (let i = 0; i <= ticks; i++) {
      const tt = min + range * i / ticks, tx = PAD + (W - 2 * PAD) * i / ticks;
      const d = new Date(tt);
      const lbl = range <= 2 * 864e5 ? `${fmtDate(d)} ${fmtTime(d)}` : fmtDate(d);
      html += `<div class="tl-tick" style="left:${tx}px;top:${spineY - 6}px"></div>`;
      html += `<div class="tl-ticklbl" style="left:${tx}px;top:${spineY + 9}px">${esc(lbl)}</div>`;
    }

    // markers + cards
    placed.forEach(p => {
      const side = p.lane % 2 === 0 ? 'top' : 'bottom';
      const row = Math.floor(p.lane / 2);
      const node = p.it.kind === 'node' ? State.node(p.it.id) : (p.it.nodeId ? State.node(p.it.nodeId) : null);
      const col = p.it.kind === 'node' ? typeColor(p.it.nodeType) : 'var(--accent)';
      const d = new Date(p.t);
      const cardH = laneH - 16;
      const cardY = side === 'top'
        ? spineY - baseGap - (row + 1) * laneH + 8
        : spineY + baseGap + row * laneH - 8;
      const connTop = Math.min(spineY, side === 'top' ? cardY + cardH : cardY);
      const connH = Math.abs((side === 'top' ? cardY + cardH : cardY) - spineY);
      const marks = this._marks(p.it);
      const attr = p.it.kind === 'node' ? `data-open-node="${p.it.id}"` : `data-open-event="${p.it.id}"`;
      html += `<div class="tl-conn" style="left:${p.x}px;top:${connTop}px;height:${connH}px"></div>`;
      html += `<div class="tl-dot" style="left:${p.x}px;top:${spineY}px;border-color:${col}"></div>`;
      html += `<div class="tl-card" ${attr} style="left:${p.x - cardW / 2}px;top:${cardY}px;width:${cardW}px;border-left-color:${col}">
        <div class="tl-card-time">${esc(fmtTime(d))} · ${esc(fmtDate(d))}</div>
        <div class="tl-card-ttl">${esc(p.it.title || '(untitled)')} ${marks}</div>
        ${node && (node.rows || []).some(r => r.text) ? `<div class="tl-card-sub">${esc((node.rows.find(r => r.text) || {}).text || '')}</div>` : ''}
      </div>`;
    });

    html += '</div>';
    if (undated) html += `<div class="tl-undated-note">${undated} undated entr${undated === 1 ? 'y' : 'ies'} not shown — switch to List to see them.</div>`;
    root.innerHTML = html;

    root.querySelectorAll('[data-open-node]').forEach(c =>
      c.onclick = () => { App.switchView('map'); MindMap.focusNode(c.dataset.openNode); });
    root.querySelectorAll('[data-open-event]').forEach(c =>
      c.onclick = () => Inspector.openEvent(c.dataset.openEvent));
  },

  _addEvent() {
    const now = new Date();
    const pad = x => String(x).padStart(2, '0');
    const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
                  `T${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const e = State.addEvent({ timestamp: local, title: '' });
    this.render();
    Inspector.openEvent(e.id);
    setTimeout(() => Inspector.el.querySelector('#e-title')?.focus(), 30);
  },
};
