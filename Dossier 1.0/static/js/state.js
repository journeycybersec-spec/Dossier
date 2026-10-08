/* Shared, in-memory case state + debounced autosave + small helpers. */

/* Node categories. Each node's `type` picks its tab colour + default label.
   Groups: OSINT target-profile, infosec Incident, and user-defined Custom.
   `group` drives the optgroups in the inspector dropdown.

   NODE_TYPES / TYPE_MAP are mutated in place by refreshCategories() so every
   module that reads them at call-time sees built-ins + custom categories. */
const BUILTIN_TYPES = [
  // ── OSINT / target profile ──
  { key: 'target',   label: 'Target',       color: '#e05c5c', group: 'OSINT' },
  { key: 'bio',      label: 'Bio',          color: '#35c6d6', group: 'OSINT' },
  { key: 'emails',   label: 'Emails',       color: '#ff8a3d', group: 'OSINT' },
  { key: 'usernames',label: 'Usernames',    color: '#b57bff', group: 'OSINT' },
  { key: 'phone',    label: 'Phone',        color: '#3ddc97', group: 'OSINT' },
  { key: 'social',   label: 'Social Media', color: '#ffd24d', group: 'OSINT' },
  { key: 'education', label: 'Education',    color: '#5fd38a', group: 'OSINT' },
  { key: 'cars',     label: 'Cars',         color: '#9aa7b6', group: 'OSINT' },
  { key: 'images',   label: 'Images',       color: '#ffae5c', group: 'OSINT' },
  { key: 'address',  label: 'Address',      color: '#4da3ff', group: 'OSINT' },
  { key: 'cases',    label: 'Cases',        color: '#ff5c6c', group: 'OSINT' },
  { key: 'domains',  label: 'Domains',      color: '#9d7bff', group: 'OSINT' },
  { key: 'related',  label: 'Related',      color: '#ff5cc0', group: 'OSINT' },
  { key: 'gov',      label: 'Gov',          color: '#8a7bff', group: 'OSINT' },
  { key: 'breaches', label: 'Breaches',     color: '#ff5c6c', group: 'OSINT' },
  { key: 'business', label: 'Business',     color: '#35c08f', group: 'OSINT' },
  // ── infosec incident ──
  { key: 'finding', label: 'Finding', color: 'var(--t-finding)', group: 'Incident' },
  { key: 'host',    label: 'Host',    color: 'var(--t-host)',    group: 'Incident' },
  { key: 'account', label: 'Account', color: 'var(--t-account)', group: 'Incident' },
  { key: 'malware', label: 'Malware', color: 'var(--t-malware)', group: 'Incident' },
  { key: 'ioc',     label: 'IOC',     color: 'var(--t-ioc)',     group: 'Incident' },
  { key: 'network', label: 'Network', color: 'var(--t-network)', group: 'Incident' },
  { key: 'action',  label: 'Action',  color: 'var(--t-action)',  group: 'Incident' },
  { key: 'note',    label: 'Note',    color: 'var(--t-note)',    group: 'Incident' },
];

const NODE_TYPES = [];        // mutated in place — built-ins + custom
const TYPE_MAP = {};          // key → category, kept in sync
const BUILTIN_TYPE_KEYS = new Set(BUILTIN_TYPES.map(t => t.key));
function typeColor(key) { return (TYPE_MAP[key] || TYPE_MAP.note).color; }
function typeLabel(key) { return (TYPE_MAP[key] || TYPE_MAP.note).label; }

/* custom defs embedded in the currently-open case (set by State.load) so a
   shared case renders its own categories/flags even without the local library */
let _caseCustomCats = [];
let _caseCustomFlags = [];

/* Triage markers that can be toggled on a field (row) or a whole node.
   `exclusive` groups flags that can't co-exist (e.g. verified vs not-verified).
   FLAGS / FLAG_MAP are mutated in place by refreshFlags() = built-ins + custom. */
const BUILTIN_FLAGS = [
  { key: 'important',  label: 'Important',    icon: '★', color: '#ff5c6c' },
  { key: 'followup',   label: 'Follow-up',    icon: '⚑', color: '#ffd24d' },
  { key: 'verified',   label: 'Verified',     icon: '✓', color: '#3ddc97', exclusive: 'verification' },
  { key: 'unverified', label: 'Not verified', icon: '?', color: '#ffae5c', exclusive: 'verification' },
];
const FLAGS = [];
const FLAG_MAP = {};
const BUILTIN_FLAG_KEYS = new Set(BUILTIN_FLAGS.map(f => f.key));

const CUSTOM_FLAG_KEY = 'timemap.customFlags';
function loadCustomFlags() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_FLAG_KEY) || '[]'); }
  catch (_) { return []; }
}
function saveCustomFlags(arr) {
  try { localStorage.setItem(CUSTOM_FLAG_KEY, JSON.stringify(arr)); } catch (_) {}
}
function refreshFlags() {
  const seen = new Set(), custom = [];
  const add = f => {
    if (!f || !f.key || seen.has(f.key)) return;
    seen.add(f.key);
    custom.push({ key: f.key, label: f.label, icon: f.icon || '●', color: f.color || '#8b97a6', custom: true });
  };
  loadCustomFlags().forEach(add);
  _caseCustomFlags.forEach(add);
  FLAGS.length = 0;
  FLAGS.push(...BUILTIN_FLAGS, ...custom);
  for (const k of Object.keys(FLAG_MAP)) delete FLAG_MAP[k];
  FLAGS.forEach(f => { FLAG_MAP[f.key] = f; });
}
function addCustomFlag(label, icon, color) {
  label = (label || '').trim().slice(0, 30);
  if (!label) return null;
  const base = 'f_' + (label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'flag');
  let key = base, i = 2;
  while (FLAG_MAP[key]) key = `${base}_${i++}`;
  const custom = loadCustomFlags();
  custom.push({ key, label, icon: (icon || '●').slice(0, 2), color: color || '#8b97a6' });
  saveCustomFlags(custom);
  refreshFlags();
  return key;
}
function removeCustomFlag(key) {
  saveCustomFlags(loadCustomFlags().filter(f => f.key !== key));
  refreshFlags();
}
refreshFlags();

const CUSTOM_CAT_KEY = 'timemap.customCategories';
function loadCustomCategories() {
  try { return JSON.parse(localStorage.getItem(CUSTOM_CAT_KEY) || '[]'); }
  catch (_) { return []; }
}
function saveCustomCategories(arr) {
  try { localStorage.setItem(CUSTOM_CAT_KEY, JSON.stringify(arr)); } catch (_) {}
}
/* rebuild NODE_TYPES / TYPE_MAP from built-ins + personal (localStorage) +
   the open case's embedded custom categories (keep-first on key collisions) */
function refreshCategories() {
  const seen = new Set(), custom = [];
  const add = c => {
    if (!c || !c.key || seen.has(c.key)) return;
    seen.add(c.key);
    custom.push({ key: c.key, label: c.label, color: c.color, group: 'Custom', custom: true });
  };
  loadCustomCategories().forEach(add);
  _caseCustomCats.forEach(add);
  NODE_TYPES.length = 0;
  NODE_TYPES.push(...BUILTIN_TYPES, ...custom);
  for (const k of Object.keys(TYPE_MAP)) delete TYPE_MAP[k];
  NODE_TYPES.forEach(t => { TYPE_MAP[t.key] = t; });
}
function addCustomCategory(label, color) {
  label = (label || '').trim().slice(0, 40);
  if (!label) return null;
  const base = 'c_' + (label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'cat');
  let key = base, i = 2;
  while (TYPE_MAP[key]) key = `${base}_${i++}`;
  const custom = loadCustomCategories();
  custom.push({ key, label, color: color || '#8b97a6' });
  saveCustomCategories(custom);
  refreshCategories();
  return key;
}
function removeCustomCategory(key) {
  saveCustomCategories(loadCustomCategories().filter(c => c.key !== key));
  refreshCategories();
}
refreshCategories();          // initial build

const State = {
  caseId: null,
  data: null,          // the full case object
  active: 'investigation',   // which map is being edited
  _saveTimer: null,
  _listeners: {},      // event -> [fn]

  load(caseId, data) {
    this.caseId = caseId;
    this.data = data;
    data.events   ||= [];
    data.evidence ||= [];
    data.customCategories ||= [];
    data.customFlags      ||= [];
    data.meta     ||= {};   // { caseNumber, analyst, classification, summary }

    // ---- multiple maps per case ----
    // legacy cases stored nodes/edges/view at the top level → investigation map
    if (!data.maps) {
      data.maps = { investigation: {
        nodes: data.nodes || [], edges: data.edges || [],
        view: data.view || { x: 0, y: 0, scale: 1 } } };
    }
    delete data.nodes; delete data.edges; delete data.view;
    data.maps.investigation ||= { nodes: [], edges: [], view: { x: 0, y: 0, scale: 1 } };
    // seed the sock-puppet workflow map once (custom default if saved, else built-in)
    data.maps.sockpuppet ||= cloneMap(getDefaultMap('sockpuppet')) || SOCKPUPPET_TEMPLATE.build();

    Object.values(data.maps).forEach(mp => {
      mp.nodes ||= []; mp.edges ||= []; mp.view ||= { x: 0, y: 0, scale: 1 };
      mp.nodes.forEach(n => {
        n.rows ||= []; n.flags ||= [];
        n.rows.forEach(r => { r.flags ||= []; });
      });
    });
    this.active = data.activeMap === 'sockpuppet' ? 'sockpuppet' : 'investigation';
    data.activeMap = this.active;

    _caseCustomCats = data.customCategories;
    _caseCustomFlags = data.customFlags;
    refreshCategories();
    refreshFlags();

    this.rev = data.rev || 0;     // optimistic-concurrency version
    this._conflict = false;

    // undo/redo history
    this._undo = []; this._redo = []; this._restoring = false;
    this._baseline = this._undoable();
  },

  // ---- undo / redo -------------------------------------------------------
  /* serialise the undoable part of the case (not view/pan, not evidence index) */
  _undoable() {
    const maps = {};
    for (const k in this.data.maps) maps[k] = { nodes: this.data.maps[k].nodes, edges: this.data.maps[k].edges };
    return JSON.stringify({ name: this.data.name, meta: this.data.meta, maps, events: this.data.events });
  },
  _applyUndoable(o) {
    this.data.name = o.name;
    this.data.meta = o.meta || {};
    this.data.events = o.events || [];
    for (const k in o.maps) {
      if (this.data.maps[k]) { this.data.maps[k].nodes = o.maps[k].nodes; this.data.maps[k].edges = o.maps[k].edges; }
      else this.data.maps[k] = { nodes: o.maps[k].nodes, edges: o.maps[k].edges, view: { x: 0, y: 0, scale: 1 } };
    }
  },
  _commit() {
    const cur = this._undoable();
    if (cur === this._baseline) return;
    if (this._baseline != null) { this._undo.push(this._baseline); if (this._undo.length > 80) this._undo.shift(); }
    this._baseline = cur;
    this._redo = [];
    this.emit('history');
  },
  canUndo() { return this._undo.length > 0; },
  canRedo() { return this._redo.length > 0; },
  undo() {
    if (!this._undo.length) return false;
    this._redo.push(this._baseline);
    this._baseline = this._undo.pop();
    this._restore(this._baseline);
    return true;
  },
  redo() {
    if (!this._redo.length) return false;
    this._undo.push(this._baseline);
    this._baseline = this._redo.pop();
    this._restore(this._baseline);
    return true;
  },
  _restore(json) {
    this._restoring = true;
    this._applyUndoable(JSON.parse(json));
    this.emit('reload');
    this.emit('history');
    this.save().finally(() => { this._restoring = false; });
  },

  // ---- map access --------------------------------------------------------
  map()      { return this.data.maps[this.active]; },           // active map
  invMap()   { return this.data.maps.investigation; },          // timeline/index source
  allNodes() { return Object.values(this.data.maps).flatMap(m => m.nodes || []); },
  mapOf(nodeId) {
    for (const [k, m] of Object.entries(this.data.maps))
      if (m.nodes.some(n => n.id === nodeId)) return k;
    return null;
  },
  setActiveMap(key) {
    if (!this.data.maps[key]) return;
    this.active = key;
    this.data.activeMap = key;
    this.touchSave();
  },
  resetSockpuppet() {
    this.data.maps.sockpuppet = cloneMap(getDefaultMap('sockpuppet')) || SOCKPUPPET_TEMPLATE.build();
    this.touchSave();
  },

  on(evt, fn) { (this._listeners[evt] ||= []).push(fn); },
  emit(evt, payload) { (this._listeners[evt] || []).forEach(fn => fn(payload)); },

  /* Mark dirty → schedule a save. `changed` is a list of change kinds to re-render. */
  touch(...changed) {
    changed.forEach(c => this.emit(c));
    this.touchSave();
  },

  /* Mark dirty + schedule a save, WITHOUT emitting re-render events. Used for
     inline edits (row text, node notes) where a re-render would steal focus. */
  touchSave() {
    if (this._conflict) return;        // paused until the conflict is resolved
    setSaveState('dirty');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.save(), 650);
  },

  /* embed the custom category/flag definitions this case actually uses, so the
     exported case is self-describing on any machine */
  syncEmbeddedDefs() {
    const catKeys = new Set();
    const flagKeys = new Set();
    this.allNodes().forEach(n => {
      if (n.type && !BUILTIN_TYPE_KEYS.has(n.type)) catKeys.add(n.type);
      (n.flags || []).forEach(f => { if (!BUILTIN_FLAG_KEYS.has(f)) flagKeys.add(f); });
      (n.rows || []).forEach(r =>
        (r.flags || []).forEach(f => { if (!BUILTIN_FLAG_KEYS.has(f)) flagKeys.add(f); }));
    });
    this.data.customCategories = [...catKeys].map(k => TYPE_MAP[k]).filter(Boolean)
      .map(t => ({ key: t.key, label: t.label, color: t.color }));
    this.data.customFlags = [...flagKeys].map(k => FLAG_MAP[k]).filter(Boolean)
      .map(f => ({ key: f.key, label: f.label, icon: f.icon, color: f.color }));
    _caseCustomCats = this.data.customCategories;
    _caseCustomFlags = this.data.customFlags;
  },

  async save(force) {
    if (!this.caseId || !this.data) return;
    if (this._conflict && !force) return;
    if (!this._restoring) this._commit();     // checkpoint for undo
    this.syncEmbeddedDefs();
    setSaveState('saving');
    try {
      const saved = await API.saveCase(this.caseId, this.data, this.rev, force);
      this.rev = saved.rev;
      this.data.evidence = saved.evidence;   // server-authoritative
      this.data.modified = saved.modified;
      this._conflict = false;
      setSaveState('saved');
    } catch (e) {
      setSaveState('dirty');
      if (e.conflict) {
        this._conflict = true;
        this.emit('conflict');               // App shows the resolve dialog
      } else {
        toast('Save failed: ' + e.message, true);
      }
    }
  },

  // ---- node / edge / event / evidence accessors -------------------------
  // node/edge lookups search every map (ids are globally unique)
  node(id)  { for (const m of Object.values(this.data.maps)) { const n = m.nodes.find(x => x.id === id); if (n) return n; } },
  edge(id)  { for (const m of Object.values(this.data.maps)) { const e = m.edges.find(x => x.id === id); if (e) return e; } },
  event(id) { return this.data.events.find(e => e.id === id); },
  evidence(id) { return this.data.evidence.find(e => e.id === id); },

  addNode(partial) {
    const n = Object.assign(
      { id: uid('n'), x: 0, y: 0, title: 'New node', notes: '',
        type: 'note', timestamp: '', evidence: [], rows: [], flags: [] },
      partial);
    this.map().nodes.push(n);
    this.touch('nodes');
    return n;
  },

  addRow(nodeId, text = '') {
    const n = this.node(nodeId);
    if (!n) return null;
    const row = { id: uid('r'), text, url: '', flags: [] };
    (n.rows ||= []).push(row);
    this.touch('nodes');
    return row;
  },
  removeRow(nodeId, rowId) {
    const n = this.node(nodeId);
    if (!n || !n.rows) return;
    n.rows = n.rows.filter(r => r.id !== rowId);
    this.touch('nodes');
  },

  /* apply a flag toggle to a flags array, honouring exclusive groups */
  _applyFlag(flags, flag) {
    flags = flags || [];
    if (flags.includes(flag)) return { flags: flags.filter(f => f !== flag), on: false };
    const grp = FLAG_MAP[flag]?.exclusive;
    let next = grp ? flags.filter(f => FLAG_MAP[f]?.exclusive !== grp) : flags.slice();
    next.push(flag);
    return { flags: next, on: true };
  },

  /* toggle a triage marker on a field; returns whether it is now active */
  toggleRowFlag(nodeId, rowId, flag) {
    const n = this.node(nodeId);
    const r = n && (n.rows || []).find(x => x.id === rowId);
    if (!r) return false;
    const res = this._applyFlag(r.flags, flag);
    r.flags = res.flags;
    this.touchSave();                 // no re-render; caller updates the DOM
    return res.on;
  },
  toggleNodeFlag(nodeId, flag) {
    const n = this.node(nodeId);
    if (!n) return false;
    const res = this._applyFlag(n.flags, flag);
    n.flags = res.flags;
    this.touch('nodes');
    return res.on;
  },
  removeNode(id) {
    const mp = this.map();
    mp.nodes = mp.nodes.filter(n => n.id !== id);
    mp.edges = mp.edges.filter(e => e.from !== id && e.to !== id);
    // orphan any timeline events that pointed at it
    this.data.events.forEach(ev => { if (ev.nodeId === id) ev.nodeId = null; });
    this.touch('nodes', 'events');
  },
  addEdge(from, to, opts = {}) {
    const fromRow = opts.fromRow || null, toRow = opts.toRow || null;
    if (from === to && !fromRow && !toRow) return null;
    const mp = this.map();
    // same pair + same row anchors already linked → skip; other row combos allowed
    if (mp.edges.some(e =>
        e.from === from && e.to === to &&
        (e.fromRow || null) === fromRow && (e.toRow || null) === toRow)) return null;
    const e = { id: uid('e'), from, to, fromRow, toRow, label: '' };
    mp.edges.push(e);
    this.touch('nodes');
    return e;
  },
  removeEdge(id) {
    const mp = this.map();
    mp.edges = mp.edges.filter(e => e.id !== id);
    this.touch('nodes');
  },

  addEvent(partial) {
    const e = Object.assign(
      { id: uid('t'), timestamp: '', title: 'New event', notes: '', nodeId: null },
      partial);
    this.data.events.push(e);
    this.touch('events');
    return e;
  },
  removeEvent(id) {
    this.data.events = this.data.events.filter(e => e.id !== id);
    this.touch('events');
  },
};

/* local temp ids for nodes/edges/events (server ids used only for evidence) */
let _uidc = 0;
function uid(prefix) {
  _uidc += 1;
  return `${prefix}${Date.now().toString(36)}${_uidc.toString(36)}`;
}

function setSaveState(s) {
  const el = document.getElementById('save-state');
  if (!el) return;
  el.className = 'save-state ' + (s === 'saved' ? '' : s);
  el.textContent = s === 'saving' ? 'saving…' : s === 'dirty' ? 'unsaved' : 'saved';
}

let _toastTimer;
function toast(msg, isErr) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3200);
}

/* ---- small shared formatting helpers ---- */
function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}
function esc(s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
/* split "2026-10-07T14:03" into {date:"2026-10-07", time:"14:03"} for separate
   date/time inputs; either part may be empty */
function splitTs(ts) {
  if (!ts) return { date: '', time: '' };
  const [date, time] = String(ts).split('T');
  return { date: date || '', time: (time || '').slice(0, 5) };
}
/* combine a date + optional time back into a stored timestamp */
function joinTs(date, time) {
  if (!date) return '';
  return `${date}T${time || '00:00'}`;
}

/* "2026-10-07T14:03" (datetime-local) → nice parts */
function parseTs(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return d;
}
function fmtDate(d) {
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}
function fmtTime(d) {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/* If a row's text is an email / domain / url, return something openable. */
function rowLink(text) {
  const t = (text || '').trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'mailto:' + t;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(t) && /\.[a-z]{2,}$/i.test(t)) return 'https://' + t;
  return null;
}

/* ───────────────────────────── templates ───────────────────────────── */
/* Starting layouts for a new investigation. Each returns {nodes, edges}. */

function _rows(...texts) {
  return texts.map(t => ({ id: uid('r'), text: t, url: '' }));
}

const TEMPLATES = {
  blank: { key: 'blank', label: 'Blank canvas', build: () => ({ nodes: [], edges: [] }) },

  target: {
    key: 'target',
    label: 'Target profile (OSINT)',
    build() {
      // [type, title, edge-label, x, y, rows]
      const spec = [
        ['target',    'Target',       '',             640, 440, _rows('')],
        ['bio',       'Bio',          '',             560, 120, _rows('Full Name', 'DOB', 'SSN')],
        ['emails',    'Emails',       'email',        360, 180, _rows('', '', '')],
        ['usernames', 'Usernames',    '',             120, 250, _rows('', '', '')],
        ['phone',     'Phone',        '',             820, 160, _rows('', '', '')],
        ['social',    'Social Media', 'Social Media', 1060, 140, _rows('Twitter', 'Facebook', 'LinkedIn', 'Yelp Business', 'Amazon', 'Google', 'Instagram', 'Outlook')],
        ['education', 'Education',    '',             360, 400, _rows('University', 'High School')],
        ['cars',      'Cars',         'cars',         120, 470, _rows('', '')],
        ['images',    'Images',       '',             960, 440, _rows('Google', 'News')],
        ['address',   'Address',      'Address',      430, 560, _rows('', '')],
        ['cases',     'Cases',        '',             180, 700, _rows('Cases', 'Traffic', 'Voting', 'Gov record')],
        ['domains',   'Domains',      'Domain',       900, 650, _rows('', '')],
        ['related',   'Related',      'Related',      1120, 560, _rows('', '')],
        ['gov',       'Gov',          'gov',          260, 880, _rows('Cases', 'Traffic', 'Voting', 'Gov record')],
        ['breaches',  'Breaches',     '',             580, 880, _rows('Passwords', 'Addresses', 'IPs', 'Usernames')],
        ['business',  'Business',     'Work',         900, 840, _rows('', '')],
      ];
      const nodes = spec.map(([type, title, , x, y, rows]) =>
        ({ id: uid('n'), type, title, x, y, rows, notes: '', timestamp: '', evidence: [] }));
      const center = nodes[0];
      const edges = nodes.slice(1).map((n, i) =>
        ({ id: uid('e'), from: center.id, to: n.id, label: spec[i + 1][2] }));
      return { nodes, edges };
    },
  },

  company: {
    key: 'company',
    label: 'Company due diligence (M&A)',
    build() {
      // [type, title, edge-label, x, y, rows]
      const spec = [
        ['business', 'Company',             '',            620, 470, _rows('Legal name', 'Public / Private', 'Acquisition target')],
        // ── left column ──
        ['bio',      'Company Info',         'info',          30,  20, _rows('Legal name', 'Trading name', 'Registration #', 'Incorporation date', 'Entity type', 'HQ address', 'Website', 'Industry / SIC')],
        ['cases',    'Status & Standing',    'status',        30, 360, _rows('Good standing?', 'Registered agent', 'Last filing date', 'Annual report current?', 'Dissolution / bankruptcy')],
        ['account',  'Leadership (C-level)', 'leadership',    30, 620, _rows('CEO', 'CFO', 'COO', 'CTO', 'Founders', 'Board members')],
        ['related',  'Ownership',            'ownership',     30, 900, _rows('Parent company', 'Subsidiaries', 'Major shareholders', 'Beneficial owners', 'Cap table')],
        // ── top centre ──
        ['ioc',      'Financials',           'financials',   430,  20, _rows('Annual revenue', 'EBITDA / margin', 'Total debt', 'Valuation', 'Funding rounds', 'Auditor')],
        ['network',  'Digital Footprint',    'digital',      820,  20, _rows('Primary domain', 'Other domains', 'Tech stack', 'Social media', 'Known breaches')],
        // ── right column ──
        ['breaches', 'Legal & Litigation',   'legal',       1180,  20, _rows('Active lawsuits', 'Judgments / liens', 'Regulatory actions', 'IP disputes', 'Bankruptcies')],
        ['action',   'Compliance',           'compliance',  1180, 300, _rows('Licenses', 'Certifications', 'Sanctions / OFAC', 'Data privacy (GDPR)', 'Insurance')],
        ['social',   'Reputation',           'reputation',  1180, 560, _rows('News / press', 'Glassdoor rating', 'Customer reviews', 'Analyst coverage')],
        ['domains',  'IP & Assets',          'IP',          1180, 800, _rows('Patents', 'Trademarks', 'Real estate', 'Key equipment')],
        // ── bottom centre ──
        ['host',     'Contracts & Market',   'market',       430, 900, _rows('Key customers', 'Key suppliers', 'Major contracts', 'Competitors', 'Market share')],
        ['malware',  'Risk Flags',           'risk',         820, 900, _rows('Red flags', 'Open questions', 'Deal-breakers')],
      ];
      const nodes = spec.map(([type, title, , x, y, rows]) =>
        ({ id: uid('n'), type, title, x, y, rows, notes: '', timestamp: '', evidence: [], flags: [] }));
      const center = nodes[0];
      const edges = nodes.slice(1).map((n, i) =>
        ({ id: uid('e'), from: center.id, to: n.id, label: spec[i + 1][2] }));
      return { nodes, edges, view: { x: 40, y: 20, scale: 0.6 } };
    },
  },

  execprivacy: {
    key: 'execprivacy',
    label: 'Executive privacy management',
    build() {
      // [type, title, edge-label, x, y, rows]
      const spec = [
        ['target',   'Principal',            '',            620, 470, _rows('Name / alias', 'Role / title', 'Risk level', 'Last reviewed')],
        // ── left column ──
        ['bio',      'Profile',              'profile',       30,  20, _rows('Full name', 'Known aliases', 'DOB', 'Public bio links', 'Assistant / POC')],
        ['breaches', 'Data Brokers',         'data brokers',  30, 320, _rows('Spokeo', 'Whitepages', 'BeenVerified', 'Acxiom', 'Intelius', 'Opt-out service')],
        ['account',  'Accounts Hardening',   'accounts',      30, 640, _rows('MFA / passkeys', 'Password manager', 'Breach monitoring', 'Recovery methods', 'Legacy accounts')],
        ['related',  'Family & Household',   'family',        30, 920, _rows('Spouse', 'Children', 'School / daycare', 'Household staff', 'Their exposure')],
        // ── top centre ──
        ['address',  'Home & Address',       'home',         430,  20, _rows('Home address', 'Property record scrubbed?', 'CMRA / PO box', 'Utilities in trust/LLC', 'Voter record')],
        ['ioc',      'Financial Privacy',    'financial',    820,  20, _rows('LLC / trust ownership', 'Credit freeze', 'Privacy cards', 'Bank alerts', 'Tax record exposure')],
        // ── right column ──
        ['network',  'Devices & Comms',      'devices',     1180,  20, _rows('Phone / SIM', 'MDM / EDR', 'VPN', 'Encrypted messaging', 'Email aliases')],
        ['social',   'Social Media',         'social',      1180, 300, _rows('Account lockdown', 'Impersonation monitoring', 'Geotag off', 'Family posting policy', 'Old accounts')],
        ['malware',  'Monitoring & Threats', 'monitoring',  1180, 560, _rows('Dark-web monitoring', 'Name mentions / alerts', 'Doxxing incidents', 'Threat intel')],
        ['domains',  'Travel',               'travel',      1180, 800, _rows('Itinerary privacy', 'Hotel aliases', 'Advance team', 'Loyalty program privacy')],
        // ── bottom centre ──
        ['action',   'Physical Security',    'physical',     430, 900, _rows('Residence security', 'GPS / AirTag sweep', 'Vehicle registration', 'Executive protection')],
        ['cases',    'Legal & Takedowns',    'legal',        820, 900, _rows('Right to be forgotten', 'DMCA / takedowns', 'Cease & desist', 'Counsel contact')],
      ];
      const nodes = spec.map(([type, title, , x, y, rows]) =>
        ({ id: uid('n'), type, title, x, y, rows, notes: '', timestamp: '', evidence: [], flags: [] }));
      const center = nodes[0];
      const edges = nodes.slice(1).map((n, i) =>
        ({ id: uid('e'), from: center.id, to: n.id, label: spec[i + 1][2] }));
      return { nodes, edges, view: { x: 40, y: 20, scale: 0.6 } };
    },
  },

  orm_person: {
    key: 'orm_person',
    label: 'Online reputation — Person',
    build() {
      const spec = [
        ['target',   'Subject',              '',            620, 470, _rows('Name', 'Industry / niche', 'Goal', 'Risk level')],
        // left
        ['bio',      'Profile',              'profile',       30,  20, _rows('Full name', 'Aliases', 'Industry / niche', 'Goal', 'Risk level')],
        ['network',  'Search Results',       'search',        30, 320, _rows('Google page 1', 'Negative results', 'Autocomplete', 'Image results', 'Knowledge panel')],
        ['domains',  'Owned Properties',     'owned',         30, 640, _rows('Personal website', 'Blog', 'LinkedIn', 'Personal domains', 'About.me')],
        ['social',   'Social Profiles',      'social',        30, 920, _rows('Verified accounts', 'Handles', 'Dormant accounts', 'Consistency')],
        // top
        ['account',  'Reviews & Mentions',   'mentions',     430,  20, _rows('Review sites', 'Forums / Reddit', 'Press mentions', 'Q&A sites')],
        ['breaches', 'Negative Content',     'negative',     820,  20, _rows('Defamatory posts', 'Old content', 'Mugshot sites', 'News articles', 'Images')],
        // right
        ['action',   'Suppression / SEO',    'SEO',         1180,  20, _rows('Positive content', 'Target keywords', 'Backlinks', 'Schema / profiles')],
        ['cases',    'Takedowns & Legal',    'legal',       1180, 300, _rows('Right to be forgotten', 'DMCA', 'Defamation claim', 'Counsel')],
        ['host',     'Press & Media',        'press',       1180, 560, _rows('Interviews', 'Bylines', 'PR outreach', 'Podcasts')],
        ['malware',  'Monitoring',           'monitoring',  1180, 800, _rows('Google Alerts', 'Mention tracking', 'Sentiment', 'Review alerts')],
        // bottom
        ['ioc',      'Wikipedia & Knowledge','knowledge',    430, 900, _rows('Wikipedia page', 'Knowledge panel', 'Wikidata', 'Schema markup')],
        ['business', 'Positive Assets',      'assets',       820, 900, _rows('Awards', 'Testimonials', 'Speaking', 'Publications')],
      ];
      const nodes = spec.map(([type, title, , x, y, rows]) =>
        ({ id: uid('n'), type, title, x, y, rows, notes: '', timestamp: '', evidence: [], flags: [] }));
      const center = nodes[0];
      const edges = nodes.slice(1).map((n, i) => ({ id: uid('e'), from: center.id, to: n.id, label: spec[i + 1][2] }));
      return { nodes, edges, view: { x: 40, y: 20, scale: 0.6 } };
    },
  },

  orm_company: {
    key: 'orm_company',
    label: 'Online reputation — Company',
    build() {
      const spec = [
        ['target',   'Brand',                '',            620, 470, _rows('Brand name', 'Industry', 'Goal', 'Risk level')],
        // left
        ['bio',      'Brand Profile',        'profile',       30,  20, _rows('Brand name', 'Industry', 'Key execs', 'Goal', 'Risk level')],
        ['network',  'Search Results',       'search',        30, 320, _rows('Brand SERP', 'Negative results', 'Competitor ranking', 'Autocomplete', 'Images')],
        ['account',  'Review Platforms',     'reviews',       30, 640, _rows('Google Business', 'Yelp', 'Trustpilot', 'G2 / Capterra', 'BBB')],
        ['social',   'Social Channels',      'social',        30, 920, _rows('Official channels', 'Handles', 'Response policy', 'Dormant pages')],
        // top
        ['breaches', 'Negative Content',     'negative',     430,  20, _rows('Complaints', 'Viral posts', 'Scam / fraud claims', 'News articles')],
        ['action',   'Suppression / SEO',    'SEO',          820,  20, _rows('Content marketing', 'Owned pages', 'Backlinks', 'Keywords')],
        // right
        ['cases',    'Takedowns & Legal',    'legal',       1180,  20, _rows('Defamation', 'Trademark', 'DMCA', 'Counsel')],
        ['host',     'Press & Media',        'press',       1180, 300, _rows('News coverage', 'PR / newswire', 'Crisis articles', 'Wikipedia')],
        ['malware',  'Monitoring',           'monitoring',  1180, 560, _rows('Brand alerts', 'Social listening', 'Sentiment', 'Share of voice')],
        ['related',  'Glassdoor / Employer', 'employer',    1180, 800, _rows('Glassdoor rating', 'Indeed', 'Employee reviews', 'HR response')],
        // bottom
        ['ioc',      'Crisis Response',      'crisis',       430, 900, _rows('Playbook', 'Spokesperson', 'Holding statements', 'Escalation')],
        ['domains',  'Owned Assets',         'assets',       820, 900, _rows('Website', 'Blog', 'Help center', 'Case studies')],
      ];
      const nodes = spec.map(([type, title, , x, y, rows]) =>
        ({ id: uid('n'), type, title, x, y, rows, notes: '', timestamp: '', evidence: [], flags: [] }));
      const center = nodes[0];
      const edges = nodes.slice(1).map((n, i) => ({ id: uid('e'), from: center.id, to: n.id, label: spec[i + 1][2] }));
      return { nodes, edges, view: { x: 40, y: 20, scale: 0.6 } };
    },
  },

  osint_report: {
    key: 'osint_report',
    label: 'OSINT investigative reporting',
    build() {
      const spec = [
        ['target',   'Investigation',        '',            620, 470, _rows('Working title', 'Status', 'Lead reporter')],
        // left
        ['bio',      'Story / Thesis',       'thesis',        30,  20, _rows('Working headline', 'Hypothesis', 'Scope / angle', 'Public interest', 'Status')],
        ['account',  'Subjects / Entities',  'subjects',      30, 320, _rows('People', 'Organizations', 'Aliases', 'Relationships')],
        ['related',  'Sources',              'sources',       30, 640, _rows('Human sources', 'Reliability (A-F)', 'Confidential?', 'Whistleblowers')],
        ['cases',    'Documents & Records',  'documents',     30, 920, _rows('Leaks', 'FOIA requests', 'Court records', 'Corporate filings', 'Property records')],
        // top
        ['social',   'Social Media Analysis','social',       430,  20, _rows('Accounts', 'Key posts', 'Network map', 'Archived (Wayback)', 'Deleted content')],
        ['network',  'Digital Footprint',    'digital',      820,  20, _rows('Domains / WHOIS', 'Emails', 'Usernames', 'Metadata / EXIF', 'Breached data')],
        // right
        ['address',  'Geolocation',          'geoloc',      1180,  20, _rows('Locations', 'Chronolocation', 'Satellite imagery', 'Street view', 'Flight / vessel')],
        ['ioc',      'Financial Trail',      'financial',   1180, 300, _rows('Companies', 'Transactions', 'Assets', 'Crypto wallets', 'Offshore')],
        ['action',   'Verification',         'verify',      1180, 560, _rows('Corroboration (2+)', 'Reverse image', 'Fact-check', 'Debunked?', 'Confidence')],
        ['host',     'Timeline of Events',   'events',      1180, 800, _rows('Key dates', 'Sequence', 'Gaps', 'Conflicts')],
        // bottom
        ['malware',  'Leads & Tips',         'leads',        430, 900, _rows('Open leads', 'Dead ends', 'Next steps', 'Requests pending')],
        ['business', 'Publication',          'publish',      820, 900, _rows('Draft', 'Legal review', 'Editor sign-off', 'Right of reply')],
      ];
      const nodes = spec.map(([type, title, , x, y, rows]) =>
        ({ id: uid('n'), type, title, x, y, rows, notes: '', timestamp: '', evidence: [], flags: [] }));
      const center = nodes[0];
      const edges = nodes.slice(1).map((n, i) => ({ id: uid('e'), from: center.id, to: n.id, label: spec[i + 1][2] }));
      return { nodes, edges, view: { x: 40, y: 20, scale: 0.6 } };
    },
  },
};

/* Default layout for the per-case Sock Puppet workflow map (from the user's
   reference). It records how puppet accounts are built; it never feeds the
   timeline or Index. */
const SOCKPUPPET_TEMPLATE = {
  build() {
    const nodes = [], edges = [];
    // approximate rendered height of a node for spacing (tab + rows + add btn)
    const H = rows => (rows && rows.length ? 30 + rows.length * 26 : 48);
    const N = (type, title, x, y, rows) => {
      const n = { id: uid('n'), type, title, x, y, notes: '', timestamp: '',
        evidence: [], flags: [], rows: (rows || []).map(t => ({ id: uid('r'), text: t, url: '', flags: [] })) };
      nodes.push(n); return n;
    };
    const rowId = (node, text) => { const r = node.rows.find(r => r.text === text); return r ? r.id : null; };
    const E = (from, to, label, fromRowText) =>
      edges.push({ id: uid('e'), from: from.id, to: to.id,
        fromRow: fromRowText ? rowId(from, fromRowText) : null, toRow: null, label: label || '' });

    // ── columns (x) ──
    const X_RES = 0, X_PRE = 300, X_MID = 620, X_NOTE = 960;

    // central + main containers
    const sp = N('target', 'Sock Puppet 🧦', X_MID, 120, []);
    const pre = N('breaches', 'Prerequisites', X_PRE, 300,
      ['Email', 'Phone', 'Anonymizer', 'Password Manager', 'Payment', 'Domain']);
    const social = N('network', 'Social Media', X_MID, 440,
      ['Twitter', 'Facebook', 'LinkedIn', 'Discord', 'Yelp Business', 'Amazon', 'Google',
       'Google Voice', 'Instagram', 'OpenAI', 'AirBnB', 'Uber', 'Lyft', 'Outlook']);
    const gr = N('note', 'General Rule', X_NOTE, 140,
      ['Set TOTP', 'Yubikey', 'No notifications', 'Privacy settings',
       'Turn Off History', 'Backup codes', 'Remove recovery phone']);
    E(sp, pre, 'setup');
    E(sp, social, 'creation');
    E(sp, gr, 'General Rule');

    // ── left column: resources, stacked top→down with guaranteed spacing ──
    let ry = 20;
    const res = (type, title, row, container) => {
      const n = N(type, title, X_RES, ry, []); ry += H(null) + 14;
      E(container, n, '', row); return n;
    };
    const gap = () => { ry += 22; };
    ['@duck.com', 'SimpleLogin', 'Proton Pass Aliases', 'Zoho Mail'].forEach(t => res('note', t, 'Email', pre));
    gap();
    ['cloaked.app', 'T-Mobile Mint SIM', 'TextFree', 'TextNow', '2nd Line'].forEach(t => res('ioc', t, 'Phone', pre));
    gap();
    ['CloudFlare WARP', 'protonVPN.com', 'LTE/5G'].forEach(t => res('note', t, 'Anonymizer', pre));
    gap();
    ['BitWarden.com', 'KeyPassXC'].forEach(t => res('action', t, 'Password Manager', pre));
    gap();
    ['Privacy.com', 'Pre-paid VISA cards'].forEach(t => res('note', t, 'Payment', pre));
    gap();
    ['99 cent domains', 'CloudFlare'].forEach(t => res('note', t, 'Domain', pre));

    // ── Content container + its resources (continue the left column lower) ──
    gap(); gap();
    const contentTop = ry;
    const content = N('business', 'Content', X_PRE, contentTop + 40,
      ['Name', 'Display Pic', 'Images', 'Description', 'Company', 'Logo']);
    E(sp, content, 'consistancy');
    ['randomuser.me', 'imagine.meta.com', 'ThisPersonDoesNotExist.com', 'generated.photos'].forEach(t => res('note', t, 'Display Pic', content));
    ['This MP Does Not Exist', 'thisxdoesnotexist.com', 'unsplash.com', 'pexels.com', 'thexifer.net', 'FOODCAS'].forEach(t => res('note', t, 'Images', content));
    res('note', 'AI Logo Maker', 'Logo', content);

    // ── right column: General Rule + social-media side notes, stacked ──
    let ny = 140 + H(gr.rows) + 28;
    const note = (title, rows, row) => {
      const n = N('note', title, X_NOTE, ny, rows); ny += H(rows) + 18;
      E(social, n, '', row); return n;
    };
    note('No VPN · use LTE/5G', [], 'LinkedIn');
    note('Discord', ['Ask ChatGPT for names / description', 'Cloaked app or real sim', 'duck email'], 'Discord');
    note('Real SIM', [], 'Amazon');
    note('UK VoIP or SIM', [], 'Google');
    note('Google Voice', ['Change VPN to area code you want', 'Link sim number to verify',
      'Remove linked number', 'If blocked, upload a pic and wait'], 'Google Voice');
    note('AirBnB', ['Use UAE VPN', 'airbnb.ae'], 'AirBnB');

    // ── Optional + Disinformation (bottom) ──
    const bottom = Math.max(ry, ny) + 40;
    const opt = N('related', 'Optional', X_MID, bottom,
      ['Mastadon', 'Tinder', 'Twilio', 'Craigslist', 'Snapchat']);
    E(social, opt, '');
    const dis = N('malware', 'Disinformation', X_PRE, bottom,
      ['Social Media', 'Blogs', 'Sites']);
    E(opt, dis, '');

    return { nodes, edges, view: { x: 40, y: 20, scale: 0.5 } };
  },
};

const DEFAULT_TPL_KEY = 'timemap.defaultTemplate';
function getDefaultTemplate() {
  try { return localStorage.getItem(DEFAULT_TPL_KEY) || 'blank'; }
  catch (_) { return 'blank'; }
}
function setDefaultTemplate(key) {
  try { localStorage.setItem(DEFAULT_TPL_KEY, key); } catch (_) {}
}

/* ---- user-editable default maps (localStorage) ------------------------- */
/* A saved default is a snapshot of a map ({nodes,edges,view}); new cases clone
   it (with fresh ids) instead of the built-in template. */
const DEFAULT_MAPS_KEY = 'timemap.defaultMaps';
function loadDefaultMaps() {
  try { return JSON.parse(localStorage.getItem(DEFAULT_MAPS_KEY) || '{}'); }
  catch (_) { return {}; }
}
function getDefaultMap(kind) { return loadDefaultMaps()[kind] || null; }
function saveDefaultMap(kind, snap) {
  const o = loadDefaultMaps(); o[kind] = snap;
  try { localStorage.setItem(DEFAULT_MAPS_KEY, JSON.stringify(o)); } catch (_) {}
}
function clearDefaultMap(kind) {
  const o = loadDefaultMaps(); delete o[kind];
  try { localStorage.setItem(DEFAULT_MAPS_KEY, JSON.stringify(o)); } catch (_) {}
}
/* snapshot a live map for storage — drops evidence links and timestamps so the
   template stays clean/portable, keeps ids for edge/row remapping */
function snapshotMap(mp) {
  return {
    nodes: (mp.nodes || []).map(n => ({
      id: n.id, type: n.type, title: n.title, x: n.x, y: n.y, notes: n.notes || '',
      timestamp: '', evidence: [], flags: [...(n.flags || [])],
      rows: (n.rows || []).map(r => ({ id: r.id, text: r.text, url: r.url || '', flags: [...(r.flags || [])] })),
    })),
    edges: (mp.edges || []).map(e => ({ id: e.id, from: e.from, to: e.to,
      fromRow: e.fromRow || null, toRow: e.toRow || null, label: e.label || '' })),
    view: { ...(mp.view || { x: 0, y: 0, scale: 1 }) },
  };
}
/* build the investigation map for a new case from a template key, applying a
   saved override for that template if one exists */
function buildTemplateMap(tplKey) {
  if (tplKey === 'blank') return { nodes: [], edges: [] };
  if (tplKey === 'mydefault') return cloneMap(getDefaultMap('investigation')) || { nodes: [], edges: [] };
  const override = getDefaultMap('tpl_' + tplKey);
  if (override) return cloneMap(override);
  return TEMPLATES[tplKey] ? TEMPLATES[tplKey].build() : { nodes: [], edges: [] };
}

/* export / import the whole template + customization set */
function exportAllTemplates() {
  return {
    dossier: 'templates', version: 1,
    customCategories: loadCustomCategories(),
    customFlags: loadCustomFlags(),
    defaultMaps: loadDefaultMaps(),
    defaultTemplate: getDefaultTemplate(),
  };
}
function _mergeByKey(existing, incoming) {
  const map = {};
  (existing || []).forEach(x => { if (x && x.key) map[x.key] = x; });
  (incoming || []).forEach(x => { if (x && x.key) map[x.key] = x; });
  return Object.values(map);
}
function importAllTemplates(obj) {
  if (!obj || typeof obj !== 'object') throw new Error('not a templates file');
  if (obj.customCategories) saveCustomCategories(_mergeByKey(loadCustomCategories(), obj.customCategories));
  if (obj.customFlags) saveCustomFlags(_mergeByKey(loadCustomFlags(), obj.customFlags));
  if (obj.defaultMaps && typeof obj.defaultMaps === 'object') {
    const cur = loadDefaultMaps();
    Object.assign(cur, obj.defaultMaps);
    try { localStorage.setItem(DEFAULT_MAPS_KEY, JSON.stringify(cur)); } catch (_) {}
  }
  if (obj.defaultTemplate) setDefaultTemplate(obj.defaultTemplate);
  refreshCategories();
  refreshFlags();
}

/* deep-clone a stored snapshot with fresh ids (so two maps never collide) */
function cloneMap(snap) {
  if (!snap || !snap.nodes) return null;
  const nodeMap = {}, rowMap = {};
  const nodes = snap.nodes.map(n => {
    const nid = uid('n'); nodeMap[n.id] = nid;
    const rows = (n.rows || []).map(r => { const rid = uid('r'); rowMap[r.id] = rid; return { ...r, id: rid, flags: [...(r.flags || [])] }; });
    return { ...n, id: nid, rows, flags: [...(n.flags || [])], evidence: [] };
  });
  const edges = (snap.edges || []).map(e => ({
    id: uid('e'), from: nodeMap[e.from], to: nodeMap[e.to],
    fromRow: e.fromRow ? rowMap[e.fromRow] || null : null,
    toRow: e.toRow ? rowMap[e.toRow] || null : null, label: e.label || '',
  })).filter(e => e.from && e.to);
  return { nodes, edges, view: { ...(snap.view || { x: 0, y: 0, scale: 1 }) } };
}
