import assert from 'node:assert/strict'
import test from 'node:test'

import { buildGithubSourceId, parseGithubSourceId } from './githubSourceId.ts'

test('builds and parses a complete GitHub source key', () => {
  const key = buildGithubSourceId('acme/docs', 'main', 'guides/getting-started.md')
  assert.equal(key, 'github:acme/docs@main:guides/getting-started.md')
  assert.deepEqual(parseGithubSourceId(key), {
    repoFullName: 'acme/docs',
    branch: 'main',
    path: 'guides/getting-started.md',
  })
})

test('round-trips a branch that contains slashes', () => {
  const key = buildGithubSourceId('acme/docs', 'release/v1.2', 'README.md')
  assert.deepEqual(parseGithubSourceId(key), {
    repoFullName: 'acme/docs',
    branch: 'release/v1.2',
    path: 'README.md',
  })
})

test('a path may itself contain @ and / without confusing the parser', () => {
  const key = buildGithubSourceId('acme/docs', 'main', 'a/b@c/d.md')
  assert.deepEqual(parseGithubSourceId(key), {
    repoFullName: 'acme/docs',
    branch: 'main',
    path: 'a/b@c/d.md',
  })
})

test('rejects anything that is not a complete github key, and never throws', () => {
  assert.equal(parseGithubSourceId(undefined), null)
  assert.equal(parseGithubSourceId(null), null)
  assert.equal(parseGithubSourceId(''), null)
  assert.equal(parseGithubSourceId('main:README.md'), null)
  assert.equal(parseGithubSourceId('github:'), null)
  assert.equal(parseGithubSourceId('github:acme/docs'), null)
  assert.equal(parseGithubSourceId('github:acme/docs@main'), null)
  assert.equal(parseGithubSourceId('github:acme/docs@:README.md'), null)
  assert.equal(parseGithubSourceId('github:@main:README.md'), null)
  assert.equal(parseGithubSourceId('github:acme/docs@main:'), null)
})
