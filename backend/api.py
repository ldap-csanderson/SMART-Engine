"""Main FastAPI application."""
import os
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from db import ga_client, bq_client, db, config
from bq_ml import create_models_if_not_exist
from routers.settings import _ensure_defaults
from routers import keyword_reports, filters, portfolio, gap_analysis, settings, filter_executions


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run BQ startup tasks in background threads so startup doesn't block
    import threading
    threading.Thread(target=create_models_if_not_exist, daemon=True).start()
    _ensure_defaults()
    yield


app = FastAPI(title="Gap Analysis API", lifespan=lifespan)

# Include API routers with /api prefix
app.include_router(keyword_reports.router, prefix="/api")
app.include_router(filters.router, prefix="/api")
app.include_router(portfolio.router, prefix="/api")
app.include_router(gap_analysis.router, prefix="/api")
app.include_router(filter_executions.router, prefix="/api")
app.include_router(settings.router, prefix="/api")


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "google_ads_connected": ga_client is not None,
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
