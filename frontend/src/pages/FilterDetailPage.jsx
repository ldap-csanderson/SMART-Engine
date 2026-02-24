import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

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
  const [error, setError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  useEffect(() => {
    const fetchFilter = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/filters/${filterId}`)
        if (!response.ok) throw new Error('Filter not found')
        const data = await response.json()
        setFilter(data)
        setName(data.name)
        setLabel(data.label)
        setText(data.text)
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
      const response = await fetch(`/api/filters/${filterId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          label: label.trim(),
          text: text.trim(),
        }),
      })

      if (!response.ok) throw new Error('Failed to save')

      const updated = await response.json()
      setFilter(updated)
      setName(updated.name)
      setLabel(updated.label)
      setText(updated.text)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete filter "${filter.name}"? This cannot be undone.`)) return

    setDeleting(true)
    try {
      const response = await fetch(`/api/filters/${filterId}`, { method: 'DELETE' })
      if (!response.ok) throw new Error('Failed to delete')
      navigate('/filters')
    } catch (err) {
      alert(`Error: ${err.message}`)
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading filter...</p>
          </div>
        </div>
      </div>
    )
  }

  if (error && !filter) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow p-8">
            <div className="text-red-600 mb-4">
              <p className="font-semibold">Error loading filter</p>
              <p className="text-sm">{error}</p>
            </div>
            <button
              onClick={() => navigate('/filters')}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              ← Back to Filters
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Back Button */}
        <button
          onClick={() => navigate('/filters')}
          className="inline-flex items-center text-blue-600 hover:text-blue-700 font-medium mb-6"
        >
          <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Filters
        </button>

        <div className="bg-white rounded-lg shadow p-8">
          {/* Title and Delete */}
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold text-gray-900">{filter?.name}</h1>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="px-3 py-1.5 text-sm font-medium bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
          </div>

          <p className="text-sm text-gray-400 mb-6">
            Created: {filter ? new Date(filter.created_at).toLocaleString() : ''}
          </p>

          {/* Edit Form */}
          <form onSubmit={handleSave}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Name *</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={saving}
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2">Label</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="e.g. brand, competitor, topic"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                disabled={saving}
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Text</label>
              <textarea
                rows="8"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder="Filter description or content..."
                value={text}
                onChange={(e) => setText(e.target.value)}
                disabled={saving}
              />
            </div>

            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-800">{error}</p>
              </div>
            )}

            {saveSuccess && (
              <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md">
                <p className="text-green-800">✅ Saved successfully</p>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
