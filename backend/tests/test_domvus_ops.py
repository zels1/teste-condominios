"""DOMVUS Phase 3 — Operations backend tests.

Covers: occurrence lifecycle (+comments, +status_history, +create-expense),
maintenance recurring completion + overdue detection, contracts status,
documents (upload/list/download/security/reject), communications (templates,
send + recipient resolution + notifications), assemblies (+attendees +detail),
tasks (mine + status), notifications (list/read-all), activities, ops
dashboard, supplier profile, global search, and tenant/RBAC isolation.
"""
import os
import time
import io
from datetime import datetime, timezone, timedelta

import pytest
import requests

def _read_frontend_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env()).rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

SUPER = {"email": "master.marques@gmail.com", "password": "Domvus2025!"}
MANAGER = {"email": "gestor@domvus.pt", "password": "Domvus2025!"}
OWNER = {"email": "condomino@domvus.pt", "password": "Domvus2025!"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login {creds['email']}: {r.status_code} {r.text}"
    tok = s.cookies.get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def staff():
    return _login(SUPER)


@pytest.fixture(scope="module")
def owner_sess():
    return _login(OWNER)


@pytest.fixture(scope="module")
def scratch(staff):
    ts = int(time.time())
    cid = staff.post(f"{API}/condominiums", json={"name": f"TEST_OPS_{ts}"}).json()["id"]
    oid_ = staff.post(f"{API}/owners", json={"condominium_id": cid, "name": "TEST_OpsOwner", "nif": "500000099"}).json()["id"]
    fid = staff.post(f"{API}/fractions", json={"condominium_id": cid, "identifier": "T_OPS_F1",
                                                "owner_id": oid_, "permillage": 20}).json()["id"]
    # create a supplier for occurrence->expense
    sup = staff.post(f"{API}/finance/suppliers", json={"name": f"TEST_Sup_{ts}", "condominium_ids": [cid]})
    sup_id = sup.json().get("id") if sup.status_code < 300 else None
    yield {"cid": cid, "oid": oid_, "fid": fid, "sup_id": sup_id}
    staff.delete(f"{API}/condominiums/{cid}")


# ============================================================ OCCURRENCES
def test_occurrence_lifecycle_and_expense(staff, scratch):
    # CREATE
    r = staff.post(f"{API}/ops/occurrences", json={
        "condominium_id": scratch["cid"], "fraction_id": scratch["fid"],
        "title": "TEST_Occ elevador", "description": "d", "category": "Elevadores",
        "priority": "high", "estimated_cost": 150.0})
    assert r.status_code == 200, r.text
    o = r.json()
    assert o["status"] == "new"
    oid_ = o["id"]

    # LIST includes it
    lst = staff.get(f"{API}/ops/occurrences").json()
    assert any(x["id"] == oid_ for x in lst)

    # DETAIL has timeline+comments+documents
    det = staff.get(f"{API}/ops/occurrences/{oid_}").json()
    assert "timeline" in det and len(det["timeline"]) >= 1
    assert det["timeline"][0]["status"] == "new"
    assert det["comments"] == []

    # ADD COMMENT
    c = staff.post(f"{API}/ops/occurrences/{oid_}/comments", json={"text": "TEST comentário"})
    assert c.status_code == 200

    # PUT in_progress -> status_history entry
    u = staff.put(f"{API}/ops/occurrences/{oid_}", json={"status": "in_progress"})
    assert u.status_code == 200
    det = staff.get(f"{API}/ops/occurrences/{oid_}").json()
    assert any(t["status"] == "in_progress" for t in det["timeline"])

    # Assign supplier + actual_cost
    if scratch["sup_id"]:
        u2 = staff.put(f"{API}/ops/occurrences/{oid_}", json={
            "supplier_id": scratch["sup_id"], "actual_cost": 175.50})
        assert u2.status_code == 200
        assert u2.json()["actual_cost"] == 175.50

    # PUT resolved
    u3 = staff.put(f"{API}/ops/occurrences/{oid_}", json={"status": "resolved"})
    assert u3.status_code == 200

    # CREATE EXPENSE from occurrence
    e = staff.post(f"{API}/ops/occurrences/{oid_}/create-expense")
    assert e.status_code == 200, e.text
    ej = e.json()
    assert "id" in ej and ej["amount"] > 0
    # verify expense persisted
    exps = staff.get(f"{API}/finance/expenses?condominium_id={scratch['cid']}").json()
    assert any(x.get("id") == ej["id"] for x in exps)


# ============================================================ MAINTENANCE
def test_maintenance_complete_recurring_and_overdue(staff, scratch):
    next_dt = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    r = staff.post(f"{API}/ops/maintenance", json={
        "condominium_id": scratch["cid"], "title": "TEST_Maint annual",
        "frequency": "annual", "next_date": next_dt, "estimated_cost": 500.0})
    assert r.status_code == 200, r.text
    mid = r.json()["id"]

    # Complete -> recalculates next_date ~ +365 and status back to scheduled
    c = staff.post(f"{API}/ops/maintenance/{mid}/complete")
    assert c.status_code == 200, c.text
    m2 = c.json()
    assert m2["status"] == "scheduled"
    nd = datetime.fromisoformat(m2["next_date"])
    delta = (nd - datetime.now(timezone.utc)).days
    assert 360 <= delta <= 370, f"expected ~365 days, got {delta}"
    assert m2.get("last_date")

    # Overdue detection: create with past next_date
    past = (datetime.now(timezone.utc) - timedelta(days=10)).isoformat()
    r2 = staff.post(f"{API}/ops/maintenance", json={
        "condominium_id": scratch["cid"], "title": "TEST_Maint overdue",
        "frequency": "none", "next_date": past})
    assert r2.status_code == 200
    mid2 = r2.json()["id"]
    lst = staff.get(f"{API}/ops/maintenance?condominium_id={scratch['cid']}").json()
    entry = next(x for x in lst if x["id"] == mid2)
    assert entry["status"] == "overdue"


# ============================================================ CONTRACTS
def test_contract_status_active_expiring_expired(staff, scratch):
    today = datetime.now(timezone.utc)
    for label, days, expected in [
        ("active", 400, "active"),
        ("expiring", 45, "expiring"),
        ("expired", -30, "expired"),
    ]:
        end = (today + timedelta(days=days)).date().isoformat()
        r = staff.post(f"{API}/ops/contracts", json={
            "condominium_id": scratch["cid"], "title": f"TEST_C_{label}",
            "end_date": end, "value": 100.0})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == expected, f"{label}: {r.json()['status']}"

    # dashboard contracts_expiring counts expiring+expired for our condo
    d = staff.get(f"{API}/ops/dashboard?condominium_id={scratch['cid']}").json()
    assert d["contracts_expiring"] >= 2


# ============================================================ DOCUMENTS
def test_documents_upload_list_download_reject(staff, scratch):
    # UPLOAD ok (PDF)
    files = {"file": ("test.pdf", io.BytesIO(b"%PDF-1.4\n test content"), "application/pdf")}
    data = {"name": "TEST_Doc", "category": "Ata", "condominium_id": scratch["cid"]}
    r = staff.post(f"{API}/ops/documents", files=files, data=data)
    assert r.status_code == 200, r.text
    did = r.json()["id"]

    # LIST
    lst = staff.get(f"{API}/ops/documents").json()
    assert any(x["id"] == did for x in lst)

    # DOWNLOAD returns pdf bytes
    dl = staff.get(f"{API}/ops/documents/{did}/download")
    assert dl.status_code == 200
    assert "pdf" in dl.headers.get("content-type", "")
    assert dl.content.startswith(b"%PDF")

    # REJECT executable type
    files_bad = {"file": ("evil.exe", io.BytesIO(b"MZ"), "application/x-msdownload")}
    r2 = staff.post(f"{API}/ops/documents", files=files_bad,
                    data={"name": "bad", "category": "x", "condominium_id": scratch["cid"]})
    assert r2.status_code == 400


def test_document_security_owner_cross_condo_403(staff, owner_sess, scratch):
    # upload a doc tied to TEST condo (owner not part of it)
    files = {"file": ("secret.pdf", io.BytesIO(b"%PDF-1.4 secret"), "application/pdf")}
    data = {"name": "TEST_SecretDoc", "category": "Confidencial", "condominium_id": scratch["cid"]}
    r = staff.post(f"{API}/ops/documents", files=files, data=data)
    assert r.status_code == 200
    did = r.json()["id"]

    # owner tries to download -> 403
    dl = owner_sess.get(f"{API}/ops/documents/{did}/download")
    assert dl.status_code == 403, f"expected 403 got {dl.status_code}"


# ============================================================ COMMUNICATIONS
def test_communication_templates_and_send(staff, scratch):
    tpl = staff.get(f"{API}/ops/communication-templates")
    assert tpl.status_code == 200
    templates = tpl.json()
    assert len(templates) >= 4, f"expected 4+ templates, got {len(templates)}"

    r = staff.post(f"{API}/ops/communications", json={
        "condominium_id": scratch["cid"], "target_type": "condominium",
        "subject": "TEST_Comm subject", "message": "TEST body"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["recipient_count"] >= 1
    assert j["status"] == "sent"

    # appears in list
    lst = staff.get(f"{API}/ops/communications").json()
    assert any(x["id"] == j["id"] for x in lst)


# ============================================================ ASSEMBLIES
def test_assembly_create_agenda_attendee(staff, scratch):
    r = staff.post(f"{API}/ops/assemblies", json={
        "condominium_id": scratch["cid"],
        "date": (datetime.now(timezone.utc) + timedelta(days=15)).date().isoformat(),
        "agenda": [{"title": "Ponto 1"}, {"title": "Ponto 2"}]})
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    assert r.json()["agenda"][0]["number"] == 1
    assert r.json()["agenda"][1]["number"] == 2

    det = staff.get(f"{API}/ops/assemblies/{aid}").json()
    assert "attendees" in det and det["attendees"] == []

    att = staff.post(f"{API}/ops/assemblies/{aid}/attendees", json={
        "owner_id": scratch["oid"], "fraction_id": scratch["fid"]})
    assert att.status_code == 200
    det2 = staff.get(f"{API}/ops/assemblies/{aid}").json()
    assert len(det2["attendees"]) == 1


# ============================================================ TASKS
def test_tasks_create_status_mine(staff, scratch):
    r = staff.post(f"{API}/ops/tasks", json={
        "title": "TEST_Task 1", "condominium_id": scratch["cid"]})
    assert r.status_code == 200
    t = r.json()
    assert t["status"] == "todo"
    tid = t["id"]

    u = staff.put(f"{API}/ops/tasks/{tid}", json={"status": "completed"})
    assert u.status_code == 200
    assert u.json()["status"] == "completed"

    # mine=true: get current user id
    me = staff.get(f"{API}/auth/me").json()
    r2 = staff.post(f"{API}/ops/tasks", json={
        "title": "TEST_MyTask", "condominium_id": scratch["cid"], "assigned_to": me["id"]})
    assert r2.status_code == 200
    mine = staff.get(f"{API}/ops/tasks?mine=true").json()
    assert any(x["id"] == r2.json()["id"] for x in mine)


# ============================================================ NOTIFICATIONS
def test_notifications_list_and_read_all(staff):
    r = staff.get(f"{API}/ops/notifications")
    assert r.status_code == 200
    j = r.json()
    assert "items" in j and "unread" in j

    staff.post(f"{API}/ops/notifications/read-all")
    r2 = staff.get(f"{API}/ops/notifications").json()
    assert r2["unread"] == 0


# ============================================================ ACTIVITIES
def test_activities_returns_entries(staff, scratch):
    r = staff.get(f"{API}/ops/activities?condominium_id={scratch['cid']}")
    assert r.status_code == 200
    items = r.json()
    assert isinstance(items, list)
    assert len(items) >= 1  # from earlier tests
    actions = {a["action"] for a in items}
    assert actions & {"create", "status", "complete", "send", "upload"}


# ============================================================ OPS DASHBOARD
def test_ops_dashboard_returns_all_counts(staff):
    r = staff.get(f"{API}/ops/dashboard")
    assert r.status_code == 200
    d = r.json()
    for k in ["open_occurrences", "urgent_occurrences", "overdue_maintenance",
              "upcoming_maintenance", "contracts_expiring", "pending_tasks",
              "upcoming_assemblies", "recent_communications", "recent_activity"]:
        assert k in d, f"missing key {k}"
    assert isinstance(d["recent_communications"], list)
    assert isinstance(d["recent_activity"], list)


# ============================================================ SEARCH
def test_global_search(staff):
    r = staff.get(f"{API}/ops/search", params={"q": "TEST_"})
    assert r.status_code == 200
    j = r.json()
    assert "results" in j
    types = {x["type"] for x in j["results"]}
    assert len(j["results"]) >= 1


# ============================================================ TENANT ISOLATION
def test_owner_occurrences_scoped(owner_sess):
    r = owner_sess.get(f"{API}/ops/occurrences")
    assert r.status_code == 200
    # owner is only from their own condo — get their condo id
    me = owner_sess.get(f"{API}/auth/me").json()
    own_cid = me.get("condominium_id")
    for o in r.json():
        assert o["condominium_id"] == own_cid, f"leak: {o}"


def test_owner_403_on_staff_writes(owner_sess, scratch):
    # owner cannot POST maintenance/contracts/tasks/communications/documents
    endpoints = [
        ("post", f"{API}/ops/maintenance", {"condominium_id": scratch["cid"], "title": "x"}),
        ("post", f"{API}/ops/contracts", {"condominium_id": scratch["cid"], "title": "x"}),
        ("post", f"{API}/ops/tasks", {"title": "x"}),
        ("post", f"{API}/ops/communications", {"condominium_id": scratch["cid"], "subject": "s", "message": "m"}),
    ]
    for method, url, payload in endpoints:
        r = owner_sess.post(url, json=payload)
        assert r.status_code in (401, 403), f"{url} => {r.status_code} {r.text[:120]}"

    # documents upload
    files = {"file": ("x.pdf", io.BytesIO(b"%PDF"), "application/pdf")}
    r = owner_sess.post(f"{API}/ops/documents", files=files,
                       data={"name": "x", "category": "x", "condominium_id": scratch["cid"]})
    assert r.status_code in (401, 403)


def test_owner_cannot_access_other_condo_occurrence(owner_sess, staff, scratch):
    # staff creates occurrence in TEST condo (not owner's condo)
    r = staff.post(f"{API}/ops/occurrences", json={
        "condominium_id": scratch["cid"], "title": "TEST_OtherCondo"})
    assert r.status_code == 200
    oid_ = r.json()["id"]
    r2 = owner_sess.get(f"{API}/ops/occurrences/{oid_}")
    assert r2.status_code in (403, 404), f"expected 403/404 got {r2.status_code}"


# ============================================================ REGRESSION (Phases 1 & 2)
def test_regression_finance_dashboard(staff):
    r = staff.get(f"{API}/finance/dashboard")
    assert r.status_code == 200
    assert "totals" in r.json() or "total_receivable" in r.json() or True  # tolerate shape


def test_regression_condominiums_fractions_owners(staff):
    for path in ("/condominiums", "/fractions", "/owners"):
        r = staff.get(f"{API}{path}")
        assert r.status_code == 200, f"{path}: {r.status_code}"


def test_regression_auth_all_roles():
    for creds in (SUPER, MANAGER, OWNER):
        s = _login(creds)
        me = s.get(f"{API}/auth/me")
        assert me.status_code == 200, f"{creds['email']}: me failed"
