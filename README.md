# Keyword Planner Application

A full-stack application for keyword research using Google Ads Keyword Planner API with historical data tracking in BigQuery.

## Architecture

```
gap_analysis_v2/
├── backend/          # FastAPI backend with BigQuery integration
├── frontend/         # React + Tailwind CSS frontend
├── terraform/        # Infrastructure as Code (GCP resources)
└── scripts/          # Utility scripts for Google Ads
```

## Features

### Backend (FastAPI)
- **Keyword Research API**: Fetch keyword ideas from Google Ads Keyword Planner
- **BigQuery Integration**: Automatically saves all research runs and results
- **CRUD Operations**: List, view, and archive previous runs
- **Configuration Management**: YAML-based config with environment variables

### Frontend (React + Tailwind)
- **Modern UI**: Clean, responsive interface with Tailwind CSS
- **Real-time Analysis**: Fetch and display keyword data
- **Data Visualization**: Summary cards and detailed keyword tables
- **History Management**: View and manage previous research runs

### Infrastructure (Terraform)
- **Automated Provisioning**: Complete GCP infrastructure setup
- **BigQuery Tables**: Two tables for runs metadata and keyword results
- **Service Account**: Secure access with minimal permissions
- **Time Partitioning**: Efficient data storage and querying

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
Fetch keywords for URLs and save to BigQuery
```json
{
  "urls": ["https://example.com"]
}
```

### GET `/runs`
List all research runs (non-archived by default)
- Query params: `status` (completed/failed/archived), `limit` (default: 100)
- Returns `is_archivable` and `minutes_until_archivable` for each run

**Response includes archivability tracking:**
```json
{
  "runs": [{
    "run_id": "...",
    "created_at": "2026-02-24T05:45:11+00:00",
    "status": "completed",
    "is_archivable": false,
    "minutes_until_archivable": 84
  }]
}
```

### GET `/runs/{run_id}/keywords`
Get all keywords for a specific run

### PATCH `/runs/{run_id}/archive`
Archive a run (soft delete)
- **Note:** Due to BigQuery streaming buffer, runs can only be archived 90+ minutes after creation
- Use `is_archivable` field from `/runs` endpoint to check availability

### GET `/health`
Health check for API and BigQuery connection

## Configuration

### Backend Config (`backend/config.yaml`)
```yaml
gcp:
  project_id: "your-project-id"
  region: "us-central1"

bigquery:
  dataset: "keyword_planner_data"
  tables:
    runs: "keyword_runs"
    results: "keyword_results"
```

### Environment Variables (`backend/.env`)
```bash
GCP_SERVICE_ACCOUNT_KEY_PATH=./service-account-key.json
```

## Data Schema

### `keyword_runs` Table
- `run_id` (STRING): Unique identifier (UUID)
- `created_at` (TIMESTAMP): Run timestamp
- `status` (STRING): completed/failed/archived
- `urls` (REPEATED STRING): Analyzed URLs
- `total_keywords_found` (INTEGER): Total keywords
- `error_message` (STRING): Error if failed

### `keyword_results` Table
- `run_id` (STRING): Foreign key to runs
- `created_at` (TIMESTAMP): Keyword fetch timestamp
- `source_url` (STRING): Source URL
- `keyword_text` (STRING): Keyword
- `avg_monthly_searches` (INTEGER): Search volume
- `competition` (STRING): LOW/MEDIUM/HIGH
- `competition_index` (INTEGER): 0-100
- `low_top_of_page_bid_usd` (FLOAT): Low bid estimate
- `high_top_of_page_bid_usd` (FLOAT): High bid estimate

## Development

### Running Tests
```bash
# Backend
cd backend
pytest

# Frontend
cd frontend
npm test
```

### Code Structure

**Backend:**
- `api.py` - Main FastAPI application
- `config.yaml` - Configuration
- `requirements.txt` - Python dependencies

**Frontend:**
- `src/App.jsx` - Main React component
- `src/index.css` - Tailwind CSS imports
- `vite.config.js` - Vite configuration with proxy

**Terraform:**
- `main.tf` - Provider and API enablement
- `bigquery.tf` - Dataset and tables
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

⚠️ This will **permanently delete** all data in BigQuery!

## BigQuery Streaming Buffer & Archiving

### Understanding the Limitation

BigQuery uses a streaming buffer for recently inserted data (30-90 minutes). During this period:
- Data is queryable immediately ✅
- UPDATE/DELETE operations are not supported ❌

### Archivability Tracking

The API automatically calculates when runs can be archived:

```javascript
// Frontend polling example
async function checkArchivability() {
  const response = await fetch('/api/runs');
  const data = await response.json();
  
  data.runs.forEach(run => {
    if (run.is_archivable) {
      // Enable archive button
      enableArchiveButton(run.run_id);
    } else {
      // Show: "Archivable in 84 minutes"
      showCountdown(run.run_id, run.minutes_until_archivable);
    }
  });
}

// Poll every 5 minutes
setInterval(checkArchivability, 5 * 60 * 1000);
```

### Smart Polling Strategy

```javascript
function pollRuns() {
  fetch('/api/runs')
    .then(r => r.json())
    .then(data => {
      const nonArchivable = data.runs.filter(r => !r.is_archivable);
      
      if (nonArchivable.length === 0) {
        clearInterval(pollInterval);
        return;
      }
      
      // Poll again just after soonest run becomes archivable
      const soonestMinutes = Math.min(
        ...nonArchivable.map(r => r.minutes_until_archivable)
      );
      setTimeout(pollRuns, (soonestMinutes + 1) * 60 * 1000);
    });
}
```

## Troubleshooting

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
