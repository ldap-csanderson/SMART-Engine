import { useState, useEffect } from 'react'
import SearchForm from './components/SearchForm'
import RunsList from './components/RunsList'
import KeywordTable from './components/KeywordTable'

function App() {
  const [runs, setRuns] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [selectedRunData, setSelectedRunData] = useState(null)
  const [loadingRunData, setLoadingRunData] = useState(false)

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

  // Fetch detailed run data when viewing
  const handleViewRun = async (runId) => {
    if (selectedRunId === runId) {
      // Toggle collapse
      setSelectedRunId(null)
      setSelectedRunData(null)
      return
    }

    setSelectedRunId(runId)
    setLoadingRunData(true)
    
    try {
      const response = await fetch(`/api/runs/${runId}/keywords`)
      const data = await response.json()
      
      // Flatten keywords for table
      const flatKeywords = []
      Object.entries(data.keywords).forEach(([url, keywords]) => {
        keywords.forEach(keyword => {
          flatKeywords.push({ url, ...keyword })
        })
      })
      
      setSelectedRunData(flatKeywords)
    } catch (err) {
      console.error('Failed to fetch run details:', err)
      alert('Failed to load run details')
    } finally {
      setLoadingRunData(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Keyword Planner Dashboard
          </h1>
          <p className="mt-2 text-gray-600">
            Search for keywords and manage your research history
          </p>
        </div>

        {/* Search Form */}
        <div className="mb-8">
          <SearchForm onNewRun={fetchRuns} />
        </div>

        {/* Runs Section Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">
            {showArchived ? 'Archived Runs' : 'Recent Runs'}
          </h2>
          <button
            onClick={() => {
              setShowArchived(!showArchived)
              setSelectedRunId(null)
              setSelectedRunData(null)
            }}
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
            showArchived={showArchived}
          />
        </div>

        {/* Expanded Run Details */}
        {selectedRunId && (
          <div className="mb-8">
            {loadingRunData ? (
              <div className="bg-white rounded-lg shadow p-8 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                <p className="mt-2 text-gray-600">Loading keywords...</p>
              </div>
            ) : selectedRunData ? (
              <KeywordTable keywords={selectedRunData} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

export default App
