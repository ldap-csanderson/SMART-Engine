# Deployment

Read **DEPLOY.md** before any deployment task — it is the authoritative guide.
Instructions here cover *how* to operate as an agent, not what the system does.

## Updating an existing environment

```bash
./deploy.sh <env-name>
```

Known environments: `csanderson`, `people`. Check `deployments/*.env` for others.

**Never run `terraform apply` for routine deploys.** Terraform is `--init` only.

## Fresh GCP project

```bash
./deploy.sh <env-name> --init
```

First:
1. Create `deployments/<env-name>.env` with `PROJECT_ID` and `BRAND_NAME`
2. Complete manual GCP setup in DEPLOY.md (enable APIs, create secret, Artifact Registry repo)

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
