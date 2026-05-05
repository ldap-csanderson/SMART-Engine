output "app_service_account" {
  description = "Email of the application service account"
  value       = google_service_account.app.email
}

output "dataset_id" {
  description = "BigQuery dataset ID"
  value       = google_bigquery_dataset.keyword_planner.dataset_id
}

output "dataset_location" {
  description = "BigQuery dataset location"
  value       = google_bigquery_dataset.keyword_planner.location
}

output "artifact_registry_repository" {
  description = "Artifact Registry repository URL"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.app.repository_id}"
}
