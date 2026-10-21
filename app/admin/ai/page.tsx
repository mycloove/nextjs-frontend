import { keyringStatus, type KeyringPrisma } from '@/lib/ai/keyring.ts'
import { featureChains, listAiProviderViews } from '@/lib/ai/store.ts'
import type { FeatureChainView, KeyringStatus, ProviderView } from '@/lib/ai/types.ts'
import { adminEntryRedirect, requireAdmin } from '@/lib/usage/admin'
import { getPrisma } from '@/lib/usage/store'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import AiDesk from '../AiDesk'

export const metadata: Metadata = {
  title: 'AI Providers',
  description: 'Manage the cloud providers that answer Document AI and the AI Analyzer, provider by provider.',
}

export default async function AdminAiPage() {
  const gate = await requireAdmin()
  const entry = adminEntryRedirect(gate)
  if (entry) redirect(entry)

  const canWrite = gate.ok && gate.role === 'Owner'
  let providers: ProviderView[] = []
  let features: FeatureChainView[] = []
  let loadError = ''
  let encryption: KeyringStatus = { ready: false, locked: false, mode: null, message: '' }
  if (!gate.ok) {
    loadError = gate.message ?? 'The bench is unavailable.'
  } else {
    const prisma = getPrisma()
    encryption = prisma
      ? await keyringStatus(prisma as unknown as KeyringPrisma)
      : { ready: false, locked: true, mode: null, message: 'DATABASE_URL is not set, so provider keys cannot be read or saved.' }
    try {
      providers = await listAiProviderViews()
      features = featureChains(providers)
    } catch (error) {
      loadError = error instanceof Error ? error.message : 'Could not load AI providers'
    }
  }

  return (
    <AiDesk
      initialProviders={providers}
      initialFeatures={features}
      canWrite={canWrite}
      initialEncryption={encryption}
      loadError={loadError}
    />
  )
}
