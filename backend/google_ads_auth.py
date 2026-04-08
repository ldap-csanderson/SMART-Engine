"""Google Ads OAuth refresh token handler."""
import requests
import yaml
from typing import Optional
from google.ads.googleads.client import GoogleAdsClient


class GoogleAdsAuthManager:
    """Manages Google Ads OAuth token refresh."""

    def __init__(self, config_path: str):
        self.config_path = config_path
        self._client: Optional[GoogleAdsClient] = None
        self._config: dict = {}
        self._load_client()

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _is_auth_error(self, error_msg: str) -> bool:
        return any(s in error_msg for s in (
            "invalid_grant",
            "Token has been expired or revoked",
            "UNAUTHENTICATED",
            "401",
            "Request had invalid authentication credentials",
        ))

    def _read_config(self) -> dict:
        with open(self.config_path, 'r') as f:
            return yaml.safe_load(f)

    def _do_token_refresh(self) -> bool:
        """
        Exchange the refresh_token for a new access_token.
        Updates self._config in memory (does NOT write back to the file,
        since /secrets is a read-only Secret Manager mount).
        Returns True on success.
        """
        try:
            config = self._read_config()

            client_id = config.get('client_id')
            client_secret = config.get('client_secret')
            refresh_token = config.get('refresh_token')

            if not all([client_id, client_secret, refresh_token]):
                print("❌ Missing OAuth credentials in config — cannot refresh")
                return False

            response = requests.post(
                'https://oauth2.googleapis.com/token',
                data={
                    'client_id': client_id,
                    'client_secret': client_secret,
                    'refresh_token': refresh_token,
                    'grant_type': 'refresh_token',
                },
                timeout=10,
            )
            response.raise_for_status()

            new_access_token = response.json().get('access_token')
            if not new_access_token:
                print("❌ No access_token in refresh response")
                return False

            # Update in memory only — /secrets is read-only
            config['access_token'] = new_access_token
            self._config = config
            print("✅ Access token refreshed successfully (in-memory)")
            return True

        except Exception as e:
            print(f"❌ Token refresh failed: {e}")
            return False

    def _load_client(self, after_refresh: bool = False) -> None:
        """
        Load (or reload) the Google Ads client.

        If after_refresh=True, load from self._config (in-memory dict with
        fresh access_token) rather than from the file, since the file is
        read-only on Cloud Run.
        """
        try:
            if after_refresh and self._config:
                self._client = GoogleAdsClient.load_from_dict(self._config)
            else:
                self._client = GoogleAdsClient.load_from_storage(self.config_path)
            print(f"✅ Google Ads client loaded")
        except Exception as e:
            if self._is_auth_error(str(e)) and not after_refresh:
                print(f"⚠️  Access token expired at startup — refreshing...")
                if self._do_token_refresh():
                    self._load_client(after_refresh=True)
                    return
            print(f"❌ Failed to load Google Ads client: {e}")
            self._client = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @property
    def client(self) -> Optional[GoogleAdsClient]:
        """Get the current client instance."""
        return self._client

    def refresh_access_token(self) -> bool:
        """
        Refresh the access token and reload the client.
        Returns True if successful, False otherwise.
        """
        if not self._do_token_refresh():
            return False
        self._load_client(after_refresh=True)
        return self._client is not None

    def handle_auth_error(self) -> bool:
        """
        Handle mid-request authentication errors by refreshing the token.
        Returns True if token was refreshed successfully, False otherwise.
        """
        print("⚠️  Authentication error detected — attempting token refresh...")
        return self.refresh_access_token()
