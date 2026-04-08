# SMART Engine — v3 Feature Specification

## Overview

This document specifies the v3 redesign of the gap analysis platform. The core change is the introduction of a unified **Dataset** concept that replaces the separate Keyword Reports and Portfolios entities. All data sources — whether pulled from Google Ads, entered manually, or imported — become Datasets. Gap analyses compare any Dataset (or group of Datasets) against any other, regardless of type.

---

## 1. Datasets

### 1.1 Concept

A Dataset is a named collection of text items that can participate in a gap analysis on either side (source or target). All dataset types ultimately produce a flat list of text strings that are converted to intent embeddings during analysis.

### 1.2 Dataset Types

| Type | Description | Source |
|---|---|---|
| `google_ads_keywords` | Keyword Planner results seeded by URLs | Google Ads API — KeywordPlanIdeaService |
| `google_ads_ad_copy` | Ad copy from RSAs and ETAs in an account | Google Ads API — AdService |
| `google_ads_search_terms` | Search terms that triggered ads | Google Ads API — search_term_view |
| `google_ads_keyword_planner` | Keyword Planner pull at account level (no URL seed) | Google Ads API — KeywordPlanIdeaService |
| `text_list` | Manually entered list of text strings | User input (replaces current Portfolios) |

**Backlog (not in v3 scope):**
- `seo_pages` — crawl URLs and extract page content
- `sem_pages` — extract landing page content from ad final URLs

### 1.3 Firestore Schema

Collection: `datasets`

```
{
  dataset_id: string (uuid),
  name: string,
  type: string (enum above),
  status: "pending" | "processing" | "completed" | "failed",
  item_count: int,
  created_at: timestamp,
  updated_at: timestamp,
  source_config: {
    // type-specific, see §1.4
  },
  error_message: string | null
}
```

### 1.4 source_config by Type

**`google_ads_keywords`** (URL-seeded Keyword Planner):
```json
{
  "urls": ["https://example.com/page1"],
  "customer_id": "1234567890"
}
```

**`google_ads_ad_copy`**:
```json
{
  "customer_id": "1234567890",
  "account_ids": ["111", "222"]
}
```
`account_ids` is the list of child account IDs selected by the user. If the root customer is not an MCC, `account_ids` is empty and `customer_id` is used directly.

**`google_ads_search_terms`**:
```json
{
  "customer_id": "1234567890",
  "account_ids": ["111", "222"],
  "date_range_days": 90
}
```

**`google_ads_keyword_planner`**:
```json
{
  "customer_id": "1234567890",
  "account_ids": ["111", "222"]
}
```

**`text_list`**:
```json
{}
```
Items are stored directly in the dataset document under `items: [string]` (same as current Portfolio behavior).

### 1.5 Ad Copy Item Format

Ad copy items are stored as a single newline-delimited string with labeled fields. This gives the LLM full context when generating intent strings.

**RSA example:**
```
Headline1: Get Car Insurance Today
Headline2: Save Up to 40% on Auto
Headline3: Compare Top Providers
Description1: Fast, free quotes from leading insurers. Switch and save today.
Description2: Trusted by millions. Get your personalized rate in minutes.
```

**ETA example:**
```
Headline1: Get Car Insurance Today
Headline2: Save Up to 40% on Auto
Headline3: Compare Top Providers
Description1: Fast, free quotes from leading insurers.
Description2: Trusted by millions.
```

Each unique ad (by its combined field content) becomes one item in the dataset.

---

## 2. BigQuery Schema Changes

### 2.1 New Tables

**`dataset_items`** — replaces `keyword_results` and `portfolio_items_v2`

```sql
CREATE TABLE dataset_items (
  dataset_id        STRING NOT NULL,
  item_text         STRING NOT NULL,
  added_at          TIMESTAMP,
  -- enrichment columns (nullable; only populated for keyword-type datasets)
  avg_monthly_searches    INT64,
  competition             STRING,
  competition_index       FLOAT64,
  low_top_of_page_bid_usd  FLOAT64,
  high_top_of_page_bid_usd FLOAT64,
  source_url              STRING   -- for keyword planner: which URL seeded this item
)
PARTITION BY DATE(added_at)
CLUSTER BY dataset_id;
```

**`dataset_embeddings`** — replaces `portfolio_embeddings_v2`

```sql
CREATE TABLE dataset_embeddings (
  dataset_id    STRING NOT NULL,
  item_text     STRING NOT NULL,
  intent_string STRING,
  embedding     ARRAY<FLOAT64>,
  prompt_hash   STRING,
  embedded_at   TIMESTAMP
)
CLUSTER BY dataset_id, prompt_hash;
```

### 2.2 Deprecated Tables (kept for v2 compatibility, not used in v3)

- `keyword_results` (was `T_RESULTS`)
- `portfolio_items` (v1)
- `portfolio_embeddings` (v1)
- `portfolio_items_v2`
- `portfolio_embeddings_v2`

### 2.3 Gap Analysis Results Table

`gap_analysis_results` schema is unchanged. The `analysis_id` foreign key is sufficient to tie results back to the gap analysis document, which now stores `source_dataset_id` and `target_dataset_id`.

---

## 3. Gap Analysis Changes

### 3.1 Updated Firestore Schema

Collection: `gap_analyses`

```
{
  analysis_id: string,
  name: string,
  source_dataset_id: string,    // was: report_id
  source_dataset_name: string,  // snapshot for display
  source_dataset_type: string,  // snapshot for conditional UI
  target_dataset_id: string,    // was: portfolio_id (can also be a group_id)
  target_dataset_name: string,  // snapshot for display
  target_is_group: bool,        // true if target_dataset_id is a group
  status: string,
  created_at: timestamp,
  total_items_analyzed: int,    // was: total_keywords_analyzed
  min_monthly_searches: int,    // only applied when source type has search volume
  error_message: string | null
}
```

Note: `portfolio_snapshot` is removed. The dataset names/types are snapshotted as flat fields instead.

### 3.2 Updated API Request

```json
POST /gap-analyses
{
  "name": "My Analysis",
  "source_dataset_id": "uuid",
  "target_dataset_id": "uuid",       // dataset_id OR group_id
  "target_is_group": false,
  "min_monthly_searches": 1000,
  "filter_ids": []
}
```

### 3.3 Pipeline Changes

`run_gap_analysis_pipeline()` in `bq_ml.py` is updated to:

1. Pull source items from `dataset_items WHERE dataset_id = source_dataset_id` (instead of `keyword_results WHERE run_id = report_id`)
2. Apply `avg_monthly_searches >= min_monthly_searches` filter only if source dataset type has search volume data (`google_ads_keywords`, `google_ads_keyword_planner`)
3. Pull target items from `dataset_items WHERE dataset_id IN (target_ids)` — where `target_ids` is either `[target_dataset_id]` or all dataset IDs in the group
4. Use `dataset_embeddings` for the embedding cache on both sides (keyed by `dataset_id`)
5. Use a type-appropriate intent prompt for each side (see §3.4)

### 3.4 Intent Prompts by Dataset Type

Each dataset type gets a tailored prompt for intent string generation:

| Type | Prompt style |
|---|---|
| `google_ads_keywords` | Current keyword prompt ("I am [Persona] looking for [Need]") |
| `google_ads_keyword_planner` | Same as keywords |
| `google_ads_search_terms` | Same as keywords (search terms are user queries) |
| `google_ads_ad_copy` | "Analyze this ad copy and describe the user intent it targets" |
| `text_list` | Current portfolio prompt |

The prompt used is stored on the dataset document (`intent_prompt_override: string | null`). If null, the type default is used. Custom prompts can be set via the Settings page.

### 3.5 Results Display

The gap analysis results table uses dataset names as column headers:
- **Source column**: `[source_dataset_name]` (e.g. "Q1 Search Terms")
- **Target column**: `Closest match in [target_dataset_name]` (e.g. "Closest match in Active Ad Copy")
- **Search volume columns** (`avg_monthly_searches`, CPC): shown only when `source_dataset_type` is `google_ads_keywords` or `google_ads_keyword_planner`

---

## 4. Dataset Groups

### 4.1 Concept

A Dataset Group is a named collection of datasets that can be used as either side of a gap analysis. When a group is used, all items from all member datasets are unioned before embedding/searching.

### 4.2 Firestore Schema

Collection: `dataset_groups`

```
{
  group_id: string (uuid),
  name: string,
  dataset_ids: [string],
  created_at: timestamp,
  updated_at: timestamp
}
```

### 4.3 Usage in Gap Analysis

When `target_is_group: true`, the pipeline queries:
```sql
WHERE dataset_id IN (SELECT dataset_id FROM group members)
```

Groups can be used on either the source or target side. The `target_is_group` field on the gap analysis document indicates which side uses a group (for now, only one side can be a group at a time; both-sides-group is a future enhancement).

---

## 5. MCC Account Selection

When creating a dataset of type `google_ads_ad_copy`, `google_ads_search_terms`, or `google_ads_keyword_planner`, the UI presents an account picker:

1. The backend exposes `GET /datasets/accounts` which calls the Google Ads API to list all accessible customer accounts under the configured MCC (or returns just the single account if not an MCC).
2. The response includes `{ account_id, name, is_manager }` for each account.
3. The UI shows a checklist with a "Select All" toggle.
4. Selected `account_ids` are stored in `source_config`.
5. If the root customer is not an MCC, the account picker is skipped and `customer_id` is used directly.

---

## 6. API Routes

### New / Changed Routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/datasets` | List all datasets |
| `POST` | `/datasets` | Create a new dataset (triggers ingestion as background task) |
| `GET` | `/datasets/{id}` | Get dataset metadata |
| `GET` | `/datasets/{id}/items` | Paginated items for a dataset |
| `PATCH` | `/datasets/{id}/rename` | Rename |
| `PATCH` | `/datasets/{id}/archive` | Archive |
| `DELETE` | `/datasets/{id}` | Delete dataset + BQ rows |
| `GET` | `/datasets/accounts` | List accessible Google Ads accounts |
| `GET` | `/dataset-groups` | List all groups |
| `POST` | `/dataset-groups` | Create a group |
| `GET` | `/dataset-groups/{id}` | Get group |
| `PUT` | `/dataset-groups/{id}` | Update group (name, dataset_ids) |
| `DELETE` | `/dataset-groups/{id}` | Delete group |
| `POST` | `/gap-analyses` | Updated payload (see §3.2) |
| `POST` | `/gap-analyses/estimate` | Updated to use `source_dataset_id` |

### Removed Routes

- `GET/POST /keyword-reports` and all sub-routes
- `GET/POST/PUT/DELETE /portfolios` and all sub-routes

---

## 7. Frontend Changes

### 7.1 Navigation

The Navbar is simplified:
- **Datasets** (replaces "Keyword Reports" + "Portfolios")
- **Dataset Groups** (new)
- **Gap Analyses** (unchanged)
- **Filters** (unchanged)

### 7.2 Datasets Page

- Lists all datasets with type badge, item count, status, created date
- "New Dataset" button opens a modal with:
  - Name field
  - Type selector (dropdown)
  - Type-specific fields:
    - `google_ads_keywords`: URL list input
    - `google_ads_ad_copy` / `google_ads_search_terms` / `google_ads_keyword_planner`: account picker (fetched from `/datasets/accounts`)
    - `text_list`: textarea for items (one per line)
- Dataset detail page shows items in a paginated table

### 7.3 Dataset Groups Page

- Lists all groups with member count
- "New Group" button: name + multi-select of existing datasets
- Group detail page: editable name, add/remove datasets

### 7.4 Gap Analysis Creation Modal

- "Source Dataset" picker: select any dataset
- "Target" picker: toggle between "Dataset" and "Group", then select
- `min_monthly_searches` field: shown only when source type has search volume
- Cost estimate: updated to use `source_dataset_id`

### 7.5 Gap Analysis Results Page

- Column headers use dataset names (see §3.5)
- Search volume sort/filter shown conditionally based on `source_dataset_type`

---

## 8. Implementation Order

1. **BQ schema** — create `dataset_items` and `dataset_embeddings` tables in Terraform
2. **Backend: datasets router** — CRUD + ingestion background tasks for all types
3. **Backend: dataset groups router** — CRUD
4. **Backend: gap analysis router** — update to use new dataset/group model
5. **Backend: bq_ml.py** — update pipeline to use `dataset_items`/`dataset_embeddings`
6. **Frontend: Datasets pages** — list, detail, new modal
7. **Frontend: Dataset Groups pages** — list, detail, new modal
8. **Frontend: Gap Analysis** — update creation modal and results display
9. **Frontend: Navbar** — update routes
10. **Cleanup** — remove old portfolio/keyword-report routers and frontend pages

---

## 9. Backlog

- `seo_pages` dataset type: crawl a list of URLs and extract page title + meta description as items
- `sem_pages` dataset type: extract landing page content from ad final URLs
- Type-specific result formatting (e.g. render ad copy strings with visual field separation)
- Both sides of a gap analysis can be groups simultaneously
- Per-dataset custom intent prompt override UI
- Dataset refresh (re-pull from Google Ads to update an existing dataset)
