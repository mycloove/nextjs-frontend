import { encryptWithKey, decryptWithKey } from '@/lib/ai/crypto'
import { getDataKey, type KeyringPrisma } from '@/lib/ai/keyring'
import { appendAdminAudit, getPrisma, type AdminAuditContext } from '@/lib/usage/store'
import { Prisma } from '@prisma/client'
import { GITHUB_PROVIDER_ID, toConnectionView, type GithubConnectionView } from './types'

/**
 * Persistence for external integration connections.
 *
 * Follows the usage store's conventions: a shared `getPrisma()` singleton, one
 * transaction per write with an audit row, and writes that throw (an owner must
 * know a connect failed) while reads degrade to `null` rather than dead-ending
 * the panel.
 *
 * The installation access token is never written here — only the installation id
 * and the chosen repository. `account_login`/`account_type` are stored in the
 * clear (they are not secret, and the UI must render them even when the keyring
 * is unavailable); `sealedMeta` is an additional encrypted-at-rest copy under the
 * shared data key, used only as a fallback if the plaintext columns are ever
 * cleared.
 */

export class IntegrationStoreMissing extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IntegrationStoreMissing'
  }
}

export class IntegrationNotConnected extends Error {
  constructor(message = 'No GitHub connection is stored for this account.') {
    super(message)
    this.name = 'IntegrationNotConnected'
  }
}

function requirePrisma() {
  const prisma = getPrisma()
  if (!prisma) {
    throw new IntegrationStoreMissing('DATABASE_URL is not set. Apply the Prisma migration, then restart.')
  }
  return prisma
}

function rethrowStore(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && (error.code === 'P2021' || error.code === 'P2022')) {
    throw new IntegrationStoreMissing('The integration tables are missing. Run npx prisma migrate deploy in nextjs-frontend.')
  }
  throw error
}

/**
 * A best-effort sealed copy of the account metadata. Sealing is defence-in-depth
 * for data that is not itself secret; if the shared data key cannot be loaded the
 * connect still succeeds, because the plaintext columns are the operational
 * source of truth. A failure is logged (never the value) rather than thrown.
 */
async function sealMeta(meta: Record<string, unknown>): Promise<string | null> {
  try {
    const prisma = requirePrisma()
    const key = await getDataKey(prisma as unknown as KeyringPrisma)
    return encryptWithKey(key, JSON.stringify(meta))
  } catch (error) {
    console.warn(
      'Integration metadata was stored unsealed (the data key is unavailable).',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

async function openMeta(envelope: string | null): Promise<Record<string, unknown> | null> {
  if (!envelope) return null
  try {
    const prisma = requirePrisma()
    const key = await getDataKey(prisma as unknown as KeyringPrisma)
    return JSON.parse(decryptWithKey(key, envelope)) as Record<string, unknown>
  } catch {
    return null
  }
}

const CONNECTION_SELECT = {
  externalId: true,
  accountLogin: true,
  accountType: true,
  status: true,
  createdAt: true,
  sealedMeta: true,
  links: {
    orderBy: { repoFullName: 'asc' as const },
    take: 1,
    select: {
      repoId: true,
      repoFullName: true,
      defaultBranch: true,
      selectedPath: true,
      lastReadAt: true,
    },
  },
} satisfies Prisma.IntegrationConnectionSelect

type SelectedConnection = Prisma.IntegrationConnectionGetPayload<{ select: typeof CONNECTION_SELECT }>

/**
 * The account's single GitHub connection, or null. Reads only the caller's row,
 * so it can never surface another account's installation.
 */
export async function readGithubConnection(userId: string): Promise<GithubConnectionView | null> {
  const prisma = requirePrisma()
  try {
    const row: SelectedConnection | null = await prisma.integrationConnection.findFirst({
      where: { userId, provider: GITHUB_PROVIDER_ID },
      orderBy: { createdAt: 'desc' },
      select: CONNECTION_SELECT,
    })
    if (!row) return null
    const view = toConnectionView(row)
    if (!view.account_login && row.sealedMeta) {
      const meta = await openMeta(row.sealedMeta)
      if (meta) {
        view.account_login = typeof meta.account_login === 'string' ? meta.account_login : view.account_login
        view.account_type = typeof meta.account_type === 'string' ? meta.account_type : view.account_type
      }
    }
    return view
  } catch (error) {
    rethrowStore(error)
  }
}

/** The installation id only — used server-side to mint tokens. */
export async function readGithubInstallationId(userId: string): Promise<string | null> {
  const prisma = requirePrisma()
  try {
    const row = await prisma.integrationConnection.findFirst({
      where: { userId, provider: GITHUB_PROVIDER_ID },
      orderBy: { createdAt: 'desc' },
      select: { externalId: true },
    })
    return row?.externalId ?? null
  } catch (error) {
    rethrowStore(error)
  }
}

export type SaveInstallationInput = {
  userId: string
  installationId: string
  accountLogin: string | null
  accountType: string | null
  audit?: AdminAuditContext
}

/**
 * Binds a verified installation to the account. Any previous GitHub connection
 * for this account is removed first so a re-install is a clean replace rather
 * than a second live link; the cascade clears its repo link.
 */
export async function saveGithubInstallation(input: SaveInstallationInput): Promise<GithubConnectionView> {
  const prisma = requirePrisma()
  const sealed = await sealMeta({ account_login: input.accountLogin, account_type: input.accountType })
  try {
    const row = await prisma.$transaction(async (tx) => {
      const before = await tx.integrationConnection.findFirst({
        where: { userId: input.userId, provider: GITHUB_PROVIDER_ID },
        select: { id: true, externalId: true },
      })
      if (before && before.externalId !== input.installationId) {
        await tx.integrationConnection.delete({ where: { id: before.id } })
      }
      const saved = await tx.integrationConnection.upsert({
        where: {
          userId_provider_externalId: {
            userId: input.userId,
            provider: GITHUB_PROVIDER_ID,
            externalId: input.installationId,
          },
        },
        create: {
          userId: input.userId,
          provider: GITHUB_PROVIDER_ID,
          externalId: input.installationId,
          accountLogin: input.accountLogin,
          accountType: input.accountType,
          status: 'connected',
          sealedMeta: sealed,
        },
        update: {
          accountLogin: input.accountLogin,
          accountType: input.accountType,
          status: 'connected',
          sealedMeta: sealed,
        },
        select: CONNECTION_SELECT,
      })
      if (input.audit) {
        await appendAdminAudit(tx, input.audit, {
          action: 'integration.github.connect',
          targetType: 'integration-connection',
          targetId: saved.externalId,
          ...(before ? { before: { installation_id: before.externalId } } : {}),
          after: { installation_id: saved.externalId, account_login: saved.accountLogin, account_type: saved.accountType },
        })
      }
      return saved
    })
    return toConnectionView(row)
  } catch (error) {
    rethrowStore(error)
  }
}

export type SelectRepoInput = {
  userId: string
  repoId: string
  repoFullName: string
  defaultBranch: string | null
  selectedPath: string | null
  audit?: AdminAuditContext
}

/**
 * Chooses the single repository (and optional branch/file) the connection reads
 * from. Replaces any prior choice — V1 is deliberately one repo, so the picker
 * is a choice, not an accumulating list.
 */
export async function selectGithubRepo(input: SelectRepoInput): Promise<GithubConnectionView> {
  const prisma = requirePrisma()
  try {
    const row = await prisma.$transaction(async (tx) => {
      const connection = await tx.integrationConnection.findFirst({
        where: { userId: input.userId, provider: GITHUB_PROVIDER_ID },
        orderBy: { createdAt: 'desc' },
        select: { id: true, externalId: true },
      })
      if (!connection) throw new IntegrationNotConnected()
      await tx.integrationRepoLink.deleteMany({ where: { connectionId: connection.id } })
      await tx.integrationRepoLink.create({
        data: {
          connectionId: connection.id,
          repoId: input.repoId,
          repoFullName: input.repoFullName,
          defaultBranch: input.defaultBranch,
          selectedPath: input.selectedPath,
        },
      })
      const saved = await tx.integrationConnection.findUniqueOrThrow({
        where: { id: connection.id },
        select: CONNECTION_SELECT,
      })
      if (input.audit) {
        await appendAdminAudit(tx, input.audit, {
          action: 'integration.github.repo.select',
          targetType: 'integration-connection',
          targetId: connection.externalId,
          after: { repo: input.repoFullName, branch: input.defaultBranch, path: input.selectedPath },
        })
      }
      return saved
    })
    return toConnectionView(row)
  } catch (error) {
    if (error instanceof IntegrationNotConnected) throw error
    rethrowStore(error)
  }
}

/** Records the last successful read so the connected card can show an honest time. */
export async function touchGithubRead(userId: string, repoId: string, at: Date = new Date()): Promise<void> {
  const prisma = requirePrisma()
  try {
    await prisma.integrationRepoLink.updateMany({
      where: { repoId, connection: { userId, provider: GITHUB_PROVIDER_ID } },
      data: { lastReadAt: at },
    })
  } catch (error) {
    rethrowStore(error)
  }
}

/**
 * Marks the connection as needing re-authentication when GitHub answers 401/404
 * for its installation. The documented path is honest failure over a stale
 * "connected": the UI shows a reconnect banner until it is repaired.
 */
export async function markGithubConnectionNeedsReauth(userId: string): Promise<void> {
  const prisma = requirePrisma()
  try {
    await prisma.integrationConnection.updateMany({
      where: { userId, provider: GITHUB_PROVIDER_ID, status: 'connected' },
      data: { status: 'needs_reauth' },
    })
  } catch (error) {
    rethrowStore(error)
  }
}

/** Removes the account's connection; the repo link cascades away. */
export async function deleteGithubConnection(userId: string, audit?: AdminAuditContext): Promise<boolean> {
  const prisma = requirePrisma()
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.integrationConnection.findFirst({
        where: { userId, provider: GITHUB_PROVIDER_ID },
        orderBy: { createdAt: 'desc' },
        select: { id: true, externalId: true },
      })
      if (!before) return false
      await tx.integrationConnection.delete({ where: { id: before.id } })
      if (audit) {
        await appendAdminAudit(tx, audit, {
          action: 'integration.github.disconnect',
          targetType: 'integration-connection',
          targetId: before.externalId,
          before: { installation_id: before.externalId },
          after: { removed: true },
        })
      }
      return true
    })
  } catch (error) {
    rethrowStore(error)
  }
}

/** The stored installation id for a given external id, used by the webhook. */
export async function readConnectionOwner(installationId: string): Promise<{ userId: string; status: string } | null> {
  const prisma = requirePrisma()
  try {
    const row = await prisma.integrationConnection.findFirst({
      where: { provider: GITHUB_PROVIDER_ID, externalId: installationId },
      select: { userId: true, status: true },
    })
    return row ?? null
  } catch (error) {
    rethrowStore(error)
  }
}

/** Applies a webhook-driven installation state change (Phase 3). */
export async function setConnectionState(installationId: string, status: string): Promise<number> {
  const prisma = requirePrisma()
  try {
    const result = await prisma.integrationConnection.updateMany({
      where: { provider: GITHUB_PROVIDER_ID, externalId: installationId },
      data: { status },
    })
    return result.count
  } catch (error) {
    rethrowStore(error)
  }
}
