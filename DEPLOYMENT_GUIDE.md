# SMART Engine — Deployment Guide

**GCP Project:** `csanderson-experimental-443821`  
**Region:** `us-central1`  
**Cloud Run Service:** `smart-engine`  
**Live URL:** https://smart-engine-xdzhjknata-uc.a.run.app

---

## How Deployment Works

`deploy.sh` does three things in order:

1. **`terraform apply`** — provisions/updates all GCP infrastructure (BQ tables, Firestore indexes, IAM, Cloud Run service config)
2. **`gcloud builds submit`** — builds the Docker image (React frontend + FastAPI backend in one container) and pushes to Artifact Registry
3. **`terraform apply`** again — updates the Cloud Run service to use the new image tag

The image is always tagged `:latest`. Cloud Run creates a new revision on each deploy and shifts 100% of traffic to it automatically.

---

## First-Time Setup

### Prerequisites

- `gcloud` CLI authenticated: `gcloud auth login`
- Application Default Credentials: `gcloud auth application-default login`
- Terraform ≥ 1.0 installed
- `scripts/google-ads.yaml` populated with valid OAuth credentials (see README)

### 1. Upload the Google Ads Secret

The Google Ads YAML is stored in Secret Manager and mounted read-only into Cloud Run at `/secrets/google-ads.yaml`.

```bash
# First time: create the secret
gcloud secrets create google-ads-yaml \
  --data-file=scripts/google-ads.yaml \
  --replication-policy=automatic \
  --project=csanderson-experimental-443821
```

### 2. Initialize Terraform

```bash
cd terraform
terraform init
```

### 3. Handle Pre-Existing Resources

If GCP resources already exist (from a previous deploy or manual creation), Terraform will error with 409 conflicts. Import them before applying:

```bash
cd terraform

# Artifact Registry repo
terraform import google_artifact_registry_repository.app \
  projects/csanderson-experimental-443821/locations/us-central1/repositories/app

# Firestore database
terraform import google_firestore_database.database \
  projects/csanderson-experimental-443821/databases/(default)

# Secret Manager secret
terraform import google_secret_manager_secret.google_ads_yaml \
  projects/csanderson-experimental-443821/secrets/google-ads-yaml
```

### 4. Deploy

```bash
chmod +x deploy.sh
./deploy.sh
```

First deployment takes ~5-10 minutes (API enablement, BQ model creation, image build).

---

## Routine Updates

After making code changes:

```bash
./deploy.sh
```

This rebuilds the image and deploys a new Cloud Run revision. Takes ~3-4 minutes.

---

## Google Ads Re-Authorization (In-App)

The app includes a built-in OAuth re-authorization flow. When the Google Ads token expires or is revoked, go to **Settings → Authorize Google Ads** in the UI.

### One-time Setup (Required Before First Use)

Add the callback URL as an **Authorized Redirect URI** in the Google Cloud Console:

1. Go to [APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials) in the `csanderson-experimental-443821` project
2. Click the OAuth 2.0 Client ID: `759167631809-1ibgmfql9fp8o6be06nub9q5pcle8117.apps.googleusercontent.com`
3. Under **Authorized redirect URIs**, add:
   ```
   https://smart-engine-xdzhjknata-uc.a.run.app/api/auth/google-ads/callback
   ```
4. Save

### How the Flow Works

1. Click **Authorize Google Ads** on the Settings page
2. A popup opens — sign in with the Google account that has access to the MCC
3. Grant the `Google Ads API` scope
4. The popup closes and the app is immediately reconnected (no restart needed)
5. The new refresh token is written to Secret Manager and persists across restarts

### Manual Fallback (CLI)

If the in-app flow is unavailable, update the secret manually:

```bash
# Edit scripts/google-ads.yaml with a fresh refresh_token, then:
gcloud secrets versions add google-ads-yaml \
  --data-file=scripts/google-ads.yaml \
  --project=csanderson-experimental-443821

# Force a new Cloud Run revision to pick up the new secret
gcloud run services update smart-engine \
  --region=us-central1 \
  --project=csanderson-experimental-443821
```

---

## Changing the Customer ID

The Google Ads customer ID is set in `backend/config.yaml`:

```yaml
google_ads:
  customer_id: "2900871247"
```

To change it: update `config.yaml`, then run `./deploy.sh` to rebuild and redeploy.

---

## Infrastructure Overview

All infrastructure is managed by Terraform in `terraform/`:

| Resource | Name |
|---|---|
| Cloud Run service | `smart-engine` |
| Service account | `smart-engine-app@csanderson-experimental-443821.iam.gserviceaccount.com` |
| Artifact Registry | `us-central1-docker.pkg.dev/csanderson-experimental-443821/app` |
| BQ dataset | `smart_engine_data` (us-central1) |
| BQ tables | `dataset_items`, `dataset_embeddings`, `gap_analysis_results`, `filter_results` |
| BQ connection | `us-central1.vertex-ai-connection` (for BQ ML → Vertex AI) |
| Firestore | `(default)` database |
| Secret | `google-ads-yaml` |

### IAM Roles (service account)

- `roles/bigquery.user`
- `roles/bigquery.dataEditor`
- `roles/bigquery.jobUser`
- `roles/bigquery.connectionUser`
- `roles/datastore.user`
- `roles/aiplatform.user`
- `roles/secretmanager.secretAccessor`
- `roles/secretmanager.secretVersionAdder` *(for in-app OAuth token rotation)*

---

## Terraform State

Terraform state is stored **locally** in `terraform/terraform.tfstate`. This file is gitignored. Keep it safe — losing it means you'll need to re-import existing resources.

If you're working from a new machine and the state file is missing, import existing resources as shown in the First-Time Setup section above.

---

## Troubleshooting

### View logs

```bash
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="smart-engine"' \
  --project=csanderson-experimental-443821 \
  --limit=50 \
  --format="value(textPayload)"
```

### Health check

```bash
curl -s https://smart-engine-xdzhjknata-uc.a.run.app/api/health | jq .
```

Expected when fully operational:
```json
{
  "status": "healthy",
  "google_ads_connected": true,
  "bigquery_connected": true,
  "firestore_connected": true
}
```

### Describe Cloud Run service

```bash
gcloud run services describe smart-engine \
  --region=us-central1 \
  --project=csanderson-experimental-443821
```

### Common Issues

**`google_ads_connected: false`**  
The OAuth refresh token has expired or been revoked (`invalid_grant`). Use the **Settings → Authorize Google Ads** button in the UI (see "Google Ads Re-Authorization" above) — no restart needed. As a fallback, use the manual CLI method.

**Container fails to start**  
Check logs for Python import errors or missing config. Common causes:
- `config.yaml` references a table/key that doesn't exist
- Python import error (check `routers/` for stale v2 imports)

**Terraform 409 conflicts on first apply**  
Resources exist in GCP but not in Terraform state. Import them (see "Handle Pre-Existing Resources" above).

**Cloud Run "image not found" on first apply**  
Terraform tries to deploy the Cloud Run service before the image is built. Run the full `./deploy.sh` script — it handles the correct ordering (terraform → build → terraform).

---

## Cleanup

```bash
cd terraform
terraform destroy
```

⚠️ Permanently deletes all infrastructure including BigQuery data and Firestore documents.
