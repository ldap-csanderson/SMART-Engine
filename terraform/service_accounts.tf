# Service Account for Keyword Planner API
resource "google_service_account" "keyword_planner" {
  account_id   = var.service_account_name
  display_name = "Keyword Planner Service Account"
  description  = "Service account for keyword planner API to access BigQuery"
}

# Grant BigQuery Data Editor role
resource "google_project_iam_member" "bigquery_data_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.keyword_planner.email}"
}

# Grant BigQuery Job User role (needed to run queries)
resource "google_project_iam_member" "bigquery_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.keyword_planner.email}"
}

# Create service account key
resource "google_service_account_key" "keyword_planner_key" {
  service_account_id = google_service_account.keyword_planner.name
}

# Save the service account key to a local file
resource "local_file" "service_account_key" {
  content  = base64decode(google_service_account_key.keyword_planner_key.private_key)
  filename = "${path.module}/../backend/service-account-key.json"
  
  file_permission = "0600"
}
