import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import API_BASE from '../config'

export default function FilterDetailPage() {
  const { filterId } = useParams()
  const navigate = useNavigate()

  const [filter, setFilter] = useState(null)
  const [name, setName] = useState('')
  const [label, setLabel] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteModal, setDeleteModal] = useState(false)
  const [error, setError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    const fetchFilter = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`${API_BASE}/api/filters/${filterId}`)
        if (!res.ok) throw new Error('Filter not found')
        const data = await res.json()
        setFilter(data)
        setName(data.name)
        setLabel(data.label || '')
        setText(data.text || '')
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchFilter()
  }, [filterId])

  const handleSave = async (e) => {
    e.preventDefault()
    setSaving(true)
    setSaveSuccess(false)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/api/filters/${filterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), label: label.trim(), text: text.trim() }),
      })
      if (!res.ok) throw new Error('Failed to save')
      const updated = await res.json()
      setFilter(updated)
      setName(updated.name)
      setLabel(updated.label || '')
      setText(updated.text || '')
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`${API_BASE}/api/filters/${filterId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
      navigate('/filters')
    } catch (err) {
      alert(`Error: ${err.message}`)
      setDeleting(false)
      setDeleteModal(false)
    }
  }

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>

  if (error && !filter) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-8">
        <p className="text-red-600 font-semibold mb-4">{error}</p>
        <button
          onClick={() => navigate('/filters')}
          className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium"
        >
          ← Back to Filters
        </button>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Back */}
      <button
        onClick={() => navigate('/filters')}
        className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium mb-6"
      >
        <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to Filters
      </button>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {/* Title + Delete */}
        <div className="flex items-start justify-between mb-1">
          <h1 className="text-2xl font-bold text-gray-900">{filter?.name}</h1>
          <button
            onClick={() => setDeleteModal(true)}
            disabled={deleting}
            className="text-sm text-red-500 hover:text-red-700 border border-red-200 px-3 py-1.5 rounded-lg shrink-0 ml-4 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
        {filter?.updated_at && (
          <p className="text-sm text-gray-400 mb-6">
            Last modified: {new Date(filter.updated_at).toLocaleString()}
          </p>
        )}

        {/* Edit Form */}
        <form onSubmit={handleSave}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Name *</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={saving}
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Label</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
              placeholder="e.g. brand, competitor, topic"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              disabled={saving}
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Text</label>
            <textarea
              rows={8}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-indigo-400"
              placeholder="Filter description or content..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={saving}
            />
          </div>

          {error && (
            <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {saveSuccess && (
            <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700">
              ✅ Saved successfully
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={saving}
              className="bg-indigo-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* Delete confirmation modal */}
      {deleteModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Delete filter?</h2>
            <p className="text-sm text-gray-600 mb-6">
              <strong className="text-gray-800">{filter?.name}</strong> will be permanently deleted. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteModal(false)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-200 rounded-lg disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-lg disabled:opacity-50"
              >
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
