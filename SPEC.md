# SMART Engine — Working Spec & Development Log

> **Purpose**: LLM planning document and in-progress development log. Not meant for production documentation. Updated as work progresses.

---

## Active Feature: Image Datasets + gemini-embedding-2 Migration

**Started**: 2026-05-01

### Overview

Adding multimodal image datasets and migrating the entire embedding pipeline to `gemini-embedding-2`, which supports text + images in a unified embedding space. This enables gap analysis comparing image datasets against text datasets (and vice versa).

---

## Architecture Decisions

### Embedding Model: gemini-embedding-2
- Replaces `text-embedding-005` for all embeddings (text + image)
- BQ ML model endpoint: `gemini-embedding-2`
- **Dimensionality: 768** (4x less storage/compute vs 3072, negligible quality loss per MTEB benchmarks)
- Task type via prompt prefix (not `task_type` parameter): `"task: sentence similarity | query: {content}"`
- No backwards compatibility — all cached embeddings wiped on migration

### Image Storage: GCS
- Bucket: `smart-engine-images` (in same project)
- Path: `{dataset_id}/{sha256_hash}.{ext}`
- Images downloaded from source URLs/Drive during dataset ingestion, cached to GCS
- Chat agent and UI use GCS signed URLs for display
- Avoids broken external URLs, rate limits, repeated Drive auth

### Google Drive Auth: OAuth
- Extends existing Google OAuth flow to include Drive read scope
- User authorizes Drive access in-app (same flow as Google Ads re-auth)
- Folder listing and download during ingestion

### Image Embedding Modes (for Gap Analysis)
Two modes selectable per gap analysis:
1. **Direct Multimodal**: Image bytes → `gemini-embedding-2` → vector
2. **Caption-Based**: Image bytes → Gemini LLM caption → text embedding

Both modes support intent normalization on top:
- Direct + intent norm: caption generated → LLM normalize → embed
- Direct without intent norm: raw image → multimodal embed
- Caption + intent norm: auto-caption → LLM normalize → embed  
- Caption without intent norm: auto-caption → embed text

Note: For text-to-image gap analysis (primary use case), text dataset items are embedded as text, image dataset items are embedded per the selected mode. VECTOR_SEARCH compares across modalities using the unified embedding space.

### Scale Considerations
- Millions of rows per dataset → 768 dims critical for BQ IVF vector index performance
- Python SDK used for image embeddings (BQ ML can't process image bytes)
- Text embeddings stay on BQ ML (cost-efficient, no Python memory overhead for millions of items)

---

## Implementation Phases

### Phase 1: gemini-embedding-2 Migration ⬜ IN PROGRESS
- [ ] Update BQ ML `text-embeddings` model endpoint → `gemini-embedding-2`
- [ ] Update `_EMB_OPTS`: remove `task_type`, set `output_dimensionality=768`, add task prefix to content
- [ ] Wipe `dataset_embeddings` table (BQ DELETE)
- [ ] Drop and recreate vector index (IVF, 768 dims)
- [ ] Update `config.yaml` with embedding model name
- [ ] Update Terraform `bigquery.tf` schema if needed
- [ ] Deploy and verify

### Phase 2: GCS + Image Dataset Types ⬜ TODO
- [ ] Terraform: GCS bucket `smart-engine-images` + IAM
- [ ] Add `image_url` column to `dataset_items` (BQ schema update)
- [ ] Backend `datasets.py`: `image_urls` type (paste list) and `image_google_drive` type
- [ ] Image ingestion: download → GCS upload → store GCS path
- [ ] Frontend `NewDatasetModal.jsx`: two new image types
- [ ] `DatasetDetailPage.jsx`: thumbnail grid/table for image datasets

### Phase 3: Image Embedding Pipeline ⬜ TODO
- [ ] Python SDK image embedding function (Gemini API, not BQ ML)
- [ ] Two embedding modes: `direct_multimodal` and `caption_based`
- [ ] Integrate into `bq_ml.py` `run_gap_analysis_pipeline()`
- [ ] `NewGapAnalysisModal.jsx`: embedding mode selector for image datasets
- [ ] `GapAnalysisDetailPage.jsx`: image thumbnails in results

### Phase 4: Chat + UI Integration ⬜ TODO
- [ ] `ChatPanel.jsx`: render inline image thumbnails from URLs
- [ ] Chat agent: pass image parts to Gemini for visual analysis
- [ ] Settings: image-specific chat prompt defaults

### Phase 5: Google Drive OAuth ⬜ TODO
- [ ] Extend OAuth flow with Drive read scope
- [ ] Drive folder listing API
- [ ] Frontend: folder URL/ID input in NewDatasetModal

---

## Development Log

### 2026-05-01 — Session Start
- Planned full feature set
- Architecture decisions made:
  - GCS for image caching
  - OAuth for Drive (not service account)
  - 768 dims (storage/compute vs quality tradeoff at scale)
  - Text-to-image gap analysis is primary use case
- Starting Phase 1: gemini-embedding-2 migration

---

## Key Files Reference

| File | Role |
|------|------|
| `backend/bq_ml.py` | BQ ML helpers, gap analysis pipeline, filter pipeline |
| `backend/db.py` | Shared clients, constants, config loading |
| `backend/config.yaml` | App config (project, BQ, models) |
| `backend/routers/datasets.py` | Dataset CRUD + ingestion background tasks |
| `backend/routers/gap_analysis.py` | Gap analysis CRUD + pipeline trigger |
| `backend/routers/chat.py` | Agentic chat endpoints (dataset + gap) |
| `backend/routers/settings.py` | Settings CRUD (CID, agent model, prompts) |
| `terraform/bigquery.tf` | BQ tables, schemas |
| `terraform/vertex_ai.tf` | BQ ML connection |
| `frontend/src/components/NewDatasetModal.jsx` | Dataset creation modal |
| `frontend/src/components/NewGapAnalysisModal.jsx` | Gap analysis creation modal |
| `frontend/src/pages/DatasetDetailPage.jsx` | Dataset detail + chat |
| `frontend/src/pages/GapAnalysisDetailPage.jsx` | Gap analysis results + chat |
| `frontend/src/components/ChatPanel.jsx` | Unified chat panel |

## Constants
- Project: `csanderson-experimental-443821`
- Region: `us-central1`
- BQ Dataset: `smart_engine_data`
- BQ Connection: `us-central1.vertex-ai-connection`
- Service URL: `https://smart-engine-727077869999.us-central1.run.app`
- Latest deployed revision: `smart-engine-00033-2jr`
