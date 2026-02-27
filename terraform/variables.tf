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

variable "backend_image" {
  description = "Backend Docker image URL"
  type        = string
  default     = "us-central1-docker.pkg.dev/gap-analysis-nlf/app/backend:latest"
}

variable "frontend_image" {
  description = "Frontend Docker image URL"
  type        = string
  default     = "us-central1-docker.pkg.dev/gap-analysis-nlf/app/frontend:latest"
}
