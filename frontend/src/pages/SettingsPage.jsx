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
  { key: 'google_ads_account_keywords_intent_prompt', label: 'Account Keywords' },
  { key: 'google_ads_keywords_intent_prompt',         label: 'Keyword Planner (URL)' },
  { key: 'google_ads_keyword_planner_intent_prompt',  label: 'Keyword Planner (Account)' },
  { key: 'google_ads_search_terms_intent_prompt',     label: 'Search Terms' },
  { key: 'google_ads_ad_copy_intent_prompt',          label: 'Ad Copy' },
  { key: 'text_list_intent_prompt',                   label: 'Text List' },
]

const CHAT_PROMPT_TABS = [
  { key: 'google_ads_ad_copy',           label: 'Ad Copy' },
  { key: 'google_ads_account_keywords',  label: 'Account Keywords' },
  { key: 'google_ads_keywords',          label: 'Keyword Planner (URL)' },
  { key: 'google_ads_keyword_planner',   label: 'Keyword Planner (Account)' },
  { key: 'google_ads_search_terms',      label: 'Search Terms' },
  { key: 'google_ads_landing_pages',     label: 'Landing Pages' },
  { key: 'text_list',                    label: 'Text List' },
  { key: 'gap_analysis',                 label: 'Gap Analysis' },
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

  // --- google ads account (CID) ---
  const [cidValue, setCidValue] = useState('')
  const [cidSource, setCidSource] = useState(null)
  const [cidLoading, setCidLoading] = useState(true)
  const [cidSaving, setCidSaving] = useState(false)
  const [cidMessage, setCidMessage] = useState(null)

  // --- agent model ---
  const [agentModel, setAgentModel] = useState('gemini-2.5-flash')
  const [availableModels, setAvailableModels] = useState([])
  const [agentModelSaving, setAgentModelSaving] = useState(false)
  const [agentModelMessage, setAgentModelMessage] = useState(null)

  // --- chat prompts ---
  const [chatDefaults, setChatDefaults] = useState(null)
  const [chatSaved, setChatSaved] = useState(null)
  const [chatEdited, setChatEdited] = useState({})
  const [activeChatTab, setActiveChatTab] = useState('google_ads_ad_copy')
  const [chatPromptsLoading, setChatPromptsLoading] = useState(true)
  const [chatSaving, setChatSaving] = useState(false)
  const [chatPromptMessage, setChatPromptMessage] = useState(null)

  // --- intent prompts ---
  const [defaults, setDefaults] = useState(null)
  const [saved, setSaved] = useState(null)
  const [edited, setEdited] = useState({})
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
  // Google Ads Account (CID)
  // --------------------------------------------------------------------------

  const fetchSettings = useCallback(async () => {
    setCidLoading(true)
    try {
      const res = await fetch(`${API_BASE}/api/settings`)
      if (res.ok) {
        const data = await res.json()
        setCidValue(data.customer_id || '')
        setCidSource(data.customer_id_source || 'config')
      }
    } catch {
      // silently ignore
    } finally {
      setCidLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  // --------------------------------------------------------------------------
  // Agent model
  // --------------------------------------------------------------------------

  useEffect(() => {
    fetch(`${API_BASE}/api/settings/agent`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d) {
          setAgentModel(d.model || 'gemini-2.5-flash')
          setAvailableModels(d.available_models || [])
        }
      })
      .catch(() => {})
  }, [])

  const handleSaveAgentModel = async (model) => {
    setAgentModel(model)
    setAgentModelMessage(null)
    setAgentModelSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/settings/agent`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model }),
      })
      let data = null
      try { data = await res.json() } catch { /* */ }
      if (!res.ok) {
        setAgentModelMessage({ type: 'error', text: data?.detail || 'Failed to save model.' })
      } else {
        setAgentModelMessage({ type: 'success', text: `Model set to ${model}.` })
      }
    } catch {
      setAgentModelMessage({ type: 'error', text: 'Network error.' })
    } finally {
      setAgentModelSaving(false)
    }
  }

  const handleSaveCid = async () => {
    const trimmed = cidValue.trim()
    if (!trimmed) return
    setCidMessage(null)
    setCidSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/settings/google-ads`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_id: trimmed }),
      })
      let data = null
      try { data = await res.json() } catch { /* non-JSON body */ }
      if (!res.ok) {
        setCidMessage({ type: 'error', text: data?.detail || `Server error (${res.status})` })
      } else {
        setCidValue(data.customer_id)
        setCidSource('firestore')
        setCidMessage({ type: 'success', text: 'Customer ID saved successfully.' })
      }
    } catch {
      setCidMessage({ type: 'error', text: 'Network error — could not reach server.' })
    } finally {
      setCidSaving(false)
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

  // --------------------------------------------------------------------------
  // Chat Agent Prompts
  // --------------------------------------------------------------------------

  const fetchChatPrompts = useCallback(async () => {
    setChatPromptsLoading(true)
    try {
      const [currentRes, defaultsRes] = await Promise.all([
        fetch(`${API_BASE}/api/settings/chat-prompts`),
        fetch(`${API_BASE}/api/settings/chat-prompts-defaults`),
      ])
      const current = await currentRes.json()
      const defs = await defaultsRes.json()
      setChatSaved(current)
      setChatDefaults(defs)
      const initial = {}
      CHAT_PROMPT_TABS.forEach(({ key }) => { initial[key] = current[key] ?? '' })
      setChatEdited(initial)
    } catch {
      setChatPromptMessage({ type: 'error', text: 'Failed to load chat prompts.' })
    } finally {
      setChatPromptsLoading(false)
    }
  }, [])

  useEffect(() => { fetchChatPrompts() }, [fetchChatPrompts])

  const isChatDirty = chatSaved && CHAT_PROMPT_TABS.some(({ key }) => chatEdited[key] !== chatSaved[key])

  const handleChatResetOne = () => {
    if (!chatDefaults) return
    setChatEdited(prev => ({ ...prev, [activeChatTab]: chatDefaults[activeChatTab] }))
    setChatPromptMessage(null)
  }

  const handleChatResetAll = () => {
    if (!chatDefaults) return
    const reset = {}
    CHAT_PROMPT_TABS.forEach(({ key }) => { reset[key] = chatDefaults[key] })
    setChatEdited(reset)
    setChatPromptMessage(null)
  }

  const handleChatSave = async () => {
    setChatSaving(true)
    setChatPromptMessage(null)
    try {
      const res = await fetch(`${API_BASE}/api/settings/chat-prompts`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatEdited),
      })
      if (!res.ok) {
        const err = await res.json()
        setChatPromptMessage({ type: 'error', text: err.detail || 'Failed to save.' })
        return
      }
      const data = await res.json()
      setChatSaved(data)
      const newEdited = {}
      CHAT_PROMPT_TABS.forEach(({ key }) => { newEdited[key] = data[key] ?? '' })
      setChatEdited(newEdited)
      setChatPromptMessage({ type: 'success', text: 'Chat prompts saved.' })
    } catch {
      setChatPromptMessage({ type: 'error', text: 'Network error saving chat prompts.' })
    } finally {
      setChatSaving(false)
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

      {/* ── Google Ads Account ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mb-6">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Google Ads Account</h2>
          <p className="text-sm text-gray-500 mt-1">
            Set the top-level Customer ID (MCC or direct account) used for all Google Ads data pulls.
            Accepts plain numeric IDs or formatted IDs (e.g.{' '}
            <code className="font-mono text-xs bg-gray-100 px-1 rounded">291-673-2323</code>).
          </p>
        </div>
        <div className="px-6 py-5">
          {cidMessage && (
            <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
              cidMessage.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {cidMessage.text}
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-500 mb-1">Customer ID</label>
              {cidLoading ? (
                <div className="h-9 bg-gray-100 rounded-lg animate-pulse" />
              ) : (
                <input
                  type="text"
                  value={cidValue}
                  onChange={(e) => { setCidValue(e.target.value); setCidMessage(null) }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveCid()}
                  placeholder="e.g. 1234567890"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
              )}
            </div>
            <div className="pt-5">
              <button
                onClick={handleSaveCid}
                disabled={cidSaving || cidLoading || !cidValue.trim()}
                className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {cidSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
          {!cidLoading && cidSource && (
            <p className="mt-2 text-xs text-gray-400">
              {cidSource === 'firestore'
                ? 'This value is stored in Firestore and overrides the config file default.'
                : 'Using default value from config file. Save a new value to override it.'}
            </p>
          )}
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

      {/* ── Chat Agent Model ───────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mb-6">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Chat Agent Model</h2>
          <p className="text-sm text-gray-500 mt-1">
            Select the Gemini model used by the Analysis Assistant chat panels on dataset and gap analysis pages.
          </p>
        </div>
        <div className="px-6 py-5">
          {agentModelMessage && (
            <div className={`mb-4 px-4 py-3 rounded-lg text-sm ${
              agentModelMessage.type === 'success'
                ? 'bg-green-50 text-green-700 border border-green-200'
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {agentModelMessage.text}
            </div>
          )}
          {availableModels.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {availableModels.map(model => (
                <button
                  key={model}
                  onClick={() => handleSaveAgentModel(model)}
                  disabled={agentModelSaving}
                  className={`px-3 py-2 text-xs rounded-lg border text-left font-mono transition-colors disabled:opacity-50 ${
                    agentModel === model
                      ? 'bg-purple-50 border-purple-400 text-purple-700 font-semibold'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {agentModel === model && <span className="mr-1">✓</span>}
                  {model}
                </button>
              ))}
            </div>
          ) : (
            <div className="h-9 bg-gray-100 rounded-lg animate-pulse w-48" />
          )}
          {agentModel && (
            <p className="mt-2 text-xs text-gray-400">
              Active: <span className="font-mono text-gray-600">{agentModel}</span>
            </p>
          )}
        </div>
      </div>

      {/* ── Chat Agent Prompts ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 mb-6">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Chat Agent Prompts</h2>
          <p className="text-sm text-gray-500 mt-1">
            These prompts tell the Analysis Assistant what kind of data each dataset type contains
            and what to focus on when analyzing or peeking at it. Injected into the system prompt
            for every chat interaction.
          </p>
        </div>

        {chatPromptsLoading ? (
          <div className="px-6 py-8 text-sm text-gray-400">Loading chat prompts…</div>
        ) : (
          <>
            <div className="border-b border-gray-100 px-6 pt-4 flex gap-1 flex-wrap">
              {CHAT_PROMPT_TABS.map(({ key, label }) => {
                const dirty = chatSaved && chatEdited[key] !== chatSaved[key]
                return (
                  <button
                    key={key}
                    onClick={() => { setActiveChatTab(key); setChatPromptMessage(null) }}
                    className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                      activeChatTab === key
                        ? 'border-purple-600 text-purple-700 bg-purple-50'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                    {dirty && <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-400 align-middle" />}
                  </button>
                )
              })}
            </div>

            <div className="px-6 py-5">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">
                  {CHAT_PROMPT_TABS.find(t => t.key === activeChatTab)?.label} — Analysis Context
                </label>
                <button type="button" onClick={handleChatResetOne} className="text-xs text-purple-600 hover:text-purple-800">
                  Reset to default
                </button>
              </div>
              <textarea
                value={chatEdited[activeChatTab] ?? ''}
                onChange={e => setChatEdited(prev => ({ ...prev, [activeChatTab]: e.target.value }))}
                rows={8}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y"
              />
              <p className="mt-1 text-xs text-gray-400">
                Injected as "DATASET TYPE CONTEXT" or "ANALYSIS CONTEXT" in the agent's system prompt.
              </p>
            </div>

            <div className="px-6 pb-5 flex items-center gap-4 flex-wrap">
              {chatPromptMessage && (
                <div className={`px-4 py-2 rounded-lg text-sm flex-1 ${
                  chatPromptMessage.type === 'success'
                    ? 'bg-green-50 text-green-700 border border-green-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}>
                  {chatPromptMessage.text}
                </div>
              )}
              <div className="ml-auto flex items-center gap-3">
                {isChatDirty && (
                  <button type="button" onClick={handleChatResetAll} className="text-sm text-gray-500 hover:text-gray-700">
                    Reset all to defaults
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleChatSave}
                  disabled={chatSaving || !isChatDirty}
                  className="bg-purple-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                >
                  {chatSaving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            </div>

            {chatSaved?.updated_at && (
              <div className="px-6 pb-4 text-xs text-gray-400">
                Last saved: {new Date(chatSaved.updated_at).toLocaleString()}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Intent Normalization Prompts ───────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Intent Normalization Prompts</h2>
          <p className="text-sm text-gray-500 mt-1">
            These prompts instruct the LLM how to convert each dataset item into a normalized intent string
            (e.g. "I am a consumer looking for X") before embedding and semantic comparison.
            Only applies when <span className="font-medium text-gray-700">Intent Normalization</span> is enabled on a gap analysis.
            Changes apply to the next run — existing results are not affected.
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
