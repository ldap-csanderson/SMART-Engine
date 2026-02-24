# Google Ads Keyword Planner API

A FastAPI-based REST API for fetching keyword planner data from Google Ads.

## Installation

Install the required dependencies:

```bash
pip install -r requirements.txt
```

## Running the API

Start the FastAPI server:

```bash
# From the google-ads directory
cd google-ads
python api.py
```

Or using uvicorn directly:

```bash
cd google-ads
uvicorn api:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000`

## API Documentation

Once running, you can access:
- Interactive API docs: `http://localhost:8000/docs`
- Alternative docs: `http://localhost:8000/redoc`

## Endpoints

### GET `/`
Returns API information and available endpoints.

**Response:**
```json
{
  "message": "Google Ads Keyword Planner API",
  "endpoints": {
    "/keyword-planner": "POST - Get keyword ideas from URLs",
    "/health": "GET - Check API health"
  }
}
```

### GET `/health`
Health check endpoint to verify the API and Google Ads client are working.

**Response:**
```json
{
  "status": "healthy",
  "google_ads_connected": true
}
```

### POST `/keyword-planner`
Fetch keyword planner data for multiple URLs.

**Request Body:**
```json
{
  "urls": [
    "https://example.com",
    "https://another-example.com"
  ]
}
```

**Response:**
```json
{
  "results": {
    "https://example.com": [
      {
        "keyword_text": "example keyword",
        "avg_monthly_searches": 1000,
        "competition": "LOW",
        "competition_index": 25,
        "low_top_of_page_bid_micros": 500000,
        "high_top_of_page_bid_micros": 2000000,
        "low_top_of_page_bid_usd": 0.5,
        "high_top_of_page_bid_usd": 2.0,
        "concepts": [
          {
            "name": "Concept Name",
            "type": "BRAND"
          }
        ]
      }
    ]
  },
  "summary": {
    "urls_analyzed": 1,
    "total_keywords_found": 150,
    "keywords_per_url": {
      "https://example.com": 150
    }
  }
}
```

## Usage Examples

### Using cURL

```bash
curl -X POST "http://localhost:8000/keyword-planner" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [
      "https://example.com",
      "https://another-example.com"
    ]
  }'
```

### Using Python requests

```python
import requests

url = "http://localhost:8000/keyword-planner"
payload = {
    "urls": [
        "https://example.com",
        "https://another-example.com"
    ]
}

response = requests.post(url, json=payload)
data = response.json()

print(f"Total keywords found: {data['summary']['total_keywords_found']}")
for url, keywords in data['results'].items():
    print(f"\n{url}: {len(keywords)} keywords")
    for keyword in keywords[:5]:  # Print first 5 keywords
        print(f"  - {keyword['keyword_text']}: {keyword['avg_monthly_searches']} searches/month")
```

### Using JavaScript/fetch

```javascript
const response = await fetch('http://localhost:8000/keyword-planner', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    urls: [
      'https://example.com',
      'https://another-example.com'
    ]
  })
});

const data = await response.json();
console.log('Total keywords:', data.summary.total_keywords_found);
```

## Configuration

The API uses the following configuration:
- **Customer ID**: `2900871247` (configured in `api.py`)
- **Google Ads credentials**: Loaded from `google-ads.yaml`
- **Location**: United States (geo_target_constant: 2840)
- **Language**: English (language_constant: 1000)
- **Max retries**: 3 attempts with 5 second delays
- **URL limit**: Maximum 50 URLs per request

## Notes

- The API automatically retries failed requests up to 3 times
- Empty results are returned for URLs that fail after all retry attempts
- All keyword data includes monthly search volume, competition metrics, and bid estimates
- Bid prices are provided in both micros (Google Ads format) and USD
