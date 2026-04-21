import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Link } from 'react-router-dom'
import API_BASE from '../config'
import EditableTitle from '../components/EditableTitle'

const TYPE_LABELS = {
  google_ads_account_keywords: 'Account Keywords',
  google_ads_keywords: 'Keyword Planner (URL)',
  google_ads_ad_copy: 'Ad Copy',
  google_ads_search_terms: 'Search Terms',
  google_ads_keyword_planner: 'Keyword Planner (Account)',
  text_list: 'Text List',
}

export default function DatasetGroupDetailPage() {
  const { groupId } = useParams()
  const navigate = useNavigate()
  const [group, setGroup] = useState(null)
  const [datasets, setDatasets] = useState([]) // all available datasets
  const [memberDatasets, setMemberDatasets] = useState([]) // resolved member info
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [saving, setSaving] = useState(false)

  const fetchGroup = async () => {
    try {
      const [grpRes, dsRes] = await Promise.all([
        fetch(`${API_BASE}/api/dataset-groups/${groupId}`),
        fetch(`${API_BASE}/api/datasets`),
      ])
      if (!grpRes.ok) { navigate('/dataset-groups'); return }
      const grp = await grpRes.json()
      const dsData = await dsRes.json()
      setGroup(grp)
      setSelectedIds(grp.dataset_ids || [])
      const allDs = dsData.datasets || []
      setDatasets(allDs)
      setMemberDatasets(allDs.filter(d => grp.dataset_ids.includes(d.dataset_id)))
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchGroup() }, [groupId])

  const handleRename = async (newName) => {
    await fetch(`${API_BASE}/api/dataset-groups/${groupId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName, dataset_ids: group.dataset_ids }),
    })
    setGroup(g => ({ ...g, name: newName }))
  }

  const handleSaveMembers = async () => {
    setSaving(true)
    try {
      await fetch(`${API_BASE}/api/dataset-groups/${groupId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: group.name, dataset_ids: selectedIds }),
      })
      setEditing(false)
      fetchGroup()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this group? The member datasets will not be deleted.')) return
    await fetch(`${API_BASE}/api/dataset-groups/${groupId}`, { method: 'DELETE' })
    navigate('/dataset-groups')
  }

  const toggleDataset = (id) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>
  if (!group) return null

  return (
    <div className="max-w-4xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <EditableTitle value={group.name} onSave={handleRename} className="text-2xl font-bold text-gray-900" />
          <p className="text-sm text-gray-500 mt-1">
            {group.dataset_count} dataset{group.dataset_count !== 1 ? 's' : ''} · Created {new Date(group.created_at).toLocaleDateString()}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setEditing(!editing)}
            className="text-sm text-indigo-600 hover:text-indigo-800 border border-indigo-200 px-3 py-1.5 rounded-lg"
          >
            {editing ? 'Cancel' : 'Edit Members'}
          </button>
          <button
            onClick={handleDelete}
            className="text-sm text-red-500 hover:text-red-700 border border-red-200 px-3 py-1.5 rounded-lg"
          >
            Delete
          </button>
        </div>
      </div>

      {editing ? (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="font-medium text-gray-700 mb-3 text-sm">Select member datasets</h3>
          <div className="divide-y divide-gray-100 max-h-96 overflow-y-auto border border-gray-100 rounded-lg mb-4">
            {datasets.filter(d => d.status !== 'archived').map(ds => (
              <label key={ds.dataset_id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(ds.dataset_id)}
                  onChange={() => toggleDataset(ds.dataset_id)}
                  className="rounded"
                />
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {TYPE_LABELS[ds.type] || ds.type}
                </span>
                <span className="text-sm text-gray-800">{ds.name}</span>
                <span className="text-xs text-gray-400 ml-auto">{ds.item_count.toLocaleString()} items</span>
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => setEditing(false)} className="text-sm text-gray-500 px-4 py-2">Cancel</button>
            <button
              onClick={handleSaveMembers}
              disabled={saving}
              className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          {memberDatasets.length === 0 ? (
            <div className="p-6 text-gray-400 text-sm">No datasets in this group yet.</div>
          ) : memberDatasets.map(ds => (
            <Link
              key={ds.dataset_id}
              to={`/datasets/${ds.dataset_id}`}
              className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                  {TYPE_LABELS[ds.type] || ds.type}
                </span>
                <span className="font-medium text-gray-900">{ds.name}</span>
              </div>
              <span className="text-sm text-gray-500">{ds.item_count.toLocaleString()} items</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
