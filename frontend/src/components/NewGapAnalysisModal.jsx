import { useState, useEffect } from 'react'
import API_BASE from '../config'
import CostEstimateBox, { estimateFilterCost } from './CostEstimateBox'

const SEARCH_VOLUME_TYPES = new Set(['google_ads_keywords', 'google_ads_keyword_planner'])

const TYPE_LABELS = {
  google_ads_account_keywords: 'Account Keywords',
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
  const [useIntentNormalization, setUseIntentNormalization] = useState(false)
  const [filterIds, setFilterIds] = useState([])
  const [filters, setFilters] = useState([])

  // step: 'form' | 'confirm'
  const [step, setStep] = useState('form')
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
  const showSearchVolume = sourceMode === 'group'
    ? !!sourceId
    : (sourceDataset && SEARCH_VOLUME_TYPES.has(sourceDataset.type))

  const toggleFilter = (id) => {
    setFilterIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleEstimate = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    if (!sourceId) { setError('Select a source dataset or group'); return }
    if (!targetId) { setError('Select a target dataset or group'); return }

    setEstimating(true)
    try {
      const res = await fetch(`${API_BASE}/api/gap-analyses/estimate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_dataset_id: sourceId,
          source_is_group: sourceMode === 'group',
          min_monthly_searches: showSearchVolume ? minSearches : 0,
          use_intent_normalization: useIntentNormalization,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to get estimate')
      }
      setEstimate(await res.json())
      setStep('confirm')
    } catch (err) {
      setError(err.message)
    } finally {
      setEstimating(false)
    }
  }

  const handleConfirm = async () => {
    setSubmitting(true)
    setError('')
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
          use_intent_normalization: useIntentNormalization,
          filter_ids: filterIds,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to create analysis')
      }
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (estimating || submitting) return
    onClose()
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

  // For the confirm step
  const selectedFilters = filters.filter(f => filterIds.includes(f.filter_id))
  const filterCosts = estimate
    ? selectedFilters.map(f => estimateFilterCost(f, estimate.unique_items))
    : []

  const sourceLabel = sourceMode === 'dataset'
    ? (datasets.find(d => d.dataset_id === sourceId)?.name ?? sourceId)
    : (groups.find(g => g.group_id === sourceId)?.name ?? sourceId)
  const targetLabel = targetMode === 'dataset'
    ? (datasets.find(d => d.dataset_id === targetId)?.name ?? targetId)
    : (groups.find(g => g.group_id === targetId)?.name ?? targetId)

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">New Gap Analysis</h2>
          <button onClick={handleClose} disabled={estimating || submitting} className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── STEP: FORM ── */}
        {step === 'form' && (
          <form onSubmit={handleEstimate} className="px-6 py-5 space-y-4">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="e.g. Q1 Search Terms vs Ad Copy"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={estimating}
              />
            </div>

            {/* Source */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
              <p className="text-xs text-gray-400 mb-2">The universe to search for gaps</p>
              <ModeToggle mode={sourceMode} setMode={setSourceMode} setId={setSourceId} />
              {sourceMode === 'dataset' ? (
                <select
                  value={sourceId}
                  onChange={e => setSourceId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={estimating}
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
                  disabled={estimating}
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
                  disabled={estimating}
                />
                <p className="text-xs text-gray-400 mt-1">
                  Only keywords with ≥ this many monthly searches will be analyzed. Higher values reduce cost.
                </p>
              </div>
            )}

            {/* Target */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Target</label>
              <p className="text-xs text-gray-400 mb-2">The existing coverage to compare against</p>
              <ModeToggle mode={targetMode} setMode={setTargetMode} setId={setTargetId} />
              {targetMode === 'dataset' ? (
                <select
                  value={targetId}
                  onChange={e => setTargetId(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  disabled={estimating}
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
                  disabled={estimating}
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

            {/* Intent Normalization toggle */}
            <div className="py-2 border-t border-gray-100">
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="intent-norm"
                  checked={useIntentNormalization}
                  onChange={e => setUseIntentNormalization(e.target.checked)}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                  disabled={estimating}
                />
                <label htmlFor="intent-norm" className="text-sm font-medium text-gray-700 cursor-pointer">
                  Intent Normalization
                </label>
              </div>
              <p className="text-xs text-gray-400 mt-1 ml-7">
                Use an LLM to convert each item into a normalized intent statement before comparison. Improves cross-format matching (e.g. keywords vs ad copy) but adds LLM cost.
              </p>
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
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                        disabled={estimating}
                      />
                      <span className="text-sm text-gray-800">{f.name}</span>
                      <span className="text-xs text-gray-400 ml-auto font-mono">{f.label}</span>
                    </label>
                  ))}
                </div>
                {filterIds.length > 0 && (
                  <p className="text-xs text-indigo-600 mt-1">
                    {filterIds.length} filter{filterIds.length > 1 ? 's' : ''} will run automatically after the analysis completes.
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={handleClose}
                disabled={estimating}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={estimating || !sourceId || !targetId}
                className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {estimating ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Estimating…
                  </span>
                ) : (
                  'Estimate Cost →'
                )}
              </button>
            </div>
          </form>
        )}

        {/* ── STEP: CONFIRM ── */}
        {step === 'confirm' && estimate && (
          <div className="px-6 py-5 space-y-4">
            {/* Summary */}
            <div className="space-y-1 text-sm text-gray-700">
              <p><span className="font-medium">Name:</span> {name.trim()}</p>
              <p><span className="font-medium">Source:</span> {sourceLabel} ({sourceMode})</p>
              <p><span className="font-medium">Target:</span> {targetLabel} ({targetMode})</p>
              {showSearchVolume && (
                <p><span className="font-medium">Min. monthly searches:</span> ≥ {Number(minSearches).toLocaleString()}</p>
              )}
              {filterIds.length > 0 && (
                <p><span className="font-medium">Filters:</span> {filterIds.length} will run after</p>
              )}
            </div>

            {/* Cost estimate box */}
            <CostEstimateBox
              uniqueKeywords={estimate.unique_items}
              analysisBreakdown={{
                llm_cost: estimate.estimated_llm_cost_usd,
                embedding_cost: estimate.estimated_embedding_cost_usd,
                subtotal: estimate.estimated_cost_usd,
              }}
              selectedFilters={selectedFilters}
              filterCosts={filterCosts}
            />

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => { setStep('form'); setEstimate(null); setError('') }}
                disabled={submitting}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg disabled:opacity-50"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Starting…
                  </span>
                ) : (
                  'Confirm & Run Analysis'
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
