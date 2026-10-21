'use client'

import { PaneHead } from './parts'

/**
 * Shortcuts — a reference for the keys the workspace actually binds, drawn in
 * the workspace's own instrument register (mono keycaps, tabular rhythm). Only
 * bindings that exist in the module are listed; a shortcut that did nothing
 * would be a lie printed on the bench.
 */
const GROUPS: { label: string; rows: [string[], string][] }[] = [
  {
    label: 'Command',
    rows: [
      [['Ctrl', 'K'], 'Open the command palette'],
      [['Ctrl', '↵'], 'Start a blank document'],
      [['Ctrl', 'S'], 'Download the active document as Markdown'],
    ],
  },
  {
    label: 'View',
    rows: [
      [['Ctrl', '/'], 'Toggle focus mode'],
      [['Alt', 'F'], 'Toggle focus mode from inside the editor'],
      [['Alt', 'C'], 'Open the Markdown cheat sheet'],
    ],
  },
  {
    label: 'Exit',
    rows: [
      [['Esc'], 'Close the open overlay, or leave focus mode'],
    ],
  },
]

export default function ShortcutsSection() {
  return (
    <section className="mr-cfg-section">
      <PaneHead eyebrow="Workspace" title="Shortcuts" hint="On macOS, use ⌘ where Ctrl is shown." />

      {GROUPS.map((group) => (
        <div className="mr-cfg-group" key={group.label}>
          <span className="mr-cfg-group-label">{group.label}</span>
          <ul className="mr-cfg-keys">
            {group.rows.map(([keys, label]) => (
              <li className="mr-cfg-key-row" key={label}>
                <span className="mr-cfg-key-label">{label}</span>
                <span className="mr-cfg-key-caps">
                  {keys.map((key, index) => (
                    <span key={`${key}-${index}`}>
                      {index > 0 ? <i className="mr-cfg-key-plus" aria-hidden="true">+</i> : null}
                      <kbd className="mr-cfg-key">{key}</kbd>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}
