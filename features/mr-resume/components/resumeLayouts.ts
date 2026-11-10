// The Regular editor's visual layouts. A layout only re-arranges the SAME
// sections on the page; content, order and settings stay the user's. Pure data
// so the editor, the template catalog and the tests share one definition.

export type ResumeLayoutId = 'classic' | 'ledger' | 'compact' | 'executive' | 'banner' | 'sidebar' | 'twocol' | 'biodata'

export type ResumeLayout = {
  readonly id: ResumeLayoutId
  readonly name: string
  readonly detail: string
  readonly columns: 1 | 2 | 'sidebar'
  /** Sections that move into the narrow column when the layout has one. */
  readonly rail: readonly string[]
}

export const DEFAULT_RESUME_LAYOUT: ResumeLayoutId = 'classic'

export const resumeLayouts: readonly ResumeLayout[] = [
  { id: 'classic', name: 'Classic', detail: 'One column with an accent rule beneath the header.', columns: 1, rail: [] },
  { id: 'ledger', name: 'Ledger', detail: 'One column, ruled headings and edge-aligned dates.', columns: 1, rail: [] },
  { id: 'compact', name: 'Compact', detail: 'Dense one column that keeps more on one page.', columns: 1, rail: [] },
  { id: 'executive', name: 'Executive', detail: 'Generous margins, double rule and a framed summary.', columns: 1, rail: [] },
  { id: 'banner', name: 'Banner', detail: 'Name and contacts on a full-width colour band.', columns: 1, rail: [] },
  { id: 'sidebar', name: 'Sidebar', detail: 'Skills, languages and awards in a tinted side rail.', columns: 'sidebar', rail: ['skills', 'languages', 'awards', 'personal', 'volunteer'] },
  { id: 'twocol', name: 'Two column', detail: 'Work on the left, education and skills on the right.', columns: 2, rail: ['education', 'skills', 'languages', 'awards', 'references', 'volunteer', 'personal'] },
  { id: 'biodata', name: 'Biodata', detail: 'Formal biodata: centred title, banded headings, photo beside the name.', columns: 1, rail: [] },
]

export const resumeLayoutIds: readonly ResumeLayoutId[] = resumeLayouts.map((layout) => layout.id)

export function getResumeLayout(id: string | null | undefined): ResumeLayout {
  return resumeLayouts.find((layout) => layout.id === id) ?? resumeLayouts[0]
}

/**
 * Split the enabled (non-profile) sections into the main flow and the rail,
 * preserving the user's order inside each. A layout without a rail, or a rail
 * that would end up empty, keeps everything in one flow.
 */
export function partitionSections(layoutId: string | null | undefined, ids: readonly string[]): { main: string[]; rail: string[] } {
  const layout = getResumeLayout(layoutId)
  const body = ids.filter((id) => id !== 'profile')
  if (!layout.rail.length) return { main: body, rail: [] }
  const rail = body.filter((id) => layout.rail.includes(id))
  const main = body.filter((id) => !layout.rail.includes(id))
  return rail.length && main.length ? { main, rail } : { main: body, rail: [] }
}
