import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import RunFiltersModal from '../components/RunFiltersModal'
import EditableTitle from '../components/EditableTitle'

// Three-state toggle: any → true → false → any
function FilterModeToggle({ label, mode, onChange, onDelete }) {
  const options = ['any', 'true', 'false']
  const colors = {
    any: 'bg-gray-100 text-gray-600',
    true: 'bg-green-100 text-green-700',
    false: 'bg-red-100 text-red-700',
  }
  const labels = { any: 'Any', true: '✓ True', false: '✗ False' }

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-gray-700 min-w-[100px] truncate" title={label}>{label}</span>
      <div className="flex rounded-md overflow-hidden border border-gray-300">
        {options.map((opt) => (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              mode === opt ? colors[opt] : 'bg-white text-gray-400 hover:bg-gray-50'
            }`}
          >
            {labels[opt]}
          </button>
        ))}
      </div>
      {onDelete && (
        <button
          onClick={onDelete}
          className="ml-1 text-red-600 hover:text-red-700 text-sm font-bold"
          title="Delete this filter"
        >
          ✕
        </button>
      )}
    </div>
  )
}

export default function GapAnalysisDetailPage() {
  const { analysisId } = useParams()
  const navigate = useNavigate()

  const [analysis, setAnalysis] = useState(null)
  const [executions, setExecutions] = useState([])
  const [filterResultsMap, setFilterResultsMap] = useState({}) // exec_id → {keyword_text → result}
  const [filterModes, setFilterModes] = useState({}) // exec_id → 'any' | 'true' | 'false'

  const [results, setResults] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [resultsLoading, setResultsLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [error, setError] = useState(null)

  const [minSearches, setMinSearches] = useState(1000)
  const [minSearchesInput, setMinSearchesInput] = useState('1000')
  const [highlightThreshold, setHighlightThreshold] = useState(0.2)
  const [highlightInput, setHighlightInput] = useState('0.2')

  const [renaming, setRenaming] = useState(false)
  const [showRunFiltersModal, setShowRunFiltersModal] = useState(false)
  const [portfolioSnapshot, setPortfolioSnapshot] = useState(null)
  const loadedFilterResultsRef = useRef(new Set())
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [copyFormat, setCopyFormat] = useState('md')
  const [showCopied, setShowCopied] = useState(false)

  // Poll executions every 2s while any are processing; load results as they complete
  useEffect(() => {
    if (!executions.some(e => e.status === 'processing')) return
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/gap-analyses/${analysisId}/filter-executions`)
        if (!res.ok) return
        const data = await res.json()
        const fresh = data.executions || []
        setExecutions(fresh)

        // Add filter modes for new executions
        setFilterModes((prev) => {
          const next = { ...prev }
          fresh.forEach((e) => { if (!(e.execution_id in next)) next[e.execution_id] = 'any' })
          return next
        })

        // Load results for newly-completed executions
        const completedIds = fresh.filter(e => e.status === 'completed').map(e => e.execution_id)
        for (const execId of completedIds) {
          if (loadedFilterResultsRef.current.has(execId)) continue
          loadedFilterResultsRef.current.add(execId)
          try {
            const r = await fetch(`/api/gap-analyses/${analysisId}/filter-executions/${execId}/results`)
            const rows = await r.json()
            const map = {}
            rows.forEach((row) => { map[row.keyword_text] = row.result })
            setFilterResultsMap((prev) => ({ ...prev, [execId]: map }))
          } catch (err) {
            console.error('Failed to load filter results for', execId, err)
            loadedFilterResultsRef.current.delete(execId)
          }
        }
      } catch (err) {
        console.error('Poll executions error:', err)
      }
    }, 2000)
    return () => clearTimeout(timer)
  }, [executions, analysisId])

  // Load analysis metadata + filter executions + filter result data on mount
  useEffect(() => {
    const init = async () => {
      setPageLoading(true)
      setError(null)
      try {
        const [analysisRes, execsRes] = await Promise.all([
          fetch(`/api/gap-analyses/${analysisId}`),
          fetch(`/api/gap-analyses/${analysisId}/filter-executions`),
        ])
        if (!analysisRes.ok) throw new Error('Analysis not found')
        const analysisData = await analysisRes.json()
        setAnalysis(analysisData)

        // Init min searches input from the threshold used to generate the analysis
        if (analysisData.min_monthly_searches != null) {
          setMinSearches(analysisData.min_monthly_searches)
          setMinSearchesInput(String(analysisData.min_monthly_searches))
        }

        // Extract portfolio snapshot from analysis
        if (analysisData.portfolio_snapshot) {
          setPortfolioSnapshot(analysisData.portfolio_snapshot)
        }

        const execsData = execsRes.ok ? await execsRes.json() : { executions: [] }
        const execs = execsData.executions || []
        setExecutions(execs)

        // Init filter modes to 'any'
        const modes = {}
        execs.forEach((e) => { modes[e.execution_id] = 'any' })
        setFilterModes(modes)

        // Load filter result data for completed executions
        const completedExecs = execs.filter((e) => e.status === 'completed')
        if (completedExecs.length > 0) {
          const resultPromises = completedExecs.map((e) =>
            fetch(`/api/gap-analyses/${analysisId}/filter-executions/${e.execution_id}/results`)
              .then((r) => r.ok ? r.json() : [])
              .then((rows) => {
                const map = {}
                rows.forEach((row) => { map[row.keyword_text] = row.result })
                loadedFilterResultsRef.current.add(e.execution_id)
                return [e.execution_id, map]
              })
          )
          const resolvedMaps = await Promise.all(resultPromises)
          const combined = {}
          resolvedMaps.forEach(([execId, map]) => { combined[execId] = map })
          setFilterResultsMap(combined)
        }
      } catch (err) {
        setError(err.message)
      } finally {
        setPageLoading(false)
      }
    }
    init()
  }, [analysisId])

  // Build results query URL from current filter modes
  const buildResultsUrl = useCallback(() => {
    const params = new URLSearchParams()
    params.set('limit', '100000')
    params.set('order_by', 'semantic_distance')
    params.set('order_dir', 'DESC')
    Object.entries(filterModes).forEach(([execId, mode]) => {
      if (mode === 'true') params.append('filter_execution_ids', execId)
      else if (mode === 'false') params.append('filter_execution_ids_false', execId)
    })
    return `/api/gap-analyses/${analysisId}/results?${params.toString()}`
  }, [analysisId, filterModes])

  // Fetch results whenever the query URL actually changes (not just any filterModes mutation)
  const [filterModesReady, setFilterModesReady] = useState(false)
  const [lastUrl, setLastUrl] = useState('')
  
  useEffect(() => {
    if (Object.keys(filterModes).length > 0 || !pageLoading) {
      setFilterModesReady(true)
    }
  }, [filterModes, pageLoading])

  useEffect(() => {
    if (!filterModesReady && pageLoading) return
    if (!analysis) return
    const url = buildResultsUrl()
    if (url === lastUrl) return // Don't refetch if URL hasn't changed
    setLastUrl(url)
    
    const fetchResults = async () => {
      setResultsLoading(true)
      try {
        const res = await fetch(url)
        if (!res.ok) throw new Error('Failed to load results')
        const data = await res.json()
        setResults(data.results || [])
        setTotalCount(data.total_count || 0)
      } catch (err) {
        console.error('Results fetch error:', err)
      } finally {
        setResultsLoading(false)
      }
    }
    fetchResults()
  }, [filterModes, analysis, filterModesReady, buildResultsUrl, lastUrl])

  const handleFilterModeChange = (execId, mode) => {
    setFilterModes((prev) => ({ ...prev, [execId]: mode }))
  }

  const handleDeleteFilter = async (execId, filterName) => {
    if (!window.confirm(`Delete filter "${filterName}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/gap-analyses/${analysisId}/filter-executions/${execId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete filter')
      
      // Remove from local state
      setExecutions((prev) => prev.filter((e) => e.execution_id !== execId))
      setFilterModes((prev) => {
        const next = { ...prev }
        delete next[execId]
        return next
      })
      setFilterResultsMap((prev) => {
        const next = { ...prev }
        delete next[execId]
        return next
      })
      loadedFilterResultsRef.current.delete(execId)
    } catch (err) {
      alert(`Error deleting filter: ${err.message}`)
    }
  }

  const handleRename = async (newName) => {
    setRenaming(true)
    try {
      const res = await fetch(`/api/gap-analyses/${analysisId}/rename`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      if (!res.ok) throw new Error('Failed to rename analysis')
      setAnalysis((prev) => ({ ...prev, name: newName }))
    } catch (err) {
      console.error('Rename failed:', err)
    } finally {
      setRenaming(false)
    }
  }

  const handleMinSearchesBlur = () => {
    const v = parseInt(minSearchesInput, 10)
    if (!isNaN(v) && v >= 0) setMinSearches(v)
    else setMinSearchesInput(String(minSearches))
  }

  const handleHighlightBlur = () => {
    const v = parseFloat(highlightInput)
    if (!isNaN(v) && v >= 0 && v <= 1) setHighlightThreshold(v)
    else setHighlightInput(String(highlightThreshold))
  }

  const toggleRow = (idx) => {
    setExpandedRows((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
      } else {
        next.add(idx)
      }
      return next
    })
  }

  const handleCopyToClipboard = () => {
    let text = ''
    if (copyFormat === 'md') {
      text = '| Keyword | Searches/mo | Distance | Closest Portfolio Item |\n'
      text += '|---------|-------------|----------|------------------------|\n'
      displayedResults.forEach((r) => {
        const kw = r.keyword_text || '—'
        const searches = r.avg_monthly_searches?.toLocaleString() || '—'
        const dist = r.semantic_distance?.toFixed(3) || '—'
        const item = r.portfolio_matches?.[0]?.item || '—'
        text += `| ${kw} | ${searches} | ${dist} | ${item} |\n`
      })
    } else if (copyFormat === 'csv') {
      text = 'keyword,searches_per_month,distance,closest_portfolio_item\n'
      displayedResults.forEach((r) => {
        const kw = (r.keyword_text || '').replace(/"/g, '""')
        const searches = r.avg_monthly_searches || ''
        const dist = r.semantic_distance?.toFixed(3) || ''
        const item = (r.portfolio_matches?.[0]?.item || '').replace(/"/g, '""')
        text += `"${kw}",${searches},${dist},"${item}"\n`
      })
    } else if (copyFormat === 'json') {
      const data = displayedResults.map((r) => ({
        keyword: r.keyword_text,
        searches_per_month: r.avg_monthly_searches,
        distance: r.semantic_distance,
        closest_portfolio_item: r.portfolio_matches?.[0]?.item || null,
        portfolio_matches: r.portfolio_matches || []
      }))
      text = JSON.stringify(data, null, 2)
    }

    navigator.clipboard.writeText(text).then(() => {
      setShowCopied(true)
      setTimeout(() => setShowCopied(false), 2000)
    }).catch((err) => {
      console.error('Copy failed:', err)
      alert('Failed to copy to clipboard')
    })
  }

  // Client-side min_searches filter
  const displayedResults = results.filter(
    (r) => (r.avg_monthly_searches ?? 0) >= minSearches
  )

  // Completed executions for table columns
  const completedExecs = executions.filter((e) => e.status === 'completed')

  if (pageLoading) {
    return (
      <div className="bg-gray-50">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading analysis…</p>
          </div>
        </div>
      </div>
    )
  }

  if (error || !analysis) {
    return (
      <div className="bg-gray-50">
        <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow p-8">
            <p className="text-red-600 font-semibold mb-4">{error || 'Analysis not found'}</p>
            <button onClick={() => navigate('/gap-analyses')} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
              ← Back to Gap Analyses
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-50">
      <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Back + header */}
        <div className="mb-6">
          <button
            onClick={() => navigate('/gap-analyses')}
            className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium mb-3"
          >
            <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Gap Analyses
          </button>
          <EditableTitle value={analysis.name} onSave={handleRename} saving={renaming} />
          <div className="flex items-center gap-2 text-sm text-gray-600 mt-1">
            <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${
              analysis.status === 'completed' ? 'bg-green-100 text-green-800' :
              analysis.status === 'processing' ? 'bg-blue-100 text-blue-800' :
              analysis.status === 'failed' ? 'bg-red-100 text-red-800' :
              'bg-gray-100 text-gray-800'
            }`}>
              {analysis.status === 'processing' ? 'In Progress' : analysis.status}
            </span>
            <span>·</span>
            <span>{totalCount.toLocaleString()} keywords</span>
            {analysis.min_monthly_searches != null && (
              <>
                <span>·</span>
                <span>{analysis.min_monthly_searches.toLocaleString()} min. monthly searches</span>
              </>
            )}
            {executions.length > 0 && (
              <>
                <span>·</span>
                <span>{executions.length} filter{executions.length > 1 ? 's' : ''}</span>
              </>
            )}
          </div>
        </div>

        {/* Controls panel */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="flex flex-wrap gap-6 items-start">
            {/* Filter to toggles */}
            {completedExecs.length > 0 && (
              <div className="flex-1 min-w-[260px]">
                <p className="text-sm font-semibold text-gray-700 mb-2">Filters</p>
                <div className="flex items-center gap-1 mb-2">
                  <span className="text-xs text-gray-500 mr-1">Set all:</span>
                  <button
                    onClick={() => {
                      const modes = {}
                      completedExecs.forEach(e => { modes[e.execution_id] = 'any' })
                      setFilterModes(modes)
                    }}
                    className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200 border border-gray-300"
                  >
                    Any
                  </button>
                  <button
                    onClick={() => {
                      const modes = {}
                      completedExecs.forEach(e => { modes[e.execution_id] = 'true' })
                      setFilterModes(modes)
                    }}
                    className="px-2 py-0.5 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200 border border-green-300"
                  >
                    True
                  </button>
                  <button
                    onClick={() => {
                      const modes = {}
                      completedExecs.forEach(e => { modes[e.execution_id] = 'false' })
                      setFilterModes(modes)
                    }}
                    className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 border border-red-300"
                  >
                    False
                  </button>
                </div>
                <div className="space-y-2 mb-2">
                  {completedExecs.map((e) => (
                    <FilterModeToggle
                      key={e.execution_id}
                      label={e.filter_snapshot.name}
                      mode={filterModes[e.execution_id] || 'any'}
                      onChange={(mode) => handleFilterModeChange(e.execution_id, mode)}
                      onDelete={() => handleDeleteFilter(e.execution_id, e.filter_snapshot.name)}
                    />
                  ))}
                </div>
                <button
                  onClick={() => setShowRunFiltersModal(true)}
                  className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 focus:outline-none border border-gray-300"
                >
                  + Run More Filters
                </button>
                {executions.filter(e => e.status === 'processing').length > 0 && (
                  <p className="text-xs text-blue-500 mt-2">
                    Processing: {executions.filter(e => e.status === 'processing').map(e => e.filter_snapshot.name).join(', ')}
                  </p>
                )}
              </div>
            )}
            {completedExecs.length === 0 && (
              <div className="flex-1 min-w-[260px]">
                <p className="text-sm font-semibold text-gray-700 mb-2">Filters</p>
                {executions.filter(e => e.status === 'processing').length > 0 ? (
                  <p className="text-xs text-blue-500 mb-2">
                    Processing: {executions.filter(e => e.status === 'processing').map(e => e.filter_snapshot.name).join(', ')}
                  </p>
                ) : (
                  <p className="text-sm text-gray-400 italic mb-2">No filters run yet.</p>
                )}
                <button
                  onClick={() => setShowRunFiltersModal(true)}
                  className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 focus:outline-none border border-gray-300"
                >
                  + Run More Filters
                </button>
              </div>
            )}

            {/* Min searches — wrapped in a form so the browser shows its native
                constraint-validation tooltip when the value is below the min */}
            {(() => {
              const analysisMinSearches = analysis?.min_monthly_searches ?? 0
              return (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Min. Monthly Searches
                  </label>
                  <form onSubmit={(e) => { e.preventDefault(); handleMinSearchesBlur() }}>
                    <input
                      type="number"
                      min={analysisMinSearches > 0 ? analysisMinSearches : 0}
                      className="w-28 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                      value={minSearchesInput}
                      onChange={(e) => setMinSearchesInput(e.target.value)}
                      onBlur={(e) => e.target.form.requestSubmit()}
                    />
                  </form>
                  <p className="text-xs text-gray-400 mt-0.5">Applied client-side</p>
                </div>
              )
            })()}

            {/* Highlight threshold */}
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1">
                Highlight Threshold
              </label>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                className="w-24 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                value={highlightInput}
                onChange={(e) => setHighlightInput(e.target.value)}
                onBlur={handleHighlightBlur}
                onKeyDown={(e) => e.key === 'Enter' && handleHighlightBlur()}
              />
              <p className="text-xs text-gray-400 mt-0.5">Distance ≥ this → highlighted</p>
            </div>

            {/* Copy + Counts */}
            <div className="self-end pb-0.5 text-right relative">
              <div className="flex items-center justify-end gap-2 mb-2">
                <span className="text-xs text-gray-500">Copy:</span>
                <div className="flex rounded-md overflow-hidden border border-gray-300">
                  {['md', 'csv', 'json'].map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => {
                        setCopyFormat(fmt)
                        handleCopyToClipboard()
                      }}
                      className="px-2 py-0.5 text-xs font-medium bg-white text-gray-600 hover:bg-gray-50 transition-colors"
                    >
                      {fmt.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <p className="text-sm text-gray-500">
                <span className="font-semibold text-gray-900">{displayedResults.length.toLocaleString()}</span> rows shown
                {displayedResults.length !== results.length && (
                  <span className="text-gray-400"> (of {results.length.toLocaleString()} loaded)</span>
                )}
              </p>
              {showCopied && (
                <div className="absolute top-0 right-0 -mt-6 bg-green-600 text-white text-xs px-2 py-1 rounded shadow">
                  Copied!
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Results table */}
        {resultsLoading ? (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-500">Loading results…</p>
          </div>
        ) : displayedResults.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            No results match the current filters.
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Keyword</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Searches/mo</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-700 whitespace-nowrap">Distance</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Closest Portfolio Item</th>
                  {completedExecs.map((e) => (
                    <th key={e.execution_id} className="text-center px-3 py-3 font-semibold text-gray-700 whitespace-nowrap">
                      {e.filter_snapshot.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayedResults.map((row, i) => {
                  const isHighlighted = (row.semantic_distance ?? 0) >= highlightThreshold
                  const isExpanded = expandedRows.has(i)
                  const closestMatch = row.portfolio_matches?.[0]
                  const hasMultipleMatches = row.portfolio_matches && row.portfolio_matches.length > 1

                  return (
                    <>
                      <tr
                        key={i}
                        onClick={() => hasMultipleMatches && toggleRow(i)}
                        className={`${isHighlighted ? 'bg-yellow-50' : 'hover:bg-gray-50'} ${hasMultipleMatches ? 'cursor-pointer' : ''}`}
                      >
                        <td className="px-4 py-2.5 font-medium text-gray-900">{row.keyword_text}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">
                          {row.avg_monthly_searches?.toLocaleString() ?? '—'}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums">
                          <span className={`font-mono text-xs px-1.5 py-0.5 rounded ${
                            isHighlighted ? 'bg-yellow-200 text-yellow-800' : 'text-gray-600'
                          }`}>
                            {row.semantic_distance?.toFixed(3) ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-gray-500 max-w-xs truncate" title={closestMatch?.item}>
                          {closestMatch?.item || '—'}
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
                      {isExpanded && hasMultipleMatches && (
                        <tr key={`${i}-expanded`} className={isHighlighted ? 'bg-yellow-50' : 'bg-gray-50'}>
                          <td colSpan={4 + completedExecs.length} className="px-4 py-3">
                            <div className="text-xs text-gray-600 space-y-1">
                              {row.portfolio_matches.map((match, idx) => (
                                <div key={idx} className="flex gap-3">
                                  <span className="font-mono text-gray-400 w-14 text-right shrink-0">
                                    {match.distance?.toFixed(3)}
                                  </span>
                                  <span className="text-gray-600">{match.item}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <RunFiltersModal
          isOpen={showRunFiltersModal}
          onClose={() => setShowRunFiltersModal(false)}
          keywordCount={analysis?.total_keywords_analyzed ?? 0}
          onSubmit={async () => {
            setShowRunFiltersModal(false)
            // Immediately fetch updated executions so polling starts
            try {
              const res = await fetch(`/api/gap-analyses/${analysisId}/filter-executions`)
              if (res.ok) {
                const data = await res.json()
                setExecutions(data.executions || [])
              }
            } catch (err) {
              console.error('Failed to refresh executions after filter submit:', err)
            }
          }}
          analysisId={analysisId}
          existingExecutions={executions}
        />
      </div>
    </div>
  )
}
