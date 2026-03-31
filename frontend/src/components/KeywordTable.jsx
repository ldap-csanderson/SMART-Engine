import PaginationBar from './PaginationBar'
import SortIcon from './SortIcon'

const COLUMNS = [
  { key: 'source_url',              label: 'URL',                sortable: true, descFirst: false },
  { key: 'keyword_text',            label: 'Keyword',            sortable: true, descFirst: false },
  { key: 'avg_monthly_searches',    label: 'Avg Monthly Searches', sortable: true, descFirst: true },
  { key: 'competition_index',       label: 'Competition',        sortable: true, descFirst: true },
  { key: 'low_top_of_page_bid_usd', label: 'Low Bid (USD)',      sortable: true, descFirst: true },
  { key: 'high_top_of_page_bid_usd',label: 'High Bid (USD)',     sortable: true, descFirst: true },
]

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
  onPageSizeChange,
}) {
  const handleColumnClick = (col) => {
    if (col.key === orderBy) {
      onSort(col.key, orderDir === 'DESC' ? 'ASC' : 'DESC')
    } else {
      onSort(col.key, col.descFirst ? 'DESC' : 'ASC')
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

      <div className={`overflow-x-auto transition-opacity duration-150 ${loading ? 'opacity-50' : 'opacity-100'}`}>
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable && handleColumnClick(col)}
                  className={`px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider select-none ${
                    col.sortable ? 'cursor-pointer hover:bg-gray-100' : ''
                  }`}
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

      <PaginationBar
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        loading={loading}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  )
}
