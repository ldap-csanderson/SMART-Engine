import { useState } from 'react'

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'created_at', label: 'Created' },
  { key: 'urls', label: 'URLs' },
  { key: 'total_keywords_found', label: 'Keywords' },
  { key: 'status', label: 'Status' },
]

function SortIcon({ direction }) {
  if (!direction) {
    return (
      <span className="ml-1 text-gray-300 inline-block">
        <svg className="w-3 h-3 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      </span>
    )
  }
  return (
    <span className="ml-1 inline-block">
      {direction === 'asc' ? '↑' : '↓'}
    </span>
  )
}

function sortReports(reports, sortKey, sortDir) {
  if (!sortKey) return reports

  return [...reports].sort((a, b) => {
    let aVal, bVal

    if (sortKey === 'urls') {
      aVal = a.urls?.length ?? 0
      bVal = b.urls?.length ?? 0
    } else if (sortKey === 'created_at') {
      aVal = new Date(a.created_at).getTime()
      bVal = new Date(b.created_at).getTime()
    } else {
      aVal = a[sortKey] ?? ''
      bVal = b[sortKey] ?? ''
    }

    if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
    if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
    return 0
  })
}

export default function ReportsList({ reports, onViewReport, onReportUpdated, showArchived = false, onNewReport }) {
  const [actionLoading, setActionLoading] = useState({})
  const [sortKey, setSortKey] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

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

  const sorted = sortReports(reports, sortKey, sortDir)

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                onClick={() => handleSort(col.key)}
                className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100"
              >
                {col.label}
                <SortIcon direction={sortKey === col.key ? sortDir : null} />
              </th>
            ))}
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {sorted.map((report) => (
            <tr
              key={report.report_id}
              className="hover:bg-gray-50 cursor-pointer"
              onClick={() => onViewReport(report.report_id)}
            >
              <td className="px-6 py-4 text-sm font-medium text-gray-900 max-w-xs truncate">
                {report.name}
              </td>
              <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                {new Date(report.created_at).toLocaleString()}
              </td>
              <td className="px-6 py-4 text-sm text-gray-500">
                {report.urls?.length ?? 0}
              </td>
              <td className="px-6 py-4 text-sm text-gray-500">
                {report.total_keywords_found.toLocaleString()}
              </td>
              <td className="px-6 py-4">
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                  report.status === 'completed' ? 'bg-green-100 text-green-800' :
                  report.status === 'archived' ? 'bg-gray-100 text-gray-800' :
                  report.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {report.status === 'processing' ? 'In Progress' : report.status}
                </span>
              </td>
              <td
                className="px-6 py-4 text-right whitespace-nowrap"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => onViewReport(report.report_id)}
                    className="px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    View
                  </button>
                  {report.status !== 'archived' ? (
                    <button
                      onClick={() => handleArchive(report.report_id)}
                      disabled={actionLoading[report.report_id]}
                      className="px-3 py-1.5 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actionLoading[report.report_id] ? '...' : 'Archive'}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleUnarchive(report.report_id)}
                      disabled={actionLoading[report.report_id]}
                      className="px-3 py-1.5 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actionLoading[report.report_id] ? '...' : 'Unarchive'}
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
