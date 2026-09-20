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
    await db.transactions.create_index("generation_key")
    await db.transactions.create_index("transaction_type")
    await db.payments.create_index([("organization_id", 1), ("condominium_id", 1)])
    await db.payments.create_index("fraction_id")
    await db.expenses.create_index([("organization_id", 1), ("condominium_id", 1)])
    await db.charge_configs.create_index("condominium_id")
    await db.budgets.create_index([("condominium_id", 1), ("financial_year", -1)])
    await db.audit_logs.create_index([("organization_id", 1), ("created_at", -1)])
    await db.occurrences.create_index([("organization_id", 1), ("condominium_id", 1), ("status", 1)])
    await db.occurrence_comments.create_index("occurrence_id")
    await db.occurrence_status_history.create_index("occurrence_id")
    await db.maintenance.create_index([("organization_id", 1), ("condominium_id", 1)])
    await db.contracts.create_index([("organization_id", 1), ("condominium_id", 1)])
    await db.documents.create_index([("organization_id", 1), ("related_entity_type", 1), ("related_entity_id", 1)])
    await db.communications.create_index([("organization_id", 1), ("condominium_id", 1)])
    await db.assemblies.create_index([("organization_id", 1), ("condominium_id", 1)])
    await db.assembly_attendees.create_index("assembly_id")
    await db.tasks.create_index([("organization_id", 1), ("assigned_to", 1), ("status", 1)])
    await db.notifications.create_index([("user_id", 1), ("read_at", 1)])
    await db.activities.create_index([("organization_id", 1), ("created_at", -1)])
