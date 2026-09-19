from datetime import datetime, timezone, timedelta
from collections import defaultdict
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from database import db
from auth import get_current_user, require_staff, audit
from models import (
    CondominiumInput, FractionInput, OwnerInput, TransactionInput,
    ROLE_SUPER_ADMIN, ROLE_OWNER, DEBIT_TYPES, CREDIT_TYPES,
)

router = APIRouter(prefix="/api", tags=["core"])


# ---------- helpers ----------
def oid(v: str) -> ObjectId:
    try:
        return ObjectId(v)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")


def clean(doc: dict) -> dict:
    if not doc:
        return doc
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    return doc


def org_filter(user: dict, base: dict = None) -> dict:
    f = dict(base or {})
    if user.get("role") != ROLE_SUPER_ADMIN:
        f["organization_id"] = user.get("organization_id")
    return f


async def accessible_condo_ids(user: dict):
    """None means 'all within org filter'. A set means restricted (owner)."""
    if user.get("role") == ROLE_OWNER:
        return {user.get("condominium_id")} if user.get("condominium_id") else set()
    return None


def signed(tx: dict) -> float:
    if tx["type"] in DEBIT_TYPES:
        return float(tx["amount"])
    if tx["type"] in CREDIT_TYPES:
        return -float(tx["amount"])
    return float(tx.get("amount", 0))  # adjustment stored signed


async def fraction_balance(fraction_id: str) -> float:
    total = 0.0
    async for tx in db.transactions.find({"fraction_id": fraction_id}):
        total += signed(tx)
    return round(total, 2)


# ============ DASHBOARD ============
@router.get("/dashboard")
async def dashboard(user: dict = Depends(get_current_user),
                    condominium_id: Optional[str] = Query(None)):
    cf = org_filter(user)
    restricted = await accessible_condo_ids(user)
    if condominium_id:
        cf["_id"] = oid(condominium_id)
    condos = [clean(c) async for c in db.condominiums.find(cf)]
    if restricted is not None:
        condos = [c for c in condos if c["id"] in restricted]
    condo_ids = [c["id"] for c in condos]

    frac_q = org_filter(user, {"condominium_id": {"$in": condo_ids}})
    fractions = [clean(f) async for f in db.fractions.find(frac_q)]
    owners = [clean(o) async for o in db.owners.find(org_filter(user, {"condominium_id": {"$in": condo_ids}}))]
    txns = [clean(t) async for t in db.transactions.find(org_filter(user, {"condominium_id": {"$in": condo_ids}}))]
    if restricted is not None:
        fractions = [f for f in fractions if f["condominium_id"] in restricted]
        txns = [t for t in txns if t["condominium_id"] in restricted]

    # balances per fraction
    bal_by_frac = defaultdict(float)
    for t in txns:
        if t.get("fraction_id"):
            bal_by_frac[t["fraction_id"]] += signed(t)

    receivable = round(sum(v for v in bal_by_frac.values() if v > 0), 2)

    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    income_month = 0.0
    expenses_month = 0.0
    overdue = 0.0
    for t in txns:
        try:
            tdate = datetime.fromisoformat(t["date"])
        except Exception:
            continue
        if tdate.tzinfo is None:
            tdate = tdate.replace(tzinfo=timezone.utc)
        if t["type"] in CREDIT_TYPES and tdate >= month_start:
            income_month += float(t["amount"])

    # overdue = balances of fractions with charges older than 30 days unpaid (approx = receivable aging)
    overdue = receivable

    # charts: last 6 months income vs charges + cashflow
    months = []
    for i in range(5, -1, -1):
        m = (month_start - timedelta(days=1)).replace(day=1) if i else month_start
    # build monthly buckets properly
    buckets = {}
    labels = []
    cursor = month_start
    seq = []
    y, mo = now.year, now.month
    for i in range(5, -1, -1):
        mm = mo - i
        yy = y
        while mm <= 0:
            mm += 12
            yy -= 1
        seq.append((yy, mm))
    label_map = {1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
                 7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez"}
    income_series = {k: 0.0 for k in seq}
    charge_series = {k: 0.0 for k in seq}
    for t in txns:
        try:
            tdate = datetime.fromisoformat(t["date"])
        except Exception:
            continue
        key = (tdate.year, tdate.month)
        if key in income_series:
            if t["type"] in CREDIT_TYPES:
                income_series[key] += float(t["amount"])
            elif t["type"] in DEBIT_TYPES:
                charge_series[key] += float(t["amount"])
    monthly = [{"month": label_map[m], "recebido": round(income_series[(yy, m)], 2),
                "faturado": round(charge_series[(yy, m)], 2),
                "fluxo": round(income_series[(yy, m)] - charge_series[(yy, m)], 2)}
               for (yy, m) in seq]

    # outstanding by condominium
    condo_name = {c["id"]: c["name"] for c in condos}
    outstanding_by_condo = defaultdict(float)
    for fid, bal in bal_by_frac.items():
        frac = next((f for f in fractions if f["id"] == fid), None)
        if frac and bal > 0:
            outstanding_by_condo[frac["condominium_id"]] += bal
    outstanding = [{"name": condo_name.get(cid, "—"), "valor": round(v, 2)}
                   for cid, v in outstanding_by_condo.items()]

    # debt aging (simple buckets by fraction balance size)
    aging = {"0-30": 0.0, "31-60": 0.0, "61-90": 0.0, "90+": 0.0}
    for fid, bal in bal_by_frac.items():
        if bal <= 0:
            continue
        # approximate by oldest unpaid charge date
        oldest = None
        for t in txns:
            if t.get("fraction_id") == fid and t["type"] in DEBIT_TYPES:
                try:
                    d = datetime.fromisoformat(t["date"])
                    if oldest is None or d < oldest:
                        oldest = d
                except Exception:
                    pass
        days = (now - oldest.replace(tzinfo=timezone.utc)).days if oldest else 0
        if days <= 30:
            aging["0-30"] += bal
        elif days <= 60:
            aging["31-60"] += bal
        elif days <= 90:
            aging["61-90"] += bal
        else:
            aging["90+"] += bal
    debt_aging = [{"bucket": k, "valor": round(v, 2)} for k, v in aging.items()]

    # recent payments
    recent_payments = sorted([t for t in txns if t["type"] in CREDIT_TYPES],
                             key=lambda x: x["date"], reverse=True)[:6]

    return {
        "totals": {
            "condominiums": len(condos),
            "fractions": len(fractions),
            "owners": len(owners),
            "receivable": receivable,
            "overdue": round(overdue, 2),
            "income_month": round(income_month, 2),
            "expenses_month": round(expenses_month, 2),
        },
        "monthly": monthly,
        "outstanding_by_condo": outstanding,
        "debt_aging": debt_aging,
        "recent_payments": recent_payments,
    }


# ============ CONDOMINIUMS ============
@router.get("/condominiums")
async def list_condominiums(user: dict = Depends(get_current_user)):
    restricted = await accessible_condo_ids(user)
    condos = [clean(c) async for c in db.condominiums.find(org_filter(user)).sort("name", 1)]
    if restricted is not None:
        condos = [c for c in condos if c["id"] in restricted]
    for c in condos:
        c["fraction_count"] = await db.fractions.count_documents({"condominium_id": c["id"]})
    return condos


@router.get("/condominiums/{cid}")
async def get_condominium(cid: str, user: dict = Depends(get_current_user)):
    restricted = await accessible_condo_ids(user)
    if restricted is not None and cid not in restricted:
        raise HTTPException(status_code=403, detail="Sem acesso a este condomínio")
    c = await db.condominiums.find_one(org_filter(user, {"_id": oid(cid)}))
    if not c:
        raise HTTPException(status_code=404, detail="Condomínio não encontrado")
    return clean(c)


@router.post("/condominiums")
async def create_condominium(payload: CondominiumInput, user: dict = Depends(require_staff)):
    now = datetime.now(timezone.utc).isoformat()
    doc = payload.model_dump()
    doc.update({"organization_id": user["organization_id"], "created_by": user["id"],
                "updated_by": user["id"], "created_at": now, "updated_at": now})
    res = await db.condominiums.insert_one(doc)
    await audit(user, "create", "condominium", str(res.inserted_id), {"name": payload.name})
    doc["_id"] = res.inserted_id
    return clean(doc)


@router.put("/condominiums/{cid}")
async def update_condominium(cid: str, payload: CondominiumInput, user: dict = Depends(require_staff)):
    upd = payload.model_dump()
    upd.update({"updated_by": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()})
    r = await db.condominiums.update_one(org_filter(user, {"_id": oid(cid)}), {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Condomínio não encontrado")
    await audit(user, "update", "condominium", cid, {"name": payload.name})
    return clean(await db.condominiums.find_one({"_id": oid(cid)}))


@router.delete("/condominiums/{cid}")
async def delete_condominium(cid: str, user: dict = Depends(require_staff)):
    r = await db.condominiums.delete_one(org_filter(user, {"_id": oid(cid)}))
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Condomínio não encontrado")
    await db.fractions.delete_many({"condominium_id": cid})
    await db.owners.delete_many({"condominium_id": cid})
    await db.transactions.delete_many({"condominium_id": cid})
    await audit(user, "delete", "condominium", cid)
    return {"message": "Condomínio eliminado"}


# ============ FRACTIONS ============
@router.get("/fractions")
async def list_fractions(user: dict = Depends(get_current_user),
                         condominium_id: Optional[str] = Query(None)):
    restricted = await accessible_condo_ids(user)
    base = {}
    if condominium_id:
        base["condominium_id"] = condominium_id
    fractions = [clean(f) async for f in db.fractions.find(org_filter(user, base)).sort("identifier", 1)]
    if restricted is not None:
        fractions = [f for f in fractions if f["condominium_id"] in restricted]
    owners = {o["id"]: o["name"] async for o in _owner_map(user)}
    condos = {c["id"]: c["name"] async for c in _condo_map(user)}
    for f in fractions:
        f["balance"] = await fraction_balance(f["id"])
        f["owner_name"] = owners.get(f.get("owner_id"), "—")
        f["condominium_name"] = condos.get(f.get("condominium_id"), "—")
        f["payment_status"] = "pago" if f["balance"] <= 0 else "pendente"
    return fractions


async def _owner_map(user):
    async for o in db.owners.find(org_filter(user)):
        yield clean(o)


async def _condo_map(user):
    async for c in db.condominiums.find(org_filter(user)):
        yield clean(c)


@router.post("/fractions")
async def create_fraction(payload: FractionInput, user: dict = Depends(require_staff)):
    now = datetime.now(timezone.utc).isoformat()
    doc = payload.model_dump()
    doc.update({"organization_id": user["organization_id"], "created_by": user["id"],
                "updated_by": user["id"], "created_at": now, "updated_at": now})
    res = await db.fractions.insert_one(doc)
    await audit(user, "create", "fraction", str(res.inserted_id), {"identifier": payload.identifier})
    doc["_id"] = res.inserted_id
    out = clean(doc)
    out["balance"] = 0.0
    return out


@router.put("/fractions/{fid}")
async def update_fraction(fid: str, payload: FractionInput, user: dict = Depends(require_staff)):
    upd = payload.model_dump()
    upd.update({"updated_by": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()})
    r = await db.fractions.update_one(org_filter(user, {"_id": oid(fid)}), {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Fração não encontrada")
    await audit(user, "update", "fraction", fid)
    out = clean(await db.fractions.find_one({"_id": oid(fid)}))
    out["balance"] = await fraction_balance(fid)
    return out


@router.delete("/fractions/{fid}")
async def delete_fraction(fid: str, user: dict = Depends(require_staff)):
    r = await db.fractions.delete_one(org_filter(user, {"_id": oid(fid)}))
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fração não encontrada")
    await db.transactions.delete_many({"fraction_id": fid})
    await audit(user, "delete", "fraction", fid)
    return {"message": "Fração eliminada"}


# ============ OWNERS ============
@router.get("/owners")
async def list_owners(user: dict = Depends(get_current_user),
                      condominium_id: Optional[str] = Query(None)):
    restricted = await accessible_condo_ids(user)
    base = {}
    if condominium_id:
        base["condominium_id"] = condominium_id
    if user.get("role") == ROLE_OWNER and user.get("owner_id"):
        base["_id"] = oid(user["owner_id"])
    owners = [clean(o) async for o in db.owners.find(org_filter(user, base)).sort("name", 1)]
    if restricted is not None:
        owners = [o for o in owners if o["condominium_id"] in restricted]
    condos = {c["id"]: c["name"] async for c in _condo_map(user)}
    for o in owners:
        fracs = [clean(f) async for f in db.fractions.find({"owner_id": o["id"]})]
        bal = 0.0
        for f in fracs:
            bal += await fraction_balance(f["id"])
        o["balance"] = round(bal, 2)
        o["fraction_count"] = len(fracs)
        o["condominium_name"] = condos.get(o.get("condominium_id"), "—")
    return owners


@router.post("/owners")
async def create_owner(payload: OwnerInput, user: dict = Depends(require_staff)):
    now = datetime.now(timezone.utc).isoformat()
    doc = payload.model_dump()
    doc.update({"organization_id": user["organization_id"], "created_by": user["id"],
                "updated_by": user["id"], "created_at": now, "updated_at": now})
    res = await db.owners.insert_one(doc)
    await audit(user, "create", "owner", str(res.inserted_id), {"name": payload.name})
    doc["_id"] = res.inserted_id
    out = clean(doc)
    out["balance"] = 0.0
    out["fraction_count"] = 0
    return out


@router.put("/owners/{ownid}")
async def update_owner(ownid: str, payload: OwnerInput, user: dict = Depends(require_staff)):
    upd = payload.model_dump()
    upd.update({"updated_by": user["id"], "updated_at": datetime.now(timezone.utc).isoformat()})
    r = await db.owners.update_one(org_filter(user, {"_id": oid(ownid)}), {"$set": upd})
    if r.matched_count == 0:
        raise HTTPException(status_code=404, detail="Condómino não encontrado")
    await audit(user, "update", "owner", ownid, {"name": payload.name})
    return clean(await db.owners.find_one({"_id": oid(ownid)}))


@router.delete("/owners/{ownid}")
async def delete_owner(ownid: str, user: dict = Depends(require_staff)):
    r = await db.owners.delete_one(org_filter(user, {"_id": oid(ownid)}))
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Condómino não encontrado")
    await db.fractions.update_many({"owner_id": ownid}, {"$set": {"owner_id": None}})
    await audit(user, "delete", "owner", ownid)
    return {"message": "Condómino eliminado"}


# ============ TRANSACTIONS ============
@router.get("/transactions")
async def list_transactions(user: dict = Depends(get_current_user),
                            condominium_id: Optional[str] = Query(None),
                            fraction_id: Optional[str] = Query(None),
                            owner_id: Optional[str] = Query(None)):
    restricted = await accessible_condo_ids(user)
    base = {}
    if condominium_id:
        base["condominium_id"] = condominium_id
    if fraction_id:
        base["fraction_id"] = fraction_id
    if owner_id:
        base["owner_id"] = owner_id
    if user.get("role") == ROLE_OWNER and user.get("owner_id"):
        base["owner_id"] = user["owner_id"]
    txns = [clean(t) async for t in db.transactions.find(org_filter(user, base)).sort("date", -1)]
    if restricted is not None:
        txns = [t for t in txns if t["condominium_id"] in restricted]
    fmap = {f["id"]: f["identifier"] async for f in _frac_map(user)}
    cmap = {c["id"]: c["name"] async for c in _condo_map(user)}
    for t in txns:
        t["fraction_identifier"] = fmap.get(t.get("fraction_id"), "—")
        t["condominium_name"] = cmap.get(t.get("condominium_id"), "—")
    return txns


async def _frac_map(user):
    async for f in db.fractions.find(org_filter(user)):
        yield clean(f)


@router.post("/transactions")
async def create_transaction(payload: TransactionInput, user: dict = Depends(require_staff)):
    now = datetime.now(timezone.utc).isoformat()
    doc = payload.model_dump()
    doc.update({"organization_id": user["organization_id"], "created_by": user["id"],
                "created_by_name": user["name"], "created_at": now, "updated_at": now})
    res = await db.transactions.insert_one(doc)
    await audit(user, "create", "transaction", str(res.inserted_id),
                {"type": payload.type, "amount": payload.amount})
    doc["_id"] = res.inserted_id
    return clean(doc)


@router.delete("/transactions/{tid}")
async def delete_transaction(tid: str, user: dict = Depends(require_staff)):
    r = await db.transactions.delete_one(org_filter(user, {"_id": oid(tid)}))
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Transação não encontrada")
    await audit(user, "delete", "transaction", tid)
    return {"message": "Transação eliminada"}


# ============ USERS (staff view) ============
@router.get("/users")
async def list_users(user: dict = Depends(require_staff)):
    users = [clean(u) async for u in db.users.find(org_filter(user))]
    for u in users:
        u.pop("password_hash", None)
    return users
