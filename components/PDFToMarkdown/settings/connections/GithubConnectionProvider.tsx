'use client'

import { createContext, useContext, type ReactNode } from 'react'
import type { GithubWriteResponse } from '@/lib/integrations/types'
import { useGithubConnection, type GithubConnectionHook } from './useGithubConnection'

/**
 * One GitHub connection for the whole workspace.
 *
 * `useGithubConnection` is a state machine that fetches on mount and on window
 * focus. Mounting it twice (once in the console, once in the editor's topbar)
 * would double those reads and let the two copies drift, so the workspace mounts
 * it **once** here and every consumer — the Connections pane and the editor's
 * commit chip — reads the same object. That is what lets the chip show dirty /
 * remote state while the console is closed, without a second source of truth.
 *
 * The provider renders no DOM of its own; it only owns the hook instance.
 */
const GithubConnectionContext = createContext<GithubConnectionHook | null>(null)

export function GithubConnectionProvider({
  enabled = true,
  onPublished,
  children,
}: {
  enabled?: boolean
  /** Called after a confirmed publish, so the workspace can advance a baseline. */
  onPublished?: (result: GithubWriteResponse) => void
  children: ReactNode
}) {
  const gh = useGithubConnection({ enabled, onPublished })
  return <GithubConnectionContext.Provider value={gh}>{children}</GithubConnectionContext.Provider>
}

/**
 * Read the shared connection. Throws when used outside the provider so a
 * misplaced consumer is caught in development instead of silently rendering an
 * empty, disconnected-looking surface.
 */
export function useGithubConnectionContext(): GithubConnectionHook {
  const gh = useContext(GithubConnectionContext)
  if (!gh) {
    throw new Error('useGithubConnectionContext must be used inside <GithubConnectionProvider> (the Mr. Markdown workspace).')
  }
  return gh
}
