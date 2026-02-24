# Terraform Infrastructure

This directory contains Terraform configuration for provisioning the GCP infrastructure needed for the Keyword Planner API.

## What Gets Created

- **BigQuery Dataset**: `keyword_planner_data`
- **BigQuery Tables**:
  - `keyword_runs` - Metadata tracking each keyword research run
  - `keyword_results` - Detailed keyword data
- **Service Account**: `keyword-planner-sa` with BigQuery permissions
- **Service Account Key**: Automatically saved to `../backend/service-account-key.json`

## Prerequisites

1. Google Cloud SDK installed (`gcloud`)
2. Terraform installed (>= 1.0)
3. Authenticated with GCP: `gcloud auth application-default login`
4. Project created: `csanderson-experimental-443821`

## Deployment

```bash
# Initialize Terraform
cd terraform
terraform init

# Review what will be created
terraform plan

# Create all resources
terraform apply

# View outputs
terraform output
```

## Outputs

- `service_account_email` - Email of the created service account
- `dataset_id` - BigQuery dataset name
- `keyword_runs_table` - Runs table name  
- `keyword_results_table` - Results table name

## Cleanup

To destroy all created resources:

```bash
terraform destroy
```

⚠️ **Note**: This will delete all data in the BigQuery tables!

## Security

- Service account key is automatically saved to `backend/service-account-key.json`
- This file is gitignored and should NEVER be committed
- Key has minimal permissions (BigQuery Data Editor + Job User only)
