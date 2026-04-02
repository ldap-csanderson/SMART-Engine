#!/bin/bash
set -e

# Configuration — edit these for each deployment target
PROJECT_ID="quinstreet-ai-max-activator"
REGION="us-central1"
REPO="app"
IMAGE_NAME="gap-analysis"
SERVICE_NAME="gap-analysis"

IMAGE_TAG="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:latest"

echo "🚀 Gap Analysis Deployment Script"
echo "===================================="
echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo "Image:   $IMAGE_TAG"
echo ""

# Check gcloud auth
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
    echo "❌ Not authenticated with gcloud. Please run: gcloud auth login"
    exit 1
fi

gcloud config set project "$PROJECT_ID"

echo "📦 Building and pushing Docker image..."
gcloud builds submit . \
  --project="$PROJECT_ID" \
  --tag "$IMAGE_TAG" \
  --timeout=15m

echo ""
echo "🔄 Updating Cloud Run service with new image..."
gcloud run services update "$SERVICE_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --image="$IMAGE_TAG"

echo ""
echo "✅ Deployment complete!"
echo ""
URL=$(gcloud run services describe "$SERVICE_NAME" \
  --project="$PROJECT_ID" \
  --region="$REGION" \
  --format="value(status.url)" 2>/dev/null || echo "(could not retrieve URL)")
echo "📋 Application URL: $URL"
echo ""
echo "💡 To redeploy, simply run: ./deploy.sh"
echo "⚠️  NOTE: This script does NOT run Terraform."
echo "   Run Terraform manually only when changing infrastructure."
