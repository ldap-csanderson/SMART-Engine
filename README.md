# Keyword Planner Application

A full-stack application for keyword research using Google Ads Keyword Planner API with hybrid Firestore + BigQuery storage.

## Architecture

```
gap_analysis_v2/
├── backend/          # FastAPI backend with Firestore + BigQuery
├── frontend/         # React + Tailwind CSS frontend  
├── terraform/        # Infrastructure as Code (GCP resources)
└── scripts/          # Utility scripts for Google Ads
```

### Hybrid Data Architecture

```
┌─────────────────────────────────────────┐
│ Metadata Layer (Firestore)              │
│ - Run metadata (CRUD-friendly)          │
│ - Instant updates ✅                     │
│ - No streaming buffer delays            │
└─────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│ Analytics Layer (BigQuery)               │
│ - Keyword results (append-only)          │
│ - Optimized for data warehouse           │
│ - Query millions of keywords             │
└─────────────────────────────────────────┘
```

**Why Hybrid?**
- **Firestore** for metadata: Instant archive/unarchive (no BigQuery streaming buffer delays)
- **BigQuery** for keywords: Optimized for large-scale analytics and SQL queries

## Features

### Backend (FastAPI)
- **Keyword Research API**: Fetch keyword ideas from Google Ads Keyword Planner
- **Hybrid Storage**: Firestore for metadata, BigQuery for keyword data
- **Instant CRUD**: Archive/unarchive runs immediately (no delays)
- **Configuration Management**: YAML-based config with environment variables

### Frontend (React + Tailwind)
- **Unified Dashboard**: Search + history in one view
- **Real-time Management**: Archive and view runs instantly
- **Data Visualization**: Summary cards and detailed keyword tables
- **Component Architecture**: Clean, reusable React components

### Infrastructure (Terraform)
- **Automated Provisioning**: Complete GCP infrastructure setup
- **Firestore Database**: For run metadata (instant CRUD)
- **BigQuery Table**: For keyword results (analytics)
- **Service Account**: Secure access with minimal permissions
- **Time Partitioning**: Efficient BigQuery storage and querying

## Prerequisites

- Python 3.11+
- Node.js 20+
- Google Cloud SDK
- Terraform >= 1.0
- GCP Project with billing enabled

## Quick Start

### 1. Deploy Infrastructure

```bash
cd terraform
terraform init
terraform apply
# Service account key will be saved to backend/service-account-key.json
```

### 2. Setup Backend

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Create .env file (already created by Terraform)
# Verify GCP_SERVICE_ACCOUNT_KEY_PATH points to service-account-key.json

# Start the API
python api.py
```

API will be available at `http://localhost:8000`

### 3. Setup Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Frontend will be available at `http://localhost:5173`

## API Endpoints

### POST `/keyword-planner`
Fetch keywords for URLs and save to Firestore + BigQuery
```json
{
  "urls": ["https://example.com"]
}
```

### GET `/runs`
List all research runs (non-archived by default)
- Query params: `status` (completed/failed/archived), `limit` (default: 100)

### GET `/runs/{run_id}/keywords`
Get all keywords for a specific run (metadata from Firestore, keywords from BigQuery)

### PATCH `/runs/{run_id}/archive`
Archive a run (instant update in Firestore)

### PATCH `/runs/{run_id}/unarchive`
Unarchive a run (instant update in Firestore)

### GET `/health`
Health check for Google Ads, BigQuery, and Firestore connections

## Configuration

### Backend Config (`backend/config.yaml`)
```yaml
gcp:
  project_id: "your-project-id"
  region: "us-central1"

bigquery:
  dataset: "keyword_planner_data"
  tables:
    results: "keyword_results"
```

### Environment Variables (`backend/.env`)
```bash
GCP_SERVICE_ACCOUNT_KEY_PATH=./service-account-key.json
```

## Data Schema

### Firestore Collection: `runs`
```json
{
  "run_id": "uuid",
  "created_at": "timestamp",
  "status": "completed|failed|archived",
  "urls": ["url1", "url2"],
  "total_keywords_found": 1043,
  "error_message": null
}
```

### BigQuery Table: `keyword_results`
- `run_id` (STRING): Foreign key to Firestore runs
- `created_at` (TIMESTAMP): Keyword fetch timestamp
- `source_url` (STRING): Source URL
- `keyword_text` (STRING): Keyword
- `avg_monthly_searches` (INTEGER): Search volume
- `competition` (STRING): LOW/MEDIUM/HIGH
- `competition_index` (INTEGER): 0-100
- `low_top_of_page_bid_usd` (FLOAT): Low bid estimate
- `high_top_of_page_bid_usd` (FLOAT): High bid estimate

## Dev Environment (tmux)

The backend and frontend each run in a named tmux window. Commands below assume the `gap_analysis` tmux session is already running.

### Backend (`gap_analysis:backend`)

| Action | Command |
|--------|---------|
| **Start** | `tmux new-window -t gap_analysis -n backend "cd $(pwd)/backend && uvicorn api:app --host 0.0.0.0 --port 8000 --reload"` |
| **Stop** | `tmux kill-window -t gap_analysis:backend` |
| **Restart** | `tmux kill-window -t gap_analysis:backend 2>/dev/null; tmux new-window -t gap_analysis -n backend "cd $(pwd)/backend && uvicorn api:app --host 0.0.0.0 --port 8000 --reload"` |
| **View logs** | `tmux attach -t gap_analysis:backend` (detach with `Ctrl-b d`) |

### Frontend (`gap_analysis:frontend`)

| Action | Command |
|--------|---------|
| **Start** | `tmux new-window -t gap_analysis -n frontend "cd $(pwd)/frontend && npm run dev"` |
| **Stop** | `tmux kill-window -t gap_analysis:frontend` |
| **Restart** | `tmux kill-window -t gap_analysis:frontend 2>/dev/null; tmux new-window -t gap_analysis -n frontend "cd $(pwd)/frontend && npm run dev"` |
| **View logs** | `tmux attach -t gap_analysis:frontend` (detach with `Ctrl-b d`) |

### Start Both at Once

```bash
# Start session if it doesn't exist
tmux new-session -d -s gap_analysis 2>/dev/null || true

# Backend
tmux kill-window -t gap_analysis:backend 2>/dev/null
tmux new-window -t gap_analysis -n backend "cd $(pwd)/backend && uvicorn api:app --host 0.0.0.0 --port 8000 --reload"

# Frontend
tmux kill-window -t gap_analysis:frontend 2>/dev/null
tmux new-window -t gap_analysis -n frontend "cd $(pwd)/frontend && npm run dev"

echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:5173"
```

### Health Check

```bash
curl -s http://localhost:8000/health | python3 -m json.tool
```

---

## Development

### Code Structure

**Backend:**
- `api.py` - Main FastAPI application with Firestore + BigQuery
- `config.yaml` - Configuration
- `requirements.txt` - Python dependencies

**Frontend:**
- `src/App.jsx` - Main dashboard component
- `src/components/SearchForm.jsx` - URL input form
- `src/components/RunsList.jsx` - Runs list with archive actions
- `src/components/KeywordTable.jsx` - Reusable keyword table
- `vite.config.js` - Vite configuration with proxy

**Terraform:**
- `main.tf` - Provider and API enablement
- `firestore.tf` - Firestore database configuration
- `bigquery.tf` - BigQuery dataset and tables
- `service_accounts.tf` - Service account and IAM
- `outputs.tf` - Terraform outputs

## Security Notes

⚠️ **NEVER commit these files:**
- `backend/service-account-key.json`
- `backend/.env`
- `scripts/google-ads.yaml`
- `terraform/*.tfstate`

## Cleanup

To destroy all GCP resources:
```bash
cd terraform
terraform destroy
```

⚠️ This will **permanently delete** all data in Firestore and BigQuery!

## Troubleshooting

### Firestore Connection Issues
1. Verify service account key path in `.env`
2. Check IAM permissions (roles/datastore.user)
3. Ensure Firestore API is enabled

### BigQuery Connection Issues
1. Verify service account key path in `.env`
2. Check IAM permissions (roles/bigquery.dataEditor, roles/bigquery.jobUser)
3. Ensure BigQuery API is enabled

### Google Ads API Errors
1. Verify `google-ads.yaml` exists in `scripts/` directory
2. Check customer ID in `config.yaml`
3. Ensure account has API access enabled

### Frontend CORS Issues
1. Verify backend is running on port 8000
2. Check Vite proxy configuration in `vite.config.js`
3. Ensure CORS origins are configured in `config.yaml`

## Contributing

1. Create feature branch
2. Make changes with clear commit messages
3. Test thoroughly
4. Submit pull request

## License

MIT
