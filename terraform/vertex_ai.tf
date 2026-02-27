# BigQuery remote connection for Vertex AI (used by BQ ML models)
resource "google_bigquery_connection" "vertex_ai" {
  connection_id = "vertex-ai-connection"
  project       = var.project_id
  location      = var.region

  cloud_resource {}

  depends_on = [google_project_service.bigqueryconnection]
}

# Grant the connection's managed service account access to Vertex AI
resource "google_project_iam_member" "connection_vertex_ai_user" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_bigquery_connection.vertex_ai.cloud_resource[0].service_account_id}"

  depends_on = [google_bigquery_connection.vertex_ai]
}

# Note: app_bq_connection_user is now defined in cloud_run.tf
