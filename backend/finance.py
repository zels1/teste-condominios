"""DOMVUS financial engine — transaction-based accounting ledger.

Money is stored as integer cents (debit_cents / credit_cents). Balances are
always derived: balance = sum(debit) - sum(credit). Historical transactions are
never mutated; corrections use CREDIT / REVERSAL transactions.
"""
from datetime import datetime, timezone, timedelta
from collections import defaultdict
from typing import Optional, List
import io

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field

from database import db
from auth import get_current_user, require_staff, audit
from money import to_cents, from_cents, permillage_cents, split_periods
from models import ROLE_SUPER_ADMIN, ROLE_OWNER

router = APIRouter(prefix="/api/finance", tags=["finance"])

TX_CHARGE = "CHARGE"
TX_PAYMENT = "PAYMENT"
TX_CREDIT = "CREDIT"
TX_ADJUSTMENT = "ADJUSTMENT"
TX_REVERSAL = "REVERSAL"
TX_REFUND = "REFUND"

MONTHS_PT = {1: "Jan", 2: "Fev", 3: "Mar", 4: "Abr", 5: "Mai", 6: "Jun",
             7: "Jul", 8: "Ago", 9: "Set", 10: "Out", 11: "Nov", 12: "Dez"}


def now_utc():
    return datetime.now(timezone.utc)


def oid(v):
    try:
        return ObjectId(v)
    except Exception:
        raise HTTPException(status_code=400, detail="ID inválido")


def parse_dt(v):
    if not v:
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00")) if isinstance(v, str) else v
        return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d
    except Exception:
        return None


def org_filter(user, base=None):
    f = dict(base or {})
    if user.get("role") != ROLE_SUPER_ADMIN:
        f["organization_id"] = user.get("organization_id")
    return f


async def owner_guard(user, condominium_id=None, fraction_id=None, owner_id=None):
    """Ensure an owner user only touches their own condo/owner scope."""
    if user.get("role") != ROLE_OWNER:
        return
    if condominium_id and condominium_id != user.get("condominium_id"):
        raise HTTPException(status_code=403, detail="Sem acesso a este condomínio")
    if owner_id and owner_id != user.get("owner_id"):
        raise HTTPException(status_code=403, detail="Sem acesso a estes dados")
    if fraction_id:
        frac = await db.fractions.find_one({"_id": oid(fraction_id)})
        if not frac or frac.get("owner_id") != user.get("owner_id"):
            raise HTTPException(status_code=403, detail="Sem acesso a esta fração")


# ----------------------------------------------------------------------------
# Ledger core
# ----------------------------------------------------------------------------
async def post_transaction(user, *, condominium_id, transaction_type, amount_cents,
                           fraction_id=None, owner_id=None, charge_type="", date=None,
                           due_date=None, description="", reference="",
                           related_transaction_id=None, generation_key=None,
                           period_year=None, period_month=None, payment_id=None):
    """Insert an immutable ledger entry. CHARGE/REFUND = debit, others = credit."""
    is_debit = transaction_type in (TX_CHARGE, TX_REFUND)
    if transaction_type == TX_ADJUSTMENT:
        # adjustment carries a signed amount: positive => debit, negative => credit
        debit = amount_cents if amount_cents >= 0 else 0
        credit = -amount_cents if amount_cents < 0 else 0
    else:
        debit = abs(amount_cents) if is_debit else 0
        credit = abs(amount_cents) if not is_debit else 0
    doc = {
        "organization_id": user["organization_id"],
        "condominium_id": condominium_id,
        "fraction_id": fraction_id,
        "owner_id": owner_id,
        "transaction_type": transaction_type,
        "charge_type": charge_type,
        "date": (date or now_utc()).isoformat() if not isinstance(date, str) else date,
        "due_date": due_date.isoformat() if isinstance(due_date, datetime) else due_date,
        "description": description,
        "reference": reference,
        "debit_cents": debit,
        "credit_cents": credit,
        "amount_cents": abs(amount_cents),
        "related_transaction_id": related_transaction_id,
        "reversed": False,
        "generation_key": generation_key,
        "period_year": period_year,
        "period_month": period_month,
        "payment_id": payment_id,
        "created_by": user["id"],
        "created_by_name": user["name"],
        "created_at": now_utc().isoformat(),
    }
    res = await db.transactions.insert_one(doc)
    doc["_id"] = res.inserted_id
    return doc


def tx_public(t, paid_map=None):
    """Serialize a transaction to euros with derived charge status."""
    tid = str(t["_id"])
    out = {
        "id": tid,
        "condominium_id": t.get("condominium_id"),
        "fraction_id": t.get("fraction_id"),
        "owner_id": t.get("owner_id"),
        "transaction_type": t.get("transaction_type"),
        "charge_type": t.get("charge_type", ""),
        "date": t.get("date"),
        "due_date": t.get("due_date"),
        "description": t.get("description", ""),
        "reference": t.get("reference", ""),
        "debit": from_cents(t.get("debit_cents", 0)),
        "credit": from_cents(t.get("credit_cents", 0)),
        "amount": from_cents(t.get("amount_cents", 0)),
        "related_transaction_id": t.get("related_transaction_id"),
        "reversed": t.get("reversed", False),
        "created_by_name": t.get("created_by_name", ""),
    }
    if t.get("transaction_type") == TX_CHARGE:
        out["status"] = charge_status(t, paid_map)
        paid = (paid_map or {}).get(tid, 0)
        out["paid"] = from_cents(paid)
        out["outstanding"] = from_cents(max(0, t.get("amount_cents", 0) - paid)) if not t.get("reversed") else 0.0
    return out


def charge_status(t, paid_map):
    if t.get("reversed"):
        return "REVERSED"
    amount = t.get("amount_cents", 0)
    paid = (paid_map or {}).get(str(t["_id"]), 0)
    if paid >= amount and amount > 0:
        return "PAID"
    if paid > 0:
        return "PARTIALLY_PAID"
    due = parse_dt(t.get("due_date"))
    if due and due < now_utc():
        return "OVERDUE"
    return "OPEN"


async def paid_map_for(match):
    """Map charge_tx_id -> paid_cents from payment allocations matching a filter."""
    pm = defaultdict(int)
    async for p in db.payments.find(match):
        for a in p.get("allocations", []):
            pm[a["charge_id"]] += a["amount_cents"]
    return pm


async def fraction_balance_cents(fraction_id):
    total = 0
    async for t in db.transactions.find({"fraction_id": fraction_id}):
        total += t.get("debit_cents", 0) - t.get("credit_cents", 0)
    return total


async def outstanding_charges(fraction_id):
    """Return non-reversed charges with remaining outstanding, oldest due first."""
    pm = await paid_map_for({"fraction_id": fraction_id})
    charges = []
    async for t in db.transactions.find({"fraction_id": fraction_id, "transaction_type": TX_CHARGE}):
        if t.get("reversed"):
            continue
        paid = pm.get(str(t["_id"]), 0)
        rem = t.get("amount_cents", 0) - paid
        if rem > 0:
            charges.append((t, rem))
    charges.sort(key=lambda x: (parse_dt(x[0].get("due_date")) or parse_dt(x[0].get("date")) or now_utc()))
    return charges


# ----------------------------------------------------------------------------
# CHARGE TYPES
# ----------------------------------------------------------------------------
class ChargeTypeIn(BaseModel):
    condominium_id: str
    name: str
    description: str = ""
    type: str = "OTHER"
    active: bool = True


@router.get("/charge-types")
async def list_charge_types(condominium_id: Optional[str] = None, user=Depends(get_current_user)):
    base = {"condominium_id": condominium_id} if condominium_id else {}
    return [{**{k: v for k, v in c.items() if k != "_id"}, "id": str(c["_id"])}
            async for c in db.charge_types.find(org_filter(user, base))]


@router.post("/charge-types")
async def create_charge_type(payload: ChargeTypeIn, user=Depends(require_staff)):
    doc = payload.model_dump()
    doc.update({"organization_id": user["organization_id"], "created_at": now_utc().isoformat()})
    res = await db.charge_types.insert_one(doc)
    await audit(user, "create", "charge_type", str(res.inserted_id), {"name": payload.name})
    return {**payload.model_dump(), "id": str(res.inserted_id)}


# ----------------------------------------------------------------------------
# CHARGE CONFIGURATION (quota config)
# ----------------------------------------------------------------------------
class ChargeConfigIn(BaseModel):
    condominium_id: str
    name: str
    charge_type: str = "REGULAR_QUOTA"
    calculation_method: str = "PERMILAGE"  # FIXED_AMOUNT | PERMILAGE | FRACTION_SPECIFIC | MANUAL
    amount: float = 0.0                    # euros (FIXED_AMOUNT or annual budget for PERMILAGE)
    fraction_amounts: dict = {}            # fraction_id -> euros (FRACTION_SPECIFIC)
    frequency: str = "monthly"             # monthly | quarterly | annual
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    due_day: int = 8
    active: bool = True


@router.get("/charge-configs")
async def list_charge_configs(condominium_id: Optional[str] = None, user=Depends(get_current_user)):
    base = {"condominium_id": condominium_id} if condominium_id else {}
    out = []
    async for c in db.charge_configs.find(org_filter(user, base)):
        d = {k: v for k, v in c.items() if k not in ("_id", "amount_cents", "fraction_amounts_cents")}
        d["id"] = str(c["_id"])
        d["amount"] = from_cents(c.get("amount_cents", 0))
        out.append(d)
    return out


@router.post("/charge-configs")
async def create_charge_config(payload: ChargeConfigIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id)
    doc = payload.model_dump()
    doc["amount_cents"] = to_cents(payload.amount)
    doc["fraction_amounts_cents"] = {k: to_cents(v) for k, v in (payload.fraction_amounts or {}).items()}
    doc.pop("amount"); doc.pop("fraction_amounts")
    doc.update({"organization_id": user["organization_id"], "created_by": user["id"],
                "created_at": now_utc().isoformat()})
    res = await db.charge_configs.insert_one(doc)
    await audit(user, "create", "charge_config", str(res.inserted_id),
                {"name": payload.name, "method": payload.calculation_method})
    return {"id": str(res.inserted_id), **payload.model_dump()}


# ----------------------------------------------------------------------------
# ANNUAL BUDGET
# ----------------------------------------------------------------------------
class BudgetLineIn(BaseModel):
    category: str
    description: str = ""
    amount: float = 0.0


class BudgetIn(BaseModel):
    condominium_id: str
    financial_year: int
    description: str = ""
    lines: List[BudgetLineIn] = []
    status: str = "draft"


def budget_public(b):
    return {
        "id": str(b["_id"]),
        "condominium_id": b["condominium_id"],
        "financial_year": b["financial_year"],
        "description": b.get("description", ""),
        "status": b.get("status", "draft"),
        "approval_date": b.get("approval_date"),
        "approved_by": b.get("approved_by"),
        "total_amount": from_cents(b.get("total_amount_cents", 0)),
        "lines": [{"category": l["category"], "description": l.get("description", ""),
                   "amount": from_cents(l["amount_cents"])} for l in b.get("lines", [])],
    }


@router.get("/budgets")
async def list_budgets(condominium_id: Optional[str] = None, user=Depends(get_current_user)):
    base = {"condominium_id": condominium_id} if condominium_id else {}
    return [budget_public(b) async for b in db.budgets.find(org_filter(user, base)).sort("financial_year", -1)]


@router.post("/budgets")
async def create_budget(payload: BudgetIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id)
    lines = [{"category": l.category, "description": l.description, "amount_cents": to_cents(l.amount)}
             for l in payload.lines]
    total = sum(l["amount_cents"] for l in lines)
    doc = {"condominium_id": payload.condominium_id, "financial_year": payload.financial_year,
           "description": payload.description, "lines": lines, "total_amount_cents": total,
           "status": payload.status, "approval_date": None, "approved_by": None,
           "organization_id": user["organization_id"], "created_by": user["id"],
           "created_at": now_utc().isoformat()}
    res = await db.budgets.insert_one(doc)
    doc["_id"] = res.inserted_id
    await audit(user, "create", "budget", str(res.inserted_id),
                {"year": payload.financial_year, "total": from_cents(total)})
    return budget_public(doc)


@router.post("/budgets/{bid}/approve")
async def approve_budget(bid: str, user=Depends(require_staff)):
    b = await db.budgets.find_one(org_filter(user, {"_id": oid(bid)}))
    if not b:
        raise HTTPException(status_code=404, detail="Orçamento não encontrado")
    await db.budgets.update_one({"_id": oid(bid)}, {"$set": {
        "status": "approved", "approval_date": now_utc().isoformat(), "approved_by": user["name"]}})
    await audit(user, "approve", "budget", bid)
    return budget_public(await db.budgets.find_one({"_id": oid(bid)}))


# ----------------------------------------------------------------------------
# GENERATE QUOTAS (idempotent)
# ----------------------------------------------------------------------------
class GenerateQuotasIn(BaseModel):
    condominium_id: str
    config_id: str
    financial_year: int
    start_month: int = 1
    end_month: int = 12


def freq_step(frequency):
    return {"monthly": 1, "quarterly": 3, "annual": 12}.get(frequency, 1)


async def _generate(user, condo_id, config, year, start_month, end_month):
    """Core quota generation, idempotent by generation_key per fraction+period.

    - FIXED_AMOUNT: `amount` is the amount per period.
    - PERMILAGE: `amount` is the ANNUAL budget; each fraction pays its ‰ share,
      split evenly across the year's periods (remainder on the first period).
    - FRACTION_SPECIFIC: per-period amount taken from fraction_amounts_cents.
    - MANUAL: not auto-generated.
    """
    fractions = [f async for f in db.fractions.find({"condominium_id": condo_id})]
    method = config["calculation_method"]
    frequency = config.get("frequency", "monthly")
    step = freq_step(frequency)
    periods_per_year = max(1, 12 // step)
    due_day = int(config.get("due_day", 8) or 8)
    ctype = config.get("charge_type", "REGULAR_QUOTA")
    created, skipped = 0, 0

    for frac in fractions:
        fid = str(frac["_id"])
        if method == "FIXED_AMOUNT":
            full = [config["amount_cents"]] * periods_per_year
        elif method == "PERMILAGE":
            annual_share = permillage_cents(config["amount_cents"], frac.get("permillage", 0))
            full = split_periods(annual_share, periods_per_year)
        elif method == "FRACTION_SPECIFIC":
            amt = config.get("fraction_amounts_cents", {}).get(fid, 0)
            full = [amt] * periods_per_year
        else:
            full = [0] * periods_per_year

        for month in range(start_month, end_month + 1, step):
            if month > 12:
                break
            period_index = min((month - 1) // step, periods_per_year - 1)
            amt = full[period_index] if period_index < len(full) else 0
            if amt <= 0:
                continue
            gkey = f"{condo_id}:{year}:{str(config['_id'])}:{month}:{fid}"
            if await db.transactions.find_one({"generation_key": gkey}):
                skipped += 1
                continue
            due = datetime(year, month, min(due_day, 28), tzinfo=timezone.utc)
            label = f"{config['name']} {MONTHS_PT[month]}/{year}"
            await post_transaction(
                user, condominium_id=condo_id, transaction_type=TX_CHARGE,
                amount_cents=amt, fraction_id=fid, owner_id=frac.get("owner_id"),
                charge_type=ctype, date=due, due_date=due, description=label,
                reference=f"{ctype[:3]}-{year}{month:02d}", generation_key=gkey,
                period_year=year, period_month=month)
            created += 1
    return created, skipped


@router.post("/generate-quotas")
async def generate_quotas(payload: GenerateQuotasIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id)
    config = await db.charge_configs.find_one(org_filter(user, {"_id": oid(payload.config_id)}))
    if not config:
        raise HTTPException(status_code=404, detail="Configuração não encontrada")
    created, skipped = await _generate(user, payload.condominium_id, config,
                                       payload.financial_year, payload.start_month, payload.end_month)
    await audit(user, "generate_quotas", "condominium", payload.condominium_id,
                {"year": payload.financial_year, "created": created, "skipped": skipped})
    return {"created": created, "skipped": skipped,
            "message": f"{created} encargos gerados, {skipped} já existiam (ignorados)."}


# ----------------------------------------------------------------------------
# TRANSACTIONS LEDGER
# ----------------------------------------------------------------------------
@router.get("/transactions")
async def list_transactions(user=Depends(get_current_user),
                            condominium_id: Optional[str] = None,
                            fraction_id: Optional[str] = None,
                            owner_id: Optional[str] = None,
                            transaction_type: Optional[str] = None,
                            search: Optional[str] = None):
    base = {}
    if condominium_id:
        base["condominium_id"] = condominium_id
    if fraction_id:
        base["fraction_id"] = fraction_id
    if transaction_type:
        base["transaction_type"] = transaction_type
    if user.get("role") == ROLE_OWNER:
        base["owner_id"] = user.get("owner_id")
        base["condominium_id"] = user.get("condominium_id")
    elif owner_id:
        base["owner_id"] = owner_id

    txns = [t async for t in db.transactions.find(org_filter(user, base)).sort("date", -1)]
    pm = await paid_map_for(org_filter(user, {k: base[k] for k in ("condominium_id", "fraction_id", "owner_id") if k in base}))
    fmap = {str(f["_id"]): f["identifier"] async for f in db.fractions.find(org_filter(user))}
    cmap = {str(c["_id"]): c["name"] async for c in db.condominiums.find(org_filter(user))}
    out = []
    for t in txns:
        pub = tx_public(t, pm)
        if search and search.lower() not in (pub["description"] + pub["reference"]).lower():
            continue
        pub["fraction_identifier"] = fmap.get(t.get("fraction_id"), "—")
        pub["condominium_name"] = cmap.get(t.get("condominium_id"), "—")
        out.append(pub)
    return out


class ManualChargeIn(BaseModel):
    condominium_id: str
    fraction_id: str
    charge_type: str = "OTHER"
    description: str = ""
    amount: float
    due_date: Optional[str] = None
    reference: str = ""


@router.post("/charges")
async def create_charge(payload: ManualChargeIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id, fraction_id=payload.fraction_id)
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="O montante deve ser positivo")
    frac = await db.fractions.find_one({"_id": oid(payload.fraction_id)})
    due = parse_dt(payload.due_date) or now_utc()
    t = await post_transaction(user, condominium_id=payload.condominium_id, transaction_type=TX_CHARGE,
                               amount_cents=to_cents(payload.amount), fraction_id=payload.fraction_id,
                               owner_id=frac.get("owner_id") if frac else None,
                               charge_type=payload.charge_type, date=due, due_date=due,
                               description=payload.description or "Encargo manual", reference=payload.reference)
    await audit(user, "create_charge", "transaction", str(t["_id"]), {"amount": payload.amount})
    return tx_public(t, {})


class CreditIn(BaseModel):
    condominium_id: str
    fraction_id: str
    description: str = ""
    amount: float


@router.post("/credits")
async def create_credit(payload: CreditIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id, fraction_id=payload.fraction_id)
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="O montante deve ser positivo")
    frac = await db.fractions.find_one({"_id": oid(payload.fraction_id)})
    t = await post_transaction(user, condominium_id=payload.condominium_id, transaction_type=TX_CREDIT,
                               amount_cents=to_cents(payload.amount), fraction_id=payload.fraction_id,
                               owner_id=frac.get("owner_id") if frac else None,
                               description=payload.description or "Nota de crédito")
    await audit(user, "create_credit", "transaction", str(t["_id"]), {"amount": payload.amount})
    return tx_public(t, {})


@router.post("/transactions/{tid}/reverse")
async def reverse_transaction(tid: str, user=Depends(require_staff)):
    orig = await db.transactions.find_one(org_filter(user, {"_id": oid(tid)}))
    if not orig:
        raise HTTPException(status_code=404, detail="Transação não encontrada")
    if orig.get("reversed"):
        raise HTTPException(status_code=400, detail="Transação já foi revertida")
    if orig["transaction_type"] not in (TX_CHARGE, TX_PAYMENT, TX_CREDIT, TX_ADJUSTMENT):
        raise HTTPException(status_code=400, detail="Tipo de transação não pode ser revertido")
    # reversal moves the amount to the opposite side
    was_debit = orig.get("debit_cents", 0) > 0
    rev_type = TX_REVERSAL
    amount = orig.get("amount_cents", 0)
    # If original was a debit (charge), reversal must credit; use ADJUSTMENT-signed via REVERSAL
    doc = {
        "organization_id": orig["organization_id"], "condominium_id": orig["condominium_id"],
        "fraction_id": orig.get("fraction_id"), "owner_id": orig.get("owner_id"),
        "transaction_type": TX_REVERSAL, "charge_type": orig.get("charge_type", ""),
        "date": now_utc().isoformat(), "due_date": None,
        "description": f"Reversão de: {orig.get('description', '')}",
        "reference": f"REV-{tid[-6:]}",
        "debit_cents": 0 if was_debit else amount,
        "credit_cents": amount if was_debit else 0,
        "amount_cents": amount, "related_transaction_id": tid, "reversed": False,
        "created_by": user["id"], "created_by_name": user["name"], "created_at": now_utc().isoformat(),
    }
    res = await db.transactions.insert_one(doc)
    await db.transactions.update_one({"_id": oid(tid)}, {"$set": {"reversed": True}})
    await audit(user, "reverse", "transaction", tid,
                {"reversal_id": str(res.inserted_id), "amount": from_cents(amount)})
    doc["_id"] = res.inserted_id
    return tx_public(doc, {})


# ----------------------------------------------------------------------------
# PAYMENTS + ALLOCATION
# ----------------------------------------------------------------------------
class AllocationIn(BaseModel):
    charge_id: str
    amount: float


class PaymentIn(BaseModel):
    condominium_id: str
    fraction_id: str
    amount: float
    date: Optional[str] = None
    method: str = "transferencia"
    bank_reference: str = ""
    description: str = ""
    notes: str = ""
    allocation_method: str = "oldest_first"  # oldest_first | manual
    allocations: List[AllocationIn] = []


async def _next_receipt_number():
    year = now_utc().year
    counter = await db.counters.find_one_and_update(
        {"_id": f"receipt_{year}"}, {"$inc": {"seq": 1}},
        upsert=True, return_document=True)
    seq = counter["seq"] if counter else 1
    return f"REC-{year}-{seq:05d}"


@router.post("/payments")
async def create_payment(payload: PaymentIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id, fraction_id=payload.fraction_id)
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="O pagamento deve ser positivo")
    amount_cents = to_cents(payload.amount)
    frac = await db.fractions.find_one({"_id": oid(payload.fraction_id)})
    if not frac:
        raise HTTPException(status_code=404, detail="Fração não encontrada")
    owner_id = frac.get("owner_id")
    pdate = parse_dt(payload.date) or now_utc()

    # compute allocations
    allocations = []
    remaining = amount_cents
    if payload.allocation_method == "manual" and payload.allocations:
        for a in payload.allocations:
            c = to_cents(a.amount)
            if c <= 0:
                continue
            allocations.append({"charge_id": a.charge_id, "amount_cents": min(c, remaining)})
            remaining -= min(c, remaining)
            if remaining <= 0:
                break
    else:
        for charge, out_cents in await outstanding_charges(payload.fraction_id):
            if remaining <= 0:
                break
            alloc = min(remaining, out_cents)
            allocations.append({"charge_id": str(charge["_id"]), "amount_cents": alloc})
            remaining -= alloc
    credit_remaining = remaining  # overpayment kept as credit balance

    receipt_number = await _next_receipt_number()
    # 1) ledger credit transaction
    tx = await post_transaction(user, condominium_id=payload.condominium_id, transaction_type=TX_PAYMENT,
                                amount_cents=amount_cents, fraction_id=payload.fraction_id,
                                owner_id=owner_id, date=pdate,
                                description=payload.description or f"Recebimento ({payload.method})",
                                reference=payload.bank_reference or receipt_number)
    # 2) payment record (compensate on failure)
    try:
        pdoc = {
            "organization_id": user["organization_id"], "condominium_id": payload.condominium_id,
            "fraction_id": payload.fraction_id, "owner_id": owner_id,
            "date": pdate.isoformat(), "amount_cents": amount_cents, "method": payload.method,
            "bank_reference": payload.bank_reference, "description": payload.description,
            "notes": payload.notes, "receipt_number": receipt_number,
            "allocation_method": payload.allocation_method, "allocations": allocations,
            "credit_remaining_cents": credit_remaining, "transaction_id": str(tx["_id"]),
            "created_by": user["id"], "created_by_name": user["name"], "created_at": now_utc().isoformat(),
        }
        pres = await db.payments.insert_one(pdoc)
    except Exception:
        await db.transactions.delete_one({"_id": tx["_id"]})
        raise HTTPException(status_code=500, detail="Falha ao registar pagamento")
    await db.transactions.update_one({"_id": tx["_id"]}, {"$set": {"payment_id": str(pres.inserted_id)}})
    await audit(user, "register_payment", "payment", str(pres.inserted_id),
                {"amount": payload.amount, "allocations": len(allocations),
                 "credit_remaining": from_cents(credit_remaining)})
    return {"id": str(pres.inserted_id), "receipt_number": receipt_number,
            "amount": from_cents(amount_cents), "allocated": from_cents(amount_cents - credit_remaining),
            "credit_remaining": from_cents(credit_remaining), "allocations": len(allocations)}


@router.get("/payments")
async def list_payments(user=Depends(get_current_user), condominium_id: Optional[str] = None):
    base = {}
    if condominium_id:
        base["condominium_id"] = condominium_id
    if user.get("role") == ROLE_OWNER:
        base["owner_id"] = user.get("owner_id")
    fmap = {str(f["_id"]): f["identifier"] async for f in db.fractions.find(org_filter(user))}
    cmap = {str(c["_id"]): c["name"] async for c in db.condominiums.find(org_filter(user))}
    out = []
    async for p in db.payments.find(org_filter(user, base)).sort("date", -1):
        out.append({
            "id": str(p["_id"]), "date": p["date"], "amount": from_cents(p["amount_cents"]),
            "method": p.get("method"), "receipt_number": p.get("receipt_number"),
            "bank_reference": p.get("bank_reference", ""), "description": p.get("description", ""),
            "credit_remaining": from_cents(p.get("credit_remaining_cents", 0)),
            "fraction_id": p.get("fraction_id"), "condominium_id": p.get("condominium_id"),
            "fraction_identifier": fmap.get(p.get("fraction_id"), "—"),
            "condominium_name": cmap.get(p.get("condominium_id"), "—"),
        })
    return out


# ----------------------------------------------------------------------------
# CONTA CORRENTE (account statement by fraction)
# ----------------------------------------------------------------------------
@router.get("/statement/{fraction_id}")
async def statement(fraction_id: str, user=Depends(get_current_user),
                    date_from: Optional[str] = None, date_to: Optional[str] = None):
    await owner_guard(user, fraction_id=fraction_id)
    frac = await db.fractions.find_one(org_filter(user, {"_id": oid(fraction_id)}))
    if not frac:
        raise HTTPException(status_code=404, detail="Fração não encontrada")
    condo = await db.condominiums.find_one({"_id": oid(frac["condominium_id"])})
    owner = await db.owners.find_one({"_id": oid(frac["owner_id"])}) if frac.get("owner_id") else None
    pm = await paid_map_for({"fraction_id": fraction_id})
    txns = [t async for t in db.transactions.find({"fraction_id": fraction_id}).sort("date", 1)]
    df, dt = parse_dt(date_from), parse_dt(date_to)
    rows = []
    running = 0
    for t in txns:
        running += t.get("debit_cents", 0) - t.get("credit_cents", 0)
        d = parse_dt(t.get("date"))
        if df and d and d < df:
            continue
        if dt and d and d > dt:
            continue
        pub = tx_public(t, pm)
        pub["balance"] = from_cents(running)
        rows.append(pub)
    balance = await fraction_balance_cents(fraction_id)
    return {
        "fraction": {"id": fraction_id, "identifier": frac["identifier"],
                     "permillage": frac.get("permillage", 0)},
        "condominium": {"name": condo["name"] if condo else "", "address": condo.get("address", "") if condo else ""},
        "owner": {"name": owner["name"] if owner else "—", "nif": owner.get("nif", "") if owner else ""},
        "rows": rows, "balance": from_cents(balance),
        "outstanding": from_cents(max(0, balance)),
        "credit": from_cents(max(0, -balance)),
    }


# ----------------------------------------------------------------------------
# DEBT / AGING
# ----------------------------------------------------------------------------
AGING_BUCKETS = [("current", -10**9, 0), ("1-30", 1, 30), ("31-60", 31, 60),
                 ("61-90", 61, 90), ("91-180", 91, 180), ("181-365", 181, 365),
                 ("365+", 366, 10**9)]


async def compute_aging(user, condo_ids):
    now = now_utc()
    buckets = {k: 0 for k, _, _ in AGING_BUCKETS}
    match = org_filter(user, {"condominium_id": {"$in": condo_ids}, "transaction_type": TX_CHARGE})
    pm = await paid_map_for(org_filter(user, {"condominium_id": {"$in": condo_ids}}))
    async for t in db.transactions.find(match):
        if t.get("reversed"):
            continue
        rem = t.get("amount_cents", 0) - pm.get(str(t["_id"]), 0)
        if rem <= 0:
            continue
        due = parse_dt(t.get("due_date")) or parse_dt(t.get("date")) or now
        days = (now - due).days
        for k, lo, hi in AGING_BUCKETS:
            if k == "current":
                if days <= 0:
                    buckets[k] += rem
                    break
            elif lo <= days <= hi:
                buckets[k] += rem
                break
    return buckets


async def _scope_condos(user, condominium_id=None):
    cf = org_filter(user)
    if condominium_id:
        cf["_id"] = oid(condominium_id)
    condos = [str(c["_id"]) async for c in db.condominiums.find(cf)]
    if user.get("role") == ROLE_OWNER:
        condos = [c for c in condos if c == user.get("condominium_id")]
    return condos


@router.get("/aging")
async def aging(user=Depends(get_current_user), condominium_id: Optional[str] = None):
    condos = await _scope_condos(user, condominium_id)
    buckets = await compute_aging(user, condos)
    return {"buckets": [{"bucket": k, "amount": from_cents(v)} for k, v in buckets.items()],
            "total": from_cents(sum(buckets.values()))}


@router.get("/debts")
async def debts(user=Depends(get_current_user), condominium_id: Optional[str] = None):
    """Per-fraction outstanding list."""
    condos = await _scope_condos(user, condominium_id)
    fmap = {str(f["_id"]): f async for f in db.fractions.find(org_filter(user, {"condominium_id": {"$in": condos}}))}
    omap = {str(o["_id"]): o["name"] async for o in db.owners.find(org_filter(user))}
    cmap = {str(c["_id"]): c["name"] async for c in db.condominiums.find(org_filter(user))}
    out = []
    for fid, frac in fmap.items():
        bal = await fraction_balance_cents(fid)
        if bal <= 0:
            continue
        # oldest overdue days
        oc = await outstanding_charges(fid)
        oldest_days = 0
        if oc:
            due = parse_dt(oc[0][0].get("due_date")) or now_utc()
            oldest_days = max(0, (now_utc() - due).days)
        out.append({"fraction_id": fid, "fraction_identifier": frac["identifier"],
                    "condominium_name": cmap.get(frac["condominium_id"], "—"),
                    "owner_name": omap.get(frac.get("owner_id"), "—"),
                    "balance": from_cents(bal), "days_overdue": oldest_days})
    out.sort(key=lambda x: x["balance"], reverse=True)
    return out


# ----------------------------------------------------------------------------
# DASHBOARD (finance)
# ----------------------------------------------------------------------------
@router.get("/dashboard")
async def finance_dashboard(user=Depends(get_current_user), condominium_id: Optional[str] = None):
    condos = await _scope_condos(user, condominium_id)
    cmap = {str(c["_id"]): c["name"] async for c in db.condominiums.find(org_filter(user)) if str(c["_id"]) in condos}
    fractions = [f async for f in db.fractions.find(org_filter(user, {"condominium_id": {"$in": condos}}))]
    owners_count = await db.owners.count_documents(org_filter(user, {"condominium_id": {"$in": condos}}))

    # balances per fraction
    bal_by_frac = {}
    for f in fractions:
        bal_by_frac[str(f["_id"])] = await fraction_balance_cents(str(f["_id"]))
    receivable = sum(v for v in bal_by_frac.values() if v > 0)
    credit_total = sum(-v for v in bal_by_frac.values() if v < 0)
    in_debt = sum(1 for v in bal_by_frac.values() if v > 0)
    no_debt = sum(1 for v in bal_by_frac.values() if v <= 0)

    now = now_utc()
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    txns = [t async for t in db.transactions.find(org_filter(user, {"condominium_id": {"$in": condos}}))]
    received_month = charged_month = 0
    total_received = total_charged = 0
    for t in txns:
        d = parse_dt(t.get("date")) or now
        if t["transaction_type"] == TX_PAYMENT:
            total_received += t.get("credit_cents", 0)
            if d >= month_start:
                received_month += t.get("credit_cents", 0)
        if t["transaction_type"] == TX_CHARGE and not t.get("reversed"):
            total_charged += t.get("debit_cents", 0)
            if d >= month_start:
                charged_month += t.get("debit_cents", 0)

    # expenses
    exp_match = org_filter(user, {"condominium_id": {"$in": condos}})
    total_expenses = 0
    expenses_month = 0
    async for e in db.expenses.find(exp_match):
        total_expenses += e.get("amount_cents", 0) + e.get("vat_cents", 0)
        d = parse_dt(e.get("date")) or now
        if d >= month_start:
            expenses_month += e.get("amount_cents", 0) + e.get("vat_cents", 0)

    # 6-month series
    seq = []
    y, mo = now.year, now.month
    for i in range(5, -1, -1):
        mm, yy = mo - i, y
        while mm <= 0:
            mm += 12; yy -= 1
        seq.append((yy, mm))
    income_s = {k: 0 for k in seq}
    charge_s = {k: 0 for k in seq}
    exp_s = {k: 0 for k in seq}
    for t in txns:
        d = parse_dt(t.get("date"))
        if not d:
            continue
        key = (d.year, d.month)
        if key in income_s:
            if t["transaction_type"] == TX_PAYMENT:
                income_s[key] += t.get("credit_cents", 0)
            if t["transaction_type"] == TX_CHARGE and not t.get("reversed"):
                charge_s[key] += t.get("debit_cents", 0)
    async for e in db.expenses.find(exp_match):
        d = parse_dt(e.get("date"))
        if d and (d.year, d.month) in exp_s:
            exp_s[(d.year, d.month)] += e.get("amount_cents", 0) + e.get("vat_cents", 0)
    monthly = [{"month": MONTHS_PT[m], "recebido": from_cents(income_s[(yy, m)]),
                "faturado": from_cents(charge_s[(yy, m)]), "despesas": from_cents(exp_s[(yy, m)]),
                "fluxo": from_cents(income_s[(yy, m)] - exp_s[(yy, m)])} for (yy, m) in seq]

    buckets = await compute_aging(user, condos)
    outstanding_by_condo = defaultdict(int)
    for f in fractions:
        b = bal_by_frac[str(f["_id"])]
        if b > 0:
            outstanding_by_condo[f["condominium_id"]] += b

    recent_payments = [tx_public(t) for t in sorted(
        [t for t in txns if t["transaction_type"] == TX_PAYMENT],
        key=lambda x: x.get("date", ""), reverse=True)[:6]]

    return {
        "totals": {
            "condominiums": len(condos), "fractions": len(fractions), "owners": owners_count,
            "receivable": from_cents(receivable), "credit_balance": from_cents(credit_total),
            "total_received": from_cents(total_received), "total_charged": from_cents(total_charged),
            "overdue": from_cents(sum(v for k, v in buckets.items() if k != "current")),
            "expenses_total": from_cents(total_expenses), "expenses_month": from_cents(expenses_month),
            "received_month": from_cents(received_month), "charged_month": from_cents(charged_month),
            "cashflow_month": from_cents(received_month - expenses_month),
            "fractions_in_debt": in_debt, "fractions_no_debt": no_debt,
        },
        "monthly": monthly,
        "debt_aging": [{"bucket": k, "amount": from_cents(v)} for k, v in buckets.items()],
        "outstanding_by_condo": [{"name": cmap.get(cid, "—"), "valor": from_cents(v)}
                                 for cid, v in outstanding_by_condo.items()],
        "recent_payments": recent_payments,
    }


@router.get("/owner-summary")
async def owner_summary(user=Depends(get_current_user)):
    """Personalized summary for a condómino: own fractions, balances, next due,
    recent payments and condominium info. Strictly own-owner scoped."""
    if user.get("role") != ROLE_OWNER or not user.get("owner_id"):
        raise HTTPException(status_code=403, detail="Apenas disponível para condóminos")
    now = now_utc()
    fractions = [f async for f in db.fractions.find(
        org_filter(user, {"owner_id": user["owner_id"]})).sort("identifier", 1)]
    cmap = {str(c["_id"]): c async for c in db.condominiums.find(org_filter(user))}

    frac_rows = []
    total_balance = 0
    next_due = None
    for f in fractions:
        fid = str(f["_id"])
        bal = await fraction_balance_cents(fid)
        total_balance += bal
        oc = await outstanding_charges(fid)
        overdue_cents = 0
        for t, rem in oc:
            due = parse_dt(t.get("due_date")) or parse_dt(t.get("date")) or now
            if due < now:
                overdue_cents += rem
            if next_due is None or (parse_dt(t.get("due_date")) or now) < parse_dt(next_due["due_date"]):
                next_due = {"due_date": t.get("due_date") or t.get("date"),
                            "amount": from_cents(rem), "description": t.get("description", "Quota"),
                            "fraction_identifier": f["identifier"]}
        condo = cmap.get(f.get("condominium_id"))
        frac_rows.append({
            "id": fid, "identifier": f["identifier"], "permillage": f.get("permillage", 0),
            "condominium_id": f.get("condominium_id"),
            "condominium_name": condo["name"] if condo else "—",
            "balance": from_cents(bal), "outstanding": from_cents(max(0, bal)),
            "credit": from_cents(max(0, -bal)), "overdue": from_cents(overdue_cents),
        })

    my_condos = [{"id": str(c["_id"]), "name": c["name"], "address": c.get("address", ""),
                  "city": c.get("city", ""), "postal_code": c.get("postal_code", "")}
                 for cid, c in cmap.items() if any(fr["condominium_id"] == cid for fr in frac_rows)]

    recent_payments = []
    async for p in db.payments.find(org_filter(user, {"owner_id": user["owner_id"]})).sort("date", -1).limit(5):
        recent_payments.append({"id": str(p["_id"]), "date": p["date"],
                                "amount": from_cents(p["amount_cents"]),
                                "method": p.get("method"), "receipt_number": p.get("receipt_number")})

    unread_comms = await db.communications.count_documents(
        org_filter(user, {"recipient_owner_ids": user["owner_id"]}))
    open_occurrences = await db.occurrences.count_documents(org_filter(user, {
        "condominium_id": user.get("condominium_id"),
        "fraction_id": {"$in": [fr["id"] for fr in frac_rows]},
        "status": {"$nin": ["resolved", "closed"]}}))

    return {
        "owner_name": user.get("name"),
        "totals": {
            "balance": from_cents(total_balance),
            "outstanding": from_cents(max(0, total_balance)),
            "credit": from_cents(max(0, -total_balance)),
            "fractions": len(frac_rows),
        },
        "next_due": next_due,
        "fractions": frac_rows,
        "condominiums": my_condos,
        "recent_payments": recent_payments,
        "counts": {"communications": unread_comms, "open_occurrences": open_occurrences},
    }
class SupplierIn(BaseModel):
    name: str
    nif: str = ""
    contact_person: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""
    iban: str = ""
    services: str = ""
    condominium_ids: List[str] = []


@router.get("/suppliers")
async def list_suppliers(user=Depends(require_staff)):
    out = []
    async for s in db.suppliers.find(org_filter(user)).sort("name", 1):
        d = {k: v for k, v in s.items() if k != "_id"}
        d["id"] = str(s["_id"])
        out.append(d)
    return out


@router.post("/suppliers")
async def create_supplier(payload: SupplierIn, user=Depends(require_staff)):
    doc = payload.model_dump()
    doc.update({"organization_id": user["organization_id"], "created_by": user["id"],
                "created_at": now_utc().isoformat()})
    res = await db.suppliers.insert_one(doc)
    await audit(user, "create", "supplier", str(res.inserted_id), {"name": payload.name})
    return {"id": str(res.inserted_id), **payload.model_dump()}


# ----------------------------------------------------------------------------
# EXPENSES
# ----------------------------------------------------------------------------
class ExpenseIn(BaseModel):
    condominium_id: str
    supplier_id: Optional[str] = None
    supplier_name: str = ""
    description: str = ""
    category: str = "Outro"
    amount: float
    vat: float = 0.0
    invoice_number: str = ""
    payment_status: str = "pendente"
    date: Optional[str] = None
    due_date: Optional[str] = None
    notes: str = ""


@router.get("/expenses")
async def list_expenses(user=Depends(get_current_user), condominium_id: Optional[str] = None):
    base = {"condominium_id": condominium_id} if condominium_id else {}
    cmap = {str(c["_id"]): c["name"] async for c in db.condominiums.find(org_filter(user))}
    out = []
    async for e in db.expenses.find(org_filter(user, base)).sort("date", -1):
        out.append({
            "id": str(e["_id"]), "condominium_id": e["condominium_id"],
            "condominium_name": cmap.get(e["condominium_id"], "—"),
            "supplier_name": e.get("supplier_name", ""), "description": e.get("description", ""),
            "category": e.get("category", ""), "amount": from_cents(e.get("amount_cents", 0)),
            "vat": from_cents(e.get("vat_cents", 0)),
            "total": from_cents(e.get("amount_cents", 0) + e.get("vat_cents", 0)),
            "invoice_number": e.get("invoice_number", ""), "payment_status": e.get("payment_status", ""),
            "date": e.get("date"), "due_date": e.get("due_date"),
        })
    return out


@router.post("/expenses")
async def create_expense(payload: ExpenseIn, user=Depends(require_staff)):
    await owner_guard(user, condominium_id=payload.condominium_id)
    if payload.amount <= 0:
        raise HTTPException(status_code=400, detail="O montante deve ser positivo")
    doc = {
        "organization_id": user["organization_id"], "condominium_id": payload.condominium_id,
        "supplier_id": payload.supplier_id, "supplier_name": payload.supplier_name,
        "description": payload.description, "category": payload.category,
        "amount_cents": to_cents(payload.amount), "vat_cents": to_cents(payload.vat),
        "invoice_number": payload.invoice_number, "payment_status": payload.payment_status,
        "date": (parse_dt(payload.date) or now_utc()).isoformat(),
        "due_date": payload.due_date, "notes": payload.notes,
        "created_by": user["id"], "created_by_name": user["name"], "created_at": now_utc().isoformat(),
    }
    res = await db.expenses.insert_one(doc)
    await audit(user, "create", "expense", str(res.inserted_id),
                {"amount": payload.amount, "category": payload.category})
    return {"id": str(res.inserted_id), "total": from_cents(doc["amount_cents"] + doc["vat_cents"])}


# ----------------------------------------------------------------------------
# BANK ACCOUNTS (basic + reconciliation-ready)
# ----------------------------------------------------------------------------
class BankAccountIn(BaseModel):
    condominium_id: str
    bank: str
    iban: str
    account_name: str = ""
    account_number: str = ""
    active: bool = True


def mask_iban(iban):
    if not iban or len(iban) < 8:
        return iban
    return iban[:4] + "•" * (len(iban) - 8) + iban[-4:]


@router.get("/bank-accounts")
async def list_bank_accounts(user=Depends(get_current_user), condominium_id: Optional[str] = None):
    base = {"condominium_id": condominium_id} if condominium_id else {}
    out = []
    async for b in db.bank_accounts.find(org_filter(user, base)):
        # only staff sees full IBAN
        full = user.get("role") != ROLE_OWNER
        out.append({"id": str(b["_id"]), "condominium_id": b["condominium_id"], "bank": b.get("bank"),
                    "iban": b.get("iban") if full else mask_iban(b.get("iban")),
                    "account_name": b.get("account_name", ""), "active": b.get("active", True)})
    return out


@router.post("/bank-accounts")
async def create_bank_account(payload: BankAccountIn, user=Depends(require_staff)):
    doc = payload.model_dump()
    doc.update({"organization_id": user["organization_id"], "created_at": now_utc().isoformat()})
    res = await db.bank_accounts.insert_one(doc)
    await audit(user, "create", "bank_account", str(res.inserted_id), {"bank": payload.bank})
    return {"id": str(res.inserted_id), **payload.model_dump()}


# ----------------------------------------------------------------------------
# REPORTS
# ----------------------------------------------------------------------------
@router.get("/reports/{report}")
async def report(report: str, user=Depends(get_current_user),
                 condominium_id: Optional[str] = None, fmt: str = "json"):
    condos = await _scope_condos(user, condominium_id)
    cmap = {str(c["_id"]): c["name"] async for c in db.condominiums.find(org_filter(user))}
    fmap = {str(f["_id"]): f async for f in db.fractions.find(org_filter(user, {"condominium_id": {"$in": condos}}))}
    omap = {str(o["_id"]): o async for o in db.owners.find(org_filter(user))}
    rows, columns, title = [], [], report

    if report == "receivable":
        title = "Valores a Receber"
        columns = ["Condomínio", "Fração", "Condómino", "Saldo (€)"]
        for fid, f in fmap.items():
            bal = await fraction_balance_cents(fid)
            if bal > 0:
                rows.append([cmap.get(f["condominium_id"], "—"), f["identifier"],
                             omap.get(f.get("owner_id"), {}).get("name", "—"), from_cents(bal)])
    elif report == "owner_debt":
        title = "Dívida por Condómino"
        columns = ["Condómino", "NIF", "Frações", "Saldo (€)"]
        agg = defaultdict(lambda: {"n": 0, "bal": 0})
        for fid, f in fmap.items():
            oid_ = f.get("owner_id")
            if not oid_:
                continue
            agg[oid_]["n"] += 1
            agg[oid_]["bal"] += await fraction_balance_cents(fid)
        for oid_, v in agg.items():
            if v["bal"] > 0:
                o = omap.get(oid_, {})
                rows.append([o.get("name", "—"), o.get("nif", ""), v["n"], from_cents(v["bal"])])
    elif report == "payments":
        title = "Recebimentos"
        columns = ["Data", "Recibo", "Condomínio", "Fração", "Método", "Montante (€)"]
        async for p in db.payments.find(org_filter(user, {"condominium_id": {"$in": condos}})).sort("date", -1):
            f = fmap.get(p.get("fraction_id"), {})
            rows.append([p["date"][:10], p.get("receipt_number", ""), cmap.get(p["condominium_id"], "—"),
                         f.get("identifier", "—"), p.get("method", ""), from_cents(p["amount_cents"])])
    elif report == "charges":
        title = "Encargos Emitidos"
        columns = ["Data", "Condomínio", "Fração", "Descrição", "Montante (€)", "Estado"]
        pm = await paid_map_for(org_filter(user, {"condominium_id": {"$in": condos}}))
        async for t in db.transactions.find(org_filter(user, {"condominium_id": {"$in": condos}, "transaction_type": TX_CHARGE})).sort("date", -1):
            f = fmap.get(t.get("fraction_id"), {})
            rows.append([(t.get("date") or "")[:10], cmap.get(t["condominium_id"], "—"),
                         f.get("identifier", "—"), t.get("description", ""),
                         from_cents(t.get("amount_cents", 0)), charge_status(t, pm)])
    elif report == "expenses":
        title = "Despesas"
        columns = ["Data", "Condomínio", "Fornecedor", "Categoria", "Total (€)", "Estado"]
        async for e in db.expenses.find(org_filter(user, {"condominium_id": {"$in": condos}})).sort("date", -1):
            rows.append([(e.get("date") or "")[:10], cmap.get(e["condominium_id"], "—"),
                         e.get("supplier_name", ""), e.get("category", ""),
                         from_cents(e.get("amount_cents", 0) + e.get("vat_cents", 0)),
                         e.get("payment_status", "")])
    elif report == "income_vs_expenses":
        title = "Receitas vs Despesas"
        columns = ["Condomínio", "Recebido (€)", "Despesas (€)", "Resultado (€)"]
        for cid in condos:
            rec = 0
            async for t in db.transactions.find({"condominium_id": cid, "transaction_type": TX_PAYMENT}):
                rec += t.get("credit_cents", 0)
            exp = 0
            async for e in db.expenses.find({"condominium_id": cid}):
                exp += e.get("amount_cents", 0) + e.get("vat_cents", 0)
            rows.append([cmap.get(cid, "—"), from_cents(rec), from_cents(exp), from_cents(rec - exp)])
    elif report == "aging":
        title = "Antiguidade da Dívida"
        columns = ["Escalão", "Montante (€)"]
        buckets = await compute_aging(user, condos)
        rows = [[k, from_cents(v)] for k, v in buckets.items()]
    elif report == "condo_summary":
        title = "Resumo Financeiro por Condomínio"
        columns = ["Condomínio", "Frações", "A Receber (€)", "Recebido (€)", "Despesas (€)"]
        for cid in condos:
            fr = [f for f in fmap.values() if f["condominium_id"] == cid]
            recv = 0
            for f in fr:
                b = await fraction_balance_cents(str(f["_id"]))
                if b > 0:
                    recv += b
            rec = 0
            async for t in db.transactions.find({"condominium_id": cid, "transaction_type": TX_PAYMENT}):
                rec += t.get("credit_cents", 0)
            exp = 0
            async for e in db.expenses.find({"condominium_id": cid}):
                exp += e.get("amount_cents", 0) + e.get("vat_cents", 0)
            rows.append([cmap.get(cid, "—"), len(fr), from_cents(recv), from_cents(rec), from_cents(exp)])
    else:
        raise HTTPException(status_code=404, detail="Relatório desconhecido")

    if fmt == "csv":
        import csv
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(columns)
        for r in rows:
            w.writerow(r)
        return Response(content=buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f"attachment; filename={report}.csv"})
    return {"title": title, "columns": columns, "rows": rows}


# ----------------------------------------------------------------------------
# PDF: RECEIPT + PAYMENT NOTICE
# ----------------------------------------------------------------------------
def _pdf(elements_fn, filename):
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    elements_fn(c, A4, mm)
    c.showPage()
    c.save()
    buf.seek(0)
    return Response(content=buf.read(), media_type="application/pdf",
                    headers={"Content-Disposition": f"inline; filename={filename}"})


def eur(cents):
    v = from_cents(cents)
    s = f"{v:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return f"{s} €"


@router.get("/payments/{pid}/receipt")
async def payment_receipt(pid: str, user=Depends(get_current_user)):
    p = await db.payments.find_one(org_filter(user, {"_id": oid(pid)}))
    if not p:
        raise HTTPException(status_code=404, detail="Pagamento não encontrado")
    await owner_guard(user, condominium_id=p["condominium_id"], owner_id=p.get("owner_id"))
    condo = await db.condominiums.find_one({"_id": oid(p["condominium_id"])})
    frac = await db.fractions.find_one({"_id": oid(p["fraction_id"])})
    owner = await db.owners.find_one({"_id": oid(p["owner_id"])}) if p.get("owner_id") else None
    bal = await fraction_balance_cents(p["fraction_id"])

    def draw(c, size, mm):
        w, h = size
        y = h - 25 * mm
        c.setFont("Helvetica-Bold", 22); c.drawString(20 * mm, y, "DOMVUS")
        c.setFont("Helvetica", 9); c.drawRightString(w - 20 * mm, y, "RECIBO")
        c.setFont("Helvetica-Bold", 11); c.drawRightString(w - 20 * mm, y - 6 * mm, p.get("receipt_number", ""))
        y -= 16 * mm
        c.setLineWidth(0.5); c.line(20 * mm, y, w - 20 * mm, y); y -= 8 * mm
        c.setFont("Helvetica-Bold", 10); c.drawString(20 * mm, y, condo["name"] if condo else "")
        c.setFont("Helvetica", 9); y -= 5 * mm
        c.drawString(20 * mm, y, (condo.get("address", "") if condo else "")); y -= 10 * mm
        info = [("Condómino", owner["name"] if owner else "—"),
                ("Fração", frac["identifier"] if frac else "—"),
                ("Data", p["date"][:10]),
                ("Método", p.get("method", "")),
                ("Referência", p.get("bank_reference", "") or "—")]
        c.setFont("Helvetica", 10)
        for k, v in info:
            c.drawString(20 * mm, y, f"{k}:"); c.drawString(60 * mm, y, str(v)); y -= 6 * mm
        y -= 6 * mm
        c.setFont("Helvetica-Bold", 12)
        c.drawString(20 * mm, y, "Valor recebido"); c.drawRightString(w - 20 * mm, y, eur(p["amount_cents"])); y -= 8 * mm
        c.setFont("Helvetica", 10)
        c.drawString(20 * mm, y, "Saldo atual da fração")
        c.drawRightString(w - 20 * mm, y, eur(bal)); y -= 6 * mm
        if p.get("credit_remaining_cents", 0) > 0:
            c.drawString(20 * mm, y, "Crédito disponível")
            c.drawRightString(w - 20 * mm, y, eur(p["credit_remaining_cents"])); y -= 6 * mm
        c.setFont("Helvetica-Oblique", 8)
        c.drawString(20 * mm, 20 * mm, "Documento gerado por DOMVUS · Gestão de Condomínios")

    return _pdf(draw, f"recibo-{p.get('receipt_number', pid)}.pdf")


@router.get("/notice/{fraction_id}")
async def payment_notice(fraction_id: str, user=Depends(get_current_user)):
    await owner_guard(user, fraction_id=fraction_id)
    frac = await db.fractions.find_one(org_filter(user, {"_id": oid(fraction_id)}))
    if not frac:
        raise HTTPException(status_code=404, detail="Fração não encontrada")
    condo = await db.condominiums.find_one({"_id": oid(frac["condominium_id"])})
    owner = await db.owners.find_one({"_id": oid(frac["owner_id"])}) if frac.get("owner_id") else None
    ba = await db.bank_accounts.find_one({"condominium_id": frac["condominium_id"]})
    oc = await outstanding_charges(fraction_id)
    total = sum(rem for _, rem in oc)

    def draw(c, size, mm):
        w, h = size
        y = h - 25 * mm
        c.setFont("Helvetica-Bold", 22); c.drawString(20 * mm, y, "DOMVUS")
        c.setFont("Helvetica-Bold", 11); c.drawRightString(w - 20 * mm, y, "AVISO DE PAGAMENTO")
        y -= 16 * mm; c.line(20 * mm, y, w - 20 * mm, y); y -= 8 * mm
        c.setFont("Helvetica-Bold", 10); c.drawString(20 * mm, y, condo["name"] if condo else ""); y -= 6 * mm
        c.setFont("Helvetica", 9)
        c.drawString(20 * mm, y, f"Condómino: {owner['name'] if owner else '—'}   Fração: {frac['identifier']}"); y -= 10 * mm
        c.setFont("Helvetica-Bold", 9)
        c.drawString(20 * mm, y, "Descrição"); c.drawRightString(w - 20 * mm, y, "Em dívida"); y -= 5 * mm
        c.line(20 * mm, y, w - 20 * mm, y); y -= 6 * mm
        c.setFont("Helvetica", 9)
        for t, rem in oc[:20]:
            c.drawString(20 * mm, y, (t.get("description", "")[:60]))
            c.drawRightString(w - 20 * mm, y, eur(rem)); y -= 5.5 * mm
        y -= 4 * mm; c.line(20 * mm, y, w - 20 * mm, y); y -= 7 * mm
        c.setFont("Helvetica-Bold", 12)
        c.drawString(20 * mm, y, "Total a pagar"); c.drawRightString(w - 20 * mm, y, eur(total)); y -= 12 * mm
        c.setFont("Helvetica", 9)
        if ba:
            c.drawString(20 * mm, y, f"IBAN: {ba.get('iban', '')}"); y -= 5 * mm
        c.drawString(20 * mm, y, f"Referência: {frac['identifier']}-{now_utc().strftime('%Y%m')}")
        c.setFont("Helvetica-Oblique", 8)
        c.drawString(20 * mm, 20 * mm, "Documento gerado por DOMVUS · Gestão de Condomínios")

    return _pdf(draw, f"aviso-{frac['identifier']}.pdf")
