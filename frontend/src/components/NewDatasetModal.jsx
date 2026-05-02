import { useState, useEffect } from 'react'
import API_BASE from '../config'

const TYPES = [
  { value: 'google_ads_account_keywords', label: 'Account Keywords', needsAds: true },
  { value: 'google_ads_search_terms', label: 'Search Terms Report', needsAds: true },
  { value: 'google_ads_ad_copy', label: 'Ad Copy', needsAds: true },
  { value: 'google_ads_keywords', label: 'Keyword Planner (URL-seeded)', needsAds: true },
  { value: 'google_ads_keyword_planner', label: 'Keyword Planner (Account-level)', needsAds: true },
  { value: 'google_ads_landing_pages', label: 'Landing Pages (URLs)', needsAds: true },
  { value: 'text_list', label: 'Text List (manual)', needsAds: false },
  { value: 'image_urls', label: '🖼️ Image URLs', needsAds: false },
  { value: 'image_google_drive', label: '🖼️ Google Drive', needsAds: false },
]

const LP_URL_SOURCES = [
  { value: 'ad_final_urls', label: 'Ad Final URLs' },
  { value: 'ad_mobile_final_urls', label: 'Ad Mobile Final URLs' },
  { value: 'sitelink_urls', label: 'Sitelink Extension URLs' },
  { value: 'keyword_final_urls', label: 'Keyword Final URL Overrides' },
  { value: 'page_feed_urls', label: 'Page Feed URLs' },
  { value: 'landing_page_view_urls', label: 'Landing Page Views (traffic-based)' },
]

const DEFAULT_LP_SOURCES = ['ad_final_urls', 'sitelink_urls', 'keyword_final_urls', 'page_feed_urls', 'landing_page_view_urls']

export default function NewDatasetModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('text_list')
  const [urls, setUrls] = useState('')
  const [imageUrls, setImageUrls] = useState('')
  const [driveFolder, setDriveFolder] = useState('')
  const [textItems, setTextItems] = useState('')
  const [accounts, setAccounts] = useState([])
  const [selectedAccounts, setSelectedAccounts] = useState([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [lpSources, setLpSources] = useState(DEFAULT_LP_SOURCES)
  const [driveConnected, setDriveConnected] = useState(null) // null = loading, true/false
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  const selectedType = TYPES.find(t => t.value === type)
  const needsAds = selectedType?.needsAds ?? false
  const isLpType = type === 'google_ads_landing_pages'
  const isKeywordsUrl = type === 'google_ads_keywords'
  const isTextList = type === 'text_list'
  const isImageUrls = type === 'image_urls'
  const isGoogleDrive = type === 'image_google_drive'

  useEffect(() => {
    if (!needsAds) return
    setAccountsLoading(true)
    fetch(`${API_BASE}/api/datasets/accounts`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.accounts) setAccounts(data.accounts)
      })
      .catch(() => {})
      .finally(() => setAccountsLoading(false))
  }, [needsAds])

  // Check Drive connection status when Drive type is selected
  useEffect(() => {
    if (!isGoogleDrive) return
    setDriveConnected(null)
    fetch(`${API_BASE}/api/auth/google-drive/status`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setDriveConnected(data?.connected ?? false))
      .catch(() => setDriveConnected(false))
  }, [isGoogleDrive])

  const handleConnectDrive = () => {
    fetch(`${API_BASE}/api/auth/google-drive/start`)
      .then(r => r.json())
      .then(data => {
        if (data.auth_url) {
          const popup = window.open(data.auth_url, 'drive-auth', 'width=600,height=700')
          const handler = (e) => {
            if (e.data?.result === 'success' && e.data?.flow === 'drive') {
              setDriveConnected(true)
              window.removeEventListener('message', handler)
            }
          }
          window.addEventListener('message', handler)
        } else {
          setError(data.error || 'Could not start Drive authorization')
        }
      })
      .catch(() => setError('Network error connecting to Google Drive'))
  }

  const toggleAccount = (id) => {
    setSelectedAccounts(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const toggleLpSource = (value) => {
    setLpSources(prev =>
      prev.includes(value) ? prev.filter(x => x !== value) : [...prev, value]
    )
  }

  const handleCreate = async () => {
    if (!name.trim()) { setError('Name is required'); return }
    if (isTextList && !textItems.trim()) { setError('Please enter at least one item'); return }
    if (isKeywordsUrl && !urls.trim()) { setError('Please enter at least one URL'); return }
    if (isLpType && lpSources.length === 0) { setError('Select at least one URL source'); return }
    if (isImageUrls && !imageUrls.trim()) { setError('Please enter at least one image URL'); return }
    if (isGoogleDrive && !driveFolder.trim()) { setError('Please enter a Google Drive folder URL or ID'); return }
    if (isGoogleDrive && !driveConnected) { setError('Please connect Google Drive first'); return }

    setCreating(true)
    setError(null)

    const body = { name: name.trim(), type }

    if (isTextList) {
      body.items = textItems.split('\n').map(s => s.trim()).filter(Boolean)
    } else if (isKeywordsUrl) {
      body.source_config = {
        urls: urls.split('\n').map(s => s.trim()).filter(Boolean),
        account_ids: selectedAccounts,
      }
    } else if (isLpType) {
      body.source_config = {
        sources: lpSources,
        account_ids: selectedAccounts,
      }
    } else if (isImageUrls) {
      body.source_config = {
        urls: imageUrls.split('\n').map(s => s.trim()).filter(Boolean),
      }
    } else if (isGoogleDrive) {
      body.source_config = {
        folder_url: driveFolder.trim(),
      }
    } else if (needsAds) {
      body.source_config = { account_ids: selectedAccounts }
    }

    try {
      const res = await fetch(`${API_BASE}/api/datasets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.detail || 'Failed to create dataset'); return }
      onCreated(data)
      onClose()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">New Dataset</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>

        <div className="px-6 py-5 space-y-5">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. JustAnswer Account Keywords"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
              autoFocus
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <div className="grid grid-cols-2 gap-2">
              {TYPES.map(t => (
                <button
                  key={t.value}
                  onClick={() => setType(t.value)}
                  className={`px-3 py-2 text-xs rounded-lg border text-left transition-colors ${
                    type === t.value
                      ? 'bg-indigo-50 border-indigo-400 text-indigo-700 font-medium'
                      : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* URL input for keyword planner (URL-seeded) */}
          {isKeywordsUrl && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Seed URLs <span className="text-gray-400 font-normal">(one per line)</span></label>
              <textarea
                value={urls}
                onChange={e => setUrls(e.target.value)}
                rows={4}
                placeholder="https://example.com/product&#10;https://example.com/service"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
              />
            </div>
          )}

          {/* LP sources checkboxes */}
          {isLpType && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">URL Sources</label>
              <div className="space-y-2">
                {LP_URL_SOURCES.map(src => (
                  <label key={src.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={lpSources.includes(src.value)}
                      onChange={() => toggleLpSource(src.value)}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-300"
                    />
                    <span className="text-sm text-gray-700">{src.label}</span>
                  </label>
                ))}
              </div>
              {lpSources.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">Select at least one source.</p>
              )}
            </div>
          )}

          {/* Text items */}
          {isTextList && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Items <span className="text-gray-400 font-normal">(one per line)</span></label>
              <textarea
                value={textItems}
                onChange={e => setTextItems(e.target.value)}
                rows={6}
                placeholder="keyword one&#10;keyword two&#10;keyword three"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
              />
            </div>
          )}

          {/* Image URLs input */}
          {isImageUrls && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Image URLs <span className="text-gray-400 font-normal">(one per line)</span></label>
              <textarea
                value={imageUrls}
                onChange={e => setImageUrls(e.target.value)}
                rows={6}
                placeholder="https://example.com/image1.jpg&#10;https://cdn.example.com/photo2.png&#10;https://storage.googleapis.com/bucket/img3.webp"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-y"
              />
              <p className="text-xs text-gray-400 mt-1">
                Supports JPG, PNG, WebP, GIF, SVG, AVIF, and CDN URLs without extensions.
              </p>
            </div>
          )}

          {/* Google Drive input */}
          {isGoogleDrive && (
            <div className="space-y-3">
              {/* Drive connection status */}
              <div className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                driveConnected === null ? 'bg-gray-50 text-gray-400' :
                driveConnected ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'
              }`}>
                <span>
                  {driveConnected === null ? '⏳ Checking Drive connection…' :
                   driveConnected ? '✅ Google Drive connected' : '⚠️ Google Drive not connected'}
                </span>
                {driveConnected === false && (
                  <button
                    type="button"
                    onClick={handleConnectDrive}
                    className="ml-3 px-3 py-1 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700"
                  >
                    Connect Drive
                  </button>
                )}
              </div>

              {/* Folder URL input */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Drive Folder URL or ID
                </label>
                <input
                  type="text"
                  value={driveFolder}
                  onChange={e => setDriveFolder(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/1ABC... or folder ID"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-300"
                />
                <p className="text-xs text-gray-400 mt-1">
                  The folder must be shared as <strong>"Anyone with the link can view"</strong> for images to be accessible.
                </p>
              </div>
            </div>
          )}

          {/* Account selection for Google Ads types */}
          {needsAds && accounts.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Accounts <span className="text-gray-400 font-normal">(leave empty to use all)</span>
              </label>
              <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                {accountsLoading ? (
                  <p className="px-3 py-2 text-xs text-gray-400">Loading accounts…</p>
                ) : (
                  accounts.map(acct => (
                    <label key={acct.account_id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={selectedAccounts.includes(acct.account_id)}
                        onChange={() => toggleAccount(acct.account_id)}
                        className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-300"
                      />
                      <span className="text-sm text-gray-700">{acct.name}</span>
                      <span className="text-xs text-gray-400 ml-auto">{acct.account_id}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}
          {needsAds && !accountsLoading && accounts.length === 0 && (
            <p className="text-xs text-amber-600">Could not load accounts — Google Ads may not be connected. The dataset will use the default account.</p>
          )}

          {error && (
            <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg">Cancel</button>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 transition-colors"
          >
            {creating ? 'Creating…' : 'Create Dataset'}
          </button>
        </div>
      </div>
    </div>
  )
}
