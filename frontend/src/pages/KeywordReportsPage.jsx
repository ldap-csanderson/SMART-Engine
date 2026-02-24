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
  const reportsRef = useRef(reports)

  useEffect(() => {
    reportsRef.current = reports
  }, [reports])

  const fetchReports = async (isInitial = false) => {
    if (isInitial) setLoading(true)
    try {
      const status = showArchived ? 'archived' : undefined
      const url = status ? `/api/keyword-reports?status=${status}` : '/api/keyword-reports'
      const response = await fetch(url)
      const data = await response.json()
      setReports(data.reports || [])
    } catch (err) {
      console.error('Failed to fetch reports:', err)
    } finally {
      if (isInitial) setLoading(false)
    }
  }

  // Poll every 500ms while any report is still processing, 30s otherwise
  useEffect(() => {
    fetchReports(true)

    const timerRef = { current: null }

    const tick = () => {
      const hasProcessing = reportsRef.current.some((r) => r.status === 'processing')
      const delay = hasProcessing ? 500 : 30_000
      timerRef.current = setTimeout(async () => {
        await fetchReports(false)
        tick()
      }, delay)
    }

    tick()

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [showArchived])

  const handleViewReport = (reportId) => {
    navigate(`/keyword-reports/${reportId}`)
  }

  const handleReportCreated = () => {
    fetchReports(false)
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
              onReportUpdated={() => fetchReports(false)}
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
