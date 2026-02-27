# Artifact Registry for storing Docker images
resource "google_artifact_registry_repository" "app" {
  location      = var.region
  repository_id = "app"
  description   = "Docker repository for Gap Analysis application images"
  format        = "DOCKER"
  
  depends_on = [google_project_service.artifact_registry]
}

# Enable Artifact Registry API
resource "google_project_service" "artifact_registry" {
  project = var.project_id
  service = "artifactregistry.googleapis.com"
  
  disable_on_destroy = false
}
