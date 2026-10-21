import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeConnectionStatus,
  toConnectionView,
  toRepoLinkView,
  type ConnectionRowLike,
} from './types.ts'

/**
 * The mapping from a stored row to the browser DTO is the one place a token
 * could leak and the one place an unknown status could masquerade as connected.
 * These tests pin both properties.
 */

test('toConnectionView maps a full row and never emits a token field', () => {
  const row: ConnectionRowLike = {
    externalId: '12345',
    accountLogin: 'octocat',
    accountType: 'User',
    status: 'connected',
    createdAt: new Date('2026-01-02T03:04:05.000Z'),
    links: [
      {
        repoId: '99',
        repoFullName: 'octocat/hello-world',
        defaultBranch: 'main',
        selectedPath: 'README.md',
        lastReadAt: new Date('2026-01-03T00:00:00.000Z'),
      },
    ],
  }

  const view = toConnectionView(row)
  assert.equal(view.provider, 'github')
  assert.equal(view.installation_id, '12345')
  assert.equal(view.status, 'connected')
  assert.equal(view.connected_at, '2026-01-02T03:04:05.000Z')
  assert.deepEqual(view.repo, {
    repo_id: '99',
    repo_full_name: 'octocat/hello-world',
    default_branch: 'main',
    selected_path: 'README.md',
    last_read_at: '2026-01-03T00:00:00.000Z',
    visibility: null,
  })
  assert.deepEqual(Object.keys(view).sort(), [
    'account_login',
    'account_type',
    'connected_at',
    'installation_id',
    'provider',
    'repo',
    'status',
  ])
})

test('toConnectionView reports null repo before a repository is chosen', () => {
  const view = toConnectionView({
    externalId: '1',
    accountLogin: null,
    accountType: null,
    status: 'connected',
    createdAt: '2026-01-02T03:04:05.000Z',
    links: [],
  })
  assert.equal(view.repo, null)
  assert.equal(view.account_login, null)
})

test('an unrecognised stored status resolves to needs_reauth, never connected', () => {
  assert.equal(normalizeConnectionStatus('connected'), 'connected')
  assert.equal(normalizeConnectionStatus('revoked'), 'needs_reauth')
  assert.equal(normalizeConnectionStatus('expired'), 'needs_reauth')
  assert.equal(normalizeConnectionStatus(''), 'needs_reauth')
})

test('toRepoLinkView tolerates a null last-read and accepts a string date', () => {
  const link = toRepoLinkView({
    repoId: '1',
    repoFullName: 'a/b',
    defaultBranch: null,
    selectedPath: null,
    lastReadAt: '2026-05-05T00:00:00.000Z',
  })
  assert.equal(link.last_read_at, '2026-05-05T00:00:00.000Z')
  const never = toRepoLinkView({
    repoId: '2',
    repoFullName: 'a/c',
    defaultBranch: 'main',
    selectedPath: 'docs/README.md',
    lastReadAt: null,
  })
  assert.equal(never.last_read_at, null)
  assert.equal(never.selected_path, 'docs/README.md')
})

test('visibility is only ever the two known values, never a guess', () => {
  const base = {
    repoId: '1',
    repoFullName: 'a/b',
    defaultBranch: 'main',
    selectedPath: null,
    lastReadAt: null,
  }
  assert.equal(toRepoLinkView({ ...base, visibility: 'public' }).visibility, 'public')
  assert.equal(toRepoLinkView({ ...base, visibility: 'private' }).visibility, 'private')
  assert.equal(toRepoLinkView(base).visibility, null)
  assert.equal(toRepoLinkView({ ...base, visibility: 'internal' }).visibility, null)
})
