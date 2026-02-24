import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import NewFilterModal from '../components/NewFilterModal'

export default function FiltersPage() {
  const navigate = useNavigate()
  const [filters, setFilters] = useState([])
  const [showArchived, setShowArchived] = useState(false)
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [actionLoading, setActionLoading] = useState({})

  const fetchFilters = async () => {
    try {
      const status = showArchived ? 'archived' : undefined
      const url = status ? `/api/filters?status=${status}` : '/api/filters'
      const response = await fetch(url)
      const data = await response.json()
      setFilters(data.filters || [])
    } catch (err) {
      console.error('Failed to fetch filters:', err)
    }
  }

  useEffect(() => {
    fetchFilters()
  }, [showArchived])

  const handleArchive = async (filterId) => {
    setActionLoading((prev) => ({ ...prev, [filterId]: true }))
    try {
      const response = await fetch(`/api/filters/${filterId}/archive`, { method: 'PATCH' })
      if (!response.ok) throw new Error('Failed to archive')
      fetchFilters()
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading((prev) => ({ ...prev, [filterId]: false }))
    }
  }

  const handleUnarchive = async (filterId) => {
    setActionLoading((prev) => ({ ...prev, [filterId]: true }))
    try {
      const response = await fetch(`/api/filters/${filterId}/unarchive`, { method: 'PATCH' })
      if (!response.ok) throw new Error('Failed to unarchive')
      fetchFilters()
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading((prev) => ({ ...prev, [filterId]: false }))
    }
  }

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

  const handleCreated = (newFilter) => {
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

        {/* Section Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-900">
            {showArchived ? 'Archived Filters' : 'Active Filters'}
          </h2>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-700 focus:outline-none"
          >
            {showArchived ? '← Back to Active Filters' : 'View Archived →'}
          </button>
        </div>

        {/* Filters List */}
        {filters.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            {showArchived ? (
              <p className="text-gray-500">No archived filters</p>
            ) : (
              <div className="flex flex-col items-center">
                <button
                  onClick={() => setIsModalOpen(true)}
                  className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm mb-4"
                >
                  + New Filter
                </button>
                <p className="text-gray-500">No filters yet — create your first filter</p>
              </div>
            )}
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
                      <span
                        className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                          filter.status === 'archived'
                            ? 'bg-gray-100 text-gray-800'
                            : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {filter.status}
                      </span>
                    </div>
                    {filter.text && (
                      <p className="text-sm text-gray-600 line-clamp-2 mt-1">{filter.text}</p>
                    )}
                    <p className="text-xs text-gray-400 mt-2">
                      Created: {new Date(filter.created_at).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex gap-2 ml-4 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/filters/${filter.filter_id}`)}
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      View
                    </button>

                    {filter.status !== 'archived' ? (
                      <button
                        onClick={() => handleArchive(filter.filter_id)}
                        disabled={actionLoading[filter.filter_id]}
                        className="px-4 py-2 bg-gray-200 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoading[filter.filter_id] ? '...' : 'Archive'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleUnarchive(filter.filter_id)}
                        disabled={actionLoading[filter.filter_id]}
                        className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {actionLoading[filter.filter_id] ? '...' : 'Unarchive'}
                      </button>
                    )}

                    <button
                      onClick={() => handleDelete(filter.filter_id, filter.name)}
                      disabled={actionLoading[filter.filter_id]}
                      className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Delete
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
