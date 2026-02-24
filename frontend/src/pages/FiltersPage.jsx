import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import NewFilterModal from '../components/NewFilterModal'

export default function FiltersPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState({})

  const fetchFilters = async () => {
    try {
      const response = await fetch('/api/filters')
      const data = await response.json()
      setFilters(data.filters || [])
    } catch (err) {
      console.error('Failed to fetch filters:', err)
    }
  }

  useEffect(() => {
    fetchFilters()
  }, [])

  const handleDelete = async (filterId, filterName) => {
    if (!window.confirm(`Delete filter "${filterName}"? This cannot be undone.`)) return

    setActionLoading((prev) => ({ ...prev, [filterId]: true }))
    try {
      const response = await fetch(`/api/filters/${filterId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to delete')
      setFilters((prev) => prev.filter((f) => f.filter_id !== filterId))
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading((prev) => ({ ...prev, [filterId]: false }))
    }
  }

  const handleCreated = () => {
    fetchFilters()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Filters</h1>
            <p className="mt-2 text-gray-600">Manage your keyword filters</p>
          </div>
          <button
            onClick={() => setIsModalOpen(true)}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm"
          >
            + New Filter
          </button>
        </div>

        {/* Filters List */}
        {filters.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="flex flex-col items-center">
              <button
                onClick={() => setIsModalOpen(true)}
                className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm mb-4"
              >
                + New Filter
              </button>
              <p className="text-gray-500">No filters yet — create your first filter</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {filters.map((filter) => (
              <div
                key={filter.filter_id}
                className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="text-lg font-semibold text-gray-900">{filter.name}</h3>
                      {filter.label && (
                        <span className="inline-flex px-2 py-0.5 text-xs font-medium rounded-full bg-purple-100 text-purple-800">
                          {filter.label}
                        </span>
                      )}
                    </div>
                    {filter.text && (
                      <p className="text-sm text-gray-600 line-clamp-3 mt-1">{filter.text}</p>
                    )}
                  </div>

                  <div className="flex gap-2 ml-4 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/filters/${filter.filter_id}`)}
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      View
                    </button>

                    <button
                      onClick={() => handleDelete(filter.filter_id, filter.name)}
                      disabled={actionLoading[filter.filter_id]}
                      className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actionLoading[filter.filter_id] ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* New Filter Modal */}
        <NewFilterModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onCreated={handleCreated}
        />
      </div>
    </div>
  )
}
