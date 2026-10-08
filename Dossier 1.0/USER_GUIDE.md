# Dossier — User Guide

A practical guide to running an investigation in Dossier. This covers everything
an analyst does day to day. For installation see **[INSTALL.md](INSTALL.md)**; for
administrator tasks (user accounts, encryption, audit) see
**[ADMIN_GUIDE.md](ADMIN_GUIDE.md)**.

---

## Table of contents

- [Core ideas](#core-ideas)
- [Signing in](#signing-in)
- [The dashboard](#the-dashboard)
- [Creating a case](#creating-a-case)
- [The workspace](#the-workspace)
- [Mind map](#mind-map)
  - [Nodes and fields](#nodes-and-fields)
  - [Flags (triage markers)](#flags-triage-markers)
  - [Links between nodes](#links-between-nodes)
  - [The node menu (inspector)](#the-node-menu-inspector)
  - [Navigating, filtering, searching](#navigating-filtering-searching)
  - [The two maps](#the-two-maps)
- [Timeline](#timeline)
- [Index](#index)
- [Evidence](#evidence)
- [Case details & version history](#case-details--version-history)
- [Exporting](#exporting)
- [Settings](#settings)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Good habits & security](#good-habits--security)

---

## Core ideas

- **A case is one investigation.** It holds a mind map, a timeline, evidence
  files, and metadata — all in one self-contained folder on disk.
- **The mind map is where you record findings.** You build *container nodes*
  (e.g. *Emails*, *Social Media*, *Breaches*) with editable fields inside them,
  and draw links to show relationships.
- **The timeline builds itself.** Give any node a date and it appears on the
  timeline automatically. You can also add standalone events.
- **The Index aggregates everything** — all your field values collected and
  grouped, so you can see every email, domain, handle, etc. at a glance.
- **Autosave is always on.** Edits are written to disk a fraction of a second
  after you make them; the **saved** indicator in the top bar confirms it.

---

## Signing in

1. Open <http://127.0.0.1:6854>.
2. Enter your **name** and **password** and click **Unlock**.
3. You land on the **dashboard** (the case-management screen).

Notes:

- **Auto-lock:** after **15 minutes** of inactivity Dossier locks itself and
  returns you to the sign-in screen. Your work is already saved.
- **Log out** anytime with the button in the dashboard header.
- **Change your password** in **⚙ Settings ▸ Change your password**.
- Too many wrong passwords locks that account for 15 minutes (see
  [ADMIN_GUIDE](ADMIN_GUIDE.md#login-security)).

---

## The dashboard

The dashboard lists the cases you can access and is your home base.

**Toolbar:**

| Control | What it does |
|---------|--------------|
| **＋ New case** | Opens the new-case panel (see below). |
| **Import .zip** | Imports a case previously exported as a `.zip` bundle. |
| **Activity** | Opens the global, tamper-evident [activity log](ADMIN_GUIDE.md#activity--audit-trail). |
| **⚙ Settings** | System-wide settings (categories, flags, templates, password). |
| **Search cases…** | Filters the table by name, number, or analyst. |
| **Sort** | Recently modified / created, name, or most entities. |

**Case table:** each row shows the case name, number, analyst, classification
(TLP), owner, entity count, and dates. From a row you can:

- **Click the row** to open the case.
- **Edit inline** — click the edit (✎) control to change name, number, analyst,
  or classification right in the table, then save.
- **Delete** — only the case **owner** or an **admin** sees the delete control.

> Which cases you see depends on access: analysts see cases they **own or are
> assigned to**; admins see **all** cases. See
> [Case details & version history](#case-details--version-history).

---

## Creating a case

Click **＋ New case** and fill in the panel:

- **Case name** — required (e.g. `RANSOM-2026-014`).
- **Case #** — your tracking number (optional).
- **Analyst** — defaults to you; change if recording on someone's behalf.
- **Start from** — the template the map begins with:
  - **Blank canvas**
  - **Target profile (OSINT)** — person-focused OSINT layout
  - **Company due diligence (M&A)**
  - **Executive privacy management**
  - **ORM — Person** and **ORM — Company** (online reputation management)
  - **OSINT investigative reporting**
  - **My default** / any template you've customized (see
    [Settings ▸ Default templates](#settings))

Click **Create case** to open it. You become the case **owner**.

---

## The workspace

Opening a case shows the workspace. The **top bar** has:

- **☰** — back to the dashboard.
- **Case title** — click it to open **[Case details & version history](#case-details--version-history)**.
- **saved / saving…** — the autosave indicator.
- **Tabs:** **Mind map · Timeline · Index · Evidence**.
- **⚙** — Settings. **Export ▾** — the [export menu](#exporting).

---

## Mind map

### Nodes and fields

A **node** is a container with a **title**, a **category** (which sets its
colour), and a list of **fields** (rows) inside it.

- **Add a node:** click **+ Node**, or **double-click** empty canvas.
- **Rename:** edit the title on the node, or in the node menu.
- **Add a field:** use **+ field** on the node (or **+ Add field** in the node
  menu). Type the value directly into the field.
- **Edit a field:** click it and type. A field can hold anything — an email,
  a handle, an address, a note.
- **Field links:** a field can carry a **URL**; set it in the node menu / field
  controls so the value becomes a reference.

### Flags (triage markers)

Flags let you mark what matters. The built-in flags are:

| Flag | Icon | Use |
|------|------|-----|
| **Important** | ★ | Key finding / bookmark |
| **Follow-up** | ⚑ | Needs more work |
| **Verified** | ✓ | Confirmed |
| **Not verified** | ? | Unconfirmed (mutually exclusive with Verified) |

- Flag an **individual field** with the ★/⚑ controls on that field.
- Flag a **whole node** from the node menu's **Flags** row.
- Add your **own flags** in **⚙ Settings ▸ Custom flags**.
- Flags show on the map, in exports, and can be used to **filter** the map and
  **group** the Index.

### Links between nodes

- **Create a link:** drag the **◇ handle** on a node onto another node.
- **Field-level links:** you can draw a link that starts from a specific field,
  so the line comes out of the exact value it relates to.
- **Label a link:** select it and set a label in the inspector (e.g. *owns*,
  *uses*, *email*).
- **Delete:** select a node or link and press **Del** / **Backspace**, or use
  the delete button in its inspector.

### The node menu (inspector)

Click a node to open the right-hand drawer:

- **Title** and **Category** (grouped dropdown; colour follows the category).
- **Note** — if the node has a timeline note, it's shown here (read-only; edit it
  on the [Timeline](#timeline)).
- **Fields** — count, plus **+ Add field**.
- **Flags** — toggle whole-node flags.
- **Date & time** — set a date to put the node on the timeline (time optional);
  **View on timeline →** jumps there.
- **Evidence** — see linked files and **+ link evidence…** to attach one.
- **Delete node**.

### Navigating, filtering, searching

- **Pan:** drag the canvas. **Zoom:** mouse wheel. **Fit:** the **Fit** button.
- **Undo / Redo:** the ↶ / ↷ buttons or `Ctrl+Z` / `Ctrl+Shift+Z`.
- **Filter:** the **Filter** button dims everything except the categories/flags
  you choose — great for focusing a busy map.
- **Search:** the **Search nodes & fields…** box (or `Ctrl+F`) finds matches and
  lets you jump to each; it shows a result count.
- **Legend:** the colour key for categories on the current map.

### The two maps

Every case has two independent maps, switched with the tabs at the top-left of
the map toolbar:

- **Investigation** — your main map. **This is the one the Timeline and Index
  read from.**
- **🧦 Sock Puppet** — a separate workflow map for recording how you built your
  sock-puppet accounts. It is **not** on the timeline. **Reset layout** restores
  its default template (your Investigation map is untouched).

---

## Timeline

Open the **Timeline** tab to see everything with a date, in order.

- **Dated nodes appear automatically.** Add a date to a node (in its menu) and it
  shows up here. Toggle **include node timestamps** to show/hide them.
- **+ Event** adds a standalone timeline event (date, title, notes, optional
  linked node) — for things that aren't a node on the map.
- **Node notes are edited here.** Each dated node has a notes box on the timeline;
  what you type is saved to the node (and shown read-only in the node menu). There
  is intentionally **no notes field on the mind map**.
- **List vs Graphic:** switch between a grouped list and a visual timeline graphic
  (the graphic is included in exported reports).
- **Expand all** opens every item's details; click a node tag to jump back to it
  on the map.

---

## Index

The **Index** tab collects **every field value** across the Investigation map so
you can review all your indicators at once.

- **Group by:** **category** (where it came from), **detected type** (email,
  domain, IP, handle, URL, phone…), or **flag**.
- **Search all field values…** to filter.
- **flagged only** — show just flagged values. **unique only** — collapse
  duplicates.
- Useful for spotting reuse (the same username across many nodes) and for a quick
  indicator list.

---

## Evidence

Open the **Evidence** tab to manage files that back up your findings.

- **+ Upload evidence** copies the file *into the case* and records its
  **SHA-256** hash for integrity. Max **512 MB** per file.
- **Link evidence to a node** from the node menu's **Evidence** section.
- **Images** open in a lightbox; any file can be **downloaded**.
- Evidence travels with the case in the **full `.zip`** export.

---

## Case details & version history

Click the **case title** in the top bar to open **Case details**:

- **Metadata:** case name, number, analyst, **classification** (TLP:CLEAR /
  GREEN / AMBER / AMBER+STRICT / RED), and a **summary**. These appear on the
  dashboard and in the header of exported reports.
- **Access:** the **Owner** and **Assignees** control who can open the case.
  The owner and admins manage this. (More in
  [ADMIN_GUIDE](ADMIN_GUIDE.md#case-ownership--access).)
- **Version history (snapshots):** **Save snapshot** stores a full copy of the
  case you can **restore** later. A backup is taken automatically before any
  restore, so restoring is safe.
- **Activity log:** who changed what in this case, and when.

---

## Exporting

Use **Export ▾** in the top bar (or the export dock on the map):

| Export | Contents |
|--------|----------|
| **📄 Case report — PDF** | Formatted report: metadata header (case #, analyst, TLP, summary), relationship map image, graphic timeline, findings, evidence list. |
| **📝 Case report — Word (.doc)** | The same report as an editable Word document. |
| **{ } Case data — JSON** | The raw case data. |
| **🖼 Map image — PNG** | Just the current map as an image. |
| **🗜 Full bundle — .zip** | The complete case **including evidence files** — re-importable from the dashboard. |

> ⚠️ **Exports are decrypted (plaintext)** so they can be opened anywhere. Treat
> them as sensitive: store them safely and delete them when done.

---

## Settings

**⚙ Settings** (available on both the dashboard and the workspace) holds
**system-wide** options:

- **Users** — account management (admin only; see
  [ADMIN_GUIDE](ADMIN_GUIDE.md#managing-users)).
- **Change your password** — current + new password.
- **Custom categories** — your own node categories, colour-coded, available in
  every case.
- **Custom flags** — your own triage markers (icon + name + colour).
- **Default templates** — build a map the way you like on the canvas, then
  **Save current map** here to override a template; **Reset** restores the
  built-in. **Export / Import** backs up or shares your whole template set.
  (Saving a template needs an open case; from the dashboard those buttons are
  disabled with a hint.)

---

## Keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| **Double-click** canvas | New node |
| **Ctrl+F** | Search nodes & fields |
| **Ctrl+Z** / **Ctrl+Shift+Z** | Undo / Redo |
| **Del** / **Backspace** | Delete the selected node or link |
| **Esc** | Deselect / close the inspector |
| Mouse wheel | Zoom · drag canvas = pan · drag node = move |

---

## Good habits & security

- **Flag as you go.** Mark Verified vs Not verified so your conclusions are
  traceable; use Important/Follow-up as a working queue.
- **Attach evidence** for anything you'll report — the SHA-256 hash is your
  integrity record.
- **Snapshot before big changes** so you can roll back.
- **Lock the screen** (or just walk away — it auto-locks after 15 minutes).
- **Handle exports carefully** — they are unencrypted copies of the case.
- Dossier runs only on your machine (`127.0.0.1`); nothing is sent anywhere.

> ⚠️ **Not a production application.** Dossier is a local tool for a trusted
> analyst on a machine they control. It should be run **only on a secure,
> access-controlled host** — never exposed to the internet or an untrusted
> network.
