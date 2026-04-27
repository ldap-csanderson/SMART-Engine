import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import NewFilterModal from '../components/NewFilterModal'
import API_BASE from '../config'

export default function FiltersPage() {
  const [filters, setFilters] = useState([])
  const [loading, setLoading] = useState(true)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [deleting, setDeleting] = useState({})

  const fetchFilters = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/filters`)
      const data = await res.json()
      setFilters(data.filters || [])
    } catch (err) {
      console.error('Failed to fetch filters:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchFilters()
  }, [])

  const handleDelete = async (e, filterId, filterName) => {
    e.preventDefault()
    e.stopPropagation()
    if (!window.confirm(`Delete filter "${filterName}"? This cannot be undone.`)) return
    setDeleting((prev) => ({ ...prev, [filterId]: true }))
    try {
      const res = await fetch(`${API_BASE}/api/filters/${filterId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      setFilters((prev) => prev.filter((f) => f.filter_id !== filterId))
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setDeleting((prev) => ({ ...prev, [filterId]: false }))
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Filters</h1>
          <p className="text-sm text-gray-500 mt-1">Keyword filters for gap analysis results</p>
        </div>
        <button
          onClick={() => setIsModalOpen(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          + New Filter
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : filters.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No filters yet</p>
          <p className="text-sm mt-1">Create a filter to classify gap analysis results</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {filters.map((filter) => (
            <Link
              key={filter.filter_id}
              to={`/filters/${filter.filter_id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-gray-900 truncate">{filter.name}</p>
                  {filter.label && (
                    <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800 shrink-0">
                      {filter.label}
                    </span>
                  )}
                </div>
                {filter.text && (
                  <p className="text-xs text-gray-400 mt-0.5 truncate max-w-lg">{filter.text}</p>
                )}
              </div>
              <button
                onClick={(e) => handleDelete(e, filter.filter_id, filter.name)}
                disabled={deleting[filter.filter_id]}
                className="text-sm text-red-500 hover:text-red-700 border border-red-200 px-3 py-1.5 rounded-lg shrink-0 ml-4 disabled:opacity-50"
              >
                {deleting[filter.filter_id] ? 'Deleting…' : 'Delete'}
              </button>
            </Link>
          ))}
        </div>
      )}

      <NewFilterModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onCreated={() => { setIsModalOpen(false); fetchFilters() }}
      />
    </div>
  )
}
