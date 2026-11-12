import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GLOBAL_NAV, anchorIds, currentKind, isCurrentLink, isNavLink, isSamePageAnchor, scrollProgress, sectionId } from './siteNav.ts'

test('anchors and routes are told apart', () => {
  assert.equal(sectionId('/#tools'), 'tools')
  assert.equal(sectionId('#gallery'), 'gallery')
  assert.equal(sectionId('/pricing'), null)
  assert.equal(sectionId('/#'), null)
  assert.deepEqual(anchorIds(GLOBAL_NAV), ['tools'])
  assert.equal(currentKind('/#tools'), 'location')
  assert.equal(currentKind('/pricing'), 'page')
  assert.equal(isSamePageAnchor('#gallery'), true)
  assert.equal(isSamePageAnchor('/#tools'), false)
  assert.equal(isSamePageAnchor('#'), false)
})

test('actions sit in the index without being treated as links', () => {
  const items = [{ href: '#converter', label: 'Converter' }, { label: 'Shortcuts', onClick: () => {} }]
  assert.deepEqual(items.map(isNavLink), [true, false])
  assert.deepEqual(anchorIds(items), ['converter'])
})

test('an anchor is current only on its own page while its section is in view', () => {
  assert.equal(isCurrentLink('/#tools', '/', 'tools'), true)
  assert.equal(isCurrentLink('/#tools', '/', null), false)
  assert.equal(isCurrentLink('/#tools', '/pricing', 'tools'), false)
  // A same-page anchor ("#gallery") belongs to whichever page renders it.
  assert.equal(isCurrentLink('#gallery', '/mr-resume', 'gallery'), true)
})

test('a route is current on itself and beneath it, never by prefix alone', () => {
  assert.equal(isCurrentLink('/pricing', '/pricing', null), true)
  assert.equal(isCurrentLink('/pdf-editor', '/pdf-editor/anything', null), true)
  assert.equal(isCurrentLink('/pricing', '/pricing-old', null), false)
  assert.equal(isCurrentLink('/', '/', null), false)
  assert.equal(isCurrentLink('https://example.com', '/', null), false)
})

test('the scroll rule holds at 0 on pages that cannot scroll and is clamped', () => {
  assert.equal(scrollProgress(0, 900, 900), 0)
  assert.equal(scrollProgress(10, 910, 900), 0)
  assert.equal(scrollProgress(500, 1900, 900), 0.5)
  assert.equal(scrollProgress(5000, 1900, 900), 1)
  assert.equal(scrollProgress(-40, 1900, 900), 0)
})
