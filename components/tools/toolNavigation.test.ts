import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { tools } from '../../lib/tools/registry.ts'
import { filterNavigation, isNavigationUnavailable, isPaletteShortcut, navigationEntries, navigationGroupOf, navigationGroups, recentNavigation } from './toolNavigation.ts'

test('the index covers every registered tool once plus three independent workspaces', () => {
  assert.equal(navigationEntries.length, tools.length + 3)
  assert.equal(new Set(navigationEntries.map((entry) => entry.id)).size, navigationEntries.length)
  for (const tool of tools) {
    const entry = navigationEntries.find((item) => item.id === tool.id)
    assert.ok(entry)
    assert.equal(entry.href, tool.href)
    assert.equal(entry.label, tool.label)
    assert.equal(entry.description, tool.description)
  }
  assert.deepEqual(navigationEntries.filter((entry) => entry.group === 'Workspaces').map((entry) => entry.id), ['pdf-editor', 'document-ai', 'image-editor'])
})

test('navigation groups are ordered without mutating registry groups', () => {
  assert.deepEqual(filterNavigation('').map((group) => group.group), navigationGroups)
  assert.deepEqual(filterNavigation('').map((group) => group.entries.length), [6, 4, 2, 2, 1, 3])
  assert.equal(tools.find((tool) => tool.id === 'split-pdf')?.group, 'Convert')
})

test('search matches names and real format aliases with whitespace and case normalization', () => {
  const ids = (query: string) => filterNavigation(query).flatMap((group) => group.entries.map((entry) => entry.id))
  assert.deepEqual(ids('  OCR  '), ['image-to-text'])
  assert.ok(ids('DOCX').includes('pdf-to-word'))
  assert.ok(ids('DNA').includes('fasta-tools'))
  assert.ok(ids('PDF   Word').includes('pdf-to-word'))
  assert.ok(ids('Ｍａｒｋｄｏｗｎ').includes('pdf-to-markdown'))
  assert.deepEqual(ids('no such instrument xyz'), [])
})

test('the index uses canonical routes and does not invent a collation tool', () => {
  assert.equal(navigationEntries.find((entry) => entry.id === 'pdf-to-markdown')?.href, '/mr-markdown')
  assert.ok(navigationEntries.every((entry) => entry.href !== '/pdf-tools' && entry.href !== '/pdf-to-markdown'))
  assert.ok(navigationEntries.every((entry) => !entry.href.includes('merge-markdown')))
})

test('only a confirmed availability snapshot can disable an entry', () => {
  const entry = navigationEntries[0]
  assert.equal(isNavigationUnavailable(entry, { status: 'ready', enabled: () => false }), true)
  assert.equal(isNavigationUnavailable(entry, { status: 'ready', enabled: () => true }), false)
  assert.equal(isNavigationUnavailable(entry, { status: 'loading', enabled: () => false }), false)
  assert.equal(isNavigationUnavailable(entry, { status: 'error', enabled: () => false }), false)
})

test('availability uses the tool ID, never a label, href, or legacy alias', () => {
  const entry = navigationEntries.find((item) => item.id === 'pdf-to-markdown')!
  assert.equal(isNavigationUnavailable(entry, { status: 'ready', enabled: (id) => id === 'pdf-to-markdown' }), false)
  assert.equal(isNavigationUnavailable(entry, { status: 'ready', enabled: (id) => id === 'mr-markdown' }), true)
})

test('Bangla words find the same tools as English ones', () => {
  const ids = (query: string) => filterNavigation(query).flatMap((group) => group.entries.map((entry) => entry.id))
  assert.deepEqual(ids('জোড়া'), ['merge-pdf'])
  assert.deepEqual(ids('ভাগ'), ['split-pdf'])
  assert.deepEqual(ids('সংকোচন'), ['compress-pdf'])
  assert.ok(ids('বিজয়').includes('bijoy-converter'))
  assert.ok(ids('ওসিআর').includes('image-to-text'))
})

test('the breadcrumb group comes from the navigation projection', () => {
  assert.equal(navigationGroupOf('merge-pdf'), 'PDF Operations')
  assert.equal(navigationGroupOf('pdf-to-word'), 'Convert Files')
  assert.equal(navigationGroupOf('pdf-editor'), 'Workspaces')
})

test('recent tools are distinct, newest first, real, and never the current page', () => {
  const history = [
    { toolId: 'merge-pdf', at: 10 },
    { toolId: 'compress-pdf', at: 40 },
    { toolId: 'merge-pdf', at: 30 },
    { toolId: 'not-a-tool', at: 50 },
    { toolId: 'split-pdf', at: 20 },
    { toolId: 'rotate-pdf', at: 5 },
  ]
  assert.deepEqual(recentNavigation(history, 'compress-pdf').map((entry) => entry.id), ['merge-pdf', 'split-pdf', 'rotate-pdf'])
  assert.deepEqual(recentNavigation(history, 'image-to-pdf', 2).map((entry) => entry.id), ['compress-pdf', 'merge-pdf'])
  assert.deepEqual(recentNavigation([], 'merge-pdf'), [])
})

test('Ctrl/⌘K opens the palette only when nobody else owns the keystroke', () => {
  const key = { key: 'k', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, targetIsEditable: false, modalOpen: false }
  assert.equal(isPaletteShortcut(key), true)
  assert.equal(isPaletteShortcut({ ...key, ctrlKey: false, metaKey: true, key: 'K' }), true)
  assert.equal(isPaletteShortcut({ ...key, ctrlKey: false }), false)
  assert.equal(isPaletteShortcut({ ...key, shiftKey: true }), false)
  assert.equal(isPaletteShortcut({ ...key, defaultPrevented: true }), false)
  assert.equal(isPaletteShortcut({ ...key, targetIsEditable: true }), false)
  assert.equal(isPaletteShortcut({ ...key, modalOpen: true }), false)
  assert.equal(isPaletteShortcut({ ...key, key: 'j' }), false)
})
