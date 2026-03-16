import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import NewPortfolioModal from '../components/NewPortfolioModal'

export default function PortfoliosPage() {
  const navigate = useNavigate()
  const [portfolios, setPortfolios] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showNewModal, setShowNewModal] = useState(false)

  const fetchPortfolios = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/portfolios')
      if (!res.ok) throw new Error('Failed to fetch portfolios')
      const data = await res.json()
      setPortfolios(data.portfolios || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPortfolios()
  }, [])

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
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Portfolios</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your content portfolios for gap analysis
          </p>
        </div>
        <button
          onClick={() => setShowNewModal(true)}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Portfolio
        </button>
      </div>

      {/* Error State */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="text-center py-12">
          <svg className="animate-spin h-8 w-8 mx-auto text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-2 text-gray-500">Loading portfolios...</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && portfolios.length === 0 && (
        <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No portfolios</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by creating a new portfolio.</p>
          <div className="mt-6">
            <button
              onClick={() => setShowNewModal(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
            >
              <svg className="mr-2 h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              New Portfolio
            </button>
          </div>
        </div>
      )}

      {/* Portfolio List */}
      {!loading && portfolios.length > 0 && (
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <ul className="divide-y divide-gray-200">
            {portfolios.map((portfolio) => (
              <li key={portfolio.portfolio_id}>
                <button
                  onClick={() => navigate(`/portfolios/${portfolio.portfolio_id}`)}
                  className="w-full text-left block hover:bg-gray-50 focus:outline-none focus:bg-gray-50 transition duration-150 ease-in-out"
                >
                  <div className="px-4 py-4 sm:px-6">
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-lg font-semibold text-blue-600 truncate">
                          {portfolio.name}
                        </p>
                        <div className="mt-2 flex items-center text-sm text-gray-500">
                          <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <span className="font-medium">{portfolio.total_items}</span>
                          <span className="ml-1">
                            {portfolio.total_items === 1 ? 'item' : 'items'}
                          </span>
                          <span className="mx-2">•</span>
                          <svg className="flex-shrink-0 mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>Updated {formatDate(portfolio.updated_at)}</span>
                        </div>
                      </div>
                      <div>
                        <svg className="h-5 w-5 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* New Portfolio Modal */}
      <NewPortfolioModal
        isOpen={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={handlePortfolioCreated}
      />
    </div>
  )
}
