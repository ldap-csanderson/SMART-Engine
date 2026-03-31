# Cloud Run Job: gap-analysis-worker
# Runs long-running background tasks (keyword reports, gap analyses, filter executions)
# in isolated containers so they survive web-server redeployments.

resource "google_cloud_run_v2_job" "worker" {
  name     = "gap-analysis-worker"
  location = var.region

  template {
    template {
      service_account = google_service_account.app.email

      # Jobs can run up to 24h; set a generous timeout for large keyword reports
      timeout = "3600s"  # 1 hour

      containers {
        image   = var.app_image
        command = ["python", "worker.py"]

        env {
          name  = "GCP_PROJECT_ID"
          value = var.project_id
        }

        # JOB_TYPE and JOB_PARAMS are injected per-execution via RunJobRequest overrides

        # Mount google-ads.yaml from Secret Manager (needed for keyword reports)
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
  }

  depends_on = [
    google_project_service.cloudrun,
    google_secret_manager_secret.google_ads_yaml,
  ]
}

# Allow the app service account to trigger job executions
resource "google_cloud_run_v2_job_iam_member" "app_can_run_worker" {
  name     = google_cloud_run_v2_job.worker.name
  location = google_cloud_run_v2_job.worker.location
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.app.email}"
}
