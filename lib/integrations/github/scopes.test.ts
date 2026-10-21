import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_READ_PATH,
  GITHUB_APP_PERMISSIONS,
  GITHUB_SCOPE_DETAILS,
  GITHUB_SCOPE_NON_GOALS,
  GITHUB_SCOPE_SUMMARY,
  githubInstallUrl,
  MARKDOWN_FILE_PATTERN,
  sanitizeBranchName,
  sanitizeRepoPath,
} from './scopes.ts'

test('the declared permissions are scoped to repository contents only', () => {
  assert.deepEqual(GITHUB_APP_PERMISSIONS, { contents: 'write', metadata: 'read' })
  assert.deepEqual(Object.keys(GITHUB_APP_PERMISSIONS).sort(), ['contents', 'metadata'])
})

test('the scope copy names both read and confirmed write', () => {
  assert.match(GITHUB_SCOPE_SUMMARY, /Read/)
  assert.match(GITHUB_SCOPE_SUMMARY, /write back only when you confirm/)
  assert.ok(GITHUB_SCOPE_DETAILS.some((line) => /commit or a pull request/.test(line)))
  assert.ok(GITHUB_SCOPE_NON_GOALS.some((line) => /No automatic or silent writes/.test(line)))
  assert.equal(DEFAULT_READ_PATH, 'README.md')
})

test('githubInstallUrl builds from the slug and encodes it', () => {
  assert.equal(
    githubInstallUrl('smile-pdf'),
    'https://github.com/apps/smile-pdf/installations/new',
  )
})

test('sanitizeRepoPath accepts normal repository paths', () => {
  assert.equal(sanitizeRepoPath('README.md'), 'README.md')
  assert.equal(sanitizeRepoPath('docs/guide/intro.md'), 'docs/guide/intro.md')
  assert.equal(sanitizeRepoPath('  docs/README.md  '), 'docs/README.md')
  assert.equal(sanitizeRepoPath('docs//guide.md'), 'docs/guide.md')
  assert.equal(sanitizeRepoPath('docs\\guide.md'), 'docs/guide.md')
  assert.equal(sanitizeRepoPath('.github/CONTRIBUTING.md'), '.github/CONTRIBUTING.md')
})

test('sanitizeRepoPath refuses traversal and absolute paths', () => {
  assert.equal(sanitizeRepoPath('../secrets.env'), null)
  assert.equal(sanitizeRepoPath('docs/../../etc/passwd'), null)
  assert.equal(sanitizeRepoPath('/etc/passwd'), null)
  assert.equal(sanitizeRepoPath('C:/Windows/system32'), null)
  assert.equal(sanitizeRepoPath(''), null)
  assert.equal(sanitizeRepoPath('   '), null)
  assert.equal(sanitizeRepoPath('docs//'), null)
  assert.equal(sanitizeRepoPath('a'.repeat(500)), null)
})

test('sanitizeBranchName accepts ordinary branch names', () => {
  assert.equal(sanitizeBranchName('main'), 'main')
  assert.equal(sanitizeBranchName('feature/read-write'), 'feature/read-write')
  assert.equal(sanitizeBranchName('release/v1.2.3'), 'release/v1.2.3')
  assert.equal(sanitizeBranchName('  docs/tidy  '), 'docs/tidy')
  assert.equal(sanitizeBranchName('a//b'), 'a/b')
})

test('sanitizeBranchName refuses ref-unsafe input', () => {
  assert.equal(sanitizeBranchName(''), null)
  assert.equal(sanitizeBranchName('/main'), null)
  assert.equal(sanitizeBranchName('main/'), null)
  assert.equal(sanitizeBranchName('..'), null)
  assert.equal(sanitizeBranchName('feature/../main'), null)
  assert.equal(sanitizeBranchName('bad name'), null)
  assert.equal(sanitizeBranchName('bad~1'), null)
  assert.equal(sanitizeBranchName('bad^'), null)
  assert.equal(sanitizeBranchName('bad:ref'), null)
  assert.equal(sanitizeBranchName('release.lock'), null)
  assert.equal(sanitizeBranchName('a'.repeat(300)), null)
})

test('MARKDOWN_FILE_PATTERN matches the Markdown extensions only', () => {
  assert.ok(MARKDOWN_FILE_PATTERN.test('README.md'))
  assert.ok(MARKDOWN_FILE_PATTERN.test('docs/GUIDE.MARKDOWN'))
  assert.ok(MARKDOWN_FILE_PATTERN.test('page.mdx'))
  assert.ok(!MARKDOWN_FILE_PATTERN.test('script.ts'))
  assert.ok(!MARKDOWN_FILE_PATTERN.test('archive.md.zip'))
})
