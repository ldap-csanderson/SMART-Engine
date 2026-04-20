"""Datasets endpoints — unified replacement for keyword_reports + portfolios."""
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, BackgroundTasks, HTTPException
from google.ads.googleads.errors import GoogleAdsException
from google.cloud import firestore
from pydantic import BaseModel

from db import (
    ga_auth_manager, get_ga_client, bq_client, db, ts_to_str,
    CUSTOMER_ID, MAX_RETRIES, RETRY_DELAY,
    PROJECT_ID, DATASET_ID, T_DATASET_ITEMS,
    SEARCH_VOLUME_TYPES,
)

router = APIRouter(prefix="/datasets", tags=["datasets"])

# ---------------------------------------------------------------------------
# Valid dataset types
# ---------------------------------------------------------------------------

VALID_TYPES = {
    "google_ads_keywords",
    "google_ads_ad_copy",
    "google_ads_search_terms",
    "google_ads_keyword_planner",
    "text_list",
}

# Types that require Google Ads API access
GOOGLE_ADS_TYPES = {
    "google_ads_keywords",
    "google_ads_ad_copy",
    "google_ads_search_terms",
    "google_ads_keyword_planner",
}

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class DatasetCreate(BaseModel):
    name: str
    type: str
    source_config: Optional[Dict[str, Any]] = None
    items: Optional[List[str]] = None  # for text_list type only


class DatasetListItem(BaseModel):
    dataset_id: str
    name: str
    type: str
    status: str
    item_count: int
    created_at: str
    updated_at: str
    error_message: Optional[str] = None


class Dataset(BaseModel):
    dataset_id: str
    name: str
    type: str
    status: str
    item_count: int
    created_at: str
    updated_at: str
    source_config: Optional[Dict[str, Any]] = None
    items: Optional[List[str]] = None  # for text_list type
    error_message: Optional[str] = None


class DatasetListResponse(BaseModel):
    datasets: List[DatasetListItem]
    total_count: int


class RenameRequest(BaseModel):
    name: str


class AccountInfo(BaseModel):
    account_id: str
    name: str
    is_manager: bool


class AccountsResponse(BaseModel):
    accounts: List[AccountInfo]
    is_mcc: bool


# ---------------------------------------------------------------------------
# Google Ads helpers
# ---------------------------------------------------------------------------

def _get_accessible_accounts(client, customer_id: str) -> List[Dict]:
    """List all accessible leaf accounts under the configured customer.

    When customer_id is an MCC, the customer_client report enumerates every
    managed account in the hierarchy.  If it returns nothing (e.g. customer_id
    is already a leaf), we fall back to querying the account directly.
    """
    ga_service = client.get_service("GoogleAdsService")
    accounts = []

    try:
        # MCC path: customer_client traverses the full account hierarchy
        query = """
            SELECT
              customer_client.id,
              customer_client.descriptive_name,
              customer_client.manager,
              customer_client.status
            FROM customer_client
            WHERE customer_client.status = 'ENABLED'
              AND customer_client.manager = false
        """
        response = ga_service.search(customer_id=customer_id, query=query)
        for row in response:
            cc = row.customer_client
            accounts.append({
                "account_id": str(cc.id),
                "name": cc.descriptive_name or f"Account {cc.id}",
                "is_manager": False,
            })
        print(f"✅ Listed {len(accounts)} managed accounts under MCC {customer_id}")
    except Exception as e:
        print(f"⚠️ customer_client query failed for {customer_id}: {e}")

    if not accounts:
        # Fallback: customer_id may be a leaf account — query it directly
        try:
            query = """
                SELECT customer.id, customer.descriptive_name, customer.manager
                FROM customer
            """
            response = ga_service.search(customer_id=customer_id, query=query)
            for row in response:
                accounts.append({
                    "account_id": str(row.customer.id),
                    "name": row.customer.descriptive_name or f"Account {row.customer.id}",
                    "is_manager": row.customer.manager,
                })
            print(f"✅ Fallback: listed {len(accounts)} direct account(s) for {customer_id}")
        except Exception as e2:
            print(f"⚠️ Direct customer query also failed for {customer_id}: {e2}")

    return accounts


def _fetch_keyword_ideas_for_url(client, customer_id: str, url: str, retry: int = 0, auth_retry: bool = False) -> List[Dict]:
    """Fetch keyword planner ideas seeded by a URL."""
    keyword_plan_idea_service = client.get_service("KeywordPlanIdeaService")
    request = client.get_type("GenerateKeywordIdeasRequest")
    request.customer_id = customer_id
    request.url_seed.url = url
    request.language = client.get_service("GoogleAdsService").language_constant_path("1000")
    request.geo_target_constants.append(
        client.get_service("GoogleAdsService").geo_target_constant_path("2840")
    )
    try:
        response = keyword_plan_idea_service.generate_keyword_ideas(request=request)
        ideas = []
        for idea in response:
            m = idea.keyword_idea_metrics
            ideas.append({
                "item_text": idea.text,
                "avg_monthly_searches": m.avg_monthly_searches if m else None,
                "competition": m.competition.name if m and m.competition else None,
                "competition_index": m.competition_index if m else None,
                "low_top_of_page_bid_usd": m.low_top_of_page_bid_micros / 1_000_000 if m and m.low_top_of_page_bid_micros else None,
                "high_top_of_page_bid_usd": m.high_top_of_page_bid_micros / 1_000_000 if m and m.high_top_of_page_bid_micros else None,
                "source_url": url,
            })
        return ideas
    except GoogleAdsException as ex:
        error_msg = str(ex)
        is_auth_error = (
            "UNAUTHENTICATED" in error_msg or
            "401" in error_msg or
            "invalid_grant" in error_msg or
            "Request had invalid authentication credentials" in error_msg
        )
        if is_auth_error and not auth_retry and ga_auth_manager:
            if ga_auth_manager.handle_auth_error():
                refreshed_client = ga_auth_manager.client
                if refreshed_client:
                    return _fetch_keyword_ideas_for_url(refreshed_client, customer_id, url, retry, auth_retry=True)
        if retry < MAX_RETRIES:
            time.sleep(RETRY_DELAY)
            return _fetch_keyword_ideas_for_url(client, customer_id, url, retry + 1, auth_retry)
        return []
    except Exception as ex:
        if retry < MAX_RETRIES:
            time.sleep(RETRY_DELAY)
            return _fetch_keyword_ideas_for_url(client, customer_id, url, retry + 1, auth_retry)
        return []


def _fetch_ad_copy(client, customer_id: str, account_ids: List[str]) -> List[Dict]:
    """Fetch ad copy (RSA + ETA) from the given accounts."""
    ga_service = client.get_service("GoogleAdsService")
    target_ids = account_ids if account_ids else [customer_id]
    items = []
    seen = set()

    query = """
        SELECT
          ad_group_ad.ad.id,
          ad_group_ad.ad.type,
          ad_group_ad.ad.responsive_search_ad.headlines,
          ad_group_ad.ad.responsive_search_ad.descriptions,
          ad_group_ad.ad.expanded_text_ad.headline_part1,
          ad_group_ad.ad.expanded_text_ad.headline_part2,
          ad_group_ad.ad.expanded_text_ad.headline_part3,
          ad_group_ad.ad.expanded_text_ad.description,
          ad_group_ad.ad.expanded_text_ad.description2
        FROM ad_group_ad
        WHERE ad_group_ad.status != 'REMOVED'
    """

    for acct_id in target_ids:
        try:
            response = ga_service.search(customer_id=acct_id, query=query)
            for row in response:
                ad = row.ad_group_ad.ad
                ad_type = ad.type_.name if hasattr(ad.type_, 'name') else str(ad.type_)
                lines = []

                if "RESPONSIVE_SEARCH_AD" in ad_type:
                    rsa = ad.responsive_search_ad
                    for i, asset in enumerate(rsa.headlines, 1):
                        text = asset.text.strip() if asset.text else ""
                        if text:
                            lines.append(f"Headline{i}: {text}")
                    for i, asset in enumerate(rsa.descriptions, 1):
                        text = asset.text.strip() if asset.text else ""
                        if text:
                            lines.append(f"Description{i}: {text}")
                elif "EXPANDED_TEXT_AD" in ad_type:
                    eta = ad.expanded_text_ad
                    for i, part in enumerate([eta.headline_part1, eta.headline_part2, eta.headline_part3], 1):
                        if part and part.strip():
                            lines.append(f"Headline{i}: {part.strip()}")
                    for i, desc in enumerate([eta.description, eta.description2], 1):
                        if desc and desc.strip():
                            lines.append(f"Description{i}: {desc.strip()}")

                if lines:
                    item_text = "\n".join(lines)
                    if item_text not in seen:
                        seen.add(item_text)
                        items.append({"item_text": item_text})
        except Exception as e:
            print(f"⚠️ Could not fetch ad copy from account {acct_id}: {e}")

    return items


def _fetch_search_terms(client, customer_id: str, account_ids: List[str], date_range_days: int = 90) -> List[Dict]:
    """Fetch search terms report from the given accounts."""
    ga_service = client.get_service("GoogleAdsService")
    target_ids = account_ids if account_ids else [customer_id]
    items = []
    seen = set()

    query = f"""
        SELECT
          search_term_view.search_term,
          metrics.impressions
        FROM search_term_view
        WHERE segments.date DURING LAST_{date_range_days}_DAYS
          AND search_term_view.status != 'EXCLUDED'
        ORDER BY metrics.impressions DESC
    """

    for acct_id in target_ids:
        try:
            response = ga_service.search(customer_id=acct_id, query=query)
            for row in response:
                term = row.search_term_view.search_term.strip()
                if term and term not in seen:
                    seen.add(term)
                    items.append({"item_text": term})
        except Exception as e:
            print(f"⚠️ Could not fetch search terms from account {acct_id}: {e}")

    return items


def _fetch_keyword_planner_account(client, customer_id: str, account_ids: List[str]) -> List[Dict]:
    """Fetch keyword planner ideas at account level (no URL seed)."""
    ga_service = client.get_service("GoogleAdsService")
    target_ids = account_ids if account_ids else [customer_id]
    keyword_plan_idea_service = client.get_service("KeywordPlanIdeaService")
    items = []
    seen = set()

    for acct_id in target_ids:
        try:
            # Get existing keywords from the account to use as seeds
            query = """
                SELECT ad_group_criterion.keyword.text
                FROM ad_group_criterion
                WHERE ad_group_criterion.type = 'KEYWORD'
                  AND ad_group_criterion.status != 'REMOVED'
                LIMIT 20
            """
            response = ga_service.search(customer_id=acct_id, query=query)
            seed_keywords = [row.ad_group_criterion.keyword.text for row in response if row.ad_group_criterion.keyword.text]

            if not seed_keywords:
                continue

            request = client.get_type("GenerateKeywordIdeasRequest")
            request.customer_id = acct_id
            request.keyword_seed.keywords.extend(seed_keywords[:20])
            request.language = client.get_service("GoogleAdsService").language_constant_path("1000")
            request.geo_target_constants.append(
                client.get_service("GoogleAdsService").geo_target_constant_path("2840")
            )

            ideas_response = keyword_plan_idea_service.generate_keyword_ideas(request=request)
            for idea in ideas_response:
                m = idea.keyword_idea_metrics
                kw = idea.text.strip()
                if kw and kw not in seen:
                    seen.add(kw)
                    items.append({
                        "item_text": kw,
                        "avg_monthly_searches": m.avg_monthly_searches if m else None,
                        "competition": m.competition.name if m and m.competition else None,
                        "competition_index": m.competition_index if m else None,
                        "low_top_of_page_bid_usd": m.low_top_of_page_bid_micros / 1_000_000 if m and m.low_top_of_page_bid_micros else None,
                        "high_top_of_page_bid_usd": m.high_top_of_page_bid_micros / 1_000_000 if m and m.high_top_of_page_bid_micros else None,
                    })
        except Exception as e:
            print(f"⚠️ Could not fetch keyword planner data from account {acct_id}: {e}")

    return items


# ---------------------------------------------------------------------------
# BQ helpers
# ---------------------------------------------------------------------------

def _insert_items_to_bq(dataset_id: str, items: List[Dict[str, Any]]):
    """Insert items into dataset_items BQ table."""
    if not bq_client or not items:
        return
    table_id = f"{PROJECT_ID}.{DATASET_ID}.{T_DATASET_ITEMS}"
    timestamp = datetime.now(timezone.utc).isoformat()
    rows = []
    for item in items:
        rows.append({
            "dataset_id": dataset_id,
            "item_text": item["item_text"],
            "added_at": timestamp,
            "avg_monthly_searches": item.get("avg_monthly_searches"),
            "competition": item.get("competition"),
            "competition_index": item.get("competition_index"),
            "low_top_of_page_bid_usd": item.get("low_top_of_page_bid_usd"),
            "high_top_of_page_bid_usd": item.get("high_top_of_page_bid_usd"),
            "source_url": item.get("source_url"),
        })
    # Insert in chunks of 500 to stay within BQ streaming limits
    chunk_size = 500
    for i in range(0, len(rows), chunk_size):
        chunk = rows[i:i + chunk_size]
        errors = bq_client.insert_rows_json(table_id, chunk)
        if errors:
            print(f"❌ BQ insert errors: {errors}")
        else:
            print(f"✅ Inserted {len(chunk)} items to BQ dataset_items")


# ---------------------------------------------------------------------------
# Background ingestion tasks
# ---------------------------------------------------------------------------

def _ingest_google_ads_keywords(dataset_id: str, source_config: Dict):
    """Background: fetch keyword planner results for URL-seeded dataset."""
    client = get_ga_client()
    urls = source_config.get("urls", [])
    customer_id = source_config.get("customer_id", CUSTOMER_ID)
    total = 0
    try:
        if client is None:
            raise RuntimeError("Google Ads client not connected — re-authorize via Settings")
        for i, url in enumerate(urls):
            print(f"[{i+1}/{len(urls)}] Fetching keyword ideas for: {url}")
            items = _fetch_keyword_ideas_for_url(client, customer_id, url)
            _insert_items_to_bq(dataset_id, items)
            total += len(items)
            if i < len(urls) - 1:
                time.sleep(1)
        db.collection("datasets").document(dataset_id).update({
            "status": "completed",
            "item_count": total,
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        print(f"✅ Dataset {dataset_id} (google_ads_keywords) completed — {total} items")
    except Exception as e:
        print(f"❌ Ingestion failed for dataset {dataset_id}: {e}")
        try:
            db.collection("datasets").document(dataset_id).update({
                "status": "failed",
                "error_message": str(e),
                "updated_at": firestore.SERVER_TIMESTAMP,
            })
        except Exception:
            pass


def _ingest_google_ads_ad_copy(dataset_id: str, source_config: Dict):
    """Background: fetch ad copy from Google Ads accounts."""
    client = get_ga_client()
    customer_id = source_config.get("customer_id", CUSTOMER_ID)
    account_ids = source_config.get("account_ids", [])
    try:
        if client is None:
            raise RuntimeError("Google Ads client not connected — re-authorize via Settings")
        items = _fetch_ad_copy(client, customer_id, account_ids)
        _insert_items_to_bq(dataset_id, items)
        db.collection("datasets").document(dataset_id).update({
            "status": "completed",
            "item_count": len(items),
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        print(f"✅ Dataset {dataset_id} (google_ads_ad_copy) completed — {len(items)} items")
    except Exception as e:
        print(f"❌ Ingestion failed for dataset {dataset_id}: {e}")
        try:
            db.collection("datasets").document(dataset_id).update({
                "status": "failed",
                "error_message": str(e),
                "updated_at": firestore.SERVER_TIMESTAMP,
            })
        except Exception:
            pass


def _ingest_google_ads_search_terms(dataset_id: str, source_config: Dict):
    """Background: fetch search terms report from Google Ads accounts."""
    client = get_ga_client()
    customer_id = source_config.get("customer_id", CUSTOMER_ID)
    account_ids = source_config.get("account_ids", [])
    date_range_days = source_config.get("date_range_days", 90)
    try:
        if client is None:
            raise RuntimeError("Google Ads client not connected — re-authorize via Settings")
        items = _fetch_search_terms(client, customer_id, account_ids, date_range_days)
        _insert_items_to_bq(dataset_id, items)
        db.collection("datasets").document(dataset_id).update({
            "status": "completed",
            "item_count": len(items),
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        print(f"✅ Dataset {dataset_id} (google_ads_search_terms) completed — {len(items)} items")
    except Exception as e:
        print(f"❌ Ingestion failed for dataset {dataset_id}: {e}")
        try:
            db.collection("datasets").document(dataset_id).update({
                "status": "failed",
                "error_message": str(e),
                "updated_at": firestore.SERVER_TIMESTAMP,
            })
        except Exception:
            pass


def _ingest_google_ads_keyword_planner(dataset_id: str, source_config: Dict):
    """Background: fetch keyword planner ideas at account level."""
    client = get_ga_client()
    customer_id = source_config.get("customer_id", CUSTOMER_ID)
    account_ids = source_config.get("account_ids", [])
    try:
        if client is None:
            raise RuntimeError("Google Ads client not connected — re-authorize via Settings")
        items = _fetch_keyword_planner_account(client, customer_id, account_ids)
        _insert_items_to_bq(dataset_id, items)
        db.collection("datasets").document(dataset_id).update({
            "status": "completed",
            "item_count": len(items),
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        print(f"✅ Dataset {dataset_id} (google_ads_keyword_planner) completed — {len(items)} items")
    except Exception as e:
        print(f"❌ Ingestion failed for dataset {dataset_id}: {e}")
        try:
            db.collection("datasets").document(dataset_id).update({
                "status": "failed",
                "error_message": str(e),
                "updated_at": firestore.SERVER_TIMESTAMP,
            })
        except Exception:
            pass


def _ingest_text_list(dataset_id: str, items: List[str]):
    """Background: insert text_list items into BQ."""
    try:
        bq_items = [{"item_text": item.strip()} for item in items if item.strip()]
        _insert_items_to_bq(dataset_id, bq_items)
        db.collection("datasets").document(dataset_id).update({
            "status": "completed",
            "item_count": len(bq_items),
            "updated_at": firestore.SERVER_TIMESTAMP,
        })
        print(f"✅ Dataset {dataset_id} (text_list) completed — {len(bq_items)} items")
    except Exception as e:
        print(f"❌ Ingestion failed for dataset {dataset_id}: {e}")
        try:
            db.collection("datasets").document(dataset_id).update({
                "status": "failed",
                "error_message": str(e),
                "updated_at": firestore.SERVER_TIMESTAMP,
            })
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/accounts", response_model=AccountsResponse)
def list_accounts():
    """List all accessible Google Ads accounts under the configured customer."""
    client = get_ga_client()
    if client is None:
        raise HTTPException(503, "Google Ads client not connected. Please re-authorize via Settings.")
    try:
        accounts = _get_accessible_accounts(client, CUSTOMER_ID)
        is_mcc = any(a["is_manager"] for a in accounts)
        # Filter out manager accounts from the selectable list
        leaf_accounts = [a for a in accounts if not a["is_manager"]]
        return AccountsResponse(
            accounts=[AccountInfo(**a) for a in leaf_accounts],
            is_mcc=is_mcc,
        )
    except Exception as e:
        raise HTTPException(500, f"Failed to list accounts: {e}")


@router.get("", response_model=DatasetListResponse)
def list_datasets(status: Optional[str] = None, limit: int = 100):
    """List all datasets."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    try:
        docs = (
            db.collection("datasets")
            .order_by("created_at", direction=firestore.Query.DESCENDING)
            .limit(limit * 2)
            .stream()
        )
        datasets = []
        for doc in docs:
            d = doc.to_dict()
            doc_status = d.get("status", "")
            if status:
                if doc_status != status:
                    continue
            else:
                if doc_status == "archived":
                    continue
            if len(datasets) >= limit:
                break
            datasets.append(DatasetListItem(
                dataset_id=d["dataset_id"],
                name=d.get("name", "Unnamed"),
                type=d.get("type", "text_list"),
                status=doc_status,
                item_count=d.get("item_count", 0),
                created_at=ts_to_str(d["created_at"]),
                updated_at=ts_to_str(d.get("updated_at") or d["created_at"]),
                error_message=d.get("error_message"),
            ))
        return DatasetListResponse(datasets=datasets, total_count=len(datasets))
    except Exception as e:
        raise HTTPException(500, str(e))


@router.post("", response_model=Dataset)
def create_dataset(payload: DatasetCreate, background_tasks: BackgroundTasks):
    """Create a new dataset and trigger ingestion."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    if payload.type not in VALID_TYPES:
        raise HTTPException(400, f"Invalid type '{payload.type}'. Must be one of: {', '.join(sorted(VALID_TYPES))}")
    if payload.type in GOOGLE_ADS_TYPES and get_ga_client() is None:
        raise HTTPException(503, "Google Ads client not connected. Please re-authorize via Settings.")
    if payload.type == "text_list":
        if not payload.items:
            raise HTTPException(400, "items is required for text_list datasets")

    dataset_id = str(uuid.uuid4())
    source_config = payload.source_config or {}

    # Inject customer_id into source_config for all Google Ads types (spec §1.4)
    if payload.type in GOOGLE_ADS_TYPES:
        source_config = {"customer_id": CUSTOMER_ID, **source_config}

    # For text_list, store items directly in Firestore (same as old Portfolio behavior)
    items_to_store = None
    if payload.type == "text_list":
        unique_items = list(dict.fromkeys(i.strip() for i in payload.items if i.strip()))
        items_to_store = unique_items

    doc_data = {
        "dataset_id": dataset_id,
        "name": payload.name.strip(),
        "type": payload.type,
        "status": "processing",
        "item_count": 0,
        "source_config": source_config,
        "created_at": firestore.SERVER_TIMESTAMP,
        "updated_at": firestore.SERVER_TIMESTAMP,
        "error_message": None,
    }
    if items_to_store is not None:
        doc_data["items"] = items_to_store

    db.collection("datasets").document(dataset_id).set(doc_data)

    # Trigger background ingestion
    if payload.type == "google_ads_keywords":
        background_tasks.add_task(_ingest_google_ads_keywords, dataset_id, source_config)
    elif payload.type == "google_ads_ad_copy":
        background_tasks.add_task(_ingest_google_ads_ad_copy, dataset_id, source_config)
    elif payload.type == "google_ads_search_terms":
        background_tasks.add_task(_ingest_google_ads_search_terms, dataset_id, source_config)
    elif payload.type == "google_ads_keyword_planner":
        background_tasks.add_task(_ingest_google_ads_keyword_planner, dataset_id, source_config)
    elif payload.type == "text_list":
        background_tasks.add_task(_ingest_text_list, dataset_id, items_to_store)

    doc = db.collection("datasets").document(dataset_id).get().to_dict()
    return Dataset(
        dataset_id=doc["dataset_id"],
        name=doc["name"],
        type=doc["type"],
        status=doc["status"],
        item_count=doc.get("item_count", 0),
        created_at=ts_to_str(doc["created_at"]),
        updated_at=ts_to_str(doc.get("updated_at") or doc["created_at"]),
        source_config=doc.get("source_config"),
        items=doc.get("items"),
        error_message=doc.get("error_message"),
    )


@router.get("/{dataset_id}", response_model=Dataset)
def get_dataset(dataset_id: str):
    """Get a single dataset by ID."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    doc = db.collection("datasets").document(dataset_id).get()
    if not doc.exists:
        raise HTTPException(404, f"Dataset {dataset_id} not found")
    d = doc.to_dict()
    return Dataset(
        dataset_id=d["dataset_id"],
        name=d.get("name", "Unnamed"),
        type=d.get("type", "text_list"),
        status=d.get("status", ""),
        item_count=d.get("item_count", 0),
        created_at=ts_to_str(d["created_at"]),
        updated_at=ts_to_str(d.get("updated_at") or d["created_at"]),
        source_config=d.get("source_config"),
        items=d.get("items"),
        error_message=d.get("error_message"),
    )


@router.get("/{dataset_id}/items")
def get_dataset_items(
    dataset_id: str,
    limit: int = 100,
    offset: int = 0,
    order_by: str = "avg_monthly_searches",
    order_dir: str = "DESC",
):
    """Get paginated items for a dataset from BigQuery."""
    if not db or not bq_client:
        raise HTTPException(503, "Service not initialized")

    doc = db.collection("datasets").document(dataset_id).get()
    if not doc.exists:
        raise HTTPException(404, f"Dataset {dataset_id} not found")
    d = doc.to_dict()

    valid_order_cols = {
        "item_text", "avg_monthly_searches", "competition_index",
        "low_top_of_page_bid_usd", "high_top_of_page_bid_usd", "added_at",
    }
    if order_by not in valid_order_cols:
        order_by = "added_at"
    order_dir = "DESC" if order_dir.upper() == "DESC" else "ASC"
    limit = min(max(1, limit), 500)
    offset = max(0, offset)

    table = f"`{PROJECT_ID}.{DATASET_ID}.{T_DATASET_ITEMS}`"
    rows = bq_client.query(f"""
        SELECT item_text, avg_monthly_searches, competition, competition_index,
               low_top_of_page_bid_usd, high_top_of_page_bid_usd, source_url, added_at
        FROM {table}
        WHERE dataset_id = '{dataset_id}'
        ORDER BY {order_by} {order_dir} NULLS LAST
        LIMIT {limit} OFFSET {offset}
    """).result()

    items = [{
        "item_text": row.item_text,
        "avg_monthly_searches": row.avg_monthly_searches,
        "competition": row.competition,
        "competition_index": row.competition_index,
        "low_top_of_page_bid_usd": row.low_top_of_page_bid_usd,
        "high_top_of_page_bid_usd": row.high_top_of_page_bid_usd,
        "source_url": row.source_url,
    } for row in rows]

    return {
        "dataset_id": d["dataset_id"],
        "name": d.get("name", "Unnamed"),
        "type": d.get("type"),
        "status": d.get("status"),
        "item_count": d.get("item_count", 0),
        "items": items,
        "limit": limit,
        "offset": offset,
    }


@router.patch("/{dataset_id}/rename")
def rename_dataset(dataset_id: str, payload: RenameRequest):
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "Name cannot be empty")
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("datasets").document(dataset_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Dataset {dataset_id} not found")
    ref.update({"name": name, "updated_at": firestore.SERVER_TIMESTAMP})
    return {"dataset_id": dataset_id, "name": name}


@router.patch("/{dataset_id}/archive")
def archive_dataset(dataset_id: str):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("datasets").document(dataset_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Dataset {dataset_id} not found")
    ref.update({"status": "archived", "updated_at": firestore.SERVER_TIMESTAMP})
    return {"message": f"Dataset {dataset_id} archived", "dataset_id": dataset_id}


@router.patch("/{dataset_id}/unarchive")
def unarchive_dataset(dataset_id: str):
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("datasets").document(dataset_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Dataset {dataset_id} not found")
    ref.update({"status": "completed", "updated_at": firestore.SERVER_TIMESTAMP})
    return {"message": f"Dataset {dataset_id} unarchived", "dataset_id": dataset_id}


@router.get("/{dataset_id}/groups")
def get_dataset_groups_membership(dataset_id: str):
    """Return all dataset groups that contain this dataset."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    if not db.collection("datasets").document(dataset_id).get().exists:
        raise HTTPException(404, f"Dataset {dataset_id} not found")
    groups = []
    for doc in db.collection("dataset_groups").stream():
        d = doc.to_dict()
        if dataset_id in d.get("dataset_ids", []):
            groups.append({"group_id": d["group_id"], "name": d["name"]})
    return {"groups": groups}


@router.delete("/{dataset_id}")
def delete_dataset(dataset_id: str):
    """Delete a dataset from Firestore and its items from BigQuery.
    Also removes the dataset from any groups it belongs to."""
    if not db:
        raise HTTPException(503, "Firestore not initialized")
    ref = db.collection("datasets").document(dataset_id)
    if not ref.get().exists:
        raise HTTPException(404, f"Dataset {dataset_id} not found")

    # Delete BQ rows (best effort)
    if bq_client:
        try:
            bq_client.query(
                f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.{T_DATASET_ITEMS}` "
                f"WHERE dataset_id = '{dataset_id}'"
            ).result()
        except Exception as e:
            print(f"⚠️ Could not delete BQ items for dataset {dataset_id}: {e}")
        try:
            bq_client.query(
                f"DELETE FROM `{PROJECT_ID}.{DATASET_ID}.dataset_embeddings` "
                f"WHERE dataset_id = '{dataset_id}'"
            ).result()
        except Exception as e:
            print(f"⚠️ Could not delete BQ embeddings for dataset {dataset_id}: {e}")

    ref.delete()

    # Cascade: remove dataset_id from any groups that contain it
    try:
        for doc in db.collection("dataset_groups").stream():
            d = doc.to_dict()
            ids = d.get("dataset_ids", [])
            if dataset_id in ids:
                new_ids = [i for i in ids if i != dataset_id]
                doc.reference.update({
                    "dataset_ids": new_ids,
                    "updated_at": firestore.SERVER_TIMESTAMP,
                })
                print(f"✅ Removed dataset {dataset_id} from group {d['group_id']}")
    except Exception as e:
        print(f"⚠️ Could not cascade-remove dataset {dataset_id} from groups: {e}")

    return {"message": f"Dataset {dataset_id} deleted", "dataset_id": dataset_id}
