'use client'

import { useEffect, useLayoutEffect, useRef } from 'react'
import { advanceReceiptClock, createReceiptClock, feedbackAnnouncementKey, feedbackIdentity, feedbackProjectLabel,
  isReceiptFact, MAX_FEEDBACK_ACTIVITY, RECEIPT_STALE_MS, receiptWakeDelay, rememberAnnouncements, selectActivity, selectAnnouncement,
  type FeedbackAnnouncementInput, type FeedbackAttention, type FeedbackFact, type ReceiptClock } from './feedback.ts'
import styles from './LatexFeedback.module.css'

type FeedbackActionsProps = {
  actionLabels?: Readonly<Record<string, string>>
  onAction: (actionId: string, fact: FeedbackFact) => void
}
export type LatexAttentionBarProps = FeedbackActionsProps & {
  selection: FeedbackAttention
  projectId: string | null
  active?: boolean
  floating?: boolean
  onDismiss: (fact: FeedbackFact) => void
  onViewIssues: () => void
}
export type LatexReceiptProps = FeedbackActionsProps & {
  fact: FeedbackFact | null
  active: boolean
  projectId: string | null
  modalOpen?: boolean
  onDismiss: (fact: FeedbackFact) => void
  onExpire: (fact: FeedbackFact) => void
}
export type LatexAnnouncementsProps = FeedbackAnnouncementInput
export type LatexActivityProps = FeedbackActionsProps & { facts: readonly FeedbackFact[]; projectId: string | null }

function FeedbackActions({ fact, actionLabels, onAction, exclude }: FeedbackActionsProps & { fact: FeedbackFact; exclude?: string }) {
  return <>{[...new Set(fact.actionIds)].filter((actionId) => actionId !== exclude).map((actionId) => <button className={styles.action} type="button" key={actionId}
    onClick={() => onAction(actionId, fact)}>{actionLabels && Object.hasOwn(actionLabels, actionId) ? actionLabels[actionId] : actionId}</button>)}</>
}

export function LatexAttentionBar({ selection, projectId, active = true, floating = false, actionLabels, onAction, onDismiss, onViewIssues }: LatexAttentionBarProps) {
  if (!active || !selection.issues.length) return null
  const fact = selection.primary, project = fact && feedbackProjectLabel(fact, projectId)
  return <section className={styles.attention} aria-label="LaTeX workspace attention" data-floating={floating} data-priority={fact?.priority} data-severity={fact?.severity}>
    <div className={styles.copy}>
      {fact ? <><p className={styles.label}>{fact.priority === 0 ? 'Source at risk' : 'Action needed'}
        {fact.revision !== undefined && <span className={styles.revision}>r{fact.revision}</span>}</p>
        <p className={styles.summary}>{project && <strong className={styles.project}>{project}: </strong>}{fact.summary}</p>
        {selection.acknowledged && fact.priority === 0 && <p className={styles.context}>Acknowledged. The risk remains until resolved.</p>}</>
        : <p className={styles.summary}>{selection.deferred.length} {selection.deferred.length === 1 ? 'issue deferred' : 'issues deferred'}. Actions remain available.</p>}
    </div>
    <div className={styles.actions}>
      {fact && <FeedbackActions fact={fact} actionLabels={actionLabels} onAction={onAction} exclude="view-issues" />}
      <button className={styles.action} type="button" onClick={onViewIssues}>{actionLabels?.['view-issues'] ?? 'View issues'}
        <span className={styles.count} aria-label={`${selection.issues.length} unresolved ${selection.issues.length === 1 ? 'issue' : 'issues'}`}>{selection.issues.length}</span>
      </button>
      {fact && <button className={styles.dismiss} type="button" aria-pressed={fact.priority === 0 ? selection.acknowledged : undefined}
        onClick={() => onDismiss(fact)}>{fact.priority === 0 ? selection.acknowledged ? 'Acknowledged' : 'Acknowledge' : 'Defer'}</button>}
    </div>
  </section>
}

/** Keep this mounted across panel/project switches. The parent positions its anchor, not this component. */
export function LatexReceipt({ fact, active, projectId, modalOpen = false, actionLabels, onAction, onDismiss, onExpire }: LatexReceiptProps) {
  const element = useRef<HTMLDivElement>(null)
  const clocks = useRef(new Map<string, ReceiptClock>()), notified = useRef(new Set<string>())
  const selected = useRef<string | null>(null), interaction = useRef({ hovered: false, focused: false })
  const refresh = useRef<() => void>(() => {})

  useLayoutEffect(() => {
    const identity = fact && isReceiptFact(fact) ? feedbackIdentity(fact) : null, now = Date.now()
    if (selected.current !== identity) {
      const previous = selected.current && clocks.current.get(selected.current)
      if (previous && selected.current) clocks.current.set(selected.current, advanceReceiptClock(previous, now, { ...previous.environment, visible: false }))
      selected.current = identity
      interaction.current = { hovered: false, focused: Boolean(element.current?.contains(document.activeElement)) }
    }
    if (!identity || !fact) { refresh.current = () => {}; return }
    if (!clocks.current.has(identity)) clocks.current.set(identity, createReceiptClock(fact, now))
    // Only timing metadata is retained; stale hidden clocks cannot be replayed after eviction.
    for (const [key, clock] of clocks.current) {
      if (key !== identity && now - clock.createdAt > RECEIPT_STALE_MS) { clocks.current.delete(key); notified.current.delete(key) }
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      if (timeout !== undefined) clearTimeout(timeout)
      const clock = advanceReceiptClock(clocks.current.get(identity)!, Date.now(), {
        visible: !modalOpen && (fact.projectId === null || fact.projectId === projectId), active,
        documentVisible: document.visibilityState !== 'hidden', ...interaction.current,
      })
      clocks.current.set(identity, clock)
      // Layout-effect/event timing avoids painting an expired queued receipt, including on resume.
      if (element.current) element.current.hidden = clock.expired || !clock.environment.visible || !active || !clock.environment.documentVisible
      if (clock.expired) {
        if (!notified.current.has(identity)) { notified.current.add(identity); onExpire(fact) }
        return
      }
      const delay = receiptWakeDelay(clock)
      if (delay !== null) timeout = setTimeout(update, delay)
    }
    refresh.current = update
    update()
    document.addEventListener('visibilitychange', update)
    return () => { if (timeout !== undefined) clearTimeout(timeout); document.removeEventListener('visibilitychange', update); refresh.current = () => {} }
  }, [fact, active, projectId, modalOpen, onExpire])

  if (!fact || !isReceiptFact(fact)) return null
  return <div ref={element} className={styles.receipt} data-severity={fact.severity} role="group" aria-label="LaTeX action receipt"
    hidden={!active || modalOpen || (fact.projectId !== null && fact.projectId !== projectId)}
    onPointerEnter={(event) => { if (event.pointerType !== 'touch') { interaction.current.hovered = true; refresh.current() } }}
    onPointerLeave={() => { interaction.current.hovered = false; refresh.current() }}
    onFocusCapture={() => { interaction.current.focused = true; refresh.current() }}
    onBlurCapture={(event) => { interaction.current.focused = event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget); refresh.current() }}>
    <p className={styles.summary}>{fact.summary}</p>
    <div className={styles.actions}><FeedbackActions fact={fact} actionLabels={actionLabels} onAction={onAction} />
      <button className={styles.dismiss} type="button" aria-label="Dismiss action receipt" onClick={() => onDismiss(fact)}>Close</button>
    </div>
  </div>
}

/** Mount exactly once. Visual feedback components intentionally have no independent live regions. */
export function LatexAnnouncements({ attention, progress = null, receipt = null, active, projectId, modalOpen = false }: LatexAnnouncementsProps) {
  const stream = useRef<HTMLDivElement>(null), seen = useRef(new Set<string>()), lastKey = useRef<string | null>(null)
  useEffect(() => {
    const announce = () => {
      const element = stream.current
      if (!element) return
      const visible = active && document.visibilityState !== 'hidden'
      const input = { attention, progress, receipt, active: visible, projectId, modalOpen }
      const next = selectAnnouncement(input, seen.current, Date.now())
      seen.current = rememberAnnouncements(seen.current, input, next)
      // A byte-update render must not clear an in-flight source-risk announcement over a modal.
      const retainsUrgent = [attention, progress, receipt].some((fact) => fact?.priority === 0 && feedbackAnnouncementKey(fact) === lastKey.current)
      if (next) { element.setAttribute('aria-live', next.politeness); element.textContent = next.text; lastKey.current = next.key }
      else if (!visible || (modalOpen && !retainsUrgent)) { element.setAttribute('aria-live', 'off'); element.textContent = ''; lastKey.current = null }
    }
    announce()
    document.addEventListener('visibilitychange', announce)
    return () => document.removeEventListener('visibilitychange', announce)
  }, [attention, progress, receipt, active, projectId, modalOpen])
  return <div ref={stream} className={styles.srOnly} aria-live="polite" aria-atomic="true" aria-relevant="additions text" />
}

export function LatexActivity({ facts, projectId, actionLabels, onAction }: LatexActivityProps) {
  const entries = selectActivity(facts, projectId)
  return <section className={styles.activity} aria-label="LaTeX session activity">
    <p className={styles.context}>This editor session only, up to {MAX_FEEDBACK_ACTIVITY} entries. Activity is not checkpoint history.</p>
    {entries.length ? <ol className={styles.activityList}>{entries.map((fact) => <li key={`${feedbackIdentity(fact)}:${fact.id}:${fact.lifecycle}`} data-severity={fact.severity}>
      <div className={styles.activityMeta}><span>{fact.category}</span>{fact.revision !== undefined && <span>r{fact.revision}</span>}
        <time dateTime={new Date(fact.createdAt).toISOString()}>{new Date(fact.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
      </div>
      <p className={styles.summary}>{fact.summary}</p>
      {fact.actionIds.length > 0 && <div className={styles.actions}><FeedbackActions fact={fact} actionLabels={actionLabels} onAction={onAction} /></div>}
    </li>)}</ol> : <p className={styles.summary}>No activity for this project in this session.</p>}
  </section>
}
