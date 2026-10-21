'use client'

import { AI_FEATURE_LABELS, AI_FEATURES } from '@/lib/ai/catalog.ts'
import type { AiDriver, AiFeature, FeatureChainView, KeyringStatus, KeyView, ProviderView } from '@/lib/ai/types'
import { useMemo, useRef, useState } from 'react'
import BenchIcon from './BenchIcon'
import { BenchToasts, useBenchToasts } from './BenchToast'
import { ConfirmDialog, type ConfirmSpec } from './ConfirmDialog'
import styles from './bench.module.css'
import ai from './ai/ai.module.css'

const DRIVER_LABELS: Record<AiDriver, string> = {
  openai_compatible: 'OpenAI-compatible',
  gemini_native: 'Google Gemini',
  huggingface: 'Hugging Face',
}

const DRIVER_TILE: Record<AiDriver, string> = {
  openai_compatible: ai.tileOpenai,
  gemini_native: ai.tileGemini,
  huggingface: ai.tileHf,
}

type ProviderDraft = {
  base_url: string
  chat_model: string
  embedding_model: string
  embedding_dim: string
}

type NewProvider = {
  key: string
  label: string
  driver: AiDriver
  base_url: string
  chat_model: string
  embedding_model: string
  embedding_dim: string
  api_key: string
  key_label: string
}

const EMPTY_PROVIDER: NewProvider = {
  key: '',
  label: '',
  driver: 'openai_compatible',
  base_url: '',
  chat_model: '',
  embedding_model: '',
  embedding_dim: '',
  api_key: '',
  key_label: '',
}

/** The message every Test sends, so an operator sees the model actually answer. */
const TEST_PROMPT = 'What is your name?'

type TestResult = {
  status: 'running' | 'ok' | 'fail'
  prompt: string
  answer: string | null
  detail: string | null
  latencyMs: number | null
  model: string | null
  discovered: boolean
}

type Health = { tone: 'ok' | 'warn' | 'bad' | 'idle'; text: string }

const DOT: Record<Health['tone'], string> = {
  ok: ai.dotOk,
  warn: ai.dotWarn,
  bad: ai.dotBad,
  idle: ai.dotIdle,
}

function toDraft(provider: ProviderView): ProviderDraft {
  return {
    base_url: provider.base_url ?? '',
    chat_model: provider.chat_model ?? '',
    embedding_model: provider.embedding_model ?? '',
    embedding_dim: provider.embedding_dim == null ? '' : String(provider.embedding_dim),
  }
}

function keyHealth(key: KeyView): Health {
  const cooldown = key.cooldown_until ? new Date(key.cooldown_until).getTime() : 0
  if (key.cooldown_until && cooldown > Date.now()) {
    return { tone: 'warn', text: `Cooling down until ${new Date(key.cooldown_until).toLocaleTimeString()}` }
  }
  if (key.last_error) return { tone: 'bad', text: key.last_error }
  if (key.last_used_at) return { tone: 'ok', text: `Last used ${new Date(key.last_used_at).toLocaleString()}` }
  return { tone: 'idle', text: 'Never used yet' }
}

function capability(provider: ProviderView, feature: AiFeature): { ok: boolean; label: string } {
  if (feature === 'document_ai_embedding') {
    return { ok: Boolean(provider.embedding_model), label: provider.embedding_model ?? 'no embedding model' }
  }
  return { ok: Boolean(provider.chat_model), label: provider.chat_model ?? 'no chat model' }
}

export default function AiDesk({
  initialProviders,
  initialFeatures,
  canWrite,
  initialEncryption,
  loadError,
}: {
  initialProviders: ProviderView[]
  initialFeatures: FeatureChainView[]
  canWrite: boolean
  initialEncryption: KeyringStatus
  loadError: string
}) {
  const [providers, setProviders] = useState(initialProviders)
  const [encryption, setEncryption] = useState(initialEncryption)
  const [editDrafts, setEditDrafts] = useState<Record<string, ProviderDraft>>(() =>
    Object.fromEntries(initialProviders.map((provider) => [provider.id, toDraft(provider)])),
  )
  const [chainDrafts, setChainDrafts] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(initialFeatures.map((chain) => [chain.feature, chain.provider_ids])),
  )
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, string>>({})
  const [newProvider, setNewProvider] = useState<NewProvider>(EMPTY_PROVIDER)
  const [busy, setBusy] = useState('')
  const [tests, setTests] = useState<Record<string, TestResult>>({})
  const [ask, setAsk] = useState<ConfirmSpec | null>(null)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const pending = useRef<null | ((value: string) => Promise<void>)>(null)
  const { toasts, push, dismiss } = useBenchToasts()

  const byId = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers])

  const summary = useMemo(() => {
    const keys = providers.reduce((total, provider) => total + provider.keys.length, 0)
    const configured = AI_FEATURES.filter((feature) => (chainDrafts[feature] ?? []).length > 0).length
    return { providers: providers.length, keys, configured, features: AI_FEATURES.length }
  }, [providers, chainDrafts])

  const syncFrom = (nextProviders: ProviderView[], nextFeatures: FeatureChainView[]) => {
    setProviders(nextProviders)
    setEditDrafts(Object.fromEntries(nextProviders.map((provider) => [provider.id, toDraft(provider)])))
    setChainDrafts(Object.fromEntries(nextFeatures.map((chain) => [chain.feature, chain.provider_ids])))
    setRevealed((current) => {
      // Drop revealed secrets whose key no longer exists.
      const live = new Set(nextProviders.flatMap((provider) => provider.keys.map((key) => key.id)))
      return Object.fromEntries(Object.entries(current).filter(([id]) => live.has(id)))
    })
  }

  const refresh = async (): Promise<ProviderView[] | null> => {
    const response = await fetch('/api/admin/ai/providers')
    const payload = (await response.json().catch(() => null)) as
      | { providers?: ProviderView[]; features?: FeatureChainView[]; keyring?: KeyringStatus }
      | null
    if (response.ok && payload?.providers) syncFrom(payload.providers, payload.features ?? [])
    if (payload?.keyring) setEncryption(payload.keyring)
    return response.ok ? (payload?.providers ?? null) : null
  }

  const call = async (path: string, method: string, body?: Record<string, unknown>) => {
    const response = await fetch(path, {
      method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    })
    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null
    // A stale desk — a provider or key removed or re-created elsewhere, or a tab
    // rendered against a different database — can target an id that no longer
    // exists. Re-read the bench so the next click uses current ids instead of
    // leaving the operator with an opaque not-found error.
    if (!response.ok && response.status === 404 && method !== 'GET') await refresh()
    return { ok: response.ok, status: response.status, payload }
  }

  const confirm = (spec: ConfirmSpec, action: (value: string) => Promise<void>) => {
    pending.current = action
    setAsk(spec)
  }

  const runConfirm = async (value: string) => {
    const action = pending.current
    setAsk((current) => (current ? { ...current, busy: true } : current))
    try {
      if (action) await action(value)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'That did not go through.')
    } finally {
      pending.current = null
      setAsk(null)
      setBusy('')
    }
  }

  const createProvider = async () => {
    if (!newProvider.key.trim() || !newProvider.label.trim()) {
      push('bad', 'A provider id and label are required.')
      return
    }
    const key = newProvider.api_key.trim()
    setBusy('new-provider')
    try {
      const { ok, payload } = await call('/api/admin/ai/providers', 'POST', {
        key: newProvider.key,
        label: newProvider.label,
        driver: newProvider.driver,
        base_url: newProvider.base_url || null,
        chat_model: newProvider.chat_model || null,
        embedding_model: newProvider.embedding_model || null,
        embedding_dim: newProvider.embedding_dim === '' ? null : Number(newProvider.embedding_dim),
        api_key: key || null,
        key_label: newProvider.key_label.trim() || null,
      })
      if (!ok) throw new Error((payload?.error as string) || 'Could not create the provider')
      setNewProvider(EMPTY_PROVIDER)
      await refresh()
      push('ok', key ? 'Provider and its key saved.' : 'Provider saved — add a key now.')
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not create the provider')
    } finally {
      setBusy('')
    }
  }

  const saveProvider = async (provider: ProviderView) => {
    const draft = editDrafts[provider.id]
    if (!draft) return
    setBusy(`save-${provider.id}`)
    try {
      const { ok, payload } = await call('/api/admin/ai/providers', 'PATCH', {
        id: provider.id,
        base_url: draft.base_url || null,
        chat_model: draft.chat_model || null,
        embedding_model: draft.embedding_model || null,
        embedding_dim: draft.embedding_dim === '' ? null : Number(draft.embedding_dim),
      })
      if (!ok) throw new Error((payload?.error as string) || 'Save failed')
      await refresh()
      push('ok', `${provider.label} saved.`)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Save failed')
    } finally {
      setBusy('')
    }
  }

  const toggleProvider = async (provider: ProviderView, enabled: boolean) => {
    setBusy(`toggle-${provider.id}`)
    try {
      const { ok, payload } = await call('/api/admin/ai/providers', 'PATCH', { id: provider.id, enabled })
      if (!ok) throw new Error((payload?.error as string) || 'The switch did not stick.')
      await refresh()
      push(enabled ? 'ok' : 'info', `${provider.label} is ${enabled ? 'on' : 'off'}.`)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'The switch did not stick.')
    } finally {
      setBusy('')
    }
  }

  const toggleKey = async (key: KeyView, enabled: boolean) => {
    setBusy(key.id)
    try {
      const { ok, payload } = await call('/api/admin/ai/keys', 'PATCH', { id: key.id, enabled })
      if (!ok) throw new Error((payload?.error as string) || 'Could not update the key')
      await refresh()
      push(enabled ? 'ok' : 'info', `Key ${key.masked} is ${enabled ? 'enabled' : 'disabled'}.`)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not update the key')
    } finally {
      setBusy('')
    }
  }

  const clearCooldown = async (provider: ProviderView, key: KeyView) => {
    setBusy(key.id)
    try {
      const { ok, payload } = await call('/api/admin/ai/keys', 'PATCH', { id: key.id, clear_cooldown: true })
      if (!ok) throw new Error((payload?.error as string) || 'Could not clear the cooldown')
      await refresh()
      push('ok', `${provider.label} key back in rotation.`)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not clear the cooldown')
    } finally {
      setBusy('')
    }
  }

  const revealKey = async (key: KeyView) => {
    if (revealed[key.id]) {
      setRevealed((current) => {
        const next = { ...current }
        delete next[key.id]
        return next
      })
      return
    }
    setBusy(`reveal-${key.id}`)
    try {
      const { ok, payload } = await call('/api/admin/ai/keys/reveal', 'POST', { id: key.id })
      if (!ok) {
        const message = (payload?.error as string) || 'Could not reveal the key'
        const ref = typeof payload?.request_id === 'string' ? ` (ref ${payload.request_id})` : ''
        throw new Error(`${message}${ref}`)
      }
      setRevealed((current) => ({ ...current, [key.id]: String(payload?.secret ?? '') }))
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not reveal the key')
    } finally {
      setBusy('')
    }
  }

  const copyKey = async (key: KeyView) => {
    const value = revealed[key.id]
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      push('ok', 'Key copied to the clipboard.')
    } catch {
      push('bad', 'The browser blocked the clipboard. Select the text and copy it manually.')
    }
  }

  const addKey = async (provider: ProviderView) => {
    const secret = (keyDrafts[provider.id] ?? '').trim()
    if (!secret) {
      push('bad', 'Paste a key first.')
      return
    }
    setBusy(`addkey-${provider.id}`)
    try {
      // The id captured in a server-rendered card can be stale if the provider
      // was re-created (same slug, new id). Resolve the current id from a fresh
      // read before saving so the add never depends on a stale id.
      const latest = await refresh()
      const providerId = latest?.find((candidate) => candidate.key === provider.key)?.id ?? provider.id
      const { ok, payload } = await call('/api/admin/ai/keys', 'POST', { provider_id: providerId, secret })
      if (!ok) throw new Error((payload?.error as string) || 'Could not add the key')
      setKeyDrafts((current) => ({ ...current, [provider.id]: '' }))
      await refresh()
      push('ok', `Key added to ${provider.label}.`)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not add the key')
    } finally {
      setBusy('')
    }
  }

  /**
   * Sends {@link TEST_PROMPT} through one provider (optionally one specific key)
   * and keeps the model's reply on screen, so an operator can see the key really
   * works. `targetId` keys the result: a key id for a per-key test, or the
   * provider id for the card-level Test.
   */
  const runTest = async (targetId: string, provider: ProviderView, key?: KeyView) => {
    const prompt = TEST_PROMPT
    const running: TestResult = { status: 'running', prompt, answer: null, detail: null, latencyMs: null, model: null, discovered: false }
    setTests((current) => ({ ...current, [targetId]: running }))
    try {
      const { ok, payload } = await call('/api/admin/ai/test', 'POST', {
        provider_id: provider.id,
        ...(key ? { key_id: key.id } : {}),
        prompt,
      })
      if (!ok) throw new Error((payload?.error as string) || 'The test failed')
      setTests((current) => ({
        ...current,
        [targetId]: {
          status: payload?.ok === true ? 'ok' : 'fail',
          prompt: (payload?.prompt as string) || prompt,
          answer: (payload?.answer as string) ?? null,
          detail: (payload?.detail as string) ?? null,
          latencyMs: typeof payload?.latency_ms === 'number' ? (payload.latency_ms as number) : null,
          model: typeof payload?.model === 'string' ? (payload.model as string) : null,
          discovered: payload?.discovered === true,
        },
      }))
    } catch (error) {
      setTests((current) => ({
        ...current,
        [targetId]: {
          status: 'fail',
          prompt,
          answer: null,
          detail: error instanceof Error ? error.message : 'The test failed',
          latencyMs: null,
          model: null,
          discovered: false,
        },
      }))
    }
  }

  /**
   * Persists a model the probe discovered so production calls use it too. Without
   * this, "just paste a key" would test green but still fail in the product when
   * the saved chat_model was empty or dropped by the free tier.
   */
  const saveModel = async (provider: ProviderView, model: string) => {
    setBusy(`save-${provider.id}`)
    try {
      const { ok, payload } = await call('/api/admin/ai/providers', 'PATCH', { id: provider.id, chat_model: model })
      if (!ok) throw new Error((payload?.error as string) || 'Could not save the model')
      await refresh()
      push('ok', `Chat model set to ${model}.`)
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not save the model')
    } finally {
      setBusy('')
    }
  }

  /**
   * The inline result of a Test: the reply, the model that answered, and, when
   * discovery found a different model, a one-click way to keep it.
   */
  const testResultBox = (targetId: string, provider: ProviderView) => {
    const result = tests[targetId]
    if (!result) return null
    const tone = result.status === 'ok' ? ai.testResultOk : result.status === 'fail' ? ai.testResultFail : ''
    const savedModel = provider.chat_model?.trim() || null
    const canSave = result.status === 'ok' && Boolean(result.model) && result.model !== savedModel
    return (
      <div className={`${ai.testResult} ${tone}`} role="status">
        <div className={ai.testResultHead}>
          <BenchIcon name={result.status === 'ok' ? 'check' : result.status === 'fail' ? 'alert' : 'bolt'} />
          <span className={ai.testPrompt}>“{result.prompt}”</span>
          <span className={ai.testMeta}>
            {result.status === 'running' ? 'Testing…' : result.latencyMs != null ? `${result.latencyMs} ms` : ''}
          </span>
        </div>
        {result.status === 'running' ? (
          <p className={ai.testAnswer}>Sending the message to the provider…</p>
        ) : (
          <p className={ai.testAnswer}>{result.status === 'ok' ? result.answer : result.detail ?? 'The provider did not answer.'}</p>
        )}
        {result.status !== 'running' && result.model ? (
          <div className={ai.testFoot}>
            <span className={ai.testModel}>
              {result.status === 'ok' ? 'Answered by' : 'Tried'} <code>{result.model}</code>
              {result.discovered && result.status === 'ok' ? <span className={ai.testBadge}>auto-picked</span> : null}
            </span>
            {canWrite && canSave ? (
              <button
                type="button"
                className={styles.btn}
                disabled={busy === `save-${provider.id}`}
                onClick={() => void saveModel(provider, result.model as string)}
                title="Save this model on the provider so production calls use it too"
              >
                {busy === `save-${provider.id}` ? 'Saving…' : 'Save model'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
  }

  const applyChain = async (feature: AiFeature, providerIds: string[]) => {
    setBusy(`chain-${feature}`)
    try {
      const { ok, payload } = await call('/api/admin/ai/routes', 'PUT', { feature, provider_ids: providerIds })
      if (!ok) throw new Error((payload?.error as string) || 'Could not save the chain')
      if (payload?.providers) syncFrom(payload.providers as ProviderView[], (payload.features as FeatureChainView[]) ?? [])
      push('ok', 'Chain saved.')
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Could not save the chain')
    } finally {
      setBusy('')
    }
  }

  /** Every capable provider, ordered so enabled+keyed ones answer first. */
  const allProviderIds = (feature: AiFeature) => {
    const capable = providers.filter((provider) => capability(provider, feature).ok)
    const rank = (provider: ProviderView) => (provider.enabled ? 0 : 1) + (provider.keys.length ? 0 : 1)
    return capable
      .sort((a, b) => rank(a) - rank(b) || (a.sort_order - b.sort_order) || a.label.localeCompare(b.label))
      .map((provider) => provider.id)
  }

  const moveChain = (feature: AiFeature, index: number, delta: number) => {
    setChainDrafts((current) => {
      const list = [...(current[feature] ?? [])]
      const target = index + delta
      if (target < 0 || target >= list.length) return current
      const [item] = list.splice(index, 1)
      list.splice(target, 0, item)
      return { ...current, [feature]: list }
    })
  }

  const removeFromChain = (feature: AiFeature, providerId: string) => {
    setChainDrafts((current) => ({ ...current, [feature]: (current[feature] ?? []).filter((id) => id !== providerId) }))
  }

  const addToChain = (feature: AiFeature, providerId: string) => {
    if (!providerId) return
    setChainDrafts((current) => {
      const list = current[feature] ?? []
      if (list.includes(providerId)) return current
      const next = feature === 'document_ai_embedding' ? [providerId] : [...list, providerId]
      return { ...current, [feature]: next }
    })
  }

  const importEnv = async () => {
    setBusy('import')
    try {
      const { ok, payload } = await call('/api/admin/ai/import-env', 'POST', {})
      if (!ok) throw new Error((payload?.error as string) || 'Import failed')
      await refresh()
      push('ok', payload?.created ? `Imported ${payload.created} key(s).` : 'Nothing new to import from the environment.')
    } catch (error) {
      push('bad', error instanceof Error ? error.message : 'Import failed')
    } finally {
      setBusy('')
    }
  }

  const degraded = Boolean(loadError)

  /**
   * The "add a key" form. It sits at the top of the keys section while a
   * provider has none, so a built-in provider can be brought online without
   * hunting for the input; once a key exists it drops to the bottom.
   */
  const addKeyForm = (provider: ProviderView) => (
    <div className={ai.addKey}>
      <label className={ai.addKeyLabel} htmlFor={`newkey-${provider.id}`}>Add a key</label>
      <div className={ai.addKeyRow}>
        <input
          id={`newkey-${provider.id}`}
          className={styles.input}
          type="password"
          autoComplete="off"
          placeholder="Paste the provider key"
          value={keyDrafts[provider.id] ?? ''}
          onChange={(event) => setKeyDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}
        />
        <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy === `addkey-${provider.id}`} onClick={() => void addKey(provider)}>
          {busy === `addkey-${provider.id}` ? 'Adding…' : 'Add key'}
        </button>
      </div>
      <p className={ai.addKeyHint}>Stored encrypted. Only the last four characters are kept for display.</p>
    </div>
  )

  return (
    <div className={`${styles.page} ${ai.aiPage}`}>
      <header className={`${styles.pageHead} ${ai.pageHead}`}>
        <div className={ai.intro}>
          <p className={styles.pageEyebrow}>AI Providers</p>
          <h1 className={`${styles.pageTitle} ${ai.pageTitle}`}>AI provider routing</h1>
          <p className={`${styles.pageLead} ${ai.pageLead}`}>
            Choose providers for each feature and set their fallback order. Keys stay encrypted; unset chains use environment keys.
          </p>
        </div>
        {canWrite ? (
          <div className={styles.pageActions}>
            <button
              type="button"
              className={`${styles.btn} ${ai.iconBtn} ${ai.importButton}`}
              disabled={busy === 'import'}
              onClick={() => void importEnv()}
              title="Copy GROQ_API_KEY and HF_TOKEN from this server's environment into the bench"
            >
              <BenchIcon className={styles.navIcon} name="import" />
              <span>{busy === 'import' ? 'Importing…' : 'Import from env'}</span>
            </button>
          </div>
        ) : null}
      </header>

      {degraded ? (
        <div className={`${styles.degraded} ${ai.alert}`} role="status">
          <BenchIcon className={styles.toastIcon} name="alert" />
          <div>
            <p className={styles.degradedTitle}>The AI store is not readable.</p>
            <p className={styles.degradedBody}>
              {loadError} Set <code>DATABASE_URL</code>, run the AI migration, then reload. Until then the AI
              tools use the environment keys.
            </p>
          </div>
        </div>
      ) : null}

      {!encryption.ready && canWrite ? (
        <div className={`${styles.degraded} ${ai.alert}`} role="status">
          <BenchIcon className={styles.toastIcon} name="alert" />
          <div>
            <p className={styles.degradedTitle}>{encryption.locked ? 'Provider keys are locked.' : 'Provider keys cannot be read.'}</p>
            <p className={styles.degradedBody}>
              {encryption.message}
              {encryption.locked
                ? ' Restore AI_KEY_ENCRYPTION_SECRET to its original value, or re-add each provider key with Rotate.'
                : ''}
            </p>
          </div>
        </div>
      ) : null}

      <section className={`${styles.stats} ${ai.stats}`} aria-label="AI provider status">
        <div className={`${styles.stat} ${ai.statCard}`}>
          <p className={styles.statLabel}>Providers</p>
          <p className={styles.statValue}>
            {summary.providers}
            <span className={styles.statSub}>{summary.keys} key{summary.keys === 1 ? '' : 's'}</span>
          </p>
        </div>
        <div className={`${styles.stat} ${ai.statCard}`}>
          <p className={styles.statLabel}>Chains set</p>
          <p className={styles.statValue}>
            {summary.configured}
            <span className={styles.statSub}>of {summary.features} features</span>
          </p>
        </div>
        <div className={`${styles.stat} ${ai.statCard} ${encryption.ready ? '' : styles.statAlert}`}>
          <p className={styles.statLabel}>Encryption</p>
          <p className={styles.statValue}>
            {encryption.ready ? (encryption.mode === 'kek' ? 'Wrapped' : 'Portable') : 'Locked'}
            <span className={styles.statSub}>
              {encryption.ready
                ? encryption.mode === 'kek'
                  ? 'data key wrapped by the env secret'
                  : 'data key stored with the database'
                : 'keys cannot be decrypted'}
            </span>
          </p>
        </div>
      </section>

      <section className={`${styles.panel} ${styles.panelPad} ${ai.providerPanel}`}>
        <div className={`${styles.panelHead} ${ai.providerPanelHead}`}>
          <div className={ai.panelHeadText}>
            <h2 className={styles.panelTitle}>Providers and keys</h2>
            <p className={styles.panelNote}>Verify model support and credentials before routing traffic.</p>
          </div>
          <div className={ai.panelCounts}>
            <span className={ai.panelCount}>
              <strong>{summary.providers}</strong> providers
            </span>
            <span className={ai.panelCount}>
              <strong>{summary.keys}</strong> keys
            </span>
          </div>
        </div>

        {providers.length === 0 ? (
          <div className={styles.empty}>
            <h3 className={styles.emptyTitle}>No providers on the bench.</h3>
            <p className={styles.emptyBody}>
              {canWrite ? 'Add a custom provider below, or import the environment keys.' : 'An Owner can add one.'}
            </p>
          </div>
        ) : (
          <div className={ai.providerGrid}>
            {providers.map((provider) => {
              const draft = editDrafts[provider.id] ?? toDraft(provider)
              const providerBusy = busy === provider.id
              const chatReady = provider.usable_chat
              const embedReady = provider.usable_embedding
              const driverLabel = DRIVER_LABELS[provider.driver]
              // "Google Gemini" is both the label and the driver, so the meta row
              // would read it twice. Show the driver only when it adds information.
              const showDriver = driverLabel.toLowerCase() !== provider.label.toLowerCase()
              const open = expanded[provider.id] ?? false
              return (
                <article className={`${styles.card} ${ai.providerCard} ${provider.enabled ? '' : ai.cardDim}`} key={provider.id}>
                  <div className={`${styles.cardHead} ${ai.providerCardHead}`}>
                    <div className={ai.providerHead}>
                      <span className={`${ai.providerTile} ${DRIVER_TILE[provider.driver]}`} aria-hidden="true">
                        <BenchIcon name="ai" />
                      </span>
                      <div className={ai.providerId}>
                        <h3 className={ai.providerTitle}>{provider.label}</h3>
                        <div className={ai.providerMetaRow}>
                          <code className={ai.slug}>{provider.key}</code>
                          {showDriver ? (
                            <>
                              <span className={ai.metaDot} aria-hidden="true">·</span>
                              <span>{driverLabel}</span>
                            </>
                          ) : null}
                          <span className={ai.metaDot} aria-hidden="true">·</span>
                          <span className={`${ai.tag} ${provider.is_custom ? ai.tagCustom : ''}`}>
                            {provider.is_custom ? 'Custom' : 'Built-in'}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className={styles.cardSide}>
                      {canWrite ? (
                        <button
                          type="button"
                          role="switch"
                          aria-checked={provider.enabled}
                          aria-label={`${provider.label} is ${provider.enabled ? 'on' : 'off'}`}
                          className={`${styles.switch} ${provider.enabled ? styles.switchOn : ''}`}
                          disabled={providerBusy}
                          onClick={() => void toggleProvider(provider, !provider.enabled)}
                        >
                          <span className={styles.switchTrack} aria-hidden="true">
                            <span className={styles.switchThumb} />
                          </span>
                          <span className={styles.switchLabel}>{provider.enabled ? 'On' : 'Off'}</span>
                        </button>
                      ) : (
                        <span className={`${styles.chip} ${provider.enabled ? styles.chipOn : styles.chipOff}`}>
                          {provider.enabled ? 'On' : 'Off'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className={ai.body}>
                    <div className={ai.caps} aria-label="Capabilities">
                      <span className={`${ai.cap} ${chatReady ? ai.capOn : ai.capOff}`}>
                        <span className={`${ai.dot} ${chatReady ? ai.dotOk : ai.dotIdle}`} aria-hidden="true" />
                        <span className={ai.capKind}>Chat</span>
                        <span className={ai.capLabel}>{provider.chat_model ?? 'not set'}</span>
                      </span>
                      <span className={`${ai.cap} ${embedReady ? ai.capOn : ai.capOff}`}>
                        <span className={`${ai.dot} ${embedReady ? ai.dotOk : ai.dotIdle}`} aria-hidden="true" />
                        <span className={ai.capKind}>Embeddings</span>
                        <span className={ai.capLabel}>{provider.embedding_model ?? 'not set'}</span>
                      </span>
                    </div>

                    <button
                      type="button"
                      className={ai.revealToggle}
                      aria-expanded={open}
                      aria-controls={`provider-more-${provider.id}`}
                      onClick={() => setExpanded((current) => ({ ...current, [provider.id]: !current[provider.id] }))}
                    >
                      <BenchIcon name="next" />
                      <span>{open ? 'Hide keys and settings' : 'Show keys and settings'}</span>
                    </button>

                    {open ? (
                    <div className={ai.bodyRest} id={`provider-more-${provider.id}`}>
                    {canWrite ? (
                      <details className={`${ai.advanced} ${ai.modelSettings}`}>
                        <summary>
                          <BenchIcon name="next" />
                          Edit models and base URL
                        </summary>
                        <div className={ai.grid2}>
                          <div className={styles.field}>
                            <label className={styles.fieldLabel} htmlFor={`base-${provider.id}`}>Base URL</label>
                            <input
                              id={`base-${provider.id}`}
                              className={styles.input}
                              value={draft.base_url}
                              onChange={(event) => setEditDrafts((current) => ({ ...current, [provider.id]: { ...draft, base_url: event.target.value } }))}
                            />
                          </div>
                          <div className={styles.field}>
                            <label className={styles.fieldLabel} htmlFor={`chat-${provider.id}`}>Chat model</label>
                            <input
                              id={`chat-${provider.id}`}
                              className={styles.input}
                              value={draft.chat_model}
                              onChange={(event) => setEditDrafts((current) => ({ ...current, [provider.id]: { ...draft, chat_model: event.target.value } }))}
                            />
                          </div>
                          <div className={styles.field}>
                            <label className={styles.fieldLabel} htmlFor={`embed-${provider.id}`}>Embedding model</label>
                            <input
                              id={`embed-${provider.id}`}
                              className={styles.input}
                              value={draft.embedding_model}
                              onChange={(event) => setEditDrafts((current) => ({ ...current, [provider.id]: { ...draft, embedding_model: event.target.value } }))}
                            />
                          </div>
                          <div className={styles.field}>
                            <label className={styles.fieldLabel} htmlFor={`dim-${provider.id}`}>Embedding dim</label>
                            <input
                              id={`dim-${provider.id}`}
                              className={styles.input}
                              inputMode="numeric"
                              value={draft.embedding_dim}
                              onChange={(event) => setEditDrafts((current) => ({ ...current, [provider.id]: { ...draft, embedding_dim: event.target.value } }))}
                            />
                            <p className={styles.fieldHint}>Changing this re-embeds uploaded documents.</p>
                          </div>
                        </div>
                        <div className={ai.actions}>
                          <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy === `save-${provider.id}`} onClick={() => void saveProvider(provider)}>
                            {busy === `save-${provider.id}` ? 'Saving…' : 'Save models'}
                          </button>
                        </div>
                      </details>
                    ) : (
                      <div className={ai.hint}>
                        <BenchIcon name="info" />
                        <span>
                          {provider.base_url ?? 'No base URL'} · {provider.chat_model ?? 'no chat model'} ·{' '}
                          {provider.embedding_model ? `${provider.embedding_model} (${provider.embedding_dim ?? '?'}d)` : 'no embedding model'}
                        </span>
                      </div>
                    )}

                    <div className={ai.section}>
                      <div className={ai.sectionHead}>
                        <span className={ai.sectionLabel}>
                          <BenchIcon name="key" />
                          Keys
                        </span>
                        <span className={ai.sectionNote}>
                          {provider.keys.length === 0
                            ? 'none yet'
                            : `${provider.keys.length} on file${provider.keys.some((key) => !key.enabled) ? ' · some off' : ''}`}
                        </span>
                      </div>

                      {provider.keys.length === 0 ? (
                        <>
                          {canWrite ? addKeyForm(provider) : null}
                          <div className={ai.hint}>
                            <BenchIcon name="info" />
                            <span>
                              {canWrite
                                ? 'No key yet — a provider without a key is skipped in every chain.'
                                : 'No key yet. An Owner can add one.'}
                            </span>
                          </div>
                        </>
                      ) : (
                        <div className={ai.keyList}>
                              {provider.keys.map((key) => {
                                const health = keyHealth(key)
                                const cooling = health.tone === 'warn'
                                const secret = revealed[key.id]
                                return (
                                  <div className={ai.keyBlock} key={key.id}>
                                  <div className={ai.keyItem}>
                                      {secret ? (
                                        <div className={ai.secretBox}>
                                          <span className={ai.secretText}>{secret}</span>
                                          <div className={ai.secretActions}>
                                            <button type="button" className={styles.btnIcon} aria-label="Copy key" onClick={() => void copyKey(key)}>
                                              <BenchIcon className={styles.navIcon} name="check" />
                                            </button>
                                            <button type="button" className={styles.btnIcon} aria-label="Hide key" onClick={() => void revealKey(key)}>
                                              <BenchIcon className={styles.navIcon} name="close" />
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <div className={ai.keyMain}>
                                          <span className={`${ai.dot} ${DOT[health.tone]}`} aria-hidden="true" />
                                          <div className={ai.keyBody}>
                                            <div className={ai.keyValueRow}>
                                              <span className={ai.keyValue}>{key.masked}</span>
                                              {key.label ? <span className={ai.keyTag}>{key.label}</span> : null}
                                            </div>
                                            <span className={ai.health}>{health.text}</span>
                                          </div>
                                        </div>
                                      )}
                                      <div className={ai.keyItemActions}>
                                        {canWrite ? (
                                          <button
                                            type="button"
                                            className={`${styles.btn} ${ai.iconBtn}`}
                                            disabled={tests[key.id]?.status === 'running'}
                                            title={`Send “${TEST_PROMPT}” through this key`}
                                            onClick={() => void runTest(key.id, provider, key)}
                                          >
                                            <BenchIcon className={styles.navIcon} name="bolt" />
                                            <span>{tests[key.id]?.status === 'running' ? 'Testing…' : 'Test'}</span>
                                          </button>
                                        ) : null}
                                        {cooling && canWrite ? (
                                          <button type="button" className={styles.btn} disabled={busy === key.id} onClick={() => void clearCooldown(provider, key)}>
                                            Reactivate
                                          </button>
                                        ) : null}
                                        {canWrite ? (
                                          <button type="button" className={styles.btn} disabled={busy === `reveal-${key.id}`} onClick={() => void revealKey(key)}>
                                            {secret ? 'Hide' : 'Reveal'}
                                          </button>
                                        ) : null}
                                        {canWrite ? (
                                          <button
                                            type="button"
                                            role="switch"
                                            aria-checked={key.enabled}
                                            aria-label={`Key ${key.masked} is ${key.enabled ? 'enabled' : 'disabled'}`}
                                            className={`${styles.switch} ${key.enabled ? styles.switchOn : ''}`}
                                            disabled={busy === key.id}
                                            onClick={() => void toggleKey(key, !key.enabled)}
                                          >
                                            <span className={styles.switchTrack} aria-hidden="true">
                                              <span className={styles.switchThumb} />
                                            </span>
                                            <span className={styles.switchLabel}>{key.enabled ? 'On' : 'Off'}</span>
                                          </button>
                                        ) : (
                                          <span className={`${styles.badge} ${key.enabled ? styles.badgeOn : styles.badgeOff}`}>
                                            {key.enabled ? 'Enabled' : 'Disabled'}
                                          </span>
                                        )}
                                        {canWrite ? (
                                          <button
                                            type="button"
                                            className={styles.btn}
                                            onClick={() =>
                                              confirm(
                                                {
                                                  eyebrow: 'Rotate key',
                                                  title: `Replace the key ending ${key.last4 ?? '····'}?`,
                                                  body: 'The new key takes effect immediately. The old value is discarded.',
                                                  facts: [{ label: 'Provider', value: provider.label }],
                                                  input: { label: 'New key', placeholder: 'Paste the new key', secret: true },
                                                  cancelLabel: 'Keep the old key',
                                                  confirmLabel: 'Rotate',
                                                  tone: 'accent',
                                                },
                                                async (secret) => {
                                                  const { ok, payload } = await call('/api/admin/ai/keys', 'PATCH', { id: key.id, secret: secret.trim() })
                                                  if (!ok) throw new Error((payload?.error as string) || 'Could not rotate the key')
                                                  await refresh()
                                                  push('ok', 'Key rotated.')
                                                },
                                              )
                                            }
                                          >
                                            Rotate
                                          </button>
                                        ) : null}
                                        {canWrite ? (
                                          <button
                                            type="button"
                                            className={styles.btnIcon}
                                            aria-label={`Remove the key ending ${key.last4 ?? '····'}`}
                                            disabled={providerBusy}
                                            onClick={() =>
                                              confirm(
                                                {
                                                  eyebrow: 'Remove key',
                                                  title: `Remove the key ending ${key.last4 ?? '····'}?`,
                                                  body: 'The provider keeps working only while another key or the environment fallback exists.',
                                                  cancelLabel: 'Keep it',
                                                  confirmLabel: 'Remove',
                                                  tone: 'danger',
                                                },
                                                async () => {
                                                  const { ok, payload } = await call('/api/admin/ai/keys', 'DELETE', { id: key.id })
                                                  if (!ok) throw new Error((payload?.error as string) || 'Could not remove the key')
                                                  await refresh()
                                                  push('ok', 'Key removed.')
                                                },
                                              )
                                            }
                                          >
                                            <BenchIcon className={styles.navIcon} name="trash" />
                                          </button>
                                        ) : null}
                                      </div>
                                  </div>
                                  {canWrite ? testResultBox(key.id, provider) : null}
                                  </div>
                                )
                              })}
                        </div>
                      )}

                      {canWrite && provider.keys.length > 0 ? addKeyForm(provider) : null}
                    </div>

                    <div className={ai.foot}>
                      <span className={ai.hint}>
                        <BenchIcon name="info" />
                        <span>
                          {provider.keys.length === 0
                            ? 'No key yet — this provider is skipped in every chain until one is added.'
                            : 'Keys are tried least-recently-used; a rate limit parks one and the next answers.'}
                        </span>
                      </span>
                      <div className={`${styles.cardActions} ${ai.footerActions}`}>
                        <button
                          type="button"
                          className={`${styles.btn} ${ai.iconBtn}`}
                          disabled={tests[provider.id]?.status === 'running' || provider.keys.length === 0}
                          title={`Send “${TEST_PROMPT}” through the first enabled key`}
                          onClick={() => void runTest(provider.id, provider)}
                        >
                          <BenchIcon className={styles.navIcon} name="bolt" />
                          <span>{tests[provider.id]?.status === 'running' ? 'Testing…' : 'Test'}</span>
                        </button>
                        {canWrite && provider.is_custom ? (
                          <button
                            type="button"
                            className={`${styles.btn} ${styles.btnDanger}`}
                            disabled={providerBusy}
                            onClick={() =>
                              confirm(
                                {
                                  eyebrow: 'Remove provider',
                                  title: `Remove ${provider.label}?`,
                                  body: 'Its keys and its place in every feature chain are removed. This cannot be undone.',
                                  cancelLabel: 'Keep it',
                                  confirmLabel: 'Remove',
                                  tone: 'danger',
                                },
                                async () => {
                                  const { ok, payload } = await call('/api/admin/ai/providers', 'DELETE', { id: provider.id, force: true })
                                  if (!ok) throw new Error((payload?.error as string) || 'Could not remove the provider')
                                  await refresh()
                                  push('ok', `${provider.label} removed.`)
                                },
                              )
                            }
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {canWrite ? testResultBox(provider.id, provider) : null}
                    </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        )}

        {canWrite ? (
          <details className={`${ai.advanced} ${ai.customProvider}`}>
            <summary>
              <BenchIcon name="next" />
              Add a custom provider
            </summary>
            <div className={ai.grid2}>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="new-key">Provider id</label>
                <input id="new-key" className={styles.input} value={newProvider.key} onChange={(event) => setNewProvider((current) => ({ ...current, key: event.target.value }))} placeholder="acme" />
                <p className={styles.fieldHint}>A short internal slug, e.g. acme.</p>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="new-label">Label</label>
                <input id="new-label" className={styles.input} value={newProvider.label} onChange={(event) => setNewProvider((current) => ({ ...current, label: event.target.value }))} placeholder="Acme AI" />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="new-driver">Driver</label>
                <select id="new-driver" className={styles.select} value={newProvider.driver} onChange={(event) => setNewProvider((current) => ({ ...current, driver: event.target.value as AiDriver }))}>
                  <option value="openai_compatible">OpenAI-compatible</option>
                  <option value="gemini_native">Google Gemini</option>
                  <option value="huggingface">Hugging Face router</option>
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="new-base">Base URL</label>
                <input id="new-base" className={styles.input} value={newProvider.base_url} onChange={(event) => setNewProvider((current) => ({ ...current, base_url: event.target.value }))} placeholder="https://api.example.com/v1" />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="new-chat">Chat model</label>
                <input id="new-chat" className={styles.input} value={newProvider.chat_model} onChange={(event) => setNewProvider((current) => ({ ...current, chat_model: event.target.value }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="new-embed">Embedding model</label>
                <input id="new-embed" className={styles.input} value={newProvider.embedding_model} onChange={(event) => setNewProvider((current) => ({ ...current, embedding_model: event.target.value }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="new-dim">Embedding dim</label>
                <input id="new-dim" className={styles.input} inputMode="numeric" value={newProvider.embedding_dim} onChange={(event) => setNewProvider((current) => ({ ...current, embedding_dim: event.target.value }))} />
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="new-apikey">API key (optional)</label>
                <input
                  id="new-apikey"
                  className={styles.input}
                  type="password"
                  autoComplete="off"
                  value={newProvider.api_key}
                  onChange={(event) => setNewProvider((current) => ({ ...current, api_key: event.target.value }))}
                  placeholder="Paste the provider key"
                />
                <p className={styles.fieldHint}>Saved encrypted in this same step. Without a key the provider is skipped in every chain.</p>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel} htmlFor="new-keylabel">Key name (optional)</label>
                <input
                  id="new-keylabel"
                  className={styles.input}
                  value={newProvider.key_label}
                  onChange={(event) => setNewProvider((current) => ({ ...current, key_label: event.target.value }))}
                  placeholder="Primary key"
                />
              </div>
            </div>
            <div className={ai.actions}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy === 'new-provider'} onClick={() => void createProvider()}>
                {busy === 'new-provider' ? 'Adding…' : 'Add provider'}
              </button>
            </div>
          </details>
        ) : null}
      </section>

      <section className={`${styles.panel} ${styles.panelPad} ${ai.featurePanel}`}>
        <div className={`${styles.panelHead} ${ai.featurePanelHead}`}>
          <h2 className={styles.panelTitle}>Feature chains</h2>
          <p className={styles.panelNote}>Top to bottom · automatic fallback on failure</p>
        </div>
        <div className={ai.chainGrid}>
          {AI_FEATURES.map((feature) => {
            const list = chainDrafts[feature] ?? []
            const available = providers.filter((provider) => !list.includes(provider.id))
            const capableCount = providers.filter((provider) => capability(provider, feature).ok).length
            const single = feature === 'document_ai_embedding'
            return (
              <article className={`${styles.card} ${ai.chainCard}`} key={feature}>
                <div className={ai.sectionHead}>
                  <span className={ai.stepName}>{AI_FEATURE_LABELS[feature]}</span>
                  {canWrite ? (
                    <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy === `chain-${feature}`} onClick={() => void applyChain(feature, list)}>
                      {busy === `chain-${feature}` ? 'Saving…' : 'Save chain'}
                    </button>
                  ) : null}
                </div>
                <span className={ai.providerMeta}>{feature}</span>

                {list.length === 0 ? (
                  <div className={ai.hint}>
                    <BenchIcon name="info" />
                    <span>Empty — this feature uses the environment fallback until a provider is added.</span>
                  </div>
                ) : (
                  <div className={ai.steps}>
                    {list.map((providerId, index) => {
                      const provider = byId.get(providerId)
                      return (
                        <div key={providerId}>
                          {index > 0 ? <div className={ai.arrow} aria-hidden="true">↓ automatic fallback</div> : null}
                          <div className={`${ai.step} ${provider && !provider.enabled ? ai.stepOff : ''}`}>
                            <span className={ai.stepIndex} aria-hidden="true">{index + 1}</span>
                            <div className={ai.stepBody}>
                              <span className={ai.stepName}>{provider?.label ?? providerId}</span>
                              <span className={ai.stepMeta}>
                                {provider ? DRIVER_LABELS[provider.driver] : 'Unknown provider'}
                                {provider && !provider.enabled ? ' · off' : ''}
                                {provider && !provider.keys.length ? ' · no key' : ''}
                              </span>
                            </div>
                            {canWrite ? (
                              <div className={ai.keyActions}>
                                <button type="button" className={styles.btnIcon} aria-label="Move up" disabled={index === 0} onClick={() => moveChain(feature, index, -1)}>
                                  <BenchIcon className={styles.navIcon} name="prev" />
                                </button>
                                <button type="button" className={styles.btnIcon} aria-label="Move down" disabled={index === list.length - 1} onClick={() => moveChain(feature, index, 1)}>
                                  <BenchIcon className={styles.navIcon} name="next" />
                                </button>
                                <button type="button" className={styles.btnIcon} aria-label={`Remove ${provider?.label ?? providerId} from the chain`} onClick={() => removeFromChain(feature, providerId)}>
                                  <BenchIcon className={styles.navIcon} name="close" />
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {canWrite ? (
                  <div className={ai.chainTools}>
                    <div className={styles.field}>
                      <label className={styles.fieldLabel} htmlFor={`add-${feature}`}>
                        {single ? 'Set the embedding provider' : 'Add a provider'}
                      </label>
                      <select id={`add-${feature}`} className={styles.select} value="" onChange={(event) => addToChain(feature, event.target.value)}>
                        <option value="">{available.length ? 'Choose a provider…' : 'All providers are already in the chain'}</option>
                        {available.map((provider) => {
                          const cap = capability(provider, feature)
                          return (
                            <option key={provider.id} value={provider.id}>
                              {provider.label} · {cap.label}
                            </option>
                          )
                        })}
                      </select>
                      <p className={styles.fieldHint}>
                        {single
                          ? 'Adding replaces the current embedding provider — embeddings use one model.'
                          : `Unsaved changes show until you save. ${capableCount} provider${capableCount === 1 ? '' : 's'} can serve this feature.`}
                      </p>
                    </div>
                    {!single ? (
                      <button
                        type="button"
                        className={styles.btn}
                        disabled={busy === `chain-${feature}` || capableCount === 0}
                        onClick={() => void applyChain(feature, allProviderIds(feature))}
                        title="Put every capable provider in the chain so a rate limit falls through to the next"
                      >
                        Add all
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      </section>

      <ConfirmDialog spec={ask} onCancel={() => { pending.current = null; setAsk(null) }} onConfirm={(value) => void runConfirm(value)} />
      <BenchToasts toasts={toasts} onDismiss={dismiss} />
    </div>
  )
}
