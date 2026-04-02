terraform {
  backend "gcs" {
    bucket = "quinstreet-ai-max-activator-tfstate"
    prefix = "terraform/state"
  }
}
