import { useState, useEffect } from 'react'
import API_BASE from '../config'

const TYPES = [
  { value: 'google_ads_account_keywords', label: 'Account Keywords', needsAds: true },
  { value: 'google_ads_search_terms', label: 'Search Terms Report', needsAds: true },
  { value: 'google_ads_ad_copy', label: 'Ad Copy', needsAds: true },
  { value: 'google_ads_keywords', label: 'Keyword Planner (URL-seeded)', needsAds: true },
  { value: 'google_ads_keyword_planner', label: 'Keyword Planner (Account-level)', needsAds: true },
  { value: 'text_list', label: 'Text List (manual)', needsAds: false },
]

export default function NewDatasetModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [type, setType] = useState('text_list')
  const [urls, setUrls] = useState('')
  const [textItems, setTextItems] = useState('')
  const [accounts, setAccounts] = useState([])
  const [selectedAccounts, setSelectedAccounts] = useState([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [dateRangeDays, setDateRangeDays] = useState(90)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const selectedType = TYPES.find(t => t.value === type)
  const needsAccountPicker = selectedType?.needsAds && type !== 'google_ads_keywords'
  const needsUrls = type === 'google_ads_keywords'
  const needsTextList = type === 'text_list'
  const needsDateRange = type === 'google_ads_search_terms'

  useEffect(() => {
    if (needsAccountPicker) {
      setAccountsLoading(true)
      fetch(`${API_BASE}/api/datasets/accounts`)
        .then(r => r.json())
        .then(data => {
          setAccounts(data.accounts || [])
          // Default: select all
          setSelectedAccounts((data.accounts || []).map(a => a.account_id))
        })
        .catch(() => setAccounts([]))
        .finally(() => setAccountsLoading(false))
    }
  }, [needsAccountPicker])

  const toggleAccount = (id) => {
    setSelectedAccounts(prev =>
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    )
  }

  const selectAll = () => setSelectedAccounts(accounts.map(a => a.account_id))
  const selectNone = () => setSelectedAccounts([])

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }

    let source_config = {}
    let items = undefined

    if (needsUrls) {
      const urlList = urls.split('\n').map(u => u.trim()).filter(Boolean)
      if (!urlList.length) { setError('At least one URL is required'); return }
      source_config = { urls: urlList }
    } else if (needsAccountPicker) {
      source_config = { account_ids: selectedAccounts }
      if (needsDateRange) source_config.date_range_days = dateRangeDays
    } else if (needsTextList) {
      items = textItems.split('\n').map(i => i.trim()).filter(Boolean)
      if (!items.length) { setError('At least one item is required'); return }
    }

    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/datasets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), type, source_config, items }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.detail || 'Failed to create dataset')
        return
      }
      onCreated()
    } catch (e) {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">New Dataset</h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Q1 Search Terms"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select
              value={type}
              onChange={e => setType(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* URL input */}
          {needsUrls && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">URLs (one per line)</label>
              <textarea
                value={urls}
                onChange={e => setUrls(e.target.value)}
                rows={4}
                placeholder="https://example.com/page1&#10;https://example.com/page2"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* Account picker */}
          {needsAccountPicker && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Accounts</label>
                <div className="flex gap-2 text-xs text-indigo-600">
                  <button type="button" onClick={selectAll} className="hover:underline">Select all</button>
                  <span className="text-gray-300">|</span>
                  <button type="button" onClick={selectNone} className="hover:underline">None</button>
                </div>
              </div>
              {accountsLoading ? (
                <p className="text-sm text-gray-400">Loading accounts…</p>
              ) : accounts.length === 0 ? (
                <p className="text-sm text-gray-400">No accounts found</p>
              ) : (
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto">
                  {accounts.map(acct => (
                    <label key={acct.account_id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedAccounts.includes(acct.account_id)}
                        onChange={() => toggleAccount(acct.account_id)}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-800">{acct.name}</span>
                      <span className="text-xs text-gray-400 ml-auto">{acct.account_id}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Date range for search terms */}
          {needsDateRange && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date Range</label>
              <select
                value={dateRangeDays}
                onChange={e => setDateRangeDays(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value={30}>Last 30 days</option>
                <option value={60}>Last 60 days</option>
                <option value={90}>Last 90 days</option>
                <option value={180}>Last 180 days</option>
              </select>
            </div>
          )}

          {/* Text list */}
          {needsTextList && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Items (one per line)</label>
              <textarea
                value={textItems}
                onChange={e => setTextItems(e.target.value)}
                rows={6}
                placeholder="car insurance&#10;auto coverage&#10;vehicle protection"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || accountsLoading}
              className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : accountsLoading ? 'Loading accounts…' : 'Create Dataset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
