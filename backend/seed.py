import os
import random
from datetime import datetime, timezone, timedelta

from database import db
from auth import hash_password
from models import (
    ROLE_SUPER_ADMIN, ROLE_PROPERTY_MANAGER, ROLE_ADMIN_STAFF, ROLE_OWNER,
    TX_CHARGE, TX_PAYMENT,
)

DEMO_PASSWORD = "Domvus2025!"


def iso(dt):
    return dt.replace(tzinfo=timezone.utc).isoformat() if dt.tzinfo is None else dt.isoformat()


async def seed():
    admin_email = os.environ.get("ADMIN_EMAIL", "master.marques@gmail.com").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", DEMO_PASSWORD)

    org = await db.organizations.find_one({"slug": "domvus-gestao"})
    now = datetime.now(timezone.utc)
    if not org:
        res = await db.organizations.insert_one({
            "name": "DOMVUS Gestão de Condomínios, Lda.",
            "slug": "domvus-gestao", "nif": "509874321", "city": "Lisboa",
            "created_at": iso(now), "updated_at": iso(now),
        })
        org_id = str(res.inserted_id)
    else:
        org_id = str(org["_id"])

    # ---------- Super admin (real user) ----------
    existing_admin = await db.users.find_one({"email": admin_email})
    if not existing_admin:
        await db.users.insert_one({
            "email": admin_email, "password_hash": hash_password(admin_password),
            "name": "Rui Marques", "role": ROLE_SUPER_ADMIN, "token_version": 0,
            "organization_id": org_id, "condominium_id": None, "owner_id": None,
            "active": True, "created_at": iso(now), "updated_at": iso(now),
        })
    else:
        # keep password in sync with .env, ensure org linkage
        from auth import verify_password
        upd = {"organization_id": org_id, "role": ROLE_SUPER_ADMIN}
        if not verify_password(admin_password, existing_admin["password_hash"]):
            upd["password_hash"] = hash_password(admin_password)
        await db.users.update_one({"email": admin_email}, {"$set": upd})

    # If demo data already present, stop here (idempotent)
    if await db.condominiums.count_documents({"organization_id": org_id}) > 0:
        await _write_credentials(admin_email, admin_password)
        return

    async def ensure_user(email, name, role, condominium_id=None, owner_id=None):
        if await db.users.find_one({"email": email}):
            return
        await db.users.insert_one({
            "email": email, "password_hash": hash_password(DEMO_PASSWORD),
            "name": name, "role": role, "token_version": 0,
            "organization_id": org_id, "condominium_id": condominium_id, "owner_id": owner_id,
            "active": True, "created_at": iso(now), "updated_at": iso(now),
        })

    await ensure_user("gestor@domvus.pt", "Ana Sofia Ferreira", ROLE_PROPERTY_MANAGER)
    await ensure_user("staff@domvus.pt", "Pedro Nunes", ROLE_ADMIN_STAFF)

    condo_defs = [
        {"name": "Condomínio Jardins do Tejo", "address": "Rua do Alecrim, 42",
         "postal_code": "1200-018", "city": "Lisboa", "nif": "901234567",
         "num_blocks": 2, "bank_name": "Millennium BCP", "iban": "PT50003300000012345678901"},
        {"name": "Edifício Foz Atlântico", "address": "Avenida do Brasil, 210",
         "postal_code": "4150-153", "city": "Porto", "nif": "902345678",
         "num_blocks": 1, "bank_name": "Novo Banco", "iban": "PT50000700000098765432101"},
        {"name": "Residências Vale Verde", "address": "Rua das Oliveiras, 8",
         "postal_code": "2775-405", "city": "Cascais", "nif": "903456789",
         "num_blocks": 3, "bank_name": "Caixa Geral de Depósitos", "iban": "PT50003500000055556666701"},
    ]

    owner_names = [
        "João Almeida Costa", "Maria Fernanda Silva", "Carlos Manuel Sousa",
        "Teresa Oliveira Ramos", "António José Pereira", "Beatriz Santos Lopes",
        "Miguel Ângelo Rodrigues", "Sofia Marques Dias", "Ricardo Nunes Carvalho",
        "Helena Cristina Gomes", "Fernando Alves Martins", "Inês Cardoso Pinto",
        "Paulo Jorge Ribeiro", "Luísa Maria Fonseca", "Nuno Filipe Barbosa",
        "Cristina Isabel Moreira", "André Correia Teixeira", "Marta Sofia Antunes",
    ]
    oi = 0
    first_owner_id = None
    first_condo_id = None

    for ci, cd in enumerate(condo_defs):
        cres = await db.condominiums.insert_one({
            **cd, "num_fractions": 0, "property_manager": "Ana Sofia Ferreira",
            "fiscal_year": now.year, "status": "ativo", "notes": "",
            "organization_id": org_id, "created_at": iso(now), "updated_at": iso(now),
        })
        condo_id = str(cres.inserted_id)
        if ci == 0:
            first_condo_id = condo_id

        n_frac = random.randint(5, 7)
        blocks = ["A", "B", "C"][:cd["num_blocks"]]
        for fi in range(n_frac):
            owner_name = owner_names[oi % len(owner_names)]
            oi += 1
            ores = await db.owners.insert_one({
                "condominium_id": condo_id, "name": owner_name,
                "nif": str(200000000 + oi), "email": f"condomino{oi}@exemplo.pt",
                "phone": f"9{random.randint(10000000, 99999999)}",
                "address": cd["address"], "notes": "",
                "organization_id": org_id, "created_at": iso(now), "updated_at": iso(now),
            })
            owner_id = str(ores.inserted_id)
            if ci == 0 and fi == 0:
                first_owner_id = owner_id

            block = random.choice(blocks)
            floor = random.randint(0, 5)
            monthly_fee = random.choice([45, 50, 55, 60, 65, 75])
            reserve = round(monthly_fee * 0.1, 2)
            fres = await db.fractions.insert_one({
                "condominium_id": condo_id,
                "identifier": f"{block}{floor}{random.choice(['01', '02', '03'])}",
                "block": block, "floor": str(floor), "door": str(random.randint(1, 4)),
                "fraction_type": "habitacao", "owner_id": owner_id,
                "occupant_name": owner_name if random.random() > 0.3 else "Arrendatário",
                "permillage": round(1000 / n_frac, 2), "monthly_fee": monthly_fee,
                "reserve_fund": reserve, "contact_phone": "", "contact_email": "",
                "notes": "", "organization_id": org_id,
                "created_at": iso(now), "updated_at": iso(now),
            })
            fraction_id = str(fres.inserted_id)

            # charges + payments for last 4 months
            for m in range(4, 0, -1):
                mdate = (now.replace(day=5) - timedelta(days=30 * m))
                await db.transactions.insert_one({
                    "organization_id": org_id, "condominium_id": condo_id,
                    "fraction_id": fraction_id, "owner_id": owner_id,
                    "type": TX_CHARGE, "category": "quota",
                    "description": f"Quota mensal {mdate.strftime('%m/%Y')}",
                    "amount": float(monthly_fee), "date": iso(mdate),
                    "reference": f"Q-{mdate.strftime('%Y%m')}", "status": "confirmado",
                    "created_by_name": "Sistema", "created_at": iso(mdate), "updated_at": iso(mdate),
                })
                await db.transactions.insert_one({
                    "organization_id": org_id, "condominium_id": condo_id,
                    "fraction_id": fraction_id, "owner_id": owner_id,
                    "type": TX_CHARGE, "category": "fundo_reserva",
                    "description": f"Fundo Comum de Reserva {mdate.strftime('%m/%Y')}",
                    "amount": float(reserve), "date": iso(mdate),
                    "reference": f"FCR-{mdate.strftime('%Y%m')}", "status": "confirmado",
                    "created_by_name": "Sistema", "created_at": iso(mdate), "updated_at": iso(mdate),
                })
                # ~70% pay fully, some partial, some none (to build outstanding balances)
                r = random.random()
                pay = 0.0
                if r > 0.30:
                    pay = monthly_fee + reserve
                elif r > 0.12:
                    pay = round((monthly_fee + reserve) * 0.5, 2)
                if pay > 0:
                    pdate = mdate + timedelta(days=random.randint(2, 12))
                    await db.transactions.insert_one({
                        "organization_id": org_id, "condominium_id": condo_id,
                        "fraction_id": fraction_id, "owner_id": owner_id,
                        "type": TX_PAYMENT, "category": "quota",
                        "description": f"Recebimento {mdate.strftime('%m/%Y')}",
                        "amount": float(pay), "date": iso(pdate),
                        "reference": f"REC-{pdate.strftime('%Y%m%d')}", "status": "confirmado",
                        "created_by_name": "Sistema", "created_at": iso(pdate), "updated_at": iso(pdate),
                    })

        await db.condominiums.update_one({"_id": cres.inserted_id}, {"$set": {"num_fractions": n_frac}})

    # ---------- Owner demo user linked to first owner ----------
    if first_owner_id:
        await ensure_user("condomino@domvus.pt", owner_names[0], ROLE_OWNER,
                          condominium_id=first_condo_id, owner_id=first_owner_id)

    await _write_credentials(admin_email, admin_password)


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
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET  /api/auth/me
- POST /api/auth/refresh
- POST /api/auth/forgot-password
- POST /api/auth/reset-password
"""
    try:
        with open("/app/memory/test_credentials.md", "w") as f:
            f.write(content)
    except Exception:
        pass
