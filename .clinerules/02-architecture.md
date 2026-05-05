# Architecture

## Deployment system

- `deployments/*.env` — one file per GCP target, committed to `main` (no deployment branches)
- `deploy.sh <env>` — reads `.env`, derives Cloud Run URL from project number, builds + deploys
- `cloudbuild.yaml` — Cloud Build config; `_BRAND_NAME` substitution bakes brand into image
- `terraform/` — GCS backend; state isolated per project at `gs://<PROJECT_ID>-smart-engine-tfstate/`; provisions APIs, service accounts, IAM, BQ, Firestore, Artifact Registry, Secret Manager — **not** Cloud Run
- `backend/config.yaml` — generic defaults only; no project-specific values

> **Cloud Run is managed by `deploy.sh`** (via `gcloud run deploy`), not Terraform.
> On `--init`, `deploy.sh` also uploads the initial `google-ads.yaml` secret version.

## Runtime configuration (backend)

- `GCP_PROJECT_ID` env var → `db.py` `PROJECT_ID` (overrides config.yaml)
- `CLOUD_RUN_URL` env var → `db.py` derives `OAUTH_REDIRECT_URI` and `DRIVE_REDIRECT_URI`
- Both set automatically by `deploy.sh` at deploy time

## BQ ML batching

`bq_ml.py` batches all LLM and embedding calls to stay under BQ's 33K CPU-second limit:
- `ML.GENERATE_TEXT`: ≤15K items/batch via `_run_llm_batched()`
- `ML.GENERATE_EMBEDDING`: ≤25K items/batch via `_run_embedding_batched()`
- `VECTOR_SEARCH`: ≤100K items/batch (already batched)

## Key files

| File | Purpose |
|------|---------|
| `backend/db.py` | Shared clients + config constants; reads env vars |
| `backend/bq_ml.py` | Gap analysis + filter pipeline (BQ ML) |
| `backend/routers/gap_analysis.py` | Gap analysis CRUD + async pipeline trigger |
| `backend/routers/auth.py` | Google Ads OAuth (PKCE) |
| `backend/routers/drive_auth.py` | Google Drive OAuth |
| `frontend/src/components/Navbar.jsx` | Brand name from `import.meta.env.VITE_BRAND_NAME` |
