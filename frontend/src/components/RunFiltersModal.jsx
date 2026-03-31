import { useState, useEffect } from 'react'
import CostEstimateBox, { estimateFilterCost } from './CostEstimateBox'

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
    fetch('/api/filters')
      .then((r) => r.json())
      .then((d) => setAllFilters(d.filters || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [isOpen])

  // Filters already run on this analysis (by label + name)
  const usedLabels = new Set(existingExecutions.map((e) => e.filter_snapshot?.label).filter(Boolean))
  const usedNames  = new Set(existingExecutions.map((e) => e.filter_snapshot?.name).filter(Boolean))
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
      const res = await fetch(`/api/gap-analyses/${analysisId}/filter-executions`, {
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
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6">

          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Run Additional Filters</h2>
            <button onClick={handleClose} disabled={submitting} className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* ── STEP: SELECT ── */}
          {step === 'select' && (
            <form onSubmit={handleEstimate}>
              {loading ? (
                <div className="py-8 text-center text-gray-500">Loading filters…</div>
              ) : availableFilters.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  All available filters have already been run on this analysis.
                </div>
              ) : (
                <div className="mb-5">
                  <p className="text-sm text-gray-600 mb-3">
                    Select filters to run on this gap analysis:
                  </p>
                  <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-md p-2">
                    {availableFilters.map((f) => (
                      <label key={f.filter_id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                        <input
                          type="checkbox"
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={selectedIds.includes(f.filter_id)}
                          onChange={() => toggleFilter(f.filter_id)}
                        />
                        <div className="flex-1">
                          <span className="text-sm font-medium text-gray-800">{f.name}</span>
                          <span className="text-xs text-gray-400 ml-2 font-mono">{f.label}</span>
                        </div>
                      </label>
                    ))}
                  </div>
                  {selectedIds.length > 0 && (
                    <p className="text-xs text-blue-600 mt-2">
                      {selectedIds.length} filter{selectedIds.length > 1 ? 's' : ''} selected
                    </p>
                  )}
                </div>
              )}

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-800 text-sm">{error}</p>
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={handleClose}
                  className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none"
                >
                  Cancel
                </button>
                {availableFilters.length > 0 && (
                  <button
                    type="submit"
                    disabled={selectedIds.length === 0}
                    className="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none disabled:opacity-50"
                  >
                    Estimate Cost →
                  </button>
                )}
              </div>
            </form>
          )}

          {/* ── STEP: CONFIRM ── */}
          {step === 'confirm' && (
            <div>
              <div className="mb-5">
                <CostEstimateBox
                  uniqueKeywords={keywordCount}
                  selectedFilters={selectedFilters}
                  filterCosts={filterCosts}
                />
              </div>

              {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
                  <p className="text-red-800 text-sm">{error}</p>
                </div>
              )}

              <div className="flex gap-3 justify-end">
                <button
                  type="button"
                  onClick={() => { setStep('select'); setError(null) }}
                  disabled={submitting}
                  className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 disabled:opacity-50"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  onClick={handleConfirm}
                  disabled={submitting}
                  className="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 disabled:opacity-50"
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
    </div>
  )
}
