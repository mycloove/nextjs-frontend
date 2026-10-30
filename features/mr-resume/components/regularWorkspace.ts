export type RegularSuspensionState = {
  restored: boolean
  printing: boolean
  gesture: boolean
  modal: boolean
  writable: boolean
}

/** Keep uncommitted editing in memory; never bypass a blocked/corrupt restore to flush. */
export function prepareRegularSuspension(state: RegularSuspensionState, persist: () => string): {
  reason: string | null
  savedAt?: string
  saveFailed?: boolean
} {
  if (!state.restored) return { reason: 'The Regular draft is still restoring. Please wait before switching editors.' }
  if (state.printing) return { reason: 'Finish the draft PDF export before switching editors.' }
  if (state.gesture) return { reason: 'Finish moving or resizing the document before switching editors.' }
  if (state.modal) return { reason: 'Close the open editor dialog before switching editors.' }
  if (!state.writable) return { reason: null }
  try { return { reason: null, savedAt: persist() } }
  catch { return { reason: null, saveFailed: true } }
}
