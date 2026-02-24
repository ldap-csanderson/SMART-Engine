output "service_account_email" {
  description = "Email address of the service account"
  value       = google_service_account.keyword_planner.email
}

output "dataset_id" {
  description = "BigQuery dataset ID"
  value       = google_bigquery_dataset.keyword_planner.dataset_id
}

output "dataset_location" {
  description = "BigQuery dataset location"
  value       = google_bigquery_dataset.keyword_planner.location
}

output "keyword_runs_table" {
  description = "Keyword runs table name"
  value       = google_bigquery_table.keyword_runs.table_id
}

output "keyword_results_table" {
  description = "Keyword results table name"
  value       = google_bigquery_table.keyword_results.table_id
}

output "service_account_key_path" {
  description = "Path to the service account key file"
  value       = local_file.service_account_key.filename
  sensitive   = true
}
