import os
import logging
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

from fastapi import FastAPI
from starlette.middleware.cors import CORSMiddleware

from database import client, create_indexes
import auth
import routes
import finance
import operations
from seed import seed

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="DOMVUS API")

app.include_router(auth.router)
app.include_router(routes.router)
app.include_router(finance.router)
app.include_router(operations.router)

frontend_url = os.environ.get("FRONTEND_URL", "http://localhost:3000")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[frontend_url, "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await create_indexes()
    try:
        await seed()
        logger.info("Seed completed")
    except Exception as e:
        logger.error(f"Seed failed: {e}")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


@app.on_event("shutdown")
async def shutdown():
    client.close()
