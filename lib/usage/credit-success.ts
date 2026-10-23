// HTTP 200 can contain a request to reindex, not a usable Document AI answer.
export function documentCreditSucceeded(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  const row = value as { answer?: unknown; sources?: unknown; error?: unknown }
  return typeof row.answer === 'string' && !!row.answer.trim() && !row.error &&
    Array.isArray(row.sources) && row.sources.length > 0
}
