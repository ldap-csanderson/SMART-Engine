import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import RunsList from '../components/RunsList'
import NewRunModal from '../components/NewRunModal'

export default function HomePage() {
  const navigate = useNavigate()
  const [runs, setRuns] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)

  // Fetch runs from API
  const fetchRuns = async () => {
    try {
      const status = showArchived ? 'archived' : undefined
      const url = status ? `/api/runs?status=${status}` : '/api/runs'
      const response = await fetch(url)
      const data = await response.json()
      setRuns(data.runs || [])
    } catch (err) {
      console.error('Failed to fetch runs:', err)
    }
  }

  // Poll for updates every 30 seconds
  useEffect(() => {
    fetchRuns()
    const interval = setInterval(fetchRuns, 30000)
    return () => clearInterval(interval)
  }, [showArchived])

  const handleViewRun = (runId) => {
    navigate(`/run/${runId}`)
  }

  const handleNewRunSubmit = async (runData) => {
    // Add optimistic "processing" run at the top
    const processingRun = {
      run_id: 'temp-' + Date.now(),
      name: runData.name || `Run ${new Date().toLocaleString()}`,
      created_at: new Date().toISOString(),
      status: 'processing',
      urls: runData.urls,
      total_keywords_found: 0,
      error_message: null
    }
    
    // Add to top of list immediately
    setRuns([processingRun, ...runs])
    
    // Refresh to get actual results
    setTimeout(fetchRuns, 2000)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header with New Run button */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">
              Keyword Planner Dashboard
            </h1>
            <p className="mt-2 text-gray-600">
              Manage your keyword research runs
            </p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm"
          >
            + New Run
          </button>
        </div>

        {/* Runs Section Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">
            {showArchived ? 'Archived Runs' : 'Recent Runs'}
          </h2>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none"
          >
            {showArchived ? '← Back to Active Runs' : 'View Archived →'}
          </button>
        </div>

        {/* Runs List */}
        <div className="mb-8">
          <RunsList
            runs={runs}
            onViewRun={handleViewRun}
            onRunUpdated={fetchRuns}
            onNewRun={() => setIsModalOpen(true)}
            showArchived={showArchived}
          />
        </div>

        {/* New Run Modal */}
        <NewRunModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onSubmit={handleNewRunSubmit}
        />
      </div>
    </div>
  )
}
