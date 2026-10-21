import type { ReactNode } from 'react'
import type { GithubConnectionView } from '@/lib/integrations/types'
import { githubGlyph } from './icons'

/**
 * The integration catalogue for Mr. Markdown, declared as a contract.
 *
 * This file holds **data and one pure status resolver only** — no network code,
 * no OAuth, no token handling. Whether a provider is actually live is decided at
 * runtime from the server (`GET /api/integrations/github/connection`), so the
 * section never has to guess and a deployment without `GITHUB_APP_*` honestly
 * reports "Soon" rather than offering a Connect button that would do nothing.
 *
 * Adding a provider is one entry here plus its own adapter under
 * `lib/integrations/<provider>/`; the console's shell needs no change.
 */

export type IntegrationProviderStatus = 'connected' | 'needs_reauth' | 'disconnected' | 'soon'

export type IntegrationProvider = {
  id: string
  label: string
  icon: ReactNode
  /** One honest sentence, in the module's register. */
  description: string
}

export const INTEGRATION_PROVIDERS: IntegrationProvider[] = [
  {
    id: 'github',
    label: 'GitHub',
    icon: githubGlyph,
    description: 'Read and write Markdown in the repositories you pick — nothing else, and only when you confirm.',
  },
]

/**
 * Resolves the live status for GitHub from the server answer. `configured` is
 * false when the App env is absent (→ "Soon"); otherwise the connection decides,
 * and an unusable installation is reported as `needs_reauth`, never as
 * connected.
 */
export function githubProviderStatus(configured: boolean, connection: GithubConnectionView | null): IntegrationProviderStatus {
  if (!configured) return 'soon'
  if (!connection) return 'disconnected'
  return connection.status === 'connected' ? 'connected' : 'needs_reauth'
}
