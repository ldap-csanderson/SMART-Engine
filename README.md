# Gap Analysis

A full-stack application that identifies content gaps between competitor keyword traffic and your portfolio, using Google Ads Keyword Planner + BigQuery ML (Gemini + text embeddings).

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
   ├── Step 3: ML.GENERATE_EMBEDDING → portfolio embeddings (cached)
   └── Step 4: ML.DISTANCE (cosine) → closest portfolio match per keyword
       ↓
   BigQuery: gap_analysis_results
   (analysis_id, keyword_text, keyword_intent, closest_portfolio_item,
    closest_portfolio_intent, semantic_distance, avg_monthly_searches)
```

### Storage Split

| Layer | Technology | Contents |
|---|---|---|
| Metadata | Firestore | Reports, analyses, filters, portfolio, settings |
| Analytics | BigQuery | keyword_results, portfolio_items/embeddings, gap_analysis_results |

Firestore is used for metadata because it supports instant deletes/updates without BigQuery streaming buffer delays. BigQuery is used for keyword data because it handles millions of rows with SQL and ML functions.

## Features

- **Keyword Reports** — fetch keyword ideas for a list of URLs via Google Ads Keyword Planner; results written to both Firestore (metadata) and BigQuery (rows)
- **Gap Analysis** — 5-step BigQuery ML pipeline using Gemini Flash + text-embedding-005 to find which keywords are semantically furthest from your portfolio
- **Portfolio embedding cache** — portfolio items are re-embedded only when the prompt changes (keyed by SHA-256 hash)
- **Filters** — save reusable keyword filter sets (Firestore-backed)
- **Portfolio** — manage portfolio content items used as the "known" side of gap analysis
- **Settings** — customise Gemini prompts for keyword-to-intent and portfolio-to-intent transformations

## Prerequisites

- Python 3.11+
- Node.js 20+
- Google Cloud SDK (`gcloud`)
- Terraform ≥ 1.0
- GCP project with billing enabled
- Google Ads Developer Token + `scripts/google-ads.yaml`

## Quick Start

### 1. Deploy Infrastructure

```bash
cd terraform
terraform init
terraform apply
```

Creates: BigQuery dataset/tables, Firestore database, Vertex AI connection, service account.

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
| `POST` | `/gap-analyses` | Run pipeline against a keyword report |
| `GET` | `/gap-analyses` | List analyses |
| `GET` | `/gap-analyses/{id}` | Get analysis status |
| `GET` | `/gap-analyses/{id}/results` | Paginated results with sorting |
| `DELETE` | `/gap-analyses/{id}` | Delete analysis (Firestore + BigQuery) |

Results sort params: `order_by` (`semantic_distance`\|`avg_monthly_searches`\|`keyword_text`), `order_dir` (`ASC`\|`DESC`)

### Other
| Method | Path | Description |
|---|---|---|
| `GET/PUT` | `/portfolio` | Get/replace portfolio items |
| `GET` | `/portfolio/meta` | Portfolio metadata |
| `GET/POST` | `/filters` | List/create filters |
| `GET/PUT/DELETE` | `/filters/{id}` | Manage a filter |
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

### BigQuery Tables (`keyword_planner_data` dataset)

| Table | Key Columns |
|---|---|
| `keyword_results` | `run_id`, `source_url`, `keyword_text`, `avg_monthly_searches`, `competition`, `low/high_top_of_page_bid_usd` |
| `portfolio_items` | `item_text` |
| `portfolio_embeddings` | `item_text`, `intent_string`, `embedding`, `prompt_hash`, `embedded_at` |
| `gap_analysis_results` | `analysis_id`, `keyword_text`, `keyword_intent`, `closest_portfolio_item`, `closest_portfolio_intent`, `semantic_distance`, `avg_monthly_searches` |

### BigQuery ML Models (`keyword_planner_data` dataset)

| Model | Endpoint |
|---|---|
| `gemini-flash` | `gemini-2.5-flash` — keyword/portfolio intent generation |
| `text-embeddings` | `text-embedding-005` — semantic embeddings (512-dim) |

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
├── bq_ml.py             # BQ ML model management + gap analysis pipeline
├── config.yaml          # GCP project, table names, API settings
├── requirements.txt
└── routers/
    ├── keyword_reports.py  # /keyword-reports
    ├── gap_analysis.py     # /gap-analyses
    ├── portfolio.py        # /portfolio
    ├── filters.py          # /filters
    └── settings.py         # /settings/prompts

frontend/src/
├── App.jsx                     # Routes + layout (flex column, no overflow)
├── components/
│   ├── Navbar.jsx
│   ├── ReportsList.jsx         # Archive/delete/view per report status
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
├── main.tf            # Provider, API enablement
├── bigquery.tf        # Dataset, tables (keyword_results, portfolio, gap_analysis)
├── firestore.tf       # Firestore database
├── vertex_ai.tf       # Vertex AI Workbench + BQ connection
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
