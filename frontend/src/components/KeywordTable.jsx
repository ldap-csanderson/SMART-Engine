export default function KeywordTable({ keywords }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">
          Keyword Results ({keywords.length} keywords)
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
            {keywords.map((row, idx) => (
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
  )
}
