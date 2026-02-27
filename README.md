# Gap Analysis

A full-stack application that identifies content gaps between keyword reports and your portfolio, using Google Ads Keyword Planner + BigQuery ML (Gemini + text embeddings).

## Architecture

```
gap_analysis_v2/
├── backend/          # FastAPI — modular routers, Firestore + BigQuery
├── frontend/         # React + Tailwind CSS SPA
├── terraform/        # GCP infrastructure (BigQuery, Firestore, Vertex AI)
└── scripts/          # Standalone Google Ads fetch scripts
```

### Data Flow

```
1. Keyword Report
   Google Ads Keyword Planner API
       ↓ (background task)
   Firestore: keyword_reports  ←→  BigQuery: keyword_results
   (metadata + status)              (all keyword rows, run_id FK)

2. Gap Analysis
   BigQuery ML pipeline (bq_ml.py)
   ├── Step 1: ML.GENERATE_TEXT  → keyword intent strings (Gemini)
   ├── Step 2: ML.GENERATE_EMBEDDING → keyword embeddings
   ├── Step 3: ML.GENERATE_EMBEDDING → portfolio embeddings (cached by prompt hash)
   └── Step 4: ML.DISTANCE (cosine) → closest portfolio match per keyword
       ↓
   BigQuery: gap_analysis_results
   (analysis_id, keyword_text, keyword_intent, closest_portfolio_item,
    closest_portfolio_intent, semantic_distance, avg_monthly_searches)

3. Filter Executions (optional, post-analysis)
   BigQuery ML pipeline (bq_ml.py)
   └── ML.GENERATE_TEXT → boolean classification per keyword per filter
       ↓
   BigQuery: filter_results
   (execution_id, analysis_id, keyword_text, label, result BOOL, confidence)
   
   Firestore: filter_executions
   (snapshot of filter state at execution time — immutable after run)
```

### Storage Split

| Layer | Technology | Contents |
|---|---|---|
| Metadata | Firestore | Reports, analyses, filters, filter_executions, portfolio, settings |
| Analytics | BigQuery | keyword_results, portfolio_items/embeddings, gap_analysis_results, filter_results |

Firestore is used for metadata because it supports instant deletes/updates without BigQuery streaming buffer delays. BigQuery is used for keyword data because it handles millions of rows with SQL and ML functions.

### Immutability Design

All analysis results are designed to be immutable with respect to their inputs:
- **Keyword Reports** — BQ rows are never modified after write; archive/unarchive only changes metadata
- **Gap Analysis** — `closest_portfolio_item` and `closest_portfolio_intent` are written as literal strings at run time; portfolio changes don't affect existing results
- **Filter Executions** — the filter's `name`, `label`, and `text` are snapshotted into Firestore at run time; editing the live filter doesn't affect past executions

## Features

- **Keyword Reports** — fetch keyword ideas for a list of URLs via Google Ads Keyword Planner; results written to both Firestore (metadata) and BigQuery (rows)
- **Gap Analysis** — 5-step BigQuery ML pipeline using Gemini Flash + text-embedding-005 to find which keywords are semantically furthest from your portfolio; can optionally chain filter executions on completion
- **Portfolio embedding cache** — portfolio items are re-embedded only when the prompt changes (keyed by SHA-256 hash of the prompt)
- **Filters** — LLM-evaluated boolean classifiers (e.g. `purchase_intent`, `non_branded`, `affiliate_suitable`); each filter has a natural language `text` description that instructs Gemini to return `{label: true/false, confidence: "high/medium/low"}`
- **Filter Executions** — run any filter against a completed gap analysis; results stored in BQ with the filter snapshot preserved; apply multiple filters at query time with AND logic
- **Portfolio** — manage portfolio content items used as the "known" side of gap analysis
- **Settings** — customise Gemini prompts for keyword-to-intent and portfolio-to-intent transformations

## Prerequisites

- Python 3.11+
- Node.js 20+
- Google Cloud SDK (`gcloud`)
- Terraform ≥ 1.0
- GCP project with billing enabled
- Google Ads Developer Token + `scripts/google-ads.yaml`

## Deployment Options

This application can be deployed in two ways:

1. **Cloud Run (GCP)** - Recommended for easy deployment with auto-scaling
2. **Local/VPS** - For development or self-hosted environments

---

## Cloud Run Deployment (Production)

Deploy both frontend and backend to Google Cloud Run with a single command.

### Prerequisites

- `gcloud` CLI authenticated: `gcloud auth login`
- `gcloud` configured for billing account
- Project ID: `gap-analysis-nlf` (or update in `deploy.sh` and `terraform/variables.tf`)

### Initial Setup (One-Time)

#### 1. Upload Google Ads Config to Secret Manager

```bash
gcloud secrets create google-ads-yaml \
  --data-file=scripts/google-ads.yaml \
  --replication-policy=automatic \
  --project=gap-analysis-nlf
```

This secret is automatically mounted to the backend Cloud Run container at `/secrets/google-ads.yaml`.

#### 2. Enable Required APIs

```bash
cd terraform
terraform init
terraform plan
terraform apply
```

Creates:
- BigQuery dataset/tables
- Firestore database + composite indexes
- Vertex AI connection
- Artifact Registry for Docker images
- Secret Manager configuration
- Service accounts with IAM permissions

#### 3. Deploy Application

```bash
chmod +x deploy.sh
./deploy.sh
```

The script will:
1. Build backend Docker image and push to Artifact Registry
2. Build frontend Docker image (with backend URL baked in) and push to Artifact Registry
3. Deploy both services to Cloud Run via Terraform
4. Display service URLs

**Initial deployment takes ~5-10 minutes.** Subsequent deployments take ~2-3 minutes.

### Accessing Your Deployment

After deployment completes, you'll see:

```
✅ Deployment complete!

📋 Service URLs:
   Frontend: https://gap-analysis-frontend-xxxxx-uc.a.run.app
   Backend:  https://gap-analysis-backend-xxxxx-uc.a.run.app
```

Visit the frontend URL in your browser.

### Updating the Application

After making code changes, simply run:

```bash
./deploy.sh
```

Cloud Run will:
- Build new images
- Deploy with zero downtime
- Switch traffic automatically

### Architecture

```
┌─────────────────────┐
│ Cloud Run (Frontend)│
│  Nginx + React SPA  │
└──────────┬──────────┘
           │
           ↓ (calls /api/*)
┌─────────────────────┐
│ Cloud Run (Backend) │
│  FastAPI + uvicorn  │
│  min/max: 1 instance│
└──────────┬──────────┘
           │
           ↓ (uses)
┌─────────────────────────────────┐
│ GCP Services                    │
│ • BigQuery (analytics data)     │
│ • Firestore (metadata)          │
│ • Vertex AI (Gemini + embeddings)│
│ • Secret Manager (google-ads.yaml)│
└─────────────────────────────────┘
```

#### API Routing

The frontend uses `/api/*` URLs while the backend serves from root (`/keyword-reports`, not `/api/keyword-reports`). This is handled through a **dual-layer approach**:

1. **JavaScript Fetch Interceptor** (`frontend/src/config.js`):
   - Overrides `window.fetch` to rewrite `/api/*` → `VITE_API_URL/*`
   - Enables flexible backend URLs (localhost in dev, Cloud Run in prod)
   - Injected via `import './config'` in `main.jsx`

2. **Nginx Proxy** (`frontend/nginx.conf`):
   - Proxies `/api/*` → `backend/*` (strips prefix)
   - Enables direct API testing via curl/Postman
   - Configured with hardcoded backend URL for production

This approach requires **zero code changes** across 34 fetch calls in the React app!

**Key Design Decisions:**
- Both services run with `min_instance_count = 1` and `max_instance_count = 1`
- Single instance ensures background tasks complete without interruption
- Backend uses FastAPI BackgroundTasks (no Celery/Redis needed)
- Secrets mounted as volume from Secret Manager
- CORS configured for Cloud Run URLs

### Cost Estimate

With min/max = 1 instance (always running):
- **Cloud Run**: ~$20-30/month (2 vCPU backend + 1 vCPU frontend, idle most of the time)
- **BigQuery**: Pay per query (existing cost)
- **Firestore**: Free tier covers typical usage
- **Artifact Registry**: ~$0.10/GB storage
- **Secret Manager**: $0.06/secret/month

To reduce costs, remove `min_instance_count = 1` in `terraform/cloud_run.tf` (allows scale to zero, but background tasks may be interrupted).

### Troubleshooting

**View backend logs:**
```bash
gcloud run services logs read gap-analysis-backend --region=us-central1 --limit=50
```

**View frontend logs:**
```bash
gcloud run services logs read gap-analysis-frontend --region=us-central1 --limit=50
```

**Describe services:**
```bash
gcloud run services describe gap-analysis-backend --region=us-central1
gcloud run services describe gap-analysis-frontend --region=us-central1
```

**Re-upload Google Ads secret (if expired):**
```bash
gcloud secrets versions add google-ads-yaml --data-file=scripts/google-ads.yaml
```

### Security

The services are currently configured with `allUsers` invoker permissions (public access). To restrict access:

1. Edit `terraform/cloud_run.tf` and change:
   ```hcl
   member   = "allUsers"
   ```
   to:
   ```hcl
   member   = "user:your-email@example.com"
   # or
   member   = "domain:example.com"
   ```

2. Re-apply: `cd terraform && terraform apply`

Alternatively, configure [Identity-Aware Proxy](https://cloud.google.com/iap/docs/enabling-cloud-run) for enterprise authentication.

---

## Local Development

For local development or self-hosted VPS deployment.

### 1. Deploy Infrastructure

```bash
cd terraform
terraform init
terraform apply
```

Creates: BigQuery dataset/tables, Firestore database + composite indexes, Vertex AI connection, service account.

### 2. Setup Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Copy and fill in environment variables
cp .env.example .env
# Set GCP_SERVICE_ACCOUNT_KEY_PATH if not using ADC

uvicorn api:app --host 0.0.0.0 --port 8000 --reload
```

API: `http://localhost:8000`  
Docs: `http://localhost:8000/docs`

### 3. Setup Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend: `http://localhost:5173`

## API Endpoints

### Keyword Reports
| Method | Path | Description |
|---|---|---|
| `POST` | `/keyword-reports` | Submit URLs → background keyword fetch |
| `GET` | `/keyword-reports` | List reports (`?status=archived` for archived) |
| `GET` | `/keyword-reports/{id}/keywords` | Keywords for a report (from BigQuery) |
| `PATCH` | `/keyword-reports/{id}/archive` | Archive a completed report |
| `PATCH` | `/keyword-reports/{id}/unarchive` | Restore an archived report |
| `DELETE` | `/keyword-reports/{id}` | Hard-delete a failed report |

### Gap Analysis
| Method | Path | Description |
|---|---|---|
| `POST` | `/gap-analyses` | Run pipeline against a keyword report; optional `filter_ids` to chain filters after completion |
| `GET` | `/gap-analyses` | List analyses |
| `GET` | `/gap-analyses/{id}` | Get analysis status |
| `GET` | `/gap-analyses/{id}/results` | Paginated results with sorting and optional filter application |
| `DELETE` | `/gap-analyses/{id}` | Delete analysis (cascades to filter_executions + BQ filter_results) |

**Results query params:**
- `order_by`: `semantic_distance` | `avg_monthly_searches` | `keyword_text`
- `order_dir`: `ASC` | `DESC`
- `filter_execution_ids`: repeat for each execution to AND together (e.g. `?filter_execution_ids=abc&filter_execution_ids=def`)

### Filter Executions
| Method | Path | Description |
|---|---|---|
| `POST` | `/gap-analyses/{id}/filter-executions` | Run one or more filters against a completed analysis; body: `{filter_ids: [...]}` |
| `GET` | `/gap-analyses/{id}/filter-executions` | List all executions for an analysis |
| `DELETE` | `/gap-analyses/{id}/filter-executions/{exec_id}` | Delete execution + BQ rows |

**Collision rule:** A 409 is returned if any of the submitted filters share a `label` or `name` with an existing processing/completed execution on the same analysis.

### Filters
| Method | Path | Description |
|---|---|---|
| `GET` | `/filters` | List all filters |
| `POST` | `/filters` | Create a filter (`name`, `label`, `text`) |
| `GET/PUT/DELETE` | `/filters/{id}` | Manage a filter |

### Other
| Method | Path | Description |
|---|---|---|
| `GET/PUT` | `/portfolio` | Get/replace portfolio items |
| `GET` | `/portfolio/meta` | Portfolio metadata |
| `GET/PUT` | `/settings/prompts` | Gemini prompt templates |
| `GET` | `/health` | Connection status for GA, BQ, Firestore |

## Data Schema

### Firestore Collections

**`keyword_reports`**
```json
{
  "report_id": "uuid",
  "name": "My Report",
  "created_at": "timestamp",
  "status": "processing | completed | failed | archived",
  "urls": ["https://example.com"],
  "total_keywords_found": 5885,
  "error_message": null
}
```

**`gap_analyses`**
```json
{
  "analysis_id": "uuid",
  "name": "My Analysis",
  "report_id": "uuid",
  "status": "processing | completed | failed",
  "created_at": "timestamp",
  "total_keywords_analyzed": 5785,
  "error_message": null
}
```

**`filters`**
```json
{
  "filter_id": "uuid",
  "name": "Brand Filter",
  "label": "non_branded",
  "text": "TRUE: Generic product categories...\nFALSE: Contains a specific brand name...",
  "status": "active",
  "created_at": "timestamp",
  "updated_at": null
}
```

**`filter_executions`**
```json
{
  "execution_id": "uuid",
  "analysis_id": "uuid",
  "filter_id": "uuid",
  "filter_snapshot": {
    "name": "Brand Filter",
    "label": "non_branded",
    "text": "..."
  },
  "status": "processing | completed | failed",
  "created_at": "timestamp",
  "total_evaluated": 5785,
  "error_message": null
}
```

> `filter_snapshot` preserves the exact filter state at execution time. Editing the live filter afterward does not affect past executions.

### BigQuery Tables (`keyword_planner_data` dataset)

| Table | Key Columns |
|---|---|
| `keyword_results` | `run_id`, `source_url`, `keyword_text`, `avg_monthly_searches`, `competition`, `low/high_top_of_page_bid_usd` |
| `portfolio_items` | `item_text` |
| `portfolio_embeddings` | `item_text`, `intent_string`, `embedding`, `prompt_hash`, `embedded_at` |
| `gap_analysis_results` | `analysis_id`, `keyword_text`, `keyword_intent`, `closest_portfolio_item`, `closest_portfolio_intent`, `semantic_distance`, `avg_monthly_searches` |
| `filter_results` | `execution_id`, `analysis_id`, `keyword_text`, `label`, `result` (BOOL), `confidence`, `created_at` |

### BigQuery ML Models (`keyword_planner_data` dataset)

| Model | Endpoint | Used for |
|---|---|---|
| `gemini-flash` | `gemini-2.5-flash` | Keyword/portfolio intent generation + filter boolean classification |
| `text-embeddings` | `text-embedding-005` | Semantic embeddings (512-dim, SEMANTIC_SIMILARITY) |

Both models are created at startup via `CREATE MODEL IF NOT EXISTS` and shared across all pipelines.

## Dev Environment (tmux)

```bash
# Start both servers
tmux new-session -d -s gap_analysis 2>/dev/null || true

tmux kill-window -t gap_analysis:backend 2>/dev/null
tmux new-window -t gap_analysis -n backend \
  "cd $(pwd)/backend && uvicorn api:app --host 0.0.0.0 --port 8000 --reload"

tmux kill-window -t gap_analysis:frontend 2>/dev/null
tmux new-window -t gap_analysis -n frontend \
  "cd $(pwd)/frontend && npm run dev"

echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:5173"
```

### Health Check

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

## Code Structure

```
backend/
├── api.py               # FastAPI app, CORS, lifespan startup
├── db.py                # Shared GA/BQ/Firestore clients, constants
├── bq_ml.py             # BQ ML model management, gap analysis pipeline, filter pipeline
├── config.yaml          # GCP project, table names, API settings
├── requirements.txt
└── routers/
    ├── keyword_reports.py    # /keyword-reports
    ├── gap_analysis.py       # /gap-analyses (pipeline + results query)
    ├── filter_executions.py  # /gap-analyses/{id}/filter-executions
    ├── portfolio.py          # /portfolio
    ├── filters.py            # /filters
    └── settings.py           # /settings/prompts

frontend/src/
├── App.jsx                     # Routes + layout
├── components/
│   ├── Navbar.jsx
│   ├── ReportsList.jsx
│   ├── KeywordTable.jsx
│   ├── NewReportModal.jsx
│   ├── NewFilterModal.jsx
│   └── ...
└── pages/
    ├── KeywordReportsPage.jsx  # /keyword-reports
    ├── ReportDetailPage.jsx    # /keyword-reports/:id
    ├── FiltersPage.jsx
    ├── FilterDetailPage.jsx
    └── PortfolioPage.jsx

terraform/
├── main.tf               # Provider, API enablement
├── bigquery.tf           # Dataset + all tables (keyword_results, portfolio, gap_analysis_results, filter_results)
├── firestore.tf          # Firestore database + composite indexes
├── vertex_ai.tf          # Vertex AI connection + IAM
├── service_accounts.tf
└── outputs.tf
```

## Security

⚠️ **Never commit:**
- `backend/service-account-key.json`
- `backend/.env`
- `scripts/google-ads.yaml`
- `terraform/*.tfstate`

## Cleanup

```bash
cd terraform
terraform destroy
```

⚠️ Permanently deletes all Firestore and BigQuery data.
