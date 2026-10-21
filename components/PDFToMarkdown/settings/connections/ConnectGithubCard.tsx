'use client'

import { githubGlyph } from '../icons'
import { GITHUB_SCOPE_DETAILS, GITHUB_SCOPE_NON_GOALS, GITHUB_SCOPE_SUMMARY } from '@/lib/integrations/github/scopes'

/**
 * The *explaining* level of the disconnected dock: the empty slot, the exact
 * scope in plain words, and nothing else.
 *
 * It deliberately holds no Connect button — the dock bar above owns the one
 * action, so there is exactly one place to connect and one to disconnect, and no
 * second button competing for the same decision.
 */
export default function ConnectGithubCard({ note }: { note: string | null }) {
  return (
    <article className="mr-cfg-gh-card">
      <div className="mr-cfg-gh-slot" aria-hidden="true">
        <span className="mr-cfg-gh-slot-mark">{githubGlyph}</span>
        <span className="mr-cfg-gh-slot-hint">empty</span>
      </div>

      <div className="mr-cfg-gh-main">
        <div className="mr-cfg-gh-head">
          <strong>Not linked yet</strong>
          <span className="mr-cfg-gh-scope">{GITHUB_SCOPE_SUMMARY}</span>
        </div>

        <details className="mr-cfg-gh-why">
          <summary>What connecting allows — and what it never does</summary>
          <div className="mr-cfg-gh-why-body">
            <ul className="mr-cfg-gh-allow">
              {GITHUB_SCOPE_DETAILS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <ul className="mr-cfg-gh-deny">
              {GITHUB_SCOPE_NON_GOALS.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </div>
        </details>

        <p className="mr-cfg-gh-fine">Use <strong>Connect GitHub</strong> above — it opens GitHub in a new tab, where you pick the repositories.</p>

        {note ? <p className="mr-cfg-gh-note" role="status">{note}</p> : null}
      </div>
    </article>
  )
}
