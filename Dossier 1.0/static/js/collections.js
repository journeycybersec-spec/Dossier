/* The Index view: aggregates every field value across the whole map so you can
   see "all emails", "all usernames", etc. in one place — grouped either by the
   node's category or by the detected type of the value itself. */
const Collections = {
  groupBy: 'category',
  uniqueOnly: false,
  flaggedOnly: false,

  init() {
    document.getElementById('idx-search').oninput = () => this.render();
    document.getElementById('idx-unique').onchange = e => { this.uniqueOnly = e.target.checked; this.render(); };
    document.getElementById('idx-flagged').onchange = e => { this.flaggedOnly = e.target.checked; this.render(); };
    this.el = () => document.getElementById('index-list');
    document.querySelectorAll('#view-index .seg-btn').forEach(b => {
      b.onclick = () => {
        this.groupBy = b.dataset.group;
        document.querySelectorAll('#view-index .seg-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.render();
      };
    });
    State.on('nodes', () => { if (App.activeView === 'index') this.render(); });
  },

  activate() { this.render(); },

  /* detect the value-type of a field's text (scans within the text).
     order matters: IP before phone/domain, email before handle. */
  _detect(text) {
    const t = text || '';
    if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(t)) return 'email';
    if (/https?:\/\/\S+/i.test(t)) return 'url';
    if (/\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(t) ||
        /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i.test(t)) return 'ip';
    if (/(?:^|\s)@[a-z0-9_.]{2,30}\b/i.test(t)) return 'handle';
    if (/\b(?:\+?\d[\d().\-\s]{6,}\d)\b/.test(t)) return 'phone';
    if (/\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(t)) return 'domain';
    return 'text';
  },

  _collect() {
    const q = (document.getElementById('idx-search').value || '').trim().toLowerCase();
    const out = [];
    State.invMap().nodes.forEach(n => {
      (n.rows || []).forEach(r => {
        const text = (r.text || '').trim();
        if (!text) return;
        if (q && !text.toLowerCase().includes(q)) return;
        const flags = r.flags || [];
        if (this.flaggedOnly && !flags.length) return;
        out.push({
          text,
          nodeId: n.id,
          nodeTitle: n.title || typeLabel(n.type),
          category: n.type,
          vtype: this._detect(text),
          link: r.url || rowLink(text),
          flags,
        });
      });
    });
    return out;
  },

  _typeLabel(vt) {
    return { email: 'Emails', url: 'URLs', ip: 'IP addresses', handle: 'Social handles',
             phone: 'Phone numbers', domain: 'Domains', text: 'Other' }[vt] || vt;
  },

  render() {
    const root = this.el();
    let items = this._collect();

    if (this.uniqueOnly) {
      const seen = new Set();
      items = items.filter(it => {
        const k = this.groupBy + '|' + it.text.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
    }

    document.getElementById('idx-count').textContent =
      `${items.length} value${items.length === 1 ? '' : 's'}`;

    if (!items.length) {
      root.innerHTML = `<div class="idx-empty">${this.flaggedOnly
        ? 'No flagged fields yet.<br>Flag fields with the ★ / ⚑ markers on the map.'
        : 'No field values yet.<br>Add fields to your mind-map nodes to collect them here.'}</div>`;
      return;
    }

    // group (by flag, an item can appear in multiple groups)
    const groups = {};
    items.forEach(it => {
      if (this.groupBy === 'flag') {
        (it.flags.length ? it.flags : ['_none']).forEach(k => (groups[k] ||= []).push(it));
      } else {
        const key = this.groupBy === 'category' ? it.category : it.vtype;
        (groups[key] ||= []).push(it);
      }
    });

    const label = key => this.groupBy === 'flag'
      ? (key === '_none' ? 'Unflagged' : (FLAG_MAP[key]?.label || key))
      : this.groupBy === 'category' ? typeLabel(key) : this._typeLabel(key);
    const color = key => this.groupBy === 'flag'
      ? (key === '_none' ? 'var(--text-mute)' : (FLAG_MAP[key]?.color || 'var(--accent)'))
      : this.groupBy === 'category' ? typeColor(key) : 'var(--accent)';

    let sortedKeys;
    if (this.groupBy === 'flag') {
      const order = FLAGS.map(f => f.key);
      sortedKeys = Object.keys(groups).sort((a, b) =>
        (a === '_none' ? 99 : order.indexOf(a)) - (b === '_none' ? 99 : order.indexOf(b)));
    } else {
      sortedKeys = Object.keys(groups).sort((a, b) => groups[b].length - groups[a].length);
    }

    const marks = it => (it.flags || []).map(f => FLAG_MAP[f]
      ? `<span class="idx-mark" style="color:${FLAG_MAP[f].color}" title="${esc(FLAG_MAP[f].label)}">${FLAG_MAP[f].icon}</span>` : '').join('');

    root.innerHTML = sortedKeys.map(key => {
      const rows = groups[key].map(it => `
        <div class="idx-item">
          ${marks(it)}
          <span class="idx-val">${esc(it.text)}</span>
          ${it.link ? `<a class="idx-link" href="${esc(it.link)}" target="_blank" rel="noopener">↗</a>` : ''}
          <button class="idx-src" data-node="${it.nodeId}" title="open node on map">${esc(it.nodeTitle)}</button>
        </div>`).join('');
      return `<div class="idx-group">
        <div class="idx-group-h">
          <span class="idx-dot" style="background:${color(key)}"></span>
          ${esc(label(key))} <span class="muted">· ${groups[key].length}</span>
        </div>
        ${rows}
      </div>`;
    }).join('');

    root.querySelectorAll('.idx-src').forEach(b =>
      b.onclick = () => { App.switchView('map'); MindMap.focusNode(b.dataset.node); });
  },
};
