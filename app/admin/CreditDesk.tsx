'use client'

import type { CreditPolicyView } from '@/lib/usage/credit-types'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ConfirmDialog, type ConfirmSpec } from './ConfirmDialog'
import { count } from './format'
import styles from './bench.module.css'
import credit from './credit.module.css'

export type CreditPolicyReadStatus = 'loading' | 'ready' | 'legacy' | 'error'

type PolicyDraft = {
  enabled: boolean
  guest: string
  member: string
  period: string
}

type PolicyWrite = {
  enabled: boolean
  guest_allowance: number
  member_allowance: number
  period_hours: 24 | 168
  expected_version: number
}

type PolicyReply = { policy?: CreditPolicyView; error?: string; code?: string }
type Notice = { tone: 'error' | 'success'; message: string }

const MAX_CREDITS = 1_000_000

function amount(value: string) {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_CREDITS ? parsed : null
}

function validPolicy(value: unknown): value is CreditPolicyView {
  if (!value || typeof value !== 'object') return false
  const policy = value as CreditPolicyView
  const bounded = (number: number) => Number.isSafeInteger(number) && number >= 0 && number <= MAX_CREDITS
  return typeof policy.enabled === 'boolean'
    && bounded(policy.guest_allowance) && bounded(policy.member_allowance)
    && (policy.period_hours === 24 || policy.period_hours === 168)
    && Number.isSafeInteger(policy.version) && policy.version > 0
    && (policy.activated_at === null || (typeof policy.activated_at === 'string' && Number.isFinite(Date.parse(policy.activated_at))))
    && Array.isArray(policy.prices)
    && policy.prices.every((price) => price && typeof price.tool_id === 'string' && price.tool_id.trim().length > 0
      && typeof price.label === 'string' && price.label.trim().length > 0 && typeof price.enabled === 'boolean'
      && bounded(price.cost) && Number.isSafeInteger(price.version) && price.version > 0)
    && new Set(policy.prices.map((price) => price.tool_id)).size === policy.prices.length
}

function draftFor(policy: CreditPolicyView): PolicyDraft {
  return { enabled: policy.enabled, guest: String(policy.guest_allowance), member: String(policy.member_allowance), period: String(policy.period_hours) }
}

/** Only a confirmed schema/config absence means legacy mode; an outage is unknown. */
export default function CreditDesk({
  canEdit,
  onPolicyChange,
  onReadStateChange,
}: {
  canEdit: boolean
  onPolicyChange: (policy: CreditPolicyView) => void
  onReadStateChange?: (status: CreditPolicyReadStatus) => void
}) {
  const [policy, setPolicy] = useState<CreditPolicyView | null>(null)
  const [draft, setDraft] = useState<PolicyDraft | null>(null)
  const [priceDrafts, setPriceDrafts] = useState<Record<string, string>>({})
  const [status, setStatus] = useState<CreditPolicyReadStatus>('loading')
  const [readError, setReadError] = useState('')
  const [readCode, setReadCode] = useState('')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [ask, setAsk] = useState<ConfirmSpec | null>(null)
  const [pendingPolicy, setPendingPolicy] = useState<PolicyWrite | null>(null)
  const [previewTool, setPreviewTool] = useState('')
  const writeLock = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const acceptPolicy = useCallback((next: CreditPolicyView, saved?: { policy?: boolean; toolId?: string }) => {
    setPolicy(next)
    setDraft((current) => saved?.policy || !current ? draftFor(next) : { ...current, enabled: next.enabled || current.enabled })
    setPriceDrafts((current) => Object.fromEntries(next.prices.map((price) => [
      price.tool_id,
      saved?.toolId === price.tool_id ? String(price.cost) : current[price.tool_id] ?? String(price.cost),
    ])))
    setStatus('ready')
    setReadError('')
    setReadCode('')
    onPolicyChange(next)
    onReadStateChange?.('ready')
  }, [onPolicyChange, onReadStateChange])

  useEffect(() => {
    const controller = new AbortController()
    let current = true
    const load = async () => {
      try {
        const response = await fetch('/api/admin/credits', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
        const payload = await response.json().catch(() => null) as PolicyReply | null
        if (!current) return
        if (!response.ok || !validPolicy(payload?.policy)) {
          const code = typeof payload?.code === 'string' ? payload.code : ''
          const legacy = response.status === 503 && (code === 'credit_schema_missing' || code === 'credit_store_missing')
          setStatus(legacy ? 'legacy' : 'error')
          setReadError(typeof payload?.error === 'string' ? payload.error : 'The server did not return a valid credit policy.')
          setReadCode(code)
          if (legacy) setPolicy(null)
          onReadStateChange?.(legacy ? 'legacy' : 'error')
          return
        }
        acceptPolicy(payload.policy)
      } catch (error) {
        if (!current) return
        setStatus('error')
        setReadError(error instanceof Error ? error.message : 'The credit policy could not be read.')
        setReadCode('')
        onReadStateChange?.('error')
      }
    }
    void load()
    return () => { current = false; controller.abort() }
  }, [reload, acceptPolicy, onReadStateChange])

  const refresh = () => {
    setStatus('loading')
    setReadError('')
    onReadStateChange?.('loading')
    setReload((value) => value + 1)
  }

  const editable = canEdit && status === 'ready' && !busy
  const guest = draft ? amount(draft.guest) : null
  const member = draft ? amount(draft.member) : null
  const period = draft?.period === '24' ? 24 : draft?.period === '168' ? 168 : null
  const policyDirty = Boolean(policy && draft && (draft.enabled !== policy.enabled || guest !== policy.guest_allowance
    || member !== policy.member_allowance || period !== policy.period_hours))
  const dirtyPrices = policy?.prices.filter((price) => amount(priceDrafts[price.tool_id] ?? '') !== price.cost).length ?? 0

  const patchDraft = (field: keyof PolicyDraft, value: string | boolean) => {
    setDraft((current) => current ? { ...current, [field]: value } : current)
    setErrors((current) => ({ ...current, [field]: '' }))
    setNotice(null)
  }

  const write = async (method: 'PUT' | 'PATCH', body: PolicyWrite | { tool_id: string; cost: number; expected_version: number } | { tool_id: string; enabled: boolean; expected_version: number }, label: string) => {
    if (!canEdit || status !== 'ready' || writeLock.current) return
    writeLock.current = true
    setBusy(method === 'PUT' ? 'policy' : (body as { tool_id: string }).tool_id)
    setNotice(null)
    setAsk((current) => current ? { ...current, busy: true } : null)
    try {
      const response = await fetch('/api/admin/credits', {
        method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const payload = await response.json().catch(() => null) as PolicyReply | null
      if (!mounted.current) return
      if (response.status === 409 && payload?.code === 'credit_version_conflict') {
        setNotice({ tone: 'error', message: 'Someone else saved first. Reloading the saved policy; your draft is kept. Compare the fresh readings before saving again.' })
        refresh()
        return
      }
      if (!response.ok || !validPolicy(payload?.policy)) {
        throw new Error(`${typeof payload?.error === 'string' ? payload.error : 'Save was not confirmed. Reload the policy before retrying; your draft is kept.'}${payload?.code ? ` (${payload.code})` : ''}`)
      }
      acceptPolicy(payload.policy, method === 'PUT' ? { policy: true } : { toolId: (body as { tool_id: string }).tool_id })
      setNotice({ tone: 'success', message: `${label} saved. New reservations use the saved policy; work already running keeps its captured price and expiry.` })
    } catch (error) {
      if (mounted.current) setNotice({ tone: 'error', message: error instanceof Error ? error.message : 'The change was not confirmed.' })
    } finally {
      writeLock.current = false
      if (mounted.current) { setBusy(''); setAsk(null); setPendingPolicy(null) }
    }
  }

  const savePolicy = () => {
    if (!editable || !policy || !draft) return
    const nextErrors: Record<string, string> = {}
    if (guest === null) nextErrors.guest = 'Guest allowance must be a whole number from 0 to 1,000,000.'
    if (member === null) nextErrors.member = 'Member allowance must be a whole number from 0 to 1,000,000.'
    if (period === null) nextErrors.period = 'Choose exactly 24 or 168 hours.'
    setErrors(nextErrors)
    if (guest === null || member === null || period === null) return
    const body: PolicyWrite = { enabled: draft.enabled, guest_allowance: guest, member_allowance: member, period_hours: period, expected_version: policy.version }
    if (draft.enabled && !policy.enabled) {
      setPendingPolicy(body)
      setAsk({
        eyebrow: 'Activate pooled credits', title: 'Enable the credit policy?',
        body: 'This changes entitlement from independent tool caps to one shared credit allowance. Credit accounting starts at activation; legacy call history is retained, not silently backfilled as wallet spend. Only saved tool prices apply. Disabling later requires a reconciled cutover, not another toggle.',
        facts: [
          { label: 'Guest allowance', value: `${count(guest)} credits` },
          { label: 'Member allowance', value: `${count(member)} credits` },
          { label: 'Rolling window', value: `${period} hours` },
          { label: 'Saved prices', value: `${policy.prices.length} actions${dirtyPrices ? `; ${dirtyPrices} price drafts not included` : ''}` },
        ],
        cancelLabel: 'Keep legacy caps', confirmLabel: 'Enable credits', tone: 'accent', typeToConfirm: 'ENABLE',
      })
    } else {
      void write('PUT', body, 'Credit policy')
    }
  }

  const savePrice = (price: CreditPolicyView['prices'][number]) => {
    if (!editable) return
    const cost = amount(priceDrafts[price.tool_id] ?? '')
    if (cost === null) {
      setErrors((current) => ({ ...current, [price.tool_id]: 'Cost must be a whole number from 0 to 1,000,000. Blank is not free.' }))
      return
    }
    setErrors((current) => ({ ...current, [price.tool_id]: '' }))
    void write('PATCH', { tool_id: price.tool_id, cost, expected_version: price.version }, `${price.label} price`)
  }

  const toggleFeatureCredits = (price: CreditPolicyView['prices'][number]) => {
    if (!editable) return
    void write('PATCH', { tool_id: price.tool_id, enabled: !price.enabled, expected_version: price.version }, `${price.label} credit setting`)
  }

  const preview = policy?.prices.find((price) => price.tool_id === previewTool) ?? policy?.prices[0]
  const previewCost = preview ? amount(priceDrafts[preview.tool_id] ?? '') : null

  return (
    <section className={`${styles.panel} ${credit.creditHost}`} aria-labelledby="credit-policy-title" aria-busy={status === 'loading'}>
      <div className={`${styles.panelHead} ${credit.creditHead}`}>
        <div className={credit.creditHeadText}>
          <h2 className={styles.panelTitle} id="credit-policy-title">Credit policy</h2>
          <p className={credit.creditHint}>One allowance across priced tools. Availability stays on each instrument below.</p>
        </div>
        <div className={credit.creditActions}>
          <span className={`${styles.badge} ${status !== 'ready' ? styles.badgeNeutral : policy?.enabled ? styles.badgeOn : styles.badgeNeutral}`}>
            {status === 'loading' ? 'Reading policy' : status === 'legacy' ? 'Legacy fallback' : status === 'error' ? 'Unconfirmed' : policy?.enabled ? 'Credits active' : 'Legacy caps active'}
          </span>
          <button className={`${styles.btn} ${credit.creditButton}`} type="button" disabled={Boolean(busy) || status === 'loading'} onClick={refresh}>
            {status === 'error' || status === 'legacy' ? 'Retry policy' : 'Reload policy'}
          </button>
        </div>
      </div>
      <div className={credit.creditBody}>
        {status === 'loading' ? <p className={credit.creditNote} role="status">{policy ? 'Refreshing saved readings. Your draft is kept; writes are paused.' : 'Loading the actual credit policy. No allowance is assumed.'}</p> : null}
        {readError ? (
          <div className={credit.creditNotice} role="alert">
            <p className={credit.creditError}>{readError}{readCode ? <> <code>{readCode}</code></> : null}</p>
            <p className={credit.creditNote}>{status === 'legacy'
              ? 'Credit configuration is absent. Existing per-tool caps remain in use; no credit amounts are invented. Apply the reviewed migration or restore store configuration, then retry.'
              : 'Credit policy is unconfirmed. Editing is paused; any saved readings below are the last successful read, not proof of the current mode.'}</p>
          </div>
        ) : null}
        {!canEdit ? <p className={credit.creditNote}>Read-only. Only an Owner or Operator can change credit policy or prices.</p> : null}
        {notice ? <p className={notice.tone === 'error' ? credit.creditError : credit.creditSuccess} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.message}</p> : null}
        {policy && draft ? (
          <>
            <form className={credit.creditForm} noValidate onSubmit={(event) => { event.preventDefault(); savePolicy() }}>
              <div className={credit.creditFields}>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="credit-mode">Metering mode</label>
                  <select id="credit-mode" className={`${styles.select} ${credit.creditControl}`} value={draft.enabled ? 'credits' : 'legacy'} disabled={!editable || policy.enabled || Boolean(policy.activated_at)} onChange={(event) => patchDraft('enabled', event.target.value === 'credits')}>
                    <option value="legacy">Legacy per-tool caps</option>
                    <option value="credits">Pooled credits</option>
                  </select>
                  <p className={credit.creditHint}>{policy.enabled ? 'Active. Rollback requires a reconciled cutover.' : 'Not enabled until you explicitly save and confirm.'}</p>
                </div>
                {(['guest', 'member'] as const).map((key) => (
                  <div className={styles.field} key={key}>
                    <label className={styles.fieldLabel} htmlFor={`credit-${key}`}>{key === 'guest' ? 'Guest allowance' : 'Member allowance'}</label>
                    <input id={`credit-${key}`} className={`${styles.input} ${credit.creditControl} ${credit.creditMono}`} inputMode="numeric" value={draft[key]} disabled={!editable} required aria-invalid={Boolean(errors[key])} aria-describedby={`credit-${key}-hint${errors[key] ? ` credit-${key}-error` : ''}`} onChange={(event) => patchDraft(key, event.target.value)} />
                    <p className={credit.creditHint} id={`credit-${key}-hint`}>Saved: <span className={credit.creditMono}>{count(key === 'guest' ? policy.guest_allowance : policy.member_allowance)}</span> credits</p>
                    {errors[key] ? <p className={credit.creditError} id={`credit-${key}-error`} role="alert">{errors[key]}</p> : null}
                  </div>
                ))}
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="credit-period">Wallet rolling window</label>
                  <select id="credit-period" className={`${styles.select} ${credit.creditControl}`} value={draft.period} disabled={!editable} aria-invalid={Boolean(errors.period)} onChange={(event) => patchDraft('period', event.target.value)}>
                    <option value="24">24 hours</option><option value="168">168 hours</option>
                  </select>
                  <p className={credit.creditHint}>Saved: {policy.period_hours} hours. Not a midnight reset.</p>
                  {errors.period ? <p className={credit.creditError} role="alert">{errors.period}</p> : null}
                </div>
              </div>
              <p className={credit.creditNote}>Allowance reductions do not refund or rewrite spend. New window and price settings apply to new operations; existing holds and charges keep their captured expiry.</p>
              <div className={credit.creditActions}>
                <button className={`${styles.btn} ${styles.btnPrimary} ${credit.creditPrimary} ${credit.creditButton}`} type="submit" disabled={!editable || !policyDirty}>{busy === 'policy' ? 'Saving policy...' : draft.enabled && !policy.enabled ? 'Review activation' : 'Save policy'}</button>
                <button className={`${styles.btn} ${credit.creditButton}`} type="button" disabled={!editable || !policyDirty} onClick={() => { setDraft(draftFor(policy)); setErrors({}); setNotice(null) }}>Use saved policy</button>
                <span className={credit.creditHint}>Saved version <span className={credit.creditMono}>{policy.version}</span>{policyDirty ? ' / unsaved policy draft' : ''}</span>
              </div>
            </form>
            {preview ? (
              <div className={`${credit.creditSection} ${credit.creditForm}`}>
                <h3 className={credit.creditSectionTitle}>Unused allowance preview</h3>
                <div className={styles.field}>
                  <label className={styles.fieldLabel} htmlFor="credit-preview-tool">Compare draft allowance with this action</label>
                  <select id="credit-preview-tool" className={`${styles.select} ${credit.creditControl}`} value={preview.tool_id} onChange={(event) => setPreviewTool(event.target.value)}>
                    {policy.prices.map((price) => <option key={price.tool_id} value={price.tool_id}>{price.label}</option>)}
                  </select>
                </div>
                <p className={credit.creditNote}>{guest === null || member === null || previewCost === null ? 'Enter valid allowance and cost drafts to preview. No balance is estimated from invalid or blank input.'
                  : previewCost === 0 ? `${preview.label} has a draft cost of 0 credits. This action would not consume the pool; availability still applies.`
                    : `${preview.label} at ${count(previewCost)} credits per action: an unused draft guest allowance covers ${count(Math.floor(guest / previewCost))} actions; an unused member allowance covers ${count(Math.floor(member / previewCost))}.`}</p>
                <p className={credit.creditHint}>Preview only, with no spend, reservations or account overrides. It is not an existing wallet balance; tool-price drafts save separately.</p>
              </div>
            ) : null}
            <details className={`${credit.creditSection} ${credit.creditPrices}`}>
              <summary>Tool pricing <span className={credit.creditMono}>({policy.prices.length})</span>{dirtyPrices ? ` / ${dirtyPrices} unsaved` : ''}</summary>
              <p className={credit.creditNote}>Turn credits off for a tool to allow unlimited use without pooled credits or legacy call caps. Tool availability remains controlled separately. Existing prices are kept when credits are off.</p>
              {policy.prices.length === 0 ? <p className={credit.creditError}>The server returned no priced actions.</p> : (
                <ul className={credit.creditPriceList}>
                  {policy.prices.map((price, index) => (
                    <li className={credit.creditPriceRow} key={price.tool_id}>
                      <form className={credit.creditPriceForm} noValidate onSubmit={(event) => { event.preventDefault(); savePrice(price) }}>
                        <div>
                          <label className={credit.creditPriceName} htmlFor={`credit-price-${index}`}>{price.label}</label>
                          <p className={credit.creditHint}>Credits {price.enabled ? 'on' : 'off'} · saved cost <span className={credit.creditMono}>{count(price.cost)}</span> / version {price.version}</p>
                        </div>
                        <div className={credit.creditActions}>
                          <button className={`${styles.btn} ${credit.creditButton}`} type="button" disabled={!editable} aria-pressed={price.enabled} onClick={() => toggleFeatureCredits(price)}>{busy === price.tool_id ? 'Saving...' : price.enabled ? 'Turn credits off' : 'Turn credits on'}</button>
                          <input id={`credit-price-${index}`} className={`${styles.input} ${credit.creditControl} ${credit.creditPriceInput}`} aria-label={`${price.label} credit cost`} inputMode="numeric" value={priceDrafts[price.tool_id] ?? ''} disabled={!editable} required aria-invalid={Boolean(errors[price.tool_id])} aria-describedby={errors[price.tool_id] ? `credit-price-error-${index}` : undefined} onChange={(event) => { setPriceDrafts((current) => ({ ...current, [price.tool_id]: event.target.value })); setErrors((current) => ({ ...current, [price.tool_id]: '' })); setNotice(null) }} />
                          <button className={`${styles.btn} ${credit.creditButton}`} type="submit" disabled={!editable || amount(priceDrafts[price.tool_id] ?? '') === price.cost}>{busy === price.tool_id ? 'Saving...' : 'Save price'}</button>
                        </div>
                        {errors[price.tool_id] ? <p id={`credit-price-error-${index}`} className={`${credit.creditError} ${credit.creditPriceError}`} role="alert">{errors[price.tool_id]}</p> : null}
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </>
        ) : null}
      </div>
      <ConfirmDialog spec={ask} onCancel={() => { setAsk(null); setPendingPolicy(null) }} onConfirm={() => { if (pendingPolicy) void write('PUT', pendingPolicy, 'Pooled credit policy') }} />
    </section>
  )
}
