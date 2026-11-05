import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { advanceReceiptClock, createFeedbackState, createReceiptClock, feedbackAnnouncementKey, feedbackIdentity,
  feedbackProjectLabel, feedbackReducer, isReceiptFact, MAX_FEEDBACK_ACTIVITY, RECEIPT_STALE_MS, RECEIPT_VISIBLE_MS,
  receiptWakeDelay, rememberAnnouncements, selectActivity, selectAnnouncement, selectAttention, selectReceipt,
  type FeedbackFact, type FeedbackState, type ReceiptEnvironment } from './feedback.ts'

function fact(overrides: Partial<FeedbackFact> = {}): FeedbackFact {
  return { id: 'save-risk', category: 'save', code: 'session-only', severity: 'warning', priority: 0, origin: 'auto',
    projectId: 'project-a', projectTitle: 'Research CV', revision: 7, sourceIdentity: 'source-a-7', runtime: 'browser',
    actionRequestId: 'save-request', dedupeKey: 'quota-episode-1', lifecycle: 'attention',
    summary: 'Changes are only in this session.', actionIds: ['export-source', 'save-as-new'], createdAt: 0, updatedAt: 0, ...overrides }
}
function receipt(overrides: Partial<FeedbackFact> = {}): FeedbackFact {
  return fact({ id: 'pdf-ready', category: 'compile', code: 'pdf-ready', priority: 3, severity: 'success', origin: 'manual',
    actionRequestId: undefined, operationKey: 'build-1', dedupeKey: 'pdf-ready', lifecycle: 'receipt',
    summary: 'PDF ready: 2 pages, revision 7.', actionIds: ['view-pdf'], ...overrides })
}
function publish(state: FeedbackState, ...facts: FeedbackFact[]) {
  return facts.reduce((current, fact) => feedbackReducer(current, { type: 'publish', fact }), state)
}
const visible: ReceiptEnvironment = { visible: true, active: true, documentVisible: true, hovered: false, focused: false }
const shownClock = () => advanceReceiptClock(createReceiptClock({ createdAt: 0 }, 0), 0, visible)

test('fresh feedback state is session-local and independent', () => {
  const first = createFeedbackState(), second = createFeedbackState()
  first.outcomes.push(fact())
  assert.deepEqual(second, { outcomes: [], activity: [], receipts: [], dismissals: [] })
})

test('explicit priority, not success wording or severity, decides attention', () => {
  const risk = fact({ summary: 'Saved! PDF ready.', severity: 'info' })
  const informational = fact({ id: 'info', priority: 4, lifecycle: 'info', severity: 'error', code: 'limits', summary: 'Source save failed.' })
  const permission = fact({ id: 'permission', priority: 1, severity: 'info', code: 'download-consent', summary: 'Review additional compiler files.' })
  const state = publish(createFeedbackState(), informational, permission, risk)
  assert.equal(selectAttention(state, [], 'project-a').primary?.id, risk.id)
  assert.equal(state.outcomes.length, 2)
  assert.equal(selectAttention(createFeedbackState(), [informational], 'project-a').primary, null)
})

test('derived canonical facts are Activity snapshots, not stored compiler/save state', () => {
  const risk = fact(), state = feedbackReducer(createFeedbackState(), { type: 'publish', fact: risk, source: 'derived' })
  assert.equal(state.outcomes.length, 0)
  assert.equal(state.activity.length, 1)
  assert.equal(selectAttention(state, [risk], 'project-a').primary, risk)
  assert.equal(selectAttention(state, [], 'project-a').primary, null)
  const resolved = feedbackReducer(state, { type: 'resolve', scope: risk })
  assert.equal(selectAttention(resolved, [risk], 'project-a').primary, risk, 'Only the canonical owner can resolve a derived risk')
})

test('compile, export and checkpoint success never mask unrelated source loss or action failures', () => {
  const risk = fact(), checkpoint = fact({ id: 'checkpoint', priority: 1, category: 'checkpoint', code: 'checkpoint-not-retained', actionRequestId: 'checkpoint-1' })
  const state = publish(createFeedbackState(), risk, checkpoint, receipt(), receipt({ id: 'export', category: 'export', code: 'download-started', actionRequestId: 'export-1' }))
  assert.deepEqual(selectAttention(state, [], 'project-a').issues.map((item) => item.id), [risk.id, checkpoint.id])
  assert.equal(state.receipts.length, 2)
})

test('even same-scope receipt or lower-priority publication is not resolution', () => {
  const risk = fact()
  let state = publish(createFeedbackState(), risk)
  state = publish(state, { ...risk, priority: 1, updatedAt: 1, summary: 'A lesser issue.' })
  state = publish(state, { ...risk, priority: 3, lifecycle: 'receipt', origin: 'manual', severity: 'success', updatedAt: 2, summary: 'Action complete.' })
  assert.equal(selectAttention(state, [], 'project-a').primary?.priority, 0)
  assert.equal(selectAttention(state, [], 'project-a').primary?.summary, risk.summary)
})

test('causal upsert preserves the first unresolved age and rejects out-of-order updates', () => {
  const original = fact({ priority: 1, createdAt: 10, updatedAt: 10 })
  let state = publish(createFeedbackState(), original)
  state = publish(state, { ...original, id: 'duplicate-event', createdAt: 20, updatedAt: 30, summary: 'A more specific explanation.' })
  state = publish(state, { ...original, updatedAt: 20, summary: 'Late old explanation.' })
  assert.equal(state.outcomes.length, 1)
  assert.equal(state.activity.length, 1)
  assert.equal(state.outcomes[0].id, original.id)
  assert.equal(state.outcomes[0].createdAt, 10)
  assert.equal(state.outcomes[0].updatedAt, 30)
  assert.equal(state.outcomes[0].summary, 'A more specific explanation.')
})

test('duplicate publication and dismissal are idempotent for retained React presenters', () => {
  const entry = fact(), state = publish(createFeedbackState(), entry)
  assert.equal(publish(state, { ...entry, actionIds: [...entry.actionIds] }), state)
  const dismissed = feedbackReducer(state, { type: 'dismiss', fact: entry })
  assert.equal(feedbackReducer(dismissed, { type: 'dismiss', fact: entry }), dismissed)
})

test('canonical observation and receipt re-emission dedupe by causal key, not an allocated event ID', () => {
  const entry = fact()
  let state = createFeedbackState()
  for (let index = 0; index < 10; index++) state = feedbackReducer(state, { type: 'publish', source: 'derived', fact: { ...entry, id: `observation-${index}`, updatedAt: index } })
  assert.equal(state.activity.length, 1)
  assert.equal(state.outcomes.length, 0)
  state = publish(state, receipt(), receipt({ id: 'new-result-observation', updatedAt: 20 }))
  assert.equal(state.activity.length, 2)
  assert.equal(state.receipts.length, 1)
})

const scopeVariants: Partial<FeedbackFact>[] = [
  { projectId: 'project-b' }, { category: 'checkpoint' }, { code: 'conflict' }, { dedupeKey: 'different-reason' },
  { operationKey: 'build-2' }, { actionRequestId: 'save-request-2' }, { sourceIdentity: 'different-source-at-r7' },
  { revision: 8 }, { runtime: 'native' },
]
for (const variation of scopeVariants) {
  test(`scope changes in ${Object.keys(variation)[0]} neither resolve nor inherit an old dismissal`, () => {
    const first = fact({ priority: 1 }), other = fact({ ...variation, id: 'other', priority: 1 })
    assert.notEqual(feedbackIdentity(first), feedbackIdentity(other))
    let state = publish(createFeedbackState(), first, other)
    state = feedbackReducer(state, { type: 'dismiss', fact: first })
    assert.ok(!state.dismissals.includes(feedbackIdentity(other)))
    state = feedbackReducer(state, { type: 'resolve', scope: first })
    assert.deepEqual(state.outcomes.map((item) => item.id), [other.id])
  })
}

test('display text, title and timestamps are not a causal identity', () => {
  const entry = fact()
  const updated = { ...entry, id: 're-render', projectTitle: 'Renamed CV', summary: 'New bytes', createdAt: 100, updatedAt: 200 }
  assert.equal(feedbackIdentity(entry), feedbackIdentity(updated))
  const unusual = fact({ projectId: 'a|b', category: 'c' }), other = fact({ projectId: 'a', category: 'b|c' })
  assert.notEqual(feedbackIdentity(unusual), feedbackIdentity(other), 'Encoded fields cannot collide through separators')
})

test('resolve with omitted optional causal fields is not a wildcard', () => {
  const entry = fact({ operationKey: 'operation' }), state = publish(createFeedbackState(), entry)
  const next = feedbackReducer(state, { type: 'resolve', scope: { projectId: entry.projectId, category: entry.category, code: entry.code, dedupeKey: entry.dedupeKey } })
  assert.equal(next.outcomes.length, 1)
})

test('matching resolution preserves Activity, rejects late duplicates, and allows a new episode', () => {
  const entry = fact({ priority: 1 })
  let state = feedbackReducer(publish(createFeedbackState(), entry), { type: 'dismiss', fact: entry })
  state = feedbackReducer(state, { type: 'resolve', scope: entry })
  assert.equal(state.outcomes.length, 0)
  assert.equal(state.activity.length, 1)
  assert.ok(!state.dismissals.includes(feedbackIdentity(entry)))
  assert.equal(feedbackReducer(state, { type: 'resolve', scope: entry }), state)
  state = publish(state, entry)
  assert.equal(selectAttention(state, [], 'project-a').primary, null)
  const nextEpisode = { ...entry, id: 'new-failure', actionRequestId: 'new-request', createdAt: 500, updatedAt: 500 }
  state = publish(state, nextEpisode)
  assert.equal(selectAttention(state, [], 'project-a').primary?.id, nextEpisode.id)
  assert.equal(state.activity.length, 2)
})

test('P0 acknowledgment never removes the risk, its actions, or canonical facts', () => {
  const entry = fact(), state = feedbackReducer(publish(createFeedbackState(), entry), { type: 'dismiss', fact: entry })
  const selection = selectAttention(state, [], 'project-a')
  assert.equal(selection.primary?.priority, 0)
  assert.equal(selection.acknowledged, true)
  assert.deepEqual(selection.primary?.actionIds, ['export-source', 'save-as-new'])
  assert.equal(selection.deferred.length, 0)
  assert.equal(state.outcomes.length, 1)
})

test('P1 defer hides only the primary interruption and retains issue/action access', () => {
  const error = fact({ id: 'build-error', priority: 1, severity: 'error', code: 'build-failed', actionIds: ['first-error', 'build-details'] })
  const state = feedbackReducer(publish(createFeedbackState(), error), { type: 'dismiss', fact: error })
  const selection = selectAttention(state, [], 'project-a')
  assert.equal(selection.primary, null)
  assert.equal(selection.issues.length, 1)
  assert.equal(selection.otherCount, 1)
  assert.deepEqual(selection.deferred[0].actionIds, ['first-error', 'build-details'])
})

test('P1 defer is not acknowledgment of a later P0, and P0 acknowledgment cannot defer a P1', () => {
  const risk = fact(), decision = { ...risk, priority: 1 as const }
  const deferred = feedbackReducer(createFeedbackState(), { type: 'dismiss', fact: decision })
  assert.equal(selectAttention(deferred, [risk], 'project-a').acknowledged, false)
  const acknowledged = feedbackReducer(createFeedbackState(), { type: 'dismiss', fact: risk })
  assert.equal(selectAttention(acknowledged, [decision], 'project-a').primary, decision)
  const resolved = feedbackReducer(acknowledged, { type: 'resolve', scope: risk })
  assert.equal(selectAttention(resolved, [risk], 'project-a').acknowledged, false)
})

test('automatic success is Activity-only; manual and recovery receipts use the queue', () => {
  const auto = receipt({ origin: 'auto' }), manual = receipt({ operationKey: 'build-2' }), recovered = receipt({ operationKey: 'build-3', origin: 'recovery' })
  const state = publish(createFeedbackState(), auto, manual, recovered)
  assert.equal(state.activity.length, 3)
  assert.equal(state.receipts.length, 2)
  assert.equal(selectReceipt(state, 'project-a')?.operationKey, 'build-2')
  const derived = feedbackReducer(createFeedbackState(), { type: 'publish', fact: manual, source: 'derived' })
  assert.equal(derived.outcomes.length, 0)
  assert.equal(derived.receipts.length, 1)
})

test('priority P0/P1 and misrouted errors never become auto-expiring receipts', () => {
  for (const entry of [fact(), fact({ priority: 1 }), receipt({ severity: 'error' }), receipt({ lifecycle: 'progress' })]) {
    assert.equal(isReceiptFact(entry), false)
    assert.equal(publish(createFeedbackState(), entry).receipts.length, 0)
  }
})

test('receipt dismiss and expiry are scoped, idempotent and cannot replay through publication', () => {
  const first = receipt(), other = receipt({ id: 'other', projectId: 'project-b', operationKey: 'other-build' })
  for (const mode of ['dismiss', 'expire-receipt'] as const) {
    let state = publish(createFeedbackState(), first, other)
    state = feedbackReducer(state, mode === 'dismiss' ? { type: mode, fact: first } : { type: mode, identity: feedbackIdentity(first) })
    assert.deepEqual(state.receipts.map((item) => item.id), [other.id])
    state = publish(state, { ...first, updatedAt: 10 })
    assert.equal(selectReceipt(state, 'project-a'), null)
    assert.equal(selectReceipt(state, 'project-b')?.id, other.id)
    assert.equal(feedbackReducer(state, { type: 'expire-receipt', identity: feedbackIdentity(first) }), state)
    assert.equal(state.activity.length, 2)
  }
})

test('receipt timeout cannot acknowledge/defer an identically scoped P0 or P1 outcome', () => {
  for (const priority of [0, 1] as const) {
    const error = fact({ priority, severity: 'error' }), success = receipt({ ...error, id: 'partial-success', priority: 3, lifecycle: 'receipt', severity: 'success', origin: 'manual' })
    let state = publish(createFeedbackState(), error, success)
    state = feedbackReducer(state, { type: 'expire-receipt', identity: feedbackIdentity(success) })
    const selection = selectAttention(state, [], 'project-a')
    assert.equal(selection.primary?.priority, priority)
    assert.equal(selection.acknowledged, false)
    assert.equal(selection.deferred.length, 0)
    assert.equal(feedbackReducer(state, { type: 'expire-receipt', identity: feedbackIdentity(error) }), state)
  }
})

test('receipt updates preserve its original age and queue position, never restart visibility time', () => {
  const first = receipt({ createdAt: 10, updatedAt: 10 }), second = receipt({ operationKey: 'build-2', createdAt: 20, updatedAt: 20 })
  const state = publish(createFeedbackState(), first, second, { ...first, createdAt: 40, updatedAt: 40, summary: 'Updated proof details.' })
  assert.equal(state.receipts.length, 2)
  assert.equal(selectReceipt(state, 'project-a')?.createdAt, 10)
  assert.equal(selectReceipt(state, 'project-a')?.updatedAt, 40)
})

test('all phases and byte updates coalesce per operation in Activity, not into outcomes', () => {
  const progress = fact({ id: 'progress', category: 'compile', code: 'engine-download', priority: 2, lifecycle: 'progress', actionRequestId: undefined, operationKey: 'build-1' })
  let state = publish(createFeedbackState(), progress)
  for (let index = 1; index <= 120; index++) state = publish(state, { ...progress, id: `byte-${index}`, updatedAt: index, summary: `${index} bytes verified` })
  state = publish(state, { ...progress, code: 'tex-pass-1', dedupeKey: 'phase-2', createdAt: 200, updatedAt: 200, summary: 'XeLaTeX: pass 1' })
  state = publish(state, { ...progress, updatedAt: 150, summary: 'Late download bytes' })
  assert.equal(state.activity.length, 1)
  assert.equal(state.activity[0].code, 'tex-pass-1')
  assert.equal(state.activity[0].createdAt, 0)
  assert.equal(state.outcomes.length, 0)
  assert.equal(state.receipts.length, 0)
  state = publish(state, { ...progress, operationKey: 'build-2' }, { ...progress, projectId: 'project-b' })
  assert.equal(state.activity.length, 3)
})

test('Activity is capped at 100 without losing unresolved risks or a selected receipt', () => {
  const risk = fact(), reading = receipt({ projectId: 'project-b', id: 'reading' })
  let state = publish(createFeedbackState(), risk, receipt(), reading)
  for (let index = 0; index < 150; index++) state = publish(state, receipt({ id: `result-${index}`, operationKey: `operation-${index}`, createdAt: index + 1, updatedAt: index + 1 }))
  assert.equal(state.activity.length, MAX_FEEDBACK_ACTIVITY)
  assert.equal(state.activity[0].id, 'result-50')
  assert.equal(state.activity.at(-1)?.id, 'result-149')
  assert.equal(state.outcomes[0].id, risk.id)
  assert.equal(selectReceipt(state, 'project-b')?.id, reading.id, 'Activity truncation cannot remove an action being read')
})

test('Activity filters by project plus workspace facts, newest first, without mutating history', () => {
  const entries = [receipt(), receipt({ id: 'foreign', projectId: 'project-b' }), receipt({ id: 'workspace', projectId: null })]
  assert.deepEqual(selectActivity(entries, 'project-a').map((item) => item.id), ['workspace', 'pdf-ready'])
  assert.deepEqual(selectActivity(entries, null).map((item) => item.id), ['workspace'])
  assert.deepEqual(entries.map((item) => item.id), ['pdf-ready', 'foreign', 'workspace'])
})

test('attention order is priority, active context, then oldest unresolved, not update time', () => {
  const oldest = fact({ id: 'oldest', dedupeKey: 'old', createdAt: 10 }), newer = fact({ id: 'newer', dedupeKey: 'new', createdAt: 20 }), foreign = fact({ id: 'foreign', projectId: 'project-b', createdAt: 0 })
  const state = publish(createFeedbackState(), newer, foreign, oldest)
  assert.deepEqual(selectAttention(state, [], 'project-a').issues.map((item) => item.id), ['oldest', 'newer', 'foreign'])
  const progress = fact({ id: 'progress', priority: 2, lifecycle: 'progress' })
  const updated = publish(state, { ...oldest, updatedAt: 500, summary: 'Still at risk.' }, progress)
  assert.equal(selectAttention(updated, [progress], 'project-a').primary?.id, 'oldest')
})

test('foreign source risk outranks active P1 and retains its real project name', () => {
  const foreign = fact({ projectId: 'project-b', projectTitle: 'Academic CV <original>' }), active = fact({ id: 'main', priority: 1, code: 'choose-main' })
  const selection = selectAttention(publish(createFeedbackState(), active, foreign), [], 'project-a')
  assert.equal(selection.primary?.projectId, 'project-b')
  assert.equal(feedbackProjectLabel(selection.primary!, 'project-a'), 'Academic CV <original>')
  assert.equal(selection.otherCount, 1)
  assert.equal(feedbackProjectLabel(fact({ projectId: null }), 'project-a'), null)
  assert.equal(feedbackProjectLabel(fact({ projectId: 'project-b', projectTitle: '' }), 'project-a'), 'Untitled project')
})

test('foreign noncritical issues wait for their project and remain unresolved', () => {
  const foreign = fact({ projectId: 'project-b', priority: 1 }), state = publish(createFeedbackState(), foreign)
  assert.equal(selectAttention(state, [], 'project-a').primary, null)
  assert.equal(selectAttention(state, [], 'project-b').primary?.projectId, 'project-b')
})

test('selector deduplicates derived/action facts and preserves a deterministic primary on ties', () => {
  const first = fact({ id: 'first', dedupeKey: 'a' }), second = fact({ id: 'second', dedupeKey: 'b' })
  const state = publish(createFeedbackState(), second, first)
  const before = selectAttention(state, [{ ...first, updatedAt: 200 }], 'project-a')
  const after = selectAttention(state, [{ ...first, updatedAt: 300, summary: 'Progress-adjacent update.' }], 'project-a')
  assert.equal(before.issues.length, 2)
  assert.equal(before.primary?.id, first.id)
  assert.equal(after.primary?.id, first.id)
})

test('reducer and selectors do not mutate frozen input facts/state', () => {
  const entry = fact()
  Object.freeze(entry.actionIds); Object.freeze(entry)
  const state = publish(createFeedbackState(), entry)
  for (const item of [state.outcomes, state.activity, state.receipts, state.dismissals]) Object.freeze(item)
  Object.freeze(state)
  assert.notEqual(publish(state, receipt()), state)
  assert.equal(selectAttention(state, [], 'project-a').primary?.id, entry.id)
  assert.deepEqual(state.outcomes[0].actionIds, entry.actionIds)
  assert.notEqual(state.outcomes[0].actionIds, entry.actionIds)
})

test('receipt counts five seconds of visible time, not time spent queued', () => {
  let clock = createReceiptClock({ createdAt: 0 }, 20_000)
  clock = advanceReceiptClock(clock, 20_000, visible)
  assert.equal(clock.remainingMs, RECEIPT_VISIBLE_MS)
  clock = advanceReceiptClock(clock, 24_999, visible)
  assert.equal(clock.expired, false)
  assert.equal(clock.remainingMs, 1)
  clock = advanceReceiptClock(clock, 25_000, visible)
  assert.equal(clock.expired, true)
  assert.equal(receiptWakeDelay(clock), null)
})

for (const field of ['visible', 'active', 'documentVisible'] as const) {
  test(`receipt pauses while ${field} is false and resumes only its remaining time`, () => {
    let clock = advanceReceiptClock(shownClock(), 2_000, { ...visible, [field]: false })
    assert.equal(clock.remainingMs, 3_000)
    clock = advanceReceiptClock(clock, 8_000, visible)
    assert.equal(clock.remainingMs, 3_000)
    clock = advanceReceiptClock(clock, 10_999, visible)
    assert.equal(clock.expired, false)
    assert.equal(advanceReceiptClock(clock, 11_000, visible).expired, true)
  })
}

for (const field of ['hovered', 'focused'] as const) {
  test(`visible ${field} actions survive the 30-second age cap and pause exposure`, () => {
    let clock = advanceReceiptClock(shownClock(), 1_000, { ...visible, [field]: true })
    assert.equal(receiptWakeDelay(clock), null)
    clock = advanceReceiptClock(clock, 60_000, { ...visible, [field]: true })
    assert.equal(clock.expired, false)
    assert.equal(clock.remainingMs, 4_000)
    clock = advanceReceiptClock(clock, 60_000, visible)
    assert.equal(receiptWakeDelay(clock), 4_000)
    assert.equal(advanceReceiptClock(clock, 64_000, visible).expired, true)
  })
}

test('focus at the timeout boundary is not removed until focus leaves', () => {
  let clock = advanceReceiptClock(shownClock(), 5_000, { ...visible, focused: true })
  assert.equal(clock.remainingMs, 0)
  assert.equal(clock.expired, false)
  clock = advanceReceiptClock(clock, 90_000, { ...visible, focused: true })
  assert.equal(clock.expired, false)
  assert.equal(advanceReceiptClock(clock, 90_000, visible).expired, true)
})

test('queued receipts older than 30 seconds expire before first visibility and cannot revive', () => {
  const atBoundary = advanceReceiptClock(createReceiptClock({ createdAt: 0 }, RECEIPT_STALE_MS), RECEIPT_STALE_MS, visible)
  assert.equal(atBoundary.expired, false)
  const expired = advanceReceiptClock(createReceiptClock({ createdAt: 0 }, RECEIPT_STALE_MS + 1), RECEIPT_STALE_MS + 1, visible)
  assert.equal(expired.expired, true)
  assert.equal(advanceReceiptClock(expired, 40_000, { ...visible, focused: true }), expired)
  const notYetVisible = advanceReceiptClock(createReceiptClock({ createdAt: 0 }, 40_000), 40_000, { ...visible, focused: true })
  assert.equal(notYetVisible.expired, true, 'A stale queued item cannot pretend it already owned focus')
})

test('late hidden/inactive wakeups do not replay an old receipt on resume', () => {
  for (const environment of [{ ...visible, active: false }, { ...visible, documentVisible: false }, { ...visible, visible: false }]) {
    let clock = advanceReceiptClock(shownClock(), 2_000, environment)
    assert.equal(receiptWakeDelay(clock), 28_001)
    clock = advanceReceiptClock(clock, 31_000, visible)
    assert.equal(clock.expired, true)
  }
})

test('an old focused receipt may expire once it is actually hidden, never while visible', () => {
  let clock = advanceReceiptClock(shownClock(), 1_000, { ...visible, focused: true })
  clock = advanceReceiptClock(clock, 40_000, { ...visible, focused: true })
  assert.equal(clock.expired, false)
  clock = advanceReceiptClock(clock, 40_000, { ...visible, focused: true, documentVisible: false })
  assert.equal(clock.expired, true)
})

test('frequent clock refreshes and backwards wall-clock jumps cannot reset exposure', () => {
  let clock = shownClock()
  for (let now = 10; now <= 4_000; now += 10) clock = advanceReceiptClock(clock, now, visible)
  assert.equal(clock.remainingMs, 1_000)
  clock = advanceReceiptClock(clock, 2_000, visible)
  assert.equal(clock.lastAt, 4_000)
  assert.equal(clock.remainingMs, 1_000)
  assert.equal(advanceReceiptClock(clock, 5_000, visible).expired, true)
})

test('independent project clocks retain their own exposure budget', () => {
  let first = advanceReceiptClock(shownClock(), 2_000, { ...visible, visible: false })
  let second = advanceReceiptClock(createReceiptClock({ createdAt: 2_000 }, 2_000), 2_000, visible)
  second = advanceReceiptClock(second, 3_000, { ...visible, visible: false })
  first = advanceReceiptClock(first, 3_000, visible)
  assert.equal(first.remainingMs, 3_000)
  assert.equal(second.remainingMs, 4_000)
})

test('one announcement stream selects the new highest-priority fact, assertive only for P0', () => {
  const risk = fact(), permission = fact({ priority: 1, code: 'package-consent', severity: 'info' }), success = receipt()
  const input = { attention: risk, receipt: success, active: true, projectId: 'project-a' }
  assert.equal(selectAnnouncement(input, new Set())?.politeness, 'assertive')
  assert.equal(selectAnnouncement(input, new Set())?.text, risk.summary)
  assert.equal(selectAnnouncement({ ...input, attention: permission }, new Set())?.politeness, 'polite')
  assert.equal(selectAnnouncement({ ...input, active: false }, new Set()), null)
})

test('announcement phase identity ignores bytes, display text and repeated render timestamps', () => {
  const progress = fact({ priority: 2, category: 'compile', code: 'engine-download', lifecycle: 'progress', operationKey: 'build' })
  const seen = new Set([feedbackAnnouncementKey(progress)])
  const input = { attention: null, progress: { ...progress, summary: '2000 of 3000 bytes', updatedAt: 50 }, active: true, projectId: 'project-a' }
  assert.equal(selectAnnouncement(input, seen), null)
  const nextPhase = { ...progress, code: 'tex-pass-1', summary: 'XeLaTeX: pass 1' }
  assert.equal(selectAnnouncement({ ...input, progress: nextPhase }, seen)?.text, nextPhase.summary)
})

test('modal suppresses external ordinary error/progress/receipt speech, not a new source risk', () => {
  const input = { attention: fact({ priority: 1, severity: 'error' }), receipt: receipt(), active: true, projectId: 'project-a', modalOpen: true }
  assert.equal(selectAnnouncement(input, new Set()), null)
  assert.equal(selectAnnouncement({ ...input, attention: fact() }, new Set())?.politeness, 'assertive')
})

test('announcements do not report automatic, expired, informational or foreign-project receipts', () => {
  const input = { attention: null, active: true, projectId: 'project-a' }
  for (const item of [receipt({ origin: 'auto' }), receipt({ projectId: 'project-b' }), receipt({ priority: 4, lifecycle: 'info' })]) {
    assert.equal(selectAnnouncement({ ...input, receipt: item }, new Set(), 100), null)
  }
  assert.equal(selectAnnouncement({ ...input, receipt: receipt() }, new Set(), 30_001), null)
  assert.equal(selectAnnouncement({ ...input, receipt: receipt() }, new Set(), 1)?.politeness, 'polite')
})

test('foreign P0 announcement includes its project name; a foreign P1 does not interrupt', () => {
  const input = { attention: fact({ projectId: 'project-b', projectTitle: 'Application CV' }), active: true, projectId: 'project-a' }
  assert.equal(selectAnnouncement(input, new Set())?.text, 'Application CV: Changes are only in this session.')
  assert.equal(selectAnnouncement({ ...input, attention: { ...input.attention, priority: 1 } }, new Set()), null)
})

test('announcement ledger consumes P0 only after actual speech, including modal/hidden suppression', () => {
  const risk = fact(), input = { attention: risk, receipt: receipt(), active: true, projectId: 'project-a', modalOpen: true }
  const suppressed = rememberAnnouncements(new Set(), input, null)
  assert.ok(!suppressed.has(feedbackAnnouncementKey(risk)))
  assert.ok(suppressed.has(feedbackAnnouncementKey(input.receipt)))
  assert.equal(selectAnnouncement({ ...input, modalOpen: false }, suppressed)?.text, risk.summary)
  const speech = selectAnnouncement(input, new Set())
  const announced = rememberAnnouncements(new Set(), input, speech)
  assert.ok(announced.has(feedbackAnnouncementKey(risk)))
  assert.equal(selectAnnouncement(input, announced), null)
})

test('speech ledger is bounded without reannouncing the current unresolved issue after many receipts', () => {
  const risk = fact(), base = { attention: risk, active: true, projectId: 'project-a' }
  let seen = rememberAnnouncements(new Set(), base, selectAnnouncement(base, new Set()))
  for (let index = 0; index < 200; index++) {
    const input = { ...base, receipt: receipt({ operationKey: `build-${index}` }) }
    seen = rememberAnnouncements(seen, input, selectAnnouncement(input, seen))
  }
  assert.equal(seen.size, MAX_FEEDBACK_ACTIVITY)
  assert.ok(seen.has(feedbackAnnouncementKey(risk)))
  assert.equal(selectAnnouncement(base, seen), null)
})

// These are source/token contract checks, NOT browser rendering, focus, or assistive-technology tests.
const presentation = readFileSync(new URL('./LatexFeedback.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('./LatexFeedback.module.css', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../components/MrResumeTheme.module.css', import.meta.url), 'utf8')

test('presentation source contract exposes every Error action and one consolidated live region', () => {
  for (const name of ['LatexAttentionBar', 'LatexReceipt', 'LatexAnnouncements', 'LatexActivity']) assert.match(presentation, new RegExp(`export function ${name}\\(`, 'u'))
  assert.match(presentation, /new Set\(fact\.actionIds\)/u)
  assert.match(presentation, /onAction\(actionId, fact\)/u)
  assert.match(presentation, /onDismiss\(fact\)/u)
  assert.match(presentation, /View issues/u)
  assert.match(presentation, /risk remains until resolved/u)
  assert.equal([...presentation.matchAll(/aria-live=/gu)].length, 1)
  assert.doesNotMatch(presentation, /role="(?:status|alert|log)"|autoFocus|\.focus\(|createPortal|innerHTML|dangerouslySetInnerHTML/u)
  assert.match(presentation, /element\.textContent = next\.text/u)
  assert.match(presentation, /modalOpen && !retainsUrgent/u)
})

test('presentation source contract pauses focus/hover/visibility and retains scoped timer metadata', () => {
  for (const handler of ['onPointerEnter', 'onPointerLeave', 'onFocusCapture', 'onBlurCapture', 'visibilitychange']) assert.ok(presentation.includes(handler))
  assert.match(presentation, /clocks\.current\.has\(identity\)/u)
  assert.match(presentation, /onExpire\(fact\)/u)
  assert.match(presentation, /document\.visibilityState/u)
  assert.match(presentation, /visible: !modalOpen/u)
  assert.match(presentation, /element\.current\.hidden = clock\.expired/u)
  assert.doesNotMatch(presentation, /useLatexWorkspace|sessionStorage|localStorage|indexedDB|fetch\(/u)
})

test('presentation source contract keeps normal-flow attention, parent-anchored receipts and accessible controls', () => {
  const attention = /\.attention\s*\{([^}]+)\}/u.exec(css)?.[1], receipt = /\.receipt\s*\{([^}]+)\}/u.exec(css)?.[1]
  assert.ok(attention && receipt)
  for (const block of [attention, receipt]) assert.doesNotMatch(block, /(?:^|;)\s*(?:position|z-index|bottom|backdrop-filter)\s*:/u)
  assert.match(css, /\.receipt\[hidden\]\s*\{\s*display: none/u)
  assert.match(css, /max-width: 900px/u)
  assert.match(css, /min-width: 44px; min-height: 44px/u)
  assert.match(css, /outline: 2px solid var\(--rs-focus\)/u)
  assert.match(css, /prefers-reduced-motion/u)
  assert.match(css, /font-variant-numeric: tabular-nums/u)
  assert.match(css, /overflow-wrap: anywhere/u)
  assert.doesNotMatch(css, /backdrop-filter|#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|oklch)\(|font-family:|@import/u)
  for (const [, name] of css.matchAll(/var\((--[a-z-]+)/gu)) { assert.ok(name.startsWith('--rs-')); assert.ok(theme.includes(`${name}:`), `Unknown inherited token ${name}`) }
  for (const [, name] of presentation.matchAll(/styles\.([A-Za-z]+)/gu)) assert.match(css, new RegExp(`\\.${name}(?![\\w-])`, 'u'))
})

function luminance(hex: string) {
  const [red, green, blue] = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return red * .2126 + green * .7152 + blue * .0722
}
function contrast(a: string, b: string) {
  const first = luminance(a), second = luminance(b)
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05)
}

test('existing inherited tokens meet feedback text/status/control contrast numerically in light and dark', (context) => {
  const blocks = [...theme.matchAll(/\.theme\s*\{([^}]+)\}/gu)].map((match) => Object.fromEntries([...match[1].matchAll(/(--rs-[a-z-]+):\s*(#[0-9a-f]{6})/gu)].map((item) => [item[1], item[2]])))
  assert.equal(blocks.length, 2)
  for (const [index, tokens] of [blocks[0], { ...blocks[0], ...blocks[1] }].entries()) {
    const label = index ? 'dark' : 'light', background = tokens['--rs-panel']
    const body = contrast(tokens['--rs-ink'], background), muted = contrast(tokens['--rs-muted'], background)
    assert.ok(body >= 7, `${label}: summary body ${body.toFixed(2)}:1`)
    assert.ok(muted >= 4.5, `${label}: context ${muted.toFixed(2)}:1`)
    for (const role of ['--rs-gold', '--rs-danger', '--rs-success']) assert.ok(contrast(tokens[role], background) >= 4.5, `${label}: ${role}`)
    for (const surface of ['--rs-panel', '--rs-soft']) {
      assert.ok(contrast(tokens['--rs-ink'], tokens[surface]) >= 7)
      assert.ok(contrast(tokens['--rs-focus'], tokens[surface]) >= 3)
      assert.ok(contrast(tokens['--rs-control-line'], tokens[surface]) >= 3)
    }
    context.diagnostic(`${label}: summary ${body.toFixed(2)}:1, context ${muted.toFixed(2)}:1; token calculation only, not rendered verification`)
  }
})

test('policy stays pure and its root-level test is included by the existing LaTeX suite', () => {
  const policy = readFileSync(new URL('./feedback.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(policy, /Date\.now|setTimeout|sessionStorage|localStorage|indexedDB|document\.|window\.|from ['"]@\//u)
  const scripts = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).scripts
  assert.ok(scripts['test:mr-resume:latex'].includes('features/mr-resume/latex/*.test.ts'))
})
