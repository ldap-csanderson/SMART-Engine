# Multiple Portfolios Deployment Guide

**Branch:** `feature/multiple-portfolios`  
**Date:** March 16, 2026

## Overview

This deployment introduces support for multiple portfolios with immutable snapshots in gap analyses. The migration requires careful orchestration of database changes and data migration.

---

## Pre-Deployment Checklist

- [ ] All code committed to `feature/multiple-portfolios` branch
- [ ] Code review completed (if applicable)
- [ ] Terraform changes reviewed
- [ ] Migration script tested with `--dry-run`
- [ ] Firestore backup taken

---

## Deployment Steps

### Step 1: Merge to Main Branch

```bash
git checkout main
git merge feature/multiple-portfolios
git push origin main
```

### Step 2: Deploy Terraform (Create V2 Tables)

This creates the new BigQuery tables with `portfolio_id` support:

```bash
cd terraform
terraform plan  # Review changes
terraform apply  # Apply when ready
```

**Expected Changes:**
- New table: `portfolio_items_v2`
- New table: `portfolio_embeddings_v2`
- Old tables remain untouched

### Step 3: Deploy Application Code

Deploy the new application code:

```bash
cd /Users/csanderson/code/people/gap_analysis_v2
./deploy.sh
```

**This will:**
- Build new Docker image with multiple portfolio support
- Deploy to Cloud Run
- Old portfolio data will still be queryable via old endpoint temporarily

### Step 4: Run Migration Script

**IMPORTANT:** Test with dry-run first!

```bash
# DRY RUN - Preview changes
cd /Users/csanderson/code/people/gap_analysis_v2
python3 scripts/migrate_to_multiple_portfolios.py --dry-run

# LIVE RUN - Apply changes (after reviewing dry-run output)
python3 scripts/migrate_to_multiple_portfolios.py
```

**What the migration does:**
1. Reads existing `portfolio/default` from Firestore
2. Creates new portfolio named "Default Portfolio" in `portfolios` collection
3. Syncs items to BigQuery `portfolio_items_v2` table
4. Backfills all existing gap_analyses with:
   - `portfolio_id` field
   - `portfolio_snapshot` object (immutable copy)
5. Deletes old `portfolio/default` document

### Step 5: Verify Migration

**Check Firestore:**
```bash
# Verify new portfolio exists
gcloud firestore documents list portfolios --project=gap-analysis-nlf

# Verify old portfolio is gone
gcloud firestore documents list portfolio --project=gap-analysis-nlf
```

**Check BigQuery:**
```sql
-- Verify items in v2 table
SELECT COUNT(*) FROM `gap-analysis-nlf.keyword_planner_data.portfolio_items_v2`;

-- Check gap_analyses have portfolio_snapshot
SELECT analysis_id, name, portfolio_id 
FROM `gap-analysis-nlf.keyword_planner_data.gap_analysis_results`
LIMIT 5;
```

**Check Application:**
1. Visit: https://gap-analysis-nbauychn5a-uc.a.run.app/portfolios
2. Verify "Default Portfolio" is visible
3. Try creating a new portfolio
4. Try creating a gap analysis with portfolio selection

---

## Rollback Plan

If something goes wrong:

### Rollback Application Code

```bash
git checkout main
git revert HEAD  # or checkout previous commit
./deploy.sh
```

### Restore Firestore Data

```bash
# If you took a backup before migration
gcloud firestore import gs://YOUR_BACKUP_BUCKET/BACKUP_PATH --project=gap-analysis-nlf
```

### Keep Both Table Versions

The old `portfolio_items` and `portfolio_embeddings` tables are kept for safety. Don't delete them until you've verified the new system works perfectly for at least a week.

---

## Post-Deployment Tasks

- [ ] Verify all existing gap analyses display correctly
- [ ] Create a test portfolio
- [ ] Run a test gap analysis with new portfolio
- [ ] Monitor Cloud Run logs for errors
- [ ] After 1-2 weeks of stable operation, consider deleting old v1 tables

---

## What Changed

### Backend
- **New API:** `/api/portfolios` (CRUD for multiple portfolios)
- **Updated API:** `/api/gap-analyses` now requires `portfolio_id`
- **New Tables:** `portfolio_items_v2`, `portfolio_embeddings_v2`
- **Snapshot Storage:** Gap analyses now store immutable portfolio snapshots

### Frontend
- **New Pages:** `/portfolios` (list), `/portfolios/:id` (detail)
- **Updated:** Gap analysis creation modal now requires portfolio selection
- **Updated:** Gap analysis detail page shows portfolio snapshot info

### Database Schema
- **Firestore:** New `portfolios` collection (plural), old `portfolio` deleted
- **BigQuery:** New v2 tables with `portfolio_id` column for multi-portfolio isolation
- **Gap Analyses:** Now include `portfolio_id` and `portfolio_snapshot` fields

---

## Known Issues / Limitations

1. **Embedding Cache Reset:** The migration creates new v2 tables from scratch, so all cached embeddings are lost. First gap analysis on each portfolio will be slower as it regenerates embeddings.

2. **No Migration of Old Embeddings:** For simplicity, we chose not to migrate the old embedding cache. Future improvement could copy relevant embeddings to v2 tables.

3. **Portfolio Deletion:** Currently doesn't check if gap analyses reference a portfolio before deletion. Consider adding a safety check if needed.

---

## Testing Performed

- [ ] Dry-run migration successful
- [ ] Local development server runs without errors
- [ ] Can create new portfolio via UI
- [ ] Can edit portfolio via UI
- [ ] Can delete portfolio via UI
- [ ] Can create gap analysis with portfolio selection
- [ ] Portfolio snapshot displays correctly in gap analysis detail
- [ ] Migration script completes successfully in production
- [ ] All existing gap analyses still accessible

---

## Support

If issues arise, check:
- Cloud Run logs: `gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=gap-analysis" --limit=50 --project=gap-analysis-nlf`
- Application health: `curl https://gap-analysis-nbauychn5a-uc.a.run.app/api/health`
- BigQuery table data via Cloud Console

For questions or issues, refer to `IMPLEMENTATION_PLAN.md` for architecture details.
