import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import RunFiltersModal from '../components/RunFiltersModal'
import EditableTitle from '../components/EditableTitle'
import GapResultsTable from '../components/GapResultsTable'
import ChatPanel from '../components/ChatPanel'
import API_BASE from '../config'

const SEARCH_VOLUME_TYPES = new Set(['google_ads_keywords', 'google_ads_keyword_planner'])

function FilterModeToggle({ label, mode, onChange, onDelete }) {
  const options = ['any', 'true', 'false']
  const colors = { any: 'bg-gray-100 text-gray-600', true: 'bg-green-100 text-green-700', false: 'bg-red-100 text-red-700' }
  const labels = { any: 'Any', true: '✓ True', false: '✗ False' }
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-gray-700 min-w-[100px] truncate" title={label}>{label}</span>
      <div className="flex rounded-md overflow-hidden border border-gray-300">
        {options.map((opt) => (
          <button key={opt} onClick={() => onChange(opt)} className={`px-2.5 py-1 text-xs font-medium transition-colors ${mode === opt ? colors[opt] : 'bg-white text-gray-400 hover:bg-gray-50'}`}>{labels[opt]}</button>
        ))}
      </div>
      {onDelete && <button onClick={onDelete} className="ml-1 text-red-600 hover:text-red-700 text-sm font-bold" title="Delete this filter">✕</button>}
    </div>
  )
}

export default function GapAnalysisDetailPage() {
  const { analysisId } = useParams()
  const navigate = useNavigate()

  const [analysis, setAnalysis] = useState(null)
  const [executions, setExecutions] = useState([])
  const [filterResultsMap, setFilterResultsMap] = useState({})
  const [filterModes, setFilterModes] = useState({})
  const [availableFilters, setAvailableFilters] = useState([])

  const [results, setResults] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [resultsLoading, setResultsLoading] = useState(false)
  const [pageLoading, setPageLoading] = useState(true)
  const [error, setError] = useState(null)

  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [orderBy, setOrderBy] = useState('semantic_distance')
  const [orderDir, setOrderDir] = useState('DESC')

  const [minSearches, setMinSearches] = useState(0)
  const [minSearchesInput, setMinSearchesInput] = useState('0')
  const [highlightThreshold, setHighlightThreshold] = useState(0.2)
  const [highlightInput, setHighlightInput] = useState('0.2')

  const [renaming, setRenaming] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [showRunFiltersModal, setShowRunFiltersModal] = useState(false)
  const [deleteModal, setDeleteModal] = useState(false)
  const loadedFilterResultsRef = useRef(new Set())
  const [expandedRows, setExpandedRows] = useState(new Set())
  const [showCopied, setShowCopied] = useState(false)

  // Chat panel
  const [chatOpen, setChatOpen] = useState(false)
  const [agentModel, setAgentModel] = useState('gemini-2.5-flash')

  // Load agent model + available filters once
  useEffect(() => {
    fetch(`${API_BASE}/api/settings/agent`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.model) setAgentModel(d.model) })
      .catch(() => {})
    fetch(`${API_BASE}/api/filters`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.filters) setAvailableFilters(d.filters) })
      .catch(() => {})
  }, [])

  // Poll analysis status while processing
  useEffect(() => {
    if (!analysis || analysis.status !== 'processing') return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/gap-analyses/${analysisId}`)
        if (!res.ok) return
        setAnalysis(await res.json())
      } catch (err) { console.error('Poll analysis status error:', err) }
    }, 4000)
    return () => clearInterval(interval)
  }, [analysis?.status, analysisId])

  // Poll executions while any are processing
  useEffect(() => {
    if (!executions.some((e) => e.status === 'processing')) return
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`${API_BASE}/api/gap-analyses/${analysisId}/filter-executions`)
        if (!res.ok) return
        const data = await res.json()
        const fresh = data.executions || []
        setExecutions(fresh)
        setFilterModes((prev) => {
          const next = { ...prev }
          fresh.forEach((e) => { if (!(e.execution_id in next)) next[e.execution_id] = 'any' })
          return next
        })
        const completedIds = fresh.filter((e) => e.status === 'completed').map((e) => e.execution_id)
        for (const execId of completedIds) {
          if (loadedFilterResultsRef.current.has(execId)) continue
          loadedFilterResultsRef.current.add(execId)
          try {
            const r = await fetch(`${API_BASE}/api/gap-analyses/${analysisId}/filter-executions/${execId}/results`)
            const rows = await r.json()
            const map = {}
            rows.forEach((row) => { map[row.keyword_text] = row.result })
            setFilterResultsMap((prev) => ({ ...prev, [execId]: map }))
          } catch (err) { loadedFilterResultsRef.current.delete(execId) }
        }
      } catch (err) { console.error('Poll executions error:', err) }
    }, 2000)
    return () => clearTimeout(timer)
  }, [executions, analysisId])

  // Init: load analysis + executions + filter results
  useEffect(() => {
    const init = async () => {
      setPageLoading(true)
      setError(null)
      try {
        const [analysisRes, execsRes] = await Promise.all([
          fetch(`${API_BASE}/api/gap-analyses/${analysisId}`),
          fetch(`${API_BASE}/api/gap-analyses/${analysisId}/filter-executions`),
        ])
        if (!analysisRes.ok) throw new Error('Analysis not found')
        const analysisData = await analysisRes.json()
        setAnalysis(analysisData)

        if (analysisData.min_monthly_searches != null && SEARCH_VOLUME_TYPES.has(analysisData.source_dataset_type)) {
          setMinSearches(analysisData.min_monthly_searches)
          setMinSearchesInput(String(analysisData.min_monthly_searches))
        }

        const execsData = execsRes.ok ? await execsRes.json() : { executions: [] }
        const execs = execsData.executions || []
        setExecutions(execs)
        const modes = {}
        execs.forEach((e) => { modes[e.execution_id] = 'any' })
        setFilterModes(modes)

        const completedExecs = execs.filter((e) => e.status === 'completed')
        if (completedExecs.length > 0) {
          const resolved = await Promise.all(
            completedExecs.map((e) =>
              fetch(`${API_BASE}/api/gap-analyses/${analysisId}/filter-executions/${e.execution_id}/results`)
                .then((r) => r.ok ? r.json() : [])
                .then((rows) => {
                  const map = {}
                  rows.forEach((row) => { map[row.keyword_text] = row.result })
                  loadedFilterResultsRef.current.add(e.execution_id)
                  return [e.execution_id, map]
                })
            )
          )
          const combined = {}
          resolved.forEach(([execId, map]) => { combined[execId] = map })
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

  const buildResultsUrl = useCallback(() => {
    const params = new URLSearchParams()
    params.set('limit', String(pageSize))
    params.set('offset', String(page * pageSize))
    params.set('order_by', orderBy)
    params.set('order_dir', orderDir)
    if (minSearches > 0) params.set('min_monthly_searches', String(minSearches))
    Object.entries(filterModes).forEach(([execId, mode]) => {
      if (mode === 'true') params.append('filter_execution_ids', execId)
      else if (mode === 'false') params.append('filter_execution_ids_false', execId)
    })
    return `${API_BASE}/api/gap-analyses/${analysisId}/results?${params.toString()}`
  }, [analysisId, filterModes, page, pageSize, orderBy, orderDir, minSearches])

  useEffect(() => {
    if (pageLoading || !analysis) return
    const controller = new AbortController()
    const fetchResults = async () => {
      try {
        const url = buildResultsUrl()
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error('Failed to load results')
        const data = await res.json()
        setResults(data.results || [])
        setTotalCount(data.total_count || 0)
      } catch (err) {
        if (err.name === 'AbortError') return
        console.error('Results fetch error:', err)
      } finally {
        if (!controller.signal.aborted) setResultsLoading(false)
      }
    }
    fetchResults()
    return () => controller.abort()
  }, [pageLoading, analysis, buildResultsUrl])

  const handleFilterModeChange = (execId, mode) => {
    setResultsLoading(true)
    setFilterModes((prev) => ({ ...prev, [execId]: mode }))
    setPage(0)
    setExpandedRows(new Set())
  }

  const handleSetAllFilterModes = (mode) => {
    setResultsLoading(true)
    const modes = {}
    completedExecs.forEach((e) => { modes[e.execution_id] = mode })
    setFilterModes(modes)
    setPage(0)
    setExpandedRows(new Set())
  }

  const handleSort = (newOrderBy, newOrderDir) => {
    setResultsLoading(true); setOrderBy(newOrderBy); setOrderDir(newOrderDir); setPage(0); setExpandedRows(new Set())
  }
  const handlePageChange = (newPage) => {
    setResultsLoading(true); setPage(newPage); setExpandedRows(new Set()); window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const handlePageSizeChange = (newSize) => {
    setResultsLoading(true); setPageSize(newSize); setPage(0); setExpandedRows(new Set())
  }

  const handleDeleteFilter = async (execId, filterName) => {
    if (!window.confirm(`Delete filter "${filterName}"? This cannot be undone.`)) return
    const prevExecutions = executions, prevModes = filterModes, prevMap = filterResultsMap
    setExecutions((prev) => prev.filter((e) => e.execution_id !== execId))
    setFilterModes((prev) => { const next = { ...prev }; delete next[execId]; return next })
    setFilterResultsMap((prev) => { const next = { ...prev }; delete next[execId]; return next })
    loadedFilterResultsRef.current.delete(execId)
    try {
      const res = await fetch(`${API_BASE}/api/gap-analyses/${analysisId}/filter-executions/${execId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete filter')
    } catch (err) {
      setExecutions(prevExecutions); setFilterModes(prevModes); setFilterResultsMap(prevMap)
      loadedFilterResultsRef.current.add(execId)
      alert(`Error deleting filter: ${err.message}`)
    }
  }

  const confirmDelete = () => {
    setDeleteModal(false)
    navigate('/gap-analyses', { state: { deletedId: analysisId } })
    fetch(`${API_BASE}/api/gap-analyses/${analysisId}`, { method: 'DELETE' }).catch(console.error)
  }

  const handleRename = async (newName) => {
    setRenaming(true)
    try {
      const res = await fetch(`${API_BASE}/api/gap-analyses/${analysisId}/rename`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newName }),
      })
      if (!res.ok) throw new Error('Failed to rename analysis')
      setAnalysis((prev) => ({ ...prev, name: newName }))
    } catch (err) { console.error('Rename failed:', err) }
    finally { setRenaming(false) }
  }

  const handleRetry = async () => {
    setRetrying(true)
    try {
      const res = await fetch(`${API_BASE}/api/gap-analyses/${analysisId}/retry`, { method: 'POST' })
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed to retry') }
      setAnalysis(await res.json())
    } catch (err) { alert(`Retry failed: ${err.message}`) }
    finally { setRetrying(false) }
  }

  const handleMinSearchesBlur = () => {
    const v = parseInt(minSearchesInput, 10)
    if (!isNaN(v) && v >= 0) { setResultsLoading(true); setMinSearches(v); setPage(0); setExpandedRows(new Set()) }
    else setMinSearchesInput(String(minSearches))
  }

  const handleHighlightBlur = () => {
    const v = parseFloat(highlightInput)
    if (!isNaN(v) && v >= 0 && v <= 1) setHighlightThreshold(v)
    else setHighlightInput(String(highlightThreshold))
  }

  const toggleRow = (idx) => {
    setExpandedRows((prev) => { const next = new Set(prev); next.has(idx) ? next.delete(idx) : next.add(idx); return next })
  }

  const handleCopyToClipboard = (fmt) => {
    const srcName = analysis?.source_dataset_name || 'Source'
    const tgtName = analysis?.target_dataset_name || 'Target'
    let text = ''
    if (fmt === 'md') {
      text = `| ${srcName} | Searches/mo | Distance | Closest in ${tgtName} |\n|---------|-------------|----------|------------------------|\n`
      results.forEach((r) => { text += `| ${r.keyword_text || '—'} | ${r.avg_monthly_searches?.toLocaleString() || '—'} | ${r.semantic_distance?.toFixed(3) || '—'} | ${r.portfolio_matches?.[0]?.item || '—'} |\n` })
    } else if (fmt === 'csv') {
      text = `source_item,searches_per_month,distance,closest_target_item\n`
      results.forEach((r) => { const kw = (r.keyword_text || '').replace(/"/g, '""'); const item = (r.portfolio_matches?.[0]?.item || '').replace(/"/g, '""'); text += `"${kw}",${r.avg_monthly_searches || ''},${r.semantic_distance?.toFixed(3) || ''},"${item}"\n` })
    } else if (fmt === 'json') {
      text = JSON.stringify(results.map((r) => ({ source_item: r.keyword_text, searches_per_month: r.avg_monthly_searches, distance: r.semantic_distance, closest_target_item: r.portfolio_matches?.[0]?.item || null, target_matches: r.portfolio_matches || [] })), null, 2)
    }
    navigator.clipboard.writeText(text).then(() => { setShowCopied(true); setTimeout(() => setShowCopied(false), 2000) }).catch(() => alert('Failed to copy'))
  }

  // ── Chat callbacks ────────────────────────────────────────────────────────

  // Peek: return current visible results as rows for the agent
  const getPeekRows = useCallback(async (n) => {
    return results.slice(0, n).map(r => ({
      keyword_text: r.keyword_text || '',
      semantic_distance: r.semantic_distance?.toFixed(4) || '',
      avg_monthly_searches: r.avg_monthly_searches ?? '',
      closest_match: r.portfolio_matches?.[0]?.item || '',
    }))
  }, [results])

  // Toggle filter: update filterModes from agent
  const handleAgentToggleFilter = useCallback((executionId, mode) => {
    handleFilterModeChange(executionId, mode)
  }, [])

  // Create filter execution: agent proposes running a filter
  const handleAgentCreateFilter = useCallback(async (filterId, filterName) => {
    const res = await fetch(`${API_BASE}/api/gap-analyses/${analysisId}/filter-executions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filter_ids: [filterId], filter_min_distance: highlightThreshold }),
    })
    if (!res.ok) {
      const d = await res.json()
      throw new Error(d.detail || 'Failed to run filter')
    }
    const newExecs = await res.json()
    setExecutions(prev => {
      const next = [...prev]
      newExecs.forEach(e => {
        if (!next.find(x => x.execution_id === e.execution_id)) next.unshift(e)
      })
      return next
    })
    setFilterModes(prev => {
      const next = { ...prev }
      newExecs.forEach(e => { next[e.execution_id] = 'any' })
      return next
    })
  }, [analysisId, highlightThreshold])

  const completedExecs = executions.filter((e) => e.status === 'completed')
  const failedExecs = executions.filter((e) => e.status === 'failed')
  const showSearchVolumeControls = analysis && SEARCH_VOLUME_TYPES.has(analysis.source_dataset_type)

  // Gap context for chat agent
  const gapContext = {
    executions: completedExecs.map(e => ({
      id: e.execution_id,
      name: e.filter_snapshot?.name || e.execution_id,
      current_mode: filterModes[e.execution_id] || 'any',
    })),
    availableFilters: availableFilters
      .filter(f => !completedExecs.some(e => e.filter_id === f.filter_id || e.filter_snapshot?.name === f.name))
      .map(f => ({ id: f.filter_id, name: f.name })),
  }

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
            <button onClick={() => navigate('/gap-analyses')} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">← Back to Gap Analyses</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-50">
      <div className="max-w-full mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Back + header */}
        <div className="mb-6">
          <button onClick={() => navigate('/gap-analyses')} className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium mb-3">
            <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to Gap Analyses
          </button>
          <div className="flex items-start justify-between">
            <div>
              <EditableTitle value={analysis.name} onSave={handleRename} saving={renaming} />
            </div>
            <div className="flex items-center gap-2 ml-4 shrink-0">
              {analysis.status === 'completed' && (
                <button
                  onClick={() => setChatOpen(o => !o)}
                  className={`text-sm px-3 py-1.5 rounded-lg border font-medium transition-colors ${chatOpen ? 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700' : 'bg-white text-purple-700 border-purple-300 hover:bg-purple-50'}`}
                >
                  {chatOpen ? '✕ Close Analysis' : '✨ Analyze'}
                </button>
              )}
              {analysis.status === 'failed' && (
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  className="text-sm px-3 py-1.5 rounded-lg border font-medium bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100 disabled:opacity-50"
                >
                  {retrying ? 'Retrying…' : '↺ Retry'}
                </button>
              )}
              <button onClick={() => setDeleteModal(true)} className="text-sm text-red-500 hover:text-red-700 border border-red-200 px-3 py-1.5 rounded-lg">Delete</button>
            </div>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600 mt-1 flex-wrap">
            <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${analysis.status === 'completed' ? 'bg-green-100 text-green-800' : analysis.status === 'processing' ? 'bg-blue-100 text-blue-800' : analysis.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
              {analysis.status === 'processing' ? 'In Progress' : analysis.status}
            </span>
            {analysis.use_intent_normalization != null && (
              <span className={`inline-flex px-2 py-0.5 text-xs font-semibold rounded-full ${analysis.use_intent_normalization ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-500'}`}>
                {analysis.use_intent_normalization ? 'Intent normalized' : 'Direct comparison'}
              </span>
            )}
            <span>·</span>
            <span>{analysis.status === 'processing' ? '—' : `${totalCount.toLocaleString()} items`}</span>
            <span>·</span>
            <span className="text-gray-500">
              <span className="font-medium text-gray-700">{analysis.source_dataset_name}</span>{' → '}
              <span className="font-medium text-gray-700">{analysis.target_dataset_name}</span>
              {analysis.target_is_group && <span className="text-xs text-gray-400 ml-1">(group)</span>}
            </span>
            {executions.length > 0 && (<><span>·</span><span>{executions.length} filter{executions.length > 1 ? 's' : ''}</span></>)}
          </div>
        </div>

        {analysis.status === 'processing' ? (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mb-4" />
            <p className="text-gray-700 font-medium">Analysis in progress…</p>
            <p className="text-sm text-gray-400 mt-1">
              {analysis.total_items_analyzed > 0 ? `Running embedding pipeline on ${analysis.total_items_analyzed.toLocaleString()} items.` : 'Running embedding pipeline. This may take several minutes.'}
            </p>
          </div>
        ) : analysis.status === 'failed' ? (
          <div className="bg-white rounded-lg shadow p-8">
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-gray-900 mb-1">Analysis failed</h3>
                {analysis.error_message && (
                  <pre className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-3 overflow-auto max-h-40 whitespace-pre-wrap mb-4">{analysis.error_message}</pre>
                )}
                <button
                  onClick={handleRetry}
                  disabled={retrying}
                  className="px-4 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-50"
                >
                  {retrying ? 'Retrying…' : '↺ Retry Analysis'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex gap-4 items-start">
            {/* Main content */}
            <div className={chatOpen ? 'flex-1 min-w-0' : 'w-full'}>
              {/* Controls panel */}
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <div className="flex flex-wrap gap-6 items-start">
                  {/* Filter toggles */}
                  {completedExecs.length > 0 && (
                    <div className="flex-1 min-w-[260px]">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Filters</p>
                      <div className="flex items-center gap-1 mb-2">
                        <span className="text-xs text-gray-500 mr-1">Set all:</span>
                        {['any', 'true', 'false'].map((mode) => (
                          <button key={mode} onClick={() => handleSetAllFilterModes(mode)} className={`px-2 py-0.5 text-xs rounded border ${mode === 'any' ? 'bg-gray-100 text-gray-600 border-gray-300 hover:bg-gray-200' : mode === 'true' ? 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200' : 'bg-red-100 text-red-700 border-red-300 hover:bg-red-200'}`}>
                            {mode === 'any' ? 'Any' : mode === 'true' ? 'True' : 'False'}
                          </button>
                        ))}
                      </div>
                      <div className="space-y-2 mb-2">
                        {completedExecs.map((e) => (
                          <FilterModeToggle key={e.execution_id} label={e.filter_snapshot.name} mode={filterModes[e.execution_id] || 'any'} onChange={(mode) => handleFilterModeChange(e.execution_id, mode)} onDelete={() => handleDeleteFilter(e.execution_id, e.filter_snapshot.name)} />
                        ))}
                        {failedExecs.map((e) => (
                          <div key={e.execution_id} className="flex items-center gap-2">
                            <span className="text-sm text-red-600 font-medium min-w-[100px] truncate">{e.filter_snapshot.name}</span>
                            <span className="inline-flex px-1.5 py-0.5 text-xs font-semibold rounded bg-red-100 text-red-700">failed</span>
                            <button onClick={() => handleDeleteFilter(e.execution_id, e.filter_snapshot.name)} className="ml-1 text-red-500 hover:text-red-700 text-xs underline">delete</button>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => setShowRunFiltersModal(true)} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 focus:outline-none border border-gray-300">+ Run More Filters</button>
                      {executions.filter((e) => e.status === 'processing').length > 0 && (
                        <p className="text-xs text-blue-500 mt-2">Processing: {executions.filter((e) => e.status === 'processing').map((e) => e.filter_snapshot.name).join(', ')}</p>
                      )}
                    </div>
                  )}
                  {completedExecs.length === 0 && (
                    <div className="flex-1 min-w-[260px]">
                      <p className="text-sm font-semibold text-gray-700 mb-2">Filters</p>
                      {executions.filter((e) => e.status === 'processing').length > 0 && (
                        <p className="text-xs text-blue-500 mb-2">Processing: {executions.filter((e) => e.status === 'processing').map((e) => e.filter_snapshot.name).join(', ')}</p>
                      )}
                      {failedExecs.length > 0 && (
                        <div className="space-y-1 mb-2">
                          {failedExecs.map((e) => (
                            <div key={e.execution_id} className="flex items-center gap-2">
                              <span className="text-sm text-red-600 font-medium min-w-[100px] truncate">{e.filter_snapshot.name}</span>
                              <span className="inline-flex px-1.5 py-0.5 text-xs font-semibold rounded bg-red-100 text-red-700">failed</span>
                              <button onClick={() => handleDeleteFilter(e.execution_id, e.filter_snapshot.name)} className="ml-1 text-red-500 hover:text-red-700 text-xs underline">delete</button>
                            </div>
                          ))}
                        </div>
                      )}
                      {executions.length === 0 && <p className="text-sm text-gray-400 italic mb-2">No filters run yet.</p>}
                      <button onClick={() => setShowRunFiltersModal(true)} className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 focus:outline-none border border-gray-300">+ Run More Filters</button>
                    </div>
                  )}

                  {showSearchVolumeControls && (
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1">Min. Monthly Searches</label>
                      <form onSubmit={(e) => { e.preventDefault(); handleMinSearchesBlur() }}>
                        <input type="number" min={0} className="w-28 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" value={minSearchesInput} onChange={(e) => setMinSearchesInput(e.target.value)} onBlur={(e) => e.target.form.requestSubmit()} />
                      </form>
                      <p className="text-xs text-gray-400 mt-0.5">Applied server-side</p>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1">Highlight Threshold</label>
                    <input type="number" min="0" max="1" step="0.01" className="w-24 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500" value={highlightInput} onChange={(e) => setHighlightInput(e.target.value)} onBlur={handleHighlightBlur} onKeyDown={(e) => e.key === 'Enter' && handleHighlightBlur()} />
                    <p className="text-xs text-gray-400 mt-0.5">Distance ≥ this → highlighted</p>
                  </div>

                  <div className="self-end pb-0.5 text-right relative">
                    <div className="flex items-center justify-end gap-2 mb-2">
                      <span className="text-xs text-gray-500">Copy:</span>
                      <div className="flex rounded-md overflow-hidden border border-gray-300">
                        {['md', 'csv', 'json'].map((fmt) => (
                          <button key={fmt} onClick={() => handleCopyToClipboard(fmt)} className="px-2 py-0.5 text-xs font-medium bg-white text-gray-600 hover:bg-gray-50 transition-colors">{fmt.toUpperCase()}</button>
                        ))}
                      </div>
                    </div>
                    <p className="text-sm text-gray-500">
                      <span className="font-semibold text-gray-900">{results.length.toLocaleString()}</span> rows on this page
                      {totalCount > 0 && <span className="text-gray-400"> ({totalCount.toLocaleString()} total)</span>}
                    </p>
                    {showCopied && <div className="absolute top-0 right-0 -mt-6 bg-green-600 text-white text-xs px-2 py-1 rounded shadow">Copied!</div>}
                  </div>
                </div>
              </div>

              {/* Results table */}
              <GapResultsTable
                results={results}
                totalCount={totalCount}
                page={page}
                pageSize={pageSize}
                orderBy={orderBy}
                orderDir={orderDir}
                loading={resultsLoading}
                completedExecs={completedExecs}
                filterResultsMap={filterResultsMap}
                highlightThreshold={highlightThreshold}
                expandedRows={expandedRows}
                onSort={handleSort}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
                onToggleRow={toggleRow}
                sourceColumnLabel={analysis.source_dataset_name || 'Source Item'}
                targetColumnLabel={`Closest in ${analysis.target_dataset_name || 'Target'}`}
                showSearchVolume={showSearchVolumeControls}
                showIntentColumns={analysis.use_intent_normalization === true}
              />

              <RunFiltersModal
                isOpen={showRunFiltersModal}
                onClose={() => setShowRunFiltersModal(false)}
                keywordCount={analysis?.total_items_analyzed ?? 0}
                onSubmit={async () => {
                  setShowRunFiltersModal(false)
                  try {
                    const res = await fetch(`${API_BASE}/api/gap-analyses/${analysisId}/filter-executions`)
                    if (res.ok) { const data = await res.json(); setExecutions(data.executions || []) }
                  } catch (err) { console.error('Failed to refresh executions after filter submit:', err) }
                }}
                analysisId={analysisId}
                existingExecutions={executions}
              />
            </div>

            {/* Chat panel */}
            {chatOpen && (
              <div className="w-96 shrink-0 sticky top-4" style={{ height: 'calc(100vh - 8rem)' }}>
                <ChatPanel
                  mode="gap"
                  entityId={analysisId}
                  entityName={analysis.name}
                  agentModel={agentModel}
                  getPeekRows={getPeekRows}
                  gapContext={gapContext}
                  onToggleFilter={handleAgentToggleFilter}
                  onCreateFilterExecution={handleAgentCreateFilter}
                />
              </div>
            )}
          </div>
        )}

        {/* Delete confirmation modal */}
        {deleteModal && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete analysis?</h2>
              <p className="text-sm text-gray-600 mb-6"><strong className="text-gray-800">{analysis.name}</strong> and all its results will be permanently deleted. This cannot be undone.</p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setDeleteModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg">Cancel</button>
                <button onClick={confirmDelete} className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg">Delete</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
