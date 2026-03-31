/**
 * PaginationBar — shared pagination controls with optional page-size selector.
 *
 * Props:
 *   page            — 0-based current page index
 *   pageSize        — current number of rows per page
 *   totalCount      — total rows across all pages
 *   loading         — bool: disables controls while a fetch is in-flight
 *   onPageChange    — fn(newPage: number)
 *   onPageSizeChange — fn(newPageSize: number) — omit to hide the selector
 *   pageSizeOptions — number[] — available sizes (default: [50, 100, 250, 500, 1000])
 */
const DEFAULT_PAGE_SIZE_OPTIONS = [50, 100, 250, 500, 1000]

export default function PaginationBar({
  page,
  pageSize,
  totalCount,
  loading = false,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}) {
  const totalPages = Math.ceil(totalCount / pageSize)
  const startRow   = totalCount === 0 ? 0 : page * pageSize + 1
  const endRow     = Math.min((page + 1) * pageSize, totalCount)

  if (totalCount === 0 && !onPageSizeChange) return null

  return (
    <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between gap-4 bg-gray-50 flex-wrap">
      {/* ← Previous */}
      <button
        onClick={() => onPageChange(page - 1)}
        disabled={page === 0 || loading}
        className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        ← Previous
      </button>

      {/* Centre: row range + page buttons + page-size selector */}
      <div className="flex items-center gap-3 flex-wrap justify-center">
        {totalCount > 0 && (
          <span className="text-sm text-gray-600 whitespace-nowrap">
            {startRow.toLocaleString()}–{endRow.toLocaleString()} of {totalCount.toLocaleString()}
          </span>
        )}

        {/* Numbered page buttons (≤10 pages) or plain page counter */}
        {totalPages > 1 && (
          totalPages <= 10 ? (
            <div className="flex gap-1">
              {Array.from({ length: totalPages }, (_, i) => (
                <button
                  key={i}
                  onClick={() => onPageChange(i)}
                  disabled={loading}
                  className={`w-7 h-7 text-xs rounded-md ${
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
            <span className="text-sm text-gray-500 whitespace-nowrap">
              Page {page + 1} of {totalPages.toLocaleString()}
            </span>
          )
        )}

        {/* Page-size selector */}
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-sm text-gray-600 whitespace-nowrap">
            <span>Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              disabled={loading}
              className="px-2 py-1 border border-gray-300 rounded-md text-sm bg-white focus:ring-blue-500 focus:border-blue-500 disabled:opacity-40"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {/* Next → */}
      <button
        onClick={() => onPageChange(page + 1)}
        disabled={page >= totalPages - 1 || loading}
        className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        Next →
      </button>
    </div>
  )
}
