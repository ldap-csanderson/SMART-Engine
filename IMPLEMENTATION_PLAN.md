# Multiple Portfolios Implementation Plan

**Branch:** `feature/multiple-portfolios`  
**Date:** March 16, 2026

## Summary

Convert the application from a single global portfolio to support multiple named portfolios. Gap analyses will require selecting a portfolio and will store an immutable snapshot of that portfolio (similar to how filters work).

## Requirements Gathered

1. **Portfolio Snapshot**: Include items array + metadata (name, created_at, updated_at)
2. **Migration Strategy**: Convert existing `portfolio/default` → new portfolio named "Default Portfolio"
3. **BigQuery Strategy**: Create new tables with `portfolio_id` from scratch (lose cached embeddings)
4. **UI Pattern**: List view at `/portfolios`, detail/edit at `/portfolios/:id` (consistent with filters/analyses)
5. **No collision detection** for portfolios in gap analyses (unlike filters)

---

## Schema Changes

### 1. Firestore Schema

#### New: `portfolios` Collection
```javascript
{
  portfolio_id: string,      // UUID
  name: string,              // User-provided name
  items: string[],           // Array of portfolio items
  created_at: timestamp,     // SERVER_TIMESTAMP
  updated_at: timestamp      // SERVER_TIMESTAMP
}
```

#### Updated: `gap_analyses` Collection
```javascript
{
  // ... existing fields ...
  portfolio_id: string,               // NEW: References portfolios collection
  portfolio_snapshot: {               // NEW: Immutable snapshot at execution time
    portfolio_id: string,
    name: string,
    items: string[],
    created_at: string,               // ISO string
    updated_at: string                // ISO string
  }
}
```

### 2. BigQuery Schema

#### New Table: `portfolio_items_v2`
```sql
CREATE TABLE keyword_planner_data.portfolio_items_v2 (
  portfolio_id STRING NOT NULL,
  item_text STRING NOT NULL,
  added_at TIMESTAMP NOT NULL
)
```

#### New Table: `portfolio_embeddings_v2`
```sql
CREATE TABLE keyword_planner_data.portfolio_embeddings_v2 (
  portfolio_id STRING NOT NULL,
  item_text STRING NOT NULL,
  intent_string STRING,
  embedding ARRAY<FLOAT64>,
  prompt_hash STRING NOT NULL,
  embedded_at TIMESTAMP NOT NULL
)
```

#### Updated: `gap_analysis_results` (no schema change, but queries will use portfolio_id)
```sql
-- No schema changes needed
-- The portfolio snapshot is stored in Firestore
-- BigQuery results link via analysis_id
```

---

## API Changes

### Portfolio Endpoints (Complete Redesign)

#### `GET /api/portfolios`
**Response:**
```javascript
{
  portfolios: [
    {
      portfolio_id: string,
      name: string,
      total_items: int,
      created_at: string,
      updated_at: string
    }
  ],
  total_count: int
}
```

#### `POST /api/portfolios`
**Request:**
```javascript
{
  name: string,
  items: string[]
}
```
**Response:** Portfolio object

**Logic:**
1. Create Firestore document with UUID
2. Sync items to BigQuery `portfolio_items_v2` table

#### `GET /api/portfolios/:id`
**Response:**
```javascript
{
  portfolio_id: string,
  name: string,
  items: string[],
  total_items: int,
  created_at: string,
  updated_at: string
}
```

#### `PUT /api/portfolios/:id`
**Request:**
```javascript
{
  name: string,
  items: string[]
}
```
**Response:** Updated portfolio object

**Logic:**
1. Update Firestore document
2. Delete old items from BigQuery
3. Insert new items to BigQuery `portfolio_items_v2`

#### `DELETE /api/portfolios/:id`
**Response:**
```javascript
{
  message: string,
  portfolio_id: string
}
```

**Logic:**
1. Check if any gap analyses reference this portfolio (optional safety check)
2. Delete from Firestore
3. Delete from BigQuery tables

### Gap Analysis Endpoints (Updates)

#### `POST /api/gap-analyses` - Updated
**Request (NEW field):**
```javascript
{
  report_id: string,
  name: string,
  portfolio_id: string,        // NEW: Required
  filter_ids: string[]         // Optional
}
```

**Logic Changes:**
1. Verify portfolio exists
2. Fetch portfolio data from Firestore
3. Create portfolio snapshot
4. Store snapshot in gap_analyses document
5. Run pipeline using portfolio_id

---

## Migration Strategy

### Migration Script: `scripts/migrate_to_multiple_portfolios.py`

**Steps:**
1. Read existing `portfolio/default` document from Firestore
2. Create new portfolio with UUID: `{portfolio_id: uuid, name: "Default Portfolio", items: [...], created_at: NOW, updated_at: NOW}`
3. Write to Firestore `portfolios` collection
4. Sync items to BigQuery `portfolio_items_v2` table
5. **Backfill existing gap_analyses:**
   - Query all documents in `gap_analyses` collection
   - For each, add:
     - `portfolio_id: <default_portfolio_id>`
     - `portfolio_snapshot: {portfolio_id, name: "Default Portfolio", items, created_at, updated_at}`
6. Delete old `portfolio/default` document
7. Output summary

**Safety:**
- Take Firestore backup before running
- Run in read-only mode first to verify
- Log all changes made

**Run Once:** This script will be executed once in production after deployment.

---

## Implementation Tasks

### Phase 1: Backend Infrastructure
- [ ] Update `db.py` - Add table name constants for v2 tables
- [ ] Update `backend/config.yaml` - Add v2 table names
- [ ] Update `terraform/bigquery.tf` - Define new tables
- [ ] Create migration script `scripts/migrate_to_multiple_portfolios.py`

### Phase 2: Backend API
- [ ] **Rewrite** `backend/routers/portfolio.py`:
  - GET /portfolios (list)
  - POST /portfolios (create)
  - GET /portfolios/:id (get one)
  - PUT /portfolios/:id (update)
  - DELETE /portfolios/:id (delete)
  - Remove old `/portfolio` and `/portfolio/meta`
- [ ] **Update** `backend/routers/gap_analysis.py`:
  - Add `portfolio_id` to `GapAnalysisCreate` model
  - Fetch portfolio and create snapshot
  - Update validation logic
  - Pass `portfolio_id` to pipeline
- [ ] **Update** `backend/bq_ml.py`:
  - Update `run_gap_analysis_pipeline()` to accept `portfolio_id`
  - Query from `portfolio_items_v2` and `portfolio_embeddings_v2`
  - Update all SQL queries to filter by `portfolio_id`

### Phase 3: Frontend - Portfolios
- [ ] **Create** `frontend/src/pages/PortfoliosPage.jsx` (list view):
  - Fetch and display portfolios
  - Show name, item count, created date
  - "New Portfolio" button
  - Click row → navigate to detail
- [ ] **Create** `frontend/src/components/NewPortfolioModal.jsx`:
  - Name input
  - Items textarea (one per line)
  - Submit creates portfolio
- [ ] **Rewrite** `frontend/src/pages/PortfolioPage.jsx` → `PortfolioDetailPage.jsx`:
  - Load single portfolio by ID
  - Edit name
  - Edit items (textarea)
  - Save button
  - Delete button (with confirmation)
  - Back to list button

### Phase 4: Frontend - Gap Analysis Integration
- [ ] **Update** `frontend/src/components/NewGapAnalysisModal.jsx`:
  - Add portfolio selector dropdown
  - Fetch portfolios list
  - Require portfolio selection
  - Update API call to include `portfolio_id`
- [ ] **Update** `frontend/src/pages/GapAnalysisDetailPage.jsx`:
  - Display portfolio snapshot info (read-only)
  - Show which portfolio was used

### Phase 5: Frontend - Navigation
- [ ] **Update** `frontend/src/components/Navbar.jsx`:
  - Change "Portfolio" link to "Portfolios"
  - Update route to `/portfolios`
- [ ] **Update** `frontend/src/App.jsx`:
  - Add route: `/portfolios` → PortfoliosPage
  - Add route: `/portfolios/:id` → PortfolioDetailPage
  - Remove old `/portfolio` route

### Phase 6: Testing & Deployment
- [ ] Test migration script on local dev environment
- [ ] Test all CRUD operations for portfolios
- [ ] Test gap analysis creation with portfolio selection
- [ ] Verify portfolio snapshot immutability
- [ ] Deploy Terraform changes (new tables)
- [ ] Deploy application code
- [ ] Run migration script in production
- [ ] Verify production data

---

## Rollback Plan

If issues arise after deployment:

1. **Keep old tables:** Don't delete `portfolio_items` and `portfolio_embeddings` immediately
2. **Firestore backup:** Take snapshot before migration
3. **Code rollback:** Revert to previous git commit and redeploy
4. **Data rollback:** Restore Firestore from backup if needed

---

## Open Questions / Decisions Made

✅ **Q: Should portfolios have descriptions?**  
A: No, just name + timestamps

✅ **Q: Migration strategy for old data?**  
A: Create "Default Portfolio" from existing data

✅ **Q: Lose cached embeddings or migrate?**  
A: Create new tables (lose cache) - simpler, cleaner

✅ **Q: UI pattern?**  
A: List + detail pages (consistent with rest of app)

✅ **Q: Collision detection for portfolio snapshots?**  
A: No (unlike filters)

---

## Files to Modify

### Backend
- `backend/db.py`
- `backend/config.yaml`
- `backend/routers/portfolio.py` (complete rewrite)
- `backend/routers/gap_analysis.py` (moderate update)
- `backend/bq_ml.py` (moderate update)

### Frontend
- `frontend/src/App.jsx`
- `frontend/src/components/Navbar.jsx`
- `frontend/src/pages/PortfoliosPage.jsx` (new)
- `frontend/src/pages/PortfolioDetailPage.jsx` (rewrite existing)
- `frontend/src/components/NewPortfolioModal.jsx` (new)
- `frontend/src/components/NewGapAnalysisModal.jsx` (update)
- `frontend/src/pages/GapAnalysisDetailPage.jsx` (minor update)

### Infrastructure
- `terraform/bigquery.tf`
- `scripts/migrate_to_multiple_portfolios.py` (new)

### Total: ~13 files modified/created
