import { useState } from 'react'
import SortIcon from './SortIcon'
import PaginationBar from './PaginationBar'

const IMAGE_EXTS = /\.(jpg|jpeg|png|gif|webp|avif|svg|bmp|tiff?)(\?|#|$)/i

function isImageUrl(str) {
  if (!str || typeof str !== 'string') return false
  if (!str.startsWith('http')) return false
  return IMAGE_EXTS.test(str)
}

function ItemCell({ text, subText }) {
  const [broken, setBroken] = useState(false)
  if (isImageUrl(text) && !broken) {
    return (
      <div className="flex items-center gap-2">
        <a href={text} target="_blank" rel="noopener noreferrer">
          <img
            src={text}
            alt=""
            className="w-12 h-12 object-cover rounded border border-gray-200 shrink-0"
            onError={() => setBroken(true)}
          />
        </a>
        <span className="text-xs text-gray-400 truncate max-w-[10rem]" title={text}>
          {text.split('/').pop() || text}
        </span>
      </div>
    )
  }
  return (
    <>
      <span>{text}</span>
      {subText && <p className="text-xs text-gray-400 font-normal mt-0.5">{subText}</p>}
    </>
  )
}

/**
 * GapResultsTable — sortable, paginated gap analysis results.
 *
 * Props
 *   results             — current page rows
 *   totalCount          — total rows across all pages (for PaginationBar)
 *   page / pageSize     — current pagination state
 *   orderBy / orderDir  — current sort state
 *   loading             — dims table while fetching
 *   completedExecs      — [{ execution_id, filter_snapshot }] for filter columns
 *   filterResultsMap    — { exec_id → { keyword_text → bool } }
 *   highlightThreshold  — semantic_distance ≥ this → yellow row
 *   expandedRows        — Set<number> of expanded row indices
 *   sourceColumnLabel   — header for the source item column (default: 'Source Item')
 *   targetColumnLabel   — header for the closest target column (default: 'Closest Match')
 *   showSearchVolume    — whether to show the Searches/mo column (default: true)
 *   onSort(key, dir)
 *   onPageChange(page)
 *   onPageSizeChange(size)
 *   onToggleRow(index)
 */
export default function GapResultsTable({
  results = [],
  totalCount = 0,
  page = 0,
  pageSize = 100,
  orderBy = 'semantic_distance',
  orderDir = 'DESC',
  loading = false,
  completedExecs = [],
  filterResultsMap = {},
  highlightThreshold = 0.2,
  expandedRows = new Set(),
  sourceColumnLabel = 'Source Item',
  targetColumnLabel = 'Closest Match',
  showSearchVolume = true,
  showIntentColumns = false,
  onSort,
  onPageChange,
  onPageSizeChange,
  onToggleRow,
}) {
  const SORT_COLUMNS = [
    { key: 'keyword_text',         label: sourceColumnLabel, descFirst: false },
    ...(showSearchVolume ? [{ key: 'avg_monthly_searches', label: 'Searches/mo', descFirst: true, alignRight: true }] : []),
    { key: 'semantic_distance',    label: 'Distance',        descFirst: true,  alignRight: true },
  ]

  const handleColClick = (col) => {
    if (col.key === orderBy) {
      onSort(col.key, orderDir === 'DESC' ? 'ASC' : 'DESC')
    } else {
      onSort(col.key, col.descFirst ? 'DESC' : 'ASC')
    }
  }

  if (!loading && results.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
        No results match the current filters.
      </div>
    )
  }

  const colSpanCount = SORT_COLUMNS.length + 1 + completedExecs.length

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className={`overflow-x-auto transition-opacity duration-150 ${loading ? 'opacity-50 pointer-events-none' : ''}`}>
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {SORT_COLUMNS.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleColClick(col)}
                  className={`px-4 py-3 font-semibold text-gray-700 select-none cursor-pointer hover:bg-gray-100 ${
                    col.alignRight ? 'text-right whitespace-nowrap' : 'text-left'
                  }`}
                >
                  {col.label}
                  <SortIcon active={orderBy === col.key} dir={orderDir} />
                </th>
              ))}
              <th className="text-left px-4 py-3 font-semibold text-gray-700">{targetColumnLabel}</th>
              {completedExecs.map((e) => (
                <th key={e.execution_id} className="text-center px-3 py-3 font-semibold text-gray-700 whitespace-nowrap">
                  {e.filter_snapshot.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && results.length === 0 ? (
              <tr>
                <td colSpan={colSpanCount} className="px-4 py-8 text-center text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : (
              results.map((row, i) => {
                const isHighlighted = (row.semantic_distance ?? 0) >= highlightThreshold
                const isExpanded    = expandedRows.has(i)
                const closestMatch  = row.portfolio_matches?.[0]
                const hasMultiple   = (row.portfolio_matches?.length ?? 0) > 1

                return (
                  <>
                    <tr
                      key={i}
                      onClick={() => hasMultiple && onToggleRow(i)}
                      className={`${isHighlighted ? 'bg-yellow-50' : 'hover:bg-gray-50'} ${hasMultiple ? 'cursor-pointer' : ''}`}
                    >
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        <ItemCell
                          text={row.keyword_text}
                          subText={showIntentColumns ? row.keyword_intent : null}
                        />
                      </td>
                      {showSearchVolume && (
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                          {row.avg_monthly_searches?.toLocaleString() ?? '—'}
                        </td>
                      )}
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                          isHighlighted ? 'bg-yellow-200 text-yellow-800' : 'text-gray-600'
                        }`}>
                          {row.semantic_distance?.toFixed(3) ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-gray-500">
                        {closestMatch?.item
                          ? <ItemCell text={closestMatch.item} subText={showIntentColumns ? closestMatch.intent : null} />
                          : '—'
                        }
                      </td>
                      {completedExecs.map((e) => {
                        const val = filterResultsMap[e.execution_id]?.[row.keyword_text]
                        return (
                          <td key={e.execution_id} className="px-3 py-2.5 text-center">
                            {val === true ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-green-100 text-green-700 text-xs font-bold">✓</span>
                            ) : val === false ? (
                              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-red-100 text-red-600 text-xs font-bold">✗</span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>

                    {isExpanded && hasMultiple && (
                      <tr key={`${i}-exp`} className={isHighlighted ? 'bg-yellow-50' : 'bg-gray-50'}>
                        <td colSpan={colSpanCount} className="px-4 py-3">
                          <div className="text-xs text-gray-600 space-y-2">
                            {row.portfolio_matches.map((match, idx) => (
                              <div key={idx} className="flex gap-3 items-center">
                                <span className="font-mono text-gray-400 w-14 text-right shrink-0">
                                  {match.distance?.toFixed(3)}
                                </span>
                                {isImageUrl(match.item) ? (
                                  <div className="flex items-center gap-2">
                                    <img
                                      src={match.item}
                                      alt=""
                                      className="w-8 h-8 object-cover rounded border border-gray-200"
                                      onError={e => { e.target.style.display = 'none' }}
                                    />
                                    <span className="text-gray-500 truncate max-w-xs">{match.item.split('/').pop()}</span>
                                  </div>
                                ) : (
                                  <span className="text-gray-600">{match.item}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })
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
