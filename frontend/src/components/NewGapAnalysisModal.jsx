import { useState, useEffect } from 'react'

export default function NewGapAnalysisModal({ isOpen, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [reportId, setReportId] = useState('')
  const [selectedFilterIds, setSelectedFilterIds] = useState([])
  const [reports, setReports] = useState([])
  const [filters, setFilters] = useState([])
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [placeholder, setPlaceholder] = useState('')

  useEffect(() => {
    if (isOpen) {
      if (!placeholder) {
        const now = new Date()
        setPlaceholder(
          `Gap Analysis ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        )
      }
      // Fetch completed reports and available filters
      fetch('/api/keyword-reports')
        .then((r) => r.json())
        .then((d) => setReports((d.reports || []).filter((r) => r.status === 'completed')))
        .catch(console.error)
      fetch('/api/filters')
        .then((r) => r.json())
        .then((d) => setFilters(d.filters || []))
        .catch(console.error)
    }
  }, [isOpen])

  const toggleFilter = (filterId) => {
    setSelectedFilterIds((prev) =>
      prev.includes(filterId) ? prev.filter((id) => id !== filterId) : [...prev, filterId]
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!reportId) {
      setError('Please select a keyword report')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const body = {
        name: name.trim() || placeholder,
        report_id: reportId,
      }
      if (selectedFilterIds.length > 0) {
        body.filter_ids = selectedFilterIds
      }
      const res = await fetch('/api/gap-analyses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to create gap analysis')
      }
      setName('')
      setReportId('')
      setSelectedFilterIds([])
      setError(null)
      setPlaceholder('')
      onClose()
      if (onCreated) onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleClose = () => {
    if (submitting) return
    setName('')
    setReportId('')
    setSelectedFilterIds([])
    setError(null)
    setPlaceholder('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50 transition-opacity" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-2xl font-bold text-gray-900">New Gap Analysis</h2>
            <button onClick={handleClose} disabled={submitting} className="text-gray-400 hover:text-gray-600 disabled:opacity-50">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Name */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Analysis Name (optional)
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder={placeholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={submitting}
              />
            </div>

            {/* Keyword Report */}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Keyword Report <span className="text-red-500">*</span>
              </label>
              {reports.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No completed keyword reports available.</p>
              ) : (
                <select
                  className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                  value={reportId}
                  onChange={(e) => setReportId(e.target.value)}
                  disabled={submitting}
                  required
                >
                  <option value="">Select a report…</option>
                  {reports.map((r) => (
                    <option key={r.report_id} value={r.report_id}>
                      {r.name || r.report_id} — {r.total_keywords_found.toLocaleString()} keywords
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Filters (optional multiselect) */}
            {filters.length > 0 && (
              <div className="mb-5">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Run Filters After Analysis (optional)
                </label>
                <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-md p-2">
                  {filters.map((f) => (
                    <label key={f.filter_id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        checked={selectedFilterIds.includes(f.filter_id)}
                        onChange={() => toggleFilter(f.filter_id)}
                        disabled={submitting}
                      />
                      <span className="text-sm text-gray-800">{f.name}</span>
                      <span className="text-xs text-gray-400 font-mono">{f.label}</span>
                    </label>
                  ))}
                </div>
                {selectedFilterIds.length > 0 && (
                  <p className="text-xs text-blue-600 mt-1">
                    {selectedFilterIds.length} filter{selectedFilterIds.length > 1 ? 's' : ''} will run automatically after the analysis completes.
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
                disabled={submitting}
                className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting || !reportId}
                className="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Creating…
                  </span>
                ) : (
                  'Run Analysis'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
