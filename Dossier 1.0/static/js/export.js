/* The three export actions (bottom-centre dock on the map view):
   data (JSON) · report (printable HTML) · image (PNG of the map). */
const Exporter = {
  init() {
    const b = id => document.getElementById(id);
    b('exp-data').onclick  = () => this.data();
    b('exp-pdf').onclick   = () => this.pdf();
    b('exp-word').onclick  = () => this.word();
    b('exp-image').onclick = () => this.image();

    // top-bar Export dropdown (all formats in one place)
    const btn = b('export-btn'), menu = b('export-menu');
    btn.onclick = e => { e.stopPropagation(); menu.classList.toggle('hidden'); };
    document.addEventListener('mousedown', e => {
      if (!e.target.closest('.export-menu-wrap')) menu.classList.add('hidden');
    });
    menu.querySelectorAll('[data-exp]').forEach(item => item.onclick = () => {
      menu.classList.add('hidden');
      const k = item.dataset.exp;
      if (k === 'pdf') this.pdf();
      else if (k === 'word') this.word();
      else if (k === 'json') this.data();
      else if (k === 'png') this.image();
      else if (k === 'zip') window.location = API.exportUrl(State.caseId);
    });
  },

  _safeName() {
    return (State.data.name || 'case').replace(/[^\w.-]+/g, '_').slice(0, 80) || 'case';
  },

  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  // resolve a colour that may be a CSS var() into a concrete value for SVG/canvas
  _color(c) {
    const m = /var\((--[\w-]+)\)/.exec(c || '');
    if (m) {
      const v = getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim();
      return v || '#8b97a6';
    }
    return c || '#8b97a6';
  },

  // ----------------------------------------------------------- 1) data (JSON)
  data() {
    State.syncEmbeddedDefs();          // ensure custom categories/flags travel
    const blob = new Blob([JSON.stringify(State.data, null, 2)], { type: 'application/json' });
    this._download(blob, `dossier_${this._safeName()}.json`);
    toast('Exported case data (JSON)');
  },

  // ----------------------------------------------------- 2) report (PDF / Word)
  _isImg(name) { return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || ''); },

  /* fetch every evidence file and base64-encode it, so the report is fully
     self-contained (images embedded inline) */
  async _evidenceAssets() {
    const out = {};
    for (const ev of (State.data.evidence || [])) {
      try {
        const res = await fetch(API.evidenceUrl(State.caseId, ev.id));
        const blob = await res.blob();
        out[ev.id] = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
      } catch (_) { out[ev.id] = null; }
    }
    return out;
  },

  _reportStyles() {
    return `
      body { font: 13px/1.5 system-ui, "Segoe UI", sans-serif; color: #1a1f26; max-width: 860px; margin: 0 auto; padding: 34px 28px 80px; }
      h1 { margin: 0 0 2px; font-size: 24px; } h2 { margin: 28px 0 8px; border-bottom: 2px solid #e4e8ee; padding-bottom: 4px; font-size: 17px; }
      h3 { margin: 18px 0 6px; font-size: 14px; color: #3a4452; }
      .sub { color: #67727f; margin-bottom: 6px; } .muted { color: #67727f; font-size: 12px; }
      .ent { border: 1px solid #e4e8ee; border-radius: 8px; padding: 9px 13px; margin: 8px 0; }
      .pill { color: #10141a; font-size: 10px; font-weight: 700; padding: 1px 8px; border-radius: 20px; }
      .notes { white-space: pre-wrap; margin: 5px 0; padding: 6px 8px; background: #f6f8fa; border-radius: 6px; }
      ul { margin: 4px 0; padding-left: 20px; }
      table { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 4px; }
      th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eef1f5; vertical-align: top; }
      th { color: #67727f; font-weight: 600; }
      .mono { font-family: Consolas, ui-monospace, monospace; font-size: 10px; word-break: break-all; }
      .evthumb { max-width: 120px; max-height: 90px; border: 1px solid #d7deea; border-radius: 4px; margin: 4px 6px 0 0; vertical-align: top; }
      .evbig { max-width: 420px; max-height: 300px; border: 1px solid #d7deea; border-radius: 4px; display: block; margin: 4px 0; }
      .tlimg { max-width: 100%; border: 1px solid #e4e8ee; border-radius: 6px; display: block; margin: 6px 0 10px; }
      .ext { display: inline-block; background: #eef1f5; color: #67727f; font-weight: 700; padding: 10px 14px; border-radius: 6px; }
      table.meta { width: auto; margin: 6px 0 10px; } table.meta th { text-align: left; padding: 3px 16px 3px 0; color: #67727f; font-weight: 600; white-space: nowrap; border: none; } table.meta td { padding: 3px 0; border: none; }
      .tlp { font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 4px; border: 1px solid #999; }
      .tlp-red { background: #ffd7dc; color: #a30010; border-color: #a30010; }
      .tlp-amber, .tlp-amberstrict { background: #ffe8c2; color: #8a5300; border-color: #8a5300; }
      .tlp-green { background: #d8f5df; color: #0a6b2e; border-color: #0a6b2e; }
      .tlp-clear { background: #eef1f5; color: #3a4452; border-color: #9aa7b6; }`;
  },

  /* the full case document body (investigation, timeline, evidence appendix) */
  _reportBody(assets, timelinePng, mapPng) {
    const genDate = new Date();
    const inv = State.invMap();
    const meta = State.data.meta || {};
    const marks = flags => (flags || []).map(f => FLAG_MAP[f]
      ? `<span style="color:${FLAG_MAP[f].color}" title="${esc(FLAG_MAP[f].label)}">${FLAG_MAP[f].icon}</span>` : '').join(' ');
    const evThumbs = n => (n.evidence || []).map(id => {
      const ev = State.evidence(id); if (!ev) return '';
      const u = assets[id];
      return u && this._isImg(ev.filename)
        ? `<img class="evthumb" src="${u}" alt="${esc(ev.filename)}"/>`
        : `<span class="muted">📎 ${esc(ev.filename)}</span> `;
    }).join('');

    const entityBlock = nodes => nodes.map(n => {
      const rows = (n.rows || []).filter(r => (r.text || '').trim());
      const dt = parseTs(n.timestamp);
      return `<div class="ent">
        <div><span class="pill" style="background:${this._color(typeColor(n.type))}">${esc(typeLabel(n.type))}</span>
          <b>${esc(n.title || typeLabel(n.type))}</b> ${marks(n.flags)}
          ${dt ? `<span class="muted"> · ${esc(fmtDate(dt))} ${esc(fmtTime(dt))}</span>` : ''}</div>
        ${rows.length ? `<ul>${rows.map(r => `<li>${marks(r.flags)} ${esc(r.text)}</li>`).join('')}</ul>` : ''}
        ${n.notes ? `<div class="notes">${esc(n.notes)}</div>` : ''}
        ${(n.evidence || []).length ? `<div>${evThumbs(n)}</div>` : ''}
      </div>`;
    }).join('') || '<div class="muted">None.</div>';

    const relBlock = edges => {
      const rows = edges.map(e => {
        const a = State.node(e.from), b = State.node(e.to);
        if (!a || !b) return '';
        return `<tr><td>${esc(a.title || typeLabel(a.type))}</td><td class="muted">${esc(e.label || '—')}</td>
          <td>${esc(b.title || typeLabel(b.type))}</td></tr>`;
      }).join('');
      return rows ? `<table><thead><tr><th>From</th><th>Link</th><th>To</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<div class="muted">None.</div>';
    };

    // flagged fields (investigation map only)
    const flaggedByFlag = {};
    inv.nodes.forEach(n => (n.rows || []).forEach(r => {
      if (!(r.text || '').trim()) return;
      (r.flags || []).forEach(f => (flaggedByFlag[f] ||= []).push({ text: r.text, node: n }));
    }));
    const flaggedHtml = FLAGS.filter(f => flaggedByFlag[f.key]).map(f =>
      `<div class="ent"><div><b style="color:${f.color}">${f.icon} ${esc(f.label)}</b>
        <span class="muted"> · ${flaggedByFlag[f.key].length}</span></div>
        <ul>${flaggedByFlag[f.key].map(x => `<li>${esc(x.text)}
          <span class="muted">— ${esc(x.node.title || typeLabel(x.node.type))}</span></li>`).join('')}</ul></div>`).join('');

    // timeline (investigation + events)
    const items = [];
    State.data.events.forEach(e => items.push({ ts: e.timestamp, title: e.title, notes: e.notes }));
    inv.nodes.forEach(n => { if (n.timestamp) items.push({ ts: n.timestamp, title: n.title, notes: n.notes }); });
    items.sort((a, b) => { const da = parseTs(a.ts), db = parseTs(b.ts); if (da && db) return da - db; if (da) return -1; if (db) return 1; return 0; });
    const tlHtml = items.map(it => { const dt = parseTs(it.ts);
      return `<tr><td class="mono">${dt ? esc(fmtDate(dt) + ' ' + fmtTime(dt)) : '—'}</td>
        <td><b>${esc(it.title || '(untitled)')}</b>${it.notes ? `<div class="muted">${esc(it.notes)}</div>` : ''}</td></tr>`; }).join('');

    // evidence appendix with inline images + hashes + usage
    const evHtml = (State.data.evidence || []).map(e => {
      const u = assets[e.id]; const dt = parseTs(e.uploaded);
      const used = inv.nodes.filter(n => (n.evidence || []).includes(e.id)).map(n => n.title || typeLabel(n.type));
      const media = u && this._isImg(e.filename)
        ? `<img class="evbig" src="${u}" alt="${esc(e.filename)}"/>`
        : `<span class="ext">${esc((e.filename.split('.').pop() || 'FILE').toUpperCase())}</span>`;
      return `<div class="ent"><div><b>${esc(e.filename)}</b>
          <span class="muted"> · ${fmtBytes(e.size)}${dt ? ' · ' + esc(fmtDate(dt)) : ''}</span></div>
        ${media}
        <div class="mono">sha256: ${esc(e.sha256 || '')}</div>
        <div class="muted">${used.length ? 'linked to: ' + used.map(esc).join(', ') : 'not linked to any node'}</div>
      </div>`;
    }).join('') || '<div class="muted">None.</div>';

    // date range from dated items
    const dts = items.map(it => parseTs(it.ts)).filter(Boolean).sort((a, b) => a - b);
    const range = dts.length ? `${fmtDate(dts[0])} – ${fmtDate(dts[dts.length - 1])}` : '—';
    const tlp = meta.classification
      ? `<span class="tlp tlp-${esc((meta.classification.split(':')[1] || '').toLowerCase().replace(/\\W/g, ''))}">${esc(meta.classification)}</span>` : '';
    const metaRows = [
      meta.caseNumber ? `<tr><th>Case #</th><td>${esc(meta.caseNumber)}</td></tr>` : '',
      meta.analyst ? `<tr><th>Analyst</th><td>${esc(meta.analyst)}</td></tr>` : '',
      meta.classification ? `<tr><th>Classification</th><td>${tlp}</td></tr>` : '',
      `<tr><th>Date range</th><td>${range}</td></tr>`,
      `<tr><th>Generated</th><td>${esc(fmtDate(genDate))} ${esc(fmtTime(genDate))}</td></tr>`,
    ].join('');

    return `
      <h1>${esc(State.data.name)} ${tlp}</h1>
      <div class="sub">Investigation case report</div>
      <table class="meta">${metaRows}</table>
      <div class="muted">${inv.nodes.length} entities · ${inv.edges.length} relationships ·
        ${items.length} timeline entries · ${(State.data.evidence || []).length} evidence files</div>
      ${meta.summary ? `<h2>Summary</h2><div class="notes">${esc(meta.summary)}</div>` : ''}

      ${flaggedHtml ? `<h2>Flagged items</h2>${flaggedHtml}` : ''}
      ${mapPng ? `<h2>Relationship map</h2><img class="tlimg" src="${mapPng}" alt="relationship map"/>` : ''}
      <h2>Entities</h2>${entityBlock(inv.nodes)}
      <h3>Relationships</h3>${relBlock(inv.edges)}
      <h2>Timeline</h2>
      ${timelinePng ? `<img class="tlimg" src="${timelinePng}" alt="timeline"/>` : ''}
      ${tlHtml ? `<table><thead><tr><th>When</th><th>Event</th></tr></thead><tbody>${tlHtml}</tbody></table>` : '<div class="muted">No dated entries.</div>'}
      <h2>Evidence</h2>${evHtml}`;
  },

  async pdf() {
    toast('Preparing PDF…');
    const [assets, tlPng, mapPng] = await Promise.all([this._evidenceAssets(), this._timelinePng(), this._mapPng()]);
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <title>${esc(State.data.name)} — case report</title><style>${this._reportStyles()}
      .toolbar{position:fixed;top:12px;right:12px}@media print{.toolbar{display:none}}
      button{font:inherit;padding:8px 16px;border-radius:8px;border:1px solid #c7ced7;background:#fff;cursor:pointer}
      </style></head><body>
      <div class="toolbar"><button onclick="window.print()">Print / Save PDF</button></div>
      ${this._reportBody(assets, tlPng, mapPng)}
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),400));<\/script>
      </body></html>`;
    const w = window.open('', '_blank');
    if (!w) { toast('Allow pop-ups to generate the PDF', true); return; }
    w.document.open(); w.document.write(html); w.document.close();
  },

  /* a horizontal graphic timeline of the investigation, as an SVG string */
  _timelineSvg() {
    const items = [];
    State.data.events.forEach(e => items.push({ ts: e.timestamp, title: e.title, kind: 'event' }));
    State.invMap().nodes.forEach(n => { if (n.timestamp) items.push({ ts: n.timestamp, title: n.title, kind: 'node', nodeType: n.type }); });
    const dated = items.map(it => ({ it, t: parseTs(it.ts) })).filter(o => o.t)
      .map(o => ({ it: o.it, t: o.t.getTime() })).sort((a, b) => a.t - b.t);
    if (!dated.length) return null;

    const PAD = 70, cardW = 150, gap = 14, laneH = 70, baseGap = 26;
    const W = Math.max(700, dated.length * 155);
    const min = dated[0].t, max = dated[dated.length - 1].t, range = max - min;
    const xOf = (t, i) => range > 0 ? PAD + (W - 2 * PAD) * (t - min) / range
      : PAD + (W - 2 * PAD) * (dated.length > 1 ? i / (dated.length - 1) : 0.5);
    const laneEnds = [];
    const placed = dated.map(({ it, t }, i) => {
      const x = xOf(t, i);
      let lane = laneEnds.findIndex(e => x - cardW / 2 - gap >= e);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = x + cardW / 2;
      return { it, t, x, lane };
    });
    const topRows = Math.ceil(laneEnds.length / 2), botRows = Math.floor(laneEnds.length / 2);
    const spineY = baseGap + topRows * laneH, H = spineY + baseGap + botRows * laneH + 30;

    let s = `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`;
    s += `<line x1="${PAD / 2}" y1="${spineY}" x2="${W - PAD / 2}" y2="${spineY}" stroke="#c7ced7" stroke-width="2"/>`;
    const ticks = Math.min(8, Math.max(2, Math.floor(W / 180)));
    for (let i = 0; i <= ticks; i++) {
      const tt = min + range * i / ticks, tx = PAD + (W - 2 * PAD) * i / ticks, d = new Date(tt);
      const lbl = range <= 2 * 864e5 ? `${fmtDate(d)} ${fmtTime(d)}` : fmtDate(d);
      s += `<line x1="${tx}" y1="${spineY - 6}" x2="${tx}" y2="${spineY + 6}" stroke="#c7ced7"/>`;
      s += `<text x="${tx}" y="${spineY + 20}" font-size="11" text-anchor="middle" fill="#67727f">${esc(lbl)}</text>`;
    }
    placed.forEach(p => {
      const side = p.lane % 2 === 0 ? 'top' : 'bottom', row = Math.floor(p.lane / 2);
      const col = this._color(p.it.kind === 'node' ? typeColor(p.it.nodeType) : 'var(--accent)');
      const d = new Date(p.t), cardH = laneH - 18;
      const cardY = side === 'top' ? spineY - baseGap - (row + 1) * laneH + 8 : spineY + baseGap + row * laneH - 8;
      const y1 = Math.min(spineY, side === 'top' ? cardY + cardH : cardY);
      const y2 = Math.max(spineY, side === 'top' ? cardY + cardH : cardY);
      const cx = p.x - cardW / 2;
      s += `<line x1="${p.x}" y1="${y1}" x2="${p.x}" y2="${y2}" stroke="#d7deea"/>`;
      s += `<circle cx="${p.x}" cy="${spineY}" r="5" fill="#fff" stroke="${col}" stroke-width="2"/>`;
      s += `<rect x="${cx}" y="${cardY}" width="${cardW}" height="${cardH}" rx="6" fill="#f6f8fa" stroke="#e4e8ee"/>`;
      s += `<rect x="${cx}" y="${cardY}" width="3" height="${cardH}" fill="${col}"/>`;
      s += `<text x="${cx + 9}" y="${cardY + 16}" font-size="9" fill="#8a6d00">${esc(fmtTime(d) + ' · ' + fmtDate(d))}</text>`;
      s += `<text x="${cx + 9}" y="${cardY + 31}" font-size="11" font-weight="700" fill="#1a1f26">${esc(this._clip(p.it.title || '(untitled)', 20))}</text>`;
    });
    return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">${s}</svg>`, W, H };
  },

  _svgToPng(svg, W, H) {
    return new Promise(resolve => {
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const sc = 2, c = document.createElement('canvas');
        c.width = W * sc; c.height = H * sc;
        const ctx = c.getContext('2d'); ctx.scale(sc, sc); ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        try { resolve(c.toDataURL('image/png')); } catch (_) { resolve(null); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  },

  async _timelinePng() {
    const g = this._timelineSvg();
    return g ? this._svgToPng(g.svg, g.W, g.H) : null;
  },

  /* PNG of the investigation relationship map, for the report */
  async _mapPng() {
    const svg = this._buildSVG(State.invMap());
    if (!svg) return null;
    const mw = /width="(\d+)"/.exec(svg), mh = /height="(\d+)"/.exec(svg);
    return this._svgToPng(svg, mw ? +mw[1] : 900, mh ? +mh[1] : 600);
  },

  async word() {
    toast('Preparing Word document…');
    const [assets, tlPng, mapPng] = await Promise.all([this._evidenceAssets(), this._timelinePng(), this._mapPng()]);
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head><meta charset="utf-8"><style>${this._reportStyles()}</style></head>
      <body>${this._reportBody(assets, tlPng, mapPng)}</body></html>`;
    const blob = new Blob(['﻿' + html], { type: 'application/msword' });
    this._download(blob, `dossier_${this._safeName()}.doc`);
    toast('Exported Word document (.doc)');
  },

  // ----------------------------------------------------------- 3) image (PNG)
  _nodeSize(n) {
    const el = document.querySelector(`#node-layer [data-id="${n.id}"]`);
    if (el && el.offsetWidth) return { w: el.offsetWidth, h: el.offsetHeight };
    const rows = (n.rows || []).length;
    return { w: 200, h: 24 + rows * 24 + 10 };
  },

  _buildSVG(mp) {
    mp = mp || State.map();
    const nodes = mp.nodes, edges = mp.edges;
    if (!nodes.length) return null;
    const sizes = {};
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(n => {
      const s = this._nodeSize(n); sizes[n.id] = s;
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y - 12);
      maxX = Math.max(maxX, n.x + s.w); maxY = Math.max(maxY, n.y + s.h);
    });
    const pad = 44;
    const W = Math.ceil(maxX - minX + pad * 2), H = Math.ceil(maxY - minY + pad * 2);
    const ox = pad - minX, oy = pad - minY;   // offset to shift content into view
    const center = n => ({ x: n.x + ox + sizes[n.id].w / 2, y: n.y + oy + sizes[n.id].h / 2 });

    let parts = [`<rect x="0" y="0" width="${W}" height="${H}" fill="#0e1116"/>`];

    // edges first (under nodes)
    edges.forEach(e => {
      const a = State.node(e.from), b = State.node(e.to);
      if (!a || !b) return;
      const pa = center(a), pb = center(b);
      const dx = Math.abs(pb.x - pa.x) * 0.5;
      const col = this._color(typeColor(b.type));
      parts.push(`<path d="M ${pa.x} ${pa.y} C ${pa.x + dx} ${pa.y}, ${pb.x - dx} ${pb.y}, ${pb.x} ${pb.y}"
        fill="none" stroke="${col}" stroke-width="2"/>`);
      if (e.label) {
        const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
        parts.push(`<text x="${mx}" y="${my}" fill="${col}" font-size="12"
          text-anchor="middle" paint-order="stroke" stroke="#0e1116" stroke-width="4">${esc(e.label)}</text>`);
      }
    });

    // nodes
    nodes.forEach(n => {
      const s = sizes[n.id], x = n.x + ox, y = n.y + oy;
      const col = this._color(typeColor(n.type));
      const bg = n.type === 'target' ? '#2a1416' : '#1b222c';
      parts.push(`<rect x="${x}" y="${y}" width="${s.w}" height="${s.h}" rx="10"
        fill="${bg}" stroke="${col}" stroke-width="1.5"/>`);
      // tab
      const title = n.title || typeLabel(n.type);
      const tabW = Math.min(s.w - 14, title.length * 7 + 14);
      parts.push(`<rect x="${x + 10}" y="${y - 10}" width="${tabW}" height="18" rx="6" fill="${col}"/>`);
      parts.push(`<text x="${x + 10 + tabW / 2}" y="${y + 3}" fill="#10141a" font-size="11"
        font-weight="700" text-anchor="middle">${esc(title)}</text>`);
      // node flags, top-right
      const nf = (n.flags || []).map(f => FLAG_MAP[f]).filter(Boolean);
      nf.forEach((f, i) => parts.push(
        `<text x="${x + s.w - 8 - i * 13}" y="${y + 3}" fill="${f.color}" font-size="13"
          text-anchor="end">${f.icon}</text>`));
      // rows (with leading flag markers)
      (n.rows || []).forEach((r, i) => {
        const ry = y + 26 + i * 24;
        parts.push(`<rect x="${x + 10}" y="${ry - 12}" width="${s.w - 20}" height="18" rx="5"
          fill="#0e1116" stroke="${col}" stroke-opacity="0.35"/>`);
        const rf = (r.flags || []).map(f => FLAG_MAP[f]).filter(Boolean);
        const marks = rf.map(f => `<tspan fill="${f.color}">${f.icon} </tspan>`).join('');
        parts.push(`<text x="${x + 17}" y="${ry + 1}" font-size="11">${marks}<tspan fill="#dfe6ee">${esc(this._clip(r.text, rf.length ? 22 : 26))}</tspan></text>`);
      });
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"
      viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif">${parts.join('')}</svg>`;
  },

  _clip(s, n) { s = s || ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; },

  image() {
    const svg = this._buildSVG();
    if (!svg) { toast('Nothing to export — add some nodes first', true); return; }
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = img.width * scale; canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => {
        if (b) { this._download(b, `dossier_${this._safeName()}.png`); toast('Exported map image (PNG)'); }
        else { this._download(svgBlob, `dossier_${this._safeName()}.svg`); toast('Exported map (SVG)'); }
      }, 'image/png');
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      this._download(svgBlob, `dossier_${this._safeName()}.svg`);
      toast('Exported map (SVG)');
    };
    img.src = url;
  },
};
