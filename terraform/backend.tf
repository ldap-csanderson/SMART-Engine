terraform {
  backend "gcs" {
    bucket = "gap-analysis-nlf-tfstate"
    prefix = "terraform/state"
  }
}
