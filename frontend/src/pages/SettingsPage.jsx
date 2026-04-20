import { useState, useEffect, useCallback } from 'react'
import API_BASE from '../config'

// ---------------------------------------------------------------------------
// Service connection helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Prompt config
// ---------------------------------------------------------------------------

const PROMPT_TABS = [
  { key: 'google_ads_keywords_intent_prompt',         label: 'Keyword Planner (URL)' },
  { key: 'google_ads_keyword_planner_intent_prompt',  label: 'Keyword Planner (Account)' },
  { key: 'google_ads_search_terms_intent_prompt',     label: 'Search Terms' },
  { key: 'google_ads_ad_copy_intent_prompt',          label: 'Ad Copy' },
  { key: 'text_list_intent_prompt',                   label: 'Text List' },
]

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  // --- service connections ---
  const [health, setHealth] = useState(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [reauthorizing, setReauthorizing] = useState(false)
  const [authMessage, setAuthMessage] = useState(null)

  // --- prompts ---
  const [defaults, setDefaults] = useState(null)
  const [saved, setSaved] = useState(null)       // last-saved values from API
  const [edited, setEdited] = useState({})       // local edits (field -> string)
  const [activeTab, setActiveTab] = useState(PROMPT_TABS[0].key)
  const [promptsLoading, setPromptsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [promptMessage, setPromptMessage] = useState(null)

  // --------------------------------------------------------------------------
  // Health / OAuth
  // --------------------------------------------------------------------------

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const result = params.get('oauth')
    if (result === 'success') {
      setAuthMessage({ type: 'success', text: 'Google Ads reconnected successfully.' })
      window.history.replaceState({}, '', '/settings')
    } else if (result === 'error') {
      const reason = params.get('reason') || 'unknown error'
      setAuthMessage({ type: 'error', text: `Re-authorization failed: ${reason}` })
      window.history.replaceState({}, '', '/settings')
    }
  }, [])

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/health`)
      setHealth(await res.json())
    } catch {
      setHealth(null)
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useEffect(() => { fetchHealth() }, [fetchHealth])

  useEffect(() => {
    const handler = (event) => {
      if (event.data?.type === 'oauth_complete') {
        setReauthorizing(false)
        if (event.data.result === 'success') {
          setAuthMessage({ type: 'success', text: 'Google Ads reconnected successfully.' })
          fetchHealth()
        } else {
          const reason = event.data.reason || 'unknown error'
          setAuthMessage({ type: 'error', text: `Re-authorization failed: ${reason}` })
        }
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [fetchHealth])

  const handleReauthorize = async () => {
    setAuthMessage(null)
    setReauthorizing(true)
    try {
      const res = await fetch(`${API_BASE}/api/auth/google-ads/start`)
      const data = await res.json()
      if (!data.auth_url) {
        setAuthMessage({ type: 'error', text: data.error || 'Failed to generate authorization URL.' })
        setReauthorizing(false)
        return
      }
      const popup = window.open(data.auth_url, 'google-ads-oauth', 'width=600,height=700,left=200,top=100')
      if (!popup) {
        setAuthMessage({ type: 'error', text: 'Popup blocked — please allow popups for this site.' })
        setReauthorizing(false)
        return
      }
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
      setAuthMessage({ type: 'error', text: 'Network error starting OAuth flow.' })
      setReauthorizing(false)
    }
  }

  // --------------------------------------------------------------------------
  // Prompts
  // --------------------------------------------------------------------------

  const fetchPrompts = useCallback(async () => {
    setPromptsLoading(true)
    try {
      const [currentRes, defaultsRes] = await Promise.all([
        fetch(`${API_BASE}/api/settings/prompts`),
        fetch(`${API_BASE}/api/settings/prompts-defaults`),
      ])
      const current = await currentRes.json()
      const defs = await defaultsRes.json()
      setSaved(current)
      setDefaults(defs)
      // Initialise local edits to the current saved values
      const initial = {}
      PROMPT_TABS.forEach(({ key }) => { initial[key] = current[key] ?? '' })
      setEdited(initial)
    } catch {
      setPromptMessage({ type: 'error', text: 'Failed to load prompts.' })
    } finally {
      setPromptsLoading(false)
    }
  }, [])

  useEffect(() => { fetchPrompts() }, [fetchPrompts])

  const isDirty = saved && PROMPT_TABS.some(({ key }) => edited[key] !== saved[key])

  const handleTabChange = (key) => {
    setActiveTab(key)
    setPromptMessage(null)
  }

  const handleResetOne = () => {
    if (!defaults) return
    setEdited(prev => ({ ...prev, [activeTab]: defaults[activeTab] }))
    setPromptMessage(null)
  }

  const handleResetAll = () => {
    if (!defaults) return
    const reset = {}
    PROMPT_TABS.forEach(({ key }) => { reset[key] = defaults[key] })
    setEdited(reset)
    setPromptMessage(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setPromptMessage(null)
    try {
      const res = await fetch(`${API_BASE}/api/settings/prompts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(edited),
      })
      if (!res.ok) {
        const err = await res.json()
        setPromptMessage({ type: 'error', text: err.detail || 'Failed to save prompts.' })
        return
      }
      const data = await res.json()
      setSaved(data)
      const newEdited = {}
      PROMPT_TABS.forEach(({ key }) => { newEdited[key] = data[key] ?? '' })
      setEdited(newEdited)
      setPromptMessage({ type: 'success', text: 'Prompts saved successfully.' })
    } catch {
      setPromptMessage({ type: 'error', text: 'Network error saving prompts.' })
    } finally {
      setSaving(false)
    }
  }

  const connected = health?.google_ads_connected

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="text-2xl font-semibold text-gray-900 mb-6">Settings</h1>

      {/* ── Service Connections ────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mb-6">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Service Connections</h2>
        </div>
        <div className="px-6 py-2">
          <ServiceRow label="Google Ads API" connected={health?.google_ads_connected} loading={healthLoading} />
          <ServiceRow label="BigQuery"        connected={health?.bigquery_connected}   loading={healthLoading} />
          <ServiceRow label="Firestore"       connected={health?.firestore_connected}  loading={healthLoading} />
        </div>
      </div>

      {/* ── Google Ads Authorization ───────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mb-6">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Google Ads Authorization</h2>
          <p className="text-sm text-gray-500 mt-1">
            If Google Ads is disconnected (expired or revoked OAuth token), re-authorize here.
            The new token is stored in Secret Manager and takes effect immediately — no restart required.
          </p>
        </div>
        <div className="px-6 py-5">
          {authMessage && (
            <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
              authMessage.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {authMessage.text}
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

      {/* ── Intent Normalization Prompts ───────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Intent Normalization Prompts</h2>
          <p className="text-sm text-gray-500 mt-1">
            These prompts instruct the LLM how to convert each dataset item into a normalized intent string
            (e.g. "I am a consumer looking for X") before embedding and semantic comparison.
            Changes apply to the next gap analysis run — existing results are not affected.
          </p>
        </div>

        {promptsLoading ? (
          <div className="px-6 py-8 text-sm text-gray-400">Loading prompts…</div>
        ) : (
          <>
            {/* Tab bar */}
            <div className="border-b border-gray-100 px-6 pt-4 flex gap-1 flex-wrap">
              {PROMPT_TABS.map(({ key, label }) => {
                const dirty = saved && edited[key] !== saved[key]
                return (
                  <button
                    key={key}
                    onClick={() => handleTabChange(key)}
                    className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                      activeTab === key
                        ? 'border-indigo-600 text-indigo-700 bg-indigo-50'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                    {dirty && (
                      <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 align-middle" />
                    )}
                  </button>
                )
              })}
            </div>

            {/* Active prompt editor */}
            <div className="px-6 py-5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                  {PROMPT_TABS.find(t => t.key === activeTab)?.label} Prompt
                </label>
                <button
                  type="button"
                  onClick={handleResetOne}
                  className="text-xs text-indigo-600 hover:text-indigo-800"
                >
                  Reset to default
                </button>
              </div>
              <textarea
                value={edited[activeTab] ?? ''}
                onChange={e => setEdited(prev => ({ ...prev, [activeTab]: e.target.value }))}
                rows={10}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
              />
              <p className="mt-1 text-xs text-gray-400">
                The suffix <code className="bg-gray-100 px-1 rounded">{'\\n\\nKeyword: {item}\\n\\nReturn ONLY raw JSON...'}</code> is appended automatically at runtime.
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 pb-5 flex items-center gap-4 flex-wrap">
              {promptMessage && (
                <div className={`px-4 py-2 rounded-lg text-sm flex-1 ${
                  promptMessage.type === 'success'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {promptMessage.text}
                </div>
              )}
              <div className="ml-auto flex items-center gap-3">
                {isDirty && (
                  <button
                    type="button"
                    onClick={handleResetAll}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Reset all to defaults
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !isDirty}
                  className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>

            {saved?.updated_at && (
              <div className="px-6 pb-4 text-xs text-gray-400">
                Last saved: {new Date(saved.updated_at).toLocaleString()}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
