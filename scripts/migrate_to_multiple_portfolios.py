#!/usr/bin/env python3
"""
Migration script: Convert from single portfolio to multiple portfolios.

This script:
1. Reads the existing portfolio/default document from Firestore
2. Creates a new portfolio named "Default Portfolio" in the portfolios collection
3. Syncs items to BigQuery portfolio_items_v2 table
4. Backfills all existing gap_analyses with portfolio_id and portfolio_snapshot
5. Optionally deletes the old portfolio/default document

Run with --dry-run to preview changes without committing them.
"""

import argparse
import sys
import uuid
from datetime import datetime, timezone
from google.cloud import firestore, bigquery
import yaml

# Load configuration
with open("backend/config.yaml", "r") as f:
    config = yaml.safe_load(f)

PROJECT_ID = config["gcp"]["project_id"]
DATASET_ID = config["bigquery"]["dataset"]
T_PORTFOLIO_ITEMS_V2 = config["bigquery"]["tables"]["portfolio_items_v2"]


def main():
    parser = argparse.ArgumentParser(description="Migrate to multiple portfolios")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview changes without committing them"
    )
    parser.add_argument(
        "--skip-delete",
        action="store_true",
        help="Keep the old portfolio/default document (for safety)"
    )
    args = parser.parse_args()

    if args.dry_run:
        print("🔍 DRY RUN MODE - No changes will be made\n")
    else:
        print("⚠️  LIVE MODE - Changes will be committed\n")
        response = input("Are you sure you want to proceed? (yes/no): ")
        if response.lower() != "yes":
            print("Aborted.")
            sys.exit(0)

    # Initialize clients
    print("Connecting to Firestore and BigQuery...")
    db = firestore.Client(project=PROJECT_ID)
    bq_client = bigquery.Client(project=PROJECT_ID)
    print("✅ Connected\n")

    # Step 1: Read existing portfolio/default
    print("Step 1: Reading existing portfolio/default from Firestore...")
    old_portfolio_ref = db.collection("portfolio").document("default")
    old_portfolio_doc = old_portfolio_ref.get()

    if not old_portfolio_doc.exists:
        print("❌ No portfolio/default document found. Nothing to migrate.")
        sys.exit(1)

    old_data = old_portfolio_doc.to_dict()
    items = old_data.get("items", [])
    old_updated_at = old_data.get("updated_at")

    print(f"✅ Found portfolio with {len(items)} items")
    print(f"   Updated at: {old_updated_at}")
    if len(items) > 0:
        print(f"   Sample items: {items[:3]}")
    print()

    # Step 2: Create new portfolio document
    portfolio_id = str(uuid.uuid4())
    now = firestore.SERVER_TIMESTAMP if not args.dry_run else datetime.now(timezone.utc)
    
    new_portfolio = {
        "portfolio_id": portfolio_id,
        "name": "Default Portfolio",
        "items": items,
        "created_at": now,
        "updated_at": now,
    }

    print(f"Step 2: Creating new portfolio in portfolios collection...")
    print(f"   Portfolio ID: {portfolio_id}")
    print(f"   Name: Default Portfolio")
    print(f"   Items: {len(items)}")

    if not args.dry_run:
        db.collection("portfolios").document(portfolio_id).set(new_portfolio)
        print("✅ Created portfolio document in Firestore")
    else:
        print("   (dry run - skipped)")
    print()

    # Step 3: Sync to BigQuery portfolio_items_v2
    print(f"Step 3: Syncing items to BigQuery {T_PORTFOLIO_ITEMS_V2}...")
    
    if len(items) > 0:
        if not args.dry_run:
            # Build VALUES for bulk insert
            values_list = []
            for item in items:
                # Escape single quotes for SQL
                item_escaped = item.replace("'", "''")
                values_list.append(
                    f"('{portfolio_id}', '{item_escaped}', CURRENT_TIMESTAMP())"
                )
            
            values_sql = ", ".join(values_list)
            query = f"""
                INSERT INTO `{PROJECT_ID}.{DATASET_ID}.{T_PORTFOLIO_ITEMS_V2}`
                (portfolio_id, item_text, added_at)
                VALUES {values_sql}
            """
            
            job = bq_client.query(query)
            job.result()
            print(f"✅ Inserted {len(items)} items into BigQuery")
        else:
            print(f"   Would insert {len(items)} items")
            print(f"   Sample: {items[:3]}")
    else:
        print("   No items to insert")
    print()

    # Step 4: Backfill gap_analyses with portfolio_id and snapshot
    print("Step 4: Backfilling gap_analyses with portfolio_id and snapshot...")
    
    analyses_query = db.collection("gap_analyses").stream()
    analyses_docs = list(analyses_query)
    
    print(f"   Found {len(analyses_docs)} gap analysis documents")
    
    if len(analyses_docs) > 0:
        # Create portfolio snapshot
        portfolio_snapshot = {
            "portfolio_id": portfolio_id,
            "name": "Default Portfolio",
            "items": items,
            "created_at": old_updated_at.isoformat() if hasattr(old_updated_at, "isoformat") else str(old_updated_at),
            "updated_at": old_updated_at.isoformat() if hasattr(old_updated_at, "isoformat") else str(old_updated_at),
        }
        
        updated_count = 0
        for doc in analyses_docs:
            analysis_id = doc.id
            
            if not args.dry_run:
                db.collection("gap_analyses").document(analysis_id).update({
                    "portfolio_id": portfolio_id,
                    "portfolio_snapshot": portfolio_snapshot,
                })
                updated_count += 1
        
        if not args.dry_run:
            print(f"✅ Updated {updated_count} gap analysis documents")
        else:
            print(f"   Would update {len(analyses_docs)} documents")
            print(f"   Sample snapshot: {portfolio_snapshot}")
    else:
        print("   No gap analyses to backfill")
    print()

    # Step 5: Delete old portfolio/default (optional)
    if not args.skip_delete:
        print("Step 5: Deleting old portfolio/default document...")
        if not args.dry_run:
            old_portfolio_ref.delete()
            print("✅ Deleted portfolio/default")
        else:
            print("   (dry run - would delete)")
    else:
        print("Step 5: Skipping deletion (--skip-delete flag)")
    print()

    # Summary
    print("=" * 60)
    print("MIGRATION SUMMARY")
    print("=" * 60)
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"New portfolio ID: {portfolio_id}")
    print(f"Portfolio items migrated: {len(items)}")
    print(f"Gap analyses backfilled: {len(analyses_docs)}")
    print(f"Old document {'kept' if args.skip_delete else 'deleted'}")
    print()
    
    if args.dry_run:
        print("✅ Dry run complete. Run without --dry-run to apply changes.")
    else:
        print("✅ Migration complete!")
        print()
        print("Next steps:")
        print("1. Verify data in Firestore portfolios collection")
        print("2. Verify data in BigQuery portfolio_items_v2 table")
        print("3. Check a gap analysis document has portfolio_id and portfolio_snapshot")
        print("4. Deploy new application code that uses the v2 tables")


if __name__ == "__main__":
    main()
