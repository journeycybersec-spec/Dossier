# Installing Dossier

Dossier is a **local, offline** web app for infosec/OSINT investigations — a mind
map + timeline with evidence, case management, roles, and at-rest encryption. It
runs entirely on your own machine: a small Python (Flask) server that you open in
a browser. There is no cloud account, no external service, and no data leaves the
host.

This guide covers installing and running Dossier on **Linux, macOS, and Windows**.

---

## Table of contents

- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Step-by-step install](#step-by-step-install)
  - [1. Get the code](#1-get-the-code)
  - [2. (Recommended) Create a virtual environment](#2-recommended-create-a-virtual-environment)
  - [3. Install dependencies](#3-install-dependencies)
  - [4. Run the server](#4-run-the-server)
  - [5. Sign in (default credentials)](#5-sign-in-default-credentials)
- [Where your data lives](#where-your-data-lives)
- [Running it again later](#running-it-again-later)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Troubleshooting](#troubleshooting)
- [Security notes](#security-notes)

---

## Requirements

| Thing | Minimum | Notes |
|-------|---------|-------|
| **Python** | 3.8+ | Tested on 3.14. Check with `python3 --version`. |
| **pip** | any recent | Ships with Python; `python3 -m pip --version`. |
| **Browser** | any modern | Chrome/Chromium, Firefox, Edge, Safari. |
| **Disk** | a few MB + your evidence | Each case is a self-contained folder. |
| **Network** | none | Fully offline; the server binds to `127.0.0.1` only. |

**Python packages** (installed in step 3):

- [`Flask`](https://pypi.org/project/Flask/) — the web server.
- [`cryptography`](https://pypi.org/project/cryptography/) — at-rest encryption of
  cases and evidence. *Optional but strongly recommended* — without it the app
  still runs, but encryption cannot be enabled.

> **Note:** No Node.js / npm is required. The front end is plain JavaScript served
> directly by the Python server.

---

## Quick start

For the impatient, on Linux/macOS:

```bash
git clone https://github.com/YOUR-USERNAME/dossier.git
cd dossier
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

Then open <http://127.0.0.1:6854> and sign in with the default credentials
**`admin`** / **`admin`** — then change the password right away.

> Replace `https://github.com/YOUR-USERNAME/dossier.git` with the actual
> repository URL.

---

## Step-by-step install

### 1. Get the code

**Option A — clone with Git (recommended):**

```bash
git clone https://github.com/YOUR-USERNAME/dossier.git
cd dossier
```

**Option B — download a ZIP:**

On the GitHub page, click **Code ▸ Download ZIP**, extract it, then open a
terminal in the extracted folder.

### 2. (Recommended) Create a virtual environment

A virtual environment keeps Dossier's dependencies isolated from the rest of your
system.

**Linux / macOS:**

```bash
python3 -m venv .venv
source .venv/bin/activate
```

**Windows (PowerShell):**

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

Your prompt should now show `(.venv)`. (To leave the environment later, run
`deactivate`.)

> Skipping this step is fine too — just install the packages globally or with
> `pip install --user`.

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

This installs **Flask** and **cryptography**. On most systems `cryptography`
installs from a prebuilt wheel in seconds; see
[Troubleshooting](#troubleshooting) if it tries to compile and fails.

### 4. Run the server

**Linux / macOS:**

```bash
python3 app.py
```

**Windows:**

```powershell
py app.py
```

You should see:

```text
Dossier running at http://127.0.0.1:6854  (data in ./cases)
```

Leave this terminal open — it *is* the server. Press `Ctrl+C` to stop it.

### 5. Sign in (default credentials)

Dossier ships with a pre-seeded administrator account so you can sign in
immediately:

| Username | Password |
|----------|----------|
| `admin`  | `admin`  |

1. Open <http://127.0.0.1:6854> in your browser.
2. You'll see a **sign-in** form. Enter **`admin`** / **`admin`** and sign in.
3. This account is the **administrator**, and at-rest **encryption is already
   enabled** (if `cryptography` is installed) with the key wrapped by this
   password.

> 🔐 **Change the default password immediately.** `admin`/`admin` is a
> well-known default — anyone who can reach the app could sign in with it. After
> your first sign-in, open your account settings and set a strong, unique
> password. (On encrypted vaults the password is re-wrapped automatically when
> you change it.)

> ⚠️ **Remember your new password.** When encryption is on, your password
> protects the key that decrypts your cases. There is **no recovery** if the last
> admin password is lost — an admin can reset *other* users, but not the vault
> itself. See [Security notes](#security-notes).

> **Starting completely fresh instead?** If you want to set up your own admin
> from scratch, delete `auth.json`, `vault.json`, and `.secret` from the data
> directory before first run. Dossier will then show a **"Create your account"**
> form instead of the sign-in form, and the first account you create becomes the
> administrator. (This discards the default account and any data encrypted under
> it.)

You're installed. 🎉

---

## Where your data lives

By default, everything is written **next to `app.py`**:

```text
dossier/
├── app.py
├── cases/            # one folder per case (case.json + evidence/ + snapshots/)
├── auth.json         # user accounts (created on first setup)
├── vault.json        # wrapped encryption keys (if encryption is on)
├── audit.jsonl       # tamper-evident activity log
└── .secret           # session-signing key
```

**To store data somewhere else** (e.g. an encrypted volume or a shared path), set
the `DOSSIER_DATA` environment variable to any directory:

**Linux / macOS:**

```bash
DOSSIER_DATA=/path/to/data python3 app.py
```

**Windows (PowerShell):**

```powershell
$env:DOSSIER_DATA="D:\path\to\data"; py app.py
```

Only mutable data (cases, `auth.json`, `vault.json`, `audit.jsonl`, `.secret`)
moves — the program files stay in the install folder. Back up the data directory
and you've backed up every investigation.

---

## Running it again later

Dossier doesn't install into your system menu; you start it from its folder each
time:

```bash
cd dossier
source .venv/bin/activate      # if you made a venv (Windows: .\.venv\Scripts\Activate.ps1)
python3 app.py                 # Windows: py app.py
```

Then open <http://127.0.0.1:6854>.

> **Tip:** On Linux you can create a launcher script, e.g. `run.sh`:
> ```bash
> #!/usr/bin/env bash
> cd "$(dirname "$0")" && source .venv/bin/activate && python3 app.py
> ```
> `chmod +x run.sh` and double-click or run `./run.sh`.

---

## Updating

**If you cloned with Git:**

```bash
cd dossier
git pull
pip install -r requirements.txt   # in case dependencies changed
```

Your `cases/`, `auth.json`, and `vault.json` are left untouched by a pull.
**Back up your data directory before updating** if it lives inside the repo
folder.

**If you downloaded a ZIP:** download the new ZIP, then copy your `cases/`,
`auth.json`, `vault.json`, `audit.jsonl`, and `.secret` into the new folder (or
point `DOSSIER_DATA` at your existing data directory).

---

## Uninstalling

Dossier makes no system-wide changes. To remove it completely:

1. Stop the server (`Ctrl+C`).
2. Delete the project folder (and your `DOSSIER_DATA` directory if you set one).
3. If you made a virtual environment inside the folder, it goes with it.

> Deleting the `cases/` folder (or the encrypted files within) is irreversible.
> Export any cases you want to keep first (**Export ▸ case `.zip`** in the app).

---

## Troubleshooting

**`command not found: python3`**
Install Python from [python.org](https://www.python.org/downloads/) (Windows/macOS)
or your package manager (e.g. `sudo apt install python3 python3-venv python3-pip`
on Debian/Kali/Ubuntu). On Windows, use `py` instead of `python3`.

**Port 6854 is already in use**
Another process (often a previous Dossier run) holds the port. Find and stop it:

```bash
# Linux / macOS
lsof -i :6854            # or: ss -ltnp | grep 6854
kill <pid>
```
```powershell
# Windows
netstat -ano | findstr 6854
taskkill /PID <pid> /F
```

**`pip install` tries to compile `cryptography` and fails**
Upgrade pip so it can fetch a prebuilt wheel:

```bash
python3 -m pip install --upgrade pip
pip install -r requirements.txt
```
If it still fails, install build tools (`sudo apt install build-essential
libssl-dev libffi-dev python3-dev`), or run without encryption (see next item).

**The app runs but says encryption is unavailable / not enabled**
`cryptography` isn't installed. The app still works; to enable encryption,
install it and create your account fresh:

```bash
pip install cryptography
```

**I see a sign-in form, not a "Create account" form**
This is expected — Dossier ships with a default **`admin`** / **`admin`**
account, so it goes straight to sign-in. Use those credentials and change the
password. To start from a blank vault instead, delete `auth.json`, `vault.json`,
and `.secret` before first run (see [step 5](#5-sign-in-default-credentials)).

**"Not configured" when I try to sign in**
The vault has no account (e.g. you deleted `auth.json`) — reload the page and
you'll get the **Create account** form instead of a sign-in form. (A stale
browser tab can show the old form; a refresh fixes it.)

**I'm locked out after too many wrong passwords**
Login locks for 15 minutes after 5 failed attempts. Wait it out, or restart the
server to clear the in-memory lock.

**Browser didn't open automatically**
It won't — open <http://127.0.0.1:6854> yourself after starting the server.

---

## Security notes

> ⚠️ **Not a production application.** Dossier is a local tool for a trusted
> analyst on a machine they control. It has **not** been security-hardened or
> audited for untrusted networks, multi-tenant hosting, or public/internet-facing
> use. Install and run it **only on a secure, access-controlled host**; never
> expose it to the internet or an untrusted network.

- The server **binds to `127.0.0.1` only** — it is not reachable from other
  machines. Do **not** put it behind a public reverse proxy without adding your
  own TLS and access controls.
- With `cryptography` installed, cases and evidence are **encrypted at rest** with
  AES-GCM; the key is wrapped per-user with a password-derived key (scrypt). The
  decryption key exists only in memory while you're logged in, so after a server
  restart you must log in again to read cases.
- Activity is recorded in a **hash-chained, tamper-evident** audit log
  (`audit.jsonl`), verifiable from inside the app.
- **There is no password recovery for the vault.** Keep at least one admin
  password safe.
- **Exported `.zip` archives are decrypted (plaintext)** so they're portable and
  can be opened anywhere. Treat exports as sensitive — store them somewhere safe
  (e.g. an encrypted volume) and delete them when no longer needed.

---

For day-to-day usage, see the [README](README.md).
