# Firestore database for run metadata
resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"

  depends_on = [google_project_service.firestore]
}

# Enable Firestore API
resource "google_project_service" "firestore" {
  project = var.project_id
  service = "firestore.googleapis.com"
  disable_on_destroy = false
}

# Grant Firestore access to service account
resource "google_project_iam_member" "firestore_user" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.keyword_planner.email}"
}

# Composite index: filter_executions — filter by analysis_id, ordered by created_at DESC
resource "google_firestore_index" "filter_executions_by_analysis" {
  project    = var.project_id
  database   = "(default)"
  collection = "filter_executions"

  fields {
    field_path = "analysis_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "created_at"
    order      = "DESCENDING"
  }

  depends_on = [google_firestore_database.database]
}
