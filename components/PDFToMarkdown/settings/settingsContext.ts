import type { ReactNode } from 'react'
import type { AccountViewer } from '@/lib/account/useAccountViewer'
// Type-only: the connection vocabulary lives with the provider contract, and a
// type import is erased, so this adds no runtime edge console → section.
import type { IntegrationProviderStatus } from './providerContract'

/**
 * The contract every Mr. Markdown settings section depends on.
 *
 * The console is the module's own surface (surface 4), so nothing here reaches
 * into the shared `SettingsModal`'s internals — the only cross-module surface is
 * the shared *data*: the account viewer (identity) and `/api/profile/activity`
 * (owner activity), both reached through shared modules. See plan §8.1/§8.2.
 *
 * Sections never touch each other and never read the console's own state. They
 * declare a spec (id/label/group/order/icon + an optional visibility rule and a
 * render function) and the console drives navigation from that registry. Adding
 * a section is one entry in `settingsRegistry.ts`, not a new branch in the shell.
 */

export type SettingsSectionId =
  | 'identity'
  | 'security'
  | 'activity'
  | 'appearance'
  | 'editor'
  | 'shortcuts'
  | 'connections'
  | 'about'

/** Nav grouping. Order inside a group comes from `SettingsSectionSpec.order`. */
export type SettingsSectionGroup = 'Account' | 'Workspace' | 'Connections'

/**
 * The workspace preferences the console edits. These are the *same* values the
 * workspace already holds in `Workspace` state and persists under
 * `pm.workspace.prefs.v1` — the console adds no new persistence, it just writes
 * through the existing bridge (`useWorkspacePreferences`).
 *
 * `theme` is deliberately the workspace's own theme (`mr-markdown-theme`), not
 * the global `smilepdf-theme` — the two are separate on purpose (CLAUDE.md §8).
 */
export type WorkspacePreferences = {
  editorMode: 'raw' | 'rich'
  scrollSync: boolean
  previewOnly: boolean
  splitRatio: number
  panelCollapsed: boolean
  toolbarCollapsed: boolean
  focusView: 'write' | 'split' | 'preview'
  theme: 'light' | 'dark'
}

/**
 * The document the workspace currently has open, when there is one. It is an
 * optional, read-only *source* the Connections write surface may offer (publish
 * the document you are editing); it grants the console no write access to the
 * editor's own state.
 */
export type ActiveDocument = { title: string; markdown: string }

/**
 * A workspace document that is bound to a GitHub file, as the Connections
 * surface needs to see it: its provenance (`sourceId` + the parsed parts), the
 * baseline it was read at, and whether the live content has drifted from it.
 *
 * This is the single shape both the write panel and the editor's commit chip
 * read, so "is this edited?" is answered one way — a plain text comparison, never
 * a separately-maintained flag. It is built by the workspace from its own
 * documents; the console and panel never own it.
 */
export type SourcedDocument = {
  documentId: string
  sourceId: string
  title: string
  repoFullName: string
  branch: string
  path: string
  /** The GitHub content this document was opened (or last committed) at. */
  baseMarkdown: string
  /** The blob sha at that baseline, or null when GitHub did not report one. */
  baseSha: string | null
  /** The document's current content. */
  markdown: string
  /** `markdown !== baseMarkdown` — derived, never stored. */
  dirty: boolean
}

/**
 * Opens a Markdown body as a document in the workspace editor. The console never
 * touches document state directly: it hands the content to the workspace through
 * this one callback, the same contract the merge dialog uses.
 *
 * `sourceId` is an optional provenance key — a stable identity for *where* this
 * document came from (today, a GitHub file). The workspace uses it to focus the
 * document already open for that source instead of opening a duplicate.
 *
 * `baseMarkdown` + `baseSha` record the GitHub content this document was based
 * on, so the workspace can compute "edited" later. They are only meaningful
 * together with `sourceId`; a merge or a blank canvas passes neither.
 *
 * It **returns what happened** (`created` or `focused`) rather than firing a
 * global toast, so the surface that asked — the connection panel — can report the
 * outcome where the owner is looking, next to the button they pressed.
 */
export type OpenDocumentResult = { outcome: 'created' | 'focused'; title: string }

export type OpenDocument = (input: {
  title: string
  markdown: string
  sourceId?: string
  baseMarkdown?: string
  baseSha?: string | null
}) => OpenDocumentResult

/**
 * Everything a section may read or call. `status`/`viewer`/`refreshViewer` are
 * the shared identity (via `useAccountViewer`, owned by `Workspace` so the
 * topbar seal and the console read one instance and stay in step).
 */
export type SettingsContext = {
  status: 'loading' | 'ready'
  viewer: AccountViewer | null
  /** Re-read identity after a display-name or avatar change. */
  refreshViewer(): void
  /** Sign the owner out (shared Supabase session). */
  signOut(): Promise<void>
  preferences: WorkspacePreferences
  /** Merge a partial change into the live workspace state (and its store). */
  patchPreferences(patch: Partial<WorkspacePreferences>): void
  /** The document currently open in the editor, if any (a read-only source). */
  activeDocument?: ActiveDocument
  /** Hand a Markdown body to the workspace as a new document. */
  openDocument?: OpenDocument
  /**
   * Every open document that is bound to a GitHub file (see `SourcedDocument`).
   * Optional so a section that never touches connections is unaffected.
   */
  sourcedDocuments?: SourcedDocument[]
  /** The GitHub file the console should open/focus in the write panel, if any. */
  focusSourceId?: string
  /** Write the panel's edits through to the workspace document (debounced there). */
  editSourcedDocument?: (sourceId: string, markdown: string) => void
  /** Adopt the remote copy wholesale (explicit "Re-read from GitHub"). */
  resetSourcedDocument?: (sourceId: string, markdown: string, sha: string | null) => void
  /** The live GitHub connection status, when a connections section has reported it. */
  githubStatus?: IntegrationProviderStatus
  /** A connections section reports its provider status here for the identity seal. */
  reportGithubStatus?: (status: IntegrationProviderStatus) => void
  /** Jump the console to another section (cross-links inside a pane). */
  openSection(id: SettingsSectionId): void
  /** Close the console. */
  close(): void
}

export type SettingsSectionSpec = {
  id: SettingsSectionId
  label: string
  group: SettingsSectionGroup
  /** Order within the group; lower first. */
  order: number
  /** Module-derived glyph (no icon library is loaded anywhere in the repo). */
  icon: ReactNode
  /** Sections an account cannot configure hide rather than render empty. */
  visible?(ctx: SettingsContext): boolean
  render(ctx: SettingsContext): ReactNode
}

/** Nav group order is fixed; it is part of how the console reads, not data. */
export const SECTION_GROUP_ORDER: SettingsSectionGroup[] = ['Account', 'Workspace', 'Connections']
