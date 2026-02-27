#!/bin/bash
set -e

# Configuration
PROJECT_ID="gap-analysis-nlf"
REGION="us-central1"
REPO="app"

echo "🚀 Gap Analysis Deployment Script"
echo "===================================="
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo ""

# Check if gcloud is authenticated
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
    echo "❌ Not authenticated with gcloud. Please run: gcloud auth login"
    exit 1
fi

# Set the project
gcloud config set project $PROJECT_ID

echo "📦 Building and pushing backend Docker image..."
gcloud builds submit backend/ \
  --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/backend:latest \
  --timeout=15m

echo ""
echo "📦 Building and pushing frontend Docker image..."

# Get backend URL for frontend build arg
BACKEND_URL=$(gcloud run services describe gap-analysis-backend \
  --region=${REGION} \
  --format='value(status.url)' 2>/dev/null || echo "")

if [ -z "$BACKEND_URL" ]; then
    echo "⚠️  Backend service not yet deployed. Frontend will use placeholder URL."
    echo "    You may need to run this script again after initial deployment."
    BACKEND_URL="https://gap-analysis-backend-placeholder.run.app"
fi

gcloud builds submit frontend/ \
  --config=frontend/cloudbuild.yaml \
  --substitutions=_VITE_API_URL=${BACKEND_URL},_IMAGE_NAME=${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/frontend:latest \
  --timeout=15m

echo ""
echo "🏗️  Deploying infrastructure with Terraform..."
cd terraform
terraform apply -auto-approve

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Service URLs:"
echo "   Frontend: $(terraform output -raw frontend_url)"
echo "   Backend:  $(terraform output -raw backend_url)"
echo ""
echo "💡 To update the application, simply run: ./deploy.sh"
