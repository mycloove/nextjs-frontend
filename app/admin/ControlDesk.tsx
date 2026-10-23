'use client'

import type { ToolControl, ToolUsageSummary, UsagePeriod } from '@/lib/usage/types'
import type { CreditPolicyView } from '@/lib/usage/credit-types'
import { useCallback, useMemo, useState } from 'react'
import BenchIcon from './BenchIcon'
import { BenchToasts, useBenchToasts } from './BenchToast'
import { ConfirmDialog, type ConfirmSpec } from './ConfirmDialog'
import CreditDesk, { type CreditPolicyReadStatus } from './CreditDesk'
import styles from './bench.module.css'
import credit from './credit.module.css'
import view from './tools/tools.module.css'
import { toolFace } from './toolFaces'

/** What the operator may change without touching the rest of the row. */
type Draft = {
  guest_limit: string
  member_limit: string
  period: UsagePeriod
}

type Ask =
  | { kind: 'switch'; toolId: string; next: boolean }
  | { kind: 'reset'; toolId: string }

type Filter = 'all' | 'on' | 'off' | 'draft'

const FILTER_ORDER: Filter[] = ['all', 'on', 'off', 'draft']

/**
 * Windows are reported for both 24h and 7d on every tool because the bench has
 * no idea what a given instrument is doing right now, and a second round trip per
 * card would be eighteen of them. One field decides which pair the card reads.
 */
function pick(summary: ToolUsageSummary | undefined, period: UsagePeriod) {
  const weekly = period === 'week'
  return {
    guest: weekly ? (summary?.guest_used_7d ?? 0) : (summary?.guest_used_24h ?? 0),
    member: weekly ? (summary?.member_used_7d ?? 0) : (summary?.member_used_24h ?? 0),
  }
}

function toDraft(tool: ToolControl): Draft {
  return {
    guest_limit: String(tool.guest_limit),
    member_limit: String(tool.member_limit),
    period: tool.period,
  }
}

function isDirty(draft: Draft, tool: ToolControl) {
  return (
    draft.period !== tool.period ||
    draft.guest_limit.trim() === '' ||
    draft.member_limit.trim() === '' ||
    Number(draft.guest_limit) !== tool.guest_limit ||
    Number(draft.member_limit) !== tool.member_limit
  )
}

export default function ControlDesk({
  initialTools,
  initialUsage,
  usageDegraded,
  usageError,
  loadError,
}: {
  initialTools: ToolControl[]
  initialUsage: Record<string, ToolUsageSummary>
  usageDegraded: boolean
  usageError: string
  loadError: string
}) {
  /*
   * `tools` is server truth and `drafts` is what the operator has typed. They are
   * separate because the on/off switch and the cap form are two independent
   * controls on one card, and the old desk kept a single object for both: the
   * switch then wrote a whole row built from the *saved* caps, which silently
   * discarded whatever the cap form had typed but not yet saved. Each control now
   * sends only its own fields and neither can revert the other.
   */
  const [tools, setTools] = useState<Record<string, ToolControl>>(() =>
    Object.fromEntries(initialTools.map((tool) => [tool.tool_id, tool])),
  )
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(initialTools.map((tool) => [tool.tool_id, toDraft(tool)])),
  )
  const [usage, setUsage] = useState(initialUsage)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [busyId, setBusyId] = useState('')
  const [ask, setAsk] = useState<ConfirmSpec | null>(null)
  const [pending, setPending] = useState<Ask | null>(null)
  const [creditPolicy, setCreditPolicy] = useState<CreditPolicyView | null>(null)
  const [creditStatus, setCreditStatus] = useState<CreditPolicyReadStatus>('loading')
  const { toasts, push, dismiss } = useBenchToasts()

  const onPolicyChange = useCallback((policy: CreditPolicyView) => {
    setCreditPolicy(policy)
    if (policy.enabled) setFilter((current) => current === 'draft' ? 'all' : current)
  }, [])
  // A failed policy read must not present independent caps as the active pool.
  // Only a confirmed disabled policy or missing credit schema/config is legacy.
  const legacyCaps = creditStatus === 'legacy' || (creditStatus === 'ready' && creditPolicy?.enabled === false)
  const pooledCredits = creditPolicy?.enabled === true && creditStatus !== 'legacy'

  const rows = useMemo(() => Object.values(tools), [tools])

  const dirtyIds = useMemo(() => {
    const set = new Set<string>()
    if (!legacyCaps) return set
    for (const tool of rows) {
      const draft = drafts[tool.tool_id]
      if (draft && isDirty(draft, tool)) set.add(tool.tool_id)
    }
    return set
  }, [rows, drafts, legacyCaps])

  const counts = useMemo(
    () => ({
      all: rows.length,
      on: rows.filter((row) => row.enabled).length,
      off: rows.filter((row) => !row.enabled).length,
      draft: dirtyIds.size,
    }),
    [rows, dirtyIds],
  )

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return rows.filter((tool) => {
      if (filter === 'on' && !tool.enabled) return false
      if (filter === 'off' && tool.enabled) return false
      if (filter === 'draft' && legacyCaps && !dirtyIds.has(tool.tool_id)) return false
      if (!term) return true
      return (
        tool.label.toLowerCase().includes(term) ||
        tool.tool_id.toLowerCase().includes(term) ||
        tool.href.toLowerCase().includes(term)
      )
    })
  }, [rows, search, filter, dirtyIds, legacyCaps])

  const groups = useMemo(() => {
    const order: string[] = []
    const byGroup = new Map<string, ToolControl[]>()
    for (const tool of visible) {
      const group = tool.group || 'Other'
      if (!byGroup.has(group)) {
        byGroup.set(group, [])
        order.push(group)
      }
      byGroup.get(group)!.push(tool)
    }
    return order.map((group) => ({ group, tools: byGroup.get(group)! }))
  }, [visible])

  const patch = (toolId: string, next: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [toolId]: { ...current[toolId], ...next } }))
  }

  /** Writes only the fields this control owns, and folds the server's answer back in. */
  const applyResult = (tool: ToolControl) => {
    setTools((current) => ({ ...current, [tool.tool_id]: tool }))
  }

  /**
   * A 409 means someone else saved this row first. Replace server truth with
   * the fresh row, but keep the operator's typed draft: their edit is not
   * lost, it just needs one more save against the new base.
   */
  const applyConflict = (toolId: string, fresh: ToolControl, previousGroup: string | undefined) => {
    applyResult({ ...fresh, group: previousGroup ?? fresh.group })
    push(
      'bad',
      'Someone else saved this instrument first. The fresh numbers are shown — your typed values are kept, so compare and save again.',
    )
  }

  const readConflict = (payload: { tool?: ToolControl }) => payload.tool ?? null

  const saveCaps = async (tool: ToolControl) => {
    if (!legacyCaps) return
    const draft = drafts[tool.tool_id]
    if (!draft) return
    const guest = Number(draft.guest_limit)
    const member = Number(draft.member_limit)
    if (!/^\d+$/.test(draft.guest_limit.trim()) || !Number.isSafeInteger(guest) || guest < 0) {
      push('bad', `${tool.label}: the guest cap must be a whole number of zero or more.`)
      return
    }
    if (!/^\d+$/.test(draft.member_limit.trim()) || !Number.isSafeInteger(member) || member < 0) {
      push('bad', `${tool.label}: the signed-in cap must be a whole number of zero or more.`)
      return
    }
    if (draft.period !== 'day' && draft.period !== 'week') {
      push('bad', `${tool.label}: choose a day or week rolling window.`)
      return
    }
    setBusyId(tool.tool_id)
    try {
      const response = await fetch('/api/admin/tools', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool_id: tool.tool_id,
          guest_limit: guest,
          member_limit: member,
          period: draft.period,
          expected_updated_at: tool.updated_at ?? null,
        }),
      })
      const payload = await response.json() as { tool?: ToolControl; error?: string }
      if (response.status === 409) {
        const fresh = readConflict(payload)
        if (fresh) applyConflict(tool.tool_id, fresh, tool.group)
        else push('bad', payload.error || 'Save failed')
        return
      }
      if (!response.ok || !payload.tool) throw new Error(payload.error || 'Save failed')
      applyResult({ ...payload.tool, group: tool.group })
      push(
        'ok',
        `${tool.label} saved. Calls left are the new cap minus calls already made in the window.`,
      )
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Save failed')
    } finally {
      setBusyId('')
    }
  }

  const askSwitch = (tool: ToolControl) => {
    const next = !tool.enabled
    const price = creditPolicy?.prices.find((entry) => entry.tool_id === tool.tool_id)
    setAsk({
      eyebrow: next ? 'Open this instrument' : 'Withdraw this instrument',
      title: next ? `Turn ${tool.label} on?` : `Turn ${tool.label} off?`,
      body: next
        ? legacyCaps
          ? 'It goes back on the homepage and starts accepting calls again, on the caps already saved below.'
          : 'It goes back on the homepage and starts accepting new calls under the active server policy. Availability does not change allowance, spend or credit prices.'
        : 'It leaves the homepage and new calls are refused until you turn it on again. Existing cap and credit settings stay as they are.',
      facts: legacyCaps ? [
        { label: 'Guest cap', value: `${tool.guest_limit} / ${tool.period === 'week' ? 'week' : 'day'}` },
        { label: 'Signed-in cap', value: `${tool.member_limit} / ${tool.period === 'week' ? 'week' : 'day'}` },
      ] : [
        { label: 'Credit price', value: creditStatus === 'ready' && price ? `${price.cost} credits / action` : 'Policy not confirmed' },
        { label: 'Wallet', value: pooledCredits ? 'Shared credit allowance; unchanged' : 'Server policy; unchanged' },
      ],
      cancelLabel: next ? 'Leave it off' : 'Leave it on',
      confirmLabel: next ? 'Turn on' : 'Turn off',
      tone: next ? 'accent' : 'danger',
    })
    setPending({ kind: 'switch', toolId: tool.tool_id, next })
  }

  const askReset = (tool: ToolControl) => {
    setAsk({
      eyebrow: 'Clear recorded calls',
      title: `Clear recorded ${tool.label} calls?`,
      body: legacyCaps
        ? 'The legacy cap stays as it is. Clearing its tally returns that cap immediately. This never refunds wallet credits or releases credit reservations.'
        : 'This clears recorded-call analytics only. It never refunds wallet credits, deletes credit ledger entries or releases reservations. An audited credit adjustment is a separate action.',
      input: {
        label: 'Limit to one account email (optional)',
        placeholder: 'Leave empty to clear every guest and account',
        secret: false,
      },
      cancelLabel: 'Keep the tally',
      confirmLabel: 'Clear calls',
      tone: 'danger',
    })
    setPending({ kind: 'reset', toolId: tool.tool_id })
  }

  const dismissAsk = () => {
    setAsk(null)
    setPending(null)
  }

  const runAsk = async (scope: string) => {
    if (!pending) return
    const tool = tools[pending.toolId]
    if (!tool) return
    setAsk((current) => (current ? { ...current, busy: true } : current))
    setBusyId(tool.tool_id)
    try {
      if (pending.kind === 'switch') {
        // Only `enabled` is sent. The cap form keeps its unsaved edits because
        // this write cannot touch them. The row version still travels so a
        // concurrent cap save surfaces as a 409 instead of a silent revert.
        const response = await fetch('/api/admin/tools', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tool_id: tool.tool_id,
            enabled: pending.next,
            expected_updated_at: tool.updated_at ?? null,
          }),
        })
        const payload = await response.json() as { tool?: ToolControl; error?: string }
        if (response.status === 409) {
          const fresh = readConflict(payload)
          if (fresh) applyConflict(tool.tool_id, fresh, tool.group)
          else push('bad', payload.error || 'The switch did not stick.')
          setAsk(null)
          setPending(null)
          return
        }
        if (!response.ok || !payload.tool || payload.tool.enabled !== pending.next) {
          throw new Error(payload.error || 'The switch did not stick.')
        }
        applyResult({ ...payload.tool, group: tool.group })
        push(
          pending.next ? 'ok' : 'info',
          pending.next
            ? `${tool.label} is on. It returns to the homepage on reload.`
            : `${tool.label} is off. It leaves the homepage and refuses new calls.`,
        )
      } else {
        const email = scope.trim()
        if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Enter an account email or leave the scope empty.')
        const response = await fetch('/api/admin/tools', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool_id: tool.tool_id, email }),
        })
        const payload = await response.json() as { deleted?: number; error?: string }
        if (!response.ok) throw new Error(payload.error || 'Reset failed')
        const removed = payload.deleted ?? 0
        setUsage((current) => {
          const next = { ...current }
          const entry = next[tool.tool_id]
          if (entry) {
            next[tool.tool_id] = {
              ...entry,
              guest_used_24h: email ? entry.guest_used_24h : 0,
              member_used_24h: email ? entry.member_used_24h : 0,
              guest_used_7d: email ? entry.guest_used_7d : 0,
              member_used_7d: email ? entry.member_used_7d : 0,
            }
          }
          return next
        })
        push('ok', `Cleared ${removed} recorded ${tool.label} call${removed === 1 ? '' : 's'}${email ? ` for ${email}` : ''}. Wallet credits and reservations are unchanged.`)
      }
      setAsk(null)
      setPending(null)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'That did not go through.')
    } finally {
      setBusyId('')
      setAsk((current) => current ? { ...current, busy: false } : null)
    }
  }

  const gaugeTone = (used: number, limit: number) => {
    if (!limit) return 'none'
    const ratio = used / limit
    if (ratio >= 1) return 'full'
    if (ratio >= 0.8) return 'warn'
    return 'normal'
  }

  const degraded = loadError || usageDegraded
  const nearCap = legacyCaps ? visible.flatMap((tool) => {
    const summary = usage[tool.tool_id]
    const { guest, member } = pick(summary, tool.period)
    return [
      { key: 'guest', label: 'Guests', used: guest, cap: tool.guest_limit },
      { key: 'member', label: 'Signed-in', used: member, cap: tool.member_limit },
    ].filter((reading) => reading.cap > 0 && reading.used / reading.cap >= 0.8)
      .map((reading) => ({ tool, ...reading, percent: Math.min(100, Math.floor((reading.used / reading.cap) * 100)) }))
  }) : []

  return (
    <div className={`${styles.page} ${view.toolsPage}`}>
      <header className={`${styles.pageHead} ${view.pageHead}`}>
        <div>
          <p className={`${styles.pageEyebrow} ${view.eyebrow}`}>Control desk <span>·</span> Tools</p>
          <h1 className={`${styles.pageTitle} ${view.pageTitle}`}>Tool controls</h1>
          <p className={`${styles.pageLead} ${view.pageLead}`}>
            Availability, credit policy, and recorded usage for every instrument.
          </p>
        </div>
        <div className={`${styles.pageActions} ${view.pageActions}`}>
          <a className={styles.btn} href="/api/admin/export?dataset=tools">Export CSV</a>
        </div>
      </header>

      <CreditDesk canEdit={!loadError} onPolicyChange={onPolicyChange} onReadStateChange={setCreditStatus} />

      <p className={view.quotaNote}>
        {legacyCaps
          ? 'Usage counts completed calls across everyone. Lowering a cap does not refund calls already recorded in the current window.'
          : pooledCredits
            ? 'Pooled credits replace independent tool caps. Call counts below are analytics, not individual wallet balances; clearing them never refunds credits.'
            : 'Credit policy is not confirmed. Cap editors and capacity gauges are paused to avoid misleading readings; availability switches remain independent.'}
      </p>

      {degraded ? (
        <div className={`${styles.degraded} ${view.degraded}`} role="status">
          <BenchIcon className={styles.toastIcon} name="alert" />
          <div>
            <p className={styles.degradedTitle}>Some bench data could not be read.</p>
            <p className={styles.degradedBody}>
              {loadError || usageError} {legacyCaps
                ? 'Legacy quota fails open when its store is missing. '
                : 'These analytics do not establish whether a wallet is available or enforced. '}
              Check <code>DATABASE_URL</code> and the reviewed migrations, then reload.
            </p>
          </div>
        </div>
      ) : null}

      {nearCap.length > 0 ? (
        <section className={`${styles.attention} ${view.attention}`} aria-labelledby="near-cap-title">
          <div>
            <p className={styles.attentionTitle} id="near-cap-title">{nearCap.length} cap{nearCap.length === 1 ? '' : 's'} near or at limit</p>
            <p className={styles.attentionBody}>Usage is compared with each instrument&rsquo;s current rolling window.</p>
          </div>
          <div className={styles.attentionLinks}>
            {nearCap.slice(0, 5).map((reading) => (
              <a key={`${reading.tool.tool_id}-${reading.key}`} href={`#tool-${encodeURIComponent(reading.tool.tool_id)}`}>
                {reading.tool.label} · {reading.label} · {reading.percent}%
              </a>
            ))}
            {nearCap.length > 5 ? <span>+{nearCap.length - 5} more</span> : null}
          </div>
        </section>
      ) : null}

      <div className={`${styles.toolbar} ${view.toolbar}`}>
        <div className={styles.search}>
          <BenchIcon className={styles.navIcon} name="search" />
          <input
            className={styles.searchInput}
            type="search"
            value={search}
            placeholder={`Search ${rows.length} instruments…`}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search instruments"
          />
        </div>
        <div className={styles.segmented} role="group" aria-label="Filter instruments">
          {FILTER_ORDER.filter((key) => key !== 'draft' || legacyCaps).map((key) => (
            <button
              key={key}
              type="button"
              className={`${styles.segment} ${filter === key ? styles.segmentOn : ''}`}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {key === 'draft' ? 'Unsaved' : key}
              <span className={styles.segmentCount}>{counts[key]}</span>
            </button>
          ))}
        </div>
        {counts.draft > 0 ? (
          <button
            type="button"
            className={styles.btn}
            onClick={() => {
              const next = { ...tools }
              const cleared = { ...drafts }
              for (const id of dirtyIds) {
                next[id] = { ...next[id] }
                cleared[id] = toDraft(next[id])
              }
              setTools(next)
              setDrafts(cleared)
              push('info', `Discarded ${counts.draft} unsaved cap edit${counts.draft === 1 ? '' : 's'}.`)
            }}
          >
            Discard unsaved
          </button>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div className={styles.empty}>
          <h2 className={styles.emptyTitle}>Nothing matches that.</h2>
          <p className={styles.emptyBody}>
            {rows.length === 0
              ? 'The bench could not read the tool store, so there is no catalog to show.'
              : 'Clear the search box or switch the filter back to All.'}
          </p>
        </div>
      ) : (
        groups.map(({ group, tools: groupTools }) => (
          <section className={`${styles.group} ${view.group}`} key={group}>
            <h2 className={`${styles.groupTitle} ${view.groupTitle}`}>
              <span>{group}</span>
              <span className={styles.groupCount}>
                {groupTools.length} · {groupTools.filter((tool) => tool.enabled).length} open
              </span>
            </h2>
            <div className={`${styles.cards} ${view.cards}`}>
              {groupTools.map((tool, index) => {
                const draft = drafts[tool.tool_id] ?? toDraft(tool)
                const summary = usage[tool.tool_id]
                const { guest, member } = pick(summary, draft.period)
                const busy = busyId === tool.tool_id
                const dirty = dirtyIds.has(tool.tool_id)
                const guestTone = gaugeTone(guest, Number(draft.guest_limit))
                const memberTone = gaugeTone(member, Number(draft.member_limit))
                const price = creditPolicy?.prices.find((entry) => entry.tool_id === tool.tool_id)
                return (
                  <article
                    id={`tool-${tool.tool_id}`}
                    className={[
                      styles.card,
                      view.card,
                      !tool.enabled ? styles.cardOff : '',
                      dirty ? styles.cardDirty : '',
                      busy ? styles.cardBusy : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    key={tool.tool_id}
                    style={{ '--bench-stagger': index } as React.CSSProperties}
                  >
                    <div className={`${styles.cardHead} ${view.cardHead}`}>
                      <div className={styles.cardId}>
                        <span className={styles.cardIcon} aria-hidden="true">
                          {toolFace(tool.tool_id)}
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <h3 className={styles.cardName}>{tool.label}</h3>
                          <a className={styles.cardHref} href={tool.href}>
                            {tool.href}
                          </a>
                        </div>
                      </div>
                      <div className={styles.cardSide}>
                        <span
                          className={`${styles.chip} ${
                            !tool.enabled ? styles.chipOff : dirty ? styles.chipDraft : styles.chipOn
                          }`}
                        >
                          {!tool.enabled ? 'Off' : dirty ? 'Draft' : 'On'}
                        </span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={tool.enabled}
                          aria-label={`${tool.label} is ${tool.enabled ? 'on' : 'off'}`}
                          className={`${styles.switch} ${tool.enabled ? styles.switchOn : ''}`}
                          disabled={busy}
                          onClick={() => askSwitch(tool)}
                        >
                          <span className={styles.switchTrack} aria-hidden="true">
                            <span className={styles.switchThumb} />
                          </span>
                          <span className={styles.switchLabel}>{tool.enabled ? 'On' : 'Off'}</span>
                        </button>
                      </div>
                    </div>

                    {legacyCaps ? <div className={`${styles.gauges} ${view.gauges}`}>
                      {([
                        { name: 'Guest', key: 'guest_limit', used: guest, limit: Number(draft.guest_limit), tone: guestTone },
                        { name: 'Signed in', key: 'member_limit', used: member, limit: Number(draft.member_limit), tone: memberTone },
                      ] as const).map((gauge) => {
                        const fill =
                          gauge.tone === 'none'
                            ? styles.fillNone
                            : gauge.tone === 'full'
                              ? `${styles.gaugeFill} ${styles.fillFull}`
                              : gauge.tone === 'warn'
                                ? `${styles.gaugeFill} ${styles.fillWarn}`
                                : `${styles.gaugeFill} ${styles.fillNormal}`
                        const width = gauge.limit
                          ? `${Math.min(100, Math.round((gauge.used / gauge.limit) * 100))}%`
                          : '100%'
                        return (
                          <div className={view.gauge} key={gauge.key}>
                            <div className={styles.gaugeHead}>
                              <span
                                className={`${styles.gaugeName} ${gauge.tone === 'full' ? styles.gaugeFull : ''}`}
                              >
                                {gauge.name}
                                {gauge.tone === 'full' ? ' · at cap' : ''}
                              </span>
                              <span className={styles.gaugeNum}>
                                {gauge.used}
                                <span className={styles.gaugeLimit}>of</span>
                                <input
                                  className={styles.capInput}
                                  inputMode="numeric"
                                  value={draft[gauge.key]}
                                  aria-label={`${tool.label} ${gauge.name.toLowerCase()} cap`}
                                  onChange={(event) => patch(tool.tool_id, { [gauge.key]: event.target.value })}
                                />
                              </span>
                            </div>
                            <div
                              className={styles.gaugeTrack}
                              role="img"
                              aria-label={`${gauge.used} recorded ${gauge.name.toLowerCase()} calls against a cap of ${gauge.limit}`}
                            >
                              <div className={fill} style={{ width }} />
                            </div>
                            {summary?.clears_label && draft.period === 'day' ? (
                              <p className={styles.gaugeFoot}>{summary.clears_label}</p>
                            ) : null}
                          </div>
                        )
                      })}
                    </div> : <div className={credit.creditNotice}>
                      <p className={credit.creditNote}>
                        {creditStatus === 'ready' && pooledCredits
                          ? price ? `Saved price: ${price.cost} credits per action. Price changes are in Credit policy above.` : 'No confirmed action price. Missing pricing is not treated as free.'
                          : 'Capacity is unconfirmed. Independent cap gauges are hidden until the policy can be read.'}
                      </p>
                      <p className={credit.creditHint}>
                        {usageDegraded || !summary
                          ? 'Recorded-call analytics unavailable.'
                          : `Recorded calls / 24h: ${summary.guest_used_24h} guest, ${summary.member_used_24h} signed in. Not credits spent or wallet capacity.`}
                      </p>
                    </div>}

                    <div className={`${styles.cardFoot} ${view.cardFoot}`}>
                      {legacyCaps ? <select
                        className={styles.select}
                        value={draft.period}
                        aria-label={`${tool.label} window`}
                        onChange={(event) =>
                          patch(tool.tool_id, { period: event.target.value === 'week' ? 'week' : 'day' })
                        }
                      >
                        <option value="day">Per day</option>
                        <option value="week">Per week</option>
                      </select> : <span className={credit.creditHint}>Availability only</span>}
                      <div className={styles.cardActions}>
                        {dirty ? <span className={styles.dirtyNote}>Unsaved</span> : null}
                        <button
                          type="button"
                          className={styles.btnIcon}
                          aria-label={`Clear recorded ${tool.label} calls`}
                          title="Clear analytics only; never refund wallet credits"
                          disabled={busy}
                          onClick={() => askReset(tool)}
                        >
                          <BenchIcon className={styles.navIcon} name="trash" />
                        </button>
                        {legacyCaps ? <button
                          type="button"
                          className={`${styles.btn} ${styles.btnPrimary}`}
                          disabled={busy || !dirty}
                          onClick={() => void saveCaps(tool)}
                        >
                          {busy ? 'Saving…' : 'Save'}
                        </button> : null}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          </section>
        ))
      )}

      <ConfirmDialog spec={ask} onCancel={dismissAsk} onConfirm={(value) => void runAsk(value)} />
      <BenchToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
