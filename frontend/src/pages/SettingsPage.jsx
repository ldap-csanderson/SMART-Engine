import { useState, useEffect, useCallback } from 'react'
import API_BASE from '../config'

function StatusDot({ connected }) {
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full mr-2 ${
        connected ? 'bg-green-500' : 'bg-red-400'
      }`}
    />
  )
}

function ServiceRow({ label, connected, loading }) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-700">{label}</span>
      {loading ? (
        <span className="text-xs text-gray-400">Checking…</span>
      ) : (
        <span className={`text-sm font-medium ${connected ? 'text-green-600' : 'text-red-500'}`}>
          <StatusDot connected={connected} />
          {connected ? 'Connected' : 'Disconnected'}
        </span>
      )}
    </div>
  )
}

export default function SettingsPage() {
  const [health, setHealth] = useState(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [reauthorizing, setReauthorizing] = useState(false)
  const [message, setMessage] = useState(null) // {type: 'success'|'error', text: string}

  // Read query params for OAuth result (set by OAuthCallbackPage via postMessage)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('oauth')
    if (result === 'success') {
      setMessage({ type: 'success', text: 'Google Ads reconnected successfully.' })
      // Clean up URL
      window.history.replaceState({}, '', '/settings')
    } else if (result === 'error') {
      const reason = params.get('reason') || 'unknown error'
      setMessage({ type: 'error', text: `Re-authorization failed: ${reason}` })
      window.history.replaceState({}, '', '/settings')
    }
  }, [])

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/health`)
      const data = await res.json()
      setHealth(data)
    } catch {
      setHealth(null)
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
  }, [fetchHealth])

  // Listen for postMessage from the OAuth popup window
  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'oauth_complete') {
        setReauthorizing(false)
        if (event.data.result === 'success') {
          setMessage({ type: 'success', text: 'Google Ads reconnected successfully.' })
          fetchHealth()
        } else {
          const reason = event.data.reason || 'unknown error'
          setMessage({ type: 'error', text: `Re-authorization failed: ${reason}` })
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [fetchHealth])

  const handleReauthorize = async () => {
    setMessage(null)
    setReauthorizing(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/google-ads/start`)
      const data = await res.json()
      if (!data.auth_url) {
        setMessage({ type: 'error', text: data.error || 'Failed to generate authorization URL.' })
        setReauthorizing(false)
        return
      }
      // Open Google consent screen in a popup
      const popup = window.open(
        data.auth_url,
        'google-ads-oauth',
        'width=600,height=700,left=200,top=100'
      )
      if (!popup) {
        setMessage({ type: 'error', text: 'Popup blocked — please allow popups for this site.' })
        setReauthorizing(false)
        return
      }
      // Fallback: detect popup closed without postMessage
      const pollClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(pollClosed)
          if (reauthorizing) {
            setReauthorizing(false)
            fetchHealth()
          }
        }
      }, 1000)
    } catch {
      setMessage({ type: 'error', text: 'Network error starting OAuth flow.' })
      setReauthorizing(false)
    }
  }

  const connected = health?.google_ads_connected

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Settings</h1>

      {/* Connection Status Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mb-6">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Service Connections</h2>
        </div>
        <div className="px-6 py-2">
          <ServiceRow label="Google Ads API" connected={health?.google_ads_connected} loading={healthLoading} />
          <ServiceRow label="BigQuery" connected={health?.bigquery_connected} loading={healthLoading} />
          <ServiceRow label="Firestore" connected={health?.firestore_connected} loading={healthLoading} />
        </div>
      </div>

      {/* Google Ads Re-authorization Card */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Google Ads Authorization</h2>
          <p className="text-sm text-gray-500 mt-1">
            If Google Ads is disconnected (expired or revoked OAuth token), re-authorize here.
            The new token is stored in Secret Manager and takes effect immediately — no restart required.
          </p>
        </div>
        <div className="px-6 py-5">
          {message && (
            <div
              className={`mb-4 px-4 py-3 rounded-lg text-sm ${
                message.type === 'success'
                  ? 'bg-green-50 text-green-700 border border-green-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {message.text}
            </div>
          )}

          <div className="flex items-center gap-4">
            <button
              onClick={handleReauthorize}
              disabled={reauthorizing || healthLoading}
              className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {reauthorizing ? 'Authorizing…' : connected ? 'Re-authorize Google Ads' : 'Authorize Google Ads'}
            </button>
            <button
              onClick={fetchHealth}
              disabled={healthLoading}
              className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
            >
              Refresh status
            </button>
          </div>

          {!healthLoading && !connected && (
            <p className="mt-3 text-xs text-gray-400">
              Google Ads datasets (search terms, ad copy, keyword planner) will not work until authorized.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
