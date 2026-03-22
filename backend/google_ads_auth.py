"""Google Ads OAuth refresh token handler."""
import os
import requests
import yaml
from typing import Optional
from google.ads.googleads.client import GoogleAdsClient


class GoogleAdsAuthManager:
    """Manages Google Ads OAuth token refresh."""
    
    def __init__(self, config_path: str):
        self.config_path = config_path
        self._client: Optional[GoogleAdsClient] = None
        self._load_client()
    
    def _load_client(self) -> None:
        """Load or reload the Google Ads client."""
        try:
            self._client = GoogleAdsClient.load_from_storage(self.config_path)
            print(f"✅ Google Ads client loaded from {self.config_path}")
        except Exception as e:
            print(f"❌ Failed to load Google Ads client: {e}")
            self._client = None
    
    @property
    def client(self) -> Optional[GoogleAdsClient]:
        """Get the current client instance."""
        return self._client
    
    def refresh_access_token(self) -> bool:
        """
        Refresh the access token using the refresh token from the config file.
        Returns True if successful, False otherwise.
        """
        try:
            # Read the current config file
            with open(self.config_path, 'r') as f:
                config = yaml.safe_load(f)
            
            # Extract OAuth credentials
            client_id = config.get('client_id')
            client_secret = config.get('client_secret')
            refresh_token = config.get('refresh_token')
            
            if not all([client_id, client_secret, refresh_token]):
                print("❌ Missing OAuth credentials in config file")
                return False
            
            # Make request to Google OAuth token endpoint
            token_url = 'https://oauth2.googleapis.com/token'
            data = {
                'client_id': client_id,
                'client_secret': client_secret,
                'refresh_token': refresh_token,
                'grant_type': 'refresh_token'
            }
            
            response = requests.post(token_url, data=data)
            response.raise_for_status()
            
            token_data = response.json()
            new_access_token = token_data.get('access_token')
            
            if not new_access_token:
                print("❌ No access token in refresh response")
                return False
            
            # Update the config file with new access token
            config['access_token'] = new_access_token
            
            with open(self.config_path, 'w') as f:
                yaml.safe_dump(config, f, default_flow_style=False)
            
            print("✅ Access token refreshed successfully")
            
            # Reload the client with the new token
            self._load_client()
            
            return True
            
        except requests.exceptions.RequestException as e:
            print(f"❌ Failed to refresh token - HTTP error: {e}")
            return False
        except Exception as e:
            print(f"❌ Failed to refresh token: {e}")
            return False
    
    def handle_auth_error(self) -> bool:
        """
        Handle authentication errors by refreshing the token.
        Returns True if token was refreshed successfully, False otherwise.
        """
        print("⚠️  Authentication error detected - attempting token refresh...")
        return self.refresh_access_token()
