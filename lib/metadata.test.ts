import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { SITE_URL, pageMetadata } from './metadata.ts'
import { getTool, toolMetadata, tools } from './tools/registry.ts'
import sitemap from '../app/sitemap.ts'

test('public metadata uses a self-canonical and one branded share identity', () => {
  const metadata = pageMetadata('/contact-us', 'Contact', 'Write to mycloove.')
  assert.equal(metadata.title, 'Contact')
  assert.equal(metadata.alternates?.canonical, '/contact-us')
  assert.equal(metadata.openGraph?.title, 'Contact | mycloove')
  assert.equal(metadata.openGraph?.description, metadata.description)
  assert.equal(metadata.openGraph?.url, '/contact-us')
  assert.equal(metadata.twitter?.title, metadata.openGraph?.title)
  assert.equal(metadata.twitter?.description, metadata.description)
  assert.ok(metadata.twitter && 'card' in metadata.twitter)
  assert.equal(metadata.twitter.card, 'summary_large_image')
  assert.deepEqual(metadata.openGraph?.images, [{ url: '/opengraph-image', width: 1200, height: 630, alt: 'mycloove document tools' }])
  assert.deepEqual(metadata.twitter.images, [{ url: '/opengraph-image', alt: 'mycloove document tools' }])
})

test('every tool canonical follows its public href without changing its contract', () => {
  const before = JSON.stringify(tools)
  for (const tool of tools) {
    const metadata = toolMetadata(tool.id)
    assert.equal(metadata.alternates?.canonical, tool.href)
    assert.equal(metadata.openGraph?.url, tool.href)
    assert.equal(typeof metadata.title, 'string')
    assert.ok(!(metadata.title as string).includes('| mycloove'))
    assert.equal(metadata.openGraph?.title, `${metadata.title} | mycloove`)
    assert.equal(metadata.twitter?.title, metadata.openGraph?.title)
    assert.ok(metadata.openGraph?.images)
    assert.ok(metadata.twitter?.images)
    assert.ok(metadata.description)
    assert.strictEqual(getTool(tool.id), tool)
  }
  assert.equal(JSON.stringify(tools), before)
})

test('Mr. Markdown keeps its internal ID and canonical public entry', () => {
  assert.equal(toolMetadata('pdf-to-markdown').alternates?.canonical, '/mr-markdown')
  assert.equal(getTool('pdf-to-markdown').apiEndpoint, '/api/pdf-to-markdown')
  assert.match(toolMetadata('pdf-to-markdown').title as string, /Online Markdown Editor/)
})

test('unverified OCR accuracy and blanket account or storage claims are not metadata', () => {
  for (const tool of tools) {
    const metadata = toolMetadata(tool.id)
    assert.doesNotMatch(`${metadata.title} ${metadata.description}`, /100%|no account needed|zero storage|never stored/i)
  }
  assert.doesNotMatch(toolMetadata('image-to-text').title as string, /Bangla OCR/i)
})

test('sitemap contains only canonical public pages and no fabricated update dates', () => {
  const entries = sitemap()
  assert.equal(entries.length, tools.length + 10)
  assert.equal(new Set(entries.map((entry) => entry.url)).size, entries.length)
  for (const entry of entries) {
    assert.equal(new URL(entry.url).origin, new URL(SITE_URL).origin)
    assert.equal(entry.lastModified, undefined)
    assert.doesNotMatch(new URL(entry.url).pathname, /^\/(?:admin|api|auth|login|register|reset-password|profile|pdf-to-markdown|pdf-tools)(?:\/|$)/)
  }
  for (const tool of tools) {
    assert.ok(entries.some((entry) => entry.url === `${SITE_URL}${tool.href}`))
  }
  assert.deepEqual(sitemap(), entries)
})
