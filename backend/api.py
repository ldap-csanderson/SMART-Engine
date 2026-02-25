"""Main FastAPI application."""
import yaml
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from db import ga_client, bq_client, db, config
from bq_ml import create_models_if_not_exist
from routers.settings import _ensure_defaults
from routers import keyword_reports, filters, portfolio, gap_analysis, settings, filter_executions


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run BQ model creation in a background thread so startup doesn't block
    import threading
    threading.Thread(target=create_models_if_not_exist, daemon=True).start()
    _ensure_defaults()
    yield


app = FastAPI(title="Gap Analysis API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=config["api"]["cors_origins"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(keyword_reports.router)
app.include_router(filters.router)
app.include_router(portfolio.router)
app.include_router(gap_analysis.router)
app.include_router(filter_executions.router)
app.include_router(settings.router)


@app.get("/")
def read_root():
    return {
        "message": "Gap Analysis API",
        "endpoints": {
            "POST /keyword-reports": "Create keyword report",
            "GET /keyword-reports": "List reports",
            "GET /keyword-reports/{id}/keywords": "Get keywords for report",
            "POST /gap-analyses": "Run gap analysis",
            "GET /gap-analyses": "List analyses",
            "GET /gap-analyses/{id}/results": "Get analysis results",
            "GET /portfolio": "Get portfolio",
            "PUT /portfolio": "Update portfolio",
            "GET /portfolio/meta": "Portfolio metadata",
            "GET /settings/prompts": "Get prompts",
            "PUT /settings/prompts": "Update prompts",
            "GET /filters": "List filters",
            "POST /filters": "Create filter",
            "GET /health": "Health check",
        },
    }


@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "google_ads_connected": ga_client is not None,
        "bigquery_connected": bq_client is not None,
        "firestore_connected": db is not None,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=config["app"]["host"], port=config["app"]["port"])
