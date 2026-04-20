# SMART Engine

A full-stack semantic gap analysis platform. Compares any pair of data sources — keyword planner results, ad copy, search terms, or custom text lists — using Google Ads API + BigQuery ML (Gemini + text embeddings) to find what's missing from your coverage.

**Live:** https://smart-engine-xdzhjknata-uc.a.run.app  
**Repo:** git@github.com:ldap-csanderson/SMART-Engine.git  
**GCP Project:** `csanderson-experimental-443821`

---

## Architecture

```
gap_analysis_v3/
├── backend/          # FastAPI — modular routers, Firestore + BigQuery
├── frontend/         # React + Tailwind CSS SPA
├── terraform/        # GCP infrastructure
├── scripts/          # Standalone Google Ads scripts (local use)
└── SPEC.md           # Full v3 feature specification
```

### Single-Container Deployment

Frontend (React) is built at Docker build time and served as static files by the FastAPI backend via Uvicorn. There is **one** Cloud Run service (`smart-engine`) serving both the API (`/api/*`) and the frontend.

```
Browser
  ↓
Cloud Run: smart-engine (port 8000)
  ├── GET /api/* → FastAPI routers
  └── GET /* → React SPA (static/index.html)
```

### Data Flow

```
1. Dataset Ingestion
   Google Ads API (Keyword Planner / Ad Copy / Search Terms)
     ↓ (background task on POST /api/datasets)
   Firestore: datasets  ←→  BigQuery: dataset_items
   (metadata + status)       (all item rows, dataset_id FK)

2. Gap Analysis Pipeline (bq_ml.py)
   ├── Step 1: ML.GENERATE_TEXT  → source item intent strings (Gemini)
   ├── Step 2: ML.GENERATE_EMBEDDING → source embeddings
   ├── Step 3: ML.GENERATE_EMBEDDING → target embeddings (cached in dataset_embeddings)
   └── Step 4: VECTOR_SEARCH (cosine) → top-3 closest target items per source item
       ↓
   BigQuery: gap_analysis_results

3. Filter Executions (optional, post-analysis)
   ML.GENERATE_TEXT → boolean classification per item per filter
     ↓
   BigQuery: filter_results
```

### Storage Split

| Layer | Technology | Contents |
|---|---|---|
| Metadata | Firestore | `datasets`, `dataset_groups`, `gap_analyses`, `filters`, `filter_executions`, `settings` |
| Analytics | BigQuery (`smart_engine_data`) | `dataset_items`, `dataset_embeddings`, `gap_analysis_results`, `filter_results` |

---

## Features

- **Datasets** — pull keywords (URL-seeded or account-level), ad copy, search terms from Google Ads, or enter a custom text list. All types produce a flat list of text items that feed into gap analysis.
- **Dataset Groups** — named collections of datasets; use a group as either side of a gap analysis to union all member items.
- **Gap Analysis** — BigQuery ML pipeline using Gemini Flash + text-embedding-005 to find which source items are semantically furthest from the target dataset/group.
- **Intent caching** — target embeddings are cached in `dataset_embeddings` keyed by `(dataset_id, item_text, prompt_hash)`. Re-running analysis against the same target skips regeneration.
- **Filters** — LLM boolean classifiers run against gap analysis results (`purchase_intent`, `non_branded`, etc.). Results stored with filter snapshot for immutability.
- **Per-type intent prompts** — each dataset type (keywords, ad copy, search terms, text list) has a tailored Gemini prompt. Overridable per-type via the Settings page.

---

## Configuration

### `backend/config.yaml`

All server-side configuration lives here. It is **not a secret** — it contains no credentials.

```yaml
gcp:
  project_id: "csanderson-experimental-443821"
  region: "us-central1"

bigquery:
  dataset: "smart_engine_data"
  connection: "us-central1.vertex-ai-connection"
  tables:
    dataset_items: "dataset_items"
    dataset_embeddings: "dataset_embeddings"
    gap_analysis_results: "gap_analysis_results"
    filter_results: "filter_results"
  models:
    gemini_flash: "gemini-flash"
    text_embeddings: "text-embeddings"

google_ads:
  customer_id: "2900871247"   # ← The Google Ads customer ID used for all API calls
  config_path: "../scripts/google-ads.yaml"  # local dev only; Cloud Run uses Secret Manager

api:
  max_retries: 3
  retry_delay_seconds: 5
```

**`google_ads.customer_id`** — this is the CID passed to the Google Ads API for all dataset ingestion calls. It is injected server-side into `source_config` on dataset creation, so the frontend never needs to know it. To change the customer account, update this value and redeploy.

### `scripts/google-ads.yaml` (secret — never commit)

OAuth credentials for the Google Ads API. On Cloud Run, this is mounted read-only from Secret Manager at `/secrets/google-ads.yaml`.

```yaml
client_id: "YOUR_CLIENT_ID"
client_secret: "YOUR_CLIENT_SECRET"
refresh_token: "YOUR_REFRESH_TOKEN"
access_token: "YOUR_ACCESS_TOKEN"
developer_token: "YOUR_DEVELOPER_TOKEN"
login_customer_id: "YOUR_LOGIN_CUSTOMER_ID"
use_proto_plus: true
```

**Token refresh:** When the access token expires, `google_ads_auth.py` automatically exchanges the refresh token for a new access token in memory (does not write back to file, since `/secrets` is read-only on Cloud Run).

---

## Dataset Types

| Type | Description | Source |
|---|---|---|
| `google_ads_keywords` | Keyword Planner results seeded by URLs | Google Ads KeywordPlanIdeaService |
| `google_ads_ad_copy` | RSA + ETA ad copy from an account | Google Ads AdService |
| `google_ads_search_terms` | Search terms report | Google Ads search_term_view |
| `google_ads_keyword_planner` | Keyword Planner at account level (no URL seed) | Google Ads KeywordPlanIdeaService |
| `text_list` | Manually entered text strings | User input |

Only `google_ads_keywords` and `google_ads_keyword_planner` produce search volume enrichment columns (`avg_monthly_searches`, `competition`, CPC bids).

---

## API Routes

### Datasets
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/datasets` | List all datasets |
| `POST` | `/api/datasets` | Create dataset (triggers background ingestion) |
| `GET` | `/api/datasets/{id}` | Get dataset metadata |
| `GET` | `/api/datasets/{id}/items` | Paginated items from BigQuery |
| `PATCH` | `/api/datasets/{id}/rename` | Rename |
| `PATCH` | `/api/datasets/{id}/archive` | Archive |
| `PATCH` | `/api/datasets/{id}/unarchive` | Unarchive |
| `DELETE` | `/api/datasets/{id}` | Delete + BQ rows |
| `GET` | `/api/datasets/accounts` | List accessible Google Ads accounts |

### Dataset Groups
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/dataset-groups` | List all groups |
| `POST` | `/api/dataset-groups` | Create group |
| `GET` | `/api/dataset-groups/{id}` | Get group |
| `PUT` | `/api/dataset-groups/{id}` | Update (name + members) |
| `DELETE` | `/api/dataset-groups/{id}` | Delete group (not members) |

### Gap Analyses
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/gap-analyses` | Run analysis |
| `POST` | `/api/gap-analyses/estimate` | Cost estimate for a source dataset |
| `GET` | `/api/gap-analyses` | List analyses |
| `GET` | `/api/gap-analyses/{id}` | Get analysis |
| `GET` | `/api/gap-analyses/{id}/results` | Paginated results |
| `PATCH` | `/api/gap-analyses/{id}/rename` | Rename |
| `PATCH` | `/api/gap-analyses/{id}/archive` | Archive |
| `DELETE` | `/api/gap-analyses/{id}` | Delete |

### Filters & Executions
| Method | Path | Description |
|---|---|---|
| `GET/POST` | `/api/filters` | List / create |
| `GET/PUT/DELETE` | `/api/filters/{id}` | Manage filter |
| `POST` | `/api/gap-analyses/{id}/filter-executions` | Run filters |
| `GET` | `/api/gap-analyses/{id}/filter-executions` | List executions |
| `DELETE` | `/api/gap-analyses/{id}/filter-executions/{exec_id}` | Delete execution |

### Other
| Method | Path | Description |
|---|---|---|
| `GET/PUT` | `/api/settings/prompts` | Per-type Gemini prompt overrides |
| `GET` | `/api/health` | Connection status |

---

## BigQuery Schema (`smart_engine_data`)

| Table | Key Columns |
|---|---|
| `dataset_items` | `dataset_id`, `item_text`, `added_at`, `avg_monthly_searches`, `competition`, `competition_index`, `low/high_top_of_page_bid_usd`, `source_url` |
| `dataset_embeddings` | `dataset_id`, `item_text`, `intent_string`, `embedding` (FLOAT64[]), `prompt_hash`, `embedded_at` |
| `gap_analysis_results` | `analysis_id`, `keyword_text`, `keyword_intent`, `closest_portfolio_item`, `closest_portfolio_intent`, `semantic_distance`, `avg_monthly_searches` |
| `filter_results` | `execution_id`, `analysis_id`, `keyword_text`, `label`, `result` (BOOL), `confidence`, `created_at` |

### BQ ML Models

| Model | Endpoint | Used for |
|---|---|---|
| `gemini-flash` | `gemini-2.5-flash` | Intent string generation + filter boolean classification |
| `text-embeddings` | `text-embedding-005` | Semantic embeddings (512-dim, SEMANTIC_SIMILARITY) |

Models are created at startup via `CREATE MODEL IF NOT EXISTS`.

---

## Code Structure

```
backend/
├── api.py               # FastAPI app, lifespan startup, static file serving
├── db.py                # Shared clients (GA, BQ, Firestore) + constants
├── bq_ml.py             # BQ ML pipeline: gap analysis, filter execution, intent prompts
├── config.yaml          # GCP project, table names, customer_id, API settings
├── google_ads_auth.py   # OAuth token refresh (in-memory, /secrets is read-only)
├── requirements.txt
└── routers/
    ├── datasets.py         # /api/datasets — CRUD + background ingestion for all types
    ├── dataset_groups.py   # /api/dataset-groups
    ├── gap_analysis.py     # /api/gap-analyses — pipeline + results query
    ├── filter_executions.py
    ├── filters.py
    └── settings.py         # /api/settings/prompts — per-type prompt overrides

frontend/src/
├── App.jsx              # Routes: /datasets, /dataset-groups, /gap-analyses, /filters
└── pages/
    ├── DatasetsPage.jsx
    ├── DatasetDetailPage.jsx
    ├── DatasetGroupsPage.jsx
    ├── DatasetGroupDetailPage.jsx
    ├── GapAnalysesPage.jsx
    └── GapAnalysisDetailPage.jsx
```

---

## Local Development

### 1. Infrastructure

```bash
cd terraform
terraform init
terraform apply
```

### 2. Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Ensure scripts/google-ads.yaml is present (see above)
uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

API: http://localhost:8000  
Docs: http://localhost:8000/docs

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173

---

## Security

⚠️ **Never commit:**
- `scripts/google-ads.yaml`
- `terraform/*.tfstate`
- `backend/service-account-key.json`

---

## Cleanup

```bash
cd terraform
terraform destroy
```

⚠️ Permanently deletes all Firestore and BigQuery data.
