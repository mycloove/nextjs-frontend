/** Session-local presentation policy. The workspace hook still owns save/build/proof truth. */
export type FeedbackPriority = 0 | 1 | 2 | 3 | 4
export type FeedbackFact = {
  id: string
  /** Producer-owned identifiers, not message text or a classifier's guess. */
  category: string
  code: string
  severity: 'error' | 'warning' | 'success' | 'info'
  priority: FeedbackPriority
  origin: 'manual' | 'auto' | 'recovery'
  projectId: string | null
  projectTitle?: string
  revision?: number
  sourceIdentity?: string
  runtime?: 'browser' | 'native'
  operationKey?: string
  actionRequestId?: string
  /** Stable for one unresolved reason/episode; use a new request or key when it recurs. */
  dedupeKey: string
  lifecycle: 'attention' | 'progress' | 'receipt' | 'info'
  summary: string
  detailRef?: string
  actionIds: string[]
  /** Epoch milliseconds. Updates retain the episode's original createdAt. */
  createdAt: number
  updatedAt: number
}

export type FeedbackScope = Pick<FeedbackFact, 'projectId' | 'category' | 'code' | 'dedupeKey'
  | 'revision' | 'sourceIdentity' | 'runtime' | 'operationKey' | 'actionRequestId'>

export const MAX_FEEDBACK_ACTIVITY = 100
export const RECEIPT_VISIBLE_MS = 5_000
export const RECEIPT_STALE_MS = 30_000

export type FeedbackState = {
  /** Unresolved action outcomes only; never a second copy of canonical save/compile state. */
  outcomes: FeedbackFact[]
  activity: FeedbackFact[]
  receipts: FeedbackFact[]
  /** Causal dismissals plus receipt/resolved tombstones; neither changes canonical domain facts. */
  dismissals: string[]
}

export type FeedbackEvent =
  | { type: 'publish'; fact: FeedbackFact; source?: 'action' | 'derived' }
  | { type: 'resolve'; scope: FeedbackScope }
  | { type: 'dismiss'; fact: FeedbackFact }
  | { type: 'expire-receipt'; identity: string }

export function createFeedbackState(): FeedbackState {
  return { outcomes: [], activity: [], receipts: [], dismissals: [] }
}

/** Missing optional fields are exact absence, never wildcards for another revision/request. */
export function feedbackIdentity(scope: FeedbackScope): string {
  return JSON.stringify([scope.projectId, scope.category, scope.code, scope.dedupeKey,
    scope.operationKey ?? null, scope.actionRequestId ?? null, scope.sourceIdentity ?? null,
    scope.revision ?? null, scope.runtime ?? null])
}

export function isReceiptFact(fact: FeedbackFact): boolean {
  return fact.priority === 3 && fact.lifecycle === 'receipt' && fact.origin !== 'auto' && fact.severity !== 'error'
}
const receiptDismissal = (identity: string) => `receipt:${identity}`
const resolvedOutcome = (identity: string) => `resolved:${identity}`
const acknowledgedRisk = (identity: string) => `acknowledged:${identity}`

function activityIdentity(fact: FeedbackFact): string {
  // Byte updates and phase changes occupy one progress entry per causal operation.
  if (fact.priority === 2 && fact.lifecycle === 'progress' && (fact.operationKey || fact.actionRequestId)) {
    return JSON.stringify(['progress', fact.projectId, fact.category, fact.runtime ?? null,
      fact.operationKey ?? null, fact.actionRequestId ?? null, fact.sourceIdentity ?? null, fact.revision ?? null])
  }
  return JSON.stringify([feedbackIdentity(fact), fact.lifecycle])
}

function upsertFact(facts: FeedbackFact[], fact: FeedbackFact, identity: (fact: FeedbackFact) => string = feedbackIdentity): FeedbackFact[] {
  const key = identity(fact), index = facts.findIndex((item) => identity(item) === key)
  if (index < 0) return [...facts, { ...fact, actionIds: [...fact.actionIds] }]
  const previous = facts[index]
  if (fact.updatedAt < previous.updatedAt) return facts
  const replacement = { ...fact, id: previous.id, createdAt: previous.createdAt, actionIds: [...fact.actionIds] }
  const fields = new Set([...Object.keys(previous), ...Object.keys(replacement)] as (keyof FeedbackFact)[])
  if ([...fields].every((field) => field === 'actionIds'
    ? previous.actionIds.length === replacement.actionIds.length && previous.actionIds.every((action, index) => action === replacement.actionIds[index])
    : previous[field] === replacement[field])) return facts
  const next = [...facts]
  next[index] = replacement
  return next
}

export function feedbackReducer(state: FeedbackState, event: FeedbackEvent): FeedbackState {
  if (event.type === 'resolve') {
    const identity = feedbackIdentity(event.scope)
    const resolved = resolvedOutcome(identity)
    const acknowledged = acknowledgedRisk(identity)
    if (!state.outcomes.some((fact) => feedbackIdentity(fact) === identity) && !state.dismissals.includes(identity)
      && !state.dismissals.includes(acknowledged) && state.dismissals.includes(resolved)) return state
    return { ...state,
      outcomes: state.outcomes.filter((fact) => feedbackIdentity(fact) !== identity),
      // A late duplicate outcome cannot resurrect a verified resolution. A new episode needs a new causal key.
      dismissals: [...new Set([...state.dismissals.filter((key) => key !== identity && key !== acknowledged), resolved])],
    }
  }
  if (event.type === 'dismiss' || event.type === 'expire-receipt') {
    const identity = event.type === 'dismiss' ? feedbackIdentity(event.fact) : event.identity
    const receipt = event.type === 'expire-receipt' || isReceiptFact(event.fact)
    const hasReceipt = state.receipts.some((fact) => feedbackIdentity(fact) === identity)
    if (event.type === 'expire-receipt' && !hasReceipt) return state
    const dismissal = receipt ? receiptDismissal(identity) : event.type === 'dismiss' && event.fact.priority === 0 ? acknowledgedRisk(identity) : identity
    if (state.dismissals.includes(dismissal) && (!receipt || !hasReceipt)) return state
    // Acknowledgment is presentation-only. In particular, P0 is never removed here.
    return { ...state,
      receipts: receipt ? state.receipts.filter((fact) => feedbackIdentity(fact) !== identity) : state.receipts,
      dismissals: state.dismissals.includes(dismissal) ? state.dismissals : [...state.dismissals, dismissal],
    }
  }

  const { fact } = event, identity = feedbackIdentity(fact)
  let outcomes = state.outcomes
  if (event.source !== 'derived' && fact.priority <= 1 && !state.dismissals.includes(resolvedOutcome(identity))) {
    const previous = outcomes.find((item) => feedbackIdentity(item) === identity)
    // Even a same-scope lower-priority publication is not verified resolution of a source risk.
    if (!previous || fact.priority <= previous.priority) outcomes = upsertFact(outcomes, fact)
  }
  const outcome = outcomes.find((item) => feedbackIdentity(item) === identity)
  const activityFact = fact.priority <= 1 && event.source !== 'derived' && outcome ? outcome : fact
  const entries = upsertFact(state.activity, activityFact, activityIdentity)
  const activity = entries.length > MAX_FEEDBACK_ACTIVITY ? entries.slice(-MAX_FEEDBACK_ACTIVITY) : entries
  const receipts = isReceiptFact(fact) && !state.dismissals.includes(receiptDismissal(identity)) ? upsertFact(state.receipts, fact) : state.receipts
  // Activity eviction never evicts a receipt: the selected project may be focusing a non-head entry.
  return outcomes === state.outcomes && activity === state.activity && receipts === state.receipts
    ? state : { outcomes, activity, receipts, dismissals: state.dismissals }
}

export type FeedbackAttention = {
  primary: FeedbackFact | null
  /** All relevant unresolved issues, including explicitly deferred P1 issues. */
  issues: FeedbackFact[]
  deferred: FeedbackFact[]
  otherCount: number
  acknowledged: boolean
}

export function selectAttention(state: FeedbackState, derivedFacts: readonly FeedbackFact[], projectId: string | null): FeedbackAttention {
  const candidates = new Map<string, FeedbackFact>()
  for (const fact of [...state.outcomes, ...derivedFacts]) {
    if (fact.priority > 1 || (fact.projectId !== null && fact.projectId !== projectId && fact.priority !== 0)) continue
    const identity = feedbackIdentity(fact), previous = candidates.get(identity)
    if (!previous || fact.priority < previous.priority || (fact.priority === previous.priority && fact.updatedAt >= previous.updatedAt)) {
      candidates.set(identity, previous ? { ...fact, createdAt: Math.min(previous.createdAt, fact.createdAt) } : fact)
    }
  }
  const contextRank = (fact: FeedbackFact) => fact.projectId === projectId ? 0 : fact.projectId === null ? 1 : 2
  const issues = [...candidates.values()].sort((a, b) => {
    const left = feedbackIdentity(a), right = feedbackIdentity(b)
    return a.priority - b.priority || contextRank(a) - contextRank(b) || a.createdAt - b.createdAt
      || (left < right ? -1 : left > right ? 1 : 0)
  })
  const deferred = issues.filter((fact) => fact.priority !== 0 && state.dismissals.includes(feedbackIdentity(fact)))
  const primary = issues.find((fact) => fact.priority === 0 || !state.dismissals.includes(feedbackIdentity(fact))) ?? null
  return { primary, issues, deferred, otherCount: issues.length - (primary ? 1 : 0),
    acknowledged: Boolean(primary?.priority === 0 && state.dismissals.includes(acknowledgedRisk(feedbackIdentity(primary)))) }
}

/** Selection never drops an already-visible focused receipt by comparing its age. The clock does that. */
export function selectReceipt(state: FeedbackState, projectId: string | null): FeedbackFact | null {
  return state.receipts.find((fact) => isReceiptFact(fact) && (fact.projectId === null || fact.projectId === projectId)
    && !state.dismissals.includes(receiptDismissal(feedbackIdentity(fact)))) ?? null
}

export function selectActivity(facts: readonly FeedbackFact[], projectId: string | null): FeedbackFact[] {
  return facts.filter((fact) => fact.projectId === null || fact.projectId === projectId).slice(-MAX_FEEDBACK_ACTIVITY).reverse()
}

export function feedbackProjectLabel(fact: FeedbackFact, projectId: string | null): string | null {
  return fact.projectId !== null && fact.projectId !== projectId ? fact.projectTitle?.trim() || 'Untitled project' : null
}

export type ReceiptEnvironment = {
  /** The selected receipt can actually be shown in its parent anchor (not queued or behind a modal). */
  visible: boolean
  active: boolean
  documentVisible: boolean
  hovered: boolean
  focused: boolean
}
export type ReceiptClock = {
  createdAt: number
  lastAt: number
  remainingMs: number
  shown: boolean
  expired: boolean
  environment: ReceiptEnvironment
}
const hiddenReceipt: ReceiptEnvironment = { visible: false, active: false, documentVisible: false, hovered: false, focused: false }
const receiptVisible = (environment: ReceiptEnvironment) => environment.visible && environment.active && environment.documentVisible

export function createReceiptClock(fact: Pick<FeedbackFact, 'createdAt'>, now: number): ReceiptClock {
  return { createdAt: fact.createdAt, lastAt: now, remainingMs: RECEIPT_VISIBLE_MS, shown: false, expired: false, environment: { ...hiddenReceipt } }
}

/** Charge the previous interval before applying the next visibility/focus event; all time is injected. */
export function advanceReceiptClock(clock: ReceiptClock, now: number, environment: ReceiptEnvironment): ReceiptClock {
  if (clock.expired) return clock
  const time = Math.max(clock.lastAt, now), previousVisible = receiptVisible(clock.environment), visible = receiptVisible(environment)
  const running = previousVisible && !clock.environment.hovered && !clock.environment.focused
  const remainingMs = Math.max(0, clock.remainingMs - (running ? time - clock.lastAt : 0))
  const interacting = visible && (environment.focused || environment.hovered)
  // Thirty seconds is an anti-replay limit for queued/hidden receipts, not a cap on reading a focused action.
  const stale = time - clock.createdAt > RECEIPT_STALE_MS && (!clock.shown || !previousVisible || !visible)
  return { ...clock, lastAt: time, remainingMs, shown: clock.shown || visible,
    expired: !(interacting && clock.shown) && (stale || remainingMs === 0), environment: { ...environment } }
}

/** Next meaningful clock deadline; no animation-frame loop or per-byte timer reset is necessary. */
export function receiptWakeDelay(clock: ReceiptClock): number | null {
  if (clock.expired) return null
  if (receiptVisible(clock.environment)) return clock.environment.hovered || clock.environment.focused ? null : clock.remainingMs
  return Math.max(1, clock.createdAt + RECEIPT_STALE_MS + 1 - clock.lastAt)
}

export type FeedbackAnnouncementInput = {
  attention: FeedbackFact | null
  progress?: FeedbackFact | null
  receipt?: FeedbackFact | null
  active: boolean
  projectId: string | null
  modalOpen?: boolean
}
export type FeedbackAnnouncement = { key: string; text: string; politeness: 'assertive' | 'polite' }

/** Progress producers use code for the phase; byte/message changes must not change this identity. */
export function feedbackAnnouncementKey(fact: FeedbackFact): string {
  return JSON.stringify([feedbackIdentity(fact), fact.priority, fact.lifecycle])
}

export function selectAnnouncement(input: FeedbackAnnouncementInput, seen: ReadonlySet<string>, now?: number): FeedbackAnnouncement | null {
  if (!input.active) return null
  const facts = [input.attention, input.progress, input.receipt].filter((fact): fact is FeedbackFact => Boolean(fact))
    .filter((fact) => (fact.projectId === null || fact.projectId === input.projectId || fact.priority === 0)
      && fact.priority < 4 && (fact.priority !== 3 || (isReceiptFact(fact) && (now === undefined || now - fact.createdAt <= RECEIPT_STALE_MS))))
    .sort((a, b) => a.priority - b.priority)
  const fact = facts.find((item) => (!input.modalOpen || item.priority === 0) && !seen.has(feedbackAnnouncementKey(item)))
  if (!fact) return null
  const project = feedbackProjectLabel(fact, input.projectId)
  return { key: feedbackAnnouncementKey(fact), text: `${project ? `${project}: ` : ''}${fact.summary}`,
    politeness: fact.priority === 0 ? 'assertive' : 'polite' }
}

/** Discard suppressed ordinary speech instead of replaying it; a P0 is consumed only when actually announced. */
export function rememberAnnouncements(seen: ReadonlySet<string>, input: FeedbackAnnouncementInput, announced: FeedbackAnnouncement | null): Set<string> {
  const next = new Set(seen), current = new Set<string>()
  for (const fact of [input.attention, input.progress, input.receipt]) {
    if (!fact) continue
    const key = feedbackAnnouncementKey(fact)
    current.add(key)
    if (fact.priority !== 0 || announced?.key === key) next.add(key)
  }
  // Protect the current issue/phase/receipt from repeated announcements during a long active build.
  for (const key of next) {
    if (next.size <= MAX_FEEDBACK_ACTIVITY) break
    if (!current.has(key)) next.delete(key)
  }
  return next
}
