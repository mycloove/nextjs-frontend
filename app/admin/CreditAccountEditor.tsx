'use client'

import type { CreditSnapshot } from '@/lib/usage/credit-types'
import { parseCreditSnapshot } from '@/lib/usage/credit-policy'
import { useEffect, useRef, useState } from 'react'
import { ConfirmDialog, type ConfirmSpec } from './ConfirmDialog'
import { count } from './format'
import styles from './bench.module.css'
import credit from './credit.module.css'

type AccountRead = {
  snapshot: CreditSnapshot
  allowance_override: number | null
  override_expires_at: string | null
  /** Account revision, not the combined snapshot/policy revision. */
  revision: number
}

type OverrideDraft = { custom: boolean; allowance: string; expires: string }
type AccountWrite =
  | { kind: 'override'; body: { user_id: string; allowance_override: number | null; override_expires_at: string | null; expected_revision: number; reason: string } }
  | { kind: 'adjustment'; body: { user_id?: string; anon_id?: string; amount: number; reason: string; operation_id: string } }

const MAX_CREDITS = 1_000_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function integer(value: string, signed = false) {
  const trimmed = value.trim()
  if (!(signed ? /^[+-]?\d+$/ : /^\d+$/).test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed >= (signed ? -MAX_CREDITS : 0) && parsed <= MAX_CREDITS
    && (!signed || parsed !== 0) ? parsed : null
}

function reasonFor(value: string) {
  const trimmed = value.trim()
  return trimmed.length >= 3 && trimmed.length <= 240 && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : null
}

function localInput(iso: string | null) {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

function overrideFor(account: AccountRead): OverrideDraft {
  return { custom: account.allowance_override !== null, allowance: account.allowance_override === null ? '' : String(account.allowance_override), expires: localInput(account.override_expires_at) }
}

function parseAccount(value: unknown): AccountRead {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('The server did not return a credit account.')
  const row = value as AccountRead
  if (!Number.isSafeInteger(row.revision) || row.revision < 0
    || (row.allowance_override !== null && (typeof row.allowance_override !== 'number' || !Number.isSafeInteger(row.allowance_override) || row.allowance_override < 0 || row.allowance_override > MAX_CREDITS))
    || (row.override_expires_at !== null && (typeof row.override_expires_at !== 'string' || !Number.isFinite(Date.parse(row.override_expires_at))))) {
    throw new Error('The server returned an invalid credit account revision or override.')
  }
  return { snapshot: parseCreditSnapshot(row.snapshot), allowance_override: row.allowance_override, override_expires_at: row.override_expires_at, revision: row.revision }
}

function dateLabel(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

/** Inline, actor-keyed detail: only the confirmation uses the bench's modal. */
export default function CreditAccountEditor({
  id,
  kind,
  label,
  canEdit,
  onClose,
  onLockChange,
  refreshToken = 0,
}: {
  id: string
  kind: 'account' | 'browser'
  label: string
  canEdit: boolean
  onClose: () => void
  onLockChange?: (locked: boolean) => void
  refreshToken?: number
}) {
  const [account, setAccount] = useState<AccountRead | null>(null)
  const [draft, setDraft] = useState<OverrideDraft | null>(null)
  const [overrideReason, setOverrideReason] = useState('')
  const [adjustment, setAdjustment] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [readError, setReadError] = useState('')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState(false)
  const [adjustmentUnconfirmed, setAdjustmentUnconfirmed] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<{ error: boolean; message: string } | null>(null)
  const [ask, setAsk] = useState<ConfirmSpec | null>(null)
  const [pending, setPending] = useState<AccountWrite | null>(null)
  const [lastChange, setLastChange] = useState<{ amount: string; reason: string; before: string; after: string; asOf: string } | null>(null)
  const adjustmentAttempt = useRef<{ fingerprint: string; operationId: string } | null>(null)
  const writeLock = useRef(false)
  const mounted = useRef(true)
  const heading = useRef<HTMLHeadingElement>(null)
  const target = kind === 'account' ? { user_id: id } : { anon_id: id }
  const query = new URLSearchParams([[kind === 'account' ? 'user_id' : 'anon_id', id]]).toString()

  const [seenToken, setSeenToken] = useState(refreshToken)
  if (seenToken !== refreshToken) {
    setSeenToken(refreshToken)
    setStatus('loading')
    setReadError('')
  }

  useEffect(() => {
    mounted.current = true
    heading.current?.focus({ preventScroll: true })
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const locked = busy || adjustmentUnconfirmed
    onLockChange?.(locked)
    if (!locked) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [busy, adjustmentUnconfirmed, onLockChange])

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    const load = async () => {
      try {
        if (!UUID.test(id)) throw new Error('This identity does not have a valid UUID. No credit lookup or write was sent.')
        const response = await fetch(`/api/admin/credits?${query}`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
        const payload = await response.json().catch(() => null) as (AccountRead & { error?: string; code?: string }) | null
        if (!current) return
        if (!response.ok) throw new Error(`${payload?.error || 'Credit account could not be read.'}${payload?.code ? ` (${payload.code})` : ''}`)
        const next = parseAccount(payload)
        setAccount(next)
        setDraft((value) => value ?? overrideFor(next))
        setStatus('ready')
        setReadError('')
      } catch (error) {
        if (!current) return
        setStatus('error')
        setReadError(error instanceof Error ? error.message : 'Credit account could not be read.')
      }
    }
    void load()
    return () => { current = false; controller.abort() }
  }, [id, query, reload, refreshToken])

  const refresh = () => {
    setStatus('loading')
    setReadError('')
    setReload((value) => value + 1)
  }

  const snapshot = account?.snapshot
  const metered = snapshot?.mode === 'metered'
  const editable = canEdit && status === 'ready' && metered && !busy
  const reading = (value: number | null | undefined) => value === null || value === undefined ? 'Not numeric' : count(value)
  const savedDraft = account ? overrideFor(account) : null
  const overrideDirty = Boolean(draft && savedDraft && (draft.custom !== savedDraft.custom
    || (draft.custom && (integer(draft.allowance) !== account?.allowance_override || draft.expires !== savedDraft.expires))))

  const stageOverride = () => {
    if (!editable || !account || !draft || kind !== 'account') return
    const allowance = draft.custom ? integer(draft.allowance) : null
    const reason = reasonFor(overrideReason)
    const nextErrors: Record<string, string> = {}
    if (draft.custom && allowance === null) nextErrors.allowance = 'Enter a whole number from 0 to 1,000,000. Blank is not zero.'
    if (reason === null) nextErrors.overrideReason = 'A reason of 3 to 240 printable characters is required.'
    let expires: string | null = null
    if (draft.custom && draft.expires.trim()) {
      const date = new Date(draft.expires)
      if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) nextErrors.expires = 'Choose a valid future expiry, or leave it empty for no expiry.'
      else expires = date.toISOString()
    }
    setErrors(nextErrors)
    if ((draft.custom && allowance === null) || reason === null || nextErrors.expires) return
    const body = { user_id: id, allowance_override: allowance, override_expires_at: expires, expected_revision: account.revision, reason }
    setPending({ kind: 'override', body })
    setAsk({
      eyebrow: 'Audited account override', title: `Change allowance for ${label}?`,
      body: 'This replaces the account allowance without changing its role. Existing spend and reservations remain; lowering allowance does not rewrite or refund them. A removed or expired override returns to the live audience policy.',
      facts: [
        { label: 'Saved override', value: account.allowance_override === null ? 'Use audience policy' : `${count(account.allowance_override)} credits` },
        { label: 'New override', value: allowance === null ? 'Use audience policy' : `${count(allowance)} credits` },
        { label: 'Expiry', value: expires ? dateLabel(expires) : 'None' },
        { label: 'Reason', value: reason },
      ],
      cancelLabel: 'Keep saved allowance', confirmLabel: 'Save override', tone: 'accent',
    })
  }

  const stageAdjustment = () => {
    if (!editable || !account) return
    const amount = integer(adjustment, true)
    const reason = reasonFor(adjustReason)
    const nextErrors: Record<string, string> = {}
    if (amount === null) nextErrors.adjustment = 'Enter a nonzero whole number from -1,000,000 to 1,000,000.'
    if (reason === null) nextErrors.adjustReason = 'A reason of 3 to 240 printable characters is required.'
    setErrors(nextErrors)
    if (amount === null || reason === null) return
    if (typeof crypto.randomUUID !== 'function') {
      setNotice({ error: true, message: 'Secure operation IDs are unavailable. Use an HTTPS connection before making an adjustment.' })
      return
    }
    const fingerprint = JSON.stringify({ ...target, amount, reason })
    if (adjustmentAttempt.current?.fingerprint !== fingerprint) adjustmentAttempt.current = { fingerprint, operationId: crypto.randomUUID() }
    setPending({ kind: 'adjustment', body: { ...target, amount, reason, operation_id: adjustmentAttempt.current.operationId } })
    setAsk({
      eyebrow: 'Audited credit adjustment', title: `${amount > 0 ? 'Add' : 'Reduce'} credits for ${label}?`,
      body: `This adds an audited ledger entry, not a paid top-up or an analytics reset. The adjustment expires ${account.snapshot.period_hours} hours after it is applied, using the server's current rolling policy. It does not release existing reservations.`,
      facts: [
        { label: 'Available now', value: `${reading(account.snapshot.available)} credits` },
        { label: 'Adjustment', value: `${amount > 0 ? '+' : ''}${count(amount)} credits` },
        { label: 'Reason', value: reason },
      ],
      cancelLabel: 'Keep balance', confirmLabel: amount > 0 ? 'Add audited credits' : 'Reduce audited credits', tone: amount > 0 ? 'accent' : 'danger',
      typeToConfirm: amount < 0 ? 'REDUCE' : undefined,
    })
  }

  const runWrite = async () => {
    if (!pending || !editable || writeLock.current || !UUID.test(id)) return
    writeLock.current = true
    const change = pending
    if (change.kind === 'adjustment') setAdjustmentUnconfirmed(true)
    setBusy(true)
    setNotice(null)
    setAsk((value) => value ? { ...value, busy: true } : null)
    try {
      const response = await fetch(change.kind === 'override' ? '/api/admin/credits' : '/api/admin/credits/adjustments', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change.body),
      })
      const payload = await response.json().catch(() => null) as (AccountRead & { error?: string; code?: string }) | null
      if (!mounted.current) return
      if (change.kind === 'adjustment' && !response.ok && response.status < 500) setAdjustmentUnconfirmed(false)
      if (response.status === 409 && payload?.code === 'credit_version_conflict') {
        setNotice({ error: true, message: 'The account changed before this save. Reloading server truth; your draft and reason are kept. Compare before saving again.' })
        refresh()
        return
      }
      if (!response.ok) throw new Error(`${payload?.error || 'The credit change was not confirmed.'}${payload?.code ? ` (${payload.code})` : ''}`)
      const next = parseAccount(payload)
      setLastChange({ amount: change.kind === 'adjustment' ? `${change.body.amount > 0 ? '+' : ''}${count(change.body.amount)} credits` : 'Allowance override', reason: change.body.reason,
        before: reading(account?.snapshot.available), after: reading(next.snapshot.available), asOf: next.snapshot.as_of })
      setAccount(next)
      setStatus('ready')
      if (change.kind === 'override') { setDraft(overrideFor(next)); setOverrideReason('') }
      else { setAdjustment(''); setAdjustReason(''); adjustmentAttempt.current = null; setAdjustmentUnconfirmed(false) }
      setErrors({})
      setNotice({ error: false, message: 'Saved and confirmed by the server. The audit log and the readings below reflect the change.' })
    } catch (error) {
      if (mounted.current) setNotice({ error: true, message: `${error instanceof Error ? error.message : 'The change was not confirmed.'}${change.kind === 'adjustment' ? ' Retry the unchanged draft to reuse its operation ID; do not submit it again as a new grant.' : ' Reload before retrying; your draft is kept.'}` })
    } finally {
      writeLock.current = false
      if (mounted.current) { setBusy(false); setAsk(null); setPending(null) }
    }
  }

  return (
    <section className={`${styles.panel} ${credit.creditHost}`} id="credit-account-editor" aria-labelledby="credit-account-title" aria-busy={status === 'loading' || busy}>
      <div className={`${styles.panelHead} ${credit.creditHead}`}>
        <div className={credit.creditHeadText}>
          <h2 className={`${styles.panelTitle} ${credit.creditAccountTitle}`} id="credit-account-title" tabIndex={-1} ref={heading}>Credit account: {label}</h2>
          <p className={`${credit.creditHint} ${credit.creditMono}`}>{kind === 'account' ? 'Account' : 'Browser cookie'} {id}</p>
        </div>
        <div className={credit.creditActions}>
          <button className={`${styles.btn} ${credit.creditButton}`} type="button" onClick={refresh} disabled={busy || status === 'loading'}>{status === 'error' ? 'Retry credits' : 'Reload credits'}</button>
          <button className={`${styles.btn} ${credit.creditButton}`} type="button" onClick={onClose} disabled={busy || adjustmentUnconfirmed}>Close credits</button>
        </div>
      </div>
      <div className={credit.creditBody}>
        {status === 'loading' ? <p className={credit.creditNote} role="status">{account ? 'Refreshing confirmed readings. Drafts are kept; writes are paused.' : 'Loading this identity\'s actual credit account. No balance is assumed.'}</p> : null}
        {readError ? <p className={credit.creditError} role="alert">{readError} No credit writes are available until the read succeeds.</p> : null}
        {notice ? <p className={notice.error ? credit.creditError : credit.creditSuccess} role={notice.error ? 'alert' : 'status'}>{notice.message}</p> : null}
        {snapshot ? (
          <>
            <div className={credit.creditReadings}>
              <div>
                <span className={credit.creditBalanceLabel}>{status === 'ready' ? !snapshot.account_active && kind === 'account' ? 'Stored account credits' : 'Credits available' : 'Last confirmed credit reading'}</span>
                <strong className={credit.creditBalanceValue}>{metered ? reading(snapshot.available) : snapshot.mode === 'unmetered' ? 'Unmetered' : snapshot.mode === 'legacy' ? 'Legacy caps' : 'Unavailable'}</strong>
              </div>
              {metered ? <dl className={credit.creditMetrics}>
                <div><dt>Effective allowance</dt><dd>{reading(snapshot.allowance)}</dd></div>
                <div><dt>Used / reductions</dt><dd>{reading(snapshot.used)}</dd></div>
                <div><dt>Reserved</dt><dd>{reading(snapshot.reserved)}</dd></div>
              </dl> : null}
            </div>
            <p className={credit.creditHint}>Server audience: {snapshot.audience} / account {snapshot.account_active ? 'active' : 'inactive'} / rolling {snapshot.period_hours} hours / read <time dateTime={snapshot.as_of}>{dateLabel(snapshot.as_of)}</time> / account revision {account?.revision}</p>
            {!snapshot.account_active && kind === 'account' ? <p className={credit.creditNote}>This is the stored account wallet. An inactive signed-in session uses guest allowance; it does not receive this member allowance or an admin bypass.</p> : null}
            {snapshot.message ? <p className={credit.creditNote}>{snapshot.message}</p> : null}
            {snapshot.next_return_at && snapshot.next_return_amount > 0 ? <p className={credit.creditNote}>Next credit return: {count(snapshot.next_return_amount)} at <time dateTime={snapshot.next_return_at}>{dateLabel(snapshot.next_return_at)}</time>. This is not a full-pool reset.</p> : null}
            {!canEdit ? <p className={credit.creditNote}>Read-only. Your admin seat can inspect this account but cannot change its allowance or credits.</p> : !metered ? <p className={credit.creditNote}>{snapshot.mode === 'legacy' ? 'Credit mode is not enabled. Existing per-tool caps remain unchanged; activate the reviewed policy from Tools before making wallet changes.' : 'No numeric credit allowance is enforced for this identity. Wallet changes are unavailable here; no balance is inferred from the role.'}</p> : null}
            {kind === 'account' && draft && account ? (
              <form className={`${credit.creditSection} ${credit.creditForm}`} noValidate onSubmit={(event) => { event.preventDefault(); stageOverride() }}>
                <h3 className={credit.creditSectionTitle}>Account allowance override</h3>
                <p className={credit.creditNote}>Saved: {account.allowance_override === null ? 'audience policy' : `${count(account.allowance_override)} credits`}{account.override_expires_at ? ` / expires ${dateLabel(account.override_expires_at)}` : ''}. The effective allowance above comes from the server, including expiry and eligibility.</p>
                <div className={credit.creditOverrideFields}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="credit-override-mode">Allowance source</label>
                    <select id="credit-override-mode" className={`${styles.select} ${credit.creditControl}`} value={draft.custom ? 'custom' : 'policy'} disabled={!editable} onChange={(event) => { setDraft({ ...draft, custom: event.target.value === 'custom' }); setErrors({}) }}><option value="policy">Use audience policy</option><option value="custom">Custom account allowance</option></select>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="credit-override-amount">Custom allowance</label>
                    <input id="credit-override-amount" className={`${styles.input} ${credit.creditControl} ${credit.creditMono}`} inputMode="numeric" value={draft.allowance} disabled={!editable || !draft.custom} required={draft.custom} aria-invalid={Boolean(errors.allowance)} aria-describedby={errors.allowance ? 'credit-override-amount-error' : undefined} onChange={(event) => { setDraft({ ...draft, allowance: event.target.value }); setErrors((current) => ({ ...current, allowance: '' })) }} />
                    {errors.allowance ? <p className={credit.creditError} id="credit-override-amount-error" role="alert">{errors.allowance}</p> : null}
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel} htmlFor="credit-override-expiry">Expiry (optional, local time)</label>
                    <input id="credit-override-expiry" className={`${styles.input} ${credit.creditControl}`} type="datetime-local" step="any" value={draft.expires} disabled={!editable || !draft.custom} aria-invalid={Boolean(errors.expires)} aria-describedby="credit-override-expiry-hint" onChange={(event) => { setDraft({ ...draft, expires: event.target.value }); setErrors((current) => ({ ...current, expires: '' })) }} />
                    <p className={credit.creditHint} id="credit-override-expiry-hint">Empty means no expiry; saving converts local time to an ISO timestamp.</p>
                    {errors.expires ? <p className={credit.creditError} role="alert">{errors.expires}</p> : null}
                  </div>
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="credit-override-reason">Override reason</label>
                  <input id="credit-override-reason" className={`${styles.input} ${credit.creditControl}`} value={overrideReason} maxLength={240} disabled={!editable} required aria-invalid={Boolean(errors.overrideReason)} aria-describedby={errors.overrideReason ? 'credit-override-reason-error' : undefined} onChange={(event) => { setOverrideReason(event.target.value); setErrors((current) => ({ ...current, overrideReason: '' })) }} />
                  {errors.overrideReason ? <p className={credit.creditError} id="credit-override-reason-error" role="alert">{errors.overrideReason}</p> : null}
                </div>
                <p className={credit.creditHint}>{draft.custom && integer(draft.allowance) !== null ? `Draft allowance: ${count(integer(draft.allowance)!)} credits. Existing spend, active adjustments and reservations still apply; this is not a projected wallet balance.` : 'Use audience policy removes the account override; it does not clear spend or grant a fresh wallet.'}</p>
                <div className={credit.creditActions}>
                  <button className={`${styles.btn} ${styles.btnPrimary} ${credit.creditPrimary} ${credit.creditButton}`} type="submit" disabled={!editable || !overrideDirty}>Review override</button>
                  <button className={`${styles.btn} ${credit.creditButton}`} type="button" disabled={!editable || !overrideDirty} onClick={() => { setDraft(overrideFor(account)); setOverrideReason(''); setErrors({}) }}>Use saved override</button>
                </div>
              </form>
            ) : kind === 'browser' ? <p className={credit.creditNote}>Browser identities can receive audited adjustments. Allowance overrides are for signed-in accounts only.</p> : null}
            <form className={`${credit.creditSection} ${credit.creditForm}`} noValidate onSubmit={(event) => { event.preventDefault(); stageAdjustment() }}>
              <h3 className={credit.creditSectionTitle}>Audited credit adjustment</h3>
              <p className={credit.creditNote}>A positive amount adds credits; a negative amount reduces them. Adjustments expire after the current wallet window ({snapshot.period_hours} hours). Recorded-call analytics are separate and never refund a wallet.</p>
              <div className={credit.creditAdjustmentFields}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="credit-adjustment-amount">Signed credit amount</label>
                  <input id="credit-adjustment-amount" className={`${styles.input} ${credit.creditControl} ${credit.creditMono}`} inputMode="text" value={adjustment} disabled={!editable || adjustmentUnconfirmed} required placeholder="+20 or -5" aria-invalid={Boolean(errors.adjustment)} aria-describedby={errors.adjustment ? 'credit-adjustment-amount-error' : undefined} onChange={(event) => { setAdjustment(event.target.value); setErrors((current) => ({ ...current, adjustment: '' })) }} />
                  {errors.adjustment ? <p className={credit.creditError} id="credit-adjustment-amount-error" role="alert">{errors.adjustment}</p> : null}
                </div>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="credit-adjustment-reason">Adjustment reason</label>
                  <input id="credit-adjustment-reason" className={`${styles.input} ${credit.creditControl}`} value={adjustReason} maxLength={240} disabled={!editable || adjustmentUnconfirmed} required aria-invalid={Boolean(errors.adjustReason)} aria-describedby={errors.adjustReason ? 'credit-adjustment-reason-error' : undefined} onChange={(event) => { setAdjustReason(event.target.value); setErrors((current) => ({ ...current, adjustReason: '' })) }} />
                  {errors.adjustReason ? <p className={credit.creditError} id="credit-adjustment-reason-error" role="alert">{errors.adjustReason}</p> : null}
                </div>
              </div>
              <div className={credit.creditActions}><button className={`${styles.btn} ${styles.btnPrimary} ${credit.creditPrimary} ${credit.creditButton}`} type="submit" disabled={!editable}>Review adjustment</button><a className={`${styles.btn} ${credit.creditButton}`} href="/admin/audit">Audit log</a></div>
              <p className={credit.creditHint}>An unchanged retry reuses the same operation ID, preventing a second grant when the first response was lost. A reduction cannot release a pending hold.</p>
              {adjustmentUnconfirmed ? <p className={credit.creditError} role="alert">Adjustment outcome unconfirmed. The draft is locked for an unchanged retry; keep this editor open or reconcile operation <code>{adjustmentAttempt.current?.operationId}</code> in the audit log before making another grant.</p> : null}
            </form>
          </>
        ) : null}
        {lastChange ? <div className={credit.creditNotice} role="status">
          <p className={credit.creditSectionTitle}>Readings around the last confirmed change</p>
          <p className={credit.creditNote}>{lastChange.amount} / {lastChange.reason}</p>
          <p className={credit.creditNote}>Available: {lastChange.before} before / {lastChange.after} after / <time dateTime={lastChange.asOf}>{dateLabel(lastChange.asOf)}</time></p>
        </div> : null}
      </div>
      <ConfirmDialog spec={ask} onCancel={() => { setAsk(null); setPending(null) }} onConfirm={() => void runWrite()} />
    </section>
  )
}
