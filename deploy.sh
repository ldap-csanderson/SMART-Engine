#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# SMART Engine — Deployment Script
#
# Usage:
#   ./deploy.sh <env-name>          Build + deploy to an existing deployment
#   ./deploy.sh <env-name> --init   Provision infrastructure (first time only),
#                                   then build + deploy
#
# env-name: name of a file in deployments/<env-name>.env
#
# Examples:
#   ./deploy.sh csanderson           # deploy to csanderson-experimental-443821
#   ./deploy.sh people               # deploy to people-gandalf
#   ./deploy.sh myenv --init         # fresh provision + deploy for myenv
#
# See DEPLOY.md for full documentation.
# ---------------------------------------------------------------------------

ENV_NAME="${1:-}"
INIT_MODE="${2:-}"

if [[ -z "$ENV_NAME" ]]; then
  echo "❌ Usage: ./deploy.sh <env-name> [--init]"
  echo ""
  echo "   Available environments:"
  for f in deployments/*.env; do
    echo "     - $(basename "$f" .env)"
  done
  echo ""
  echo "   See DEPLOY.md for instructions on adding a new environment."
  exit 1
fi

ENV_FILE="deployments/${ENV_NAME}.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "❌ Environment file not found: $ENV_FILE"
  echo "   Create it with: PROJECT_ID and BRAND_NAME variables."
  echo "   See DEPLOY.md for details."
  exit 1
fi

# Load environment config
# shellcheck source=/dev/null
source "$ENV_FILE"

# Defaults (can be overridden in .env file)
REGION="${REGION:-us-central1}"
REPO="${REPO:-app}"
IMAGE_NAME="${IMAGE_NAME:-smart-engine}"
BRAND_NAME="${BRAND_NAME:-SMART Engine}"

echo "🚀 SMART Engine Deployment"
echo "=========================="
echo "Environment: $ENV_NAME"
echo "Project:     $PROJECT_ID"
echo "Brand:       $BRAND_NAME"
echo "Region:      $REGION"
echo ""

# Check gcloud auth
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
  echo "❌ Not authenticated with gcloud. Run: gcloud auth login"
  exit 1
fi

gcloud config set project "$PROJECT_ID"

# Derive the Cloud Run URL (deterministic from project number)
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
CLOUD_RUN_URL="https://${IMAGE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app"
IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:latest"

echo "🌐 Cloud Run URL: $CLOUD_RUN_URL"
echo "🐳 Image:         $IMAGE_TAG"
echo ""

# ---------------------------------------------------------------------------
# --init: Provision infrastructure with Terraform (fresh deployments only)
# ---------------------------------------------------------------------------
if [[ "$INIT_MODE" == "--init" ]]; then
  echo "🏗️  Provisioning infrastructure with Terraform..."
  echo ""

  # Create GCS bucket for Terraform state (idempotent)
  TF_STATE_BUCKET="${PROJECT_ID}-smart-engine-tfstate"
  if ! gcloud storage buckets describe "gs://${TF_STATE_BUCKET}" &>/dev/null; then
    echo "  Creating Terraform state bucket: gs://${TF_STATE_BUCKET}"
    gcloud storage buckets create "gs://${TF_STATE_BUCKET}" \
      --project="$PROJECT_ID" \
      --location="$REGION"
    gcloud storage buckets update "gs://${TF_STATE_BUCKET}" --versioning
  else
    echo "  ✅ Terraform state bucket: gs://${TF_STATE_BUCKET}"
  fi

  cd terraform
  terraform init \
    -backend-config="bucket=${TF_STATE_BUCKET}" \
    -backend-config="prefix=state" \
    -reconfigure

  terraform apply -auto-approve \
    -var="project_id=${PROJECT_ID}" \
    -var="region=${REGION}"
  cd ..
  echo ""

  # Push google-ads.yaml secret version
  echo "🔑 Uploading Google Ads credentials to Secret Manager..."
  GOOGLE_ADS_FILE="scripts/google-ads.yaml"
  if [[ -f "$GOOGLE_ADS_FILE" ]]; then
    gcloud secrets versions add google-ads-yaml \
      --data-file="$GOOGLE_ADS_FILE" \
      --project="$PROJECT_ID"
    echo "  ✅ Uploaded $GOOGLE_ADS_FILE"
  else
    echo "  ⚠️  No $GOOGLE_ADS_FILE found — uploading placeholder."
    echo "  Update the secret later via: gcloud secrets versions add google-ads-yaml --data-file=<your-file> --project=$PROJECT_ID"
    printf "# Placeholder — replace with real Google Ads credentials\n" | \
      gcloud secrets versions add google-ads-yaml \
        --data-file=- \
        --project="$PROJECT_ID"
  fi
  echo ""
fi

# ---------------------------------------------------------------------------
# Build Docker image (with brand name injected at build time)
# ---------------------------------------------------------------------------
echo "📦 Building Docker image..."
gcloud builds submit . \
  --config=cloudbuild.yaml \
  --substitutions="_BRAND_NAME=${BRAND_NAME},_IMAGE_TAG=${IMAGE_TAG}" \
  --timeout=15m
echo ""

# ---------------------------------------------------------------------------
# Deploy to Cloud Run
# ---------------------------------------------------------------------------
echo "🔄 Deploying to Cloud Run..."
gcloud run deploy "${IMAGE_NAME}" \
  --image "${IMAGE_TAG}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --service-account "${IMAGE_NAME}-app@${PROJECT_ID}.iam.gserviceaccount.com" \
  --set-env-vars "GCP_PROJECT_ID=${PROJECT_ID},CLOUD_RUN_URL=${CLOUD_RUN_URL}" \
  --set-secrets /secrets/google-ads.yaml=google-ads-yaml:latest \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --memory 4Gi \
  --cpu 2 \
  --port 8000 \
  --quiet

echo ""
echo "✅ Deployment complete!"
echo "📋 URL: ${CLOUD_RUN_URL}"
