import type { WorkspacePreferences } from './settingsContext'

/**
 * Workspace state ⇄ patch bridge for the calibration console.
 *
 * The workspace already owns every one of these preferences as individual
 * `useState` cells in `views.tsx` and already persists them through
 * `saveWorkspacePrefs` (see `./session`). This module adds **no new storage** —
 * it only exposes that live state as one object plus a single setter the console
 * can call, so the console never has to know which cell it is writing.
 *
 * `theme` is the workspace theme (`mr-markdown-theme`), which lives outside
 * `pm.workspace.prefs.v1`; its writer owns that separate persistence so the
 * existing topbar theme toggle and the console stay identical.
 */

export type WorkspacePreferenceWriters = {
  editorMode: (value: WorkspacePreferences['editorMode']) => void
  scrollSync: (value: WorkspacePreferences['scrollSync']) => void
  previewOnly: (value: WorkspacePreferences['previewOnly']) => void
  splitRatio: (value: WorkspacePreferences['splitRatio']) => void
  panelCollapsed: (value: WorkspacePreferences['panelCollapsed']) => void
  toolbarCollapsed: (value: WorkspacePreferences['toolbarCollapsed']) => void
  focusView: (value: WorkspacePreferences['focusView']) => void
  theme: (value: WorkspacePreferences['theme']) => void
}

export function useWorkspacePreferences(
  preferences: WorkspacePreferences,
  writers: WorkspacePreferenceWriters,
): { preferences: WorkspacePreferences; patchPreferences: (patch: Partial<WorkspacePreferences>) => void } {
  const patchPreferences = (patch: Partial<WorkspacePreferences>) => {
    if (patch.editorMode !== undefined) writers.editorMode(patch.editorMode)
    if (patch.scrollSync !== undefined) writers.scrollSync(patch.scrollSync)
    if (patch.previewOnly !== undefined) writers.previewOnly(patch.previewOnly)
    if (patch.splitRatio !== undefined) writers.splitRatio(patch.splitRatio)
    if (patch.panelCollapsed !== undefined) writers.panelCollapsed(patch.panelCollapsed)
    if (patch.toolbarCollapsed !== undefined) writers.toolbarCollapsed(patch.toolbarCollapsed)
    if (patch.focusView !== undefined) writers.focusView(patch.focusView)
    if (patch.theme !== undefined) writers.theme(patch.theme)
  }

  return { preferences, patchPreferences }
}
