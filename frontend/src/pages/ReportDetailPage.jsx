import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import KeywordTable from '../components/KeywordTable'

export default function ReportDetailPage() {
  const { reportId } = useParams()
  const navigate = useNavigate()
  const [reportData, setReportData] = useState(null)
  const [keywords, setKeywords] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchReportDetails = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/keyword-reports/${reportId}/keywords`)

        if (!response.ok) {
          throw new Error('Failed to load report details')
        }

        const data = await response.json()
        setReportData(data)

        // Flatten keywords for table
        const flatKeywords = []
        Object.entries(data.keywords).forEach(([url, keywordList]) => {
          keywordList.forEach((keyword) => {
            flatKeywords.push({ url, ...keyword })
          })
        })

        setKeywords(flatKeywords)
      } catch (err) {
        console.error('Failed to fetch report details:', err)
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchReportDetails()
  }, [reportId])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading report details...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !reportData) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow p-8">
            <div className="text-red-600 mb-4">
              <p className="font-semibold">Error loading report</p>
              <p className="text-sm">{error || 'Report not found'}</p>
            </div>
            <button
              onClick={() => navigate('/keyword-reports')}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              ← Back to Reports
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Back Button */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/keyword-reports')}
            className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium mb-4"
          >
            <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Reports
          </button>

          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                {reportData.name || reportData.report_id}
              </h1>
              <p className="mt-1 text-gray-600">
                Created: {new Date(reportData.created_at).toLocaleString()} |{' '}
                Status: <span className="font-medium">{reportData.status}</span> |{' '}
                Keywords: <span className="font-medium">{reportData.total_keywords_found.toLocaleString()}</span>
              </p>
            </div>
          </div>
        </div>

        {/* URLs Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            URLs Analyzed ({reportData.urls.length})
          </h2>
          <ul className="space-y-2">
            {reportData.urls.map((url, index) => (
              <li key={index} className="flex items-start">
                <span className="text-blue-600 mr-2">•</span>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:text-blue-700 underline break-all"
                >
                  {url}
                </a>
              </li>
            ))}
          </ul>
        </div>

        {/* Keywords Table */}
        <KeywordTable keywords={keywords} />
      </div>
    </div>
  )
}
