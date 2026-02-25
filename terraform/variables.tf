variable "project_id" {
  description = "GCP Project ID"
  type        = string
  default     = "gap-analysis-nlf"
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "dataset_id" {
  description = "BigQuery dataset ID"
  type        = string
  default     = "keyword_planner_data"
}

variable "service_account_name" {
  description = "Service account name for keyword planner"
  type        = string
  default     = "keyword-planner-sa"
}
