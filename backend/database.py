import os
from motor.motor_asyncio import AsyncIOMotorClient

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]


async def create_indexes():
    await db.users.create_index("email", unique=True)
    await db.password_reset_tokens.create_index("expires_at", expireAfterSeconds=0)
    await db.password_reset_tokens.create_index("token_hash", unique=True)
    await db.login_attempts.create_index("email")
    await db.login_attempts.create_index("identifier")
    await db.password_reset_requests.create_index("email")
    await db.password_reset_requests.create_index("created_at", expireAfterSeconds=900)
    # business indexes
    await db.condominiums.create_index("organization_id")
    await db.fractions.create_index([("organization_id", 1), ("condominium_id", 1)])
    await db.owners.create_index([("organization_id", 1), ("condominium_id", 1)])
    await db.transactions.create_index([("organization_id", 1), ("condominium_id", 1)])
    await db.transactions.create_index("fraction_id")
    await db.audit_logs.create_index([("organization_id", 1), ("created_at", -1)])
