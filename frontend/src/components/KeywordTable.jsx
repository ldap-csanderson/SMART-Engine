import { useState, useMemo } from 'react'

const COLUMNS = [
  { key: 'url', label: 'URL' },
  { key: 'keyword_text', label: 'Keyword' },
  { key: 'avg_monthly_searches', label: 'Avg Monthly Searches' },
  { key: 'competition_index', label: 'Competition' },
  { key: 'low_top_of_page_bid_usd', label: 'Low Bid (USD)' },
  { key: 'high_top_of_page_bid_usd', label: 'High Bid (USD)' },
]

function SortIcon({ active, dir }) {
  if (!active) {
    return (
      <svg className="inline w-3 h-3 ml-1 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    )
  }
  return dir === 'asc' ? (
    <svg className="inline w-3 h-3 ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
    </svg>
  ) : (
    <svg className="inline w-3 h-3 ml-1 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

export default function KeywordTable({ keywords }) {
  const [sortKey, setSortKey] = useState('avg_monthly_searches')
  const [sortDir, setSortDir] = useState('desc')

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      // numeric cols default desc, text cols default asc
      setSortDir(['avg_monthly_searches', 'competition_index', 'low_top_of_page_bid_usd', 'high_top_of_page_bid_usd'].includes(key) ? 'desc' : 'asc')
    }
  }

  const sorted = useMemo(() => {
    return [...keywords].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]

      // Nulls last regardless of direction
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1

      const cmp = typeof aVal === 'string'
        ? aVal.localeCompare(bVal)
        : aVal - bVal

      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [keywords, sortKey, sortDir])

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">
          Keyword Results ({keywords.length.toLocaleString()} keywords)
        </h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:bg-gray-100"
                >
                  {col.label}
                  <SortIcon active={sortKey === col.key} dir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sorted.map((row, idx) => (
              <tr key={idx} className="hover:bg-gray-50">
                <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                  {row.url}
                </td>
                <td className="px-6 py-4 text-sm font-medium text-gray-900">
                  {row.keyword_text}
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">
                  {row.avg_monthly_searches?.toLocaleString() ?? 'N/A'}
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
  )
}
