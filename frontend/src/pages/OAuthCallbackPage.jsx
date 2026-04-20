/**
 * OAuthCallbackPage — minimal page loaded inside the OAuth popup window.
 *
 * The backend /api/auth/google-ads/callback redirects here after completing
 * the OAuth flow. This page reads the result from the URL, sends a
 * postMessage to the opener (SettingsPage), then closes itself.
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState('Processing…')

  useEffect(() => {
    const result = searchParams.get('result') || 'error'
    const reason = searchParams.get('reason') || ''

    if (result === 'success') {
      setStatus('Connected! Closing…')
    } else {
      setStatus(`Authorization failed${reason ? `: ${reason}` : ''}. Closing…`)
    }

    // Notify the parent window
    if (window.opener) {
      window.opener.postMessage({ type: 'oauth_complete', result, reason }, '*')
    }

    // Close the popup after a brief delay so the user sees the status
    const t = setTimeout(() => window.close(), 1500)
    return () => clearTimeout(t)
  }, [searchParams])

  const success = searchParams.get('result') === 'success'

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 px-8 py-10 max-w-sm w-full text-center">
        <div className={`text-4xl mb-4`}>{success ? '✅' : '❌'}</div>
        <p className="text-sm text-gray-600">{status}</p>
      </div>
    </div>
  )
}
