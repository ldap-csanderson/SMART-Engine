# Service account for the application
resource "google_service_account" "app" {
  account_id   = "smart-engine-app"
  display_name = "SMART Engine Application Service Account"
  description  = "Service account for the SMART Engine Cloud Run service"
}

# Grant service account access to BigQuery
resource "google_project_iam_member" "app_bigquery_user" {
  project = var.project_id
  role    = "roles/bigquery.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "app_bigquery_data_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.app.email}"
}

resource "google_project_iam_member" "app_bigquery_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# Grant service account access to Firestore
resource "google_project_iam_member" "app_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# Grant service account access to Vertex AI
resource "google_project_iam_member" "app_vertex_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.app.email}"
}

# Grant service account permission to use BigQuery connections (for Vertex AI)
resource "google_project_iam_member" "app_bq_connection_user" {
  project = var.project_id
  role    = "roles/bigquery.connectionUser"
  member  = "serviceAccount:${google_service_account.app.email}"
}
