// Read-only HTTP inspection. No browser, E2E runner, login, upload, or mutation.
// node scripts/verify-seo.mjs http://127.0.0.1:3130 https://www.mycloove.com
// SEO_PATHS=/bijoy-converter,/merge-pdf can split cold dev compilation into batches.
import assert from 'node:assert/strict'

const args = process.argv.slice(2)
if (args.includes('--help')) {
  console.log('Usage: node scripts/verify-seo.mjs [baseURL] [expectedCanonicalOrigin]')
  process.exit(0)
}
assert(args.length <= 2 && args.every((arg) => !arg.startsWith('--')), 'Supply at most two URLs')
const base = new URL(args[0] || 'http://127.0.0.1:3130')
const canonicalOrigin = new URL(args[1] || process.env.NEXT_PUBLIC_SITE_URL || 'https://www.mycloove.com')
for (const url of [base, canonicalOrigin]) {
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password, 'Use an HTTP(S) URL without credentials')
  assert(url.pathname === '/' && !url.search && !url.hash, 'Supply origins, not paths or tracking URLs')
}
const failures = []
const titles = new Set()
const priorityPaths = ['/', '/mr-markdown', '/bijoy-converter', '/image-to-text', '/pdf-to-word']
const privatePath = /^\/(?:admin|api|auth|login|register|reset-password|profile|pdf-to-markdown|pdf-tools)(?:\/|$)/
const decode = (text) => text.replace(/&(?:amp|quot|apos|lt|gt|#39);/g, (entity) => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&lt;': '<', '&gt;': '>' }[entity]))

function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map(([tag]) =>
    Object.fromEntries([...tag.matchAll(/([^\s=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([, key, quoted, single]) => [key.toLowerCase(), decode(quoted ?? single)])),
  )
}

async function request(path) {
  const response = await fetch(new URL(path, base), {
    redirect: 'manual',
    headers: { 'User-Agent': 'mycloove-seo-inspection', Accept: 'text/html,application/xml;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(180_000),
  })
  return { response, text: await response.text() }
}

async function check(label, run) {
  try {
    const result = await run()
    console.log(JSON.stringify({ check: label, status: 'pass', ...result }))
  } catch (error) {
    failures.push({ check: label, message: error.message })
    console.error(JSON.stringify({ check: label, status: 'fail', message: error.message }))
  }
}

const { response: sitemapResponse, text: xml } = await request('/sitemap.xml')
assert.equal(sitemapResponse.status, 200, 'Sitemap must return 200')
const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, location]) => new URL(decode(location)))
assert(locations.length > 0, 'Sitemap must contain URLs')
assert.equal(new Set(locations.map((url) => url.href)).size, locations.length, 'Duplicate sitemap URLs')
assert(!xml.includes('<lastmod>'), 'Execution-time lastmod must be omitted until real dates are tracked')
for (const url of locations) {
  assert.equal(url.origin, canonicalOrigin.origin, 'Sitemap origin must match the preferred origin')
  assert(!url.search && !url.hash && !privatePath.test(url.pathname), `Noncanonical or private sitemap URL: ${url.pathname}`)
}
for (const path of [...priorityPaths, '/about-us', '/contact-us', '/pricing', '/faq', '/privacy', '/terms', '/pdf-editor', '/image-editor', '/document-ai']) {
  assert(locations.some((url) => url.pathname === path), `Public sitemap entry missing: ${path}`)
}
console.log(JSON.stringify({ check: 'sitemap', status: 'pass', canonicalOrigin: canonicalOrigin.origin, publicURLs: locations.length, lastModified: 'omitted' }))

const selectedPaths = process.env.SEO_PATHS?.split(',').map((path) => path.trim()).filter(Boolean)
if (selectedPaths) {
  for (const path of selectedPaths) assert(locations.some((url) => url.pathname === path), `Unknown public path: ${path}`)
}
const inspectedLocations = selectedPaths ? locations.filter((url) => selectedPaths.includes(url.pathname)) : locations
// Sequential requests avoid compiling every editor concurrently on a cold preview.
for (const url of inspectedLocations) {
  await check(url.pathname, async () => {
    const { response, text: html } = await request(url.pathname)
    assert.equal(response.status, 200, `Public page returned ${response.status}`)
    assert.match(response.headers.get('content-type') || '', /text\/html/)
    const canonical = tags(html, 'link').filter((tag) => tag.rel === 'canonical')
    assert.equal(canonical.length, 1, 'Expected one canonical')
    assert.equal(new URL(canonical[0].href).href, url.href, 'Canonical must be self-referential')
    const title = decode(html.match(/<title>([^<]*)<\/title>/i)?.[1] || '')
    assert.equal((title.match(/mycloove/gi) || []).length, 1, 'Brand must appear once in the document title')
    assert(!titles.has(title), `Duplicate public title: ${title}`)
    titles.add(title)
    const meta = tags(html, 'meta')
    const value = (key) => meta.find((tag) => tag.name === key || tag.property === key)?.content
    assert(!/noindex/i.test(value('robots') || ''), 'Intended public page is noindexed')
    assert(value('description'), 'Missing description')
    assert.equal(new URL(value('og:url')).href, url.href, 'Open Graph URL must match canonical')
    assert.equal(value('og:title'), title, 'Open Graph must describe this page')
    assert.equal(value('twitter:title'), title, 'Twitter must describe this page')
    assert.equal(value('og:description'), value('description'))
    assert.equal(value('twitter:description'), value('description'))
    assert.equal(value('twitter:card'), 'summary_large_image')
    assert(value('og:image') && value('twitter:image'), 'Preserve the existing branded share image')
    const publicHtml = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    if (url.pathname === '/') {
      const structuredData = [...html.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].map(([, json]) => JSON.parse(json))
      const organization = structuredData.flatMap((data) => data['@graph'] || [data]).find((data) => data['@type'] === 'Organization')
      assert.equal(organization?.name, 'mycloove', 'Homepage must identify the real organization')
      assert.equal(organization?.logo, `${canonicalOrigin.origin}/quantum-core-octopus.png`, 'Organization must reference the existing static brand mark')
      const pngIcon = tags(html, 'link').find((tag) => tag.rel === 'icon' && tag.type === 'image/png')
      assert(pngIcon?.href, 'Preserve the existing PNG favicon declaration')
      // Favicon and Organization.logo are separate Google signals. Validate
      // both assets without implying that Google must display either one.
      for (const [label, href, minimum] of [['favicon', pngIcon.href, 8], ['Organization logo', organization.logo, 112]]) {
        const assetURL = new URL(href, base)
        assert([base.origin, canonicalOrigin.origin].includes(assetURL.origin), `Unexpected ${label} host`)
        const response = await fetch(new URL(assetURL.pathname + assetURL.search, base), {
          redirect: 'manual',
          headers: { 'User-Agent': 'Googlebot-Image/1.0', Accept: 'image/png' },
          signal: AbortSignal.timeout(30_000),
        })
        assert.equal(response.status, 200, `${label} must be publicly crawlable`)
        assert.match(response.headers.get('content-type') || '', /image\/png/)
        assert(!/noindex/i.test(response.headers.get('x-robots-tag') || ''), `${label} must not be noindexed`)
        const image = Buffer.from(await response.arrayBuffer())
        assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a', `${label} must be a valid PNG`)
        assert(image.length >= 24)
        const width = image.readUInt32BE(16)
        const height = image.readUInt32BE(20)
        assert.equal(width, height, `${label} must be square`)
        assert(width >= minimum, `${label} must be at least ${minimum}px`)
      }
      for (const path of priorityPaths.slice(1)) assert(tags(publicHtml, 'a').some((tag) => tag.href === path), `Initial catalogue link missing: ${path}`)
      assert.match(publicHtml, /Tool catalogue/)
      assert(tags(publicHtml, 'article').some((tag) => (tag.class || '').split(/\s+/).includes('home-tool-card')), 'Tool descriptions missing from initial HTML')
      assert(!/Available tools|Most used on the bench|nothing stored without your say-so/i.test(publicHtml), 'Unknown status or storage claim is misleading')
    }
    if (url.pathname === '/mr-markdown') {
      assert.match(publicHtml, /Mr\. Markdown by mycloove/)
      assert.match(publicHtml, /online Markdown editor with live preview/i)
      assert.match(publicHtml, /Restoring your workspace/)
      assert(!tags(publicHtml, 'textarea').length, 'Do not mount the intake/editor before restoration')
    }
    if (['/bijoy-converter', '/image-to-text', '/pdf-to-word'].includes(url.pathname)) {
      assert.match(publicHtml, /<h2\b[^>]*id="(?:bijoy|ocr|pdf-word)-about"/)
      assert.match(publicHtml, /lang="bn"/)
    }
    return { title, canonical: canonical[0].href, shareImage: value('og:image'), initialPublicInformation: priorityPaths.includes(url.pathname) }
  })
}

await check('robots', async () => {
  const { response, text } = await request('/robots.txt')
  assert.equal(response.status, 200)
  assert(text.includes(`Sitemap: ${canonicalOrigin.origin}/sitemap.xml`))
  for (const path of ['/admin', '/login', '/register', '/reset-password', '/api/']) assert(text.includes(`Disallow: ${path}`))
  return { sitemapOrigin: canonicalOrigin.origin }
})

for (const [path, target, status] of [['/pdf-to-markdown', '/mr-markdown', 308], ['/pdf-tools', '/merge-pdf', 307], ['/register', '/login', 307]]) {
  await check(`redirect ${path}`, async () => {
    const { response } = await request(path)
    assert.equal(response.status, status)
    assert.equal(new URL(response.headers.get('location'), base).pathname, target)
    return { httpStatus: response.status, destination: target }
  })
}
for (const path of ['/login', '/reset-password']) {
  await check(`private ${path}`, async () => {
    const { response, text } = await request(path)
    assert.equal(response.status, 200)
    assert(tags(text, 'meta').some((tag) => tag.name === 'robots' && /noindex/i.test(tag.content)))
    return { noindex: true }
  })
}
for (const path of ['/profile', '/admin']) {
  await check(`guest gate ${path}`, async () => {
    const { response } = await request(path)
    assert.equal(response.status, 307, 'Guest must remain redirected, not see private content')
    assert.equal(new URL(response.headers.get('location'), base).pathname, '/login')
    return { httpStatus: response.status, privacy: 'guest redirect retained; authenticated content not inspected' }
  })
}

console.log(JSON.stringify({ result: failures.length ? 'failed' : 'passed', sitemapURLs: locations.length, publicPagesInspected: inspectedLocations.length, uniqueTitles: titles.size, failures, scope: 'GET responses and initial HTML only; no E2E or processing-service verification' }))
process.exitCode = failures.length ? 1 : 0
