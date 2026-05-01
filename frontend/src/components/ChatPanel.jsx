import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import API_BASE from '../config'

// ── Markdown renderer ────────────────────────────────────────────────────────
function MarkdownText({ text, className = '' }) {
  if (!text) return null
  const blocks = []
  const lines = text.split('\n')
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trimStart().startsWith('```')) {
      const codeLines = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) { codeLines.push(lines[i]); i++ }
      i++
      blocks.push({ type: 'code', content: codeLines.join('\n') })
      continue
    }
    const hMatch = line.match(/^(#{1,3})\s+(.+)$/)
    if (hMatch) { blocks.push({ type: 'heading', level: hMatch[1].length, content: hMatch[2] }); i++; continue }
    const ulMatch = line.match(/^[\s]*[-*+]\s+(.+)$/)
    const olMatch = line.match(/^[\s]*\d+\.\s+(.+)$/)
    if (ulMatch || olMatch) {
      const isOrdered = !!olMatch
      const listItems = []
      while (i < lines.length) {
        const ul = lines[i].match(/^[\s]*[-*+]\s+(.+)$/)
        const ol = lines[i].match(/^[\s]*\d+\.\s+(.+)$/)
        if (ul) { listItems.push(ul[1]); i++ }
        else if (ol) { listItems.push(ol[1]); i++ }
        else break
      }
      blocks.push({ type: 'list', ordered: isOrdered, items: listItems })
      continue
    }
    if (line.trim() === '') { i++; continue }
    const paraLines = []
    while (i < lines.length) {
      const l = lines[i]
      if (l.trim() === '' || l.trimStart().startsWith('```') || l.match(/^#{1,3}\s/) || l.match(/^[\s]*[-*+]\s+/) || l.match(/^[\s]*\d+\.\s+/)) break
      paraLines.push(l); i++
    }
    if (paraLines.length > 0) blocks.push({ type: 'paragraph', content: paraLines.join('\n') })
  }
  function renderInline(text) {
    const result = []; let key = 0
    const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g
    let last = 0, m
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) result.push(text.slice(last, m.index))
      const token = m[0]
      if (token.startsWith('`')) result.push(<code key={key++} className="text-[11px] bg-gray-100 text-gray-800 px-1 py-0.5 rounded font-mono">{token.slice(1, -1)}</code>)
      else if (token.startsWith('**')) result.push(<strong key={key++} className="font-semibold">{token.slice(2, -2)}</strong>)
      else result.push(<em key={key++}>{token.slice(1, -1)}</em>)
      last = m.index + token.length
    }
    if (last < text.length) result.push(text.slice(last))
    return result
  }
  return (
    <div className={`space-y-1.5 ${className}`}>
      {blocks.map((block, idx) => {
        if (block.type === 'code') return <pre key={idx} className="text-[11px] bg-gray-100 text-gray-800 rounded-lg px-3 py-2 overflow-x-auto font-mono whitespace-pre-wrap leading-relaxed">{block.content}</pre>
        if (block.type === 'heading') {
          const sizes = ['text-sm font-bold', 'text-xs font-bold', 'text-xs font-semibold']
          return <p key={idx} className={`${sizes[block.level - 1] || 'text-xs font-medium'} text-gray-900 leading-snug`}>{renderInline(block.content)}</p>
        }
        if (block.type === 'list') {
          const ListTag = block.ordered ? 'ol' : 'ul'
          return <ListTag key={idx} className={`text-xs pl-4 space-y-0.5 ${block.ordered ? 'list-decimal' : 'list-disc'} leading-relaxed`}>{block.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}</ListTag>
        }
        if (block.type === 'paragraph') return <p key={idx} className="text-xs leading-relaxed whitespace-pre-wrap">{renderInline(block.content)}</p>
        return null
      })}
    </div>
  )
}

// ── SQL Query block ──────────────────────────────────────────────────────────
function QueryBlock({ sql, explanation, onApprove, onReject, status }) {
  const [copied, setCopied] = useState(false)
  const isPending = status === 'pending', isRunning = status === 'running'
  return (
    <div className="mt-2 rounded-xl border border-gray-200 overflow-hidden text-left">
      <div className="bg-gray-50 px-3 py-1.5 flex items-center justify-between border-b border-gray-200">
        <span className="text-xs text-gray-500 font-semibold tracking-wide uppercase">Proposed SQL</span>
        <button onClick={() => { navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="text-xs text-gray-400 hover:text-gray-600">
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      {explanation && <div className="px-3 py-2 text-xs text-gray-600 bg-gray-50 border-b border-gray-100 leading-relaxed">{explanation}</div>}
      <pre className="px-3 py-3 text-xs font-mono text-gray-800 bg-white overflow-x-auto whitespace-pre-wrap break-words max-h-52 leading-relaxed">{sql}</pre>
      {(isPending || isRunning) && (
        <div className="px-3 py-2.5 border-t border-gray-100 flex gap-2">
          <button onClick={onApprove} disabled={isRunning} className="flex-1 bg-indigo-600 text-white text-xs py-2 rounded-lg font-semibold hover:bg-indigo-700 disabled:opacity-50 transition-colors">{isRunning ? '⏳ Running…' : '▶ Run Query'}</button>
          <button onClick={onReject} disabled={isRunning} className="flex-1 bg-white text-gray-600 text-xs py-2 rounded-lg font-semibold border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors">✕ Reject</button>
        </div>
      )}
      {status === 'approved' && <div className="px-3 py-1.5 border-t border-gray-100 text-xs text-green-700 bg-green-50 font-medium">✓ Query executed</div>}
      {status === 'rejected' && <div className="px-3 py-1.5 border-t border-gray-100 text-xs text-gray-400 bg-gray-50">✕ Rejected</div>}
      {status === 'error' && <div className="px-3 py-1.5 border-t border-gray-100 text-xs text-red-600 bg-red-50 font-medium">⚠ Query failed</div>}
    </div>
  )
}

// ── Data Peek block ──────────────────────────────────────────────────────────
function PeekBlock({ explanation, previewRows, onApprove, onReject, status }) {
  const [localRows, setLocalRows] = useState(previewRows)
  const isPending = status === 'pending', isRunning = status === 'running'
  const clamp = (v) => Math.max(1, Math.min(500, Math.round(v)))
  return (
    <div className="mt-2 rounded-xl border border-violet-200 overflow-hidden text-left">
      <div className="bg-violet-50 px-3 py-1.5 flex items-center gap-2 border-b border-violet-200">
        <span className="text-xs text-violet-700 font-semibold tracking-wide uppercase">🔍 Data Peek</span>
        <span className="text-xs bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full font-medium">current view</span>
      </div>
      {explanation && <div className="px-3 py-2 text-xs text-gray-600 bg-violet-50 border-b border-violet-100 leading-relaxed">{explanation}</div>}
      {(isPending || isRunning) && (
        <div className="px-3 py-2.5 border-t border-violet-100 space-y-2">
          {isPending && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-violet-700 font-medium shrink-0">Rows to peek:</span>
              <div className="flex items-center gap-1">
                <button onClick={() => setLocalRows(r => clamp(r - 10))} className="w-6 h-6 text-xs font-bold text-violet-600 bg-violet-50 border border-violet-200 rounded-md hover:bg-violet-100">−</button>
                <input type="number" value={localRows} min={1} max={500} onChange={e => setLocalRows(clamp(+e.target.value || 1))} className="w-14 text-center text-xs border border-violet-200 rounded-md py-0.5 focus:outline-none focus:ring-2 focus:ring-violet-300 font-mono" />
                <button onClick={() => setLocalRows(r => clamp(r + 10))} className="w-6 h-6 text-xs font-bold text-violet-600 bg-violet-50 border border-violet-200 rounded-md hover:bg-violet-100">+</button>
              </div>
              <span className="text-[10px] text-violet-400">suggested: {previewRows}</span>
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => onApprove(localRows)} disabled={isRunning} className="flex-1 bg-violet-600 text-white text-xs py-2 rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-50 transition-colors">{isRunning ? '⏳ Fetching & Analyzing…' : '🔍 Allow Peek'}</button>
            <button onClick={onReject} disabled={isRunning} className="flex-1 bg-white text-gray-600 text-xs py-2 rounded-lg font-semibold border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors">✕ Reject</button>
          </div>
        </div>
      )}
      {status === 'approved' && <div className="px-3 py-1.5 border-t border-violet-100 text-xs text-green-700 bg-green-50 font-medium">✓ Peek completed</div>}
      {status === 'rejected' && <div className="px-3 py-1.5 border-t border-violet-100 text-xs text-gray-400 bg-gray-50">✕ Rejected</div>}
      {status === 'error' && <div className="px-3 py-1.5 border-t border-violet-100 text-xs text-red-600 bg-red-50 font-medium">⚠ Peek failed</div>}
    </div>
  )
}

// ── Create Dataset block ─────────────────────────────────────────────────────
function CreateDatasetBlock({ suggestedName, onApprove, onReject, status }) {
  const [name, setName] = useState(suggestedName)
  const isPending = status === 'pending', isRunning = status === 'running'
  return (
    <div className="mt-2 rounded-xl border border-emerald-200 overflow-hidden text-left">
      <div className="bg-emerald-50 px-3 py-1.5 border-b border-emerald-200">
        <span className="text-xs text-emerald-700 font-semibold tracking-wide uppercase">✂ Cut New Dataset</span>
      </div>
      {(isPending || isRunning) && (
        <div className="px-3 py-2.5 space-y-2">
          <div>
            <label className="text-xs text-gray-500 font-medium mb-1 block">Dataset name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isRunning}
              className="w-full text-xs border border-gray-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-300 disabled:opacity-50"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => onApprove(name)} disabled={isRunning || !name.trim()} className="flex-1 bg-emerald-600 text-white text-xs py-2 rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors">{isRunning ? '⏳ Creating…' : '✓ Create Dataset'}</button>
            <button onClick={onReject} disabled={isRunning} className="flex-1 bg-white text-gray-600 text-xs py-2 rounded-lg font-semibold border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors">✕ Cancel</button>
          </div>
        </div>
      )}
      {status === 'approved' && <div className="px-3 py-1.5 text-xs text-green-700 bg-green-50 font-medium">✓ Dataset created — check Datasets page</div>}
      {status === 'rejected' && <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50">✕ Cancelled</div>}
      {status === 'error' && <div className="px-3 py-1.5 text-xs text-red-600 bg-red-50 font-medium">⚠ Creation failed</div>}
    </div>
  )
}

// ── Toggle Filter block (gap mode only) ─────────────────────────────────────
function ToggleFilterBlock({ filterName, proposedMode, reason, onApprove, onReject, status }) {
  const isPending = status === 'pending', isRunning = status === 'running'
  const modeLabel = { any: 'Any (no filter)', true: '✓ True (show matches)', false: '✗ False (exclude matches)' }
  return (
    <div className="mt-2 rounded-xl border border-amber-200 overflow-hidden text-left">
      <div className="bg-amber-50 px-3 py-1.5 border-b border-amber-200">
        <span className="text-xs text-amber-700 font-semibold tracking-wide uppercase">⚙ Toggle Filter</span>
      </div>
      <div className="px-3 py-2 text-xs text-gray-700 space-y-1">
        <p><span className="font-medium">Filter:</span> {filterName}</p>
        <p><span className="font-medium">Set mode to:</span> <span className="font-mono bg-gray-100 px-1 rounded">{proposedMode}</span> — {modeLabel[proposedMode] || proposedMode}</p>
        {reason && <p className="text-gray-500 italic">{reason}</p>}
      </div>
      {(isPending || isRunning) && (
        <div className="px-3 py-2 border-t border-amber-100 flex gap-2">
          <button onClick={onApprove} disabled={isRunning} className="flex-1 bg-amber-600 text-white text-xs py-2 rounded-lg font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors">{isRunning ? '…' : '✓ Apply'}</button>
          <button onClick={onReject} disabled={isRunning} className="flex-1 bg-white text-gray-600 text-xs py-2 rounded-lg font-semibold border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors">✕ Reject</button>
        </div>
      )}
      {status === 'approved' && <div className="px-3 py-1.5 text-xs text-green-700 bg-green-50 font-medium">✓ Filter mode updated</div>}
      {status === 'rejected' && <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50">✕ Rejected</div>}
    </div>
  )
}

// ── Create Filter Execution block (gap mode only) ────────────────────────────
function CreateFilterBlock({ filterName, reason, onApprove, onReject, status }) {
  const isPending = status === 'pending', isRunning = status === 'running'
  return (
    <div className="mt-2 rounded-xl border border-blue-200 overflow-hidden text-left">
      <div className="bg-blue-50 px-3 py-1.5 border-b border-blue-200">
        <span className="text-xs text-blue-700 font-semibold tracking-wide uppercase">▶ Run Filter</span>
      </div>
      <div className="px-3 py-2 text-xs text-gray-700 space-y-1">
        <p><span className="font-medium">Filter:</span> {filterName}</p>
        {reason && <p className="text-gray-500 italic">{reason}</p>}
      </div>
      {(isPending || isRunning) && (
        <div className="px-3 py-2 border-t border-blue-100 flex gap-2">
          <button onClick={onApprove} disabled={isRunning} className="flex-1 bg-blue-600 text-white text-xs py-2 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors">{isRunning ? '…' : '▶ Run Filter'}</button>
          <button onClick={onReject} disabled={isRunning} className="flex-1 bg-white text-gray-600 text-xs py-2 rounded-lg font-semibold border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-colors">✕ Reject</button>
        </div>
      )}
      {status === 'approved' && <div className="px-3 py-1.5 text-xs text-green-700 bg-green-50 font-medium">✓ Filter started</div>}
      {status === 'rejected' && <div className="px-3 py-1.5 text-xs text-gray-400 bg-gray-50">✕ Rejected</div>}
      {status === 'error' && <div className="px-3 py-1.5 text-xs text-red-600 bg-red-50 font-medium">⚠ Failed to run filter</div>}
    </div>
  )
}

// ── Message bubble ───────────────────────────────────────────────────────────
function Message({ msg, onApprove, onReject, onPeekApprove, onPeekReject, onDatasetApprove, onDatasetReject, onToggleApprove, onToggleReject, onFilterApprove, onFilterReject }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm ${isUser ? 'bg-indigo-600 text-white' : 'bg-white border border-gray-200 text-gray-800'}`}>
        {isUser && msg.text && <p className="text-xs leading-relaxed whitespace-pre-wrap">{msg.text}</p>}
        {!isUser && msg.text && <MarkdownText text={msg.text} />}
        {msg.sql && <QueryBlock sql={msg.sql} explanation={msg.explanation} onApprove={() => onApprove(msg.id)} onReject={() => onReject(msg.id)} status={msg.queryStatus || 'pending'} />}
        {msg.isPeek && <PeekBlock explanation={msg.explanation} previewRows={msg.previewRows} onApprove={(rows) => onPeekApprove(msg.id, rows)} onReject={() => onPeekReject(msg.id)} status={msg.peekStatus || 'pending'} />}
        {msg.isCreateDataset && <CreateDatasetBlock suggestedName={msg.datasetName} onApprove={(name) => onDatasetApprove(msg.id, name)} onReject={() => onDatasetReject(msg.id)} status={msg.datasetStatus || 'pending'} />}
        {msg.isToggleFilter && <ToggleFilterBlock filterName={msg.filterName} proposedMode={msg.filterMode} reason={msg.reason} onApprove={() => onToggleApprove(msg.id)} onReject={() => onToggleReject(msg.id)} status={msg.toggleStatus || 'pending'} />}
        {msg.isCreateFilter && <CreateFilterBlock filterName={msg.filterName} reason={msg.reason} onApprove={() => onFilterApprove(msg.id)} onReject={() => onFilterReject(msg.id)} status={msg.filterExecStatus || 'pending'} />}
      </div>
    </div>
  )
}

// ── Typing indicator ─────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex justify-start mb-3">
      <div className="bg-white border border-gray-200 rounded-2xl px-4 py-3">
        <div className="flex items-center gap-1">
          {[0, 150, 300].map(delay => <div key={delay} className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: `${delay}ms` }} />)}
        </div>
      </div>
    </div>
  )
}

// ── Main ChatPanel ───────────────────────────────────────────────────────────
/**
 * ChatPanel — unified agent chat for datasets and gap analyses.
 *
 * Props:
 *  mode: "dataset" | "gap"
 *  entityId: dataset or analysis ID
 *  entityName: display name
 *  agentModel: string (for display in header)
 *  onQueryResults(columns, rows, sql, truncated, truncatedAt): called when SQL runs
 *  onClearResults(): revert table to normal view
 *  getPeekRows(n): async (n: number) => rows[] — fetches n rows from current view
 *  // Gap mode only:
 *  gapContext: { executions: [{id, name, current_mode}], availableFilters: [{id, name}] }
 *  onToggleFilter(executionId, mode): called when agent toggles a filter
 *  onCreateFilterExecution(filterId, name): called when agent creates a filter
 */
export default function ChatPanel({
  mode = 'dataset',
  entityId,
  entityName,
  agentModel = 'gemini-2.5-flash',
  onQueryResults,
  onClearResults,
  getPeekRows,
  gapContext = {},
  onToggleFilter,
  onCreateFilterExecution,
}) {
  const navigate = useNavigate()

  const welcomeText = mode === 'dataset'
    ? `Hi! I can analyze the **"${entityName}"** dataset. Ask me a question, and I'll write a BigQuery query or peek at the data to answer it. You'll review before anything runs.\n\nTry:\n- "What are the top items by search volume?"\n- "Show me a random sample of 20 items"\n- "Cut a new dataset of high-competition keywords"`
    : `Hi! I can analyze this gap analysis. I can query the results, toggle filters on/off, run new filters, or cut a new dataset from the current view.\n\nTry:\n- "What are the most distant items?"\n- "Toggle the best-match filter to show only true"\n- "Cut a dataset from the top 100 gap items"`

  const [messages, setMessages] = useState([{ id: 'welcome', role: 'assistant', text: welcomeText }])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [executing, setExecuting] = useState(null)
  const bottomRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

  const addMsg = (msg) => {
    const id = crypto.randomUUID()
    setMessages(prev => [...prev, { id, ...msg }])
    return id
  }
  const updateMsg = (id, updates) => setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m))

  const buildHistory = () =>
    messages.filter(m => (m.role === 'user' && m.text) || (m.role === 'assistant' && m.text))
      .slice(-10).map(m => ({ role: m.role, content: m.text }))

  const messagePrefix = mode === 'dataset' ? `${API_BASE}/api/datasets/${entityId}/chat` : `${API_BASE}/api/gap-analyses/${entityId}/chat`

  // ── Send message ────────────────────────────────────────────────────────
  const handleSend = async () => {
    const text = input.trim()
    if (!text || loading || executing) return
    setInput('')
    inputRef.current?.focus()
    addMsg({ role: 'user', text })
    setLoading(true)
    try {
      const body = { message: text, history: buildHistory() }
      if (mode === 'gap') body.context = buildGapContext()
      const res = await fetch(`${messagePrefix}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) { addMsg({ role: 'assistant', text: `Error: ${data.detail || 'Something went wrong.'}` }); return }
      if (data.type === 'query') {
        addMsg({ role: 'assistant', sql: data.sql, explanation: data.explanation, queryStatus: 'pending' })
      } else if (data.type === 'peek') {
        addMsg({ role: 'assistant', isPeek: true, explanation: data.explanation, previewRows: data.preview_rows, peekStatus: 'pending' })
      } else if (data.type === 'create_dataset') {
        addMsg({ role: 'assistant', isCreateDataset: true, datasetName: data.name, datasetSql: data.sql || '', datasetStatus: 'pending' })
      } else if (data.type === 'toggle_filter' && mode === 'gap') {
        addMsg({ role: 'assistant', isToggleFilter: true, executionId: data.execution_id, filterName: data.name, filterMode: data.mode, reason: data.reason, toggleStatus: 'pending' })
      } else if (data.type === 'create_filter_execution' && mode === 'gap') {
        addMsg({ role: 'assistant', isCreateFilter: true, filterId: data.filter_id, filterName: data.name, reason: data.reason, filterExecStatus: 'pending' })
      } else {
        addMsg({ role: 'assistant', text: data.text || '(no response)' })
      }
    } catch {
      addMsg({ role: 'assistant', text: 'Network error — please try again.' })
    } finally {
      setLoading(false)
    }
  }

  const buildGapContext = () => ({
    executions: (gapContext.executions || []).map(e => ({ id: e.id, name: e.name, current_mode: e.current_mode })),
    available_filters: (gapContext.availableFilters || []).map(f => ({ id: f.id, name: f.name })),
  })

  // ── Query approve/reject ────────────────────────────────────────────────
  const handleApprove = async (msgId) => {
    const msg = messages.find(m => m.id === msgId)
    if (!msg || executing) return
    setExecuting(msgId)
    updateMsg(msgId, { queryStatus: 'running' })
    try {
      const res = await fetch(`${messagePrefix}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: msg.sql }),
      })
      let data
      try { data = await res.json() } catch { updateMsg(msgId, { queryStatus: 'error' }); addMsg({ role: 'assistant', text: `Query returned a non-JSON response (status ${res.status}).` }); return }
      if (!res.ok) { updateMsg(msgId, { queryStatus: 'error' }); addMsg({ role: 'assistant', text: `Query failed: ${data.detail || 'Unknown error'}` }); return }
      updateMsg(msgId, { queryStatus: 'approved' })
      const n = data.row_count
      const truncNote = data.truncated ? ` (capped at ${data.truncated_at?.toLocaleString()} rows)` : ''
      addMsg({ role: 'assistant', text: `✓ Returned ${n.toLocaleString()} row${n !== 1 ? 's' : ''}${truncNote}. Table updated.` })
      onQueryResults?.(data.columns, data.rows, msg.sql, data.truncated, data.truncated_at)
    } catch {
      updateMsg(msgId, { queryStatus: 'error' })
      addMsg({ role: 'assistant', text: 'Network error while running the query.' })
    } finally { setExecuting(null) }
  }

  const handleReject = (msgId) => {
    if (executing) return
    updateMsg(msgId, { queryStatus: 'rejected' })
    addMsg({ role: 'assistant', text: "No problem — let me know how to adjust the query." })
  }

  // ── Peek approve/reject ─────────────────────────────────────────────────
  const handlePeekApprove = async (msgId, adjustedRows) => {
    const msg = messages.find(m => m.id === msgId)
    if (!msg || executing) return
    setExecuting(msgId)
    updateMsg(msgId, { peekStatus: 'running' })
    try {
      const rows = await getPeekRows?.(adjustedRows) || []
      const columns = rows.length > 0 ? Object.keys(rows[0]) : []
      const res = await fetch(`${messagePrefix}/peek`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rows,
          columns,
          preview_rows: rows.length,
          explanation: msg.explanation,
          history: buildHistory(),
          ...(mode === 'gap' ? { context: buildGapContext() } : {}),
        }),
      })
      let data
      try { data = await res.json() } catch { updateMsg(msgId, { peekStatus: 'error' }); addMsg({ role: 'assistant', text: 'Peek returned a non-JSON response.' }); return }
      if (!res.ok) { updateMsg(msgId, { peekStatus: 'error' }); addMsg({ role: 'assistant', text: `Peek failed: ${data.detail || 'Unknown error'}` }); return }
      updateMsg(msgId, { peekStatus: 'approved' })
      addMsg({ role: 'assistant', text: data.text })
    } catch {
      updateMsg(msgId, { peekStatus: 'error' })
      addMsg({ role: 'assistant', text: 'Network error during peek.' })
    } finally { setExecuting(null) }
  }

  const handlePeekReject = (msgId) => {
    if (executing) return
    updateMsg(msgId, { peekStatus: 'rejected' })
    addMsg({ role: 'assistant', text: "Got it — ask another way or let me know how to proceed." })
  }

  // ── Create dataset approve/reject ───────────────────────────────────────
  const handleDatasetApprove = async (msgId, name) => {
    const msg = messages.find(m => m.id === msgId)
    if (!msg || executing) return
    setExecuting(msgId)
    updateMsg(msgId, { datasetStatus: 'running' })
    try {
      let body = { name }
      let endpoint = `${messagePrefix}/create-dataset`
      if (mode === 'dataset') {
        body.sql = msg.datasetSql
      } else {
        // Gap mode: get all current visible items
        const rows = await getPeekRows?.(5000) || []
        body.items = rows.map(r => r.keyword_text || r.item_text || '').filter(Boolean)
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      let data
      try { data = await res.json() } catch { updateMsg(msgId, { datasetStatus: 'error' }); addMsg({ role: 'assistant', text: 'Failed to create dataset.' }); return }
      if (!res.ok) { updateMsg(msgId, { datasetStatus: 'error' }); addMsg({ role: 'assistant', text: `Failed: ${data.detail || 'Unknown error'}` }); return }
      updateMsg(msgId, { datasetStatus: 'approved' })
      addMsg({ role: 'assistant', text: `✓ Created dataset **"${data.name}"** with ${data.item_count.toLocaleString()} items. [View it →](/datasets/${data.dataset_id})` })
    } catch {
      updateMsg(msgId, { datasetStatus: 'error' })
      addMsg({ role: 'assistant', text: 'Network error creating dataset.' })
    } finally { setExecuting(null) }
  }

  const handleDatasetReject = (msgId) => {
    if (executing) return
    updateMsg(msgId, { datasetStatus: 'rejected' })
    addMsg({ role: 'assistant', text: "No problem — just let me know if you'd like a different cut." })
  }

  // ── Toggle filter approve/reject (gap mode) ─────────────────────────────
  const handleToggleApprove = async (msgId) => {
    const msg = messages.find(m => m.id === msgId)
    if (!msg || executing) return
    setExecuting(msgId)
    updateMsg(msgId, { toggleStatus: 'running' })
    onToggleFilter?.(msg.executionId, msg.filterMode)
    updateMsg(msgId, { toggleStatus: 'approved' })
    addMsg({ role: 'assistant', text: `✓ Filter "${msg.filterName}" set to **${msg.filterMode}**.` })
    setExecuting(null)
  }

  const handleToggleReject = (msgId) => {
    if (executing) return
    updateMsg(msgId, { toggleStatus: 'rejected' })
    addMsg({ role: 'assistant', text: "No problem — I'll leave the filter as-is." })
  }

  // ── Create filter execution approve/reject (gap mode) ───────────────────
  const handleFilterApprove = async (msgId) => {
    const msg = messages.find(m => m.id === msgId)
    if (!msg || executing) return
    setExecuting(msgId)
    updateMsg(msgId, { filterExecStatus: 'running' })
    try {
      await onCreateFilterExecution?.(msg.filterId, msg.filterName)
      updateMsg(msgId, { filterExecStatus: 'approved' })
      addMsg({ role: 'assistant', text: `✓ Started running filter **"${msg.filterName}"**. Results will appear shortly.` })
    } catch (e) {
      updateMsg(msgId, { filterExecStatus: 'error' })
      addMsg({ role: 'assistant', text: `Failed to run filter: ${e.message || 'unknown error'}` })
    } finally { setExecuting(null) }
  }

  const handleFilterReject = (msgId) => {
    if (executing) return
    updateMsg(msgId, { filterExecStatus: 'rejected' })
    addMsg({ role: 'assistant', text: "No problem — let me know if you'd like to run a different filter." })
  }

  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }
  const isBusy = loading || executing !== null

  return (
    <div className="flex flex-col h-full bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-900">Analysis Assistant</span>
          <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full font-medium truncate max-w-[120px]" title={agentModel}>{agentModel}</span>
        </div>
        {onClearResults && (
          <button onClick={onClearResults} className="text-xs text-gray-400 hover:text-gray-600 transition-colors" title="Clear query results">
            Clear results
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        {messages.map(msg => (
          <Message key={msg.id} msg={msg}
            onApprove={handleApprove} onReject={handleReject}
            onPeekApprove={handlePeekApprove} onPeekReject={handlePeekReject}
            onDatasetApprove={handleDatasetApprove} onDatasetReject={handleDatasetReject}
            onToggleApprove={handleToggleApprove} onToggleReject={handleToggleReject}
            onFilterApprove={handleFilterApprove} onFilterReject={handleFilterReject}
          />
        ))}
        {isBusy && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-4 py-3 border-t border-gray-200 bg-white shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about this data… (Enter to send, Shift+Enter for newline)"
            rows={2}
            disabled={isBusy}
            className="flex-1 text-xs border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-60 leading-relaxed"
          />
          <button onClick={handleSend} disabled={isBusy || !input.trim()} className="bg-indigo-600 text-white rounded-xl px-4 py-2 text-xs font-semibold disabled:opacity-40 hover:bg-indigo-700 shrink-0 transition-colors">
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
