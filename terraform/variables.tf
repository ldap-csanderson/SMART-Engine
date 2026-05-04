variable "project_id" {
  description = "GCP Project ID — must be supplied via -var flag (no default)"
  type        = string
}

variable "region" {
  description = "GCP region"
  type        = string
  default     = "us-central1"
}

variable "dataset_id" {
  description = "BigQuery dataset ID"
  type        = string
  default     = "smart_engine_data"
}

variable "service_account_name" {
  description = "Service account name"
  type        = string
  default     = "smart-engine-sa"
}

variable "app_image" {
  description = "Application Docker image URL (includes both frontend and backend)"
  type        = string
}
