import assert from 'node:assert/strict'
import test from 'node:test'
import { branchNameFor } from './publish.ts'
import { sanitizeBranchName } from './scopes.ts'

const NOW = new Date('2026-10-16T07:05:09.000Z')

test('branchNameFor builds a namespaced, timestamped, ref-safe branch', () => {
  const name = branchNameFor('docs/README.md', NOW, 'a1b2c3')
  assert.equal(name, 'mycloove/readme-20261016-070509-a1b2c3')
  // It must always survive our own ref sanitizer and git's rules.
  assert.equal(sanitizeBranchName(name), name)
})

test('branchNameFor slugifies awkward file names and never leaves empty segments', () => {
  assert.equal(branchNameFor('My Notes & Ideas.md', NOW, 'ff'), 'mycloove/my-notes-ideas-20261016-070509-ff')
  assert.equal(branchNameFor('documents/', NOW, 'ff'), 'mycloove/documents-20261016-070509-ff')
  assert.equal(branchNameFor('.md', NOW, 'ff'), 'mycloove/document-20261016-070509-ff')
  assert.ok(sanitizeBranchName(branchNameFor('a/b/c/ünïcode.md', NOW, 'zz')) !== null)
})

test('branchNameFor strips a nonce to safe characters and truncates it', () => {
  const name = branchNameFor('README.md', NOW, 'aa!bb!!cc!!dd')
  assert.match(name, /-aabbcc$/)
  assert.equal(sanitizeBranchName(branchNameFor('README.md', NOW, '!!!')), 'mycloove/readme-20261016-070509-x')
})

test('branchNameFor output is deterministic for the same inputs', () => {
  assert.equal(branchNameFor('x.md', NOW, 'n1'), branchNameFor('x.md', NOW, 'n1'))
  assert.notEqual(branchNameFor('x.md', NOW, 'n1'), branchNameFor('x.md', NOW, 'n2'))
})
