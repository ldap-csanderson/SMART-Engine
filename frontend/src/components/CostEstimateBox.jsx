/**
 * Estimate the LLM cost of running a single filter over `uniqueKeywords` keywords.
 * Input tokens ≈ ceil(filter.text.length / 4) + 45 boilerplate tokens
 * Output tokens ≈ 10 (short JSON result)
 * Prices: $0.25/1M input, $1.50/1M output (Gemini Flash)
 */
export function estimateFilterCost(filter, uniqueKeywords) {
  const inputTokens = Math.ceil(filter.text.length / 4) + 45
  const outputTokens = 10
  return ((inputTokens * 0.25 + outputTokens * 1.50) / 1_000_000) * uniqueKeywords
}

/**
 * CostEstimateBox — reusable amber cost estimate panel.
 *
 * Two modes, selected by presence of `analysisBreakdown`:
 *
 * GAP ANALYSIS mode  (analysisBreakdown present)
 *   Shows unique keyword count, LLM cost line, embedding cost line,
 *   per-filter rows, and a grand total.
 *
 * FILTER-ONLY mode  (analysisBreakdown absent)
 *   Simplified: "Running over N analyzed keywords", per-filter rows, total.
 *   No LLM/embedding sub-lines (those costs don't apply when re-running
 *   filters against an already-analyzed gap analysis).
 *
 * Props
 *   uniqueKeywords      — number of keywords being processed
 *   analysisBreakdown   — optional { llm_cost, embedding_cost, subtotal }
 *   selectedFilters     — array of filter objects (with .name)
 *   filterCosts         — parallel number[] — one estimated cost per filter
 */
export default function CostEstimateBox({
  uniqueKeywords,
  analysisBreakdown = null,
  selectedFilters = [],
  filterCosts = [],
}) {
  const isAnalysisMode = analysisBreakdown !== null
  const totalFilterCost = filterCosts.reduce((s, c) => s + c, 0)
  const grandTotal = isAnalysisMode
    ? (analysisBreakdown.subtotal + totalFilterCost)
    : totalFilterCost

  return (
    <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
      <p className="text-sm font-semibold text-amber-800 mb-2">Estimated Cost</p>

      {isAnalysisMode ? (
        /* ── GAP ANALYSIS mode ── */
        <div className="flex justify-between items-start gap-4">
          <div className="text-sm text-amber-700 space-y-0.5">
            <p className="font-medium">{uniqueKeywords.toLocaleString()} unique keywords</p>
            <p className="pl-2 text-xs text-amber-600">
              LLM (intent generation): ~${analysisBreakdown.llm_cost.toFixed(2)}
            </p>
            <p className="pl-2 text-xs text-amber-600">
              Embeddings (text-embedding-005): ~${analysisBreakdown.embedding_cost.toFixed(2)}
            </p>
          </div>
          <span className={`font-bold text-amber-900 whitespace-nowrap ${selectedFilters.length > 0 ? 'text-base' : 'text-2xl'}`}>
            ~${analysisBreakdown.subtotal.toFixed(2)}
          </span>
        </div>
      ) : (
        /* ── FILTER-ONLY mode ── */
        <p className="text-sm text-amber-700 font-medium mb-2">
          Running over {uniqueKeywords.toLocaleString()} analyzed keywords
        </p>
      )}

      {/* Per-filter rows (both modes) */}
      {selectedFilters.length > 0 && (
        <>
          <div className={`space-y-1 ${isAnalysisMode ? 'mt-2 pt-2 border-t border-amber-200' : ''}`}>
            {selectedFilters.map((f, i) => (
              <div key={f.filter_id} className="flex justify-between items-center">
                <span className="text-xs text-amber-600 truncate mr-2" title={f.name}>
                  {isAnalysisMode ? '+ ' : ''}{f.name}
                </span>
                <span className="text-sm font-medium text-amber-900 whitespace-nowrap">
                  ~${filterCosts[i]?.toFixed(2) ?? '—'}
                </span>
              </div>
            ))}
          </div>

          {/* Total row */}
          <div className="flex justify-between items-center mt-2 pt-2 border-t border-amber-300">
            <span className="text-xs font-semibold text-amber-800">Total</span>
            <span className="text-2xl font-bold text-amber-900 whitespace-nowrap">
              ~${grandTotal.toFixed(2)}
            </span>
          </div>
        </>
      )}

      {/* Filter-only with no filters selected shouldn't normally render,
          but show grand total if analysisBreakdown absent and no filters */}
      {!isAnalysisMode && selectedFilters.length === 0 && (
        <p className="text-lg font-bold text-amber-900">~$0.00</p>
      )}
    </div>
  )
}
