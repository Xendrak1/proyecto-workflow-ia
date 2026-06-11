from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.db.mongo import close_mongo_connection, connect_to_mongo
from app.routes import ai, analytics, audit, auth, documents, policies, tasks, tramites, users


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="API base para el sistema Workflow IA del primer parcial.",
)

uploads_dir = Path(__file__).resolve().parents[1] / "uploads"
uploads_dir.mkdir(parents=True, exist_ok=True)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event() -> None:
    await connect_to_mongo()


@app.on_event("shutdown")
async def shutdown_event() -> None:
    await close_mongo_connection()


@app.get("/health")
async def healthcheck() -> dict:
    return {"status": "ok", "app": settings.app_name, "env": settings.app_env}


@app.options("/{full_path:path}")
async def preflight_handler(full_path: str) -> Response:
    return Response(status_code=204)


app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

app.include_router(auth.router, prefix="/api/auth", tags=["Auth"])
app.include_router(users.router, prefix="/api/users", tags=["Users"])
app.include_router(policies.router, prefix="/api/policies", tags=["Policies"])
app.include_router(ai.router, prefix="/api/ai", tags=["AI"])
app.include_router(tramites.router, prefix="/api/tramites", tags=["Tramites"])
app.include_router(tasks.router, prefix="/api/tasks", tags=["Tasks"])
app.include_router(documents.router, prefix="/api/documents", tags=["Documents"])
app.include_router(audit.router, prefix="/api/audit", tags=["Audit"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["Analytics"])
