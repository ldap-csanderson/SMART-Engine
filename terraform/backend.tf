terraform {
  backend "gcs" {
    bucket = "people-gandalf-tfstate"
    prefix = "terraform/state"
  }
}
