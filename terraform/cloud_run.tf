# Enable Cloud Run API
resource "google_project_service" "cloudrun" {
  project = var.project_id
  service = "run.googleapis.com"
  
  disable_on_destroy = false
}

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

# Cloud Run service (serves both API and frontend)
resource "google_cloud_run_v2_service" "app" {
  name     = "smart-engine"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  
  template {
    service_account = google_service_account.app.email
    
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    
    containers {
      image = var.app_image
      
      ports {
        container_port = 8000
      }
      
      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }
      
      # Mount google-ads.yaml from Secret Manager
      volume_mounts {
        name       = "google-ads-config"
        mount_path = "/secrets"
      }
      
      resources {
        limits = {
          cpu    = "2"
          memory = "4Gi"
        }
      }
    }
    
    volumes {
      name = "google-ads-config"
      secret {
        secret = google_secret_manager_secret.google_ads_yaml.secret_id
        items {
          version = "latest"
          path    = "google-ads.yaml"
        }
      }
    }
  }
  
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
  
  depends_on = [
    google_project_service.cloudrun,
    google_secret_manager_secret.google_ads_yaml,
  ]
}

# IAM: Allow unauthenticated access
# For production, consider restricting to specific users or Identity-Aware Proxy
resource "google_cloud_run_v2_service_iam_member" "app_public" {
  name     = google_cloud_run_v2_service.app.name
  location = google_cloud_run_v2_service.app.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
