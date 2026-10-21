'use client'

import type { SettingsContext, WorkspacePreferences } from '../settingsContext'
import { PaneHead, Segmented, Toggle } from './parts'

/**
 * Editor defaults — the workspace's own panel behaviour, written live through
 * the preferences bridge (the same cells the topbar buttons and the editor
 * pane drive, and the same `pm.workspace.prefs.v1` store). There is no separate
 * "settings copy" of any of these, so the console can never drift from the
 * workspace it describes.
 */
export default function EditorDefaultsSection({ ctx }: { ctx: SettingsContext }) {
  const { preferences, patchPreferences } = ctx

  const set = <K extends keyof WorkspacePreferences>(key: K, value: WorkspacePreferences[K]) =>
    patchPreferences({ [key]: value } as Partial<WorkspacePreferences>)

  return (
    <section className="mr-cfg-section">
      <PaneHead
        eyebrow="Workspace"
        title="Editor defaults"
        hint="The bench opens in this shape. Every control here is the same one the workspace exposes inline."
      />

      <div className="mr-cfg-group">
        <span className="mr-cfg-group-label">Editing surface</span>
        <Segmented
          ariaLabel="Editor mode"
          value={preferences.editorMode}
          onChange={(next) => set('editorMode', next)}
          options={[
            { id: 'raw', label: 'Markdown source', hint: 'Line numbers, exact text' },
            { id: 'rich', label: 'Rich text', hint: 'Formatted, WYSIWYG' },
          ]}
        />
        <Segmented
          ariaLabel="Default view"
          value={preferences.focusView}
          onChange={(next) => set('focusView', next)}
          options={[
            { id: 'write', label: 'Write' },
            { id: 'split', label: 'Split' },
            { id: 'preview', label: 'Preview' },
          ]}
        />
      </div>

      <div className="mr-cfg-group">
        <span className="mr-cfg-group-label">Workspace chrome</span>
        <Toggle
          checked={!preferences.panelCollapsed}
          onChange={(next) => set('panelCollapsed', !next)}
          label="Document sidebar"
          hint="Show the document list and AI actions down the left."
        />
        <Toggle
          checked={!preferences.toolbarCollapsed}
          onChange={(next) => set('toolbarCollapsed', !next)}
          label="Formatting toolbar"
          hint="Show the Markdown formatting tools above the editor."
        />
        <Toggle
          checked={preferences.previewOnly}
          onChange={(next) => set('previewOnly', next)}
          label="Preview only"
          hint="Collapse the editor and give the whole pane to the rendered preview."
        />
        <Toggle
          checked={preferences.scrollSync}
          onChange={(next) => set('scrollSync', next)}
          label="Link scroll"
          hint="Keep the editor and preview scrolled to the same place."
        />
      </div>

      <div className="mr-cfg-group">
        <label className="mr-cfg-field">
          <span className="mr-cfg-field-label">
            Editor / preview split
            <span className="mr-cfg-value">{preferences.splitRatio.toFixed(2)}×</span>
          </span>
          <input
            className="mr-cfg-range"
            type="range"
            min={0.6}
            max={1.8}
            step={0.05}
            value={preferences.splitRatio}
            onChange={(event) => set('splitRatio', Number(event.target.value))}
          />
        </label>
      </div>
    </section>
  )
}
