import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import API_BASE from '../config'
import NewDatasetModal from '../components/NewDatasetModal'

const TYPE_LABELS = {
  google_ads_account_keywords: 'Account Keywords',
  google_ads_keywords: 'Keyword Planner (URL)',
  google_ads_ad_copy: 'Ad Copy',
  google_ads_search_terms: 'Search Terms',
  google_ads_keyword_planner: 'Keyword Planner (Account)',
  text_list: 'Text List',
}

const TYPE_COLORS = {
  google_ads_account_keywords: 'bg-orange-100 text-orange-800',
  google_ads_keywords: 'bg-blue-100 text-blue-800',
  google_ads_ad_copy: 'bg-purple-100 text-purple-800',
  google_ads_search_terms: 'bg-green-100 text-green-800',
  google_ads_keyword_planner: 'bg-cyan-100 text-cyan-800',
  text_list: 'bg-gray-100 text-gray-800',
}

const STATUS_COLORS = {
  completed: 'text-green-600',
  processing: 'text-yellow-600',
  failed: 'text-red-600',
  pending: 'text-gray-500',
  archived: 'text-gray-400',
}

export default function DatasetsPage() {
  const [datasets, setDatasets] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const fetchDatasets = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/datasets`)
      const data = await res.json()
      setDatasets(data.datasets || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDatasets()
    const interval = setInterval(() => {
      fetchDatasets()
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Datasets</h1>
          <p className="text-sm text-gray-500 mt-1">
            Collections of text items used as source or target in gap analyses
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          + New Dataset
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : datasets.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No datasets yet</p>
          <p className="text-sm mt-1">Create a dataset to get started</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {datasets.map(ds => (
            <Link
              key={ds.dataset_id}
              to={`/datasets/${ds.dataset_id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${TYPE_COLORS[ds.type] || 'bg-gray-100 text-gray-700'}`}>
                  {TYPE_LABELS[ds.type] || ds.type}
                </span>
                <span className="font-medium text-gray-900 truncate">{ds.name}</span>
              </div>
              <div className="flex items-center gap-6 text-sm text-gray-500 shrink-0 ml-4">
                <span className={`font-medium ${STATUS_COLORS[ds.status] || 'text-gray-500'}`}>
                  {ds.status === 'processing' ? '⏳ processing…' : ds.status}
                </span>
                <span>{ds.status === 'processing' ? '—' : `${ds.item_count.toLocaleString()} items`}</span>
                <span>{new Date(ds.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showModal && (
        <NewDatasetModal
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false)
            fetchDatasets()
          }}
        />
      )}
    </div>
  )
}
