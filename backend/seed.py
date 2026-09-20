import os
import random
from datetime import datetime, timezone, timedelta

from database import db
from auth import hash_password, verify_password
from money import to_cents, from_cents
import finance
from finance import post_transaction, outstanding_charges, _generate, _next_receipt_number, now_utc, TX_CHARGE, TX_PAYMENT
from models import (
    ROLE_SUPER_ADMIN, ROLE_PROPERTY_MANAGER, ROLE_ADMIN_STAFF, ROLE_OWNER,
)

DEMO_PASSWORD = "Domvus2025!"
SEED_VERSION = 4

FIN_COLLECTIONS = ["condominiums", "fractions", "owners", "fraction_owners",
                   "transactions", "payments", "budgets", "charge_configs",
                   "charge_types", "expenses", "suppliers", "bank_accounts", "counters",
                   "occurrences", "occurrence_comments", "occurrence_status_history",
                   "maintenance", "contracts", "documents", "communications",
                   "communication_templates", "assemblies", "assembly_attendees",
                   "tasks", "notifications", "activities"]


def iso(dt):
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt.tzinfo is None else dt.isoformat()


async def seed():
    admin_email = os.environ.get("ADMIN_EMAIL", "master.marques@gmail.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", DEMO_PASSWORD)
    now = now_utc()

    org = await db.organizations.find_one({"slug": "domvus-gestao"})
    if not org:
        res = await db.organizations.insert_one({
            "name": "DOMVUS Gestão de Condomínios, Lda.", "slug": "domvus-gestao",
            "nif": "509874321", "city": "Lisboa", "seed_version": 0,
            "created_at": iso(now), "updated_at": iso(now)})
        org_id = str(res.inserted_id)
        org = {"_id": res.inserted_id, "seed_version": 0}
    else:
        org_id = str(org["_id"])

    # ---- super admin (real account) ----
    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        await db.users.insert_one({
            "email": admin_email, "password_hash": hash_password(admin_password),
            "name": "Rui Marques", "role": ROLE_SUPER_ADMIN, "token_version": 0,
            "organization_id": org_id, "condominium_id": None, "owner_id": None,
            "active": True, "created_at": iso(now), "updated_at": iso(now)})
    else:
        upd = {"organization_id": org_id, "role": ROLE_SUPER_ADMIN}
        if not verify_password(admin_password, existing_admin["password_hash"]):
            upd["password_hash"] = hash_password(admin_password)
        await db.users.update_one({"email": admin_email}, {"$set": upd})

    async def ensure_user(email, name, role, condominium_id=None, owner_id=None):
        u = await db.users.find_one({"email": email})
        if not u:
            await db.users.insert_one({
                "email": email, "password_hash": hash_password(DEMO_PASSWORD), "name": name,
                "role": role, "token_version": 0, "organization_id": org_id,
                "condominium_id": condominium_id, "owner_id": owner_id, "active": True,
                "created_at": iso(now), "updated_at": iso(now)})
        else:
            await db.users.update_one({"email": email}, {"$set": {
                "organization_id": org_id, "role": role,
                "condominium_id": condominium_id, "owner_id": owner_id}})

    await ensure_user("gestor@domvus.pt", "Ana Sofia Ferreira", ROLE_PROPERTY_MANAGER)
    await ensure_user("staff@domvus.pt", "Pedro Nunes", ROLE_ADMIN_STAFF)

    if org.get("seed_version", 0) >= SEED_VERSION:
        await _write_credentials(admin_email, admin_password)
        return

    # wipe finance/domain data for this org (idempotent re-seed)
    for coll in FIN_COLLECTIONS:
        await db[coll].delete_many({"organization_id": org_id})
    await db.counters.delete_many({})

    su = {"organization_id": org_id, "id": "system", "name": "Sistema"}
    random.seed(42)

    condo_defs = [
        {"name": "Condomínio Jardins do Tejo", "address": "Rua do Alecrim, 42", "postal_code": "1200-018",
         "city": "Lisboa", "nif": "901234567", "num_blocks": 2, "bank_name": "Millennium BCP",
         "iban": "PT50003300000012345678901", "budget": 14400, "n_frac": 8},
        {"name": "Edifício Foz Atlântico", "address": "Avenida do Brasil, 210", "postal_code": "4150-153",
         "city": "Porto", "nif": "902345678", "num_blocks": 1, "bank_name": "Novo Banco",
         "iban": "PT50000700000098765432101", "budget": 10800, "n_frac": 6},
        {"name": "Residências Vale Verde", "address": "Rua das Oliveiras, 8", "postal_code": "2775-405",
         "city": "Cascais", "nif": "903456789", "num_blocks": 3, "bank_name": "Caixa Geral de Depósitos",
         "iban": "PT50003500000055556666701", "budget": 18000, "n_frac": 8},
    ]
    owner_names = [
        "João Almeida Costa", "Maria Fernanda Silva", "Carlos Manuel Sousa", "Teresa Oliveira Ramos",
        "António José Pereira", "Beatriz Santos Lopes", "Miguel Ângelo Rodrigues", "Sofia Marques Dias",
        "Ricardo Nunes Carvalho", "Helena Cristina Gomes", "Fernando Alves Martins", "Inês Cardoso Pinto",
        "Paulo Jorge Ribeiro", "Luísa Maria Fonseca", "Nuno Filipe Barbosa", "Cristina Isabel Moreira",
        "André Correia Teixeira", "Marta Sofia Antunes", "Vasco Lima Rocha", "Patrícia Neves Cunha",
        "Jorge Manuel Faria", "Susana Gaspar Melo",
    ]
    budget_categories = [
        ("Limpeza", 0.22), ("Elevador", 0.16), ("Seguro", 0.10), ("Eletricidade", 0.14),
        ("Manutenção", 0.14), ("Administração", 0.12), ("Jardinagem", 0.06),
        ("Despesas bancárias", 0.02), ("Reparações", 0.04),
    ]
    supplier_defs = [
        ("Limpezas Brilhante, Lda.", "Limpeza", "507111222", "geral@brilhante.pt"),
        ("ElevaTech Manutenção", "Elevadores", "508333444", "apoio@elevatech.pt"),
        ("Segura+ Seguros", "Seguros", "509555666", "condominios@seguramais.pt"),
        ("EDP Comercial", "Eletricidade", "500697256", "empresas@edp.pt"),
        ("JardimVivo", "Jardinagem", "510777888", "info@jardimvivo.pt"),
    ]
    supplier_ids = []
    for name, svc, nif, email in supplier_defs:
        r = await db.suppliers.insert_one({
            "organization_id": org_id, "name": name, "nif": nif, "contact_person": "",
            "email": email, "phone": "", "address": "", "iban": "", "services": svc,
            "condominium_ids": [], "created_at": iso(now)})
        supplier_ids.append((str(r.inserted_id), name, svc))

    cur_year, cur_month = now.year, now.month
    prev_year = cur_year - 1
    oi = 0
    first_owner_id = first_condo_id = None

    for ci, cd in enumerate(condo_defs):
        cres = await db.condominiums.insert_one({
            "organization_id": org_id, "name": cd["name"], "address": cd["address"],
            "postal_code": cd["postal_code"], "city": cd["city"], "nif": cd["nif"],
            "num_blocks": cd["num_blocks"], "num_fractions": cd["n_frac"],
            "bank_name": cd["bank_name"], "iban": cd["iban"], "property_manager": "Ana Sofia Ferreira",
            "fiscal_year": cur_year, "default_due_day": 8, "status": "ativo", "notes": "",
            "created_at": iso(now), "updated_at": iso(now)})
        condo_id = str(cres.inserted_id)
        if ci == 0:
            first_condo_id = condo_id

        await db.bank_accounts.insert_one({
            "organization_id": org_id, "condominium_id": condo_id, "bank": cd["bank_name"],
            "iban": cd["iban"], "account_name": cd["name"], "account_number": "",
            "active": True, "created_at": iso(now)})

        # budget
        budget_total = cd["budget"]
        lines = [{"category": cat, "description": "", "amount_cents": to_cents(round(budget_total * w, 2))}
                 for cat, w in budget_categories]
        # normalize to exact total
        diff = to_cents(budget_total) - sum(l["amount_cents"] for l in lines)
        lines[0]["amount_cents"] += diff
        await db.budgets.insert_one({
            "organization_id": org_id, "condominium_id": condo_id, "financial_year": cur_year,
            "description": f"Orçamento ordinário {cur_year}", "lines": lines,
            "total_amount_cents": to_cents(budget_total), "status": "approved",
            "approval_date": iso(now - timedelta(days=200)), "approved_by": "Assembleia Geral",
            "created_at": iso(now)})

        # charge configs
        quota_cfg = await db.charge_configs.insert_one({
            "organization_id": org_id, "condominium_id": condo_id, "name": "Quota Ordinária",
            "charge_type": "REGULAR_QUOTA", "calculation_method": "PERMILAGE",
            "amount_cents": to_cents(budget_total), "fraction_amounts_cents": {},
            "frequency": "monthly", "start_date": None, "end_date": None, "due_day": 8,
            "active": True, "created_at": iso(now)})
        reserve_cfg = await db.charge_configs.insert_one({
            "organization_id": org_id, "condominium_id": condo_id, "name": "Fundo Comum de Reserva",
            "charge_type": "FUND_RESERVE", "calculation_method": "FIXED_AMOUNT",
            "amount_cents": to_cents(10), "fraction_amounts_cents": {},
            "frequency": "monthly", "start_date": None, "end_date": None, "due_day": 8,
            "active": True, "created_at": iso(now)})
        await db.charge_types.insert_many([
            {"organization_id": org_id, "condominium_id": condo_id, "name": "Quota Ordinária",
             "type": "REGULAR_QUOTA", "description": "", "active": True, "created_at": iso(now)},
            {"organization_id": org_id, "condominium_id": condo_id, "name": "Fundo Comum de Reserva",
             "type": "FUND_RESERVE", "description": "", "active": True, "created_at": iso(now)},
            {"organization_id": org_id, "condominium_id": condo_id, "name": "Quota Extraordinária",
             "type": "EXTRAORDINARY_CHARGE", "description": "", "active": True, "created_at": iso(now)},
        ])

        # fractions + owners
        n = cd["n_frac"]
        perm_each = round(1000.0 / n, 2)
        fraction_ids = []
        for fi in range(n):
            owner_name = owner_names[oi % len(owner_names)]
            oi += 1
            ores = await db.owners.insert_one({
                "organization_id": org_id, "condominium_id": condo_id, "name": owner_name,
                "nif": str(200000000 + oi), "email": f"condomino{oi}@exemplo.pt",
                "phone": f"9{random.randint(10000000, 99999999)}", "address": cd["address"],
                "notes": "", "created_at": iso(now), "updated_at": iso(now)})
            owner_id = str(ores.inserted_id)
            if ci == 0 and fi == 0:
                first_owner_id = owner_id
            permill = perm_each if fi < n - 1 else round(1000 - perm_each * (n - 1), 2)
            block = ["A", "B", "C"][fi % cd["num_blocks"]]
            fres = await db.fractions.insert_one({
                "organization_id": org_id, "condominium_id": condo_id,
                "identifier": f"{block}{fi // cd['num_blocks'] + 1}{(fi % 3) + 1:02d}",
                "block": block, "floor": str(fi // cd["num_blocks"] + 1), "door": str((fi % 3) + 1),
                "fraction_type": "habitacao", "owner_id": owner_id,
                "occupant_name": owner_name, "permillage": permill, "monthly_fee": 0.0,
                "reserve_fund": 10.0, "contact_phone": "", "contact_email": "", "notes": "",
                "created_at": iso(now), "updated_at": iso(now)})
            fid = str(fres.inserted_id)
            fraction_ids.append(fres.inserted_id)
            await db.fraction_owners.insert_one({
                "organization_id": org_id, "fraction_id": fid, "owner_id": owner_id,
                "ownership_percentage": 100.0, "start_date": iso(now - timedelta(days=800)),
                "end_date": None, "is_primary": True, "created_at": iso(now)})

        # generate current-year quotas (Jan..current month) via config -> idempotent
        cfg_q = await db.charge_configs.find_one({"_id": quota_cfg.inserted_id})
        cfg_r = await db.charge_configs.find_one({"_id": reserve_cfg.inserted_id})
        await _generate(su, condo_id, cfg_q, cur_year, 1, cur_month)
        await _generate(su, condo_id, cfg_r, cur_year, 1, cur_month)

        # backdated previous-year debts for ~30% of fractions (creates 180/365 aging)
        for idx, frac_oid in enumerate(fraction_ids):
            frac = await db.fractions.find_one({"_id": frac_oid})
            annual_share = finance.permillage_cents(to_cents(budget_total), frac.get("permillage", 0))
            monthly = annual_share // 12
            if idx % 3 == 0:
                for m in (7, 9, 11):
                    due = datetime(prev_year, m, 8, tzinfo=timezone.utc)
                    await post_transaction(su, condominium_id=condo_id, transaction_type=TX_CHARGE,
                                           amount_cents=monthly, fraction_id=str(frac_oid),
                                           owner_id=frac.get("owner_id"), charge_type="REGULAR_QUOTA",
                                           date=due, due_date=due,
                                           description=f"Quota Ordinária {finance.MONTHS_PT[m]}/{prev_year}",
                                           reference=f"REG-{prev_year}{m:02d}",
                                           generation_key=f"legacy:{condo_id}:{prev_year}:{m}:{frac_oid}")

        # payments per fraction profile
        for idx, frac_oid in enumerate(fraction_ids):
            fid = str(frac_oid)
            frac = await db.fractions.find_one({"_id": frac_oid})
            total_out = sum(rem for _, rem in await outstanding_charges(fid))
            if total_out <= 0:
                continue
            profile = idx % 5
            if profile == 0:      # fully paid
                pay = total_out
            elif profile == 1:    # partial: leave ~40€
                pay = max(0, total_out - to_cents(40))
            elif profile == 2:    # overpayment: +25€ credit
                pay = total_out + to_cents(25)
            elif profile == 3:    # recent debtor: pay ~70%
                pay = int(total_out * 0.7)
            else:                 # old debtor: pay only ~30%
                pay = int(total_out * 0.3)
            if pay > 0:
                await _seed_payment(su, condo_id, frac, pay,
                                    now - timedelta(days=random.randint(5, 150)))

        # expenses across categories
        for m in range(max(1, cur_month - 4), cur_month + 1):
            sup = random.choice(supplier_ids)
            amt = random.choice([120, 180, 240, 320, 90, 150])
            await db.expenses.insert_one({
                "organization_id": org_id, "condominium_id": condo_id, "supplier_id": sup[0],
                "supplier_name": sup[1], "description": f"{sup[2]} {finance.MONTHS_PT[m]}/{cur_year}",
                "category": sup[2], "amount_cents": to_cents(amt), "vat_cents": to_cents(round(amt * 0.23, 2)),
                "invoice_number": f"FT {cur_year}/{random.randint(100, 999)}",
                "payment_status": random.choice(["pago", "pendente"]),
                "date": iso(datetime(cur_year, m, random.randint(3, 25), tzinfo=timezone.utc)),
                "due_date": None, "notes": "", "created_at": iso(now)})

    if first_owner_id:
        await ensure_user("condomino@domvus.pt", owner_names[0], ROLE_OWNER,
                          condominium_id=first_condo_id, owner_id=first_owner_id)

    await _seed_operations(su, org_id, now)
    await db.organizations.update_one({"_id": org["_id"]}, {"$set": {"seed_version": SEED_VERSION}})
    await _write_credentials(admin_email, admin_password)


async def _seed_payment(su, condo_id, frac, amount_cents, pdate):
    fid = str(frac["_id"])
    remaining = amount_cents
    allocations = []
    for charge, out_cents in await outstanding_charges(fid):
        if remaining <= 0:
            break
        a = min(remaining, out_cents)
        allocations.append({"charge_id": str(charge["_id"]), "amount_cents": a})
        remaining -= a
    receipt = await _next_receipt_number()
    tx = await post_transaction(su, condominium_id=condo_id, transaction_type=TX_PAYMENT,
                                amount_cents=amount_cents, fraction_id=fid,
                                owner_id=frac.get("owner_id"), date=pdate,
                                description="Recebimento (transferência)", reference=receipt)
    pres = await db.payments.insert_one({
        "organization_id": su["organization_id"], "condominium_id": condo_id, "fraction_id": fid,
        "owner_id": frac.get("owner_id"), "date": iso(pdate), "amount_cents": amount_cents,
        "method": "transferencia", "bank_reference": "", "description": "Recebimento",
        "notes": "", "receipt_number": receipt, "allocation_method": "oldest_first",
        "allocations": allocations, "credit_remaining_cents": remaining,
        "transaction_id": str(tx["_id"]), "created_by": "system", "created_by_name": "Sistema",
        "created_at": iso(now_utc())})
    await db.transactions.update_one({"_id": tx["_id"]}, {"$set": {"payment_id": str(pres.inserted_id)}})


async def _seed_operations(su, org_id, now):
    from finance import now_utc
    # communication templates
    from operations import DEFAULT_TEMPLATES
    for t in DEFAULT_TEMPLATES:
        await db.communication_templates.insert_one({**t, "organization_id": org_id, "active": True,
                                                     "created_at": iso(now)})

    condos = [c async for c in db.condominiums.find({"organization_id": org_id})]
    suppliers = [s async for s in db.suppliers.find({"organization_id": org_id})]
    staff = [u async for u in db.users.find({"organization_id": org_id, "role": {"$in": ["property_manager", "admin_staff"]}})]
    staff_id = str(staff[0]["_id"]) if staff else su["id"]

    occ_defs = [
        ("Fuga de água na garagem", "Water", "urgent", "new"),
        ("Elevador avariado", "Lift", "urgent", "assigned"),
        ("Falha de iluminação no hall", "Electricity", "high", "in_progress"),
        ("Portão da garagem não abre", "Access", "high", "waiting_supplier"),
        ("Infiltração no telhado", "Construction", "high", "assigned"),
        ("Intercomunicador sem som", "Electricity", "normal", "new"),
        ("Limpeza deficiente das escadas", "Cleaning", "normal", "resolved"),
        ("Reclamação de ruído", "Noise", "low", "closed"),
        ("Jardim por aparar", "Gardening", "low", "new"),
        ("Dano em zona comum", "Construction", "normal", "in_progress"),
    ]
    cat_map = {}
    for ci, condo in enumerate(condos):
        cid = str(condo["_id"])
        fracs = [f async for f in db.fractions.find({"condominium_id": cid})]
        for i in range(7):
            title, cat, prio, status = occ_defs[(ci * 3 + i) % len(occ_defs)]
            frac = fracs[i % len(fracs)] if fracs else None
            created = now - timedelta(days=(i * 4 + ci * 2))
            sup = suppliers[i % len(suppliers)] if suppliers else None
            doc = {"organization_id": org_id, "condominium_id": cid,
                   "fraction_id": str(frac["_id"]) if frac else None,
                   "reported_by": su["id"], "reported_by_name": "Sistema",
                   "assigned_to": staff_id if status not in ("new",) else None,
                   "supplier_id": str(sup["_id"]) if sup and status in ("waiting_supplier", "in_progress", "resolved", "closed") else None,
                   "title": title, "description": f"{title} — reportado no condomínio.", "category": cat,
                   "priority": prio, "status": status, "location": "Zona comum",
                   "estimated_cost_cents": to_cents((i + 1) * 50),
                   "actual_cost_cents": to_cents((i + 1) * 45) if status in ("resolved", "closed") else 0,
                   "created_at": iso(created), "updated_at": iso(created),
                   "resolved_at": iso(created + timedelta(days=3)) if status in ("resolved", "closed") else None,
                   "closed_at": iso(created + timedelta(days=4)) if status == "closed" else None}
            r = await db.occurrences.insert_one(doc)
            await db.occurrence_status_history.insert_one({"occurrence_id": str(r.inserted_id), "status": "new",
                                                          "user_name": "Sistema", "created_at": iso(created)})
            if status != "new":
                await db.occurrence_status_history.insert_one({"occurrence_id": str(r.inserted_id), "status": status,
                                                              "user_name": "Sistema", "created_at": iso(created + timedelta(days=1))})
            await db.activities.insert_one({"organization_id": org_id, "condominium_id": cid, "user_id": su["id"],
                                            "user_name": "Sistema", "action": "create", "entity": "occurrence",
                                            "entity_id": str(r.inserted_id), "description": f"Ocorrência criada: {title}",
                                            "created_at": iso(created)})

        # maintenance
        maint_defs = [("Inspeção do elevador", "Lift", "annual", 20), ("Manutenção extintores", "Security", "annual", -10),
                      ("Limpeza depósito de água", "Cleaning", "biannual", 5), ("Manutenção de jardim", "Gardening", "monthly", 40)]
        for j, (mt, mcat, freq, off) in enumerate(maint_defs):
            sup = suppliers[j % len(suppliers)] if suppliers else None
            await db.maintenance.insert_one({"organization_id": org_id, "condominium_id": cid,
                "supplier_id": str(sup["_id"]) if sup else None, "contract_id": None, "title": mt,
                "description": "", "category": mcat, "maint_type": "preventive", "frequency": freq,
                "next_date": iso(now + timedelta(days=off)), "last_date": iso(now - timedelta(days=180)),
                "status": "scheduled", "estimated_cost_cents": to_cents(150), "notes": "",
                "created_at": iso(now), "updated_at": iso(now)})

        # contracts
        con_defs = [("Contrato de manutenção de elevador", "Lift", 25), ("Apólice de seguro do condomínio", "Insurance", 200),
                    ("Contrato de limpeza", "Cleaning", 400)]
        for k, (ct, ccat, days) in enumerate(con_defs):
            sup = suppliers[k % len(suppliers)] if suppliers else None
            await db.contracts.insert_one({"organization_id": org_id, "condominium_id": cid,
                "supplier_id": str(sup["_id"]) if sup else None, "title": ct, "category": ccat,
                "contract_number": f"C-{2025}-{ci}{k}", "start_date": iso(now - timedelta(days=300)),
                "end_date": iso(now + timedelta(days=days)), "value_cents": to_cents(1200),
                "payment_frequency": "annual", "status": "active", "description": "", "notes": "",
                "created_at": iso(now), "updated_at": iso(now)})

        # assembly (upcoming)
        await db.assemblies.insert_one({"organization_id": org_id, "condominium_id": cid,
            "date": (now + timedelta(days=20 + ci * 5)).isoformat()[:10], "time": "18:30", "location": "Salão do condomínio",
            "assembly_type": "ordinary", "status": "scheduled",
            "agenda": [{"number": 1, "title": "Aprovação da ata anterior", "description": "", "decision": "", "status": "pending"},
                       {"number": 2, "title": "Aprovação de contas", "description": "", "decision": "", "status": "pending"},
                       {"number": 3, "title": "Aprovação do orçamento", "description": "", "decision": "", "status": "pending"}],
            "notes": "", "created_at": iso(now)})

        # a communication
        owners = [o async for o in db.owners.find({"condominium_id": cid})]
        await db.communications.insert_one({"organization_id": org_id, "condominium_id": cid, "sender": "Ana Sofia Ferreira",
            "sender_id": staff_id, "subject": f"Comunicado — {condo['name']}", "message": "Informamos os senhores condóminos sobre trabalhos de manutenção.",
            "type": "email", "status": "sent", "target_type": "condominium",
            "recipient_owner_ids": [str(o["_id"]) for o in owners], "recipient_count": len(owners),
            "created_at": iso(now - timedelta(days=ci + 1))})

    # tasks (some overdue)
    task_defs = [("Contactar fornecedor do elevador", "high", -2), ("Preparar convocatória de assembleia", "normal", 3),
                 ("Rever orçamento anual", "normal", 7), ("Enviar avisos de pagamento", "urgent", -1),
                 ("Agendar limpeza de depósitos", "low", 14)]
    for ti, (tt, prio, off) in enumerate(task_defs):
        cid = str(condos[ti % len(condos)]["_id"]) if condos else None
        await db.tasks.insert_one({"organization_id": org_id, "title": tt, "description": "", "assigned_to": staff_id,
            "priority": prio, "status": "todo" if off != 14 else "in_progress", "due_date": iso(now + timedelta(days=off)),
            "condominium_id": cid, "related_entity_type": None, "related_entity_id": None,
            "created_by": su["id"], "created_by_name": "Sistema", "created_at": iso(now), "updated_at": iso(now)})

    # a document (small text) on first condo
    if condos:
        import base64 as _b64
        content = _b64.b64encode(b"Regulamento do Condominio - DOMVUS (demo)").decode()
        await db.documents.insert_one({"organization_id": org_id, "name": "Regulamento do Condomínio",
            "file_name": "regulamento.txt", "file_type": "text/plain", "file_size": 41, "category": "Legal",
            "description": "Regulamento interno (demo)", "uploaded_by": su["id"], "uploaded_by_name": "Sistema",
            "condominium_id": str(condos[0]["_id"]), "related_entity_type": "condominium",
            "related_entity_id": str(condos[0]["_id"]), "version": 1, "data_b64": content,
            "created_at": iso(now)})

    # notifications for staff
    for u in staff:
        await db.notifications.insert_one({"organization_id": org_id, "user_id": str(u["_id"]), "type": "occurrence",
            "title": "Ocorrências urgentes por resolver", "message": "Existem ocorrências urgentes em aberto.",
            "related_entity": "occurrence", "related_entity_id": "", "read_at": None, "created_at": iso(now)})


async def _write_credentials(admin_email, admin_password):
    content = f"""# Test Credentials — DOMVUS

## Super Admin (real account)
- Email: {admin_email}
- Password: {admin_password}
- Role: super_admin (vê todos os condomínios)

## Demo accounts (password: {DEMO_PASSWORD})
- gestor@domvus.pt — Gestor de Condomínio (property_manager)
- staff@domvus.pt — Staff Administrativo (admin_staff)
- condomino@domvus.pt — Condómino/Owner (só vê o seu condomínio e fração)

## Auth endpoints
- POST /api/auth/register | login | logout | refresh | forgot-password | reset-password
- GET  /api/auth/me

## Finance endpoints (all under /api/finance)
- GET dashboard | aging | debts
- charge-types, charge-configs, budgets (+/{{id}}/approve), generate-quotas
- transactions, charges, credits, transactions/{{id}}/reverse
- payments (+/{{id}}/receipt), statement/{{fraction_id}}, notice/{{fraction_id}}
- suppliers, expenses, bank-accounts, reports/{{report}}
"""
    try:
        with open("/app/memory/test_credentials.md", "w") as f:
            f.write(content)
    except Exception:
        pass
