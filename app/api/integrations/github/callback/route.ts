import { getInstallation, readGithubAppConfig } from '@/lib/integrations/github/app'
import { PENDING_STATE_COOKIE, verifyPendingState } from '@/lib/integrations/github/state'
import { saveGithubInstallation } from '@/lib/integrations/store'
import { NextResponse, type NextRequest } from 'next/server'
import { requestIdOf, requireSession } from '../_shared'

export const dynamic = 'force-dynamic'

const RETURN_PATH = '/mr-markdown'

/**
 * GET /api/integrations/github/callback
 *
 * GitHub's Setup URL. Because it arrives as a top-level browser navigation this
 * route answers with redirects, never JSON: back to the workspace carrying an
 * honest `?github=` status the section reads.
 *
 * Two guards make a hand-crafted callback harmless, in order:
 *  1. the cookie-bound nonce minted by `/install` must verify (CSRF), and
 *  2. the `installation_id` must resolve against **our** App via an App JWT
 *     (`GET /app/installations/{id}`), so a forged id or another App's id 404s.
 */
export async function GET(request: NextRequest) {
  const requestId = requestIdOf(request)
  const url = new URL(request.url)
  const installationId = url.searchParams.get('installation_id')?.trim() ?? ''
  const setupAction = url.searchParams.get('setup_action') ?? ''

  const back = (status: string) => NextResponse.redirect(new URL(`${RETURN_PATH}?github=${status}`, url.origin))
  const clearPending = (response: NextResponse) => {
    response.cookies.delete(PENDING_STATE_COOKIE)
    return response
  }

  const session = await requireSession()
  if (!session) {
    // A connect needs an account to bind to: send the visitor to sign in and
    // straight back to the workspace. No connection state is written.
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(RETURN_PATH)}`, url.origin))
  }

  const config = readGithubAppConfig()
  if (!config || !config.clientSecret) return clearPending(back('config-missing'))

  const pending = request.cookies.get(PENDING_STATE_COOKIE)?.value
  if (!verifyPendingState(config.clientSecret, pending)) return back('denied')
  // An org owner can defer approval: GitHub returns `setup_action=request` with no
  // installation yet. Report the honest waiting state instead of a false failure.
  if (setupAction === 'request' && !installationId) return clearPending(back('pending'))
  if (!installationId) return clearPending(back('denied'))

  try {
    const installation = await getInstallation(config, installationId)
    await saveGithubInstallation({
      userId: session.id,
      installationId: installation.id,
      accountLogin: installation.accountLogin,
      accountType: installation.accountType,
      audit: { actorId: session.id, actorEmail: session.email, requestId },
    })
    // `setup_action=update` means an existing installation was edited (e.g. repos
    // added); the connection is valid either way, so no branch is needed beyond
    // binding it.
    return clearPending(back('connected'))
  } catch (error) {
    console.error('GitHub callback failed', { requestId, error: error instanceof Error ? error.message : error })
    return clearPending(back('error'))
  }
}
