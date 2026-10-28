'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Ic } from './icons'
import { computeDocumentHealth, type HealthIssue, type Job } from './utils'
import CheatSheetPanel from './CheatSheetPanel'

type AiAction = 'cleanup' | 'toc' | 'summarize' | 'translate' | 'frontmatter' | 'chunk'
type RailPanel = 'ai' | 'table' | 'find' | 'outline' | 'health' | 'settings' | 'more' | 'cheatsheet'

type Heading = { id: string; level: number; title: string }

type PremiumToolRailProps = {
  aiBusy: AiAction | string | null
  confidence: number
  documentTitle: string
  headings: Heading[]
  markdown: string
  panelCollapsed: boolean
  stats: Job['stats']
  onAiAction: (action: AiAction) => void
  onCommand: () => void
  onFind: () => void
  onFocus: () => void
  onJumpToHeading: (id: string) => void
  onOpenTable: () => void
  onToggleWorkspacePanel: () => void
}

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ')

const PANEL_META: Record<RailPanel, { eyebrow: string; title: string; description: string }> = {
  ai: { eyebrow: 'Assistant', title: 'Document tools', description: 'Local tools for the active Markdown document.' },
  table: { eyebrow: 'Structure', title: 'Table builder', description: 'Insert a clean Markdown table at the cursor.' },
  find: { eyebrow: 'Navigate', title: 'Find & replace', description: 'Search, review, and replace content precisely.' },
  outline: { eyebrow: 'Navigate', title: 'Document outline', description: 'Jump between sections without losing context.' },
  health: { eyebrow: 'Quality', title: 'Document health', description: 'Heuristic structure checks, not a content-accuracy guarantee.' },
  settings: { eyebrow: 'Preferences', title: 'Editor settings', description: 'Tune the rail and writing environment.' },
  more: { eyebrow: 'Utilities', title: 'More tools', description: 'Secondary tools, kept out of the main workflow.' },
  cheatsheet: { eyebrow: 'Learn', title: 'Markdown cheat sheet', description: 'Syntax reference with copy-paste examples. Search, filter, and copy instantly.' },
}

function RailButton({
  label,
  icon,
  shortcut,
  active,
  badge,
  disabled,
  controls,
  onClick,
}: {
  label: string
  icon: ReactNode
  shortcut?: string
  active?: boolean
  badge?: string
  disabled?: boolean
  controls?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cx('mr-premium-rail-btn', active && 'is-active')}
      aria-label={label}
      aria-pressed={controls ? active : undefined}
      aria-expanded={controls ? active : undefined}
      aria-controls={controls}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="mr-premium-rail-icon" aria-hidden="true">{icon}</span>
      {badge ? <span className="mr-premium-rail-badge" aria-label={badge}>{badge}</span> : null}
      <span className="mr-premium-rail-tooltip" role="tooltip">
        <span>{label}</span>{shortcut ? <kbd>{shortcut}</kbd> : null}
      </span>
    </button>
  )
}

function PanelAction({ icon, title, description, meta, busy, disabled, onClick }: {
  icon: ReactNode
  title: string
  description: string
  meta?: string
  busy?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className="mr-rail-panel-action" onClick={onClick} disabled={busy || disabled} aria-busy={busy || undefined}>
      <span className="mr-rail-panel-action-icon" aria-hidden="true">{busy ? Ic.spinner(16) : icon}</span>
      <span className="mr-rail-panel-action-copy"><strong>{title}</strong><small>{description}</small></span>
      {meta ? <span className="mr-rail-panel-action-meta">{meta}</span> : Ic.chevron(13)}
    </button>
  )
}

export default function PremiumToolRail({
  aiBusy,
  confidence,
  documentTitle,
  headings,
  markdown,
  panelCollapsed,
  stats,
  onAiAction,
  onCommand,
  onFind,
  onFocus,
  onJumpToHeading,
  onOpenTable,
  onToggleWorkspacePanel,
}: PremiumToolRailProps) {
  const [openPanel, setOpenPanel] = useState<RailPanel | null>(null)
  const [compactRail, setCompactRail] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const railRef = useRef<HTMLElement>(null)

  const health = computeDocumentHealth(markdown, stats)
  const healthScore = health.score
  const healthTone = health.tone
  const severityIcon = (issue: HealthIssue) => issue.severity === 'high' ? Ic.alert(13) : issue.severity === 'medium' ? Ic.alert(13) : Ic.info(13)

  const togglePanel = (panel: RailPanel) => setOpenPanel((current) => current === panel ? null : panel)
  const runAi = (action: AiAction) => {
    onAiAction(action)
    setOpenPanel(null)
  }

  useEffect(() => {
    if (!openPanel) return
    const closeOnPointer = (event: PointerEvent) => {
      if (!railRef.current?.contains(event.target as Node)) setOpenPanel(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenPanel(null)
    }
    document.addEventListener('pointerdown', closeOnPointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnPointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [openPanel])

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return
      if (!railRef.current?.closest('.mr-markdown-workspace')?.contains(event.target as Node)) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, [contenteditable="true"]')) return
      const key = event.key.toLowerCase()
      if (key === 'a') { event.preventDefault(); togglePanel('ai') }
      if (key === 't') { event.preventDefault(); togglePanel('table') }
      if (key === 'f') { event.preventDefault(); onFocus() }
      if (key === 'c') { event.preventDefault(); togglePanel('cheatsheet') }
    }
    document.addEventListener('keydown', onShortcut)
    return () => document.removeEventListener('keydown', onShortcut)
  }, [onFocus])

  const meta = openPanel ? PANEL_META[openPanel] : null

  return (
    <nav ref={railRef} className={cx('mr-toolrail', 'mr-premium-toolrail', compactRail && 'is-compact', reducedMotion && 'has-reduced-motion')} aria-label="Markdown editor tools">
      <div className="mr-premium-rail-group" aria-label="Workspace controls">
        <RailButton
          label={panelCollapsed ? 'Show workspace panel' : 'Hide workspace panel'}
          icon={Ic.panelLeft(19)}
          active={!panelCollapsed}
          onClick={onToggleWorkspacePanel}
        />
      </div>

      <div className="mr-premium-rail-divider" />

      <div className="mr-premium-rail-group" aria-label="Creation tools">
        <RailButton label="Document tools" icon={Ic.sparkles(19)} shortcut="Alt+A" badge={aiBusy ? 'Working' : undefined} active={openPanel === 'ai'} controls="mr-rail-panel" onClick={() => togglePanel('ai')} />
        <RailButton label="Table builder" icon={Ic.table(19)} shortcut="Alt+T" active={openPanel === 'table'} controls="mr-rail-panel" onClick={() => togglePanel('table')} />
        <RailButton label="Command tools" icon={Ic.cmd(18)} shortcut="Ctrl K" onClick={() => { setOpenPanel(null); onCommand() }} />
      </div>

      <div className="mr-premium-rail-divider" />

      <div className="mr-premium-rail-group" aria-label="Learning tools">
        <RailButton label="Markdown cheat sheet" icon={Ic.snippet(19)} shortcut="Alt+C" active={openPanel === 'cheatsheet'} controls="mr-rail-panel" onClick={() => togglePanel('cheatsheet')} />
      </div>

      <div className="mr-premium-rail-divider" />

      <div className="mr-premium-rail-group" aria-label="Document intelligence">
        <RailButton label="Find & replace" icon={Ic.search(19)} shortcut="Ctrl F" active={openPanel === 'find'} controls="mr-rail-panel" onClick={() => togglePanel('find')} />
        <RailButton label="Document outline" icon={Ic.toc(19)} badge={headings.length ? String(headings.length) : undefined} active={openPanel === 'outline'} controls="mr-rail-panel" onClick={() => togglePanel('outline')} />
        <RailButton label="Document health" icon={Ic.gauge(19)} badge={String(healthScore)} active={openPanel === 'health'} controls="mr-rail-panel" onClick={() => togglePanel('health')} />
      </div>

      <div className="mr-premium-rail-spacer" />

      <div className="mr-premium-rail-group" aria-label="Preferences">
        <RailButton label="More tools" icon={Ic.chunks(19)} active={openPanel === 'more'} controls="mr-rail-panel" onClick={() => togglePanel('more')} />
        <RailButton label="Settings" icon={Ic.cog(19)} active={openPanel === 'settings'} controls="mr-rail-panel" onClick={() => togglePanel('settings')} />
        <RailButton label="Focus mode" icon={Ic.focus(19)} shortcut="Alt+F" onClick={onFocus} />
      </div>

      {openPanel && meta ? (
        <section id="mr-rail-panel" className="mr-premium-rail-panel" aria-label={meta.title}>
          <header className="mr-rail-panel-head">
            <div><span>{meta.eyebrow}</span><h2>{meta.title}</h2><p>{meta.description}</p></div>
            <button type="button" onClick={() => setOpenPanel(null)} aria-label={`Close ${meta.title}`}>{Ic.close(13)}</button>
          </header>

          <div className="mr-rail-panel-body">
            {openPanel === 'ai' ? (
              <>
                <div className="mr-rail-ai-hero"><span>{Ic.sparkles(17)}</span><div><strong>Work with the whole draft</strong><small>Local actions do not send your text to an AI service.</small></div></div>
                <div className="mr-rail-panel-list">
                  <PanelAction icon={Ic.broom(16)} title="Clean up Markdown" description="Normalize spacing locally; review changes" meta="Local" busy={aiBusy === 'cleanup'} onClick={() => runAi('cleanup')} />
                  <PanelAction icon={Ic.brain(16)} title="Summarize document" description="Editor-draft processing is not connected" meta="Unavailable" disabled onClick={() => runAi('summarize')} />
                  <PanelAction icon={Ic.toc(16)} title="Generate table of contents" description="Build links from document headings" busy={aiBusy === 'toc'} onClick={() => runAi('toc')} />
                  <PanelAction icon={Ic.language(16)} title="Translate content" description="Editor-draft processing is not connected" meta="Unavailable" disabled onClick={() => runAi('translate')} />
                  <PanelAction icon={Ic.page(16)} title="Add frontmatter" description="Generate useful document metadata" busy={aiBusy === 'frontmatter'} onClick={() => runAi('frontmatter')} />
                  <PanelAction icon={Ic.chunks(16)} title="Create AI-ready chunks" description="Split content for retrieval workflows" busy={aiBusy === 'chunk'} onClick={() => runAi('chunk')} />
                </div>
              </>
            ) : null}

            {openPanel === 'table' ? (
              <>
                <div className="mr-rail-table-preview" aria-hidden="true">
                  {Array.from({ length: 12 }, (_, index) => <span key={index} className={index < 4 ? 'is-header' : ''} />)}
                </div>
                <div className="mr-rail-info-row"><span>Default table</span><strong>3 columns × 3 rows</strong></div>
                <button type="button" className="mr-rail-primary-action" onClick={() => { onOpenTable(); setOpenPanel(null) }}>{Ic.table(15)} Choose table size</button>
                <p className="mr-rail-panel-note">The visual grid picker opens beside the editor so the table is inserted exactly at your cursor.</p>
              </>
            ) : null}

            {openPanel === 'find' ? (
              <>
                <div className="mr-rail-feature-card"><span>{Ic.search(19)}</span><div><strong>Precision search</strong><small>Case matching, whole-word search, previous/next navigation, replace one, and replace all.</small></div></div>
                <button type="button" className="mr-rail-primary-action" onClick={() => { onFind(); setOpenPanel(null) }}>{Ic.find(15)} Open Find & Replace</button>
                <div className="mr-rail-shortcut-row"><span>Keyboard shortcut</span><kbd>Ctrl F</kbd></div>
              </>
            ) : null}

            {openPanel === 'outline' ? (
              headings.length ? <div className="mr-rail-outline-list">{headings.slice(0, 14).map((heading) => (
                <button type="button" key={heading.id} style={{ paddingLeft: `${12 + (heading.level - 1) * 12}px` }} onClick={() => { onJumpToHeading(heading.id); setOpenPanel(null) }}>
                  <span>H{heading.level}</span><strong>{heading.title}</strong>
                </button>
              ))}</div> : <div className="mr-rail-empty"><span>{Ic.toc(24)}</span><strong>No headings yet</strong><p>Add Markdown headings to create a navigable outline.</p></div>
            ) : null}

            {openPanel === 'health' ? (
              <>
                <div className="mr-rail-health-score">
                  <div style={{ ['--rail-score' as string]: `${healthScore * 3.6}deg` }}><strong>{healthScore}</strong><span>/100</span></div>
                  <section>
                    <span>{healthTone}</span>
                    <h3>Structural readiness</h3>
                    <p>{health.summary}</p>
                  </section>
                </div>
                <div className="mr-rail-health-conf">
                  <span className="mr-rail-health-conf-icon">{Ic.info(12)}</span>
                  <div>
                    <strong>{markdown.trim() ? `${confidence}/100 text signal` : 'No text signal'}</strong>
                    <small>Historical conversion or saved-draft signal, not measured accuracy. Edits do not reverify the PDF. Check names, numbers and completeness against the original.</small>
                  </div>
                  <span className="mr-rail-health-conf-badge">Estimate</span>
                </div>
                <div className="mr-rail-metric-grid">
                  <div><span>Words</span><strong>{stats.words.toLocaleString()}</strong></div>
                  <div><span>Headings</span><strong>{stats.headings}</strong></div>
                  <div><span>Issues</span><strong>{health.issues.length}</strong></div>
                  <div><span>Tables</span><strong>{stats.tables}</strong></div>
                </div>
                {health.issues.length > 0 ? (
                  <div className="mr-rail-health-issues">
                    {health.issues.slice(0, 6).map((issue, index) => (
                      <div className={`mr-rail-health-issue is-${issue.severity}`} key={`${issue.label}-${index}`}>
                        <span className="mr-rail-health-issue-icon" aria-hidden="true">{severityIcon(issue)}</span>
                        <div>
                          <strong>{issue.label}</strong>
                          <p>{issue.detail}</p>
                        </div>
                      </div>
                    ))}
                    {health.issues.length > 6 ? <p className="mr-rail-health-issues-more">+{health.issues.length - 6} more checks flagged something.</p> : null}
                  </div>
                ) : (
                  <div className="mr-rail-health-tip">{Ic.bulb(15)} {health.strengths[0] || 'No issues found by these checks. Content accuracy still needs review.'}</div>
                )}
              </>
            ) : null}

            {openPanel === 'settings' ? (
              <div className="mr-rail-settings">
                <label><span><strong>Compact density</strong><small>Tighter rail spacing</small></span><input type="checkbox" checked={compactRail} onChange={(event) => setCompactRail(event.target.checked)} /></label>
                <label><span><strong>Reduce motion</strong><small>Minimize rail animations</small></span><input type="checkbox" checked={reducedMotion} onChange={(event) => setReducedMotion(event.target.checked)} /></label>
                <div className="mr-rail-settings-summary"><span>{Ic.file(15)}</span><div><strong>{documentTitle}.md</strong><small>Preferences apply to this editor workspace.</small></div></div>
              </div>
            ) : null}

            {openPanel === 'cheatsheet' ? <CheatSheetPanel /> : null}

            {openPanel === 'more' ? (
              <div className="mr-rail-panel-list">
                <PanelAction icon={Ic.print(16)} title="Print-ready preview" description="Use the browser print workflow" onClick={() => { window.print(); setOpenPanel(null) }} />
                <PanelAction icon={Ic.image(16)} title="Media references" description="Review image syntax in the document" meta="Soon" disabled onClick={() => undefined} />
                <PanelAction icon={Ic.lock(16)} title="Document protection" description="Publishing controls and permissions" meta="Soon" disabled onClick={() => undefined} />
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </nav>
  )
}
