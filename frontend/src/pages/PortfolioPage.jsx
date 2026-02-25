import { useState, useEffect } from 'react'

export default function PortfolioPage() {
  const [initialText, setInitialText] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [updatedAt, setUpdatedAt] = useState(null)

  useEffect(() => {
    const fetchPortfolio = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/api/portfolio')
        if (!response.ok) throw new Error('Failed to load portfolio')
        const data = await response.json()
        const joined = (data.items || []).join('\n')
        setText(joined)
        setInitialText(joined)
        setUpdatedAt(data.updated_at || null)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchPortfolio()
  }, [])

  const handleRevert = () => {
    setText(initialText)
    setSaveSuccess(false)
    setError(null)
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveSuccess(false)
    setError(null)

    const items = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)

    try {
      const response = await fetch('/api/portfolio', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })

      if (!response.ok) throw new Error('Failed to save portfolio')

      const data = await response.json()
      const joined = (data.items || []).join('\n')

      // Update both current and initial so Revert returns to this saved state
      setText(joined)
      setInitialText(joined)
      setUpdatedAt(data.updated_at || null)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = text !== initialText

  const lineCount = text.split('\n').filter((l) => l.trim().length > 0).length

  if (loading) {
    return (
      <div className="bg-gray-50">
        <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <p className="mt-2 text-gray-600">Loading portfolio...</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-50">
      <div className="max-w-3xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Portfolio</h1>
          <p className="mt-2 text-gray-600">
            One entry per line.
          </p>
          {updatedAt && (
            <p className="mt-1 text-sm text-gray-400">
              Last saved: {new Date(updatedAt).toLocaleString()}
            </p>
          )}
        </div>

        <div className="bg-white rounded-lg shadow p-8">
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

          {/* Textarea */}
          <div className="mb-6">
            <textarea
              rows="20"
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
              placeholder={'entry one\nentry two\nentry three'}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={saving}
            />
            <p className="mt-1 text-xs text-gray-400">
              {lineCount} {lineCount === 1 ? 'entry' : 'entries'}
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={handleRevert}
              disabled={!isDirty || saving}
              className="px-5 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Revert
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !isDirty}
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
