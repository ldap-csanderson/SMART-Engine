"""Google Drive OAuth endpoints.

Flow:
  1. GET /api/auth/google-drive/start
       → generates auth URL with PKCE + state
       → stores {code_verifier, expires_at} in Firestore _oauth_state_drive/{state}
       → returns {auth_url, state}

  2. User visits auth_url, authorizes Drive on Google.
       → Google redirects to /api/auth/google-drive/callback?code=...&state=...

  3. GET /api/auth/google-drive/callback
       → validates state
       → exchanges code + code_verifier for Drive tokens
       → persists refresh_token to Firestore settings/drive_oauth
       → redirects popup to /oauth/callback?result=success&flow=drive

  4. Frontend sees success, closes popup, shows Drive as connected.

Required setup:
  - Add `https://{SERVICE_URL}/api/auth/google-drive/callback` as an Authorized
    Redirect URI in the same Google Cloud OAuth client used for Google Ads.
  - Drive API must be enabled in the GCP project.
  - The same client_id/client_secret from google-ads.yaml are reused.
"""

import base64
import hashlib
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode

import requests as http_requests
from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse

from db import ga_auth_manager, db, config, PROJECT_ID, DRIVE_REDIRECT_URI

drive_router = APIRouter(prefix="/auth/google-drive", tags=["auth"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_TOKEN_INFO_URL = "https://oauth2.googleapis.com/tokeninfo"
_DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
_STATE_TTL_MINUTES = 10
_STATE_COLLECTION = "_oauth_state_drive"
_DRIVE_SETTINGS_DOC = "drive_oauth"

# Drive redirect URI is derived from CLOUD_RUN_URL env var set by deploy.sh.
# See db.py DRIVE_REDIRECT_URI for the resolution order.
_DRIVE_REDIRECT_URI = DRIVE_REDIRECT_URI


# ---------------------------------------------------------------------------
# PKCE helpers
# ---------------------------------------------------------------------------

def _pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


# ---------------------------------------------------------------------------
# Drive token helpers
# ---------------------------------------------------------------------------

def _get_drive_access_token() -> str | None:
    """Return a valid Drive access_token, refreshing if necessary.

    Reads refresh_token from Firestore settings/drive_oauth and exchanges it
    for a fresh access_token using the same client credentials as Google Ads.
    Returns None if Drive is not connected or refresh fails.
    """
    if not db or not ga_auth_manager:
        return None
    try:
        doc = db.collection("settings").document(_DRIVE_SETTINGS_DOC).get()
        if not doc.exists:
            return None
        d = doc.to_dict()
        refresh_token = d.get("refresh_token")
        if not refresh_token:
            return None

        current_config = ga_auth_manager.get_config()
        client_id = current_config.get("client_id")
        client_secret = current_config.get("client_secret")
        if not client_id or not client_secret:
            return None

        resp = http_requests.post(
            _GOOGLE_TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("access_token")
    except Exception as e:
        print(f"⚠️ Could not get Drive access token: {e}")
        return None


def list_drive_folder_images(folder_id: str) -> list[dict]:
    """List image files in a Google Drive folder.

    Returns a list of dicts with {id, name, mimeType, webContentLink}.
    Only image/* MIME types are returned.
    Handles pagination automatically.
    """
    access_token = _get_drive_access_token()
    if not access_token:
        raise RuntimeError("Google Drive not connected — authorize via Settings")

    image_files = []
    page_token = None
    while True:
        params = {
            "q": f"'{folder_id}' in parents and mimeType contains 'image/' and trashed = false",
            "fields": "nextPageToken,files(id,name,mimeType,webContentLink,size)",
            "pageSize": 1000,
        }
        if page_token:
            params["pageToken"] = page_token

        resp = http_requests.get(
            "https://www.googleapis.com/drive/v3/files",
            headers={"Authorization": f"Bearer {access_token}"},
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        image_files.extend(data.get("files", []))
        page_token = data.get("nextPageToken")
        if not page_token:
            break

    return image_files


def download_drive_file(file_id: str, access_token: str) -> bytes:
    """Download a file from Google Drive by ID."""
    resp = http_requests.get(
        f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.content


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@drive_router.get("/status")
def get_drive_status():
    """Return Google Drive connection status."""
    if not db:
        return {"connected": False, "redirect_uri_configured": bool(_DRIVE_REDIRECT_URI)}
    try:
        doc = db.collection("settings").document(_DRIVE_SETTINGS_DOC).get()
        connected = doc.exists and bool(doc.to_dict().get("refresh_token"))
        return {
            "connected": connected,
            "redirect_uri_configured": bool(_DRIVE_REDIRECT_URI),
            "redirect_uri": _DRIVE_REDIRECT_URI,
        }
    except Exception as e:
        return {"connected": False, "error": str(e)}


@drive_router.get("/start")
def start_drive_oauth():
    """Initiate Google Drive OAuth flow."""
    if not ga_auth_manager:
        return {"error": "Google Ads auth manager not available (need client credentials)", "auth_url": None}
    if not _DRIVE_REDIRECT_URI:
        return {"error": "drive_redirect_uri not configured in config.yaml oauth section", "auth_url": None}

    current_config = ga_auth_manager.get_config()
    client_id = current_config.get("client_id")
    if not client_id:
        return {"error": "client_id not found in google-ads config", "auth_url": None}

    code_verifier, code_challenge = _pkce_pair()
    state = str(uuid.uuid4())

    if db:
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=_STATE_TTL_MINUTES)
        db.collection(_STATE_COLLECTION).document(state).set({
            "code_verifier": code_verifier,
            "expires_at": expires_at,
        })

    params = {
        "client_id": client_id,
        "redirect_uri": _DRIVE_REDIRECT_URI,
        "response_type": "code",
        "scope": _DRIVE_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{_GOOGLE_AUTH_URL}?{urlencode(params)}"
    return {"auth_url": auth_url, "state": state}


@drive_router.get("/callback")
def drive_oauth_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
):
    """Handle OAuth callback from Google for Drive authorization."""
    def _redirect(result: str, reason: str = "") -> RedirectResponse:
        path = f"/oauth/callback?result={result}&flow=drive"
        if reason:
            path += f"&reason={reason}"
        return RedirectResponse(url=path)

    if error:
        return _redirect("error", reason=error)
    if not code or not state:
        return _redirect("error", reason="missing_params")
    if not db:
        return _redirect("error", reason="firestore_unavailable")

    state_ref = db.collection(_STATE_COLLECTION).document(state)
    state_doc = state_ref.get()
    if not state_doc.exists:
        return _redirect("error", reason="invalid_state")

    state_data = state_doc.to_dict()
    expires_at = state_data.get("expires_at")
    if expires_at and datetime.now(timezone.utc) > expires_at:
        state_ref.delete()
        return _redirect("error", reason="state_expired")

    code_verifier = state_data.get("code_verifier", "")
    state_ref.delete()

    if not ga_auth_manager:
        return _redirect("error", reason="auth_manager_unavailable")

    current_config = ga_auth_manager.get_config()
    client_id = current_config.get("client_id")
    client_secret = current_config.get("client_secret")
    if not client_id or not client_secret:
        return _redirect("error", reason="missing_credentials")

    try:
        resp = http_requests.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": _DRIVE_REDIRECT_URI,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
            timeout=15,
        )
        resp.raise_for_status()
        token_data = resp.json()
    except Exception as exc:
        print(f"❌ Drive OAuth token exchange failed: {exc}")
        return _redirect("error", reason="token_exchange_failed")

    refresh_token = token_data.get("refresh_token")
    access_token = token_data.get("access_token")
    if not refresh_token:
        return _redirect("error", reason="no_refresh_token")

    # Persist Drive credentials to Firestore
    db.collection("settings").document(_DRIVE_SETTINGS_DOC).set({
        "refresh_token": refresh_token,
        "access_token": access_token,
        "authorized_at": datetime.now(timezone.utc).isoformat(),
    })

    print("✅ Google Drive authorized successfully")
    return _redirect("success")


@drive_router.delete("/disconnect")
def disconnect_drive():
    """Remove stored Drive credentials."""
    if not db:
        return {"message": "Firestore not available"}
    db.collection("settings").document(_DRIVE_SETTINGS_DOC).delete()
    return {"message": "Google Drive disconnected"}


@drive_router.get("/list-folder")
def list_drive_folder(folder_url: str = Query(..., description="Google Drive folder URL or folder ID")):
    """List image files in a Drive folder. Returns {files: [{id, name, mimeType}]}."""
    # Extract folder ID from URL if needed
    folder_id = folder_url.strip()
    if "drive.google.com" in folder_id:
        import re
        m = re.search(r'/folders/([a-zA-Z0-9_-]+)', folder_id)
        if m:
            folder_id = m.group(1)
        else:
            m = re.search(r'id=([a-zA-Z0-9_-]+)', folder_id)
            if m:
                folder_id = m.group(1)
    try:
        files = list_drive_folder_images(folder_id)
        return {"folder_id": folder_id, "files": files, "count": len(files)}
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(400, str(e))
