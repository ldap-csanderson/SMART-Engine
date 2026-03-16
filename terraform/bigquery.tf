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

  lifecycle {
    ignore_changes = [default_table_expiration_ms, default_partition_expiration_ms]
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

# Portfolio Items Table
resource "google_bigquery_table" "portfolio_items" {
  dataset_id          = google_bigquery_dataset.keyword_planner.dataset_id
  table_id            = "portfolio_items"
  deletion_protection = false

  description = "Current portfolio items (content topics). Fully replaced on each portfolio update."

  schema = jsonencode([
    {
      name        = "item_text"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Portfolio item text (e.g. content topic or page title)"
    },
    {
      name        = "added_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Timestamp when this version of the portfolio was saved"
    }
  ])
}

# Portfolio Embeddings Cache Table
resource "google_bigquery_table" "portfolio_embeddings" {
  dataset_id          = google_bigquery_dataset.keyword_planner.dataset_id
  table_id            = "portfolio_embeddings"
  deletion_protection = false

  description = "Cached intent strings and embeddings for portfolio items. Keyed on (item_text, prompt_hash) to survive prompt changes."

  schema = jsonencode([
    {
      name        = "item_text"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Portfolio item text"
    },
    {
      name        = "intent_string"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Normalized intent string generated by Gemini"
    },
    {
      name        = "embedding"
      type        = "FLOAT64"
      mode        = "REPEATED"
      description = "Text embedding vector (512 dimensions)"
    },
    {
      name        = "prompt_hash"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "SHA256 of the portfolio intent prompt used to generate this embedding"
    },
    {
      name        = "embedded_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Timestamp when this embedding was generated"
    }
  ])

  clustering = ["prompt_hash"]
}

# Portfolio Items V2 Table (Multi-portfolio support)
resource "google_bigquery_table" "portfolio_items_v2" {
  dataset_id          = google_bigquery_dataset.keyword_planner.dataset_id
  table_id            = "portfolio_items_v2"
  deletion_protection = false

  description = "Portfolio items table with portfolio_id support for multiple portfolios"

  schema = jsonencode([
    {
      name        = "portfolio_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Foreign key to portfolios collection in Firestore"
    },
    {
      name        = "item_text"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Portfolio item text (e.g. content topic or page title)"
    },
    {
      name        = "added_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Timestamp when this item was added"
    }
  ])

  clustering = ["portfolio_id"]
}

# Portfolio Embeddings V2 Cache Table (Multi-portfolio support)
resource "google_bigquery_table" "portfolio_embeddings_v2" {
  dataset_id          = google_bigquery_dataset.keyword_planner.dataset_id
  table_id            = "portfolio_embeddings_v2"
  deletion_protection = false

  description = "Cached intent strings and embeddings for portfolio items with portfolio_id support"

  schema = jsonencode([
    {
      name        = "portfolio_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Foreign key to portfolios collection in Firestore"
    },
    {
      name        = "item_text"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Portfolio item text"
    },
    {
      name        = "intent_string"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Normalized intent string generated by Gemini"
    },
    {
      name        = "embedding"
      type        = "FLOAT64"
      mode        = "REPEATED"
      description = "Text embedding vector (512 dimensions)"
    },
    {
      name        = "prompt_hash"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "SHA256 of the portfolio intent prompt used to generate this embedding"
    },
    {
      name        = "embedded_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Timestamp when this embedding was generated"
    }
  ])

  clustering = ["portfolio_id", "prompt_hash"]
}

# Gap Analysis Results Table
resource "google_bigquery_table" "gap_analysis_results" {
  dataset_id          = google_bigquery_dataset.keyword_planner.dataset_id
  table_id            = "gap_analysis_results"
  deletion_protection = false

  description = "Semantic gap analysis results: keywords ranked by distance from closest portfolio item"

  schema = jsonencode([
    {
      name        = "analysis_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Unique identifier for the gap analysis run (UUID)"
    },
    {
      name        = "created_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Timestamp when the analysis was run"
    },
    {
      name        = "keyword_text"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "The keyword"
    },
    {
      name        = "keyword_intent"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Normalized intent string for the keyword"
    },
    {
      name        = "closest_portfolio_item"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "The portfolio item semantically closest to this keyword"
    },
    {
      name        = "closest_portfolio_intent"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "Intent string of the closest portfolio item"
    },
    {
      name        = "semantic_distance"
      type        = "FLOAT64"
      mode        = "NULLABLE"
      description = "Cosine distance between keyword and closest portfolio item (lower = more similar)"
    },
    {
      name        = "avg_monthly_searches"
      type        = "INTEGER"
      mode        = "NULLABLE"
      description = "Average monthly search volume for this keyword"
    }
  ])

  time_partitioning {
    type  = "DAY"
    field = "created_at"
  }

  clustering = ["analysis_id"]
}

# Filter Results Table
resource "google_bigquery_table" "filter_results" {
  dataset_id          = google_bigquery_dataset.keyword_planner.dataset_id
  table_id            = "filter_results"
  deletion_protection = false

  description = "LLM-evaluated boolean filter results per keyword per filter execution"

  schema = jsonencode([
    {
      name        = "execution_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Unique identifier for the filter execution (UUID)"
    },
    {
      name        = "analysis_id"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Foreign key to gap_analysis_results"
    },
    {
      name        = "keyword_text"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "The keyword being evaluated"
    },
    {
      name        = "label"
      type        = "STRING"
      mode        = "REQUIRED"
      description = "Filter label (e.g. non_branded, purchase_intent) — snapshotted at execution time"
    },
    {
      name        = "result"
      type        = "BOOL"
      mode        = "NULLABLE"
      description = "LLM evaluation result (true = passes filter)"
    },
    {
      name        = "confidence"
      type        = "STRING"
      mode        = "NULLABLE"
      description = "LLM confidence: high, medium, or low"
    },
    {
      name        = "created_at"
      type        = "TIMESTAMP"
      mode        = "REQUIRED"
      description = "Timestamp when this filter result was generated"
    }
  ])

  time_partitioning {
    type  = "DAY"
    field = "created_at"
  }

  clustering = ["analysis_id", "label"]
}
