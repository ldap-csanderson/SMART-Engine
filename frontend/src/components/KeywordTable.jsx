const COLUMNS = [
  { key: 'source_url', label: 'URL', sortable: true },
  { key: 'keyword_text', label: 'Keyword', sortable: true },
  { key: 'avg_monthly_searches', label: 'Avg Monthly Searches', sortable: true },
  { key: 'competition_index', label: 'Competition', sortable: true },
  { key: 'low_top_of_page_bid_usd', label: 'Low Bid (USD)', sortable: true },
  { key: 'high_top_of_page_bid_usd', label: 'High Bid (USD)', sortable: true },
]

// Columns where DESC is the natural first direction when clicking
const DESC_FIRST = new Set([
  'avg_monthly_searches', 'competition_index',
  'low_top_of_page_bid_usd', 'high_top_of_page_bid_usd',
])

function SortIcon({ active, dir }) {
  if (!active) {
    return (
      <svg className="inline w-3 h-3 ml-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    )
  }
  return dir === 'ASC' ? (
    <svg className="inline w-3 h-3 ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="inline w-3 h-3 ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

export default function KeywordTable({
  keywords,
  totalCount,
  page,
  pageSize,
  orderBy,
  orderDir,
  loading,
  onSort,
  onPageChange,
}) {
  const totalPages = Math.ceil(totalCount / pageSize)
  const startRow = page * pageSize + 1
  const endRow = Math.min((page + 1) * pageSize, totalCount)

  const handleColumnClick = (colKey) => {
    if (colKey === orderBy) {
      // Toggle direction
      onSort(colKey, orderDir === 'DESC' ? 'ASC' : 'DESC')
    } else {
      // New column: pick natural default direction
      onSort(colKey, DESC_FIRST.has(colKey) ? 'DESC' : 'ASC')
    }
  }

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      {/* Table header bar */}
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-xl font-semibold text-gray-900">
          Keyword Results
          {totalCount > 0 && (
            <span className="ml-2 text-base font-normal text-gray-500">
              ({totalCount.toLocaleString()} total)
            </span>
          )}
        </h2>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-blue-600">
            <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading…
          </div>
        )}
      </div>

      {/* Table */}
      <div className={`overflow-x-auto transition-opacity duration-150 ${loading ? 'opacity-50' : 'opacity-100'}`}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && handleColumnClick(col.key)}
                  className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider select-none ${
                    col.sortable ? 'cursor-pointer hover:bg-gray-100' : ''
                  } ${orderBy === col.key ? 'text-blue-600 bg-blue-50' : ''}`}
                >
                  {col.label}
                  {col.sortable && <SortIcon active={orderBy === col.key} dir={orderDir} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {keywords.length === 0 && !loading ? (
              <tr>
                <td colSpan={COLUMNS.length} className="px-6 py-12 text-center text-gray-500">
                  No keywords found
                </td>
              </tr>
            ) : (
              keywords.map((row, idx) => (
                <tr key={idx} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                    {row.source_url}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">
                    {row.keyword_text}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {row.avg_monthly_searches?.toLocaleString() ?? 'N/A'}
                  </td>
                  <td className="px-6 py-4 text-sm">
                    <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                      row.competition === 'LOW'    ? 'bg-green-100 text-green-800' :
                      row.competition === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                      row.competition === 'HIGH'   ? 'bg-red-100 text-red-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {row.competition || 'N/A'}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {row.low_top_of_page_bid_usd != null ? `$${row.low_top_of_page_bid_usd.toFixed(2)}` : 'N/A'}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-900">
                    {row.high_top_of_page_bid_usd != null ? `$${row.high_top_of_page_bid_usd.toFixed(2)}` : 'N/A'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      {totalCount > pageSize && (
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between bg-gray-50">
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0 || loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            ← Previous
          </button>

          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              {startRow.toLocaleString()}–{endRow.toLocaleString()} of {totalCount.toLocaleString()}
            </span>
            {totalPages <= 10 ? (
              <div className="flex gap-1">
                {Array.from({ length: totalPages }, (_, i) => (
                  <button
                    key={i}
                    onClick={() => onPageChange(i)}
                    disabled={loading}
                    className={`w-8 h-8 text-xs rounded-md ${
                      i === page
                        ? 'bg-blue-600 text-white font-semibold'
                        : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                    } disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-sm text-gray-500">
                Page {page + 1} of {totalPages.toLocaleString()}
              </span>
            )}
          </div>

          <button
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages - 1 || loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next →
          </button>
        </div>
      )}
    </div>
  )
}
