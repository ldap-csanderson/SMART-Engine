import { useState } from 'react'

function App() {
  const [urls, setUrls] = useState('')
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState(null)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setResults(null)

    // Parse URLs from textarea (one per line)
    const urlList = urls
      .split('\n')
      .map(url => url.trim())
      .filter(url => url.length > 0)

    if (urlList.length === 0) {
      setError('Please enter at least one URL')
      setLoading(false)
      return
    }

    try {
      const response = await fetch('/api/keyword-planner', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ urls: urlList }),
      })

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()
      setResults(data)
    } catch (err) {
      setError(`Error: ${err.message}`)
    } finally {
      setLoading(false)
    }
  }

  const handleClear = () => {
    setUrls('')
    setResults(null)
    setError(null)
  }

  // Flatten results for table display
  const getTableData = () => {
    if (!results) return []
    
    const tableData = []
    Object.entries(results.results).forEach(([url, keywords]) => {
      keywords.forEach(keyword => {
        tableData.push({
          url,
          ...keyword
        })
      })
    })
    return tableData
  }

  const tableData = getTableData()

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            Keyword Planner Tool
          </h1>
          <p className="mt-2 text-gray-600">
            Enter URLs to get keyword ideas from Google Ads Keyword Planner
          </p>
        </div>

        {/* Input Form */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label htmlFor="urls" className="block text-sm font-medium text-gray-700 mb-2">
                URLs (one per line)
              </label>
              <textarea
                id="urls"
                rows="5"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="https://www.example.com&#10;https://www.another-site.com"
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Analyzing...' : 'Get Keywords'}
              </button>
              
              <button
                type="button"
                onClick={handleClear}
                disabled={loading}
                className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear
              </button>
            </div>
          </form>

          {/* Error Message */}
          {error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-md">
              <p className="text-red-800">{error}</p>
            </div>
          )}

          {/* Loading State */}
          {loading && (
            <div className="mt-4 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-2 text-gray-600">Fetching keyword data...</p>
            </div>
          )}
        </div>

        {/* Results Summary */}
        {results && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">URLs Analyzed</p>
                <p className="text-2xl font-bold text-blue-600">
                  {results.summary.urls_analyzed}
                </p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Total Keywords Found</p>
                <p className="text-2xl font-bold text-green-600">
                  {results.summary.total_keywords_found}
                </p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <p className="text-sm text-gray-600">Avg Keywords per URL</p>
                <p className="text-2xl font-bold text-purple-600">
                  {Math.round(results.summary.total_keywords_found / results.summary.urls_analyzed)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Results Table */}
        {tableData.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-semibold text-gray-900">
                Keyword Results ({tableData.length} keywords)
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      URL
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Keyword
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Avg Monthly Searches
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Competition
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Low Bid (USD)
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      High Bid (USD)
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {tableData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                        {row.url}
                      </td>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">
                        {row.keyword_text}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {row.avg_monthly_searches?.toLocaleString() || 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                          row.competition === 'LOW' ? 'bg-green-100 text-green-800' :
                          row.competition === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                          row.competition === 'HIGH' ? 'bg-red-100 text-red-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {row.competition || 'N/A'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {row.low_top_of_page_bid_usd ? `$${row.low_top_of_page_bid_usd.toFixed(2)}` : 'N/A'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {row.high_top_of_page_bid_usd ? `$${row.high_top_of_page_bid_usd.toFixed(2)}` : 'N/A'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
