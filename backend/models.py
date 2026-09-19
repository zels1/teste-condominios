from datetime import datetime, timezone
from typing import Annotated, Any, Optional, List
from bson import ObjectId
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, EmailStr


def _validate_object_id(v: Any) -> str:
    if isinstance(v, ObjectId):
        return str(v)
    return str(v)


PyObjectId = Annotated[str, BeforeValidator(_validate_object_id)]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------- Roles ----------
ROLE_SUPER_ADMIN = "super_admin"
ROLE_PROPERTY_MANAGER = "property_manager"
ROLE_ADMIN_STAFF = "admin_staff"
ROLE_OWNER = "owner"

STAFF_ROLES = {ROLE_SUPER_ADMIN, ROLE_PROPERTY_MANAGER, ROLE_ADMIN_STAFF}
ALL_ROLES = {ROLE_SUPER_ADMIN, ROLE_PROPERTY_MANAGER, ROLE_ADMIN_STAFF, ROLE_OWNER}


# ---------- Auth ----------
class RegisterInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str


class LoginInput(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordInput(BaseModel):
    email: EmailStr


class ResetPasswordInput(BaseModel):
    token: str
    password: str = Field(min_length=6)


# ---------- Condominium ----------
class CondominiumInput(BaseModel):
    name: str
    address: str = ""
    postal_code: str = ""
    city: str = ""
    nif: str = ""
    num_fractions: int = 0
    num_blocks: int = 1
    bank_name: str = ""
    iban: str = ""
    property_manager: str = ""
    fiscal_year: int = Field(default_factory=lambda: datetime.now().year)
    status: str = "ativo"
    notes: str = ""


# ---------- Fraction ----------
class FractionInput(BaseModel):
    condominium_id: str
    identifier: str
    block: str = ""
    floor: str = ""
    door: str = ""
    fraction_type: str = "habitacao"
    owner_id: Optional[str] = None
    occupant_name: str = ""
    permillage: float = 0.0
    monthly_fee: float = 0.0
    reserve_fund: float = 0.0
    contact_phone: str = ""
    contact_email: str = ""
    notes: str = ""


# ---------- Owner ----------
class OwnerInput(BaseModel):
    condominium_id: str
    name: str
    nif: str = ""
    email: str = ""
    phone: str = ""
    address: str = ""
    notes: str = ""


# ---------- Transaction ----------
TX_CHARGE = "charge"       # quota / fundo reserva / extraordinaria -> debit (increases owed)
TX_PAYMENT = "payment"     # recebimento -> credit (reduces owed)
TX_CREDIT = "credit"
TX_DEBIT = "debit"
TX_ADJUSTMENT = "adjustment"

DEBIT_TYPES = {TX_CHARGE, TX_DEBIT}
CREDIT_TYPES = {TX_PAYMENT, TX_CREDIT}


class TransactionInput(BaseModel):
    condominium_id: str
    fraction_id: Optional[str] = None
    owner_id: Optional[str] = None
    type: str = TX_CHARGE
    category: str = "quota"  # quota | fundo_reserva | extraordinaria | outro
    description: str = ""
    amount: float = 0.0
    date: str = Field(default_factory=now_iso)
    reference: str = ""
    status: str = "confirmado"
