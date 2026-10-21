'use client'

import { repoPrivateGlyph, repoPublicGlyph } from '../icons'

/**
 * The repository visibility chip — a globe for public, a padlock for private.
 *
 * It exists because "who can already see this repo" is a precondition for
 * publishing to it, and the owner should never have to guess. The chip renders
 * nothing when visibility is unknown, so it can never claim a state the server
 * has not observed (no-lie): a private repo must never read as public.
 */
export default function RepoVisibilityBadge({
  visibility,
}: {
  visibility: 'public' | 'private' | null | undefined
}) {
  if (visibility !== 'public' && visibility !== 'private') return null
  const isPrivate = visibility === 'private'
  return (
    <span
      className={`mr-cfg-gh-vis ${isPrivate ? 'is-private' : 'is-public'}`}
      title={isPrivate ? 'Private repository — only people you invite can see it' : 'Public repository — anyone can see it'}
    >
      <span className="mr-cfg-gh-vis-mark" aria-hidden="true">
        {isPrivate ? repoPrivateGlyph : repoPublicGlyph}
      </span>
      {visibility}
    </span>
  )
}
