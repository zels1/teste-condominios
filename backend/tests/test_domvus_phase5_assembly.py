"""DOMVUS Phase 5 — Assemblies quorum + weighted voting.

Covers backend for /api/ops/assemblies quorum object and POST /vote:
- GET detail returns quorum {total_permillage, present_permillage,
  present_pct, present_fractions, total_fractions, active_call, quorum_met}
- 1st call quorum requires >500‰ present; 2nd call any capital
- staff vote for any fraction; owner isolation (only own fraction)
- upsert semantics (re-vote replaces previous)
- cross-condo forbidden
"""
import os
import time
import pytest
import requests


def _read_env():
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        return ""
    return ""


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_env()).rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

SUPER = {"email": "master.marques@gmail.com", "password": "Domvus2025!"}
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
    """Standalone condo with 3 fractions totalling 1000‰: 600, 300, 100."""
    ts = int(time.time())
    cid = staff.post(f"{API}/condominiums", json={"name": f"TEST_ASM_{ts}"}).json()["id"]

    def _mk(name, perm):
        o = staff.post(f"{API}/owners", json={"condominium_id": cid, "name": f"TEST_O_{name}_{ts}",
                                              "nif": f"5{ts}{perm}"[:9]}).json()["id"]
        f = staff.post(f"{API}/fractions", json={"condominium_id": cid, "identifier": f"T_{name}",
                                                 "owner_id": o, "permillage": perm}).json()["id"]
        return o, f

    o1, f1 = _mk("A", 600)  # majority-carrying fraction
    o2, f2 = _mk("B", 300)
    o3, f3 = _mk("C", 100)

    a = staff.post(f"{API}/ops/assemblies", json={
        "condominium_id": cid, "date": "2026-06-01",
        "agenda": [{"title": "Ponto 1"}, {"title": "Ponto 2"}]}).json()
    aid = a["id"]

    yield {"cid": cid, "aid": aid, "o1": o1, "f1": f1, "o2": o2, "f2": f2, "o3": o3, "f3": f3}

    staff.delete(f"{API}/condominiums/{cid}")


# ================== QUORUM SHAPE ==================
def test_quorum_shape_and_empty(staff, scratch):
    d = staff.get(f"{API}/ops/assemblies/{scratch['aid']}").json()
    assert "quorum" in d
    q = d["quorum"]
    for k in ("total_permillage", "present_permillage", "present_pct",
              "present_fractions", "total_fractions", "active_call", "quorum_met"):
        assert k in q, f"missing quorum key {k}"
    assert q["total_fractions"] == 3
    # Seeded fractions total ~1000‰
    assert 990 <= q["total_permillage"] <= 1010, q["total_permillage"]
    assert q["present_permillage"] == 0
    assert q["present_fractions"] == 0
    assert q["active_call"] == 1
    assert q["quorum_met"] is False


# ================== 1st CALL QUORUM ==================
def test_first_call_quorum_needs_majority(staff, scratch):
    # add small fraction only (100‰) -> not enough
    staff.post(f"{API}/ops/assemblies/{scratch['aid']}/attendees",
               json={"owner_id": scratch["o3"], "fraction_id": scratch["f3"],
                     "attendance_type": "present"})
    d = staff.get(f"{API}/ops/assemblies/{scratch['aid']}").json()
    assert d["quorum"]["present_permillage"] == 100.0
    assert d["quorum"]["quorum_met"] is False

    # add 600‰ fraction -> total 700 > 500 -> met
    r = staff.post(f"{API}/ops/assemblies/{scratch['aid']}/attendees",
                   json={"owner_id": scratch["o1"], "fraction_id": scratch["f1"],
                         "attendance_type": "present"})
    assert r.status_code == 200
    q = r.json()["quorum"]
    assert q["present_permillage"] == 700.0
    assert q["quorum_met"] is True
    assert q["present_pct"] >= 50.0


# ================== 2nd CALL ==================
def test_second_call_any_capital_meets_and_owner_403(staff, owner_sess, scratch):
    # Owner cannot PUT
    r = owner_sess.put(f"{API}/ops/assemblies/{scratch['aid']}", json={"active_call": 2})
    assert r.status_code in (401, 403), r.status_code

    # Toggle to 2nd call via staff
    r = staff.put(f"{API}/ops/assemblies/{scratch['aid']}", json={"active_call": 2})
    assert r.status_code == 200
    q = r.json()["quorum"]
    assert q["active_call"] == 2
    # with any present_permillage > 0 -> met
    assert q["present_permillage"] > 0
    assert q["quorum_met"] is True

    # back to 1st for next tests
    staff.put(f"{API}/ops/assemblies/{scratch['aid']}", json={"active_call": 1})


# ================== STAFF VOTING (WEIGHTED) ==================
def test_staff_vote_weighted_tallies_and_result(staff, scratch):
    aid = scratch["aid"]
    # Fresh assembly so tallies are clean
    a2 = staff.post(f"{API}/ops/assemblies", json={
        "condominium_id": scratch["cid"], "date": "2026-07-01",
        "agenda": [{"title": "Vote-A"}]}).json()
    aid2 = a2["id"]

    # f1 (600) favor, f2 (300) contra, f3 (100) abstencao
    r1 = staff.post(f"{API}/ops/assemblies/{aid2}/vote",
                    json={"agenda_number": 1, "fraction_id": scratch["f1"], "vote": "favor"})
    assert r1.status_code == 200, r1.text
    staff.post(f"{API}/ops/assemblies/{aid2}/vote",
               json={"agenda_number": 1, "fraction_id": scratch["f2"], "vote": "contra"})
    r3 = staff.post(f"{API}/ops/assemblies/{aid2}/vote",
                    json={"agenda_number": 1, "fraction_id": scratch["f3"], "vote": "abstencao"})
    d = r3.json()
    item = d["agenda"][0]
    assert item["votes"]["favor"] == 600.0
    assert item["votes"]["contra"] == 300.0
    assert item["votes"]["abstencao"] == 100.0
    assert item["vote_counts"] == {"favor": 1, "contra": 1, "abstencao": 1}
    assert item["result"] == "approved"
    # favor_pct_present with denom 1000 -> 60%
    assert item["favor_pct_present"] == 60.0
    assert item["contra_pct_present"] == 30.0
    # Voting marks presence
    assert d["quorum"]["present_fractions"] == 3
    assert d["quorum"]["present_permillage"] == 1000.0

    # Upsert: change f1 from favor to contra
    r4 = staff.post(f"{API}/ops/assemblies/{aid2}/vote",
                    json={"agenda_number": 1, "fraction_id": scratch["f1"], "vote": "contra"})
    it2 = r4.json()["agenda"][0]
    assert it2["votes"]["favor"] == 0.0
    assert it2["votes"]["contra"] == 900.0
    assert it2["vote_counts"]["favor"] == 0
    assert it2["vote_counts"]["contra"] == 2
    assert it2["result"] == "rejected"

    staff.delete(f"{API}/ops/assemblies/{aid2}") if False else None  # no delete endpoint; fine


def test_vote_invalid_option_400(staff, scratch):
    r = staff.post(f"{API}/ops/assemblies/{scratch['aid']}/vote",
                   json={"agenda_number": 1, "fraction_id": scratch["f1"], "vote": "sim"})
    assert r.status_code == 400


def test_vote_bad_agenda_number(staff, scratch):
    r = staff.post(f"{API}/ops/assemblies/{scratch['aid']}/vote",
                   json={"agenda_number": 99, "fraction_id": scratch["f1"], "vote": "favor"})
    assert r.status_code == 404


# ================== OWNER VOTING + ISOLATION ==================
def test_owner_vote_own_fraction_and_isolation(staff, owner_sess, scratch):
    # Discover owner's assembly + fraction from their real condo
    me = owner_sess.get(f"{API}/auth/me").json()
    own_cid = me["condominium_id"]
    asms = owner_sess.get(f"{API}/ops/assemblies").json()
    assert asms, "owner should see at least one seeded assembly"
    aid = asms[0]["id"]
    det = owner_sess.get(f"{API}/ops/assemblies/{aid}").json()
    assert det["condominium_id"] == own_cid
    assert "my_fractions" in det and len(det["my_fractions"]) >= 1
    own_fid = det["my_fractions"][0]["id"]
    agenda_num = det["agenda"][0]["number"]

    # Vote for own fraction -> 200 and my_votes reflects
    r = owner_sess.post(f"{API}/ops/assemblies/{aid}/vote",
                       json={"agenda_number": agenda_num, "fraction_id": own_fid, "vote": "favor"})
    assert r.status_code == 200, r.text
    key = f"{agenda_num}:{own_fid}"
    assert r.json().get("my_votes", {}).get(key) == "favor"

    # Attempt to vote in an assembly of another condo -> 403/404
    other = staff.post(f"{API}/ops/assemblies/{scratch['aid']}/vote",
                       json={"agenda_number": 1, "fraction_id": scratch["f1"], "vote": "favor"})
    assert other.status_code == 200  # staff can
    r2 = owner_sess.post(f"{API}/ops/assemblies/{scratch['aid']}/vote",
                        json={"agenda_number": 1, "fraction_id": scratch["f1"], "vote": "favor"})
    assert r2.status_code in (403, 404), r2.status_code

    # Attempt to vote for OTHER owner's fraction in own condo (find a non-own fraction)
    frs = staff.get(f"{API}/fractions", params={"condominium_id": own_cid}).json()
    own_fids = {f["id"] for f in det["my_fractions"]}
    others = [f for f in frs if f["id"] not in own_fids]
    if others:
        r3 = owner_sess.post(f"{API}/ops/assemblies/{aid}/vote",
                            json={"agenda_number": agenda_num,
                                  "fraction_id": others[0]["id"], "vote": "favor"})
        assert r3.status_code in (403, 404), r3.status_code
