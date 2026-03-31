import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import KeywordTable from '../components/KeywordTable'

const DEFAULT_PAGE_SIZE = 100

export default function ReportDetailPage() {
  const { reportId } = useParams()
  const navigate = useNavigate()

  // Report metadata (fetched once, cached)
  const [reportMeta, setReportMeta] = useState(null)

  // Keyword page state
  const [keywords, setKeywords] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize] = useState(DEFAULT_PAGE_SIZE)
  const [orderBy, setOrderBy] = useState('avg_monthly_searches')
  const [orderDir, setOrderDir] = useState('DESC')

  // Loading states
  const [initialLoading, setInitialLoading] = useState(true)
  const [tableLoading, setTableLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchKeywords = useCallback(async (pg, ob, od, isInitial = false) => {
    if (isInitial) setInitialLoading(true)
    else setTableLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({
        limit: pageSize,
        offset: pg * pageSize,
        order_by: ob,
        order_dir: od,
      })
      const res = await fetch(`/api/keyword-reports/${reportId}/keywords?${params}`)
      if (!res.ok) throw new Error('Failed to load report details')
      const data = await res.json()

      if (isInitial || !reportMeta) {
        setReportMeta({
          report_id: data.report_id,
          name: data.name,
          created_at: data.created_at,
          status: data.status,
          urls: data.urls,
          total_keywords_found: data.total_keywords_found,
          error_message: data.error_message,
        })
      }

      setKeywords(data.keywords || [])
      setTotalCount(data.total_count || data.total_keywords_found || 0)
    } catch (err) {
      console.error('Failed to fetch keywords:', err)
      setError(err.message)
    } finally {
      if (isInitial) setInitialLoading(false)
      else setTableLoading(false)
    }
  }, [reportId, pageSize])

  // Initial load
  useEffect(() => {
    fetchKeywords(0, orderBy, orderDir, true)
  }, [reportId])

  // Re-fetch when sort changes (reset to page 0)
  const handleSort = (newOrderBy, newOrderDir) => {
    setOrderBy(newOrderBy)
    setOrderDir(newOrderDir)
    setPage(0)
    fetchKeywords(0, newOrderBy, newOrderDir, false)
  }

  // Re-fetch when page changes
  const handlePageChange = (newPage) => {
    setPage(newPage)
    fetchKeywords(newPage, orderBy, orderDir, false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (initialLoading) {
    return (
      <div className="bg-gray-50">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading report details...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error && !reportMeta) {
    return (
      <div className="bg-gray-50">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow p-8">
            <div className="text-red-600 mb-4">
              <p className="font-semibold">Error loading report</p>
              <p className="text-sm">{error}</p>
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
    <div className="bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Back Button + Header */}
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
                {reportMeta?.name || reportId}
              </h1>
              <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
                <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
                  reportMeta?.status === 'completed' ? 'bg-green-100 text-green-800' :
                  reportMeta?.status === 'archived'  ? 'bg-gray-100 text-gray-800' :
                  reportMeta?.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                  reportMeta?.status === 'failed'    ? 'bg-red-100 text-red-800' :
                  'bg-yellow-100 text-yellow-800'
                }`}>
                  {reportMeta?.status === 'processing' ? 'In Progress' : reportMeta?.status}
                </span>
                <span>·</span>
                <span>{reportMeta?.urls?.length || 0} URLs</span>
                <span>·</span>
                <span>{(reportMeta?.total_keywords_found || 0).toLocaleString()} keywords</span>
              </div>
            </div>
          </div>
        </div>

        {/* Failed report warning */}
        {reportMeta?.status === 'failed' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-8">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-semibold text-red-800">This report failed to complete</p>
                {reportMeta.error_message && (
                  <p className="text-sm text-red-700 mt-1">{reportMeta.error_message}</p>
                )}
                <p className="text-sm text-red-600 mt-1">
                  Partial results may be shown if any keywords were fetched before the failure.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* URLs Section */}
        <div className="bg-white rounded-lg shadow p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            URLs Analyzed ({reportMeta?.urls?.length || 0})
          </h2>
          <ul className="space-y-2">
            {(reportMeta?.urls || []).map((url, index) => (
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
        <KeywordTable
          keywords={keywords}
          totalCount={totalCount}
          page={page}
          pageSize={pageSize}
          orderBy={orderBy}
          orderDir={orderDir}
          loading={tableLoading}
          onSort={handleSort}
          onPageChange={handlePageChange}
        />
      </div>
    </div>
  )
}
