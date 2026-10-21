import { adminEntryRedirect, requireAdmin } from '@/lib/usage/admin'
import { listAdminToolControlsGrouped, readAdminUsageSummaries } from '@/lib/usage/controls'
import type { ToolControl, ToolUsageSummary } from '@/lib/usage/types'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import ControlDesk from '../ControlDesk'
import { windowClears } from '../format'

export const metadata: Metadata = {
  title: 'Tools',
  description: 'Open or withdraw each tool, and set how many completed calls guests and signed-in people have left.',
}

export default async function AdminToolsPage() {
  const gate = await requireAdmin()
  const entry = adminEntryRedirect(gate)
  if (entry) redirect(entry)
  if (gate.ok && gate.role === 'Viewer') redirect('/admin/overview')
  if (!gate.ok) {
    return (
      <ControlDesk
        initialTools={[]}
        initialUsage={{}}
        usageDegraded
        usageError=""
        loadError={gate.message ?? 'The bench is unavailable.'}
      />
    )
  }

  let tools: ToolControl[] = []
  let loadError = ''
  try {
    tools = await listAdminToolControlsGrouped()
  } catch (error) {
    loadError = error instanceof Error ? error.message : 'Could not load the tools'
  }

  /*
   * Usage is a display read, not an enforcement read: a store that is missing or
   * unreachable must take the gauges down with it rather than the page, and the
   * desk says which one went. Both readers are read-only on existing tables, so
   * there is nothing to migrate for this page to work.
   */
  const usageRead = await readAdminUsageSummaries()
  const usage: Record<string, ToolUsageSummary> = {}
  for (const [toolId, summary] of Object.entries(usageRead.data)) {
    usage[toolId] = { ...summary, clears_label: windowClears(summary.oldest_24h) }
  }

  return (
    <ControlDesk
      initialTools={tools}
      initialUsage={usage}
      usageDegraded={usageRead.degraded}
      usageError={usageRead.message}
      loadError={loadError}
    />
  )
}
