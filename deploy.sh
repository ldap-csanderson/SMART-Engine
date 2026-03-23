#!/bin/bash
set -e

# Configuration
PROJECT_ID="gap-analysis-nlf"
REGION="us-central1"
REPO="app"
IMAGE_NAME="gap-analysis"

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

echo "🏗️  Deploying infrastructure with Terraform..."
cd terraform
terraform apply -auto-approve -var="app_image=us-central1-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:latest"
cd ..

echo ""
echo "📦 Building and pushing Docker image (frontend + backend)..."
gcloud builds submit . \
  --tag ${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO}/${IMAGE_NAME}:latest \
  --timeout=15m

echo ""
echo "🔄 Updating Cloud Run with new image..."
cd terraform
terraform apply -auto-approve
cd ..

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Application URL:"
cd terraform
echo "   $(terraform output -raw app_url)"
cd ..
echo ""
echo "💡 To update the application, simply run: ./deploy.sh"
