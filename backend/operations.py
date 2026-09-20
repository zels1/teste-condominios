"""DOMVUS operational layer: occurrences, maintenance, contracts, documents,
communications, assemblies, tasks, notifications, activities, search.

Reuses finance/auth helpers. Files stored as base64 in Mongo with a secure,
authorization-checked download endpoint (no public storage URLs)."""
import base64
from datetime import datetime, timezone, timedelta
from typing import Optional, List

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form, Response
from pydantic import BaseModel

from database import db
from auth import get_current_user, require_staff, audit
from finance import org_filter, oid, now_utc, parse_dt, owner_guard
from money import to_cents, from_cents
from models import ROLE_OWNER, ROLE_SUPER_ADMIN, STAFF_ROLES

router = APIRouter(prefix="/api/ops", tags=["operations"])

ALLOWED_TYPES = {
    "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint", "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain", "text/csv",
}
MAX_FILE = 12 * 1024 * 1024


def clean(d):
    if not d:
        return d
    d = dict(d)
    d["id"] = str(d.pop("_id"))
    return d


async def log_activity(user, action, entity, entity_id, description, condominium_id=None):
    await db.activities.insert_one({
        "organization_id": user.get("organization_id"), "condominium_id": condominium_id,
        "user_id": user.get("id"), "user_name": user.get("name"), "action": action,
        "entity": entity, "entity_id": str(entity_id), "description": description,
        "created_at": now_utc().isoformat()})


async def notify(user, target_user_ids, ntype, title, message, entity, entity_id):
    docs = []
    for uid in set(filter(None, target_user_ids)):
        docs.append({"organization_id": user.get("organization_id"), "user_id": uid, "type": ntype,
                     "title": title, "message": message, "related_entity": entity,
                     "related_entity_id": str(entity_id), "read_at": None, "created_at": now_utc().isoformat()})
    if docs:
        await db.notifications.insert_many(docs)


async def staff_user_ids(org_id):
    return [str(u["_id"]) async for u in db.users.find({"organization_id": org_id, "role": {"$in": list(STAFF_ROLES)}})]


async def owner_condo_ids(user):
    if user.get("role") == ROLE_OWNER:
        return {user.get("condominium_id")} if user.get("condominium_id") else set()
    return None


def scope_query(user, base=None):
    q = org_filter(user, base)
    return q


# ============================================================ OCCURRENCES
class OccurrenceIn(BaseModel):
    condominium_id: str
    fraction_id: Optional[str] = None
    title: str
    description: str = ""
    category: str = "Outro"
    priority: str = "normal"
    location: str = ""
    estimated_cost: float = 0.0


class OccurrenceUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    supplier_id: Optional[str] = None
    estimated_cost: Optional[float] = None
    actual_cost: Optional[float] = None
    location: Optional[str] = None
    description: Optional[str] = None


def occ_public(o, names=None):
    names = names or {}
    return {**clean({k: v for k, v in o.items() if k not in ("estimated_cost_cents", "actual_cost_cents")}),
            "estimated_cost": from_cents(o.get("estimated_cost_cents", 0)),
            "actual_cost": from_cents(o.get("actual_cost_cents", 0)),
            "condominium_name": names.get(o.get("condominium_id"), "—"),
            "assigned_name": names.get(o.get("assigned_to"), None),
            "supplier_name": names.get(o.get("supplier_id"), None)}


@router.get("/occurrences")
async def list_occurrences(user=Depends(get_current_user), condominium_id: Optional[str] = None,
                           status: Optional[str] = None, priority: Optional[str] = None,
                           supplier_id: Optional[str] = None, search: Optional[str] = None):
    base = {}
    if condominium_id: base["condominium_id"] = condominium_id
    if status: base["status"] = status
    if priority: base["priority"] = priority
    if supplier_id: base["supplier_id"] = supplier_id
    oc = await owner_condo_ids(user)
    names = await _name_map(user)
    out = []
    async for o in db.occurrences.find(scope_query(user, base)).sort("created_at", -1):
        if oc is not None and o.get("condominium_id") not in oc:
            continue
        if user.get("role") == ROLE_OWNER and o.get("reported_by") != user.get("id") and o.get("fraction_id"):
            frac = await db.fractions.find_one({"_id": oid(o["fraction_id"])}) if o.get("fraction_id") else None
        p = occ_public(o, names)
        if search and search.lower() not in (p["title"] + p.get("description", "")).lower():
            continue
        out.append(p)
    return out


@router.post("/occurrences")
async def create_occurrence(payload: OccurrenceIn, user=Depends(get_current_user)):
    await owner_guard(user, condominium_id=payload.condominium_id, fraction_id=payload.fraction_id)
    now = now_utc().isoformat()
    doc = {"organization_id": user["organization_id"], "condominium_id": payload.condominium_id,
           "fraction_id": payload.fraction_id, "reported_by": user["id"], "reported_by_name": user["name"],
           "assigned_to": None, "supplier_id": None, "title": payload.title, "description": payload.description,
           "category": payload.category, "priority": payload.priority, "status": "new",
           "location": payload.location, "estimated_cost_cents": to_cents(payload.estimated_cost),
           "actual_cost_cents": 0, "created_at": now, "updated_at": now, "resolved_at": None, "closed_at": None}
    res = await db.occurrences.insert_one(doc)
    oid_ = str(res.inserted_id)
    await db.occurrence_status_history.insert_one({"occurrence_id": oid_, "status": "new",
                                                   "user_name": user["name"], "created_at": now})
    await log_activity(user, "create", "occurrence", oid_, f"Ocorrência criada: {payload.title}", payload.condominium_id)
    await audit(user, "create", "occurrence", oid_, {"title": payload.title})
    await notify(user, await staff_user_ids(user["organization_id"]), "occurrence",
                 "Nova ocorrência", payload.title, "occurrence", oid_)
    doc["_id"] = res.inserted_id
    return occ_public(doc)


@router.get("/occurrences/{oid_}")
async def get_occurrence(oid_: str, user=Depends(get_current_user)):
    o = await db.occurrences.find_one(scope_query(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    await owner_guard(user, condominium_id=o["condominium_id"])
    names = await _name_map(user)
    p = occ_public(o, names)
    p["timeline"] = [clean(h) async for h in db.occurrence_status_history.find({"occurrence_id": oid_}).sort("created_at", 1)]
    p["comments"] = [clean(c) async for c in db.occurrence_comments.find({"occurrence_id": oid_}).sort("created_at", 1)]
    p["documents"] = [_doc_public(d) async for d in db.documents.find({"related_entity_type": "occurrence", "related_entity_id": oid_})]
    return p


@router.put("/occurrences/{oid_}")
async def update_occurrence(oid_: str, payload: OccurrenceUpdate, user=Depends(require_staff)):
    o = await db.occurrences.find_one(scope_query(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    upd = {"updated_at": now_utc().isoformat()}
    changes = []
    for f in ("priority", "assigned_to", "supplier_id", "location", "description"):
        v = getattr(payload, f)
        if v is not None:
            upd[f] = v
            changes.append(f)
    if payload.estimated_cost is not None:
        upd["estimated_cost_cents"] = to_cents(payload.estimated_cost)
    if payload.actual_cost is not None:
        upd["actual_cost_cents"] = to_cents(payload.actual_cost)
    if payload.status and payload.status != o.get("status"):
        upd["status"] = payload.status
        if payload.status == "resolved":
            upd["resolved_at"] = now_utc().isoformat()
        if payload.status == "closed":
            upd["closed_at"] = now_utc().isoformat()
        await db.occurrence_status_history.insert_one({"occurrence_id": oid_, "status": payload.status,
                                                       "user_name": user["name"], "created_at": now_utc().isoformat()})
        await log_activity(user, "status", "occurrence", oid_, f"Estado alterado para {payload.status}", o["condominium_id"])
    if payload.assigned_to:
        await notify(user, [payload.assigned_to], "occurrence", "Ocorrência atribuída", o["title"], "occurrence", oid_)
        await log_activity(user, "assign", "occurrence", oid_, "Ocorrência atribuída", o["condominium_id"])
    await db.occurrences.update_one({"_id": oid(oid_)}, {"$set": upd})
    await audit(user, "update", "occurrence", oid_, {"changes": changes + (["status"] if payload.status else [])})
    return await get_occurrence(oid_, user)


class CommentIn(BaseModel):
    text: str


@router.post("/occurrences/{oid_}/comments")
async def add_comment(oid_: str, payload: CommentIn, user=Depends(get_current_user)):
    o = await db.occurrences.find_one(scope_query(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    await owner_guard(user, condominium_id=o["condominium_id"])
    doc = {"occurrence_id": oid_, "text": payload.text, "user_name": user["name"],
           "user_id": user["id"], "created_at": now_utc().isoformat()}
    await db.occurrence_comments.insert_one(doc)
    await log_activity(user, "comment", "occurrence", oid_, "Comentário adicionado", o["condominium_id"])
    return clean(doc)


@router.post("/occurrences/{oid_}/create-expense")
async def occurrence_to_expense(oid_: str, user=Depends(require_staff)):
    o = await db.occurrences.find_one(scope_query(user, {"_id": oid(oid_)}))
    if not o:
        raise HTTPException(status_code=404, detail="Ocorrência não encontrada")
    amount_cents = o.get("actual_cost_cents") or o.get("estimated_cost_cents") or 0
    if amount_cents <= 0:
        raise HTTPException(status_code=400, detail="Defina o custo real antes de criar a despesa")
    sup = await db.suppliers.find_one({"_id": oid(o["supplier_id"])}) if o.get("supplier_id") else None
    doc = {"organization_id": user["organization_id"], "condominium_id": o["condominium_id"],
           "supplier_id": o.get("supplier_id"), "supplier_name": sup["name"] if sup else "",
           "description": f"Ocorrência: {o['title']}", "category": o.get("category", "Manutenção"),
           "amount_cents": amount_cents, "vat_cents": 0, "invoice_number": "",
           "payment_status": "pendente", "date": now_utc().isoformat(), "due_date": None,
           "occurrence_id": oid_, "notes": "", "created_by": user["id"], "created_by_name": user["name"],
           "created_at": now_utc().isoformat()}
    res = await db.expenses.insert_one(doc)
    await log_activity(user, "create", "expense", str(res.inserted_id),
                       f"Despesa criada a partir da ocorrência {o['title']}", o["condominium_id"])
    await audit(user, "create_expense_from_occurrence", "expense", str(res.inserted_id), {"amount": from_cents(amount_cents)})
    return {"id": str(res.inserted_id), "amount": from_cents(amount_cents)}


# ============================================================ MAINTENANCE
class MaintenanceIn(BaseModel):
    condominium_id: str
    supplier_id: Optional[str] = None
    contract_id: Optional[str] = None
    title: str
    description: str = ""
    category: str = "Outro"
    maint_type: str = "preventive"
    frequency: str = "none"   # none|monthly|quarterly|biannual|annual
    next_date: Optional[str] = None
    estimated_cost: float = 0.0
    notes: str = ""


FREQ_DAYS = {"monthly": 30, "quarterly": 91, "biannual": 182, "annual": 365}


def maint_status(m):
    if m.get("status") in ("completed", "cancelled"):
        return m["status"]
    nd = parse_dt(m.get("next_date"))
    if not nd:
        return "scheduled"
    days = (nd - now_utc()).days
    if days < 0:
        return "overdue"
    if days <= 7:
        return "due"
    return "scheduled"


def maint_public(m, names=None):
    names = names or {}
    d = clean({k: v for k, v in m.items() if k != "estimated_cost_cents"})
    d["estimated_cost"] = from_cents(m.get("estimated_cost_cents", 0))
    d["status"] = maint_status(m)
    d["condominium_name"] = names.get(m.get("condominium_id"), "—")
    d["supplier_name"] = names.get(m.get("supplier_id"), None)
    return d


@router.get("/maintenance")
async def list_maintenance(user=Depends(get_current_user), condominium_id: Optional[str] = None):
    base = {}
    if condominium_id: base["condominium_id"] = condominium_id
    oc = await owner_condo_ids(user)
    names = await _name_map(user)
    out = []
    async for m in db.maintenance.find(scope_query(user, base)).sort("next_date", 1):
        if oc is not None and m.get("condominium_id") not in oc:
            continue
        out.append(maint_public(m, names))
    return out


@router.post("/maintenance")
async def create_maintenance(payload: MaintenanceIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id)
    now = now_utc().isoformat()
    doc = {"organization_id": user["organization_id"], "condominium_id": payload.condominium_id,
           "supplier_id": payload.supplier_id, "contract_id": payload.contract_id, "title": payload.title,
           "description": payload.description, "category": payload.category, "maint_type": payload.maint_type,
           "frequency": payload.frequency, "next_date": payload.next_date, "last_date": None,
           "status": "scheduled", "estimated_cost_cents": to_cents(payload.estimated_cost), "notes": payload.notes,
           "created_at": now, "updated_at": now}
    res = await db.maintenance.insert_one(doc)
    await log_activity(user, "create", "maintenance", str(res.inserted_id), f"Manutenção agendada: {payload.title}", payload.condominium_id)
    await audit(user, "create", "maintenance", str(res.inserted_id), {"title": payload.title})
    doc["_id"] = res.inserted_id
    return maint_public(doc)


@router.post("/maintenance/{mid}/complete")
async def complete_maintenance(mid: str, user=Depends(require_staff)):
    m = await db.maintenance.find_one(scope_query(user, {"_id": oid(mid)}))
    if not m:
        raise HTTPException(status_code=404, detail="Manutenção não encontrada")
    now = now_utc()
    upd = {"last_date": now.isoformat(), "updated_at": now.isoformat()}
    freq = m.get("frequency", "none")
    if freq in FREQ_DAYS:
        upd["next_date"] = (now + timedelta(days=FREQ_DAYS[freq])).isoformat()
        upd["status"] = "scheduled"
    else:
        upd["status"] = "completed"
    await db.maintenance.update_one({"_id": oid(mid)}, {"$set": upd})
    await log_activity(user, "complete", "maintenance", mid, f"Manutenção concluída: {m['title']}", m["condominium_id"])
    await audit(user, "complete", "maintenance", mid)
    return maint_public(await db.maintenance.find_one({"_id": oid(mid)}), await _name_map(user))


# ============================================================ CONTRACTS
class ContractIn(BaseModel):
    condominium_id: str
    supplier_id: Optional[str] = None
    title: str
    category: str = "Outro"
    contract_number: str = ""
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    value: float = 0.0
    payment_frequency: str = "monthly"
    description: str = ""
    notes: str = ""


def contract_status(c):
    if c.get("status") in ("draft", "cancelled"):
        return c["status"]
    end = parse_dt(c.get("end_date"))
    if not end:
        return "active"
    days = (end - now_utc()).days
    if days < 0:
        return "expired"
    if days <= 90:
        return "expiring"
    return "active"


def contract_public(c, names=None):
    names = names or {}
    d = clean({k: v for k, v in c.items() if k != "value_cents"})
    d["value"] = from_cents(c.get("value_cents", 0))
    d["status"] = contract_status(c)
    end = parse_dt(c.get("end_date"))
    d["days_to_expiry"] = (end - now_utc()).days if end else None
    d["condominium_name"] = names.get(c.get("condominium_id"), "—")
    d["supplier_name"] = names.get(c.get("supplier_id"), None)
    return d


@router.get("/contracts")
async def list_contracts(user=Depends(get_current_user), condominium_id: Optional[str] = None):
    base = {}
    if condominium_id: base["condominium_id"] = condominium_id
    oc = await owner_condo_ids(user)
    names = await _name_map(user)
    out = []
    async for c in db.contracts.find(scope_query(user, base)).sort("end_date", 1):
        if oc is not None and c.get("condominium_id") not in oc:
            continue
        out.append(contract_public(c, names))
    return out


@router.post("/contracts")
async def create_contract(payload: ContractIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id)
    now = now_utc().isoformat()
    doc = {"organization_id": user["organization_id"], **payload.model_dump(exclude={"value"}),
           "value_cents": to_cents(payload.value), "status": "active",
           "created_at": now, "updated_at": now}
    res = await db.contracts.insert_one(doc)
    await log_activity(user, "create", "contract", str(res.inserted_id), f"Contrato criado: {payload.title}", payload.condominium_id)
    await audit(user, "create", "contract", str(res.inserted_id), {"title": payload.title})
    doc["_id"] = res.inserted_id
    return contract_public(doc)


# ============================================================ DOCUMENTS
def _doc_public(d):
    return {"id": str(d["_id"]), "name": d.get("name"), "file_name": d.get("file_name"),
            "file_type": d.get("file_type"), "file_size": d.get("file_size"), "category": d.get("category"),
            "description": d.get("description", ""), "uploaded_by": d.get("uploaded_by_name"),
            "created_at": d.get("created_at"), "related_entity_type": d.get("related_entity_type"),
            "related_entity_id": d.get("related_entity_id"), "condominium_id": d.get("condominium_id")}


async def _can_access_document(user, d):
    if user.get("role") == ROLE_SUPER_ADMIN:
        return True
    if d.get("organization_id") != user.get("organization_id"):
        return False
    if user.get("role") in STAFF_ROLES:
        return True
    # owner: only own condo/fraction/owner-related
    et, ei = d.get("related_entity_type"), d.get("related_entity_id")
    if d.get("condominium_id") and d.get("condominium_id") == user.get("condominium_id"):
        return et != "owner" or ei == user.get("owner_id")
    if et == "owner" and ei == user.get("owner_id"):
        return True
    return False


@router.get("/documents")
async def list_documents(user=Depends(get_current_user), condominium_id: Optional[str] = None,
                         category: Optional[str] = None, related_entity_type: Optional[str] = None,
                         related_entity_id: Optional[str] = None, search: Optional[str] = None):
    base = {}
    if condominium_id: base["condominium_id"] = condominium_id
    if category: base["category"] = category
    if related_entity_type: base["related_entity_type"] = related_entity_type
    if related_entity_id: base["related_entity_id"] = related_entity_id
    out = []
    async for d in db.documents.find(scope_query(user, base)).sort("created_at", -1):
        if not await _can_access_document(user, d):
            continue
        if search and search.lower() not in d.get("name", "").lower():
            continue
        out.append(_doc_public(d))
    return out


@router.post("/documents")
async def upload_document(file: UploadFile = File(...), name: str = Form(...), category: str = Form("Outro"),
                          description: str = Form(""), condominium_id: str = Form(""),
                          related_entity_type: str = Form(""), related_entity_id: str = Form(""),
                          user=Depends(require_staff)):
    if file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="Tipo de ficheiro não permitido")
    data = await file.read()
    if len(data) > MAX_FILE:
        raise HTTPException(status_code=400, detail="Ficheiro demasiado grande (máx. 12MB)")
    if condominium_id:
        await owner_guard(user, condominium_id=condominium_id)
    doc = {"organization_id": user["organization_id"], "name": name, "file_name": file.filename,
           "file_type": file.content_type, "file_size": len(data), "category": category,
           "description": description, "uploaded_by": user["id"], "uploaded_by_name": user["name"],
           "condominium_id": condominium_id or None, "related_entity_type": related_entity_type or None,
           "related_entity_id": related_entity_id or None, "version": 1,
           "data_b64": base64.b64encode(data).decode(), "created_at": now_utc().isoformat()}
    res = await db.documents.insert_one(doc)
    await log_activity(user, "upload", "document", str(res.inserted_id), f"Documento carregado: {name}", condominium_id or None)
    await audit(user, "upload", "document", str(res.inserted_id), {"name": name})
    return _doc_public({**doc, "_id": res.inserted_id})


@router.get("/documents/{did}/download")
async def download_document(did: str, user=Depends(get_current_user)):
    d = await db.documents.find_one({"_id": oid(did)})
    if not d:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    if not await _can_access_document(user, d):
        raise HTTPException(status_code=403, detail="Sem permissão para aceder a este documento")
    data = base64.b64decode(d["data_b64"])
    return Response(content=data, media_type=d.get("file_type", "application/octet-stream"),
                    headers={"Content-Disposition": f'inline; filename="{d.get("file_name", "documento")}"'})


@router.delete("/documents/{did}")
async def delete_document(did: str, user=Depends(require_staff)):
    d = await db.documents.find_one(scope_query(user, {"_id": oid(did)}))
    if not d:
        raise HTTPException(status_code=404, detail="Documento não encontrado")
    await db.documents.delete_one({"_id": oid(did)})
    await audit(user, "delete", "document", did, {"name": d.get("name")})
    return {"message": "Documento eliminado"}


# ============================================================ COMMUNICATIONS
DEFAULT_TEMPLATES = [
    {"name": "Aviso de pagamento", "category": "financeiro", "subject": "Aviso de pagamento — {{condominium_name}}",
     "body": "Exmo(a). {{owner_name}},\n\nA fração {{fraction}} apresenta um valor em dívida de {{amount_due}}, com vencimento a {{due_date}}.\nReferência: {{payment_reference}}.\n\nCom os melhores cumprimentos,\nA Administração"},
    {"name": "Aviso de manutenção", "category": "operacional", "subject": "Aviso de manutenção — {{condominium_name}}",
     "body": "Exmo(a). {{owner_name}},\n\nInformamos que se realizará uma intervenção de manutenção no condomínio {{condominium_name}}.\n\nA Administração"},
    {"name": "Comunicado geral", "category": "geral", "subject": "Comunicado — {{condominium_name}}",
     "body": "Exmo(a). {{owner_name}},\n\n[mensagem]\n\nA Administração"},
    {"name": "Convocatória de assembleia", "category": "assembleia", "subject": "Convocatória de Assembleia — {{condominium_name}}",
     "body": "Exmo(a). {{owner_name}},\n\nConvocamos V. Exa. para a Assembleia de Condóminos a realizar em {{assembly_date}}.\n\nA Administração"},
]


@router.get("/communication-templates")
async def list_templates(user=Depends(require_staff)):
    out = [clean(t) async for t in db.communication_templates.find(scope_query(user))]
    return out


class CommunicationIn(BaseModel):
    condominium_id: str
    target_type: str = "condominium"  # condominium|building|fractions|owners|owner
    target_ids: List[str] = []
    subject: str
    message: str
    type: str = "email"
    status: str = "sent"  # draft|sent


@router.get("/communications")
async def list_communications(user=Depends(get_current_user), condominium_id: Optional[str] = None,
                              owner_id: Optional[str] = None):
    base = {}
    if condominium_id: base["condominium_id"] = condominium_id
    if user.get("role") == ROLE_OWNER:
        base["recipient_owner_ids"] = user.get("owner_id")
    names = await _name_map(user)
    out = []
    async for c in db.communications.find(scope_query(user, base)).sort("created_at", -1):
        d = clean(c)
        d.pop("data", None)
        d["condominium_name"] = names.get(c.get("condominium_id"), "—")
        out.append(d)
    return out


@router.post("/communications")
async def send_communication(payload: CommunicationIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id)
    # resolve recipients -> owners
    owners = []
    if payload.target_type == "owners" or payload.target_type == "owner":
        async for o in db.owners.find({"_id": {"$in": [oid(i) for i in payload.target_ids]}}):
            owners.append(o)
    elif payload.target_type == "fractions":
        async for f in db.fractions.find({"_id": {"$in": [oid(i) for i in payload.target_ids]}}):
            if f.get("owner_id"):
                o = await db.owners.find_one({"_id": oid(f["owner_id"])})
                if o: owners.append(o)
    else:  # condominium / building -> all owners of condo
        async for o in db.owners.find({"condominium_id": payload.condominium_id}):
            owners.append(o)
    recipient_owner_ids = [str(o["_id"]) for o in owners]
    doc = {"organization_id": user["organization_id"], "condominium_id": payload.condominium_id,
           "sender": user["name"], "sender_id": user["id"], "subject": payload.subject, "message": payload.message,
           "type": payload.type, "status": payload.status, "target_type": payload.target_type,
           "recipient_owner_ids": recipient_owner_ids, "recipient_count": len(recipient_owner_ids),
           "created_at": now_utc().isoformat()}
    res = await db.communications.insert_one(doc)
    cid = str(res.inserted_id)
    # in-app notifications to owner-users
    owner_user_ids = [str(u["_id"]) async for u in db.users.find({"owner_id": {"$in": recipient_owner_ids}})]
    await notify(user, owner_user_ids, "communication", payload.subject, payload.message[:120], "communication", cid)
    await log_activity(user, "send", "communication", cid, f"Comunicação enviada: {payload.subject}", payload.condominium_id)
    await audit(user, "send", "communication", cid, {"subject": payload.subject, "recipients": len(recipient_owner_ids)})
    return {"id": cid, "recipient_count": len(recipient_owner_ids), "status": payload.status,
            "delivery_note": "Registada e notificada na aplicação. Envio por email será ativado com a integração de email."}


# ============================================================ ASSEMBLIES
class AgendaItemIn(BaseModel):
    title: str
    description: str = ""


class AssemblyIn(BaseModel):
    condominium_id: str
    date: str
    time: str = ""
    location: str = ""
    assembly_type: str = "ordinary"
    agenda: List[AgendaItemIn] = []
    notes: str = ""


@router.get("/assemblies")
async def list_assemblies(user=Depends(get_current_user), condominium_id: Optional[str] = None):
    base = {}
    if condominium_id: base["condominium_id"] = condominium_id
    oc = await owner_condo_ids(user)
    names = await _name_map(user)
    out = []
    async for a in db.assemblies.find(scope_query(user, base)).sort("date", -1):
        if oc is not None and a.get("condominium_id") not in oc:
            continue
        d = clean(a)
        d["condominium_name"] = names.get(a.get("condominium_id"), "—")
        out.append(d)
    return out


@router.post("/assemblies")
async def create_assembly(payload: AssemblyIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id)
    agenda = [{"number": i + 1, "title": it.title, "description": it.description, "decision": "", "status": "pending"}
              for i, it in enumerate(payload.agenda)]
    doc = {"organization_id": user["organization_id"], "condominium_id": payload.condominium_id,
           "date": payload.date, "time": payload.time, "location": payload.location,
           "assembly_type": payload.assembly_type, "status": "scheduled", "agenda": agenda,
           "notes": payload.notes, "created_at": now_utc().isoformat()}
    res = await db.assemblies.insert_one(doc)
    aid = str(res.inserted_id)
    await log_activity(user, "create", "assembly", aid, "Assembleia agendada", payload.condominium_id)
    await audit(user, "create", "assembly", aid, {"date": payload.date})
    doc["_id"] = res.inserted_id
    return clean(doc)


@router.get("/assemblies/{aid}")
async def get_assembly(aid: str, user=Depends(get_current_user)):
    a = await db.assemblies.find_one(scope_query(user, {"_id": oid(aid)}))
    if not a:
        raise HTTPException(status_code=404, detail="Assembleia não encontrada")
    await owner_guard(user, condominium_id=a["condominium_id"])
    d = clean(a)
    d["attendees"] = [clean(x) async for x in db.assembly_attendees.find({"assembly_id": aid})]
    d["documents"] = [_doc_public(x) async for x in db.documents.find({"related_entity_type": "assembly", "related_entity_id": aid})]
    return d


class AttendeeIn(BaseModel):
    owner_id: str
    fraction_id: Optional[str] = None
    attendance_type: str = "present"
    represented_by: str = ""


@router.post("/assemblies/{aid}/attendees")
async def add_attendee(aid: str, payload: AttendeeIn, user=Depends(require_staff)):
    a = await db.assemblies.find_one(scope_query(user, {"_id": oid(aid)}))
    if not a:
        raise HTTPException(status_code=404, detail="Assembleia não encontrada")
    owner = await db.owners.find_one({"_id": oid(payload.owner_id)})
    doc = {"assembly_id": aid, "owner_id": payload.owner_id, "owner_name": owner["name"] if owner else "",
           "fraction_id": payload.fraction_id, "attendance_type": payload.attendance_type,
           "represented_by": payload.represented_by, "created_at": now_utc().isoformat()}
    await db.assembly_attendees.insert_one(doc)
    return clean(doc)


# ============================================================ TASKS
class TaskIn(BaseModel):
    title: str
    description: str = ""
    assigned_to: Optional[str] = None
    priority: str = "normal"
    due_date: Optional[str] = None
    condominium_id: Optional[str] = None
    related_entity_type: Optional[str] = None
    related_entity_id: Optional[str] = None


@router.get("/tasks")
async def list_tasks(user=Depends(require_staff), mine: bool = False, status: Optional[str] = None):
    base = {}
    if mine:
        base["assigned_to"] = user["id"]
    if status:
        base["status"] = status
    names = await _name_map(user)
    out = []
    async for t in db.tasks.find(scope_query(user, base)).sort("due_date", 1):
        d = clean(t)
        d["assigned_name"] = names.get(t.get("assigned_to"), None)
        d["condominium_name"] = names.get(t.get("condominium_id"), None)
        out.append(d)
    return out


@router.post("/tasks")
async def create_task(payload: TaskIn, user=Depends(require_staff)):
    now = now_utc().isoformat()
    doc = {"organization_id": user["organization_id"], **payload.model_dump(), "status": "todo",
           "created_by": user["id"], "created_by_name": user["name"], "created_at": now, "updated_at": now}
    res = await db.tasks.insert_one(doc)
    tid = str(res.inserted_id)
    if payload.assigned_to:
        await notify(user, [payload.assigned_to], "task", "Nova tarefa", payload.title, "task", tid)
    await log_activity(user, "create", "task", tid, f"Tarefa criada: {payload.title}", payload.condominium_id)
    doc["_id"] = res.inserted_id
    return clean(doc)


class TaskUpdate(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to: Optional[str] = None
    due_date: Optional[str] = None


@router.put("/tasks/{tid}")
async def update_task(tid: str, payload: TaskUpdate, user=Depends(require_staff)):
    t = await db.tasks.find_one(scope_query(user, {"_id": oid(tid)}))
    if not t:
        raise HTTPException(status_code=404, detail="Tarefa não encontrada")
    upd = {k: v for k, v in payload.model_dump().items() if v is not None}
    upd["updated_at"] = now_utc().isoformat()
    await db.tasks.update_one({"_id": oid(tid)}, {"$set": upd})
    if payload.status == "completed":
        await log_activity(user, "complete", "task", tid, f"Tarefa concluída: {t['title']}", t.get("condominium_id"))
        await audit(user, "complete", "task", tid)
    return clean(await db.tasks.find_one({"_id": oid(tid)}))


# ============================================================ NOTIFICATIONS
@router.get("/notifications")
async def list_notifications(user=Depends(get_current_user)):
    items = [clean(n) async for n in db.notifications.find({"user_id": user["id"]}).sort("created_at", -1).limit(50)]
    unread = await db.notifications.count_documents({"user_id": user["id"], "read_at": None})
    return {"items": items, "unread": unread}


@router.post("/notifications/{nid}/read")
async def read_notification(nid: str, user=Depends(get_current_user)):
    await db.notifications.update_one({"_id": oid(nid), "user_id": user["id"]},
                                     {"$set": {"read_at": now_utc().isoformat()}})
    return {"message": "ok"}


@router.post("/notifications/read-all")
async def read_all(user=Depends(get_current_user)):
    await db.notifications.update_many({"user_id": user["id"], "read_at": None},
                                       {"$set": {"read_at": now_utc().isoformat()}})
    return {"message": "ok"}


# ============================================================ ACTIVITIES
@router.get("/activities")
async def list_activities(user=Depends(get_current_user), entity: Optional[str] = None,
                          entity_id: Optional[str] = None, condominium_id: Optional[str] = None, limit: int = 50):
    base = {}
    if entity: base["entity"] = entity
    if entity_id: base["entity_id"] = entity_id
    if condominium_id: base["condominium_id"] = condominium_id
    oc = await owner_condo_ids(user)
    out = []
    async for a in db.activities.find(scope_query(user, base)).sort("created_at", -1).limit(limit):
        if oc is not None and a.get("condominium_id") and a.get("condominium_id") not in oc:
            continue
        out.append(clean(a))
    return out


# ============================================================ OPS DASHBOARD
@router.get("/dashboard")
async def ops_dashboard(user=Depends(get_current_user), condominium_id: Optional[str] = None):
    base = {}
    if condominium_id: base["condominium_id"] = condominium_id
    q = scope_query(user, base)
    open_occ = await db.occurrences.count_documents({**q, "status": {"$nin": ["closed", "cancelled", "resolved"]}})
    urgent_occ = await db.occurrences.count_documents({**q, "priority": "urgent", "status": {"$nin": ["closed", "cancelled"]}})
    # maintenance overdue/upcoming
    overdue_maint = upcoming_maint = 0
    async for m in db.maintenance.find(q):
        s = maint_status(m)
        if s == "overdue": overdue_maint += 1
        elif s in ("due", "scheduled"): upcoming_maint += 1
    expiring = 0
    async for c in db.contracts.find(q):
        if contract_status(c) in ("expiring", "expired"): expiring += 1
    pending_tasks = await db.tasks.count_documents({**q, "status": {"$nin": ["completed", "cancelled"]}})
    upcoming_assemblies = await db.assemblies.count_documents({**q, "date": {"$gte": now_utc().isoformat()[:10]}})
    names = await _name_map(user)
    recent_comms = []
    async for c in db.communications.find(q).sort("created_at", -1).limit(5):
        recent_comms.append({"id": str(c["_id"]), "subject": c.get("subject"), "created_at": c.get("created_at"),
                             "condominium_name": names.get(c.get("condominium_id"), "—")})
    recent_activity = [clean(a) async for a in db.activities.find(scope_query(user, base)).sort("created_at", -1).limit(8)]
    return {"open_occurrences": open_occ, "urgent_occurrences": urgent_occ, "overdue_maintenance": overdue_maint,
            "upcoming_maintenance": upcoming_maint, "contracts_expiring": expiring, "pending_tasks": pending_tasks,
            "upcoming_assemblies": upcoming_assemblies, "recent_communications": recent_comms,
            "recent_activity": recent_activity}


# ============================================================ SUPPLIER PROFILE
@router.get("/suppliers/{sid}/profile")
async def supplier_profile(sid: str, user=Depends(require_staff)):
    s = await db.suppliers.find_one(scope_query(user, {"_id": oid(sid)}))
    if not s:
        raise HTTPException(status_code=404, detail="Fornecedor não encontrado")
    occ = await db.occurrences.count_documents({"supplier_id": sid})
    open_occ = await db.occurrences.count_documents({"supplier_id": sid, "status": {"$nin": ["closed", "cancelled", "resolved"]}})
    maint_total = await db.maintenance.count_documents({"supplier_id": sid})
    overdue = 0
    async for m in db.maintenance.find({"supplier_id": sid}):
        if maint_status(m) == "overdue": overdue += 1
    spend = 0
    async for e in db.expenses.find({"supplier_id": sid}):
        spend += e.get("amount_cents", 0) + e.get("vat_cents", 0)
    contracts = [contract_public(c) async for c in db.contracts.find({"supplier_id": sid})]
    return {"supplier": clean(s), "metrics": {"occurrences": occ, "open_occurrences": open_occ,
            "maintenance": maint_total, "overdue_maintenance": overdue, "total_spend": from_cents(spend)},
            "contracts": contracts}


# ============================================================ GLOBAL SEARCH
@router.get("/search")
async def global_search(q: str, user=Depends(get_current_user)):
    if not q or len(q) < 2:
        return {"results": []}
    rx = {"$regex": q, "$options": "i"}
    oc = await owner_condo_ids(user)
    results = []

    async def add(coll, field, label, path_fn, extra=None):
        cur = db[coll].find(scope_query(user, {field: rx})).limit(6)
        async for x in cur:
            if oc is not None and x.get("condominium_id") and x.get("condominium_id") not in oc:
                continue
            results.append({"type": label, "id": str(x["_id"]),
                            "title": x.get(field) or x.get("name") or "—", "path": path_fn(x)})

    await add("condominiums", "name", "Condomínio", lambda x: f"/condominios/{x['_id']}")
    await add("owners", "name", "Condómino", lambda x: "/condominos")
    await add("occurrences", "title", "Ocorrência", lambda x: f"/ocorrencias/{x['_id']}")
    await add("contracts", "title", "Contrato", lambda x: "/contratos")
    if user.get("role") in STAFF_ROLES:
        await add("suppliers", "name", "Fornecedor", lambda x: "/fornecedores")
        await add("tasks", "title", "Tarefa", lambda x: "/tarefas")
    await add("documents", "name", "Documento", lambda x: "/documentos")
    return {"results": results}


# ------------------------------------------------ helpers
async def _name_map(user):
    m = {}
    async for c in db.condominiums.find(org_filter(user)):
        m[str(c["_id"])] = c["name"]
    async for u in db.users.find(org_filter(user)):
        m[str(u["_id"])] = u["name"]
    async for s in db.suppliers.find(org_filter(user)):
        m[str(s["_id"])] = s["name"]
    return m
