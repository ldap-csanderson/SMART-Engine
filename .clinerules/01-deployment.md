# Deployment

Read **DEPLOY.md** before any deployment task — it is the authoritative guide.
Instructions here cover *how* to operate as an agent, not what the system does.

## Updating an existing environment

```bash
./deploy.sh <env-name>
```

Known environments: `csanderson`, `people`, `ltv-smart-engine`. Check `deployments/*.env` for others.

| Environment        | URL                                                   |
|--------------------|-------------------------------------------------------|
| `csanderson`       | https://smart-engine-727077869999.us-central1.run.app |
| `people`           | https://smart-engine-1000183467008.us-central1.run.app|
| `ltv-smart-engine` | https://smart-engine-659661214201.us-central1.run.app |

**Never run `terraform apply` for routine deploys.** Terraform is `--init` only.

## Fresh GCP project

```bash
./deploy.sh <env-name> --init
```

Steps:
1. Create `deployments/<env-name>.env` with `PROJECT_ID` and `BRAND_NAME`
2. (Optional) Place Google Ads credentials at `scripts/google-ads.yaml`
3. Authenticate ADC with storage scopes (required for Terraform GCS backend):
   ```bash
   gcloud auth application-default login \
     --scopes="https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/devstorage.read_write"
   gcloud auth application-default set-quota-project <PROJECT_ID>
   ```
4. Run `./deploy.sh <env-name> --init`

The `--init` script handles everything automatically:
- Terraform provisions all infrastructure (APIs, service accounts, IAM, BQ, Firestore, Artifact Registry, Secret Manager)
- Uploads `scripts/google-ads.yaml` as the initial secret version (or a placeholder if the file is absent)
- Builds and deploys to Cloud Run

> **Note:** Cloud Run is managed by `deploy.sh` (not Terraform). Terraform only provisions supporting infrastructure.

Post-deploy: register OAuth redirect URIs in GCP Console (printed at end of deploy.sh).

If deployed without credentials, update the secret later:
```bash
gcloud secrets versions add google-ads-yaml \
  --data-file=scripts/google-ads.yaml --project=<PROJECT_ID>
```

## ⚠️ Terraform state is isolated per project

Each project has its own GCS state bucket: `<PROJECT_ID>-smart-engine-tfstate`.
**Never run `terraform apply` against one project while initialized for another.**
Always re-init with `-reconfigure` when switching projects:
```bash
terraform init \
  -backend-config="bucket=<PROJECT_ID>-smart-engine-tfstate" \
  -backend-config="prefix=state" \
  -reconfigure
```

## If deploy.sh fails mid-way

Re-run `./deploy.sh <env-name>` — it's idempotent. To re-run only the Cloud Run deploy:
```bash
gcloud run deploy smart-engine \
  --image <IMAGE_TAG> \
  --region us-central1 \
  --project <PROJECT_ID> \
  --service-account smart-engine-app@<PROJECT_ID>.iam.gserviceaccount.com \
  --set-env-vars "GCP_PROJECT_ID=<PROJECT_ID>,CLOUD_RUN_URL=<CLOUD_RUN_URL>" \
  --set-secrets /secrets/google-ads.yaml=google-ads-yaml:latest \
  --allow-unauthenticated \
  --min-instances 1 --max-instances 1 --memory 4Gi --cpu 2 --port 8000 --quiet
```

## Checking status / logs

```bash
gcloud run services describe smart-engine --region us-central1 --project <PROJECT_ID> \
  --format="value(status.latestReadyRevisionName,status.url)"

gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=smart-engine" \
  --project <PROJECT_ID> --limit 50 --format="value(textPayload)"
```

## Gap analysis failures

```bash
curl -s "https://<SERVICE_URL>/api/gap-analyses/<id>" | jq '{status, error_message}'
curl -s -X POST "https://<SERVICE_URL>/api/gap-analyses/<id>/retry" | jq '.status'
```
