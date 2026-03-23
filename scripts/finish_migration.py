#!/usr/bin/env python3
"""
Finish production migration:
- Portfolio already created in Firestore as 31e89bcc-dee5-48c6-bb7b-e89ff53dbfb7
- This script completes:
    Step 3: Insert all 5209 items into BQ portfolio_items_v2 (streaming inserts)
    Step 4: Backfill gap_analyses with portfolio_id + snapshot
    Step 5: Delete old portfolio/default
"""
import yaml
from datetime import datetime, timezone
from google.cloud import firestore, bigquery

with open("backend/config.yaml") as f:
    config = yaml.safe_load(f)

PROJECT_ID = config["gcp"]["project_id"]
DATASET_ID = config["bigquery"]["dataset"]
T_PORTFOLIO_ITEMS_V2 = config["bigquery"]["tables"]["portfolio_items_v2"]

PORTFOLIO_ID = "31e89bcc-dee5-48c6-bb7b-e89ff53dbfb7"

print(f"Project: {PROJECT_ID}")
print("Connecting...")
db = firestore.Client(project=PROJECT_ID)
bq = bigquery.Client(project=PROJECT_ID)
print("Connected\n")

# Read items from the already-created portfolio
portfolio_doc = db.collection("portfolios").document(PORTFOLIO_ID).get().to_dict()
items = portfolio_doc.get("items", [])
print(f"Portfolio has {len(items)} items\n")

# Step 3: Insert all items using streaming inserts
print(f"Step 3: Inserting {len(items)} items into BigQuery {T_PORTFOLIO_ITEMS_V2}...")
table_ref = f"{PROJECT_ID}.{DATASET_ID}.{T_PORTFOLIO_ITEMS_V2}"
table = bq.get_table(table_ref)
now = datetime.now(timezone.utc).isoformat()

rows_to_insert = [
    {"portfolio_id": PORTFOLIO_ID, "item_text": item, "added_at": now}
    for item in items
]

batch_size = 500
total = 0
for i in range(0, len(rows_to_insert), batch_size):
    batch = rows_to_insert[i:i+batch_size]
    errors = bq.insert_rows_json(table, batch)
    if errors:
        print(f"  ERROR in batch {i//batch_size + 1}: {errors[:3]}")
    else:
        total += len(batch)
        print(f"  batch {i//batch_size + 1}: inserted {len(batch)} rows (total: {total})")
print(f"BQ sync complete: {total} rows inserted\n")

# Step 4: Backfill gap analyses
print("Step 4: Backfilling gap_analyses...")
old_doc = db.collection("portfolio").document("default").get()
if old_doc.exists:
    old_data = old_doc.to_dict()
    old_updated_at = old_data.get("updated_at")
    ts = old_updated_at.isoformat() if hasattr(old_updated_at, "isoformat") else str(old_updated_at)
else:
    ts = now

snapshot = {
    "portfolio_id": PORTFOLIO_ID,
    "name": "Default Portfolio",
    "items": items,
    "created_at": ts,
    "updated_at": ts,
}

count = 0
for doc in db.collection("gap_analyses").stream():
    db.collection("gap_analyses").document(doc.id).update({
        "portfolio_id": PORTFOLIO_ID,
        "portfolio_snapshot": snapshot,
    })
    count += 1
print(f"Updated {count} gap analysis documents\n")

# Step 5: Delete old portfolio/default
if old_doc.exists:
    print("Step 5: Deleting portfolio/default...")
    db.collection("portfolio").document("default").delete()
    print("Deleted portfolio/default\n")
else:
    print("Step 5: portfolio/default already deleted\n")

print("=" * 50)
print("MIGRATION COMPLETE")
print(f"Portfolio ID: {PORTFOLIO_ID}")
print(f"Total items: {len(items)}")
print(f"Gap analyses backfilled: {count}")
