import { useState } from 'react'

export default function RunsList({ runs, onViewRun, onRunUpdated, showArchived = false }) {
  const [actionLoading, setActionLoading] = useState({})

  const handleArchive = async (runId) => {
    setActionLoading({ ...actionLoading, [runId]: true })
    try {
      const response = await fetch(`/api/runs/${runId}/archive`, {
        method: 'PATCH',
      })
      if (!response.ok) throw new Error('Failed to archive')
      onRunUpdated()
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading({ ...actionLoading, [runId]: false })
    }
  }

  const handleUnarchive = async (runId) => {
    setActionLoading({ ...actionLoading, [runId]: true })
    try {
      const response = await fetch(`/api/runs/${runId}/unarchive`, {
        method: 'PATCH',
      })
      if (!response.ok) throw new Error('Failed to unarchive')
      onRunUpdated()
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading({ ...actionLoading, [runId]: false })
    }
  }

  if (runs.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
        {showArchived ? 'No archived runs' : 'No runs yet - create your first search above'}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {runs.map((run) => (
        <div key={run.run_id} className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-lg font-semibold text-gray-900">
                  {run.urls.join(', ')}
                </h3>
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                  run.status === 'completed' ? 'bg-green-100 text-green-800' :
                  run.status === 'archived' ? 'bg-gray-100 text-gray-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {run.status}
                </span>
              </div>
              
              <div className="text-sm text-gray-600 space-y-1">
                <p>Created: {new Date(run.created_at).toLocaleString()}</p>
                <p>Keywords found: {run.total_keywords_found.toLocaleString()}</p>
                
                {!run.is_archivable && run.minutes_until_archivable !== null && (
                  <p className="text-amber-600">
                    ⏳ Archivable in {run.minutes_until_archivable} minutes
                  </p>
                )}
                {run.is_archivable && run.status !== 'archived' && (
                  <p className="text-green-600">
                    ✓ Ready to archive
                  </p>
                )}
              </div>
            </div>
            
            <div className="flex gap-2 ml-4">
              <button
                onClick={() => onViewRun(run.run_id)}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                View
              </button>
              
              {run.status !== 'archived' ? (
                <button
                  onClick={() => handleArchive(run.run_id)}
                  disabled={!run.is_archivable || actionLoading[run.run_id]}
                  className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!run.is_archivable ? `Available in ${run.minutes_until_archivable} minutes` : 'Archive this run'}
                >
                  {actionLoading[run.run_id] ? 'Archiving...' : 'Archive'}
                </button>
              ) : (
                <button
                  onClick={() => handleUnarchive(run.run_id)}
                  disabled={actionLoading[run.run_id]}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {actionLoading[run.run_id] ? 'Restoring...' : 'Unarchive'}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
