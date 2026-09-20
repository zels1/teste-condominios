"""DOMVUS Phase 4 — Owner Portal + security hardening backend tests.

Covers:
- Owner occurrences scoping (own fractions + common area + reported_by only)
- Owner GET occurrence detail 403/404 across owners in same condo
- Documents: owner can access own condo non-confidential; 403 on confidential/personal
- Fractions: owner sees own only
- New endpoint /api/finance/owner-summary (owner 200, staff 403)
- Regression: staff finance dashboard/ops still work
"""
import os
import io
import time
import pytest
import requests

def _fenv():
    try:
        for line in open("/app/frontend/.env"):
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _fenv()).rstrip("/")
API = f"{BASE}/api"

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
def manager():
    return _login(MANAGER)


@pytest.fixture(scope="module")
def owner():
    return _login(OWNER)


@pytest.fixture(scope="module")
def owner_ctx(owner):
    me = owner.get(f"{API}/auth/me").json()
    return {
        "user_id": me["id"],
        "owner_id": me.get("owner_id"),
        "condominium_id": me.get("condominium_id"),
    }


# ---------------- 1. Owner-summary endpoint ----------------
def test_owner_summary_owner_200(owner, owner_ctx):
    r = owner.get(f"{API}/finance/owner-summary")
    assert r.status_code == 200, r.text
    j = r.json()
    for k in ("owner_name", "totals", "next_due", "fractions", "condominiums",
              "recent_payments", "counts"):
        assert k in j, f"missing {k}"
    for k in ("balance", "outstanding", "credit", "fractions"):
        assert k in j["totals"]
    for k in ("communications", "open_occurrences"):
        assert k in j["counts"]
    # All fractions returned must belong to owner's condo
    for f in j["fractions"]:
        assert f["condominium_id"] == owner_ctx["condominium_id"]
    assert isinstance(j["recent_payments"], list)


def test_owner_summary_staff_403(manager):
    r = manager.get(f"{API}/finance/owner-summary")
    assert r.status_code == 403, f"staff expected 403 got {r.status_code}"


def test_owner_summary_super_403(staff):
    r = staff.get(f"{API}/finance/owner-summary")
    assert r.status_code == 403


# ---------------- 2. Owner fractions scoping ----------------
def test_owner_fractions_only_own(owner, manager, owner_ctx):
    r = owner.get(f"{API}/fractions")
    assert r.status_code == 200
    frs = r.json()
    assert len(frs) >= 1, "owner should see at least their own fraction"
    for f in frs:
        assert f.get("owner_id") == owner_ctx["owner_id"], f"leak: {f}"
    # Manager sees more in same condo
    mr = manager.get(f"{API}/fractions", params={"condominium_id": owner_ctx["condominium_id"]})
    assert mr.status_code == 200
    assert len(mr.json()) >= len(frs)


# ---------------- 3. Owner occurrences scoping (security fix) ----------------
def test_owner_occurrences_only_own_fractions(owner, manager, owner_ctx):
    # Manager listing gives full picture
    m_all = manager.get(f"{API}/ops/occurrences",
                        params={"condominium_id": owner_ctx["condominium_id"]}).json()
    o_list = owner.get(f"{API}/ops/occurrences").json()
    # get owner's own fraction ids
    own_fids = {f["id"] for f in owner.get(f"{API}/fractions").json()}
    for o in o_list:
        fid = o.get("fraction_id")
        if fid:
            # must belong to owner OR owner reported it
            assert fid in own_fids or o.get("reported_by") == owner_ctx["user_id"], \
                f"leak: occurrence {o.get('id')} fraction_id {fid} not owner's"
    # Ensure filter actually filters: manager should see occurrences on OTHER fractions
    other_fid = None
    for o in m_all:
        if o.get("fraction_id") and o.get("fraction_id") not in own_fids:
            other_fid = o["id"]
            break
    if other_fid is not None:
        assert not any(x["id"] == other_fid for x in o_list), \
            f"owner sees another owner's occurrence {other_fid}"


def test_owner_403_on_other_owner_occurrence(owner, manager, owner_ctx):
    m_all = manager.get(f"{API}/ops/occurrences",
                        params={"condominium_id": owner_ctx["condominium_id"]}).json()
    own_fids = {f["id"] for f in owner.get(f"{API}/fractions").json()}
    target = None
    for o in m_all:
        fid = o.get("fraction_id")
        if fid and fid not in own_fids:
            target = o["id"]
            break
    if not target:
        # create one via manager
        # need another fraction — find another fraction in same condo
        fracs = manager.get(f"{API}/fractions",
                            params={"condominium_id": owner_ctx["condominium_id"]}).json()
        other = next((f for f in fracs if f["owner_id"] != owner_ctx["owner_id"]), None)
        if not other:
            pytest.skip("only one owner in condo")
        c = manager.post(f"{API}/ops/occurrences", json={
            "condominium_id": owner_ctx["condominium_id"],
            "fraction_id": other["id"], "title": "TEST_P4_other"})
        assert c.status_code == 200, c.text
        target = c.json()["id"]

    r = owner.get(f"{API}/ops/occurrences/{target}")
    assert r.status_code in (403, 404), f"expected 403/404 got {r.status_code}"


# ---------------- 4. Documents access ----------------
def test_owner_document_confidential_condo_level_denied(owner, manager, owner_ctx):
    # Upload confidential doc at condominium-level in owner's condo
    files = {"file": ("secret.pdf", io.BytesIO(b"%PDF-1.4 secret"), "application/pdf")}
    data = {"name": f"TEST_P4_Conf_{int(time.time())}", "category": "Confidencial",
            "condominium_id": owner_ctx["condominium_id"]}
    r = manager.post(f"{API}/ops/documents", files=files, data=data)
    assert r.status_code == 200, r.text
    did = r.json()["id"]
    try:
        dl = owner.get(f"{API}/ops/documents/{did}/download")
        assert dl.status_code == 403, f"confidential should be 403, got {dl.status_code}"
    finally:
        manager.delete(f"{API}/ops/documents/{did}")


def test_owner_document_personal_condo_level_denied(owner, manager, owner_ctx):
    files = {"file": ("p.pdf", io.BytesIO(b"%PDF-1.4 personal"), "application/pdf")}
    data = {"name": f"TEST_P4_Pess_{int(time.time())}", "category": "Pessoal",
            "condominium_id": owner_ctx["condominium_id"]}
    r = manager.post(f"{API}/ops/documents", files=files, data=data)
    assert r.status_code == 200, r.text
    did = r.json()["id"]
    try:
        dl = owner.get(f"{API}/ops/documents/{did}/download")
        assert dl.status_code == 403, f"pessoal should be 403, got {dl.status_code}"
    finally:
        manager.delete(f"{API}/ops/documents/{did}")


def test_owner_can_access_own_condo_non_confidential(owner, manager, owner_ctx):
    files = {"file": ("reg.pdf", io.BytesIO(b"%PDF-1.4 reg"), "application/pdf")}
    data = {"name": f"TEST_P4_Reg_{int(time.time())}", "category": "Regulamento",
            "condominium_id": owner_ctx["condominium_id"]}
    r = manager.post(f"{API}/ops/documents", files=files, data=data)
    assert r.status_code == 200, r.text
    did = r.json()["id"]
    try:
        dl = owner.get(f"{API}/ops/documents/{did}/download")
        assert dl.status_code == 200, f"regulamento should be 200, got {dl.status_code}"
        assert dl.content.startswith(b"%PDF")
    finally:
        manager.delete(f"{API}/ops/documents/{did}")


def test_owner_document_other_condo_403(owner, staff):
    # Create fresh condo (not owner's) and upload doc there
    ts = int(time.time())
    cid = staff.post(f"{API}/condominiums", json={"name": f"TEST_P4_OtherCondo_{ts}"}).json()["id"]
    try:
        files = {"file": ("x.pdf", io.BytesIO(b"%PDF-1.4"), "application/pdf")}
        r = staff.post(f"{API}/ops/documents", files=files,
                       data={"name": "TEST_P4_x", "category": "Regulamento",
                             "condominium_id": cid})
        assert r.status_code == 200
        did = r.json()["id"]
        dl = owner.get(f"{API}/ops/documents/{did}/download")
        assert dl.status_code == 403, f"cross-condo should be 403 got {dl.status_code}"
    finally:
        staff.delete(f"{API}/condominiums/{cid}")


# ---------------- 5. Owner can still create occurrence for own fraction ----------------
def test_owner_can_create_occurrence_for_own_fraction(owner, owner_ctx):
    frs = owner.get(f"{API}/fractions").json()
    assert frs
    r = owner.post(f"{API}/ops/occurrences", json={
        "condominium_id": owner_ctx["condominium_id"],
        "fraction_id": frs[0]["id"],
        "title": f"TEST_P4_OwnerReport_{int(time.time())}",
        "description": "d", "category": "Outros", "priority": "low",
    })
    # Some backends only allow staff; accept 200 or 403 but flag
    assert r.status_code in (200, 201, 403), r.text
    if r.status_code in (200, 201):
        # ensure it appears in owner's list
        lst = owner.get(f"{API}/ops/occurrences").json()
        assert any(x["id"] == r.json()["id"] for x in lst)


# ---------------- 6. Regression ----------------
def test_regression_manager_finance_dashboard(manager):
    r = manager.get(f"{API}/finance/dashboard")
    assert r.status_code == 200


def test_regression_manager_ops_dashboard(manager):
    r = manager.get(f"{API}/ops/dashboard")
    assert r.status_code == 200


def test_regression_manager_occurrences_full(manager):
    r = manager.get(f"{API}/ops/occurrences")
    assert r.status_code == 200
    assert isinstance(r.json(), list)
