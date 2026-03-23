import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import NewPortfolioModal from '../components/NewPortfolioModal'

export default function PortfoliosPage() {
  const navigate = useNavigate()
  const [portfolios, setPortfolios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showNewModal, setShowNewModal] = useState(false)
  const [actionLoading, setActionLoading] = useState({})

  const fetchPortfolios = async (isInitial = false) => {
    if (isInitial) setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolios')
      if (!res.ok) throw new Error('Failed to fetch portfolios')
      const data = await res.json()
      setPortfolios(data.portfolios || [])
    } catch (err) {
      setError(err.message)
    } finally {
      if (isInitial) setLoading(false)
    }
  }

  useEffect(() => {
    fetchPortfolios(true)
  }, [])

  const handleDelete = async (portfolioId, portfolioName) => {
    if (!window.confirm(`Delete portfolio "${portfolioName}"? This cannot be undone.`)) return

    setActionLoading((prev) => ({ ...prev, [portfolioId]: true }))
    try {
      const response = await fetch(`/api/portfolios/${portfolioId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to delete')
      setPortfolios((prev) => prev.filter((p) => p.portfolio_id !== portfolioId))
    } catch (err) {
      alert(`Error: ${err.message}`)
    } finally {
      setActionLoading((prev) => ({ ...prev, [portfolioId]: false }))
    }
  }

  const handlePortfolioCreated = () => {
    fetchPortfolios()
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  return (
    <div className="bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Portfolios</h1>
            <p className="mt-2 text-gray-600">Manage your content portfolios for gap analysis</p>
          </div>
          <button
            onClick={() => setShowNewModal(true)}
            className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm"
          >
            + New Portfolio
          </button>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-3 text-gray-500">Loading portfolios...</p>
          </div>
        ) : portfolios.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="flex flex-col items-center">
              <button
                onClick={() => setShowNewModal(true)}
                className="px-6 py-3 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 shadow-sm mb-4"
              >
                + New Portfolio
              </button>
              <p className="text-gray-500">No portfolios yet — create your first portfolio</p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {portfolios.map((portfolio) => (
              <div
                key={portfolio.portfolio_id}
                className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">{portfolio.name}</h3>
                    <div className="mt-1 flex items-center gap-3 text-sm text-gray-500">
                      <span>
                        <span className="font-medium text-gray-700">{portfolio.total_items}</span>
                        {' '}{portfolio.total_items === 1 ? 'item' : 'items'}
                      </span>
                      <span>•</span>
                      <span>Updated {formatDate(portfolio.updated_at)}</span>
                    </div>
                  </div>

                  <div className="flex gap-2 ml-4 flex-shrink-0">
                    <button
                      onClick={() => navigate(`/portfolios/${portfolio.portfolio_id}`)}
                      className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                    >
                      Edit
                    </button>

                    <button
                      onClick={() => handleDelete(portfolio.portfolio_id, portfolio.name)}
                      disabled={actionLoading[portfolio.portfolio_id]}
                      className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {actionLoading[portfolio.portfolio_id] ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* New Portfolio Modal */}
        <NewPortfolioModal
          isOpen={showNewModal}
          onClose={() => setShowNewModal(false)}
          onCreated={handlePortfolioCreated}
        />
      </div>
    </div>
  )
}
