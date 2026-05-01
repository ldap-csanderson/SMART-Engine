import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import API_BASE from '../config'
import EditableTitle from '../components/EditableTitle'
import PaginationBar from '../components/PaginationBar'
import ChatPanel from '../components/ChatPanel'

const TYPE_LABELS = {
  google_ads_account_keywords: 'Account Keywords',
  google_ads_keywords: 'Keyword Planner (URL)',
  google_ads_ad_copy: 'Ad Copy',
  google_ads_search_terms: 'Search Terms',
  google_ads_keyword_planner: 'Keyword Planner (Account)',
  google_ads_landing_pages: 'Landing Pages',
  text_list: 'Text List',
}

const SEARCH_VOLUME_TYPES = new Set(['google_ads_keywords', 'google_ads_keyword_planner'])
const URL_TYPES = new Set(['google_ads_landing_pages'])

export default function DatasetDetailPage() {
  const { datasetId } = useParams()
  const navigate = useNavigate()
  const [dataset, setDataset] = useState(null)
  const [items, setItems] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(100)
  const [loading, setLoading] = useState(true)
  const [itemsLoading, setItemsLoading] = useState(false)

  // Chat panel state
  const [chatOpen, setChatOpen] = useState(false)
  const [agentModel, setAgentModel] = useState('gemini-2.5-flash')
  const [customQueryColumns, setCustomQueryColumns] = useState(null)
  const [customQueryRows, setCustomQueryRows] = useState(null)
  const [customQuerySql, setCustomQuerySql] = useState(null)

  // Delete state
  const [deleteModal, setDeleteModal] = useState(false)
  const [affectedGroups, setAffectedGroups] = useState([])
  const [deleting, setDeleting] = useState(false)

  // Load agent model once
  useEffect(() => {
    fetch(`${API_BASE}/api/settings/agent`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.model) setAgentModel(d.model) })
      .catch(() => {})
  }, [])

  const fetchDataset = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/datasets/${datasetId}`)
      if (!res.ok) { navigate('/datasets'); return }
      setDataset(await res.json())
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [datasetId, navigate])

  const fetchItems = useCallback(async (p, ps) => {
    setItemsLoading(true)
    try {
      const offset = p * ps
      const res = await fetch(`${API_BASE}/api/datasets/${datasetId}/items?limit=${ps}&offset=${offset}`)
      const data = await res.json()
      setItems(data.items || [])
      setTotalCount(data.item_count || 0)
    } catch (e) {
      console.error(e)
    } finally {
      setItemsLoading(false)
    }
  }, [datasetId])

  useEffect(() => {
    fetchDataset()
    fetchItems(0, 100)
    const interval = setInterval(fetchDataset, 4000)
    return () => clearInterval(interval)
  }, [fetchDataset, fetchItems])

  useEffect(() => {
    if (!customQueryRows) fetchItems(page, pageSize)
  }, [page, pageSize, fetchItems, customQueryRows])

  const handlePageChange = (newPage) => { setPage(newPage); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const handlePageSizeChange = (newSize) => { setPageSize(newSize); setPage(0) }

  const handleRename = async (newName) => {
    await fetch(`${API_BASE}/api/datasets/${datasetId}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
    setDataset(d => ({ ...d, name: newName }))
  }

  const handleDeleteClick = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/datasets/${datasetId}/groups`)
      const data = await res.json()
      const groups = data.groups || []
      if (groups.length === 0) {
        if (!confirm('Delete this dataset and all its items? This cannot be undone.')) return
        await confirmDelete()
      } else {
        setAffectedGroups(groups)
        setDeleteModal(true)
      }
    } catch (e) {
      console.error(e)
      if (!confirm('Delete this dataset and all its items? This cannot be undone.')) return
      await confirmDelete()
    }
  }

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      await fetch(`${API_BASE}/api/datasets/${datasetId}`, { method: 'DELETE' })
      navigate('/datasets')
    } catch (e) {
      console.error(e)
      setDeleting(false)
      setDeleteModal(false)
    }
  }

  // Chat: agent ran a SQL query — show results in table
  const handleQueryResults = (columns, rows, sql) => {
    setCustomQueryColumns(columns)
    setCustomQueryRows(rows)
    setCustomQuerySql(sql)
  }

  const handleClearResults = () => {
    setCustomQueryColumns(null)
    setCustomQueryRows(null)
    setCustomQuerySql(null)
  }

  // Chat: fetch peek rows from the current dataset view
  const getPeekRows = useCallback(async (n) => {
    try {
      const res = await fetch(`${API_BASE}/api/datasets/${datasetId}/items?limit=${n}&offset=0`)
      const data = await res.json()
      return (data.items || []).map(item => ({
        item_text: item.item_text || '',
        avg_monthly_searches: item.avg_monthly_searches ?? '',
        competition: item.competition || '',
        source_url: item.source_url || '',
      }))
    } catch { return [] }
  }, [datasetId])

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>
  if (!dataset) return null

  const hasSearchVolume = SEARCH_VOLUME_TYPES.has(dataset.type)
  const isUrlType = URL_TYPES.has(dataset.type)

  // Decide what to show in the table
  const tableItems = customQueryRows !== null
    ? customQueryRows
    : items
  const tableColumns = customQueryRows !== null
    ? customQueryColumns
    : null

  return (
    <div className="px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 max-w-full">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3 mb-1 flex-wrap">
            <span className="text-xs font-medium bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
              {TYPE_LABELS[dataset.type] || dataset.type}
            </span>
            <span className={`text-xs font-medium ${
              dataset.status === 'completed' ? 'text-green-600' :
              dataset.status === 'processing' ? 'text-yellow-600' :
              dataset.status === 'failed' ? 'text-red-600' : 'text-gray-500'
            }`}>
              {dataset.status === 'processing' ? '⏳ processing…' : dataset.status}
            </span>
          </div>
          <EditableTitle value={dataset.name} onSave={handleRename} className="text-2xl font-bold text-gray-900" />
          <p className="text-sm text-gray-500 mt-1">
            {dataset.status === 'processing' ? '—' : `${dataset.item_count.toLocaleString()} items`} · Created {new Date(dataset.created_at).toLocaleDateString()}
          </p>
          {dataset.error_message && <p className="text-sm text-red-600 mt-2">Error: {dataset.error_message}</p>}
        </div>
        <div className="flex items-center gap-2 ml-4 shrink-0">
          {dataset.status === 'completed' && (
            <button
              onClick={() => setChatOpen(o => !o)}
              className={`text-sm px-3 py-1.5 rounded-lg border font-medium transition-colors ${
                chatOpen
                  ? 'bg-purple-600 text-white border-purple-600 hover:bg-purple-700'
                  : 'bg-white text-purple-700 border-purple-300 hover:bg-purple-50'
              }`}
            >
              {chatOpen ? '✕ Close Analysis' : '✨ Analyze'}
            </button>
          )}
          <button
            onClick={handleDeleteClick}
            className="text-sm text-red-500 hover:text-red-700 border border-red-200 px-3 py-1.5 rounded-lg"
          >
            Delete
          </button>
        </div>
      </div>

      {/* Main layout: table | chat panel */}
      <div className={`flex gap-4 items-start ${chatOpen ? '' : ''}`}>
        {/* Items table */}
        <div className={`${chatOpen ? 'flex-1 min-w-0' : 'w-full'}`}>
          {customQuerySql && (
            <div className="mb-3 px-4 py-2 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center justify-between">
              <span className="text-xs text-indigo-700 font-medium">Showing agent query results</span>
              <button onClick={handleClearResults} className="text-xs text-indigo-500 hover:text-indigo-700 underline">
                Back to normal view
              </button>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="font-medium text-gray-700 text-sm">
                {customQueryRows ? 'Query Results' : 'Items'}
              </h2>
              <span className="text-xs text-gray-400">
                {customQueryRows
                  ? `${customQueryRows.length.toLocaleString()} rows`
                  : `${totalCount.toLocaleString()} total`}
              </span>
            </div>

            {itemsLoading && tableItems.length === 0 ? (
              <div className="p-6 text-gray-400 text-sm">Loading items…</div>
            ) : tableItems.length === 0 ? (
              <div className="p-6 text-gray-400 text-sm">
                {dataset.status === 'processing' ? 'Ingestion in progress…' : 'No items found.'}
              </div>
            ) : customQueryColumns ? (
              /* Custom query result table with dynamic columns */
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      {customQueryColumns.map(col => (
                        <th key={col} className="px-4 py-2 text-left font-medium">{col}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {tableItems.map((row, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        {customQueryColumns.map(col => (
                          <td key={col} className="px-4 py-2 text-gray-800 text-xs whitespace-pre-wrap max-w-xs truncate">
                            {row[col] ?? '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              /* Normal items table */
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-5 py-2 text-left font-medium">Item</th>
                    {hasSearchVolume && (
                      <>
                        <th className="px-4 py-2 text-right font-medium">Avg Monthly Searches</th>
                        <th className="px-4 py-2 text-right font-medium">Competition</th>
                      </>
                    )}
                    {(isUrlType || dataset.type === 'google_ads_keywords') && (
                      <th className="px-4 py-2 text-left font-medium">Source</th>
                    )}
                  </tr>
                </thead>
                <tbody className={`divide-y divide-gray-50 ${itemsLoading ? 'opacity-50' : ''}`}>
                  {tableItems.map((item, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-5 py-2.5 text-gray-800 whitespace-pre-wrap max-w-lg">{item.item_text}</td>
                      {hasSearchVolume && (
                        <>
                          <td className="px-4 py-2.5 text-right text-gray-600">{item.avg_monthly_searches?.toLocaleString() ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right text-gray-600">{item.competition ?? '—'}</td>
                        </>
                      )}
                      {(isUrlType || dataset.type === 'google_ads_keywords') && (
                        <td className="px-4 py-2.5 text-gray-400 text-xs truncate max-w-xs">{item.source_url || '—'}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {!customQueryRows && (
              <PaginationBar
                page={page}
                pageSize={pageSize}
                totalCount={totalCount}
                loading={itemsLoading}
                onPageChange={handlePageChange}
                onPageSizeChange={handlePageSizeChange}
              />
            )}
          </div>
        </div>

        {/* Chat panel */}
        {chatOpen && (
          <div className="w-96 shrink-0 sticky top-4" style={{ height: 'calc(100vh - 8rem)' }}>
            <ChatPanel
              mode="dataset"
              entityId={datasetId}
              entityName={dataset.name}
              agentModel={agentModel}
              onQueryResults={handleQueryResults}
              onClearResults={handleClearResults}
              getPeekRows={getPeekRows}
            />
          </div>
        )}
      </div>

      {/* Delete confirmation modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete dataset?</h2>
            <p className="text-sm text-gray-600 mb-3">
              <strong className="text-gray-800">{dataset.name}</strong> belongs to the following group{affectedGroups.length > 1 ? 's' : ''}:
            </p>
            <ul className="mb-4 space-y-1">
              {affectedGroups.map(g => (
                <li key={g.group_id} className="text-sm text-gray-700 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                  {g.name}
                </li>
              ))}
            </ul>
            <p className="text-sm text-gray-500 mb-6">
              Deleting this dataset will remove it from {affectedGroups.length > 1 ? 'those groups' : 'that group'} and permanently delete all its items. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteModal(false)} disabled={deleting} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg disabled:opacity-50">Cancel</button>
              <button onClick={confirmDelete} disabled={deleting} className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50">
                {deleting ? 'Deleting…' : 'Delete anyway'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
