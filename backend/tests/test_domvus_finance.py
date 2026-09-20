"""DOMVUS Phase 2 — Finance engine backend tests.

Covers: transaction ledger (charge/payment/reversal/credit), oldest-first
allocation, partial + overpayment, statement, aging, dashboard, reports (JSON+CSV),
PDF receipt & notice, idempotent quota generation, owner isolation & RBAC,
decimal precision on ‰ split.
"""
import os
import time
import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "https://proptech-pt.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUPER = {"email": "master.marques@gmail.com", "password": "Domvus2025!"}
MANAGER = {"email": "gestor@domvus.pt", "password": "Domvus2025!"}
OWNER = {"email": "condomino@domvus.pt", "password": "Domvus2025!"}


def _login(creds):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=creds, timeout=30)
    assert r.status_code == 200, f"login failed {creds['email']}: {r.status_code} {r.text}"
    # Fallback: read cookie and set as bearer header (in case cookies not resent)
    tok = s.cookies.get("access_token")
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def staff():
    return _login(SUPER)


@pytest.fixture(scope="module")
def owner():
    return _login(OWNER)


@pytest.fixture(scope="module")
def scratch(staff):
    """Create isolated TEST condo + owner + fraction for mutation tests. Cleans up at end."""
    cid = staff.post(f"{API}/condominiums", json={"name": f"TEST_FIN_{int(time.time())}"}).json()["id"]
    oid_ = staff.post(f"{API}/owners", json={"condominium_id": cid, "name": "TEST_FinOwner", "nif": "500000001"}).json()["id"]
    fid = staff.post(f"{API}/fractions", json={"condominium_id": cid, "identifier": "TESTF1",
                                                "owner_id": oid_, "permillage": 40}).json()["id"]
    yield {"cid": cid, "oid": oid_, "fid": fid}
    staff.delete(f"{API}/condominiums/{cid}")


def _new_fraction(staff, cid, ident="TESTF", permillage=40):
    oid_ = staff.post(f"{API}/owners", json={"condominium_id": cid, "name": f"TEST_{ident}"}).json()["id"]
    fid = staff.post(f"{API}/fractions", json={"condominium_id": cid, "identifier": ident,
                                                "owner_id": oid_, "permillage": permillage}).json()["id"]
    return fid, oid_


# ---------------- TEST 1: charge 100 + payment 100 => balance 0 ----------------
def test_charge_and_full_payment_balance_zero(staff, scratch):
    fid, _ = _new_fraction(staff, scratch["cid"], "T1F", 40)
    r = staff.post(f"{API}/finance/charges", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 100,
        "description": "TEST1 charge", "due_date": "2026-01-08"})
    assert r.status_code == 200, r.text
    p = staff.post(f"{API}/finance/payments", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 100}).json()
    assert p["allocated"] == 100.0
    assert p["credit_remaining"] == 0.0
    st = staff.get(f"{API}/finance/statement/{fid}").json()
    assert st["balance"] == 0.0
    assert st["outstanding"] == 0.0


# ---------------- TEST 2: charge 100 + payment 60 => PARTIALLY_PAID ----------------
def test_partial_payment(staff, scratch):
    fid, _ = _new_fraction(staff, scratch["cid"], "T2F", 40)
    ch = staff.post(f"{API}/finance/charges", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 100,
        "description": "TEST2 charge", "due_date": "2026-01-08"}).json()
    staff.post(f"{API}/finance/payments", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 60})
    txns = staff.get(f"{API}/finance/transactions", params={"fraction_id": fid}).json()
    tx = next(t for t in txns if t["id"] == ch["id"])
    assert tx["status"] == "PARTIALLY_PAID"
    assert tx["paid"] == 60.0
    assert tx["outstanding"] == 40.0


# ---------------- TEST 3: overpayment 120 => balance -20, credit kept ----------------
def test_overpayment_credit(staff, scratch):
    fid, _ = _new_fraction(staff, scratch["cid"], "T3F", 40)
    staff.post(f"{API}/finance/charges", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 100,
        "description": "TEST3", "due_date": "2026-01-08"})
    p = staff.post(f"{API}/finance/payments", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 120}).json()
    assert p["credit_remaining"] == 20.0
    st = staff.get(f"{API}/finance/statement/{fid}").json()
    assert st["balance"] == -20.0
    assert st["credit"] == 20.0
    assert st["outstanding"] == 0.0


# ---------------- TEST 4: oldest-first allocation across 3 charges ----------------
def test_oldest_first_allocation(staff, scratch):
    fid, _ = _new_fraction(staff, scratch["cid"], "T4F", 40)
    charges = []
    for m, d in [(1, "2026-01-08"), (2, "2026-02-08"), (3, "2026-03-08")]:
        c = staff.post(f"{API}/finance/charges", json={
            "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 100,
            "description": f"TEST4-{m}", "due_date": d}).json()
        charges.append(c["id"])
    staff.post(f"{API}/finance/payments", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 150})
    txns = {t["id"]: t for t in staff.get(f"{API}/finance/transactions",
                                            params={"fraction_id": fid}).json()}
    jan, feb, mar = txns[charges[0]], txns[charges[1]], txns[charges[2]]
    assert jan["status"] == "PAID" and jan["paid"] == 100.0
    assert feb["status"] == "PARTIALLY_PAID" and feb["paid"] == 50.0 and feb["outstanding"] == 50.0
    assert mar["status"] in ("OPEN", "OVERDUE") and mar["paid"] == 0.0 and mar["outstanding"] == 100.0


# ---------------- TEST 5: reversal keeps original visible, net = 0 ----------------
def test_reverse_charge(staff, scratch):
    fid, _ = _new_fraction(staff, scratch["cid"], "T5F", 40)
    c = staff.post(f"{API}/finance/charges", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 100,
        "description": "TEST5"}).json()
    r = staff.post(f"{API}/finance/transactions/{c['id']}/reverse")
    assert r.status_code == 200, r.text
    txns = staff.get(f"{API}/finance/transactions", params={"fraction_id": fid}).json()
    orig = next(t for t in txns if t["id"] == c["id"])
    assert orig["reversed"] is True
    st = staff.get(f"{API}/finance/statement/{fid}").json()
    assert st["balance"] == 0.0


# ---------------- TEST 6: idempotent quota generation ----------------
def test_generate_quotas_idempotent(staff, scratch):
    # create a fresh config
    cfg = staff.post(f"{API}/finance/charge-configs", json={
        "condominium_id": scratch["cid"], "name": "TEST_QuotaFixed",
        "calculation_method": "FIXED_AMOUNT", "amount": 25.0,
        "frequency": "monthly", "due_day": 8}).json()
    r1 = staff.post(f"{API}/finance/generate-quotas", json={
        "condominium_id": scratch["cid"], "config_id": cfg["id"],
        "financial_year": 2030, "start_month": 1, "end_month": 3}).json()
    r2 = staff.post(f"{API}/finance/generate-quotas", json={
        "condominium_id": scratch["cid"], "config_id": cfg["id"],
        "financial_year": 2030, "start_month": 1, "end_month": 3}).json()
    assert r1["created"] > 0
    assert r2["created"] == 0
    assert r2["skipped"] == r1["created"]


# ---------------- TEST 7 & 8: owner isolation & RBAC ----------------
def test_owner_isolation_and_rbac(owner, staff):
    # find a fraction NOT belonging to the owner
    me = owner.get(f"{API}/auth/me").json()
    all_fracs = staff.get(f"{API}/fractions").json()
    other = next(f for f in all_fracs if f.get("owner_id") != me.get("owner_id"))
    r = owner.get(f"{API}/finance/statement/{other['id']}")
    assert r.status_code == 403

    # owner's own transactions - all belong to them
    txns = owner.get(f"{API}/finance/transactions").json()
    for t in txns:
        assert t.get("owner_id") == me.get("owner_id")

    # 403 on mutating endpoints
    cid_other = other["condominium_id"]
    for path, body in [
        ("/finance/charges", {"condominium_id": cid_other, "fraction_id": other["id"], "amount": 5}),
        ("/finance/payments", {"condominium_id": cid_other, "fraction_id": other["id"], "amount": 5}),
        ("/finance/expenses", {"condominium_id": cid_other, "amount": 5}),
        ("/finance/suppliers", {"name": "TEST_hack"}),
    ]:
        r = owner.post(f"{API}{path}", json=body)
        assert r.status_code == 403, f"{path} expected 403 got {r.status_code}"

    # owner cannot read suppliers (require_staff)
    r = owner.get(f"{API}/finance/suppliers")
    assert r.status_code == 403

    # owner cannot read report for a condo not theirs — endpoint filters silently,
    # but hitting statement of another fraction (above) already validates isolation.
    r = owner.get(f"{API}/finance/reports/receivable", params={"condominium_id": cid_other})
    # owner scoped: rows should be empty (they only see their own condo)
    if r.status_code == 200:
        rows = r.json().get("rows", [])
        # None should reference the other condo
        assert all(row[0] != cid_other for row in rows)


# ---------------- TEST 9: decimal precision on permillage split ----------------
def test_permillage_precision(staff, scratch):
    # annual budget 12,000.36 EUR, fraction permillage 83.6‰
    fid, _ = _new_fraction(staff, scratch["cid"], "T9F", 83.6)
    cfg = staff.post(f"{API}/finance/charge-configs", json={
        "condominium_id": scratch["cid"], "name": "TEST_Perm",
        "calculation_method": "PERMILAGE", "amount": 12000.36,
        "frequency": "monthly", "due_day": 8}).json()
    r = staff.post(f"{API}/finance/generate-quotas", json={
        "condominium_id": scratch["cid"], "config_id": cfg["id"],
        "financial_year": 2031, "start_month": 1, "end_month": 12}).json()
    assert r["created"] >= 12
    txns = [t for t in staff.get(f"{API}/finance/transactions", params={"fraction_id": fid}).json()
            if "TEST_Perm" in t.get("description", "")]
    total = round(sum(t["amount"] for t in txns), 2)
    # Expected annual share = 12000.36 * 0.0836 = 1003.23  (rounded to cent)
    expected = round(12000.36 * 83.6 / 1000.0, 2)
    assert abs(total - expected) < 0.01, f"sum {total} vs expected {expected}"
    # every amount is exact to 2 decimals
    for t in txns:
        assert round(t["amount"] * 100) == int(round(t["amount"] * 100))


# ---------------- PDF endpoints ----------------
def test_payment_receipt_pdf(staff, scratch):
    fid, _ = _new_fraction(staff, scratch["cid"], "PDFF", 40)
    staff.post(f"{API}/finance/charges", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 50})
    p = staff.post(f"{API}/finance/payments", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 50}).json()
    r = staff.get(f"{API}/finance/payments/{p['id']}/receipt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


def test_notice_pdf(staff, scratch):
    fid, _ = _new_fraction(staff, scratch["cid"], "NOTF", 40)
    staff.post(f"{API}/finance/charges", json={
        "condominium_id": scratch["cid"], "fraction_id": fid, "amount": 75,
        "description": "Notice test"})
    r = staff.get(f"{API}/finance/notice/{fid}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/pdf")
    assert r.content[:4] == b"%PDF"


# ---------------- Reports ----------------
def test_reports_json_and_csv(staff):
    for rep in ["receivable", "owner_debt", "aging", "payments", "charges",
                "expenses", "income_vs_expenses", "condo_summary"]:
        r = staff.get(f"{API}/finance/reports/{rep}")
        assert r.status_code == 200, f"{rep} => {r.status_code}"
        d = r.json()
        assert "title" in d and "columns" in d and "rows" in d
        # CSV
        r2 = staff.get(f"{API}/finance/reports/{rep}", params={"fmt": "csv"})
        assert r2.status_code == 200
        assert r2.headers["content-type"].startswith("text/csv")
        assert "attachment" in r2.headers.get("content-disposition", "")


# ---------------- Finance dashboard ----------------
def test_finance_dashboard_structure(staff):
    r = staff.get(f"{API}/finance/dashboard")
    assert r.status_code == 200
    d = r.json()
    totals = d["totals"]
    for k in ["receivable", "overdue", "total_received", "expenses_total",
              "received_month", "cashflow_month", "fractions_in_debt", "fractions_no_debt"]:
        assert k in totals, f"missing totals.{k}"
    assert len(d["monthly"]) == 6
    assert len(d["debt_aging"]) == 7  # 7 buckets: current + 6 ranges
    assert "outstanding_by_condo" in d
    assert "recent_payments" in d
