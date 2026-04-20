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

# Grant app service account read access to the secret
resource "google_secret_manager_secret_iam_member" "app_accessor" {
  secret_id = google_secret_manager_secret.google_ads_yaml.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.app.email}"
}

# Grant app service account permission to add new secret versions
# Required for in-app OAuth re-authorization (token rotation)
resource "google_secret_manager_secret_iam_member" "app_version_adder" {
  secret_id = google_secret_manager_secret.google_ads_yaml.id
  role      = "roles/secretmanager.secretVersionAdder"
  member    = "serviceAccount:${google_service_account.app.email}"
}
