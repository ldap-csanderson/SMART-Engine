# Enable Secret Manager API
resource "google_project_service" "secretmanager" {
  project = var.project_id
  service = "secretmanager.googleapis.com"
  
  disable_on_destroy = false
}

# Secret for google-ads.yaml
resource "google_secret_manager_secret" "google_ads_yaml" {
  secret_id = "google-ads-yaml"
  
  replication {
    auto {}
  }
  
  depends_on = [google_project_service.secretmanager]
}

# Grant backend service account access to the secret
resource "google_secret_manager_secret_iam_member" "backend_accessor" {
  secret_id = google_secret_manager_secret.google_ads_yaml.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.backend.email}"
}
