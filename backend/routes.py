from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query

from database import db
from auth import get_current_user, require_staff, audit
from money import from_cents
from finance import fraction_balance_cents
from models import CondominiumInput, FractionInput, OwnerInput, ROLE_SUPER_ADMIN, ROLE_OWNER

router = APIRouter(prefix="/api", tags=["core"])


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
    if user.get("role") == ROLE_OWNER:
        return {user.get("condominium_id")} if user.get("condominium_id") else set()
    return None


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
async def _condo_map(user):
    async for c in db.condominiums.find(org_filter(user)):
        yield clean(c)


async def _owner_map(user):
    async for o in db.owners.find(org_filter(user)):
        yield clean(o)


@router.get("/fractions")
async def list_fractions(user: dict = Depends(get_current_user), condominium_id: Optional[str] = Query(None)):
    restricted = await accessible_condo_ids(user)
    base = {}
    if condominium_id:
        base["condominium_id"] = condominium_id
    fractions = [clean(f) async for f in db.fractions.find(org_filter(user, base)).sort("identifier", 1)]
    if restricted is not None:
        fractions = [f for f in fractions if f["condominium_id"] in restricted]
    if user.get("role") == ROLE_OWNER and user.get("owner_id"):
        fractions = [f for f in fractions if f.get("owner_id") == user.get("owner_id")]
    owners = {o["id"]: o["name"] async for o in _owner_map(user)}
    condos = {c["id"]: c["name"] async for c in _condo_map(user)}
    for f in fractions:
        bal = from_cents(await fraction_balance_cents(f["id"]))
        f["balance"] = bal
        f["owner_name"] = owners.get(f.get("owner_id"), "—")
        f["condominium_name"] = condos.get(f.get("condominium_id"), "—")
        f["payment_status"] = "pago" if bal <= 0 else "pendente"
    return fractions


@router.post("/fractions")
async def create_fraction(payload: FractionInput, user: dict = Depends(require_staff)):
    now = datetime.now(timezone.utc).isoformat()
    doc = payload.model_dump()
    doc.update({"organization_id": user["organization_id"], "created_by": user["id"],
                "updated_by": user["id"], "created_at": now, "updated_at": now})
    res = await db.fractions.insert_one(doc)
    # keep fraction_owners relationship in sync (primary owner)
    if payload.owner_id:
        await db.fraction_owners.insert_one({
            "fraction_id": str(res.inserted_id), "owner_id": payload.owner_id,
            "organization_id": user["organization_id"], "ownership_percentage": 100.0,
            "start_date": now, "end_date": None, "is_primary": True, "created_at": now})
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
    out["balance"] = from_cents(await fraction_balance_cents(fid))
    return out


@router.delete("/fractions/{fid}")
async def delete_fraction(fid: str, user: dict = Depends(require_staff)):
    r = await db.fractions.delete_one(org_filter(user, {"_id": oid(fid)}))
    if r.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Fração não encontrada")
    await db.fraction_owners.delete_many({"fraction_id": fid})
    await audit(user, "delete", "fraction", fid)
    return {"message": "Fração eliminada"}


# ============ OWNERS ============
@router.get("/owners")
async def list_owners(user: dict = Depends(get_current_user), condominium_id: Optional[str] = Query(None)):
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
        bal = 0
        for f in fracs:
            bal += await fraction_balance_cents(f["id"])
        o["balance"] = from_cents(bal)
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


# ============ USERS ============
@router.get("/users")
async def list_users(user: dict = Depends(require_staff)):
    users = [clean(u) async for u in db.users.find(org_filter(user))]
    for u in users:
        u.pop("password_hash", None)
    return users


# ============ AUDIT LOG ============
@router.get("/audit-logs")
async def list_audit_logs(user: dict = Depends(require_staff), limit: int = 100):
    logs = [clean(l) async for l in db.audit_logs.find(org_filter(user)).sort("created_at", -1).limit(limit)]
    return logs
