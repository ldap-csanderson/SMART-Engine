"""Google Ads OAuth re-authorization endpoints.

Flow:
  1. GET /api/auth/google-ads/start
       → generates auth URL with PKCE + state
       → stores {code_verifier, expires_at} in Firestore _oauth_state/{state}
       → returns {auth_url, state}

  2. User visits auth_url, authorizes on Google.
       → Google redirects to /api/auth/google-ads/callback?code=...&state=...

  3. GET /api/auth/google-ads/callback
       → validates state (Firestore lookup + TTL check)
       → exchanges code + code_verifier for tokens (PKCE)
       → calls ga_auth_manager.reload_from_credentials(new_config) — live reload
       → calls ga_auth_manager.write_to_secret_manager()           — persists token
       → deletes state from Firestore
       → redirects popup to /oauth/callback?result=success

  4. Frontend OAuthCallbackPage sends window.postMessage to opener and closes.
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

from db import ga_auth_manager, db, config, PROJECT_ID, OAUTH_REDIRECT_URI

router = APIRouter(prefix="/auth/google-ads", tags=["auth"])

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_OAUTH_SCOPE = "https://www.googleapis.com/auth/adwords"
_STATE_TTL_MINUTES = 10
_STATE_COLLECTION = "_oauth_state"

_REDIRECT_URI = OAUTH_REDIRECT_URI
_SECRET_NAME = config.get("secrets", {}).get("google_ads_secret_name", "google-ads-yaml")


# ---------------------------------------------------------------------------
# PKCE helpers
# ---------------------------------------------------------------------------

def _pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) using S256 method."""
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode()
    digest = hashlib.sha256(verifier.encode()).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode()
    return verifier, challenge


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.get("/status")
def get_status():
    """Return current Google Ads connection status."""
    return {
        "connected": ga_auth_manager is not None and ga_auth_manager.client is not None,
        "auth_manager_available": ga_auth_manager is not None,
    }


@router.get("/start")
def start_oauth():
    """Initiate the Google Ads OAuth flow.

    Returns the Google authorization URL. The caller should open it in a
    popup window. After the user authorizes, Google will redirect the popup
    to /api/auth/google-ads/callback which finalizes the flow.
    """
    if not ga_auth_manager:
        return {"error": "Google Ads auth manager not available", "auth_url": None}
    if not _REDIRECT_URI:
        return {"error": "oauth.redirect_uri not configured in config.yaml", "auth_url": None}

    current_config = ga_auth_manager.get_config()
    client_id = current_config.get("client_id")
    if not client_id:
        return {"error": "client_id not found in google-ads config", "auth_url": None}

    # Generate PKCE pair and random state
    code_verifier, code_challenge = _pkce_pair()
    state = str(uuid.uuid4())

    # Persist state + verifier in Firestore with TTL
    if db:
        expires_at = datetime.now(timezone.utc) + timedelta(minutes=_STATE_TTL_MINUTES)
        db.collection(_STATE_COLLECTION).document(state).set({
            "code_verifier": code_verifier,
            "expires_at": expires_at,
        })

    params = {
        "client_id": client_id,
        "redirect_uri": _REDIRECT_URI,
        "response_type": "code",
        "scope": _OAUTH_SCOPE,
        "access_type": "offline",
        "prompt": "consent",   # force refresh_token issuance even if previously granted
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{_GOOGLE_AUTH_URL}?{urlencode(params)}"
    return {"auth_url": auth_url, "state": state}


@router.get("/callback")
def oauth_callback(
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
):
    """Handle OAuth callback from Google.

    Exchanges the authorization code for tokens, updates Secret Manager,
    reloads the GA client in-memory, then redirects the popup to
    /oauth/callback?result=success (or ?result=error&reason=...).
    """
    def _redirect(result: str, reason: str = "") -> RedirectResponse:
        path = f"/oauth/callback?result={result}"
        if reason:
            path += f"&reason={reason}"
        return RedirectResponse(url=path)

    if error:
        print(f"⚠️ OAuth callback received error: {error}")
        return _redirect("error", reason=error)

    if not code or not state:
        return _redirect("error", reason="missing_params")

    # ── Validate state ──────────────────────────────────────────────────────
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
    state_ref.delete()  # consume immediately — single-use

    # ── Load base credentials ───────────────────────────────────────────────
    if not ga_auth_manager:
        return _redirect("error", reason="auth_manager_unavailable")

    current_config = ga_auth_manager.get_config()
    client_id = current_config.get("client_id")
    client_secret = current_config.get("client_secret")
    if not client_id or not client_secret:
        return _redirect("error", reason="missing_credentials")

    # ── Exchange code for tokens ────────────────────────────────────────────
    try:
        resp = http_requests.post(
            _GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": _REDIRECT_URI,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
            timeout=15,
        )
        resp.raise_for_status()
        token_data = resp.json()
    except Exception as exc:
        print(f"❌ OAuth token exchange failed: {exc}")
        return _redirect("error", reason="token_exchange_failed")

    refresh_token = token_data.get("refresh_token")
    access_token = token_data.get("access_token")
    if not refresh_token:
        print("❌ No refresh_token in OAuth response — check 'prompt=consent' and 'access_type=offline'")
        return _redirect("error", reason="no_refresh_token")

    # ── Build updated config ────────────────────────────────────────────────
    new_config = {**current_config, "refresh_token": refresh_token, "access_token": access_token}

    # ── Reload client in-memory (takes effect immediately) ──────────────────
    ga_auth_manager.reload_from_credentials(new_config)

    # ── Persist to Secret Manager (survives restarts) ───────────────────────
    if not ga_auth_manager.write_to_secret_manager(_SECRET_NAME, PROJECT_ID):
        # Client is live but persistence failed — still report success with a warning
        print("⚠️ Client reloaded but Secret Manager write failed — token will reset on restart")

    print("✅ Google Ads re-authorized successfully")
    return _redirect("success")
