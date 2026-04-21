import { useState, useEffect } from 'react'
import CostEstimateBox, { estimateFilterCost } from './CostEstimateBox'
import API_BASE from '../config'

export default function RunFiltersModal({
  isOpen,
  onClose,
  onSubmit,
  analysisId,
  existingExecutions,
  keywordCount = 0,
}) {
  const [allFilters, setAllFilters] = useState([])
  const [selectedIds, setSelectedIds] = useState([])
  // step: 'select' | 'confirm'
  const [step, setStep] = useState('select')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    fetch(`${API_BASE}/api/filters`)
      .then((r) => r.json())
      .then((d) => setAllFilters(d.filters || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [isOpen])

  // Filters already run on this analysis (by label + name) — only block processing/completed, not failed
  const activeExecutions = existingExecutions.filter((e) => e.status === 'processing' || e.status === 'completed')
  const usedLabels = new Set(activeExecutions.map((e) => e.filter_snapshot?.label).filter(Boolean))
  const usedNames  = new Set(activeExecutions.map((e) => e.filter_snapshot?.name).filter(Boolean))
  const availableFilters = allFilters.filter(
    (f) => !usedLabels.has(f.label) && !usedNames.has(f.name)
  )

  const toggleFilter = (filterId) => {
    setSelectedIds((prev) =>
      prev.includes(filterId) ? prev.filter((id) => id !== filterId) : [...prev, filterId]
    )
  }

  // Derive selected filter objects + costs (client-side, no API needed)
  const selectedFilters = allFilters.filter((f) => selectedIds.includes(f.filter_id))
  const filterCosts = selectedFilters.map((f) => estimateFilterCost(f, keywordCount))

  const handleEstimate = (e) => {
    e.preventDefault()
    if (selectedIds.length === 0) { setError('Please select at least one filter'); return }
    setError(null)
    setStep('confirm')
  }

  const handleConfirm = async () => {
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/gap-analyses/${analysisId}/filter-executions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filter_ids: selectedIds }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to run filters')
      }
      handleReset()
      onClose()
      if (onSubmit) onSubmit()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleReset = () => {
    setSelectedIds([])
    setError(null)
    setStep('select')
  }

  const handleClose = () => {
    if (submitting) return
    handleReset()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Run Additional Filters</h2>
          <button onClick={handleClose} disabled={submitting} className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── STEP: SELECT ── */}
        {step === 'select' && (
          <form onSubmit={handleEstimate} className="px-6 py-5 space-y-4">
            {loading ? (
              <div className="py-8 text-center text-gray-500 text-sm">Loading filters…</div>
            ) : availableFilters.length === 0 ? (
              <div className="py-8 text-center text-gray-500 text-sm">
                All available filters have already been run on this analysis.
              </div>
            ) : (
              <div>
                <p className="text-sm text-gray-600 mb-3">
                  Select filters to run on this gap analysis:
                </p>
                <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-60 overflow-y-auto">
                  {availableFilters.map((f) => (
                    <label key={f.filter_id} className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        className="rounded text-indigo-600 focus:ring-indigo-500"
                        checked={selectedIds.includes(f.filter_id)}
                        onChange={() => toggleFilter(f.filter_id)}
                      />
                      <div className="flex-1 flex items-center gap-2">
                        <span className="text-sm text-gray-800">{f.name}</span>
                        <span className="text-xs text-gray-400 font-mono">{f.label}</span>
                      </div>
                    </label>
                  ))}
                </div>
                {selectedIds.length > 0 && (
                  <p className="text-xs text-indigo-600 mt-2">
                    {selectedIds.length} filter{selectedIds.length > 1 ? 's' : ''} selected
                  </p>
                )}
              </div>
            )}

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg"
              >
                Cancel
              </button>
              {availableFilters.length > 0 && (
                <button
                  type="submit"
                  disabled={selectedIds.length === 0}
                  className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
                >
                  Estimate Cost →
                </button>
              )}
            </div>
          </form>
        )}

        {/* ── STEP: CONFIRM ── */}
        {step === 'confirm' && (
          <div className="px-6 py-5 space-y-4">
            <CostEstimateBox
              uniqueKeywords={keywordCount}
              selectedFilters={selectedFilters}
              filterCosts={filterCosts}
            />

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <div className="flex gap-3 justify-end pt-1">
              <button
                type="button"
                onClick={() => { setStep('select'); setError(null) }}
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
                  'Confirm & Run Filters'
                )}
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
