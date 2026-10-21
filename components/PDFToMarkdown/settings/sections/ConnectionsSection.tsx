'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { githubInstallUrl } from '@/lib/integrations/github/scopes'
import type { SettingsContext } from '../settingsContext'
import { githubProviderStatus, INTEGRATION_PROVIDERS, type IntegrationProviderStatus } from '../providerContract'
import { GuestGate, PaneHead } from './parts'
import { useGithubConnectionContext } from '../connections/GithubConnectionProvider'
import ActionButton from '../connections/ActionButton'
import InlineLoader from '../connections/InlineLoader'
import ConnectGithubCard from '../connections/ConnectGithubCard'
import RepoPicker from '../connections/RepoPicker'
import GithubConnectedCard from '../connections/GithubConnectedCard'
import GithubWritePanel from '../connections/GithubWritePanel'

const STATUS_LABEL: Record<IntegrationProviderStatus, string> = {
  connected: 'Connected',
  needs_reauth: 'Needs reconnect',
  disconnected: 'Not connected',
  soon: 'Soon',
}

const STATUS_CLASS: Record<IntegrationProviderStatus, string> = {
  connected: 'is-connected',
  needs_reauth: 'is-pending',
  disconnected: 'is-disconnected',
  soon: 'is-soon',
}

/**
 * Connections — the hand-off dock.
 *
 * Instrument concept: a dock at the bench edge whose *first line* is the truth —
 * is the link live, what does it touch, and the single control that opens or
 * closes it. Everything below is ordered by the question the owner is asking, in
 * the order they ask it:
 *
 *   1. state + the one action             → the dock bar (this file)
 *   2. who and what is linked             → the link card
 *   3. proof the link really works        → the read proof
 *   4. the work: browse → edit → publish  → the write panel
 *
 * The pane title names the provider, so the bar spends its width on state and
 * the exact scope instead of repeating it; connect and disconnect live in that
 * one predictable place. The section still owns no network logic — it is a thin
 * shell over `useGithubConnection` and the `providerContract` catalogue.
 */
export default function ConnectionsSection({ ctx }: { ctx: SettingsContext }) {
  // The connection lives once, in the workspace-level provider; the pane reads
  // that shared instance instead of mounting a second state machine of its own.
  const gh = useGithubConnectionContext()
  const status = githubProviderStatus(gh.configured, gh.connection)
  const github = INTEGRATION_PROVIDERS.find((provider) => provider.id === 'github')
  // Disconnect is destructive, so it is a two-step control in the one predictable
  // place (the dock bar) rather than a second button buried in the card.
  const [confirming, setConfirming] = useState(false)

  // Report the live status so the console's identity header can seal it. The
  // console owns no connection state and only shows what was actually observed.
  const reportStatus = ctx.reportGithubStatus
  useEffect(() => {
    reportStatus?.(status)
  }, [reportStatus, status])

  // Handing a repo file to the editor deliberately leaves the console open: the
  // owner is working through several files and should not have to re-open the
  // panel for each one. The outcome is reported inside the panel instead.
  const openDocument = ctx.openDocument

  const repoName = gh.connection?.repo?.repo_full_name ?? null
  const linked = status === 'connected' || status === 'needs_reauth'
  const scope = linked
    ? `${gh.capabilities.write ? 'Read & write' : 'Read-only'} · ${repoName ?? 'no repository yet'}`
    : 'Read & write Markdown · only the repository you pick'
  const connecting = gh.busy || gh.phase === 'connecting'

  return (
    <section className="mr-cfg-section">
      <PaneHead
        eyebrow="Connections"
        title="GitHub"
        hint="Read and write Markdown in the repositories you pick. Nothing leaves the bench until you connect, and every publish is confirmed."
      />

      {/* The providers list (the console's own vocabulary) holds the bar, so a
          second provider is another entry here with no layout change. */}
      <div className="mr-cfg-providers">
        <article className={`mr-cfg-provider mr-cfg-gh-dockbar ${STATUS_CLASS[status]}`}>
          <span className="mr-cfg-provider-mark" aria-hidden="true">{github?.icon}</span>

          <div className="mr-cfg-provider-copy">
            <p className="mr-cfg-gh-dockbar-scope">{scope}</p>
          </div>

          <span className="mr-cfg-provider-status">{gh.phase === 'loading' ? 'Checking…' : STATUS_LABEL[status]}</span>

          <div className="mr-cfg-gh-dockbar-actions">
            {!ctx.viewer ? (
              <Link href="/login" className="mr-cfg-btn mr-cfg-btn-primary" onClick={ctx.close}>
                Sign in
              </Link>
            ) : status === 'soon' ? (
              <span className="mr-cfg-gh-fine">Not configured here</span>
            ) : status === 'disconnected' ? (
              <ActionButton
                variant="primary"
                loading={connecting}
                busyLabel="Opening GitHub"
                onClick={() => { void gh.connect() }}
              >
                Connect GitHub
              </ActionButton>
            ) : confirming ? (
              <>
                <ActionButton
                  variant="danger"
                  loading={gh.busy}
                  busyLabel="Disconnecting"
                  onClick={() => { void gh.disconnect() }}
                >
                  Confirm disconnect
                </ActionButton>
                <ActionButton
                  variant="quiet"
                  disabled={gh.busy}
                  onClick={() => setConfirming(false)}
                >
                  Cancel
                </ActionButton>
              </>
            ) : (
              <>
                {status === 'needs_reauth' ? (
                  <ActionButton
                    variant="primary"
                    loading={connecting}
                    busyLabel="Opening GitHub"
                    onClick={() => { setConfirming(false); void gh.connect() }}
                  >
                    Reconnect
                  </ActionButton>
                ) : null}
                <ActionButton variant="quiet" disabled={gh.busy} onClick={() => setConfirming(true)}>
                  Disconnect
                </ActionButton>
              </>
            )}
          </div>
        </article>
      </div>

      {github ? (
        <div className="mr-cfg-gh-dock">
          {!ctx.viewer ? (
            <GuestGate
              title="Sign in to connect GitHub"
              hint="A connection is bound to your account, so Mr. Markdown can revoke it cleanly and never mixes it with anyone else's. Sign in above, then connect from here."
            />
          ) : gh.phase === 'loading' ? (
            <InlineLoader label="Checking the connection…" />
          ) : gh.phase === 'soon' ? (
            <p className="mr-cfg-note mr-cfg-note-strong">
              GitHub is not configured on this server yet. Nothing here is connected, and no Connect button is shown
              until it would actually work.
            </p>
          ) : gh.phase === 'disconnected' ? (
            <ConnectGithubCard note={gh.note} />
          ) : gh.phase === 'connecting' ? (
            <>
              <InlineLoader label="Opening GitHub in a new tab…" />
              {gh.note ? <p className="mr-cfg-gh-note" role="status">{gh.note}</p> : null}
            </>
          ) : gh.phase === 'choosing' ? (
            <RepoPicker
              repositories={gh.repositories}
              truncated={gh.repositoriesTruncated}
              loading={gh.loadingRepos}
              busy={gh.busy}
              note={gh.note}
              accountLogin={gh.connection?.account_login ?? null}
              accountType={gh.connection?.account_type ?? null}
              installUrl={gh.appSlug ? githubInstallUrl(gh.appSlug) : null}
              onConfirm={(repo, path) => { void gh.chooseRepo(repo, path) }}
              onReload={() => { void gh.reloadRepos() }}
            />
          ) : gh.phase === 'error' ? (
            <div className="mr-cfg-gh-dock-error">
              <p className="mr-cfg-error" role="alert">{gh.note ?? 'The connection could not be read.'}</p>
              {/* No sphere here on purpose: the hook exposes no busy signal for a
                  status re-read, and a loader we cannot clear would be a lie. */}
              <ActionButton onClick={() => gh.refresh()}>Retry</ActionButton>
            </div>
          ) : gh.connection ? (
            <>
              <GithubConnectedCard
                connection={gh.connection}
                proof={gh.proof}
                verifying={gh.verifying}
                busy={gh.busy}
                note={gh.note}
                needsReauth={gh.phase === 'needs-reauth'}
                onVerify={() => { void gh.verify() }}
                onChangeRepo={gh.changeRepo}
              />
              {gh.phase === 'connected' ? (
                <GithubWritePanel
                  gh={gh}
                  activeDocument={ctx.activeDocument}
                  onOpenDocument={openDocument}
                  sourcedDocuments={ctx.sourcedDocuments}
                  focusSourceId={ctx.focusSourceId}
                  editSourcedDocument={ctx.editSourcedDocument}
                  resetSourcedDocument={ctx.resetSourcedDocument}
                />
              ) : null}
            </>
          ) : (
            <p className="mr-cfg-note">The connection state could not be resolved. Reload the workspace to retry.</p>
          )}
        </div>
      ) : null}
    </section>
  )
}
