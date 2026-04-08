import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import API_BASE from '../config'
import EditableTitle from '../components/EditableTitle'
import PaginationBar from '../components/PaginationBar'

const TYPE_LABELS = {
  google_ads_keywords: 'Keyword Planner (URL)',
  google_ads_ad_copy: 'Ad Copy',
  google_ads_search_terms: 'Search Terms',
  google_ads_keyword_planner: 'Keyword Planner (Account)',
  text_list: 'Text List',
}

const SEARCH_VOLUME_TYPES = new Set(['google_ads_keywords', 'google_ads_keyword_planner'])

const PAGE_SIZE = 100

export default function DatasetDetailPage() {
  const { datasetId } = useParams()
  const navigate = useNavigate()
  const [dataset, setDataset] = useState(null)
  const [items, setItems] = useState([])
  const [totalCount, setTotalCount] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [itemsLoading, setItemsLoading] = useState(false)

  const fetchDataset = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/datasets/${datasetId}`)
      if (!res.ok) { navigate('/datasets'); return }
      const data = await res.json()
      setDataset(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const fetchItems = async (p = 0) => {
    setItemsLoading(true)
    try {
      const offset = p * PAGE_SIZE
      const res = await fetch(
        `${API_BASE}/api/datasets/${datasetId}/items?limit=${PAGE_SIZE}&offset=${offset}`
      )
      const data = await res.json()
      setItems(data.items || [])
      setTotalCount(data.item_count || 0)
    } catch (e) {
      console.error(e)
    } finally {
      setItemsLoading(false)
    }
  }

  useEffect(() => {
    fetchDataset()
    fetchItems(0)
    // Poll while processing
    const interval = setInterval(() => {
      fetchDataset()
    }, 4000)
    return () => clearInterval(interval)
  }, [datasetId])

  useEffect(() => {
    fetchItems(page)
  }, [page])

  const handleRename = async (newName) => {
    await fetch(`${API_BASE}/api/datasets/${datasetId}/rename`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName }),
    })
    setDataset(d => ({ ...d, name: newName }))
  }

  const handleDelete = async () => {
    if (!confirm('Delete this dataset and all its items? This cannot be undone.')) return
    await fetch(`${API_BASE}/api/datasets/${datasetId}`, { method: 'DELETE' })
    navigate('/datasets')
  }

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>
  if (!dataset) return null

  const hasSearchVolume = SEARCH_VOLUME_TYPES.has(dataset.type)

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
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
            {dataset.item_count.toLocaleString()} items · Created {new Date(dataset.created_at).toLocaleDateString()}
          </p>
          {dataset.error_message && (
            <p className="text-sm text-red-600 mt-2">Error: {dataset.error_message}</p>
          )}
        </div>
        <button
          onClick={handleDelete}
          className="text-sm text-red-500 hover:text-red-700 border border-red-200 px-3 py-1.5 rounded-lg"
        >
          Delete
        </button>
      </div>

      {/* Items table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-medium text-gray-700 text-sm">Items</h2>
          <span className="text-xs text-gray-400">{totalCount.toLocaleString()} total</span>
        </div>

        {itemsLoading ? (
          <div className="p-6 text-gray-400 text-sm">Loading items…</div>
        ) : items.length === 0 ? (
          <div className="p-6 text-gray-400 text-sm">
            {dataset.status === 'processing' ? 'Ingestion in progress…' : 'No items found.'}
          </div>
        ) : (
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
                {dataset.type === 'google_ads_keywords' && (
                  <th className="px-4 py-2 text-left font-medium">Source URL</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {items.map((item, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-5 py-2.5 text-gray-800 whitespace-pre-wrap max-w-lg">{item.item_text}</td>
                  {hasSearchVolume && (
                    <>
                      <td className="px-4 py-2.5 text-right text-gray-600">
                        {item.avg_monthly_searches?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-600">
                        {item.competition ?? '—'}
                      </td>
                    </>
                  )}
                  {dataset.type === 'google_ads_keywords' && (
                    <td className="px-4 py-2.5 text-gray-400 text-xs truncate max-w-xs">{item.source_url}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {totalCount > PAGE_SIZE && (
          <div className="px-5 py-3 border-t border-gray-100">
            <PaginationBar
              page={page}
              pageSize={PAGE_SIZE}
              total={totalCount}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>
    </div>
  )
}
