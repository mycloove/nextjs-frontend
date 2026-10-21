'use client'

import type {
  GithubCapabilities,
  GithubConnectionView,
  GithubFileCheckResponse,
  GithubFileResponse,
  GithubRepoFileEntry,
  GithubRepoOption,
  GithubReposResponse,
  GithubStatusResponse,
  GithubTreeResponse,
  GithubWriteMode,
  GithubWriteResponse,
} from '@/lib/integrations/types'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The Connections state machine for the GitHub provider.
 *
 * Plans the honest sequence `disconnected → connecting → choosing → connected`
 * (with `needs-reauth` and `error` as explicit resting states) and is the only
 * place the section talks to the network. It uses plain `fetch` with
 * `credentials: 'include'` because this is an account surface, like
 * `/api/profile` — **not** the converter `toolRequest` path (CLAUDE.md §5).
 *
 * Deliberate honesty choices:
 *  - the install runs in a new tab (GitHub owns that page), so the hook re-reads
 *    status on window focus instead of polling — a real event, not a timer;
 *  - `capabilities` comes from GitHub, so the write surface is refused rather
 *    than merely failing;
 *  - a publish is never reported as done except from GitHub's own commit/PR
 *    response, and a stale-branch conflict is surfaced, not retried blindly.
 */

export type GithubPhase =
  | 'loading'
  | 'soon'
  | 'disconnected'
  | 'connecting'
  | 'choosing'
  | 'connected'
  | 'needs-reauth'
  | 'error'

type ApiResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; message: string; code: string | null }

type ListState<T> = { status: 'loading' | 'ready' | 'error'; items: T[]; truncated: boolean; branch: string }

async function api<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, { credentials: 'include', cache: 'no-store', ...init })
    if (response.status === 204) return { ok: true, status: 204, body: undefined as T }
    const text = await response.text()
    const body = text ? (JSON.parse(text) as unknown) : null
    if (!response.ok) {
      const record = (body ?? {}) as { error?: unknown; code?: unknown }
      return {
        ok: false,
        status: response.status,
        message: typeof record.error === 'string' ? record.error : `Request failed (HTTP ${response.status}).`,
        code: typeof record.code === 'string' ? record.code : null,
      }
    }
    return { ok: true, status: response.status, body: body as T }
  } catch {
    return { ok: false, status: 0, message: 'The network request did not complete. Check your connection and try again.', code: 'network' }
  }
}

export type PublishInput = {
  repoFullName: string
  path: string
  content: string
  message: string
  branch: string
  mode: GithubWriteMode
}

/**
 * The last remote check, tagged with the file it was run for. Tagging matters:
 * the result is only meaningful for the exact path/branch/sha it was requested
 * with, so a stale answer for another file is never shown against this one.
 */
export type RemoteCheck = {
  path: string
  branch: string
  baselineSha: string | null
  liveSha: string | null
  changed: boolean
  checkedAt: string
}

export type GithubConnectionHook = {
  phase: GithubPhase
  configured: boolean
  appSlug: string | null
  connection: GithubConnectionView | null
  capabilities: GithubCapabilities
  repositories: GithubRepoOption[]
  repositoriesTruncated: boolean
  loadingRepos: boolean
  proof: GithubFileResponse | null
  verifying: boolean
  busy: boolean
  files: GithubRepoFileEntry[]
  filesTruncated: boolean
  loadingFiles: boolean
  openFile: GithubFileResponse | null
  opening: boolean
  publishing: boolean
  publishResult: GithubWriteResponse | null
  publishError: string | null
  publishConflict: boolean
  /** Result of the last remote check, or null when none has run. */
  remoteCheck: RemoteCheck | null
  checkingRemote: boolean
  /** Honest, human-readable note for the current phase or last error. */
  note: string | null
  connect(): void
  reloadRepos(): void
  chooseRepo(repo: GithubRepoOption, path?: string): void
  /** Return to the picker without dropping the connection. */
  changeRepo(): void
  verify(path?: string): void
  disconnect(): void
  refresh(): void
  reloadFiles(): void
  readFile(path: string): void
  /** Read a file's full body without opening it in the panel (for re-read). */
  pullFile(path: string): Promise<GithubFileResponse | null>
  closeFile(): void
  publish(input: PublishInput): void
  clearPublish(): void
  /** Ask GitHub whether the file has moved since `sha`; metadata only. */
  checkRemote(input: { path: string; branch: string; sha: string | null }): void
  clearRemoteCheck(): void
}

const NO_CAPABILITIES: GithubCapabilities = { read: false, write: false }

function phaseFor(configured: boolean, connection: GithubConnectionView | null): GithubPhase {
  if (!configured) return 'soon'
  if (!connection) return 'disconnected'
  if (connection.status !== 'connected') return 'needs-reauth'
  return connection.repo ? 'connected' : 'choosing'
}

function noteForCallback(status: string | null): string | null {
  switch (status) {
    case 'connected':
      return 'GitHub is connected. Choose the one repository Mr. Markdown may read from.'
    case 'pending':
      return 'The installation is waiting for an organization owner to approve it. It will appear here once approved.'
    case 'denied':
      return 'The connect request was not verified. Start again from the Connect button.'
    case 'config-missing':
      return 'GitHub is not configured on this server yet.'
    case 'error':
      return 'The connect did not complete at GitHub. Nothing was linked — try again.'
    default:
      return null
  }
}

/** Removes the one-shot `?github=` marker so a later console open is quiet. */
function stripGithubParam() {
  if (typeof window === 'undefined') return
  const params = new URLSearchParams(window.location.search)
  if (!params.has('github')) return
  params.delete('github')
  const query = params.toString()
  window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
}

export function useGithubConnection(opts: { enabled: boolean; onPublished?: (result: GithubWriteResponse) => void }): GithubConnectionHook {
  const [phase, setPhase] = useState<GithubPhase>('loading')
  const [configured, setConfigured] = useState(false)
  const [appSlug, setAppSlug] = useState<string | null>(null)
  const [connection, setConnection] = useState<GithubConnectionView | null>(null)
  const [capabilities, setCapabilities] = useState<GithubCapabilities>(NO_CAPABILITIES)
  const [repos, setRepos] = useState<ListState<GithubRepoOption>>({ status: 'loading', items: [], truncated: false, branch: '' })
  const [tree, setTree] = useState<ListState<GithubRepoFileEntry>>({ status: 'loading', items: [], truncated: false, branch: '' })
  const [openFile, setOpenFile] = useState<GithubFileResponse | null>(null)
  const [opening, setOpening] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [publishResult, setPublishResult] = useState<GithubWriteResponse | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishConflict, setPublishConflict] = useState(false)
  const [remoteCheck, setRemoteCheck] = useState<RemoteCheck | null>(null)
  const [checkingRemote, setCheckingRemote] = useState(false)
  const [proof, setProof] = useState<GithubFileResponse | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [statusNonce, setStatusNonce] = useState(0)
  const [reposNonce, setReposNonce] = useState(0)
  const [treeNonce, setTreeNonce] = useState(0)
  const aliveRef = useRef(true)
  const callbackRef = useRef<string | null>(null)
  // Kept in a ref so a caller's fresh closure is used without re-creating the
  // publish callback (and so it can never re-run an effect via identity change).
  // Synced in an effect, never during render.
  const onPublishedRef = useRef(opts.onPublished)
  useEffect(() => {
    onPublishedRef.current = opts.onPublished
  }, [opts.onPublished])

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  const verify = useCallback((path?: string) => {
    setVerifying(true)
    const query = new URLSearchParams()
    if (path) query.set('path', path)
    const suffix = query.toString() ? `?${query}` : ''
    api<GithubFileResponse>(`/api/integrations/github/file${suffix}`).then((result) => {
      if (!aliveRef.current) return
      setVerifying(false)
      if (!result.ok) {
        setNote(result.message)
        if (result.code === 'github_unauthorized' || result.code === 'github_forbidden') setPhase('needs-reauth')
        return
      }
      setProof(result.body)
      setNote(null)
    })
  }, [])

  // Status read. Runs on mount, on explicit refresh, and on window focus — the
  // real signal that the owner came back from the GitHub tab.
  useEffect(() => {
    if (!opts.enabled) return
    if (typeof window !== 'undefined') callbackRef.current = new URLSearchParams(window.location.search).get('github')
    let alive = true
    api<GithubStatusResponse>('/api/integrations/github/connection').then((result) => {
      if (!alive) return
      if (!result.ok) {
        setPhase('error')
        setNote(result.message)
        return
      }
      const body = result.body
      setConfigured(body.configured)
      setAppSlug(body.app_slug)
      setConnection(body.connection)
      setCapabilities(body.capabilities ?? NO_CAPABILITIES)
      setPhase(phaseFor(body.configured, body.connection))
      if (callbackRef.current) {
        setNote(noteForCallback(callbackRef.current))
        callbackRef.current = null
        stripGithubParam()
      }
      if (body.configured && body.connection?.status === 'connected' && body.connection.repo) verify()
    })
    return () => { alive = false }
  }, [opts.enabled, statusNonce, verify])

  useEffect(() => {
    if (!opts.enabled || typeof window === 'undefined') return
    const onFocus = () => setStatusNonce((value) => value + 1)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [opts.enabled])

  // Repository list, loaded whenever the picker is the active state.
  useEffect(() => {
    if (phase !== 'choosing') return
    let alive = true
    api<GithubReposResponse>('/api/integrations/github/repos').then((result) => {
      if (!alive) return
      if (!result.ok) {
        setRepos({ status: 'error', items: [], truncated: false, branch: '' })
        setNote(result.message)
        if (result.code === 'not_connected') setPhase('disconnected')
        if (result.code === 'github_unauthorized' || result.code === 'github_not_found') setPhase('needs-reauth')
        return
      }
      setRepos({ status: 'ready', items: result.body.repositories, truncated: result.body.truncated, branch: '' })
    })
    return () => { alive = false }
  }, [phase, reposNonce])

  // Markdown file list, loaded once the connection is live.
  useEffect(() => {
    if (phase !== 'connected') return
    let alive = true
    api<GithubTreeResponse>('/api/integrations/github/tree').then((result) => {
      if (!alive) return
      if (!result.ok) {
        setTree({ status: 'error', items: [], truncated: false, branch: '' })
        if (result.code === 'github_unauthorized' || result.code === 'github_forbidden') setPhase('needs-reauth')
        return
      }
      setTree({ status: 'ready', items: result.body.files, truncated: result.body.truncated, branch: result.body.branch })
    })
    return () => { alive = false }
  }, [phase, treeNonce])

  const refresh = useCallback(() => setStatusNonce((value) => value + 1), [])

  const reloadRepos = useCallback(() => {
    setRepos((prev) => ({ ...prev, status: 'loading' }))
    setReposNonce((value) => value + 1)
  }, [])

  const reloadFiles = useCallback(() => {
    setTree((prev) => ({ ...prev, status: 'loading' }))
    setTreeNonce((value) => value + 1)
  }, [])

  /**
   * Read a file for real (full body) without touching the panel's open-file
   * state. The explicit "Re-read from GitHub" path uses it to adopt the remote
   * copy; the browser uses `readFile`, which also opens it in the panel.
   */
  const pullFile = useCallback((path: string): Promise<GithubFileResponse | null> => {
    return api<GithubFileResponse>(`/api/integrations/github/file?full=1&path=${encodeURIComponent(path)}`).then((result) => {
      if (!aliveRef.current) return null
      if (!result.ok) {
        setNote(result.message)
        if (result.code === 'github_unauthorized' || result.code === 'github_forbidden') setPhase('needs-reauth')
        return null
      }
      return result.body
    })
  }, [])

  const readFile = useCallback((path: string) => {
    setOpening(true)
    setPublishResult(null)
    setPublishError(null)
    setPublishConflict(false)
    // A remote check belongs to the file it was run for; opening another file
    // must not carry a stale answer with it.
    setRemoteCheck(null)
    pullFile(path).then((body) => {
      if (!aliveRef.current) return
      setOpening(false)
      if (!body) return
      setOpenFile(body)
      setNote(null)
    })
  }, [pullFile])

  const closeFile = useCallback(() => {
    setOpenFile(null)
    setRemoteCheck(null)
  }, [])

  const clearRemoteCheck = useCallback(() => setRemoteCheck(null), [])

  const checkRemote = useCallback((input: { path: string; branch: string; sha: string | null }) => {
    const query = new URLSearchParams({ path: input.path, branch: input.branch })
    if (input.sha) query.set('sha', input.sha)
    setCheckingRemote(true)
    api<GithubFileCheckResponse>(`/api/integrations/github/check?${query}`).then((result) => {
      if (!aliveRef.current) return
      setCheckingRemote(false)
      if (!result.ok) {
        // A failed check is silent state, not an alarm: the commit path still
        // refuses a stale write server-side, so this is only an early warning.
        setRemoteCheck(null)
        return
      }
      setRemoteCheck({
        path: result.body.path,
        branch: result.body.branch,
        baselineSha: input.sha,
        liveSha: result.body.sha,
        changed: result.body.changed,
        checkedAt: result.body.checked_at,
      })
    })
  }, [])

  const clearPublish = useCallback(() => {
    setPublishResult(null)
    setPublishError(null)
    setPublishConflict(false)
  }, [])

  const connect = useCallback(() => {
    // Open synchronously in the user gesture. Opening only after the install
    // request resolves is commonly blocked as a popup; `noopener` also makes
    // window.open return null in some browsers, which the old fallback treated
    // as a blocked popup and navigated the current tab as well.
    const githubWindow = window.open('about:blank', '_blank')
    if (githubWindow) githubWindow.opener = null
    setBusy(true)
    setNote(null)
    setPhase('connecting')
    api<{ install_url: string }>('/api/integrations/github/install', { method: 'POST' }).then((result) => {
      if (!aliveRef.current) {
        githubWindow?.close()
        return
      }
      setBusy(false)
      if (!result.ok) {
        githubWindow?.close()
        if (result.code === 'config_missing') {
          setConfigured(false)
          setPhase('soon')
          setNote('GitHub is not configured on this server yet.')
          return
        }
        setPhase('disconnected')
        setNote(result.message)
        return
      }
      if (githubWindow && !githubWindow.closed) {
        githubWindow.location.replace(result.body.install_url)
        setPhase('disconnected')
        setNote('Finish choosing repositories on GitHub, then come back to this tab.')
      } else {
        // A popup blocker can reject the synchronous window.open. Use the
        // current tab then; GitHub's setup callback returns to /mr-markdown.
        window.location.assign(result.body.install_url)
      }
    })
  }, [])

  const chooseRepo = useCallback((repo: GithubRepoOption, path?: string) => {
    setBusy(true)
    setNote(null)
    api<{ connection: GithubConnectionView }>('/api/integrations/github/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_id: repo.id,
        repo_full_name: repo.full_name,
        default_branch: repo.default_branch,
        selected_path: path ?? null,
      }),
    }).then((result) => {
      if (!aliveRef.current) return
      setBusy(false)
      if (!result.ok) {
        setNote(result.message)
        return
      }
      setConnection(result.body.connection)
      setProof(null)
      setOpenFile(null)
      setPhase('connected')
      verify()
    })
  }, [verify])

  const changeRepo = useCallback(() => {
    setNote(null)
    setProof(null)
    setOpenFile(null)
    setPhase((current) => (current === 'connected' || current === 'needs-reauth' ? 'choosing' : current))
  }, [])

  const publish = useCallback((input: PublishInput) => {
    setPublishing(true)
    setPublishResult(null)
    setPublishError(null)
    setPublishConflict(false)
    api<GithubWriteResponse>('/api/integrations/github/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        repo_full_name: input.repoFullName,
        path: input.path,
        content: input.content,
        message: input.message,
        branch: input.branch,
        mode: input.mode,
      }),
    }).then((result) => {
      if (!aliveRef.current) return
      setPublishing(false)
      if (!result.ok) {
        setPublishError(result.message)
        if (result.code === 'github_conflict') setPublishConflict(true)
        if (result.code === 'write_not_permitted') setCapabilities((prev) => ({ ...prev, write: false }))
        return
      }
      setPublishResult(result.body)
      reloadFiles()
      setStatusNonce((value) => value + 1)
      // Let the owner of this hook (the workspace) advance the document's
      // baseline when a commit really landed. The hook itself knows nothing
      // about workspace documents, so it only reports what GitHub confirmed.
      onPublishedRef.current?.(result.body)
    })
  }, [reloadFiles])

  const disconnect = useCallback(() => {
    setBusy(true)
    setNote(null)
    api<{ removed: boolean; revoked: boolean }>('/api/integrations/github/disconnect', { method: 'POST' }).then((result) => {
      if (!aliveRef.current) return
      setBusy(false)
      if (!result.ok) {
        setNote(result.message)
        return
      }
      setConnection(null)
      setRepos({ status: 'ready', items: [], truncated: false, branch: '' })
      setTree({ status: 'ready', items: [], truncated: false, branch: '' })
      setCapabilities(NO_CAPABILITIES)
      setProof(null)
      setOpenFile(null)
      setPhase('disconnected')
      setNote(result.body.revoked ? 'Disconnected. GitHub access was revoked.' : 'Disconnected here. Remove the app on GitHub to revoke access fully.')
    })
  }, [])

  return {
    phase,
    configured,
    appSlug,
    connection,
    capabilities,
    repositories: repos.items,
    repositoriesTruncated: repos.truncated,
    loadingRepos: repos.status === 'loading',
    proof,
    verifying,
    busy,
    files: tree.items,
    filesTruncated: tree.truncated,
    loadingFiles: tree.status === 'loading',
    openFile,
    opening,
    publishing,
    publishResult,
    publishError,
    publishConflict,
    remoteCheck,
    checkingRemote,
    note,
    connect,
    reloadRepos,
    chooseRepo,
    changeRepo,
    verify,
    disconnect,
    refresh,
    reloadFiles,
    readFile,
    pullFile,
    closeFile,
    publish,
    clearPublish,
    checkRemote,
    clearRemoteCheck,
  }
}
