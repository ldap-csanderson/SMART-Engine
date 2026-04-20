import { useState, useEffect } from 'react'
import API_BASE from '../config'

const SEARCH_VOLUME_TYPES = new Set(['google_ads_keywords', 'google_ads_keyword_planner'])

const TYPE_LABELS = {
  google_ads_keywords: 'Keyword Planner (URL)',
  google_ads_ad_copy: 'Ad Copy',
  google_ads_search_terms: 'Search Terms',
  google_ads_keyword_planner: 'Keyword Planner (Account)',
  text_list: 'Text List',
}

export default function NewGapAnalysisModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [datasets, setDatasets] = useState([])
  const [groups, setGroups] = useState([])
  const [sourceMode, setSourceMode] = useState('dataset') // 'dataset' | 'group'
  const [sourceId, setSourceId] = useState('')
  const [targetMode, setTargetMode] = useState('dataset') // 'dataset' | 'group'
  const [targetId, setTargetId] = useState('')
  const [minSearches, setMinSearches] = useState(1000)
  const [filterIds, setFilterIds] = useState([])
  const [filters, setFilters] = useState([])
  const [estimate, setEstimate] = useState(null)
  const [estimating, setEstimating] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/datasets`).then(r => r.json()),
      fetch(`${API_BASE}/api/dataset-groups`).then(r => r.json()),
      fetch(`${API_BASE}/api/filters`).then(r => r.json()),
    ]).then(([dsData, grpData, fData]) => {
      const completedDs = (dsData.datasets || []).filter(d => d.status === 'completed')
      setDatasets(completedDs)
      setGroups(grpData.groups || [])
      setFilters(fData.filters || [])
    }).catch(console.error)
  }, [])

  const sourceDataset = sourceMode === 'dataset' ? datasets.find(d => d.dataset_id === sourceId) : null
  // Show min searches if source is a single keyword dataset, or always when source is a group
  // (group may contain keyword datasets; backend handles the filter appropriately)
  const showSearchVolume = sourceMode === 'group'
    ? !!sourceId
    : (sourceDataset && SEARCH_VOLUME_TYPES.has(sourceDataset.type))

  // Fetch cost estimate when source + min_searches changes
  useEffect(() => {
    if (!sourceId) { setEstimate(null); return }
    const timer = setTimeout(async () => {
      setEstimating(true)
      try {
        const res = await fetch(`${API_BASE}/api/gap-analyses/estimate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            source_dataset_id: sourceId,
            source_is_group: sourceMode === 'group',
            min_monthly_searches: showSearchVolume ? minSearches : 0,
          }),
        })
        if (res.ok) setEstimate(await res.json())
      } catch {}
      finally { setEstimating(false) }
    }, 600)
    return () => clearTimeout(timer)
  }, [sourceId, sourceMode, minSearches, showSearchVolume])

  const toggleFilter = (id) => {
    setFilterIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    if (!sourceId) { setError('Select a source dataset or group'); return }
    if (!targetId) { setError('Select a target dataset or group'); return }

    setSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/api/gap-analyses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          source_dataset_id: sourceId,
          source_is_group: sourceMode === 'group',
          target_dataset_id: targetId,
          target_is_group: targetMode === 'group',
          min_monthly_searches: showSearchVolume ? minSearches : 0,
          filter_ids: filterIds,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        setError(err.detail || 'Failed to create analysis')
        return
      }
      onCreated()
    } catch {
      setError('Network error')
    } finally {
      setSubmitting(false)
    }
  }

  const ModeToggle = ({ mode, setMode, setId }) => (
    <div className="flex gap-2 mb-2">
      <button
        type="button"
        onClick={() => { setMode('dataset'); setId('') }}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
          mode === 'dataset'
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
        }`}
      >
        Dataset
      </button>
      <button
        type="button"
        onClick={() => { setMode('group'); setId('') }}
        className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
          mode === 'group'
            ? 'bg-indigo-600 text-white border-indigo-600'
            : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
        }`}
      >
        Group
      </button>
    </div>
  )

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">New Gap Analysis</h2>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Q1 Search Terms vs Ad Copy"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Source: dataset or group */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
            <p className="text-xs text-gray-400 mb-2">The universe to search for gaps</p>
            <ModeToggle mode={sourceMode} setMode={setSourceMode} setId={setSourceId} />
            {sourceMode === 'dataset' ? (
              <select
                value={sourceId}
                onChange={e => setSourceId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">— Select source dataset —</option>
                {datasets.map(d => (
                  <option key={d.dataset_id} value={d.dataset_id}>
                    {d.name} ({TYPE_LABELS[d.type] || d.type}, {d.item_count.toLocaleString()} items)
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={sourceId}
                onChange={e => setSourceId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">— Select source group —</option>
                {groups.map(g => (
                  <option key={g.group_id} value={g.group_id}>
                    {g.name} ({g.dataset_count} datasets)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Min monthly searches (conditional) */}
          {showSearchVolume && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Min Monthly Searches
                {sourceMode === 'group' && (
                  <span className="text-gray-400 font-normal ml-1">(applies to keyword datasets)</span>
                )}
              </label>
              <input
                type="number"
                value={minSearches}
                onChange={e => setMinSearches(Number(e.target.value))}
                min={0}
                step={100}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* Cost estimate */}
          {sourceId && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              {estimating ? (
                <span>Estimating cost…</span>
              ) : estimate ? (
                <span>
                  ~<strong>{estimate.unique_items.toLocaleString()}</strong> items · estimated cost{' '}
                  <strong>~${estimate.estimated_cost_usd.toFixed(2)}</strong>
                </span>
              ) : (
                <span className="text-amber-500">Could not estimate cost</span>
              )}
            </div>
          )}

          {/* Target: dataset or group */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Target</label>
            <p className="text-xs text-gray-400 mb-2">The existing coverage to compare against</p>
            <ModeToggle mode={targetMode} setMode={setTargetMode} setId={setTargetId} />
            {targetMode === 'dataset' ? (
              <select
                value={targetId}
                onChange={e => setTargetId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">— Select target dataset —</option>
                {datasets.map(d => (
                  <option key={d.dataset_id} value={d.dataset_id}>
                    {d.name} ({TYPE_LABELS[d.type] || d.type}, {d.item_count.toLocaleString()} items)
                  </option>
                ))}
              </select>
            ) : (
              <select
                value={targetId}
                onChange={e => setTargetId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">— Select target group —</option>
                {groups.map(g => (
                  <option key={g.group_id} value={g.group_id}>
                    {g.name} ({g.dataset_count} datasets)
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Filters (optional) */}
          {filters.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Run Filters After Analysis <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-36 overflow-y-auto">
                {filters.map(f => (
                  <label key={f.filter_id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={filterIds.includes(f.filter_id)}
                      onChange={() => toggleFilter(f.filter_id)}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-800">{f.name}</span>
                    <span className="text-xs text-gray-400 ml-auto font-mono">{f.label}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

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
              {submitting ? 'Starting…' : 'Run Analysis'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
