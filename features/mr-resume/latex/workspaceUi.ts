/** Preferences are optional presentation state, not project/source or proof records. */
export const LATEX_WORKSPACE_UI_KEY = 'mr-resume:latex:workspace-ui:v1'
export type WorkspaceDrawer = 'closed' | 'build' | 'problems' | 'output' | 'history'
export type WorkspaceUi = { version: 1; drawer: WorkspaceDrawer; detailsOpen: boolean; consoleHeight: number; outputView: 'log' | 'activity'; sourceHeaderCollapsed: boolean }
export const DEFAULT_WORKSPACE_UI: WorkspaceUi = { version: 1, drawer: 'closed', detailsOpen: false, consoleHeight: 224, outputView: 'log', sourceHeaderCollapsed: false }

export function readWorkspaceUi(storage: Pick<Storage, 'getItem'>): WorkspaceUi {
  try {
    const raw = storage.getItem(LATEX_WORKSPACE_UI_KEY)
    if (!raw || raw.length > 1024) return { ...DEFAULT_WORKSPACE_UI }
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('version' in value) || value.version !== 1) return { ...DEFAULT_WORKSPACE_UI }
    const saved = value as Partial<WorkspaceUi>
    return { version: 1,
      drawer: ['closed', 'build', 'problems', 'output', 'history'].includes(saved.drawer ?? '') ? saved.drawer! : 'closed',
      detailsOpen: saved.detailsOpen === true, sourceHeaderCollapsed: saved.sourceHeaderCollapsed === true,
      consoleHeight: typeof saved.consoleHeight === 'number' && Number.isFinite(saved.consoleHeight) ? Math.max(120, Math.min(480, saved.consoleHeight)) : 224,
      outputView: saved.outputView === 'activity' ? 'activity' : 'log' }
  } catch { return { ...DEFAULT_WORKSPACE_UI } }
}

export function writeWorkspaceUi(storage: Pick<Storage, 'setItem'>, value: WorkspaceUi): void {
  try { storage.setItem(LATEX_WORKSPACE_UI_KEY, JSON.stringify(value)) } catch { /* Blocked preference storage never stops editing or saving source. */ }
}

export function consoleHeight(requested: number, viewport: number): number {
  const maximum = Math.max(0, Math.min(480, Math.floor(viewport / 2) - 40))
  return Math.min(maximum, Math.max(Math.min(120, maximum), Number.isFinite(requested) ? requested : 224))
}

export function atOutputEnd(top: number, height: number, viewport: number): boolean { return height - viewport - top <= 24 }

export function visibleBuildLog(log: string, query: string, after = 0) {
  const lines = log.split(/\r\n|\r|\n/u).slice(after), needle = query.trim().toLocaleLowerCase()
  const matches = lines.flatMap((text, index) => !needle || text.toLocaleLowerCase().includes(needle) ? [{ text, line: after + index + 1 }] : [])
  let bytes = 0
  const shown: typeof matches = []
  for (let index = matches.length - 1; index >= 0 && shown.length < 600; index--) {
    bytes += matches[index].text.length
    if (bytes > 64 * 1024) break
    shown.push(matches[index])
  }
  return { lines: shown.reverse(), truncated: shown.length !== matches.length, total: matches.length }
}
