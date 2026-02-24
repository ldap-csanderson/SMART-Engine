import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import ReportsList from '../components/ReportsList'
import NewReportModal from '../components/NewReportModal'

export default function KeywordReportsPage() {
  const navigate = useNavigate()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  // Incrementing this cancels the current timer and restarts the poll loop
  const [pollTrigger, setPollTrigger] = useState(0)
  const showArchivedRef = useRef(showArchived)

  useEffect(() => {
    showArchivedRef.current = showArchived
  }, [showArchived])

  const fetchReports = async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      const status = showArchivedRef.current ? 'archived' : undefined
      const url = status ? `/api/keyword-reports?status=${status}` : '/api/keyword-reports'
      const response = await fetch(url)
      const data = await response.json()
      const freshReports = data.reports || []
      setReports(freshReports)
      return freshReports
    } catch (err) {
      console.error('Failed to fetch reports:', err)
      return null
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  // Poll loop. Re-runs when showArchived or pollTrigger changes.
  // Cancelling the old effect when pollTrigger increments kills the pending 30s timer,
  // so the new loop can immediately start 500ms polling for processing reports.
  useEffect(() => {
    let cancelled = false
    const timerRef = { current: null }

    const schedule = (freshReports) => {
      if (cancelled) return
      const hasProcessing = freshReports?.some((r) => r.status === 'processing') ?? false
      const delay = hasProcessing ? 500 : 30_000
      timerRef.current = setTimeout(async () => {
        if (cancelled) return
        const data = await fetchReports(false)
        schedule(data)
      }, delay)
    }

    // showSpinner only on the very first load (pollTrigger===0 and loading is still true)
    fetchReports(pollTrigger === 0 && loading).then(schedule)

    return () => {
      cancelled = true
      clearTimeout(timerRef.current)
    }
  }, [showArchived, pollTrigger])

  const handleViewReport = (reportId) => {
    navigate(`/keyword-reports/${reportId}`)
  }

  const handleReportCreated = () => {
    // Incrementing pollTrigger cancels the old timer and restarts the loop,
    // which will immediately detect status=processing and poll every 500ms
    setPollTrigger((t) => t + 1)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Keyword Reports</h1>
            <p className="mt-2 text-gray-600">Manage your keyword research reports</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm"
          >
            + New Report
          </button>
        </div>

        {/* Section Header with Archive Toggle */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">
            {showArchived ? 'Archived Reports' : 'Recent Reports'}
          </h2>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none"
          >
            {showArchived ? '← Back to Active Reports' : 'View Archived →'}
          </button>
        </div>

        {/* Reports List */}
        <div className="mb-8">
          {loading ? (
            <div className="bg-white rounded-lg shadow p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-3 text-gray-500">Loading reports...</p>
            </div>
          ) : (
            <ReportsList
              reports={reports}
              onViewReport={handleViewReport}
              onReportUpdated={() => setPollTrigger((t) => t + 1)}
              onNewReport={() => setIsModalOpen(true)}
              showArchived={showArchived}
            />
          )}
        </div>

        {/* New Report Modal */}
        <NewReportModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onCreated={handleReportCreated}
        />
      </div>
    </div>
  )
}
