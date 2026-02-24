# BigQuery Dataset
resource "google_bigquery_dataset" "keyword_planner" {
  dataset_id                 = var.dataset_id
  location                   = var.region
  description                = "Dataset for keyword planner research data"
  delete_contents_on_destroy = false

  labels = {
    env        = "production"
    managed_by = "terraform"
  }
}

# Keyword Runs Table (Metadata)
resource "google_bigquery_table" "keyword_runs" {
  dataset_id          = google_bigquery_dataset.keyword_planner.dataset_id
  table_id            = "keyword_runs"
  deletion_protection = false
  
  description = "Metadata table tracking each keyword research run"

  schema = jsonencode([
    {
      name        = "run_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Unique identifier for the run (UUID)"
    },
    {
      name        = "created_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Timestamp when the run was created"
    },
    {
      name        = "status"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Status of the run: completed, failed, archived"
    },
    {
      name        = "urls"
      type        = "STRING"
      mode        = "REPEATED"
      description = "Array of URLs that were analyzed"
    },
    {
      name        = "total_keywords_found"
      type        = "INTEGER"
      mode        = "REQUIRED"
      description = "Total number of keywords found across all URLs"
    },
    {
      name        = "error_message"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Error message if the run failed"
    }
  ])

  time_partitioning {
    type  = "DAY"
    field = "created_at"
  }
}

# Keyword Results Table (Detailed Data)
resource "google_bigquery_table" "keyword_results" {
  dataset_id          = google_bigquery_dataset.keyword_planner.dataset_id
  table_id            = "keyword_results"
  deletion_protection = false
  
  description = "Detailed keyword research results"

  schema = jsonencode([
    {
      name        = "run_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Foreign key to keyword_runs table"
    },
    {
      name        = "created_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Timestamp when the keyword was fetched"
    },
    {
      name        = "source_url"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "The URL that generated this keyword"
    },
    {
      name        = "keyword_text"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "The actual keyword text"
    },
    {
      name        = "avg_monthly_searches"
      type        = "INTEGER"
      mode        = "NULLABLE"
      description = "Average monthly search volume"
    },
    {
      name        = "competition"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Competition level: LOW, MEDIUM, HIGH"
    },
    {
      name        = "competition_index"
      type        = "INTEGER"
      mode        = "NULLABLE"
      description = "Competition index (0-100)"
    },
    {
      name        = "low_top_of_page_bid_usd"
      type        = "FLOAT"
      mode        = "NULLABLE"
      description = "Low top-of-page bid in USD"
    },
    {
      name        = "high_top_of_page_bid_usd"
      type        = "FLOAT"
      mode        = "NULLABLE"
      description = "High top-of-page bid in USD"
    }
  ])

  time_partitioning {
    type  = "DAY"
    field = "created_at"
  }

  clustering = ["run_id", "source_url"]
}
