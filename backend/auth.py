import os
import logging
import hashlib
import secrets
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
from html import escape

import bcrypt
import jwt
import httpx
from bson import ObjectId
from fastapi import APIRouter, Request, Response, HTTPException, Depends, BackgroundTasks

from database import db
from models import (
    RegisterInput, LoginInput, ForgotPasswordInput, ResetPasswordInput,
    ROLE_SUPER_ADMIN, ROLE_OWNER, STAFF_ROLES,
)

logger = logging.getLogger(__name__)

JWT_ALGORITHM = "HS256"
GENERIC_RESET_MSG = {"message": "Se esse email estiver registado, foi enviado um link de recuperação."}

EMAIL_BASE_URL = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip().rstrip("/") or "https://integrations.emergentagent.com"
EMAIL_KEY = os.environ.get("EMERGENT_EMAIL_KEY", "")
EMAIL_FROM_NAME = os.environ.get("EMAIL_FROM_NAME") or "DOMVUS"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str, token_version: int = 0) -> str:
    payload = {"sub": user_id, "email": email, "ver": token_version,
               "exp": datetime.now(timezone.utc) + timedelta(minutes=15), "type": "access"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, token_version: int = 0) -> str:
    payload = {"sub": user_id, "ver": token_version,
               "exp": datetime.now(timezone.utc) + timedelta(days=7), "type": "refresh"}
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def _set_auth_cookies(response: Response, access: str, refresh: str):
    response.set_cookie("access_token", access, httponly=True, secure=True, samesite="none", max_age=900, path="/")
    response.set_cookie("refresh_token", refresh, httponly=True, secure=True, samesite="none", max_age=604800, path="/")


def _public_user(user: dict) -> dict:
    user = dict(user)
    user["id"] = str(user.pop("_id"))
    user.pop("password_hash", None)
    return user


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Tipo de token inválido")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user:
            raise HTTPException(status_code=401, detail="Utilizador não encontrado")
        if payload.get("ver", 0) != user.get("token_version", 0):
            raise HTTPException(status_code=401, detail="Sessão expirada")
        return _public_user(user)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


def require_roles(*roles):
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Sem permissão para esta ação")
        return user
    return dep


async def require_staff(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") not in STAFF_ROLES:
        raise HTTPException(status_code=403, detail="Sem permissão para esta ação")
    return user


# ---------- Brute force ----------
async def _is_locked(email: str, ip: str) -> bool:
    identifier = f"{ip}:{email}"
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=15)
    count = await db.login_attempts.count_documents({
        "identifier": identifier,
        "created_at": {"$gt": cutoff.isoformat()},
    })
    return count >= 5


async def _record_failed(email: str, ip: str):
    await db.login_attempts.insert_one({
        "identifier": f"{ip}:{email}", "email": email,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


async def _clear_attempts(email: str, ip: str):
    await db.login_attempts.delete_many({"identifier": f"{ip}:{email}"})


# ---------- Audit ----------
async def audit(user: dict, action: str, entity: str, entity_id: str = "", meta: dict = None):
    await db.audit_logs.insert_one({
        "organization_id": user.get("organization_id"),
        "user_id": user.get("id"),
        "user_name": user.get("name"),
        "action": action,
        "entity": entity,
        "entity_id": entity_id,
        "meta": meta or {},
        "created_at": datetime.now(timezone.utc).isoformat(),
    })


# ---------- Reset email ----------
async def send_password_reset_email(to_email: str, token: str) -> bool:
    base = os.environ.get("FRONTEND_URL", "").rstrip("/")
    link = f"{base}/reset-password?token={token}"
    if not EMAIL_KEY or EMAIL_KEY.startswith("{") or not base.startswith("https://"):
        if urlparse(base).hostname in ("localhost", "127.0.0.1", "::1"):
            logger.warning("Email not configured; password reset link: %s", link)
        else:
            logger.error("Password reset email not configured (EMERGENT_EMAIL_KEY / FRONTEND_URL)")
        return False
    brand = escape(EMAIL_FROM_NAME)
    html = (
        f'<table role="presentation" width="100%"><tr><td style="padding:24px;font-family:Arial,sans-serif">'
        f'<p>Recebemos um pedido para redefinir a sua palavra-passe {brand}.</p>'
        f'<p><a href="{escape(link)}">Redefinir palavra-passe</a></p>'
        f'<p>Este link expira em 1 hora e pode ser usado uma vez. Se não fez este pedido, ignore este email.</p>'
        f'<p style="font-size:12px;color:#888">Enviado por {brand}.</p>'
        f'</td></tr></table>'
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{EMAIL_BASE_URL}/api/v1/email/send",
                headers={"X-Email-Key": EMAIL_KEY},
                json={"to": [to_email], "subject": f"Redefinir a sua palavra-passe {EMAIL_FROM_NAME}",
                      "html": html, "from_name": EMAIL_FROM_NAME},
            )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Password reset email failed: {e}")
        return False


router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register")
async def register(payload: RegisterInput, response: Response):
    email = payload.email.lower().strip()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email já registado")
    doc = {
        "email": email, "password_hash": hash_password(payload.password),
        "name": payload.name, "role": ROLE_OWNER, "token_version": 0,
        "organization_id": None, "condominium_id": None, "owner_id": None,
        "active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    res = await db.users.insert_one(doc)
    uid = str(res.inserted_id)
    _set_auth_cookies(response, create_access_token(uid, email, 0), create_refresh_token(uid, 0))
    doc["_id"] = res.inserted_id
    return _public_user(doc)


@router.post("/login")
async def login(payload: LoginInput, request: Request, response: Response):
    email = payload.email.lower().strip()
    ip = request.client.host if request.client else "unknown"
    if await _is_locked(email, ip):
        raise HTTPException(status_code=429, detail="Demasiadas tentativas. Tente novamente em 15 minutos.")
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        await _record_failed(email, ip)
        raise HTTPException(status_code=401, detail="Credenciais inválidas")
    if not user.get("active", True):
        raise HTTPException(status_code=403, detail="Conta desativada")
    await _clear_attempts(email, ip)
    uid = str(user["_id"])
    ver = user.get("token_version", 0)
    _set_auth_cookies(response, create_access_token(uid, email, ver), create_refresh_token(uid, ver))
    return _public_user(user)


@router.post("/logout")
async def logout(response: Response, user: dict = Depends(get_current_user)):
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path="/")
    return {"message": "Sessão terminada"}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return user


@router.post("/refresh")
async def refresh(request: Request, response: Response):
    token = request.cookies.get("refresh_token")
    if not token:
        raise HTTPException(status_code=401, detail="Não autenticado")
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "refresh":
            raise HTTPException(status_code=401, detail="Tipo de token inválido")
        user = await db.users.find_one({"_id": ObjectId(payload["sub"])})
        if not user or payload.get("ver", 0) != user.get("token_version", 0):
            raise HTTPException(status_code=401, detail="Sessão expirada")
        uid = str(user["_id"])
        ver = user.get("token_version", 0)
        response.set_cookie("access_token", create_access_token(uid, user["email"], ver),
                            httponly=True, secure=True, samesite="none", max_age=900, path="/")
        return {"message": "ok"}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")


@router.post("/forgot-password")
async def forgot_password(payload: ForgotPasswordInput, background_tasks: BackgroundTasks):
    email = payload.email.lower().strip()
    now = datetime.now(timezone.utc)
    await db.password_reset_requests.insert_one({"email": email, "created_at": now.isoformat()})
    cutoff = now - timedelta(minutes=15)
    recent = await db.password_reset_requests.count_documents({"email": email, "created_at": {"$gt": cutoff.isoformat()}})
    if recent > 5:
        return GENERIC_RESET_MSG
    user = await db.users.find_one({"email": email})
    if not user:
        return GENERIC_RESET_MSG
    token = secrets.token_urlsafe(32)
    await db.password_reset_tokens.insert_one({
        "token_hash": hashlib.sha256(token.encode()).hexdigest(),
        "user_id": str(user["_id"]), "email": user["email"],
        "expires_at": now + timedelta(hours=1), "used": False,
    })
    background_tasks.add_task(send_password_reset_email, user["email"], token)
    return GENERIC_RESET_MSG


@router.post("/reset-password")
async def reset_password(payload: ResetPasswordInput):
    h = hashlib.sha256(payload.token.encode()).hexdigest()
    now = datetime.now(timezone.utc)
    doc = await db.password_reset_tokens.find_one_and_update(
        {"token_hash": h, "used": False, "expires_at": {"$gt": now}},
        {"$set": {"used": True}},
    )
    if not doc:
        raise HTTPException(status_code=400, detail="Link inválido ou expirado")
    await db.users.update_one(
        {"_id": ObjectId(doc["user_id"])},
        {"$set": {"password_hash": hash_password(payload.password),
                  "updated_at": now.isoformat()},
         "$inc": {"token_version": 1}},
    )
    await db.password_reset_tokens.delete_many({"user_id": doc["user_id"], "used": False})
    await db.login_attempts.delete_many({"email": doc["email"]})
    return {"message": "Palavra-passe redefinida com sucesso"}
