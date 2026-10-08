/* The right-side drawer: edits a node or a timeline event in place. */
const Inspector = {
  el: null,
  current: null,   // { kind: 'node'|'event', id }

  init() { this.el = document.getElementById('inspector'); },

  close() {
    this.current = null;
    this.el.classList.add('hidden');
    this.el.innerHTML = '';
    MindMap.clearSelection && MindMap.clearSelection();
  },

  openNode(id) {
    const n = State.node(id);
    if (!n) return;
    this.current = { kind: 'node', id };
    this.el.classList.remove('hidden');
    this.renderNode(n);
  },

  openEvent(id) {
    const e = State.event(id);
    if (!e) return;
    this.current = { kind: 'event', id };
    this.el.classList.remove('hidden');
    this.renderEvent(e);
  },

  openEdge(id) {
    const e = State.edge(id);
    if (!e) return;
    this.current = { kind: 'edge', id };
    this.el.classList.remove('hidden');
    const a = State.node(e.from), b = State.node(e.to);
    this.el.innerHTML = `
      <div class="insp-head"><h3>Link</h3>
        <button class="insp-close">✕</button></div>
      <div class="muted">${esc(a ? (a.title || typeLabel(a.type)) : '?')}
        → ${esc(b ? (b.title || typeLabel(b.type)) : '?')}</div>
      <div class="field"><label>Label</label>
        <input type="text" id="g-label" value="${esc(e.label || '')}"
          placeholder="e.g. email, uses, owns…" /></div>
      <div class="insp-footer">
        <button class="btn btn-danger" id="g-del">Delete link</button>
      </div>`;
    this.el.querySelector('.insp-close').onclick = () => this.close();
    this.el.querySelector('#g-label').oninput = ev => {
      e.label = ev.target.value; State.touch('nodes');
    };
    this.el.querySelector('#g-del').onclick = () => {
      State.removeEdge(e.id);
      this.close();
    };
  },

  // --------------------------------------------------------------- node
  renderNode(n) {
    // grouped category dropdown
    const groups = {};
    NODE_TYPES.forEach(t => (groups[t.group] ||= []).push(t));
    const typeOptions = Object.entries(groups).map(([g, items]) =>
      `<optgroup label="${esc(g)}">` + items.map(t =>
        `<option value="${t.key}" ${t.key === n.type ? 'selected' : ''}>${esc(t.label)}</option>`
      ).join('') + '</optgroup>').join('');

    const attached = (n.evidence || []).map(evid => {
      const ev = State.evidence(evid);
      if (!ev) return '';
      return `<div class="insp-ev">📎 <span>${esc(ev.filename)}</span>
                <button class="x" data-detach="${evid}" title="detach">✕</button></div>`;
    }).join('') || '<div class="muted">No evidence linked.</div>';

    const evOptions = State.data.evidence
      .filter(ev => !(n.evidence || []).includes(ev.id))
      .map(ev => `<option value="${ev.id}">${esc(ev.filename)}</option>`).join('');

    this.el.innerHTML = `
      <div class="insp-head"><h3>Node</h3>
        <button class="insp-close" title="close">✕</button></div>

      <div class="field"><label>Title</label>
        <input type="text" id="f-title" value="${esc(n.title)}" /></div>

      <div class="field"><label>Category</label>
        <select id="f-type" class="type-select"
          style="border-left:4px solid ${typeColor(n.type)}">${typeOptions}</select></div>

      ${n.notes ? `<div class="field"><label>Note
          <span class="muted">(edited on the timeline)</span></label>
        <div class="insp-note-ro">${esc(n.notes)}</div></div>` : ''}

      <div class="field"><label>Fields <span class="muted">(${(n.rows || []).length})</span></label>
        <div class="muted">Edit the value fields directly on the node. Use
          <b>+ field</b> on the node to add one.</div>
        <button class="btn btn-small" id="f-addrow" style="margin-top:8px">+ Add field</button></div>

      <div class="field"><label>Flags</label>
        <div class="flag-row">
          ${FLAGS.map(f => `<button class="flag-btn ${(n.flags || []).includes(f.key) ? 'active' : ''}"
            data-nflag="${f.key}" style="--fc:${f.color}">${f.icon} ${esc(f.label)}</button>`).join('')}
        </div>
        <div class="muted" style="margin-top:4px">Flag whole nodes, or individual fields via the ★/⚑ on each field.</div>
      </div>

      <div class="field"><label>Date &amp; time (optional — adds it to the timeline)</label>
        <div style="display:flex;gap:8px">
          <input type="date" id="f-date" value="${esc(splitTs(n.timestamp).date)}" style="flex:2" />
          <input type="time" id="f-time" value="${esc(splitTs(n.timestamp).time)}" style="flex:1" />
        </div>
        <div class="muted" style="margin-top:5px">Set a date and it shows on the timeline. Time is optional.</div>
        ${n.timestamp
          ? `<button class="btn btn-small" id="f-tl" style="margin-top:8px">View on timeline →</button>`
          : ''}
        ${n.notes && !n.timestamp
          ? `<div class="muted" style="margin-top:6px">This node has notes but no date — add a date to edit them on the timeline.</div>`
          : ''}
      </div>

      <div class="field"><label>Evidence</label>
        <div class="insp-ev-list">${attached}</div>
        ${evOptions ? `<div style="display:flex;gap:6px;margin-top:8px">
          <select id="f-ev-add"><option value="">+ link evidence…</option>${evOptions}</select>
        </div>` : `<div class="muted" style="margin-top:8px">
          Upload files in the Evidence tab to link them here.</div>`}
      </div>

      <div class="insp-footer">
        <button class="btn btn-danger" id="f-del">Delete node</button>
      </div>`;

    this._wireNode(n);
  },

  _wireNode(n) {
    const $ = s => this.el.querySelector(s);
    this.el.querySelector('.insp-close').onclick = () => this.close();

    $('#f-title').oninput = e => { n.title = e.target.value; State.touch('nodes'); };
    const combineTs = () => {
      n.timestamp = joinTs($('#f-date').value, $('#f-time').value);
      State.touch('nodes', 'events');
    };
    $('#f-date').oninput = combineTs;
    $('#f-time').oninput = combineTs;
    const tlBtn = $('#f-tl');
    if (tlBtn) tlBtn.onclick = () => { App.switchView('timeline'); Timeline.highlight(n.id); };

    this.el.querySelectorAll('[data-nflag]').forEach(b => b.onclick = () => {
      State.toggleNodeFlag(n.id, b.dataset.nflag);
      this.el.querySelectorAll('[data-nflag]').forEach(x =>
        x.classList.toggle('active', (n.flags || []).includes(x.dataset.nflag)));
      MindMap.render();
    });

    $('#f-type').onchange = e => {
      const old = n.type;
      n.type = e.target.value;
      // if the title was just the old category's default label, keep it in sync
      if (!n.title || n.title === typeLabel(old)) n.title = typeLabel(n.type);
      e.target.style.borderLeft = '4px solid ' + typeColor(n.type);
      this.renderNode(n);               // refresh title field + colour
      State.touch('nodes');
    };
    const addBtn = $('#f-addrow');
    if (addBtn) addBtn.onclick = () => {
      const r = State.addRow(n.id, '');
      MindMap.render();
      this.renderNode(n);
      setTimeout(() =>
        document.querySelector(`[data-id="${n.id}"] [data-row="${r.id}"] .n-row-in`)?.focus(), 0);
    };

    const addSel = $('#f-ev-add');
    if (addSel) addSel.onchange = e => {
      const id = e.target.value;
      if (!id) return;
      (n.evidence ||= []).push(id);
      State.touch('nodes');
      this.renderNode(n);
    };
    this.el.querySelectorAll('[data-detach]').forEach(b => {
      b.onclick = () => {
        n.evidence = (n.evidence || []).filter(x => x !== b.dataset.detach);
        State.touch('nodes');
        this.renderNode(n);
      };
    });
    $('#f-del').onclick = () => {
      if (!confirm('Delete this node?')) return;
      State.removeNode(n.id);
      this.close();
    };
  },

  // --------------------------------------------------------------- event
  renderEvent(e) {
    const nodeOptions = State.invMap().nodes
      .map(n => `<option value="${n.id}" ${e.nodeId === n.id ? 'selected' : ''}>
        ${esc(n.title)}</option>`).join('');

    this.el.innerHTML = `
      <div class="insp-head"><h3>Timeline event</h3>
        <button class="insp-close">✕</button></div>

      <div class="field"><label>When</label>
        <div style="display:flex;gap:8px">
          <input type="date" id="e-date" value="${esc(splitTs(e.timestamp).date)}" style="flex:2" />
          <input type="time" id="e-time" value="${esc(splitTs(e.timestamp).time)}" style="flex:1" />
        </div></div>

      <div class="field"><label>Title</label>
        <input type="text" id="e-title" value="${esc(e.title)}" /></div>

      <div class="field"><label>Notes</label>
        <textarea id="e-notes">${esc(e.notes)}</textarea></div>

      <div class="field"><label>Linked node (optional)</label>
        <select id="e-node"><option value="">— none —</option>${nodeOptions}</select></div>

      <div class="insp-footer">
        <button class="btn btn-danger" id="e-del">Delete event</button>
      </div>`;

    const $ = s => this.el.querySelector(s);
    this.el.querySelector('.insp-close').onclick = () => this.close();
    const combineEv = () => { e.timestamp = joinTs($('#e-date').value, $('#e-time').value); State.touch('events'); };
    $('#e-date').oninput  = combineEv;
    $('#e-time').oninput  = combineEv;
    $('#e-title').oninput = ev => { e.title = ev.target.value; State.touch('events'); };
    $('#e-notes').oninput = ev => { e.notes = ev.target.value; State.touch('events'); };
    $('#e-node').onchange = ev => { e.nodeId = ev.target.value || null; State.touch('events'); };
    $('#e-del').onclick = () => {
      if (!confirm('Delete this event?')) return;
      State.removeEvent(e.id);
      this.close();
    };
  },
};
