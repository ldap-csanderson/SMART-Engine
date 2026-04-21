import { useState, useEffect } from 'react'
import API_BASE from '../config'

const TYPE_LABELS = {
  google_ads_account_keywords: 'Account Keywords',
  google_ads_keywords: 'Keyword Planner (URL)',
  google_ads_ad_copy: 'Ad Copy',
  google_ads_search_terms: 'Search Terms',
  google_ads_keyword_planner: 'Keyword Planner (Account)',
  text_list: 'Text List',
}

export default function NewDatasetGroupModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [datasets, setDatasets] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/api/datasets`)
      .then(r => r.json())
      .then(data => setDatasets((data.datasets || []).filter(d => d.status !== 'archived')))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const toggle = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    if (!selectedIds.length) { setError('Select at least one dataset'); return }

    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/dataset-groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), dataset_ids: selectedIds }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.detail || 'Failed to create group')
        return
      }
      onCreated()
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">New Dataset Group</h2>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. All Ad Copy"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Datasets</label>
            {loading ? (
              <p className="text-sm text-gray-400">Loading datasets…</p>
            ) : datasets.length === 0 ? (
              <p className="text-sm text-gray-400">No datasets available</p>
            ) : (
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
                {datasets.map(ds => (
                  <label key={ds.dataset_id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(ds.dataset_id)}
                      onChange={() => toggle(ds.dataset_id)}
                      className="rounded"
                    />
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full whitespace-nowrap">
                      {TYPE_LABELS[ds.type] || ds.type}
                    </span>
                    <span className="text-sm text-gray-800 truncate">{ds.name}</span>
                    <span className="text-xs text-gray-400 ml-auto shrink-0">{ds.item_count.toLocaleString()}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create Group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
