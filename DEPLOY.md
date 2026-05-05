# SMART Engine — Deployment Guide

## Overview

The deployment system is fully parameterized via `deployments/<env>.env` files.
A single `deploy.sh` script handles all environments. No deployment branches needed.

**Infrastructure provisioning** (Terraform) is a one-time operation for fresh GCP projects.
**Application updates** (build + Cloud Run deploy) are the day-to-day operation.

---

## Existing Deployments

| Environment          | GCP Project                       | URL                                                         |
|----------------------|-----------------------------------|-------------------------------------------------------------|
| `csanderson`         | csanderson-experimental-443821    | https://smart-engine-727077869999.us-central1.run.app       |
| `people`             | people-gandalf                    | https://smart-engine-1000183467008.us-central1.run.app      |
| `ltv-smart-engine`   | ltv-smart-engine                  | https://smart-engine-<number>.us-central1.run.app           |

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

This builds the Docker image (with the correct brand name embedded), pushes it to
Artifact Registry, and deploys to Cloud Run. Terraform is **not** run.

---

## Fresh Deployment (New GCP Project)

### 1. Prerequisites

- GCP project created with billing enabled
- `gcloud` CLI installed and authenticated: `gcloud auth login`
- Terraform ≥ 1.0 installed
- Project Owner (or equivalent) permissions

### 2. Create an environment file

```bash
cp deployments/csanderson.env deployments/<env-name>.env
```

Edit it:
```bash
PROJECT_ID="your-gcp-project-id"
BRAND_NAME="Your Brand Name"
```

Commit the new `.env` file to `main`.

### 3. (Optional) Place Google Ads credentials

If you have a `scripts/google-ads.yaml`, the deploy script will automatically
upload it as the initial secret version. If the file is absent, a placeholder
is uploaded and you can replace it later.

### 4. Provision + build + deploy

```bash
./deploy.sh <env-name> --init
```

This will:
1. Create a GCS bucket for Terraform state (`<PROJECT_ID>-smart-engine-tfstate`)
2. Run `terraform init` (GCS backend, isolated state per project)
3. Run `terraform apply` — enables all required APIs, creates all infrastructure
4. Upload `scripts/google-ads.yaml` to Secret Manager (or a placeholder if absent)
5. Build the Docker image
6. Deploy to Cloud Run

### 5. Post-deployment: register OAuth redirect URIs

Add these to your Google Cloud OAuth client (referenced in `google-ads.yaml`):

```
https://<service-url>/api/auth/google-ads/callback
https://<service-url>/api/auth/google-drive/callback
```

Navigate to: GCP Console → APIs & Services → Credentials → OAuth 2.0 Client IDs

The service URL is printed at the end of `deploy.sh`.

### 6. Replace placeholder credentials (if needed)

If you deployed without `scripts/google-ads.yaml`, update the secret later:

```bash
gcloud secrets versions add google-ads-yaml \
  --data-file=scripts/google-ads.yaml \
  --project=<PROJECT_ID>
```

---

## Working with Terraform Manually

When working with Terraform directly (not via `deploy.sh`), initialize with the
project-specific backend config first:

```bash
cd terraform

terraform init \
  -backend-config="bucket=<PROJECT_ID>-smart-engine-tfstate" \
  -backend-config="prefix=state"

terraform plan -var="project_id=<PROJECT_ID>"
terraform apply -var="project_id=<PROJECT_ID>"
```

> **Note:** Cloud Run is managed entirely by `deploy.sh` (via `gcloud run deploy`),
> not by Terraform. Terraform provisions infrastructure only: APIs, service accounts,
> IAM, BigQuery, Firestore, Artifact Registry, and Secret Manager.

### ⚠️ Terraform State Warning

Each GCP project has its own isolated Terraform state in a GCS bucket. **Never**
run `terraform apply` after switching to a different project without re-initializing:

```bash
terraform init \
  -backend-config="bucket=<NEW_PROJECT_ID>-smart-engine-tfstate" \
  -backend-config="prefix=state" \
  -reconfigure    # ← required when switching backends
```

---

## Adding a New Deployment Environment

1. Create `deployments/<env-name>.env` with `PROJECT_ID` and `BRAND_NAME`
2. (Optional) Place Google Ads credentials at `scripts/google-ads.yaml`
3. Run `./deploy.sh <env-name> --init`
4. Register OAuth redirect URIs
5. Commit the `.env` file to `main`

Do **not** create a branch for new deployments.

---

## How It Works

### Brand customization
`BRAND_NAME` in the `.env` file is injected into the Docker build via
`--build-arg VITE_BRAND_NAME=...`. Vite embeds it at bundle time. Changing
the brand requires a redeploy.

### Project/URL configuration
`deploy.sh` computes the Cloud Run URL from the project number (deterministic),
then passes `GCP_PROJECT_ID` and `CLOUD_RUN_URL` as Cloud Run env vars. The
backend derives OAuth redirect URIs from `CLOUD_RUN_URL` automatically. No
project-specific values are hardcoded in source files.

### Secret management
Terraform creates the Secret Manager secret shell. `deploy.sh --init` uploads
the initial version from `scripts/google-ads.yaml` (or a placeholder). Subsequent
credential updates are done via `gcloud secrets versions add`.

---

## Troubleshooting

**`terraform apply` fails with 409 Conflict**
→ Wrong state. Re-run `terraform init` with the correct
  `--backend-config="bucket=<PROJECT_ID>-..."` and `-reconfigure`.

**`gcloud builds submit` fails**
→ Run from the project root directory, not a subdirectory.

**Cloud Run: `GCP project ID not set`**
→ The `GCP_PROJECT_ID` env var is missing. Re-run `./deploy.sh <env-name>`.

**OAuth redirect URI mismatch**
→ URI not registered in GCP Console, or `CLOUD_RUN_URL` is wrong.
  Check `GET /api/auth/google-ads/start` response for the expected URI.
