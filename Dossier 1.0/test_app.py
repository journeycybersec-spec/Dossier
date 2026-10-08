"""Dossier API test suite.

Runs the Flask app against an isolated temp data dir (DOSSIER_DATA) so it never
touches a real install.  Run:  pytest -q
"""
import io
import importlib
import json
import sys

import pytest


def load_app(tmp_path, monkeypatch):
    """Import a fresh copy of app.py pointed at an isolated data dir."""
    monkeypatch.setenv("DOSSIER_DATA", str(tmp_path))
    sys.modules.pop("app", None)
    mod = importlib.import_module("app")
    mod.app.config.update(TESTING=True)
    return mod


@pytest.fixture
def env(tmp_path, monkeypatch):
    mod = load_app(tmp_path, monkeypatch)
    return mod, tmp_path


def setup_admin(client, name="Admin", pw="adminpw"):
    return client.post("/api/auth/setup", json={"name": name, "password": pw})


def login(client, name, pw):
    return client.post("/api/auth/login", json={"name": name, "password": pw})


# ------------------------------------------------------------------ auth
def test_setup_and_status(env):
    mod, _ = env
    c = mod.app.test_client()
    r = setup_admin(c)
    assert r.status_code == 200 and r.get_json()["role"] == "admin"
    st = c.get("/api/auth/status").get_json()
    assert st["authenticated"] and st["role"] == "admin" and st["configured"]


def test_auth_required(env):
    mod, _ = env
    setup_admin(mod.app.test_client())        # configured, but...
    anon = mod.app.test_client()              # ...a fresh client is not logged in
    assert anon.get("/api/cases").status_code == 401


def test_login_lockout(env):
    mod, _ = env
    setup_admin(mod.app.test_client())
    c = mod.app.test_client()
    codes = [c.post("/api/auth/login", json={"name": "Admin", "password": "wrong"}).status_code
             for _ in range(5)]
    assert codes[:4] == [401, 401, 401, 401]
    assert codes[4] == 429
    # correct password is still locked out
    assert login(c, "Admin", "adminpw").status_code == 429


# ------------------------------------------------------------------ cases
def test_case_crud_and_rev(env):
    mod, _ = env
    c = mod.app.test_client()
    setup_admin(c)
    cid = c.post("/api/cases", json={"name": "Case A"}).get_json()["id"]
    case = c.get(f"/api/cases/{cid}").get_json()
    rev0 = case.get("rev", 0)
    body = dict(case, name="Case A2")
    saved = c.put(f"/api/cases/{cid}?baseRev={rev0}", json=body).get_json()
    assert saved["rev"] == rev0 + 1 and saved["name"] == "Case A2"
    assert c.delete(f"/api/cases/{cid}").status_code == 200
    assert c.get(f"/api/cases/{cid}").status_code == 404


def test_conflict_detection(env):
    mod, _ = env
    c = mod.app.test_client()
    setup_admin(c)
    cid = c.post("/api/cases", json={"name": "Conf"}).get_json()["id"]
    case = c.get(f"/api/cases/{cid}").get_json()
    rev = case.get("rev", 0)
    assert c.put(f"/api/cases/{cid}?baseRev={rev}", json=case).status_code == 200  # rev -> rev+1
    stale = c.put(f"/api/cases/{cid}?baseRev={rev}", json=case)                    # same (stale) base
    assert stale.status_code == 409 and "serverRev" in stale.get_json()
    assert c.put(f"/api/cases/{cid}?baseRev={rev}&force=1", json=case).status_code == 200


# ------------------------------------------------------------------ roles / access
def test_roles_and_access(env):
    mod, _ = env
    admin = mod.app.test_client()
    setup_admin(admin)
    assert admin.post("/api/users", json={"name": "Ana", "password": "anapw", "role": "analyst"}).status_code == 201

    ana = mod.app.test_client()
    assert login(ana, "Ana", "anapw").get_json()["role"] == "analyst"
    assert ana.post("/api/users", json={"name": "X", "password": "xxxx"}).status_code == 403  # analyst can't

    admin_case = admin.post("/api/cases", json={"name": "AdminCase"}).get_json()["id"]
    ana_case = ana.post("/api/cases", json={"name": "AnaCase"}).get_json()["id"]

    ana_names = [x["name"] for x in ana.get("/api/cases").get_json()]
    assert ana_names == ["AnaCase"]                      # analyst sees only own
    assert admin.get(f"/api/cases/{ana_case}").status_code == 200   # admin sees all
    assert ana.get(f"/api/cases/{admin_case}").status_code == 403   # analyst blocked
    assert ana.delete(f"/api/cases/{admin_case}").status_code == 403

    # assign Ana → access granted
    admin.put(f"/api/cases/{admin_case}/access", json={"assignees": ["Ana"]})
    assert ana.get(f"/api/cases/{admin_case}").status_code == 200


# ------------------------------------------------------------------ encryption
def test_encryption_roundtrip(env):
    mod, tmp = env
    c = mod.app.test_client()
    setup_admin(c)
    assert c.get("/api/auth/status").get_json()["encrypted"] is True
    cid = c.post("/api/cases", json={"name": "Enc"}).get_json()["id"]
    # on-disk file is ciphertext
    raw = (tmp / "cases" / cid / "case.json").read_bytes()
    assert raw.startswith(b"TMENC1")
    # but the API decrypts it
    assert c.get(f"/api/cases/{cid}").get_json()["name"] == "Enc"

    # evidence encrypted at rest, served as original
    up = c.post(f"/api/cases/{cid}/evidence",
                data={"file": (io.BytesIO(b"secret-bytes"), "e.txt")},
                content_type="multipart/form-data").get_json()
    stored = up["record"]["stored"]
    assert (tmp / "cases" / cid / "evidence" / stored).read_bytes().startswith(b"TMENC1")
    got = c.get(f"/api/cases/{cid}/evidence/{up['record']['id']}")
    assert got.data == b"secret-bytes"


def test_vault_locks_after_restart(env, tmp_path, monkeypatch):
    mod, tmp = env
    c = mod.app.test_client()
    setup_admin(c)
    cid = c.post("/api/cases", json={"name": "Enc"}).get_json()["id"]
    # simulate restart: reload module (clears in-memory DEK) keeping same data dir
    monkeypatch.setenv("DOSSIER_DATA", str(tmp))
    sys.modules.pop("app", None)
    mod2 = importlib.import_module("app")
    c2 = mod2.app.test_client()
    login(c2, "Admin", "adminpw")                 # re-derives DEK
    assert c2.get(f"/api/cases/{cid}").get_json()["name"] == "Enc"


# ------------------------------------------------------------------ audit chain
def test_audit_chain_and_tamper(env):
    mod, tmp = env
    c = mod.app.test_client()
    setup_admin(c)
    c.post("/api/cases", json={"name": "A"})
    c.post("/api/cases", json={"name": "B"})
    assert c.get("/api/audit/verify").get_json()["ok"] is True
    # tamper a line on disk
    af = tmp / "audit.jsonl"
    lines = af.read_text().splitlines()
    rec = json.loads(lines[0]); rec["detail"] = "HACKED"; lines[0] = json.dumps(rec)
    af.write_text("\n".join(lines) + "\n")
    assert c.get("/api/audit/verify").get_json()["ok"] is False


# ------------------------------------------------------------------ passwords
def test_change_and_admin_reset_password(env):
    mod, _ = env
    admin = mod.app.test_client()
    setup_admin(admin)
    admin.post("/api/users", json={"name": "Ana", "password": "anapw", "role": "analyst"})

    ana = mod.app.test_client()
    login(ana, "Ana", "anapw")
    assert ana.post("/api/users/password", json={"current": "anapw", "new": "ananew"}).status_code == 200
    # re-login with new password + decrypt works
    ana2 = mod.app.test_client()
    assert login(ana2, "Ana", "ananew").status_code == 200
    assert ana2.get("/api/cases").status_code == 200

    # admin resets Ana, Ana logs in with the reset password
    assert admin.put("/api/users/Ana/password", json={"new": "byadmin"}).status_code == 200
    ana3 = mod.app.test_client()
    assert login(ana3, "Ana", "byadmin").status_code == 200
    assert ana3.get("/api/cases").status_code == 200
    # analyst cannot reset others
    assert ana3.put("/api/users/Admin/password", json={"new": "z"}).status_code == 403


# ------------------------------------------------------------------ snapshots
def test_snapshots(env):
    mod, _ = env
    c = mod.app.test_client()
    setup_admin(c)
    cid = c.post("/api/cases", json={"name": "Snap"}).get_json()["id"]
    case = c.get(f"/api/cases/{cid}").get_json()
    c.post(f"/api/cases/{cid}?baseRev={case.get('rev', 0)}", json=dict(case, name="v1"))
    snap = c.post(f"/api/cases/{cid}/snapshots", json={"label": "cp"}).get_json()
    cur = c.get(f"/api/cases/{cid}").get_json()
    c.post(f"/api/cases/{cid}?baseRev={cur.get('rev', 0)}", json=dict(cur, name="v2"))
    restored = c.post(f"/api/cases/{cid}/snapshots/{snap['file']}/restore").get_json()
    assert restored["name"] == "v1"
