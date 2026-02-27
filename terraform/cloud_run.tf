# Enable Cloud Run API
resource "google_project_service" "cloudrun" {
  project = var.project_id
  service = "run.googleapis.com"
  
  disable_on_destroy = false
}

# Service account for backend
resource "google_service_account" "backend" {
  account_id   = "gap-analysis-backend"
  display_name = "Gap Analysis Backend Service Account"
  description  = "Service account for the Gap Analysis backend Cloud Run service"
}

# Grant backend service account access to BigQuery
resource "google_project_iam_member" "backend_bigquery_user" {
  project = var.project_id
  role    = "roles/bigquery.user"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_bigquery_data_editor" {
  project = var.project_id
  role    = "roles/bigquery.dataEditor"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

resource "google_project_iam_member" "backend_bigquery_job_user" {
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# Grant backend service account access to Firestore
resource "google_project_iam_member" "backend_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# Grant backend service account access to Vertex AI
resource "google_project_iam_member" "backend_vertex_ai" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# Grant backend service account permission to use BigQuery connections (for Vertex AI)
resource "google_project_iam_member" "backend_bq_connection_user" {
  project = var.project_id
  role    = "roles/bigquery.connectionUser"
  member  = "serviceAccount:${google_service_account.backend.email}"
}

# Backend Cloud Run service
resource "google_cloud_run_v2_service" "backend" {
  name     = "gap-analysis-backend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  
  template {
    service_account = google_service_account.backend.email
    
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    
    containers {
      image = var.backend_image
      
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
          memory = "2Gi"
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

# Frontend Cloud Run service
resource "google_cloud_run_v2_service" "frontend" {
  name     = "gap-analysis-frontend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  
  template {
    scaling {
      min_instance_count = 1
      max_instance_count = 1
    }
    
    containers {
      image = var.frontend_image
      
      ports {
        container_port = 80
      }
      
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
  
  traffic {
    type    = "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST"
    percent = 100
  }
  
  depends_on = [google_project_service.cloudrun]
}

# IAM: Allow unauthenticated access to backend
# For production, consider restricting to specific users or Identity-Aware Proxy
resource "google_cloud_run_v2_service_iam_member" "backend_public" {
  name     = google_cloud_run_v2_service.backend.name
  location = google_cloud_run_v2_service.backend.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# IAM: Allow unauthenticated access to frontend
resource "google_cloud_run_v2_service_iam_member" "frontend_public" {
  name     = google_cloud_run_v2_service.frontend.name
  location = google_cloud_run_v2_service.frontend.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}
