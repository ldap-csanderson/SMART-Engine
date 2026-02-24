import { useState } from 'react'

export default function ReportsList({ reports, onViewReport, onReportUpdated, showArchived = false, onNewReport }) {
  const [actionLoading, setActionLoading] = useState({})

  const handleArchive = async (reportId) => {
    setActionLoading({ ...actionLoading, [reportId]: true })
    try {
      const response = await fetch(`/api/keyword-reports/${reportId}/archive`, {
        method: 'PATCH',
      })
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
      const response = await fetch(`/api/keyword-reports/${reportId}/unarchive`, {
        method: 'PATCH',
      })
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

  return (
    <div className="space-y-4">
      {reports.map((report) => (
        <div key={report.report_id} className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-lg font-semibold text-gray-900">
                  {report.name}
                </h3>
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                  report.status === 'completed' ? 'bg-green-100 text-green-800' :
                  report.status === 'archived' ? 'bg-gray-100 text-gray-800' :
                  report.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {report.status === 'processing' ? 'In Progress' : report.status}
                </span>
              </div>

              <div className="text-sm text-gray-600 space-y-1">
                <p>Created: {new Date(report.created_at).toLocaleString()}</p>
                <p>URLs: {report.urls?.length || 0}</p>
                <p>Keywords: {report.total_keywords_found.toLocaleString()}</p>
              </div>
            </div>

            <div className="flex gap-2 ml-4">
              <button
                onClick={() => onViewReport(report.report_id)}
                disabled={report.report_id.startsWith('temp-')}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                View Results
              </button>

              {!report.report_id.startsWith('temp-') && (
                report.status !== 'archived' ? (
                  <button
                    onClick={() => handleArchive(report.report_id)}
                    disabled={actionLoading[report.report_id]}
                    className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading[report.report_id] ? 'Archiving...' : 'Archive'}
                  </button>
                ) : (
                  <button
                    onClick={() => handleUnarchive(report.report_id)}
                    disabled={actionLoading[report.report_id]}
                    className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading[report.report_id] ? 'Restoring...' : 'Unarchive'}
                  </button>
                )
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
