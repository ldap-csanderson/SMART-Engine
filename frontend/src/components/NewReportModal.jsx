import { useState, useEffect } from 'react'

export default function NewReportModal({ isOpen, onClose, onSubmit }) {
  const [name, setName] = useState('')
  const [urls, setUrls] = useState('')
  const [error, setError] = useState(null)
  const [placeholder, setPlaceholder] = useState('')

  // Generate placeholder timestamp once when modal opens
  useEffect(() => {
    if (isOpen && !placeholder) {
      const now = new Date()
      const placeholderText = `Report ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')} UTC`
      setPlaceholder(placeholderText)
    }
  }, [isOpen])

  const handleSubmit = async (e) => {
    e.preventDefault()

    const urlList = urls
      .split('\n')
      .map((url) => url.trim())
      .filter((url) => url.length > 0)

    if (urlList.length === 0) {
      setError('Please enter at least one URL')
      return
    }

    const reportData = {
      name: name.trim(),
      urls: urlList,
    }

    if (onSubmit) {
      onSubmit(reportData)
    }

    // Reset and close immediately (optimistic UI)
    setName('')
    setUrls('')
    setError(null)
    setPlaceholder('')
    onClose()

    // Fetch in background
    try {
      await fetch('/api/keyword-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          urls: urlList,
          name: reportData.name || undefined,
        }),
      })
    } catch (err) {
      console.error('Background fetch error:', err)
    }
  }

  const handleClose = () => {
    setName('')
    setUrls('')
    setError(null)
    setPlaceholder('')
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-gray-900">New Report</h2>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Name Field */}
            <div className="mb-4">
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Report Name (optional)
              </label>
              <input
                id="name"
                type="text"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder={placeholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* URLs Field */}
            <div className="mb-6">
              <label htmlFor="urls" className="block text-sm font-medium text-gray-700 mb-2">
                URLs (one per line) *
              </label>
              <textarea
                id="urls"
                rows="6"
                className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                placeholder={'https://www.example.com\nhttps://www.another-site.com'}
                value={urls}
                onChange={(e) => setUrls(e.target.value)}
                required
              />
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
                <p className="text-red-800">{error}</p>
              </div>
            )}

            {/* Buttons */}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 bg-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                Create Report
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
