"""DOMVUS backend API tests: auth, RBAC, tenant isolation, CRUD, finance, dashboard."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://proptech-pt.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUPER = {"email": "master.marques@gmail.com", "password": "Domvus2025!"}
MANAGER = {"email": "gestor@domvus.pt", "password": "Domvus2025!"}
STAFF = {"email": "staff@domvus.pt", "password": "Domvus2025!"}
OWNER = {"email": "condomino@domvus.pt", "password": "Domvus2025!"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    return s, r


@pytest.fixture(scope="module")
def super_session():
    s, r = _login(SUPER)
    assert r.status_code == 200, f"super login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def staff_session():
    s, r = _login(STAFF)
    assert r.status_code == 200, f"staff login failed: {r.status_code} {r.text}"
    return s


@pytest.fixture(scope="module")
def owner_session():
    s, r = _login(OWNER)
    assert r.status_code == 200, f"owner login failed: {r.status_code} {r.text}"
    return s


# ---------- Auth ----------
class TestAuth:
    def test_login_super_admin(self):
        s, r = _login(SUPER)
        assert r.status_code == 200
        data = r.json()
        assert data["email"] == SUPER["email"]
        assert data["role"] == "super_admin"
        # Cookies set
        assert "access_token" in s.cookies or any("access_token" in c.name for c in s.cookies)

    def test_me_returns_same_user(self, super_session):
        r = super_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == SUPER["email"]

    def test_logout_clears_session(self):
        s, _ = _login(SUPER)
        r = s.post(f"{API}/auth/logout")
        assert r.status_code == 200
        # New session with cleared cookies
        s.cookies.clear()
        r2 = s.get(f"{API}/auth/me")
        assert r2.status_code == 401

    def test_invalid_password_returns_401(self):
        # use unique email to avoid brute-force lockout contamination
        r = requests.post(f"{API}/auth/login",
                          json={"email": "master.marques@gmail.com", "password": "WrongPass!"})
        assert r.status_code == 401

    def test_brute_force_lockout_returns_429(self):
        unique_email = f"lockout_test_{int(time.time())}@example.com"
        # 5 failures then expect 429 (or 401 for non-existent user, then 429 on 6th)
        last = None
        for i in range(6):
            last = requests.post(f"{API}/auth/login",
                                 json={"email": unique_email, "password": "bad"})
        # After 5 attempts, next should be 429
        r = requests.post(f"{API}/auth/login", json={"email": unique_email, "password": "bad"})
        assert r.status_code == 429, f"Expected 429 after 5 bad attempts, got {r.status_code}"


# ---------- RBAC ----------
class TestRBAC:
    def test_owner_cannot_create_condominium(self, owner_session):
        r = owner_session.post(f"{API}/condominiums", json={"name": "TEST_hack"})
        assert r.status_code == 403

    def test_owner_cannot_create_fraction(self, owner_session):
        r = owner_session.post(f"{API}/fractions",
                                json={"condominium_id": "x", "identifier": "TEST"})
        assert r.status_code == 403

    def test_owner_cannot_create_owner(self, owner_session):
        r = owner_session.post(f"{API}/owners",
                                json={"condominium_id": "x", "name": "TEST"})
        assert r.status_code == 403

    def test_owner_cannot_create_transaction(self, owner_session):
        r = owner_session.post(f"{API}/transactions",
                                json={"condominium_id": "x", "amount": 10})
        assert r.status_code == 403


# ---------- Tenant Isolation ----------
class TestTenantIsolation:
    def test_super_admin_sees_three_condos(self, super_session):
        r = super_session.get(f"{API}/condominiums")
        assert r.status_code == 200
        condos = r.json()
        assert len(condos) >= 3, f"expected >=3 condos, got {len(condos)}"

    def test_owner_sees_only_own_condo(self, owner_session):
        r = owner_session.get(f"{API}/condominiums")
        assert r.status_code == 200
        condos = r.json()
        assert len(condos) == 1, f"owner should see exactly 1 condo, got {len(condos)}"

    def test_owner_403_on_other_condo(self, owner_session, super_session):
        # get all condos as super, find one not belonging to owner
        all_condos = super_session.get(f"{API}/condominiums").json()
        own = owner_session.get(f"{API}/condominiums").json()
        own_ids = {c["id"] for c in own}
        other = next((c for c in all_condos if c["id"] not in own_ids), None)
        assert other is not None, "no other condo to test isolation"
        r = owner_session.get(f"{API}/condominiums/{other['id']}")
        assert r.status_code == 403

    def test_owner_transactions_limited(self, owner_session):
        r = owner_session.get(f"{API}/transactions")
        assert r.status_code == 200
        txns = r.json()
        me = owner_session.get(f"{API}/auth/me").json()
        for t in txns:
            assert t.get("owner_id") == me.get("owner_id"), \
                f"owner sees txn for other owner: {t.get('owner_id')} vs {me.get('owner_id')}"

    def test_owner_fractions_limited(self, owner_session):
        r = owner_session.get(f"{API}/fractions")
        assert r.status_code == 200
        me = owner_session.get(f"{API}/auth/me").json()
        for f in r.json():
            assert f["condominium_id"] == me.get("condominium_id")


# ---------- CRUD Condominiums ----------
class TestCondominiumsCRUD:
    def test_full_flow(self, staff_session):
        # create
        payload = {"name": "TEST_Condo_CRUD", "address": "Rua Teste 1", "city": "Lisboa"}
        r = staff_session.post(f"{API}/condominiums", json=payload)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        # get
        r = staff_session.get(f"{API}/condominiums/{cid}")
        assert r.status_code == 200 and r.json()["name"] == "TEST_Condo_CRUD"
        # list includes fraction_count
        lst = staff_session.get(f"{API}/condominiums").json()
        me = next((c for c in lst if c["id"] == cid), None)
        assert me and "fraction_count" in me
        # update
        r = staff_session.put(f"{API}/condominiums/{cid}",
                              json={**payload, "name": "TEST_Condo_Updated"})
        assert r.status_code == 200
        assert staff_session.get(f"{API}/condominiums/{cid}").json()["name"] == "TEST_Condo_Updated"
        # create fraction+owner+tx under it, then delete cascades
        o = staff_session.post(f"{API}/owners",
                               json={"condominium_id": cid, "name": "TEST_Owner"}).json()
        f = staff_session.post(f"{API}/fractions",
                               json={"condominium_id": cid, "identifier": "TEST_F1",
                                     "owner_id": o["id"]}).json()
        t = staff_session.post(f"{API}/transactions",
                               json={"condominium_id": cid, "fraction_id": f["id"],
                                     "owner_id": o["id"], "type": "charge", "amount": 50}).json()
        # delete cascades
        r = staff_session.delete(f"{API}/condominiums/{cid}")
        assert r.status_code == 200
        assert staff_session.get(f"{API}/condominiums/{cid}").status_code == 404


# ---------- Finance ----------
class TestFinance:
    def test_fraction_balance_from_transactions(self, staff_session):
        # create isolated condo
        cid = staff_session.post(f"{API}/condominiums",
                                 json={"name": "TEST_Finance"}).json()["id"]
        oid_ = staff_session.post(f"{API}/owners",
                                  json={"condominium_id": cid, "name": "TEST_FinOwner"}).json()["id"]
        fid = staff_session.post(f"{API}/fractions",
                                 json={"condominium_id": cid, "identifier": "TF1",
                                       "owner_id": oid_}).json()["id"]

        def mktx(t, amt):
            return staff_session.post(f"{API}/transactions", json={
                "condominium_id": cid, "fraction_id": fid, "owner_id": oid_,
                "type": t, "amount": amt}).json()

        mktx("charge", 50)
        mktx("charge", 10)
        mktx("payment", 30)

        # fetch fraction and verify balance
        fracs = staff_session.get(f"{API}/fractions", params={"condominium_id": cid}).json()
        assert len(fracs) == 1
        assert fracs[0]["balance"] == 30.0, f"expected 30, got {fracs[0]['balance']}"
        assert fracs[0]["payment_status"] == "pendente"
        assert fracs[0]["owner_name"] == "TEST_FinOwner"
        assert fracs[0]["condominium_name"] == "TEST_Finance"

        # owner balance = sum of fractions' balances
        owners = staff_session.get(f"{API}/owners", params={"condominium_id": cid}).json()
        assert owners[0]["balance"] == 30.0
        assert owners[0]["fraction_count"] == 1

        # delete a charge -> balance updates
        txns = staff_session.get(f"{API}/transactions",
                                 params={"fraction_id": fid}).json()
        charge10 = next(t for t in txns if t["type"] == "charge" and t["amount"] == 10)
        r = staff_session.delete(f"{API}/transactions/{charge10['id']}")
        assert r.status_code == 200
        fracs = staff_session.get(f"{API}/fractions", params={"condominium_id": cid}).json()
        assert fracs[0]["balance"] == 20.0

        # cleanup
        staff_session.delete(f"{API}/condominiums/{cid}")


# ---------- Dashboard ----------
class TestDashboard:
    def test_dashboard_structure_and_receivable(self, super_session):
        r = super_session.get(f"{API}/dashboard")
        assert r.status_code == 200
        d = r.json()
        for k in ["totals", "monthly", "outstanding_by_condo", "debt_aging", "recent_payments"]:
            assert k in d
        totals = d["totals"]
        for k in ["condominiums", "fractions", "owners", "receivable", "overdue", "income_month"]:
            assert k in totals
        assert len(d["monthly"]) == 6
        assert len(d["debt_aging"]) == 4

        # receivable should equal sum of positive fraction balances
        fracs = super_session.get(f"{API}/fractions").json()
        expected = round(sum(f["balance"] for f in fracs if f["balance"] > 0), 2)
        assert abs(totals["receivable"] - expected) < 0.01, \
            f"receivable mismatch: {totals['receivable']} vs {expected}"

    def test_dashboard_filter_by_condo(self, super_session):
        condos = super_session.get(f"{API}/condominiums").json()
        assert condos
        cid = condos[0]["id"]
        r = super_session.get(f"{API}/dashboard", params={"condominium_id": cid})
        assert r.status_code == 200
        assert r.json()["totals"]["condominiums"] == 1

    def test_dashboard_owner_scoped(self, owner_session):
        r = owner_session.get(f"{API}/dashboard")
        assert r.status_code == 200
        assert r.json()["totals"]["condominiums"] == 1


# ---------- Persistence ----------
class TestPersistence:
    def test_owner_creation_persists(self, staff_session):
        cid = staff_session.get(f"{API}/condominiums").json()[0]["id"]
        r = staff_session.post(f"{API}/owners",
                               json={"condominium_id": cid, "name": "TEST_Persist"})
        assert r.status_code == 200
        oid_ = r.json()["id"]
        lst = staff_session.get(f"{API}/owners").json()
        assert any(o["id"] == oid_ for o in lst)
        # cleanup
        staff_session.delete(f"{API}/owners/{oid_}")
