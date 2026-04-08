import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import API_BASE from '../config'
import NewDatasetGroupModal from '../components/NewDatasetGroupModal'

export default function DatasetGroupsPage() {
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)

  const fetchGroups = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/dataset-groups`)
      const data = await res.json()
      setGroups(data.groups || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchGroups() }, [])

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dataset Groups</h1>
          <p className="text-sm text-gray-500 mt-1">
            Named collections of datasets — use as either side of a gap analysis
          </p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700"
        >
          + New Group
        </button>
      </div>

      {loading ? (
        <div className="text-gray-500 text-sm">Loading...</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg">No dataset groups yet</p>
          <p className="text-sm mt-1">Create a group to combine multiple datasets</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {groups.map(g => (
            <Link
              key={g.group_id}
              to={`/dataset-groups/${g.group_id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <span className="font-medium text-gray-900">{g.name}</span>
              <div className="flex items-center gap-6 text-sm text-gray-500">
                <span>{g.dataset_count} dataset{g.dataset_count !== 1 ? 's' : ''}</span>
                <span>{new Date(g.created_at).toLocaleDateString()}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {showModal && (
        <NewDatasetGroupModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); fetchGroups() }}
        />
      )}
    </div>
  )
}
