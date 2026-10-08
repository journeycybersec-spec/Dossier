#!/usr/bin/env python3
"""Dossier — mind-map + timeline tool for infosec incident findings.

A small local Flask server. All data stays on this machine under ./cases.
Each case is a self-contained folder:

    cases/<case-id>/
        case.json          mindmap nodes, edges, timeline events, evidence index
        evidence/          embedded attachment files

Run:  python3 app.py   then open http://127.0.0.1:6854
"""
import base64
import hashlib
import io
import json
import mimetypes
import os
import re
import secrets
import shutil
import uuid
import zipfile

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    _CRYPTO = True
except Exception:   # pragma: no cover
    _CRYPTO = False
from datetime import datetime, timedelta, timezone

import hmac
import time

from flask import (
    Flask,
    abort,
    jsonify,
    request,
    send_file,
    send_from_directory,
    session,
)
from werkzeug.utils import secure_filename

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
# all mutable data lives under DATA_DIR (override with DOSSIER_DATA, e.g. for tests)
DATA_DIR = os.path.abspath(
    os.environ.get("DOSSIER_DATA") or os.environ.get("TIMEMAP_DATA") or BASE_DIR
)
CASES_DIR = os.path.join(DATA_DIR, "cases")
STATIC_DIR = os.path.join(BASE_DIR, "static")

os.makedirs(CASES_DIR, exist_ok=True)

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 512 * 1024 * 1024  # 512 MB per upload

ID_RE = re.compile(r"^[0-9a-f]{32}$")

# ---------------------------------------------------------------- auth setup
AUTH_FILE = os.path.join(DATA_DIR, "auth.json")
SECRET_FILE = os.path.join(DATA_DIR, ".secret")


def _load_secret():
    if os.path.isfile(SECRET_FILE):
        with open(SECRET_FILE, "rb") as fh:
            return fh.read()
    s = os.urandom(32)
    with open(SECRET_FILE, "wb") as fh:
        fh.write(s)
    try:
        os.chmod(SECRET_FILE, 0o600)
    except OSError:
        pass
    return s


app.secret_key = _load_secret()
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  PERMANENT_SESSION_LIFETIME=timedelta(hours=8))

# brute-force lockout (in-memory, per username)
_login_fails = {}       # name.lower() -> {"count": int, "until": epoch}
MAX_FAILS = 5
LOCK_SECS = 900         # 15 minutes


def load_auth():
    """Return {'users': [...]}. Migrates old formats and ensures roles."""
    if not os.path.isfile(AUTH_FILE):
        return {"users": []}
    try:
        with open(AUTH_FILE, "r", encoding="utf-8") as fh:
            raw = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return {"users": []}
    if isinstance(raw, dict) and "users" in raw:
        a = raw
    elif isinstance(raw, dict) and "hash" in raw:  # legacy single user
        a = {"users": [{"name": raw.get("user") or "Analyst",
                        "salt": raw["salt"], "hash": raw["hash"],
                        "created": raw.get("created")}]}
    else:
        a = {"users": []}
    for i, u in enumerate(a["users"]):            # first user defaults to admin
        if "role" not in u:
            u["role"] = "admin" if i == 0 else "analyst"
    return a


def save_auth(a):
    with open(AUTH_FILE, "w", encoding="utf-8") as fh:
        json.dump(a, fh, indent=2)
    try:
        os.chmod(AUTH_FILE, 0o600)
    except OSError:
        pass


def find_user(a, name):
    name = (name or "").strip().lower()
    for u in a.get("users", []):
        if u["name"].strip().lower() == name:
            return u
    return None


def hash_pw(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, 200_000).hex()


# ---------------------------------------------------------- at-rest encryption
VAULT_FILE = os.path.join(DATA_DIR, "vault.json")
ENC_MAGIC = b"TMENC1"
_dek_mem = {}   # session-id -> DEK bytes (only in memory, never persisted)


def load_vault():
    if os.path.isfile(VAULT_FILE):
        try:
            with open(VAULT_FILE, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (json.JSONDecodeError, OSError):
            return {}
    return {}


def save_vault(v):
    with open(VAULT_FILE, "w", encoding="utf-8") as fh:
        json.dump(v, fh, indent=2)
    try:
        os.chmod(VAULT_FILE, 0o600)
    except OSError:
        pass


def encryption_enabled():
    return _CRYPTO and load_vault().get("enabled") is True


def _kek(password, salt_hex):
    return hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex) + b"|kek",
                          n=2 ** 14, r=8, p=1, dklen=32, maxmem=96 * 1024 * 1024)


def _wrap_dek(kek, dek):
    nonce = secrets.token_bytes(12)
    return base64.b64encode(nonce + AESGCM(kek).encrypt(nonce, dek, None)).decode()


def _unwrap_dek(kek, b64):
    raw = base64.b64decode(b64)
    return AESGCM(kek).decrypt(raw[:12], raw[12:], None)


def _enc(dek, pt):
    nonce = secrets.token_bytes(12)
    return ENC_MAGIC + nonce + AESGCM(dek).encrypt(nonce, pt, None)


def _dec(dek, blob):
    if not blob.startswith(ENC_MAGIC):
        return blob
    return AESGCM(dek).decrypt(blob[6:18], blob[18:], None)


def is_enc(blob):
    return blob.startswith(ENC_MAGIC)


def get_dek():
    return _dek_mem.get(session.get("sid"))


def _set_session_dek(dek):
    sid = secrets.token_hex(16)
    session["sid"] = sid
    _dek_mem[sid] = dek


def _encrypt_existing(dek):
    """Encrypt any still-plaintext case/snapshot/evidence files (migration)."""
    for cid in os.listdir(CASES_DIR):
        cdir = os.path.join(CASES_DIR, cid)
        if not ID_RE.match(cid) or not os.path.isdir(cdir):
            continue
        targets = [os.path.join(cdir, "case.json")]
        for sub in ("snapshots", "evidence"):
            d = os.path.join(cdir, sub)
            if os.path.isdir(d):
                targets += [os.path.join(d, f) for f in os.listdir(d) if not f.endswith(".tmp")]
        for p in targets:
            if not os.path.isfile(p) or p.endswith("index.json"):
                continue
            try:
                with open(p, "rb") as fh:
                    blob = fh.read()
                if not is_enc(blob):
                    with open(p, "wb") as fh:
                        fh.write(_enc(dek, blob))
            except OSError:
                pass


def _make_user(name, password, role="analyst"):
    salt = os.urandom(16)
    return {"name": name.strip()[:60], "salt": salt.hex(),
            "hash": hash_pw(password, salt), "created": now_iso(),
            "role": role if role in ("admin", "analyst") else "analyst"}


def is_admin():
    return session.get("role") == "admin"


def case_access(data):
    """True if the current user may view/edit this case."""
    if is_admin():
        return True
    u = session.get("user")
    return u == data.get("owner") or u in (data.get("assignees") or [])


def guard_case(case_id):
    data = read_case(case_id)       # 404 if missing
    if not case_access(data):
        abort(403, "you don't have access to this case")
    return data


def _first_admin(a):
    for u in a.get("users", []):
        if u.get("role") == "admin":
            return u["name"]
    return a["users"][0]["name"] if a.get("users") else None


def _adopt_ownerless(admin_name):
    """Assign any case without an owner to the first admin (one-time cleanup)."""
    if not admin_name:
        return
    for cid in os.listdir(CASES_DIR):
        p = os.path.join(CASES_DIR, cid, "case.json")
        if not ID_RE.match(cid) or not os.path.isfile(p):
            continue
        try:
            d = _load_case_file(p)
        except (json.JSONDecodeError, OSError):
            continue
        if d is None:
            continue
        if not d.get("owner"):
            d["owner"] = admin_name
            d.setdefault("assignees", [])
            try:
                _persist(p, d)        # preserve modified/rev, encrypt if enabled
                audit("case.adopt", cid, d.get("name"), "assigned owner %s" % admin_name)
            except OSError:
                pass


@app.before_request
def _require_auth():
    p = request.path
    if p == "/" or p.startswith("/static/") or p.startswith("/api/auth/"):
        return
    if p.startswith("/api/") and not session.get("auth"):
        abort(401, "authentication required")
    if p.startswith("/api/") and encryption_enabled() and not get_dek():
        abort(401, "vault locked — sign in again")


# ----------------------------------------------------------------- audit log
AUDIT_FILE = os.path.join(DATA_DIR, "audit.jsonl")
_last_edit = {}   # (user, case_id) -> epoch, throttles noisy field edits


def current_user():
    return session.get("user") or "unknown"


def _last_audit_hash():
    if not os.path.isfile(AUDIT_FILE):
        return ""
    last = ""
    try:
        with open(AUDIT_FILE, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if line:
                    try:
                        last = json.loads(line).get("hash", "")
                    except json.JSONDecodeError:
                        pass
    except OSError:
        return ""
    return last


def _entry_hash(prev, rec):
    base = "|".join([prev, rec["ts"], rec["user"], rec["action"],
                     rec.get("case") or "", rec.get("caseName") or "", rec.get("detail") or ""])
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def audit(action, case_id=None, case_name=None, detail=""):
    rec = {"ts": now_iso(), "user": current_user(), "action": action,
           "case": case_id, "caseName": case_name, "detail": detail}
    prev = _last_audit_hash()
    rec["prev"] = prev
    rec["hash"] = _entry_hash(prev, rec)
    try:
        with open(AUDIT_FILE, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec) + "\n")
    except OSError:
        pass
    return rec


def read_audit(case_id=None, limit=400):
    if not os.path.isfile(AUDIT_FILE):
        return []
    out = []
    try:
        with open(AUDIT_FILE, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if case_id and r.get("case") != case_id:
                    continue
                out.append(r)
    except OSError:
        return []
    out.reverse()
    return out[:limit]


def _case_summary(d):
    inv = (d.get("maps") or {}).get("investigation") or {}
    sp = (d.get("maps") or {}).get("sockpuppet") or {}
    return (d.get("name"), len(inv.get("nodes", [])), len(inv.get("edges", [])),
            len(sp.get("nodes", [])), len(d.get("events", [])),
            len(d.get("evidence", [])), json.dumps(d.get("meta", {}), sort_keys=True))


def _diff_detail(old, new):
    d = []
    if old[0] != new[0]:
        d.append('renamed to "%s"' % new[0])
    for i, lab in ((1, "investigation nodes"), (2, "relationships"),
                   (3, "sock-puppet nodes"), (4, "timeline events"), (5, "evidence")):
        if old[i] != new[i]:
            d.append("%s %d→%d" % (lab, old[i], new[i]))
    if old[6] != new[6]:
        d.append("case details updated")
    return ", ".join(d)


@app.route("/api/audit", methods=["GET"])
def get_audit():
    case = request.args.get("case") or None
    user = request.args.get("user") or None
    action = request.args.get("action") or None
    q = (request.args.get("q") or "").lower()
    limit = int(request.args.get("limit") or 1000)
    rows = read_audit(case, 100000)
    def match(r):
        if user and r.get("user") != user:
            return False
        if action and r.get("action") != action:
            return False
        if q and q not in json.dumps(r).lower():
            return False
        return True
    return jsonify([r for r in rows if match(r)][:limit])


@app.route("/api/audit/verify", methods=["GET"])
def verify_audit():
    prev, i, broken = "", 0, None
    if os.path.isfile(AUDIT_FILE):
        try:
            with open(AUDIT_FILE, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        r = json.loads(line)
                    except json.JSONDecodeError:
                        broken = i
                        break
                    if r.get("prev") != prev or r.get("hash") != _entry_hash(prev, r):
                        broken = i
                        break
                    prev = r["hash"]
                    i += 1
        except OSError:
            pass
    return jsonify({"ok": broken is None, "count": i, "brokenAt": broken})


@app.route("/api/auth/status", methods=["GET"])
def auth_status():
    a = load_auth()
    return jsonify({
        "configured": len(a["users"]) > 0,
        "authenticated": bool(session.get("auth")),
        "user": session.get("user", ""),
        "role": session.get("role", ""),
        "encrypted": encryption_enabled(),
    })


@app.route("/api/auth/setup", methods=["POST"])
def auth_setup():
    a = load_auth()
    if a["users"]:
        abort(400, "already configured")
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or body.get("user") or "").strip()
    pw = body.get("password") or ""
    if not name:
        abort(400, "name is required")
    if len(pw) < 4:
        abort(400, "password must be at least 4 characters")
    admin_rec = _make_user(name, pw, "admin")   # first account is admin
    a["users"].append(admin_rec)
    save_auth(a)
    session.permanent = True
    session["auth"] = True
    session["user"] = name
    session["role"] = "admin"
    # enable at-rest encryption: random DEK wrapped by the admin's password
    if _CRYPTO:
        dek = secrets.token_bytes(32)
        save_vault({"enabled": True, "wrap": {name: _wrap_dek(_kek(pw, admin_rec["salt"]), dek)}})
        _set_session_dek(dek)
        _encrypt_existing(dek)
    audit("auth.setup", detail="first account created (admin); encryption on")
    _adopt_ownerless(name)
    return jsonify({"ok": True, "user": name, "role": "admin"})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    a = load_auth()
    if not a["users"]:
        abort(400, "not configured")
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    if not name:
        abort(400, "name is required")
    key = name.lower()
    now = time.time()

    rec = _login_fails.get(key)
    if rec and rec.get("until", 0) > now:
        mins = int((rec["until"] - now) // 60) + 1
        return jsonify({"error": "Locked — too many attempts. Try again in %d min." % mins}), 429

    pw = body.get("password") or ""
    u = find_user(a, name)
    if u and hmac.compare_digest(hash_pw(pw, bytes.fromhex(u["salt"])), u["hash"]):
        _login_fails.pop(key, None)
        session.permanent = True
        session["auth"] = True
        session["user"] = u["name"]
        session["role"] = u.get("role", "analyst")
        # unlock the encrypted vault for this session
        if encryption_enabled():
            wrapb = (load_vault().get("wrap") or {}).get(u["name"])
            if not wrapb:
                abort(403, "no vault key for this account — ask an admin to reset your access")
            try:
                _set_session_dek(_unwrap_dek(_kek(pw, u["salt"]), wrapb))
            except Exception:
                abort(401, "could not unlock the vault")
        audit("auth.login")
        if session["role"] == "admin":
            _adopt_ownerless(_first_admin(a))
        return jsonify({"ok": True, "user": u["name"], "role": session["role"]})

    r = _login_fails.setdefault(key, {"count": 0, "until": 0})
    r["count"] += 1
    audit("auth.login.fail", detail='failed login for "%s"' % name)
    if r["count"] >= MAX_FAILS:
        r["until"] = now + LOCK_SECS
        r["count"] = 0
        audit("auth.lockout", detail='"%s" locked for %d min' % (name, LOCK_SECS // 60))
        return jsonify({"error": "Locked — too many attempts. Try again in %d min." % (LOCK_SECS // 60)}), 429
    abort(401, "invalid name or password (%d of %d before lockout)" % (r["count"], MAX_FAILS))


@app.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    audit("auth.logout")
    _dek_mem.pop(session.get("sid"), None)
    session.pop("auth", None)
    session.pop("user", None)
    session.pop("role", None)
    session.pop("sid", None)
    return jsonify({"ok": True})


# -------------------------------------------------------------- user accounts
@app.route("/api/users", methods=["GET"])
def list_users():
    a = load_auth()
    return jsonify([{"name": u["name"], "created": u.get("created"),
                     "role": u.get("role", "analyst")} for u in a["users"]])


@app.route("/api/users", methods=["POST"])
def add_user():
    if not is_admin():
        abort(403, "only admins can manage users")
    a = load_auth()
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "").strip()
    pw = body.get("password") or ""
    role = "admin" if body.get("role") == "admin" else "analyst"
    if not name:
        abort(400, "name is required")
    if len(pw) < 4:
        abort(400, "password must be at least 4 characters")
    if find_user(a, name):
        abort(400, "a user with that name already exists")
    rec = _make_user(name, pw, role)
    a["users"].append(rec)
    save_auth(a)
    # give the new user a wrapped copy of the vault key
    if encryption_enabled():
        dek = get_dek()
        if dek:
            v = load_vault()
            v.setdefault("wrap", {})[name] = _wrap_dek(_kek(pw, rec["salt"]), dek)
            save_vault(v)
    audit("user.add", detail='added %s "%s"' % (role, name))
    return jsonify({"name": name, "role": role}), 201


@app.route("/api/users/<name>/role", methods=["PUT"])
def set_user_role(name):
    if not is_admin():
        abort(403, "only admins can change roles")
    a = load_auth()
    u = find_user(a, name)
    if not u:
        abort(404, "user not found")
    role = "admin" if (request.get_json(silent=True) or {}).get("role") == "admin" else "analyst"
    if u.get("role") == "admin" and role != "admin" and \
       sum(1 for x in a["users"] if x.get("role") == "admin") <= 1:
        abort(400, "cannot demote the last admin")
    u["role"] = role
    save_auth(a)
    audit("user.role", detail='%s is now %s' % (u["name"], role))
    return jsonify({"name": u["name"], "role": role})


@app.route("/api/users/<name>", methods=["DELETE"])
def delete_user(name):
    if not is_admin():
        abort(403, "only admins can manage users")
    a = load_auth()
    u = find_user(a, name)
    if not u:
        abort(404, "user not found")
    if len(a["users"]) <= 1:
        abort(400, "cannot delete the last user")
    if u.get("role") == "admin" and sum(1 for x in a["users"] if x.get("role") == "admin") <= 1:
        abort(400, "cannot delete the last admin")
    a["users"] = [x for x in a["users"] if x is not u]
    save_auth(a)
    v = load_vault()
    if (v.get("wrap") or {}).pop(u["name"], None) is not None:
        save_vault(v)
    audit("user.delete", detail='deleted user "%s"' % u["name"])
    return jsonify({"ok": True})


@app.route("/api/users/password", methods=["POST"])
def change_password():
    name = session.get("user")
    if not name:
        abort(401, "not signed in")
    a = load_auth()
    u = find_user(a, name)
    if not u:
        abort(400, "user not found")
    body = request.get_json(silent=True) or {}
    if not hmac.compare_digest(hash_pw(body.get("current") or "", bytes.fromhex(u["salt"])), u["hash"]):
        abort(401, "current password is incorrect")
    new = body.get("new") or ""
    if len(new) < 4:
        abort(400, "new password must be at least 4 characters")
    nu = _make_user(u["name"], new, u.get("role", "analyst"))
    nu["created"] = u.get("created")
    a["users"] = [nu if x is u else x for x in a["users"]]
    save_auth(a)
    # re-wrap the vault key under the new password
    if encryption_enabled():
        dek = get_dek()
        if dek:
            v = load_vault()
            v.setdefault("wrap", {})[u["name"]] = _wrap_dek(_kek(new, nu["salt"]), dek)
            save_vault(v)
    audit("user.password", detail="changed own password")
    return jsonify({"ok": True})


@app.route("/api/users/<name>/password", methods=["PUT"])
def admin_reset_password(name):
    if not is_admin():
        abort(403, "only admins can reset passwords")
    a = load_auth()
    u = find_user(a, name)
    if not u:
        abort(404, "user not found")
    new = (request.get_json(silent=True) or {}).get("new") or ""
    if len(new) < 4:
        abort(400, "new password must be at least 4 characters")
    nu = _make_user(u["name"], new, u.get("role", "analyst"))
    nu["created"] = u.get("created")
    a["users"] = [nu if x is u else x for x in a["users"]]
    save_auth(a)
    # re-wrap the vault key for this user under the new password (admin holds the DEK)
    if encryption_enabled():
        dek = get_dek()
        if dek:
            v = load_vault()
            v.setdefault("wrap", {})[u["name"]] = _wrap_dek(_kek(new, nu["salt"]), dek)
            save_vault(v)
    audit("user.reset", detail='admin reset password for "%s"' % u["name"])
    return jsonify({"ok": True})


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id():
    return uuid.uuid4().hex


def case_dir(case_id):
    """Resolve a case folder, guarding against path traversal."""
    if not ID_RE.match(case_id or ""):
        abort(400, "invalid case id")
    path = os.path.join(CASES_DIR, case_id)
    if not os.path.isdir(path):
        abort(404, "case not found")
    return path


def evidence_dir(case_id):
    d = os.path.join(case_dir(case_id), "evidence")
    os.makedirs(d, exist_ok=True)
    return d


def _load_case_file(path):
    """Read a case.json (decrypting if needed). Returns dict or None if locked."""
    with open(path, "rb") as fh:
        blob = fh.read()
    if is_enc(blob):
        dek = get_dek()
        if not dek:
            return None
        blob = _dec(dek, blob)
    return json.loads(blob.decode("utf-8"))


def _persist(path, data):
    raw = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
    if encryption_enabled():
        dek = get_dek()
        if not dek:
            abort(401, "vault locked — sign in again")
        raw = _enc(dek, raw)
    tmp = path + ".tmp"
    with open(tmp, "wb") as fh:
        fh.write(raw)
    os.replace(tmp, path)


def read_case(case_id):
    path = os.path.join(case_dir(case_id), "case.json")
    if not os.path.isfile(path):
        abort(404, "case data missing")
    data = _load_case_file(path)
    if data is None:
        abort(401, "vault locked — sign in again")
    return data


def write_case(case_id, data):
    path = os.path.join(case_dir(case_id), "case.json")
    cur = 0
    if os.path.isfile(path):
        try:
            prev = _load_case_file(path)
            cur = (prev or {}).get("rev", 0)
        except (json.JSONDecodeError, OSError):
            cur = 0
    data["rev"] = int(cur or 0) + 1
    data["modified"] = now_iso()
    _persist(path, data)
    return data


def blank_case(name):
    ts = now_iso()
    return {
        "schema": 1,
        "rev": 0,
        "name": name,
        "created": ts,
        "modified": ts,
        "nodes": [],
        "edges": [],
        "events": [],
        "evidence": [],
        "view": {"x": 0, "y": 0, "scale": 1},
    }


# ---------------------------------------------------------------- static files


@app.route("/")
def index():
    return send_from_directory(STATIC_DIR, "index.html")


@app.route("/static/<path:relpath>")
def static_files(relpath):
    return send_from_directory(STATIC_DIR, relpath)


# ----------------------------------------------------------------------- cases


@app.route("/api/cases", methods=["GET"])
def list_cases():
    out = []
    for cid in os.listdir(CASES_DIR):
        cpath = os.path.join(CASES_DIR, cid, "case.json")
        if not ID_RE.match(cid) or not os.path.isfile(cpath):
            continue
        try:
            data = _load_case_file(cpath)
        except (json.JSONDecodeError, OSError):
            continue
        if data is None:      # vault locked
            continue
        nodes = data.get("nodes")
        if nodes is None:
            maps = data.get("maps") or {}
            inv = maps.get("investigation") or {}
            nodes = inv.get("nodes", [])
        if not case_access(data):      # analysts only see owned/assigned cases
            continue
        meta = data.get("meta", {}) or {}
        out.append(
            {
                "id": cid,
                "name": data.get("name", "(untitled)"),
                "created": data.get("created"),
                "modified": data.get("modified"),
                "nodeCount": len(nodes or []),
                "eventCount": len(data.get("events", [])),
                "evidenceCount": len(data.get("evidence", [])),
                "caseNumber": meta.get("caseNumber", ""),
                "analyst": meta.get("analyst", ""),
                "classification": meta.get("classification", ""),
                "owner": data.get("owner", ""),
                "assignees": data.get("assignees", []),
                "canDelete": is_admin() or session.get("user") == data.get("owner"),
            }
        )
    out.sort(key=lambda c: c.get("modified") or "", reverse=True)
    return jsonify(out)


@app.route("/api/cases", methods=["POST"])
def create_case():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "Untitled incident").strip()[:200]
    cid = new_id()
    os.makedirs(os.path.join(CASES_DIR, cid, "evidence"), exist_ok=True)
    data = blank_case(name)
    data["owner"] = current_user()
    data["assignees"] = []
    _persist(os.path.join(CASES_DIR, cid, "case.json"), data)   # encrypts if enabled
    audit("case.create", cid, name, "case created")
    return jsonify({"id": cid, "case": data}), 201


@app.route("/api/cases/<case_id>", methods=["GET"])
def get_case(case_id):
    return jsonify(guard_case(case_id))


@app.route("/api/cases/<case_id>", methods=["PUT", "POST"])
def save_case(case_id):
    case_dir(case_id)  # validate exists
    body = request.get_json(silent=True)
    if not isinstance(body, dict):
        abort(400, "expected case json")
    existing = read_case(case_id)
    if not case_access(existing):
        abort(403, "you don't have access to this case")
    # ownership/assignees are managed via /access, never via the case body
    body.pop("owner", None)
    body.pop("assignees", None)
    body["owner"] = existing.get("owner")
    body["assignees"] = existing.get("assignees", [])
    # optimistic concurrency: reject if the case changed since the client loaded it
    base = request.args.get("baseRev")
    force = request.args.get("force") == "1"
    if base is not None and not force:
        try:
            base_i = int(base)
        except ValueError:
            base_i = None
        if base_i is not None and base_i != int(existing.get("rev", 0)):
            return jsonify({"error": "conflict", "serverRev": existing.get("rev", 0)}), 409
    # Preserve server-managed fields / evidence index integrity
    body.setdefault("schema", 1)
    body.setdefault("created", existing.get("created", now_iso()))
    # Never let the client rewrite the evidence index into something that
    # points at files that don't exist; keep records whose files are present.
    body["evidence"] = existing.get("evidence", []) if "evidence" not in body else body["evidence"]

    # audit: structural changes logged with a diff; field-only edits throttled
    old, new = _case_summary(existing), _case_summary(body)
    if old != new:
        detail = _diff_detail(old, new)
        if detail:
            audit("case.edit", case_id, body.get("name"), detail)
    else:
        key = (current_user(), case_id)
        now = time.time()
        if now - _last_edit.get(key, 0) > 300:   # at most once / 5 min
            _last_edit[key] = now
            audit("case.edit", case_id, body.get("name"), "edited fields / notes")

    saved = write_case(case_id, body)
    return jsonify(saved)


@app.route("/api/cases/<case_id>", methods=["DELETE"])
def delete_case(case_id):
    data = read_case(case_id)
    if not (is_admin() or session.get("user") == data.get("owner")):
        abort(403, "only the owner or an admin can delete this case")
    shutil.rmtree(case_dir(case_id))
    audit("case.delete", case_id, data.get("name"), "case deleted")
    return jsonify({"ok": True})


@app.route("/api/cases/<case_id>/access", methods=["PUT"])
def set_case_access(case_id):
    data = read_case(case_id)
    if not (is_admin() or session.get("user") == data.get("owner")):
        abort(403, "only the owner or an admin can change access")
    body = request.get_json(silent=True) or {}
    users = {u["name"] for u in load_auth()["users"]}
    if "owner" in body and body["owner"] in users:
        data["owner"] = body["owner"]
    if "assignees" in body and isinstance(body["assignees"], list):
        data["assignees"] = [n for n in body["assignees"] if n in users and n != data.get("owner")]
    write_case(case_id, data)
    audit("case.access", case_id, data.get("name"),
          "owner=%s; assignees=%s" % (data.get("owner"), ", ".join(data.get("assignees", [])) or "none"))
    return jsonify({"owner": data.get("owner"), "assignees": data.get("assignees", [])})


# -------------------------------------------------------------------- evidence


@app.route("/api/cases/<case_id>/evidence", methods=["POST"])
def upload_evidence(case_id):
    data = guard_case(case_id)
    if "file" not in request.files:
        abort(400, "no file field")
    f = request.files["file"]
    if not f or f.filename == "":
        abort(400, "empty filename")

    original = f.filename
    safe = secure_filename(original) or "file"
    ext = os.path.splitext(safe)[1][:16]
    evid = new_id()
    stored = evid + ext
    dest = os.path.join(evidence_dir(case_id), stored)

    f.save(dest)

    sha = hashlib.sha256()
    size = 0
    with open(dest, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            sha.update(chunk)
            size += len(chunk)

    # encrypt the stored file at rest (hash/size are of the original plaintext)
    if encryption_enabled():
        dek = get_dek()
        if dek:
            with open(dest, "rb") as fh:
                plain = fh.read()
            with open(dest, "wb") as fh:
                fh.write(_enc(dek, plain))

    record = {
        "id": evid,
        "stored": stored,
        "filename": original[:260],
        "size": size,
        "sha256": sha.hexdigest(),
        "uploaded": now_iso(),
    }
    data.setdefault("evidence", []).append(record)
    write_case(case_id, data)
    audit("evidence.add", case_id, data.get("name"),
          '%s (sha256:%s…)' % (record["filename"], record["sha256"][:12]))
    return jsonify({"record": record, "rev": data["rev"]}), 201


@app.route("/api/cases/<case_id>/evidence/<evid>", methods=["GET"])
def get_evidence(case_id, evid):
    data = guard_case(case_id)
    rec = next((e for e in data.get("evidence", []) if e.get("id") == evid), None)
    if not rec:
        abort(404, "evidence not found")
    fpath = os.path.join(evidence_dir(case_id), rec["stored"])
    if not os.path.isfile(fpath):
        abort(404, "evidence file missing")
    download = request.args.get("download") == "1"
    with open(fpath, "rb") as fh:
        blob = fh.read()
    if is_enc(blob):
        dek = get_dek()
        if not dek:
            abort(401, "vault locked")
        blob = _dec(dek, blob)
    mt = mimetypes.guess_type(rec.get("filename") or "")[0] or "application/octet-stream"
    return send_file(io.BytesIO(blob), mimetype=mt,
                     as_attachment=download, download_name=rec.get("filename"))


@app.route("/api/cases/<case_id>/evidence/<evid>", methods=["DELETE"])
def delete_evidence(case_id, evid):
    data = guard_case(case_id)
    rec = next((e for e in data.get("evidence", []) if e.get("id") == evid), None)
    if not rec:
        abort(404, "evidence not found")
    fpath = os.path.join(evidence_dir(case_id), rec["stored"])
    if os.path.isfile(fpath):
        os.remove(fpath)
    data["evidence"] = [e for e in data["evidence"] if e.get("id") != evid]
    # detach from any nodes that referenced it (across all maps + legacy top-level)
    node_lists = [data.get("nodes", [])]
    for mp in (data.get("maps") or {}).values():
        node_lists.append(mp.get("nodes", []))
    for nl in node_lists:
        for n in nl:
            if "evidence" in n:
                n["evidence"] = [x for x in n["evidence"] if x != evid]
    write_case(case_id, data)
    audit("evidence.delete", case_id, data.get("name"), rec.get("filename", ""))
    return jsonify({"ok": True, "rev": data["rev"]})


# ------------------------------------------------------------- export / import


SNAP_RE = re.compile(r"^snap_[0-9A-Za-z]+\.json$")


def snapshots_dir(case_id):
    d = os.path.join(case_dir(case_id), "snapshots")
    os.makedirs(d, exist_ok=True)
    return d


def _snap_index(sdir):
    path = os.path.join(sdir, "index.json")
    if os.path.isfile(path):
        try:
            with open(path, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except (json.JSONDecodeError, OSError):
            return []
    return []


def _write_snap_index(sdir, idx):
    with open(os.path.join(sdir, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(idx, fh, indent=2)


def _make_snapshot(case_id, label):
    sdir = snapshots_dir(case_id)
    src = os.path.join(case_dir(case_id), "case.json")
    if not os.path.isfile(src):
        abort(404, "case data missing")
    ts = now_iso()
    fname = "snap_" + re.sub(r"[^0-9]", "", ts)[:14] + new_id()[:6] + ".json"
    shutil.copyfile(src, os.path.join(sdir, fname))
    idx = _snap_index(sdir)
    rec = {"file": fname, "label": (label or "").strip()[:120], "created": ts,
           "size": os.path.getsize(os.path.join(sdir, fname))}
    idx.append(rec)
    _write_snap_index(sdir, idx)
    return rec


@app.route("/api/cases/<case_id>/snapshots", methods=["GET"])
def list_snapshots(case_id):
    guard_case(case_id)
    sdir = snapshots_dir(case_id)
    idx = sorted(_snap_index(sdir), key=lambda r: r.get("created") or "", reverse=True)
    return jsonify(idx)


@app.route("/api/cases/<case_id>/snapshots", methods=["POST"])
def create_snapshot(case_id):
    guard_case(case_id)
    body = request.get_json(silent=True) or {}
    rec = _make_snapshot(case_id, body.get("label", ""))
    try:
        audit("snapshot.create", case_id, read_case(case_id).get("name"), rec.get("label") or "snapshot")
    except Exception:
        pass
    return jsonify(rec), 201


@app.route("/api/cases/<case_id>/snapshots/<fname>/restore", methods=["POST"])
def restore_snapshot(case_id, fname):
    guard_case(case_id)
    if not SNAP_RE.match(fname or ""):
        abort(400, "invalid snapshot")
    sdir = snapshots_dir(case_id)
    snap = os.path.join(sdir, fname)
    if not os.path.isfile(snap):
        abort(404, "snapshot not found")
    _make_snapshot(case_id, "auto-backup before restore")   # safety
    shutil.copyfile(snap, os.path.join(case_dir(case_id), "case.json"))
    restored = read_case(case_id)
    audit("snapshot.restore", case_id, restored.get("name"), fname)
    return jsonify(restored)


@app.route("/api/cases/<case_id>/snapshots/<fname>", methods=["DELETE"])
def delete_snapshot(case_id, fname):
    guard_case(case_id)
    if not SNAP_RE.match(fname or ""):
        abort(400, "invalid snapshot")
    sdir = snapshots_dir(case_id)
    fpath = os.path.join(sdir, fname)
    if os.path.isfile(fpath):
        os.remove(fpath)
    _write_snap_index(sdir, [r for r in _snap_index(sdir) if r.get("file") != fname])
    return jsonify({"ok": True})


@app.route("/api/cases/<case_id>/export", methods=["GET"])
def export_case(case_id):
    data = guard_case(case_id)
    path = case_dir(case_id)
    dek = get_dek()
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as zf:
        for root, _dirs, files in os.walk(path):
            for fn in files:
                if fn.endswith(".tmp"):
                    continue
                full = os.path.join(root, fn)
                arc = os.path.relpath(full, path)
                with open(full, "rb") as fh:
                    blob = fh.read()
                if is_enc(blob) and dek:        # export decrypted, so the zip is portable
                    try:
                        blob = _dec(dek, blob)
                    except Exception:
                        pass
                zf.writestr(arc, blob)
    mem.seek(0)
    safe_name = re.sub(r"[^\w.-]+", "_", data.get("name", "case"))[:80] or "case"
    return send_file(
        mem,
        mimetype="application/zip",
        as_attachment=True,
        download_name=f"dossier_{safe_name}.zip",
    )


@app.route("/api/cases/import", methods=["POST"])
def import_case():
    if "file" not in request.files:
        abort(400, "no file field")
    f = request.files["file"]
    try:
        raw = io.BytesIO(f.read())
        zf = zipfile.ZipFile(raw)
    except zipfile.BadZipFile:
        abort(400, "not a valid zip")

    # Locate case.json inside the archive (allow an optional top folder)
    names = zf.namelist()
    case_member = next((n for n in names if n.rstrip("/").endswith("case.json")), None)
    if not case_member:
        abort(400, "archive has no case.json")
    prefix = case_member[: -len("case.json")]

    try:
        data = json.loads(zf.read(case_member).decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        abort(400, "case.json is not valid JSON")

    cid = new_id()
    dest = os.path.join(CASES_DIR, cid)
    ev_dir = os.path.join(dest, "evidence")
    os.makedirs(ev_dir, exist_ok=True)

    # Extract evidence files safely (no path traversal, flat into evidence/)
    for n in names:
        if n.endswith("/"):
            continue
        rel = n[len(prefix):] if n.startswith(prefix) else n
        if not rel.startswith("evidence/"):
            continue
        base = os.path.basename(rel)
        if not base:
            continue
        with zf.open(n) as src, open(os.path.join(ev_dir, base), "wb") as out:
            shutil.copyfileobj(src, out)

    data["name"] = (data.get("name") or "Imported case") + ""
    data["owner"] = current_user()
    data.setdefault("assignees", [])
    _persist(os.path.join(dest, "case.json"), data)     # encrypts if enabled
    # encrypt imported evidence files at rest
    if encryption_enabled():
        dek = get_dek()
        if dek:
            for fn in os.listdir(ev_dir):
                fp = os.path.join(ev_dir, fn)
                try:
                    with open(fp, "rb") as fh:
                        b = fh.read()
                    if not is_enc(b):
                        with open(fp, "wb") as fh:
                            fh.write(_enc(dek, b))
                except OSError:
                    pass
    audit("case.import", cid, data["name"], "imported from zip")
    return jsonify({"id": cid, "case": data}), 201


@app.errorhandler(400)
@app.errorhandler(401)
@app.errorhandler(403)
@app.errorhandler(404)
def _err(e):
    return jsonify({"error": getattr(e, "description", str(e))}), e.code


if __name__ == "__main__":
    print("Dossier running at http://127.0.0.1:6854  (data in ./cases)")
    app.run(host="127.0.0.1", port=6854, debug=False)
