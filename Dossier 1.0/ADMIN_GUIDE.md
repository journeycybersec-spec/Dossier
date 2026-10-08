# Dossier — Administrator Guide

This guide covers the tasks only administrators do: setting up the vault, managing
users and roles, understanding the encryption and audit model, controlling case
access, and keeping the data safe.

New to the app itself? Read the **[User Guide](USER_GUIDE.md)** first — admins can
do everything a user can, plus the items below. For installation see
**[INSTALL.md](INSTALL.md)**.

---

## Table of contents

- [The admin role](#the-admin-role)
- [First-run setup](#first-run-setup)
- [Roles at a glance](#roles-at-a-glance)
- [Managing users](#managing-users)
- [Passwords & resets](#passwords--resets)
- [Encryption model](#encryption-model)
- [Case ownership & access](#case-ownership--access)
- [Activity & audit trail](#activity--audit-trail)
- [Login security](#login-security)
- [Backups & restore](#backups--restore)
- [Maintenance & updates](#maintenance--updates)
- [Troubleshooting](#troubleshooting)
- [Security checklist](#security-checklist)

---

## The admin role

An administrator can:

- Create, delete, and re-role **users**.
- **Reset** any user's password.
- **See and open every case**, regardless of owner.
- Change any case's **owner and assignees**, and delete any case.
- Review the global **activity log** and verify its integrity.

The **first account created** is automatically an admin. There is always at least
one admin — the app refuses to delete or demote the last one.

---

## First-run setup

Dossier ships with a **default administrator account**:

| Username | Password |
|----------|----------|
| `admin`  | `admin`  |

1. Start the server (see [INSTALL.md](INSTALL.md)) and open
   <http://127.0.0.1:6854>.
2. Sign in with **`admin`** / **`admin`**. At-rest encryption is already enabled
   (if the `cryptography` package is installed) with the key wrapped by this
   password.
3. **Change the default password immediately** — `admin`/`admin` is a well-known
   default. Open your account settings and set a strong, unique password; on an
   encrypted vault the key is re-wrapped automatically.

> **Prefer to create your own admin from scratch?** Delete `auth.json`,
> `vault.json`, and `.secret` from the data directory before first run. Then
> you'll see **"Create your account to protect this vault"**; the first account
> you create becomes the administrator, at-rest encryption is enabled
> automatically, and any **ownerless cases** on disk are adopted to you.

> ⚠️ **The admin password protects the whole vault.** Choose a strong one
> and store it safely — there is **no vault recovery** (see
> [Encryption model](#encryption-model)).

---

## Roles at a glance

| Capability | Analyst | Admin |
|------------|:------:|:-----:|
| Create cases | ✅ | ✅ |
| See / open cases | Own + assigned only | **All** |
| Edit case content | On accessible cases | All |
| Delete a case | Only if **owner** | Any |
| Change case owner / assignees | If **owner** | Any |
| Add / delete / re-role users | ❌ | ✅ |
| Reset another user's password | ❌ | ✅ |
| Change **own** password | ✅ | ✅ |
| View global activity log | ✅ (read) | ✅ |
| Manage custom categories / flags / templates | ✅ | ✅ |

---

## Managing users

Open **⚙ Settings ▸ Users** (available from the dashboard or a case).

**Add a user:**

1. Enter a **Name** and **Password** (min 4 characters).
2. Pick a **role** — **Analyst** or **Admin**.
3. Click **Add user**.

Each user signs in with their name + password. When encryption is on, adding a
user automatically grants them a wrapped copy of the vault key, so they can read
cases they have access to.

**Change a role:** use the role control on the user's row. You **cannot demote the
last admin**.

**Delete a user:** use the delete control on the row. You **cannot delete the last
user, or the last admin**. Deleting a user also removes their wrapped key copy.

> **Tip:** deleting a user does **not** delete their cases. Reassign ownership
> first (see [Case ownership & access](#case-ownership--access)) so those cases
> don't become orphaned.

---

## Passwords & resets

- **Users change their own password** in **⚙ Settings ▸ Change your password**
  (requires the current password).
- **Admins reset any user's password** from **⚙ Settings ▸ Users** → the reset
  control on that user's row. No current password needed.

How reset stays compatible with encryption: the admin performing the reset is
logged in and holds the vault key in memory, so Dossier **re-wraps that key under
the user's new password**. The user keeps access to their cases after the reset.

> This is why an admin must be **logged in** to reset someone — the live session
> is what makes re-wrapping possible.

---

## Encryption model

When the `cryptography` package is present, Dossier encrypts **case data,
evidence files, and snapshots at rest**.

- A random **data-encryption key (DEK)** encrypts all case files (AES-GCM). Files
  on disk begin with a `TMENC1` marker.
- The DEK is **wrapped (encrypted) separately for each user** with a key derived
  from their password (scrypt). These wrapped copies live in `vault.json`.
- The DEK exists **only in memory** while a user is logged in. It is never written
  to disk unwrapped.
- **After a server restart, the DEK is gone from memory** — the first thing any
  user must do is log in, which unwraps the DEK again. Until someone logs in, case
  files cannot be read. (The API returns `401` for data requests in this state.)

**What this means in practice:**

- Losing the disk without a password yields only ciphertext.
- **There is no master recovery key.** If every user's password is lost, the data
  cannot be decrypted. Keep at least one admin password safe.
- To check status, the sign-in/API status shows whether the vault is encrypted.

> If `cryptography` is **not** installed, the app still runs but encryption cannot
> be enabled and data is stored in plaintext. Install it and set up the vault to
> get encryption (see [INSTALL.md](INSTALL.md)).

---

## Case ownership & access

Access is enforced on the server — not just hidden in the UI.

- Every case has an **owner** and a list of **assignees**.
- A case is accessible to its **owner**, its **assignees**, and **all admins**.
- Analysts only see cases they own or are assigned to; admins see everything.
- **Delete** is limited to the **owner** or an **admin**.

**Manage access:** open a case → click the **case title** → **Access** section →
set the **Owner** and add/remove **Assignees**. (Ownership/assignees are managed
here, never by editing the case body.)

**Ownerless-case adoption:** when the first admin is created, any case on disk
without an owner is assigned to that admin. This cleans up cases imported or
created before accounts existed.

---

## Activity & audit trail

Dossier keeps a global, **tamper-evident** activity log (`audit.jsonl`).

- Open it with **Activity** on the dashboard (or the per-case log in
  **Case details ▸ Activity log**).
- Each entry is **hash-chained** to the one before it, so any edit, deletion, or
  reordering of the log is detectable.
- The **verify badge** next to the *Activity* heading shows whether the chain is
  intact (**passed**) or has been **tampered** with.
- Filter by **user**, **action**, or free-text search.

Recorded actions include logins, lockouts, user add/delete/role/password changes,
case create/update/delete, access changes, snapshots, and ownerless-case adoption.

> The audit log is designed to be *evidence of what happened*. Don't hand-edit
> `audit.jsonl` — doing so will show up as a failed verification.

---

## Login security

| Control | Value | Notes |
|---------|-------|-------|
| **Failed-login lockout** | 5 attempts → **15 min** | Per account; returns HTTP 429 while locked. Even the correct password is refused until it expires. |
| **Idle auto-lock** | **15 min** | The browser locks and returns to sign-in; work is already saved. |
| **Session lifetime** | **8 hours** | After which re-authentication is required. |
| **Upload size cap** | **512 MB** per file | `MAX_CONTENT_LENGTH` in `app.py`. |

**Clearing a lockout:** the lockout counter is held in memory. Wait out the 15
minutes, or **restart the server** to clear it immediately (note: a restart also
clears the in-memory DEK, so everyone must log in again).

---

## Backups & restore

**What to back up** — the whole **data directory** (next to `app.py` by default,
or wherever `DOSSIER_DATA` points):

```text
cases/        # every investigation (encrypted at rest)
auth.json     # user accounts
vault.json    # wrapped encryption keys  ← back this up WITH cases/
audit.jsonl   # activity log
.secret       # session-signing key
```

> Back up `cases/` **and** `vault.json` **together**. Encrypted cases are useless
> without the matching wrapped keys.

**Relocating data:** run with `DOSSIER_DATA=/path/to/data` to keep all mutable
data on, say, an encrypted volume (see [INSTALL.md](INSTALL.md#where-your-data-lives)).

**Per-case backup:**

- **Snapshots** (Case details ▸ Version history) — in-app point-in-time copies you
  can restore; a backup is taken automatically before any restore.
- **Full `.zip` export** — a portable, **decrypted** copy of one case, including
  evidence, re-importable from the dashboard. Store exports securely.

**Restore:**

- A snapshot: **Case details ▸ Version history ▸ Restore**.
- A `.zip`: **Dashboard ▸ Import .zip**.
- A whole vault: stop the server, restore the data directory, start the server,
  and log in.

---

## Maintenance & updates

> ⚠️ **Not a production application.** Dossier is a local tool for a trusted
> analyst on a machine they control. It has **not** been security-hardened or
> audited for untrusted networks, multi-tenant hosting, or public/internet-facing
> deployment. Run it **only on a secure, access-controlled host**; never expose it
> to the internet or an untrusted network.

- **Updating the app:** see [INSTALL.md ▸ Updating](INSTALL.md#updating). Back up
  the data directory first.
- **Dependencies:** `pip install -r requirements.txt` (Flask + cryptography).
- **Running the server:** it must stay running to use the app; `Ctrl+C` stops it.
  Consider a simple launcher script or a user-level service if you run it often.
- The server **binds to `127.0.0.1` only**. Do not expose it to a network without
  adding your own TLS and access controls in front of it.

---

## Troubleshooting

**"Not configured" when signing in**
The vault has no account yet. Reload the page to get the **Create account** form.
A stale browser tab can show the old sign-in form — refresh fixes it.

**A user is locked out**
Wait 15 minutes, or restart the server to clear the lock (this logs everyone out).

**A user forgot their password**
Any admin can **reset** it (Settings ▸ Users). The user keeps case access.

**All admin passwords are lost**
There is **no recovery** — the vault key cannot be unwrapped. This is by design.
Restore from a backup taken when a password was known, or start over. Keep an
admin password safe to avoid this.

**"Encryption unavailable / not enabled"**
`cryptography` isn't installed. Install it (`pip install cryptography`) and create
the vault; existing plaintext data is encrypted at setup.

**Audit verification shows "tampered"**
The `audit.jsonl` chain is broken — a line was edited, removed, or reordered on
disk. Investigate; restore the log from a trusted backup if appropriate.

---

## Security checklist

- [ ] Running on a **secure, access-controlled host** — not exposed to the
      internet or an untrusted network (this is **not** a production app).
- [ ] `cryptography` installed and the vault shows **encrypted**.
- [ ] At least one **admin password** is strong and safely stored.
- [ ] Regular **backups** of `cases/` **and** `vault.json` together.
- [ ] Each person has their **own account** (no shared logins) for clean audit.
- [ ] Case **owners/assignees** reflect who should actually have access.
- [ ] Exports are treated as **sensitive, unencrypted** copies.
- [ ] The server is **not exposed** beyond `127.0.0.1` without added controls.
- [ ] Audit **verify badge** checked periodically — it reads **passed**.
