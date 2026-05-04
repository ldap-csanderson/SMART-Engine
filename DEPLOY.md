# SMART Engine — Deployment Guide

## Overview

The deployment system is fully parameterized via `deployments/<env>.env` files.
A single `deploy.sh` script handles all environments. No deployment branches needed.

**Infrastructure provisioning** (Terraform) is a one-time operation for fresh GCP projects.
**Application updates** (build + Cloud Run deploy) are the day-to-day operation.

---

## Existing Deployments

| Environment     | GCP Project                       | URL                                                         |
|-----------------|-----------------------------------|-------------------------------------------------------------|
| `csanderson`    | csanderson-experimental-443821    | https://smart-engine-727077869999.us-central1.run.app       |
| `people`        | people-gandalf                    | https://smart-engine-1000183467008.us-central1.run.app      |

---

## Updating an Existing Deployment

```bash
./deploy.sh <env-name>
```

**Examples:**
```bash
./deploy.sh csanderson    # deploy to csanderson-experimental-443821
./deploy.sh people        # deploy to people-gandalf
```

This will:
1. Build the Docker image (with the correct brand name embedded)
2. Push to Artifact Registry
3. Deploy the new image to Cloud Run

Terraform is **not** run — infrastructure already exists.

---

## Fresh Deployment (New GCP Project)

### 1. Prerequisites

- GCP project created with billing enabled
- `gcloud` CLI installed and authenticated: `gcloud auth login`
- Terraform >= 1.0 installed
- Required GCP permissions: Project Owner or equivalent

### 2. Create an environment file

```bash
cp deployments/csanderson.env deployments/<env-name>.env
```

Edit `deployments/<env-name>.env`:
```bash
PROJECT_ID="your-gcp-project-id"
BRAND_NAME="Your Brand Name"
# Optional overrides (defaults shown):
# REGION="us-central1"
# REPO="app"
# IMAGE_NAME="smart-engine"
```

Commit the new `.env` file to `main`.

### 3. Pre-deployment GCP setup (manual, one-time)

Before running Terraform, a few resources must be created manually:

**a) Enable APIs** (Terraform will also try, but doing it first avoids delays):
```bash
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  bigquery.googleapis.com \
  bigqueryconnection.googleapis.com \
  aiplatform.googleapis.com \
  firestore.googleapis.com \
  iam.googleapis.com \
  --project=<PROJECT_ID>
```

**b) Create Secret Manager secret** with your Google Ads YAML config:
```bash
gcloud secrets create google-ads-yaml --project=<PROJECT_ID>
gcloud secrets versions add google-ads-yaml \
  --data-file=scripts/google-ads.yaml \
  --project=<PROJECT_ID>
```

**c) Create Artifact Registry repository:**
```bash
gcloud artifacts repositories create app \
  --repository-format=docker \
  --location=us-central1 \
  --project=<PROJECT_ID>
```

### 4. Provision + build + deploy

```bash
./deploy.sh <env-name> --init
```

This will:
1. Create a GCS bucket for Terraform state (`<PROJECT_ID>-smart-engine-tfstate`)
2. Run `terraform init` (using GCS backend)
3. Run `terraform apply` to provision all infrastructure
4. Build the Docker image
5. Deploy to Cloud Run

### 5. Post-deployment: register OAuth redirect URIs

The Cloud Run URL is printed at the end of `deploy.sh`. Register these URIs in your
Google Cloud OAuth client (the one referenced in `google-ads.yaml`):

```
https://<service-url>/api/auth/google-ads/callback
https://<service-url>/api/auth/google-drive/callback
```

Navigate to: GCP Console → APIs & Services → Credentials → OAuth 2.0 Client IDs

---

## Working with Terraform Manually

When working with Terraform directly (not via `deploy.sh`), you must initialize with
the project-specific backend config. Each GCP project has its own isolated Terraform
state stored in a GCS bucket in that project.

```bash
cd terraform

# Initialize (do this once per machine per deployment target)
terraform init \
  -backend-config="bucket=<PROJECT_ID>-smart-engine-tfstate" \
  -backend-config="prefix=state"

# Then run normally:
terraform plan -var="project_id=<PROJECT_ID>" -var="app_image=..."
terraform apply -var="project_id=<PROJECT_ID>" -var="app_image=..."
```

### ⚠️ Terraform State Warning

**Never** run `terraform apply` after switching to a different GCP project without
re-initializing the backend. The local `.terraform/` directory caches the backend
config, which points to the previous project's GCS bucket.

If you switch targets:
```bash
terraform init \
  -backend-config="bucket=<NEW_PROJECT_ID>-smart-engine-tfstate" \
  -backend-config="prefix=state" \
  -reconfigure    # ← required when switching backends
```

---

## Adding a New Deployment Environment

1. Create `deployments/<env-name>.env` with `PROJECT_ID` and `BRAND_NAME`
2. Follow the **Fresh Deployment** steps above
3. Commit the `.env` file to `main`

Do **not** create a branch for new deployments. All environments are managed
on `main` via the `deployments/*.env` files.

---

## How Deploy-time Brand Customization Works

The `BRAND_NAME` in the `.env` file is injected into the Docker build via
`--build-arg VITE_BRAND_NAME=...`. Vite embeds it at bundle time as
`import.meta.env.VITE_BRAND_NAME`, which `Navbar.jsx` reads.

This means the brand is **baked into the image** — no runtime env var needed.

---

## How Project/URL Configuration Works

At deploy time, `deploy.sh` automatically:
- Computes the Cloud Run URL from the project number (deterministic)
- Passes `GCP_PROJECT_ID` and `CLOUD_RUN_URL` as Cloud Run env vars
- The backend derives OAuth redirect URIs from `CLOUD_RUN_URL`

**No project-specific values are hardcoded** in source files. `config.yaml`
contains only generic defaults; all environment-specific values come from
Cloud Run env vars set by `deploy.sh`.

---

## Troubleshooting

**`terraform apply` fails with 409 Conflict**
→ You have the wrong state. Check that `terraform init` was run with the correct
  `--backend-config="bucket=<PROJECT_ID>-..."`. Run with `-reconfigure` if switching.

**`gcloud builds submit` fails with "no source files"**
→ Run from the project root, not `backend/` or any subdirectory.

**Cloud Run says `GCP project ID not set`**
→ The `GCP_PROJECT_ID` env var is not being passed. Check the `--set-env-vars` flag
  in your `gcloud run deploy` command or re-run `deploy.sh`.

**OAuth redirect URI mismatch**
→ The `CLOUD_RUN_URL` env var may be wrong, or the redirect URI hasn't been added
  to the OAuth client in GCP Console. Check `GET /api/auth/google-ads/start` response.
