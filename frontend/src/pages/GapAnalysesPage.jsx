import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import NewGapAnalysisModal from '../components/NewGapAnalysisModal'

const STATUS_COLORS = {
  completed: 'bg-green-100 text-green-800',
  archived: 'bg-gray-100 text-gray-800',
  processing: 'bg-blue-100 text-blue-800',
  failed: 'bg-red-100 text-red-800',
}

export default function GapAnalysesPage() {
  const navigate = useNavigate()
  const [analyses, setAnalyses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showArchived, setShowArchived] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState({})
  const [reportsMap, setReportsMap] = useState({}) // report_id → report metadata
  const [portfolioCount, setPortfolioCount] = useState(0)
  const showArchivedRef = useRef(showArchived)

  useEffect(() => {
    showArchivedRef.current = showArchived
  }, [showArchived])

  const fetchAnalyses = async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      const status = showArchivedRef.current ? 'archived' : undefined
      const url = status ? `/api/gap-analyses?status=${status}` : '/api/gap-analyses'
      const res = await fetch(url)
      const data = await res.json()
      const fresh = data.analyses || []
      setAnalyses(fresh)
      return fresh
    } catch (err) {
      console.error('Failed to fetch analyses:', err)
      return null
    } finally {
      if (showSpinner) setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalyses(true)
  }, [showArchived])

  // Fetch reports map and portfolio count on mount (once)
  useEffect(() => {
    const fetchMetadata = async () => {
      try {
        const [reportsRes, portfolioRes] = await Promise.all([
          fetch('/api/keyword-reports'),
          fetch('/api/portfolio/meta'),
        ])
        if (reportsRes.ok) {
          const data = await reportsRes.json()
          const map = {}
          ;(data.reports || []).forEach(r => { map[r.report_id] = r })
          setReportsMap(map)
        }
        if (portfolioRes.ok) {
          const data = await portfolioRes.json()
          setPortfolioCount(data.total_items || 0)
        }
      } catch (err) {
        console.error('Failed to fetch metadata:', err)
      }
    }
    fetchMetadata()
  }, [])

  // Poll while any analysis is processing
  useEffect(() => {
    if (!analyses.some((a) => a.status === 'processing')) return
    const timer = setTimeout(() => fetchAnalyses(false), 1000)
    return () => clearTimeout(timer)
  }, [analyses])

  const handleArchive = async (analysisId) => {
    setActionLoading((p) => ({ ...p, [analysisId]: true }))
    try {
      const res = await fetch(`/api/gap-analyses/${analysisId}/archive`, { method: 'PATCH' })
      if (!res.ok) throw new Error('Failed to archive')
      fetchAnalyses(false)
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading((p) => ({ ...p, [analysisId]: false }))
    }
  }

  const handleUnarchive = async (analysisId) => {
    setActionLoading((p) => ({ ...p, [analysisId]: true }))
    try {
      const res = await fetch(`/api/gap-analyses/${analysisId}/unarchive`, { method: 'PATCH' })
      if (!res.ok) throw new Error('Failed to unarchive')
      fetchAnalyses(false)
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading((p) => ({ ...p, [analysisId]: false }))
    }
  }

  const handleDelete = async (analysisId) => {
    if (!window.confirm('Delete this failed analysis? This cannot be undone.')) return
    setActionLoading((p) => ({ ...p, [analysisId]: true }))
    try {
      const res = await fetch(`/api/gap-analyses/${analysisId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      fetchAnalyses(false)
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading((p) => ({ ...p, [analysisId]: false }))
    }
  }

  return (
    <div className="bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Gap Analyses</h1>
            <p className="mt-2 text-gray-600">Semantic gap analysis between keyword traffic and your portfolio</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm"
          >
            + New Analysis
          </button>
        </div>

        {/* Section header with archive toggle */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">
            {showArchived ? 'Archived Analyses' : 'Recent Analyses'}
          </h2>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none"
          >
            {showArchived ? '← Back to Active' : 'View Archived →'}
          </button>
        </div>

        {/* List */}
        {loading ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-500">Loading analyses…</p>
          </div>
        ) : analyses.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            {showArchived ? (
              <p className="text-gray-500">No archived analyses</p>
            ) : (
              <div className="flex flex-col items-center">
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 mb-4"
                >
                  + New Analysis
                </button>
                <p className="text-gray-500">No analyses yet — run your first gap analysis</p>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {analyses.map((a) => (
              <div key={a.analysis_id} className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{a.name}</h3>
                      <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${STATUS_COLORS[a.status] || 'bg-yellow-100 text-yellow-800'}`}>
                        {a.status === 'processing' ? 'In Progress' : a.status}
                      </span>
                    </div>
                    <div className="text-sm text-gray-600 space-y-1">
                      <p>Created: {new Date(a.created_at).toLocaleString()}</p>
                      {reportsMap[a.report_id] && (
                        <p>URLs: {reportsMap[a.report_id].urls?.length || 0}</p>
                      )}
                      {a.total_keywords_analyzed > 0 && (
                        <p>Keywords: {a.total_keywords_analyzed.toLocaleString()}</p>
                      )}
                      <p>Portfolio: {portfolioCount} items</p>
                      {a.status === 'failed' && a.error_message && (
                        <p className="text-red-600 text-xs mt-1">Error: {a.error_message}</p>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4">
                    {(a.status === 'completed' || a.status === 'archived') && (
                      <button
                        onClick={() => navigate(`/gap-analyses/${a.analysis_id}`)}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                      >
                        View Results
                      </button>
                    )}
                    {a.status === 'failed' && (
                      <button
                        onClick={() => navigate(`/gap-analyses/${a.analysis_id}`)}
                        className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700"
                      >
                        View Results
                      </button>
                    )}
                    {a.status === 'completed' && (
                      <button
                        onClick={() => handleArchive(a.analysis_id)}
                        disabled={actionLoading[a.analysis_id]}
                        className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoading[a.analysis_id] ? 'Archiving…' : 'Archive'}
                      </button>
                    )}
                    {a.status === 'archived' && (
                      <button
                        onClick={() => handleUnarchive(a.analysis_id)}
                        disabled={actionLoading[a.analysis_id]}
                        className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoading[a.analysis_id] ? 'Restoring…' : 'Unarchive'}
                      </button>
                    )}
                    {a.status === 'failed' && !showArchived && (
                      <button
                        onClick={() => handleDelete(a.analysis_id)}
                        disabled={actionLoading[a.analysis_id]}
                        className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoading[a.analysis_id] ? 'Deleting…' : 'Delete'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <NewGapAnalysisModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onCreated={() => fetchAnalyses(false)}
        />
      </div>
    </div>
  )
}
