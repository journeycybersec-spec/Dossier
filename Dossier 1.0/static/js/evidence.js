/* Evidence tab: upload (copied into the case + SHA-256), preview, download,
   delete. Shows which nodes reference each item. */
const Evidence = {
  init() {
    const input = document.getElementById('evidence-file');
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      await this.upload(file);
      input.value = '';
    };
    // lightbox controls
    const lb = document.getElementById('lightbox');
    lb.querySelector('.lb-close').onclick = () => this.closePreview();
    lb.addEventListener('mousedown', e => { if (e.target === lb || e.target.closest('.lb-stage')) this.closePreview(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && !lb.classList.contains('hidden')) this.closePreview();
    });
  },

  /* open an evidence item: images preview in the lightbox, everything else
     opens in a new tab */
  open(evid) {
    const rec = State.evidence(evid);
    if (!rec) { toast('Attachment not found', true); return; }
    const url = API.evidenceUrl(State.caseId, evid);
    if (this._isImage(rec.filename)) {
      const lb = document.getElementById('lightbox');
      lb.querySelector('.lb-img').src = url;
      lb.querySelector('.lb-name').textContent = rec.filename;
      lb.querySelector('.lb-dl').href = API.evidenceUrl(State.caseId, evid, true);
      lb.classList.remove('hidden');
    } else {
      window.open(url, '_blank', 'noopener');
    }
  },
  closePreview() {
    const lb = document.getElementById('lightbox');
    lb.classList.add('hidden');
    lb.querySelector('.lb-img').src = '';
  },

  activate() { this.render(); },

  async upload(file) {
    toast(`Uploading ${file.name}…`);
    try {
      const resp = await API.uploadEvidence(State.caseId, file);
      const rec = resp.record || resp;          // {record, rev}
      State.data.evidence.push(rec);
      if (resp.rev != null) State.rev = resp.rev;   // stay in sync (avoid self-conflict)
      if (App.activeView === 'evidence') this.render();
      toast(`Added ${rec.filename}`);
    } catch (e) {
      toast('Upload failed: ' + e.message, true);
    }
  },

  _usedBy(evid) {
    return State.allNodes().filter(n => (n.evidence || []).includes(evid));
  },

  _isImage(name) { return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name || ''); },

  render() {
    const grid = document.getElementById('evidence-grid');
    const list = State.data.evidence;
    if (!list.length) {
      grid.innerHTML = `<div class="evidence-empty">No evidence yet.<br>
        Upload screenshots, logs, PCAPs, reports — they're copied into the case and hashed.</div>`;
      return;
    }
    grid.innerHTML = list.map(ev => {
      const url = API.evidenceUrl(State.caseId, ev.id);
      const ext = (ev.filename.split('.').pop() || '?').toUpperCase().slice(0, 5);
      const thumb = this._isImage(ev.filename)
        ? `<img src="${url}" alt="" loading="lazy" />`
        : `<span class="ev-ext">${esc(ext)}</span>`;
      const used = this._usedBy(ev.id);
      const links = used.length
        ? `🔗 linked to ${used.length} node${used.length === 1 ? '' : 's'}`
        : 'not linked to any node';
      const d = parseTs(ev.uploaded);
      return `
        <div class="ev-card">
          <button class="ev-thumb" data-open="${ev.id}" title="open">${thumb}</button>
          <div class="ev-info">
            <div class="ev-name">${esc(ev.filename)}</div>
            <div class="ev-meta">${fmtBytes(ev.size)}${d ? ' · ' + fmtDate(d) : ''}</div>
            <div class="ev-hash" title="SHA-256">sha256:${esc((ev.sha256 || '').slice(0, 32))}…</div>
            <div class="ev-links">${links}</div>
          </div>
          <div class="ev-actions">
            <a class="btn btn-small" href="${API.evidenceUrl(State.caseId, ev.id, true)}">Download</a>
            <button class="btn btn-small btn-danger" data-del="${ev.id}">Delete</button>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('[data-open]').forEach(b => {
      b.onclick = () => this.open(b.dataset.open);
    });
    grid.querySelectorAll('[data-del]').forEach(b => {
      b.onclick = () => this._delete(b.dataset.del);
    });
  },

  async _delete(evid) {
    const used = this._usedBy(evid);
    const warn = used.length
      ? `This file is linked to ${used.length} node(s). Delete it and detach those links?`
      : 'Delete this evidence file?';
    if (!confirm(warn)) return;
    try {
      const resp = await API.deleteEvidence(State.caseId, evid);
      if (resp && resp.rev != null) State.rev = resp.rev;
      State.data.evidence = State.data.evidence.filter(e => e.id !== evid);
      State.allNodes().forEach(n => {
        if (n.evidence) n.evidence = n.evidence.filter(x => x !== evid);
      });
      this.render();
      MindMap.render();
      toast('Evidence deleted');
    } catch (e) {
      toast('Delete failed: ' + e.message, true);
    }
  },
};
