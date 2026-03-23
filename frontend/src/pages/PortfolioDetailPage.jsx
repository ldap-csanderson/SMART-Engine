import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

export default function PortfolioDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  const [portfolio, setPortfolio] = useState(null)
  const [name, setName] = useState('')
  const [itemsText, setItemsText] = useState('')
  const [initialName, setInitialName] = useState('')
  const [initialItemsText, setInitialItemsText] = useState('')
  
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const fetchPortfolio = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/portfolios/${id}`)
      if (!res.ok) {
        if (res.status === 404) throw new Error('Portfolio not found')
        throw new Error('Failed to load portfolio')
      }
      const data = await res.json()
      setPortfolio(data)
      setName(data.name)
      setInitialName(data.name)
      
      const joined = (data.items || []).join('\n')
      setItemsText(joined)
      setInitialItemsText(joined)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchPortfolio()
  }, [id])

  const handleRevert = () => {
    setName(initialName)
    setItemsText(initialItemsText)
    setSaveSuccess(false)
    setError(null)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Portfolio name is required')
      return
    }

    setSaving(true)
    setSaveSuccess(false)
    setError(null)

    try {
      const items = itemsText
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      const res = await fetch(`/api/portfolios/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          name: name.trim(), 
          items 
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to save portfolio')
      }

      const data = await res.json()
      setPortfolio(data)
      setName(data.name)
      setInitialName(data.name)
      
      const joined = (data.items || []).join('\n')
      setItemsText(joined)
      setInitialItemsText(joined)
      
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete "${portfolio?.name}"? This action cannot be undone.`)) {
      return
    }

    setDeleting(true)
    setError(null)

    try {
      const res = await fetch(`/api/portfolios/${id}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.detail || 'Failed to delete portfolio')
      }

      navigate('/portfolios')
    } catch (err) {
      setError(err.message)
      setDeleting(false)
    }
  }

  const isDirty = name !== initialName || itemsText !== initialItemsText
  const lineCount = itemsText.split('\n').filter((l) => l.trim().length > 0).length

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow p-8 text-center">
          <svg className="animate-spin h-8 w-8 mx-auto text-blue-600" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="mt-2 text-gray-600">Loading portfolio...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/portfolios')}
          className="mb-4 inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <svg className="mr-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Portfolios
        </button>
        <h1 className="text-3xl font-bold text-gray-900">Edit Portfolio</h1>
        {portfolio && (
          <div className="mt-2 flex items-center text-sm text-gray-500">
            <svg className="mr-1.5 h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Created {new Date(portfolio.created_at).toLocaleDateString()}
            {portfolio.updated_at && ` • Updated ${new Date(portfolio.updated_at).toLocaleDateString()}`}
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow p-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {saveSuccess && (
          <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-md">
            <p className="text-green-800">✅ Portfolio saved successfully</p>
          </div>
        )}

        {isDirty && !saveSuccess && (
          <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-yellow-800 text-sm">You have unsaved changes.</p>
          </div>
        )}

        {/* Name Field */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Portfolio Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={saving || deleting}
            required
          />
        </div>

        {/* Items Textarea */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Portfolio Items
          </label>
          <p className="text-xs text-gray-500 mb-2">
            One item per line (e.g., topics, products, or pages you cover)
          </p>
          <textarea
            rows="15"
            className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
            placeholder={'cologne\nluggage\nnon toxic cookware'}
            value={itemsText}
            onChange={(e) => setItemsText(e.target.value)}
            disabled={saving || deleting}
          />
          <p className="mt-1 text-xs text-gray-500">
            {lineCount} {lineCount === 1 ? 'item' : 'items'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center justify-between pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving || deleting}
            className="px-4 py-2 bg-red-600 text-white font-medium rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? 'Deleting...' : 'Delete Portfolio'}
          </button>
          
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleRevert}
              disabled={!isDirty || saving || deleting}
              className="px-5 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Revert
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || deleting || !isDirty}
              className="px-5 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
