"""Main FastAPI application — SMART Engine v3."""
import os
import threading
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from db import ga_auth_manager, bq_client, db, config
from bq_ml import (
    create_models_if_not_exist,
    create_vector_index_if_not_exist,
    migrate_to_gemini_embedding_2,
    add_image_url_column_if_not_exist,
)
from routers.settings import _ensure_defaults
from routers import datasets, dataset_groups, filters, gap_analysis, settings, filter_executions, auth
from routers.drive_auth import drive_router
from routers.chat import dataset_chat_router, gap_chat_router
from routers.filter_executions import resume_stuck_filter_executions
from routers.datasets import resume_stuck_datasets


def _startup_tasks():
    """Run all startup tasks sequentially in a single background thread.

    Order matters:
    1. Create/update BQ ML models (ensures gemini-embedding-2 endpoint is set)
    2. Run one-time embedding migration (wipe old cache, drop old vector index)
    3. Create vector index (rebuilds after migration drops it)
    4. Ensure Firestore setting defaults
    5. Resume any interrupted background jobs
    """
    create_models_if_not_exist()
    migrate_to_gemini_embedding_2()
    add_image_url_column_if_not_exist()
    create_vector_index_if_not_exist()
    _ensure_defaults()
    resume_stuck_filter_executions()
    resume_stuck_datasets()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run all startup tasks in a single background thread to preserve ordering.
    # Previously separate threads caused race conditions between model creation
    # and the migration step.
    threading.Thread(target=_startup_tasks, daemon=True).start()
    yield


app = FastAPI(title="SMART Engine API", lifespan=lifespan)

# Include API routers with /api prefix
app.include_router(datasets.router, prefix="/api")
app.include_router(dataset_groups.router, prefix="/api")
app.include_router(filters.router, prefix="/api")
app.include_router(gap_analysis.router, prefix="/api")
app.include_router(filter_executions.router, prefix="/api")
app.include_router(settings.router, prefix="/api")
app.include_router(auth.router, prefix="/api")
app.include_router(drive_router, prefix="/api")
app.include_router(dataset_chat_router, prefix="/api")
app.include_router(gap_chat_router, prefix="/api")


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        # Always read from auth_manager so re-auth takes effect immediately
        "google_ads_connected": ga_auth_manager is not None and ga_auth_manager.client is not None,
        "bigquery_connected": bq_client is not None,
        "firestore_connected": db is not None,
    }


# Serve static files (React frontend)
static_dir = Path(__file__).parent / "static"
if static_dir.exists():
    # Mount static assets (JS/CSS/images)
    app.mount("/assets", StaticFiles(directory=static_dir / "assets"), name="assets")

    # Serve index.html for all other routes (SPA routing)
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Don't intercept API routes
        if full_path.startswith("api/"):
            return {"error": "Not found"}, 404

        # Try to serve the file if it exists
        file_path = static_dir / full_path
        if file_path.is_file():
            return FileResponse(file_path)

        # Otherwise serve index.html (SPA routing)
        return FileResponse(static_dir / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config["app"]["host"], port=config["app"]["port"])
