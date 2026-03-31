import { useState, useRef, useEffect } from 'react'

/**
 * EditableTitle — an h1 that can be renamed in-place.
 *
 * Viewing state: shows the title + a pencil icon that appears on hover.
 * Editing state: replaces the h1 with an input of the same size,
 *   plus ✓ (save) and ✕ (cancel) buttons inline.
 *
 * Optimistic update: when the user confirms, the new name is displayed
 * immediately without waiting for the parent's API call to complete.
 * If the parent's `value` prop reverts (i.e. the save failed), the
 * displayed title reverts to match it automatically.
 *
 * Props:
 *   value     — current title string (source of truth from parent)
 *   onSave    — fn(newName: string) → called when user confirms
 *   saving    — optional bool; disables inputs while the request is in-flight
 */
export default function EditableTitle({ value, onSave, saving = false }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  // Optimistic display value: set immediately on save, cleared once parent catches up
  const [optimisticValue, setOptimisticValue] = useState(null)
  const inputRef = useRef(null)

  // Focus + select all when entering edit mode
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  // When parent's value catches up to our optimistic value, clear it.
  // If parent reverts to something else (save failed), that also clears it
  // and the h1 will show the parent's value.
  useEffect(() => {
    if (optimisticValue !== null) {
      setOptimisticValue(null)
    }
  }, [value])

  // Keep draft in sync with value when not editing (and no optimistic value pending)
  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const displayedValue = optimisticValue ?? value

  const handleEdit = () => {
    setDraft(displayedValue)
    setEditing(true)
  }

  const handleSave = () => {
    const trimmed = draft.trim()
    if (!trimmed) return            // reject empty
    if (trimmed === displayedValue) { // no change — just close
      setEditing(false)
      return
    }
    setOptimisticValue(trimmed)   // show new name immediately
    setEditing(false)
    onSave(trimmed)
  }

  const handleCancel = () => {
    setEditing(false)
    setDraft(displayedValue)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter')  handleSave()
    if (e.key === 'Escape') handleCancel()
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 min-w-0">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="text-3xl font-bold text-gray-900 bg-transparent border-b-2 border-blue-500 focus:outline-none flex-1 min-w-0"
        />
        <button
          onClick={handleSave}
          disabled={saving || !draft.trim()}
          title="Save"
          className="flex-shrink-0 p-1 text-green-600 hover:text-green-700 disabled:opacity-40"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </button>
        <button
          onClick={handleCancel}
          disabled={saving}
          title="Cancel"
          className="flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 disabled:opacity-40"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="group flex items-center gap-2 min-w-0">
      <h1 className="text-3xl font-bold text-gray-900 min-w-0 break-words">{displayedValue}</h1>
      <button
        onClick={handleEdit}
        title="Rename"
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1 text-gray-400 hover:text-gray-600"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      </button>
    </div>
  )
}
