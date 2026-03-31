import { useState } from 'react'

const PAGE_SIZE = 25

const SORT_OPTIONS = [
  { key: 'created_at', label: 'Date' },
  { key: 'name', label: 'Name' },
  { key: 'total_keywords_found', label: 'Keywords' },
]

function SortHeader({ label, sortKey, currentSort, currentDir, onSort }) {
  const active = currentSort === sortKey
  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide ${
        active ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
      }`}
    >
      {label}
      {active ? (
        <span>{currentDir === 'asc' ? '↑' : '↓'}</span>
      ) : (
        <span className="text-gray-300">↕</span>
      )}
    </button>
  )
}

export default function ReportsList({ reports, onViewReport, onReportUpdated, showArchived = false, onNewReport }) {
  const [actionLoading, setActionLoading] = useState({})
  const [sortKey, setSortKey] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  const [page, setPage] = useState(0)

  const handleSort = (key) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'name' ? 'asc' : 'desc')
    }
    setPage(0)
  }

  const sorted = [...reports].sort((a, b) => {
    let aVal = a[sortKey]
    let bVal = b[sortKey]
    if (sortKey === 'created_at') {
      aVal = aVal ? new Date(aVal).getTime() : 0
      bVal = bVal ? new Date(bVal).getTime() : 0
    } else if (sortKey === 'total_keywords_found') {
      aVal = aVal || 0
      bVal = bVal || 0
    } else {
      aVal = (aVal || '').toLowerCase()
      bVal = (bVal || '').toLowerCase()
    }
    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
    return 0
  })

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  const handleArchive = async (reportId) => {
    setActionLoading({ ...actionLoading, [reportId]: true })
    try {
      const response = await fetch(`/api/keyword-reports/${reportId}/archive`, { method: 'PATCH' })
      if (!response.ok) throw new Error('Failed to archive')
      onReportUpdated()
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading({ ...actionLoading, [reportId]: false })
    }
  }

  const handleUnarchive = async (reportId) => {
    setActionLoading({ ...actionLoading, [reportId]: true })
    try {
      const response = await fetch(`/api/keyword-reports/${reportId}/unarchive`, { method: 'PATCH' })
      if (!response.ok) throw new Error('Failed to unarchive')
      onReportUpdated()
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading({ ...actionLoading, [reportId]: false })
    }
  }

  const handleDelete = async (reportId) => {
    if (!window.confirm('Delete this failed report? This cannot be undone.')) return
    setActionLoading({ ...actionLoading, [reportId]: true })
    try {
      const response = await fetch(`/api/keyword-reports/${reportId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to delete')
      onReportUpdated()
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading({ ...actionLoading, [reportId]: false })
    }
  }

  if (reports.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-12 text-center">
        {showArchived ? (
          <p className="text-gray-500">No archived reports</p>
        ) : (
          <div className="flex flex-col items-center">
            <button
              onClick={onNewReport}
              className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm mb-4"
            >
              + New Report
            </button>
            <p className="text-gray-500">No reports yet — create your first keyword report</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Sort controls + count */}
      <div className="flex items-center justify-between mb-3 px-1">
        <p className="text-sm text-gray-500">
          {reports.length} report{reports.length !== 1 ? 's' : ''}
          {totalPages > 1 && ` · page ${page + 1} of ${totalPages}`}
        </p>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">Sort:</span>
          {SORT_OPTIONS.map((opt) => (
            <SortHeader
              key={opt.key}
              label={opt.label}
              sortKey={opt.key}
              currentSort={sortKey}
              currentDir={sortDir}
              onSort={handleSort}
            />
          ))}
        </div>
      </div>

      {/* Report cards */}
      <div className="space-y-4">
        {paginated.map((report) => (
          <div key={report.report_id} className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-1">{report.name}</h3>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                    report.status === 'completed' ? 'bg-green-100 text-green-800' :
                    report.status === 'archived'  ? 'bg-gray-100 text-gray-800' :
                    report.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                    report.status === 'failed'    ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {report.status === 'processing' ? 'In Progress' : report.status}
                  </span>
                  <span>·</span>
                  <span>{report.urls?.length || 0} URLs</span>
                  {report.status !== 'processing' && (
                    <>
                      <span>·</span>
                      <span>{report.total_keywords_found.toLocaleString()} keywords</span>
                    </>
                  )}
                  {report.created_at && (
                    <>
                      <span>·</span>
                      <span className="text-gray-400">{new Date(report.created_at).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
                <div className="text-sm text-gray-600 space-y-1">
                  {report.status === 'failed' && report.error_message && (
                    <p className="text-red-600 text-xs mt-1">Error: {report.error_message}</p>
                  )}
                </div>
              </div>

              <div className="flex gap-2 ml-4">
                {(report.status === 'completed' || report.status === 'archived' || report.status === 'failed') && (
                  <button
                    onClick={() => onViewReport(report.report_id)}
                    className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    View Results
                  </button>
                )}
                {report.status === 'completed' && (
                  <button
                    onClick={() => handleArchive(report.report_id)}
                    disabled={actionLoading[report.report_id]}
                    className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading[report.report_id] ? 'Archiving...' : 'Archive'}
                  </button>
                )}
                {report.status === 'archived' && (
                  <button
                    onClick={() => handleUnarchive(report.report_id)}
                    disabled={actionLoading[report.report_id]}
                    className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading[report.report_id] ? 'Restoring...' : 'Unarchive'}
                  </button>
                )}
                {report.status === 'failed' && !showArchived && (
                  <button
                    onClick={() => handleDelete(report.report_id)}
                    disabled={actionLoading[report.report_id]}
                    className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading[report.report_id] ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>
          <span className="text-sm text-gray-600">
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, reports.length)} of {reports.length}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
