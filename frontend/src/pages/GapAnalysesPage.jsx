import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import API_BASE from '../config'
import NewGapAnalysisModal from '../components/NewGapAnalysisModal'

const STATUS_COLORS = {
  completed: 'text-green-600',
  processing: 'text-yellow-600',
  failed: 'text-red-600',
  archived: 'text-gray-400',
}

export default function GapAnalysesPage() {
  const location = useLocation()
  // If we navigated here after deleting an analysis, hide it optimistically
  // until the server confirms it's gone on the next poll
  const deletedId = location.state?.deletedId ?? null

  const [analyses, setAnalyses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const fetchAnalyses = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/gap-analyses`)
      const data = await res.json()
      setAnalyses(data.analyses || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAnalyses()
    const interval = setInterval(fetchAnalyses, 5000)
    return () => clearInterval(interval)
  }, [])

  // Filter out the optimistically-deleted item from display
  const visibleAnalyses = deletedId
    ? analyses.filter((a) => a.analysis_id !== deletedId)
    : analyses

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gap Analyses</h1>
          <p className="text-sm text-gray-500 mt-1">
            Semantic comparisons between datasets
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          + New Analysis
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : visibleAnalyses.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No gap analyses yet</p>
          <p className="text-sm mt-1">Create an analysis to find semantic gaps between datasets</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {visibleAnalyses.map(a => (
            <Link
              key={a.analysis_id}
              to={`/gap-analyses/${a.analysis_id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="min-w-0">
                <p className="font-medium text-gray-900 truncate">{a.name}</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">
                  {a.source_dataset_name} → {a.target_dataset_name}
                  {a.target_is_group && ' (group)'}
                </p>
              </div>
              <div className="flex items-center gap-6 text-sm text-gray-500 shrink-0 ml-4">
                <span className={`font-medium ${STATUS_COLORS[a.status] || 'text-gray-500'}`}>
                  {a.status === 'processing' ? '⏳ processing…' : a.status}
                </span>
                <span>
                  {a.status === 'processing' && a.total_items_analyzed === 0
                    ? '—'
                    : `${a.total_items_analyzed.toLocaleString()} items`}
                </span>
                <span>{new Date(a.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showModal && (
        <NewGapAnalysisModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); fetchAnalyses() }}
        />
      )}
    </div>
  )
}
