import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import {
  chunkMarkdown,
  cleanupMarkdown,
  computeDocumentHealth,
  computeStats,
  createStructuredExport,
  markdownToPlainText,
  renderMarkdownToHtml,
  sanitizeExportFilename,
  createBrokenImagePlaceholder,
  resolveSourcedDocumentId,
} from './utils.ts'
import { CHEATSHEET_ITEMS } from './cheatsheet-data.ts'

test('local cleanup preserves long document tails, identifiers and Unicode', () => {
  const markdown = '# Report\n\n' + 'Account 12-34, total 500.25.\n'.repeat(1000) + '\nশেষ অংশ END-987'
  const cleaned = cleanupMarkdown(markdown)
  assert.ok(cleaned.length > 16_000)
  assert.equal((cleaned.match(/Account 12-34, total 500\.25\./g) || []).length, 1000)
  assert.match(cleaned, /শেষ অংশ END-987$/)
})

test('local cleanup does not erase numeric lines, page labels or code whitespace', () => {
  const content = '42\nPage 3 of 8\nLine with a hard break  \nNext line\n\n```text\n123  \n\n\n\nend\n```'
  assert.equal(cleanupMarkdown(content), content)
  assert.equal(cleanupMarkdown('A\n\n\n\n\nB'), 'A\n\n\nB')
  const tildeFence = '~~~~text\nA\n\n\n\nB\n~~~~'
  assert.equal(cleanupMarkdown(tildeFence), tildeFence)
})

test('structural checks never certify accuracy or sharing readiness', () => {
  const markdown = '# Report\n\n[Source](https://example.test)\n\n| A | B |\n|---|---|\n| 1 | 2 |'
  const health = computeDocumentHealth(markdown, computeStats(markdown))
  assert.match(health.summary, /Review the content against the original/)
  assert.doesNotMatch(health.summary, /ready to share|accuracy verified/i)
  assert.ok(health.strengths.some((entry) => entry.includes('destinations are not checked')))
  assert.ok(health.strengths.some((entry) => entry.includes('cell content is not checked')))
})

test('editor drafts are not sent to the document-ID-only RAG endpoint', () => {
  const orchestrator = readFileSync(new URL('./index.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(orchestrator, /toolRequest\(['"]\/api\/document-ai\//)
  assert.doesNotMatch(orchestrator, /markdown\.slice\(0,\s*(12000|16000)\)/)
})

test('renders edited images as images and ordinary links as links', () => {
  const html = renderMarkdownToHtml(
    '![Architecture](https://example.com/system.png) and [spec](https://example.com/spec)',
  )

  assert.match(html, /<img alt="Architecture" src="https:\/\/example\.com\/system\.png"\/>/)
  assert.match(html, /<a href="https:\/\/example\.com\/spec"/)
  assert.doesNotMatch(html, /!<a href="https:\/\/example\.com\/system\.png"/)
})

test('broken preview images get a professional placeholder with escaped content', () => {
  const card = createBrokenImagePlaceholder('Architecture diagram', 'https://example.com/img/architecture.png?v=2')
  assert.match(card, /^<div class="pm-broken-img"/)
  assert.match(card, /aria-label="Architecture diagram \(image unavailable\)"/)
  assert.match(card, /<span class="pm-broken-img-icon"><svg/)
  assert.match(card, /<span class="pm-broken-img-alt">Architecture diagram<\/span>/)
  assert.match(card, /<span class="pm-broken-img-src" title="https:\/\/example\.com\/img\/architecture\.png\?v=2">/)
  // hostile alt/src values can never inject markup through the placeholder
  const hostile = createBrokenImagePlaceholder('<script>alert(1)</script>', '" onerror="x()')
  assert.doesNotMatch(hostile, /<script>|onerror="/)
  assert.match(hostile, /&lt;script&gt;/)
  // empty alt falls back to a readable label; empty src says so explicitly
  assert.match(createBrokenImagePlaceholder('', ''), /Untitled image/)
  assert.match(createBrokenImagePlaceholder('', ''), /\(no source\)/)
})

test('rendered images carry no preview wiring — export HTML stays clean', () => {
  const html = renderMarkdownToHtml('![Photo](https://example.com/photo.png)')
  assert.doesNotMatch(html, /pm-broken-img/)
  assert.match(html, /<img alt="Photo" src="https:\/\/example\.com\/photo\.png"\/>/)
})


test('renders task lists without leaking markdown checkbox syntax', () => {
  const html = renderMarkdownToHtml('- [x] Reviewed\n- [ ] Publish')

  assert.match(html, /<input type="checkbox" disabled checked\/> Reviewed/)
  assert.match(html, /<input type="checkbox" disabled\/> Publish/)
  assert.doesNotMatch(html, /\[x\]|\[ \]/)
})

test('preserves Unicode, tables and code while escaping executable markup', () => {
  const markdown = [
    '# বাংলা প্রতিবেদন',
    '',
    '| নাম | মান |',
    '| --- | ---: |',
    '| মোট | 42 |',
    '',
    '```html',
    '<script>alert("never execute")</script>',
    '```',
  ].join('\n')
  const html = renderMarkdownToHtml(markdown)

  assert.match(html, /বাংলা প্রতিবেদন/)
  assert.match(html, /<table>/)
  assert.match(html, /text-align:right/)
  // the <script> line is highlighted but still fully escaped — never executable
  assert.match(html, /<span class="hljs-name">script<\/span>/)
  assert.match(html, /&quot;never execute&quot;/)
  assert.doesNotMatch(html, /<script>/)
})

test('plain-text export retains semantic content that TXT can represent', () => {
  const plain = markdownToPlainText(
    '# শিরোনাম\n\n![চার্ট](https://example.com/chart.png)\n[রিপোর্ট](https://example.com/report)',
  )

  assert.match(plain, /শিরোনাম/)
  assert.match(plain, /চার্ট <https:\/\/example\.com\/chart\.png>/)
  assert.match(plain, /রিপোর্ট <https:\/\/example\.com\/report>/)
})

test('sanitizes filesystem-reserved filename characters without losing Unicode', () => {
  assert.equal(sanitizeExportFilename('  Q3: বাংলা / report?.md.  '), 'Q3 বাংলা report .md')
  assert.equal(sanitizeExportFilename('...'), 'document')
})

test('structured export retains canonical edited content, rendered HTML, and binary assets', () => {
  const payload = createStructuredExport({
    source: 'edited-report.pdf',
    pages: 3,
    confidence: 98,
    stats: { headings: 1, lists: 1, codeBlocks: 1, tables: 1, links: 1, words: 12, tokens: 16 },
    markdown: '# Edited\n\n![Diagram](images/flow.png)\n\nবাংলা data',
    html: '<h1>Edited</h1><img src="data:image/png;base64,AA==" alt="Diagram">',
    assets: [{ filename: 'flow.png', mime_type: 'image/png', data_url: 'data:image/png;base64,AA==', alt: 'Diagram' }],
  })

  assert.equal(payload.schema, 'mr-markdown.export/v2')
  assert.match(payload.document.markdown, /বাংলা data/)
  assert.match(payload.document.rendered_html, /data:image\/png/)
  assert.deepEqual(payload.document.assets[0], {
    filename: 'flow.png', mime_type: 'image/png', data_url: 'data:image/png;base64,AA==', alt: 'Diagram',
  })
})

test('AI chunks retain every edited section body', () => {
  const markdown = '# Intro\nEdited intro\n\n## Data\n| A | B |\n|---|---|\n| 1 | 2 |\n\n## শেষ\nসম্পন্ন'
  const chunks = chunkMarkdown(markdown, 12)
  const joined = chunks.map((chunk) => chunk.body).join('\n')

  for (const expected of ['Edited intro', '| 1 | 2 |', '## শেষ', 'সম্পন্ন']) {
    assert.ok(joined.includes(expected), `missing chunk content: ${expected}`)
  }
})

test('renders inline and display math with KaTeX', () => {
  const inline = renderMarkdownToHtml('Euler: $e^{i\\pi} + 1 = 0$ was proven.')
  assert.match(inline, /<span class="pm-math pm-math-inline">/)
  assert.match(inline, /katex/)
  assert.doesNotMatch(inline, /\u0000|\$/)

  const block = renderMarkdownToHtml('$$\n\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}\n$$')
  assert.match(block, /<div class="pm-math pm-math-block">/)
  assert.match(block, /katex-display/)
  assert.doesNotMatch(block, /\u0000|\$\$/)
})

test('renders LaTeX matrix environments inside display math', () => {
  const html = renderMarkdownToHtml([
    '$$',
    '\\begin{matrix}',
    '1 & 2 & 3 \\\\',
    '4 & 5 & 6 \\\\',
    '7 & 8 & 9',
    '\\end{matrix}',
    '$$',
  ].join('\n'))
  assert.match(html, /<div class="pm-math pm-math-block">/)
  assert.match(html, /katex/)
  assert.doesNotMatch(html, /\u0000/)
})

test('math is not rendered inside code, and currency stays plain text', () => {
  const html = renderMarkdownToHtml([
    'Costs $5 and $10 stay plain.',
    '',
    'Inline `$x^2$` stays code.',
    '',
    '```tex',
    '$$x$$',
    '```',
  ].join('\n'))
  assert.match(html, /Costs \$5 and \$10/)
  assert.match(html, /<code>\$x\^2\$<\/code> stays code/)
  // the tex fence is highlighted (hljs spans) but math is not rendered
  assert.match(html, /<pre class="hl-code" data-lang="tex"><code class="language-tex lang-tex">/)
  assert.doesNotMatch(html, /pm-math/)
})

test('renders setext (underline) headings; bare --- still stays an hr', () => {
  const html = renderMarkdownToHtml([
    '# Heading Level 1',
    '## Heading Level 2',
    '### Heading Level 3',
    '#### Heading Level 4',
    '##### Heading Level 5',
    '###### Heading Level 6',
    '',
    'Alternative Level 1',
    '==================',
    '',
    'Alternative Level 2',
    '------------------',
    '',
    '---',
  ].join('\n'))
  assert.match(html, /<h1 id="heading-level-1">Heading Level 1<\/h1>/)
  assert.match(html, /<h2 id="heading-level-2">Heading Level 2<\/h2>/)
  assert.match(html, /<h3 id="heading-level-3">Heading Level 3<\/h3>/)
  assert.match(html, /<h4 id="heading-level-4">Heading Level 4<\/h4>/)
  assert.match(html, /<h5 id="heading-level-5">Heading Level 5<\/h5>/)
  assert.match(html, /<h6 id="heading-level-6">Heading Level 6<\/h6>/)
  assert.match(html, /<h1 id="alternative-level-1">Alternative Level 1<\/h1>/)
  assert.match(html, /<h2 id="alternative-level-2">Alternative Level 2<\/h2>/)
  assert.match(html, /<hr\/>/)
  assert.doesNotMatch(html, /<p>[^<]*(===|---)/)
})

test('all 33 cheat sheet options render without error, empty output, or leaked tokens', () => {
  assert.equal(CHEATSHEET_ITEMS.length, 33)
  for (const item of CHEATSHEET_ITEMS) {
    const html = renderMarkdownToHtml(item.syntax)
    assert.ok(html.trim().length > 0, `cheat "${item.id}" rendered as empty HTML`)
    assert.doesNotMatch(html, /\u0000/, `cheat "${item.id}" leaked a math token`)
  }
})

test('block-level div sections render; stray </div> never leaks as literal text', () => {
  // GitHub-style centered section: wrapper + markdown content + closer
  const html = renderMarkdownToHtml([
    '<div align="center">',
    '',
    '# Centered Heading',
    '',
    '</div>',
  ].join('\n'))
  assert.match(html, /<div align="center"><h1 id="centered-heading">Centered Heading<\/h1><\/div>/)
  assert.doesNotMatch(html, /&lt;\/div&gt;/)

  // a stray closer with no opener is dropped (browser behavior), never shown as text
  const stray = renderMarkdownToHtml('</div>\n\nReal content survives.')
  assert.doesNotMatch(stray, /&lt;\/div&gt;|<\/div>/)
  assert.match(stray, /<p>Real content survives\.<\/p>/)

  // markdown keeps rendering inside the wrapper (lists, emphasis)
  const rich = renderMarkdownToHtml([
    '<div align="center">',
    '- Markdown inside',
    '- **Mixed** formatting',
    '</div>',
  ].join('\n'))
  assert.match(rich, /<div align="center">\s*<ul>\s*<li>Markdown inside\s*<\/li>\s*<li><strong>Mixed<\/strong> formatting\s*<\/li>\s*<\/ul>\s*<\/div>/)

  // nested wrappers track depth correctly
  const nested = renderMarkdownToHtml('<div>\n<div>\ninner\n</div>\n</div>')
  assert.match(nested, /<div><div><p>inner<\/p><\/div><\/div>/)

  // hostile div attributes are still escaped (block rule only whitelists align)
  const hostile = renderMarkdownToHtml('<div onclick="x()">bad</div>')
  assert.doesNotMatch(hostile, /<div onclick=/)
  assert.match(hostile, /&lt;div onclick=/)
})

test('leading YAML frontmatter renders as a metadata card, never as leaked text', () => {
  const html = renderMarkdownToHtml([
    '---',
    'title: "Blog Post Title"',
    'date: 2024-01-01',
    'author: "Your Name"',
    'tags: ["tech", "tutorial"]',
    '---',
    '',
    '# Eye-catching Title',
  ].join('\n'))
  // metadata card with keys, quoted values unquoted, and array chips
  assert.match(html, /<div class="pm-frontmatter" role="group" aria-label="Document metadata">/)
  assert.match(html, /<span class="pm-fm-key">title<\/span><span class="pm-fm-value">Blog Post Title<\/span>/)
  assert.match(html, /<span class="pm-fm-key">date<\/span><span class="pm-fm-value">2024-01-01<\/span>/)
  assert.match(html, /<span class="pm-fm-chip">tech<\/span><span class="pm-fm-chip">tutorial<\/span>/)
  // delimiters and raw YAML never leak: no <hr>, no `title:` literal text
  assert.doesNotMatch(html, /&lt;|title: "Blog/)
  assert.doesNotMatch(html, /<hr\/>/)
  // body after frontmatter renders normally
  assert.match(html, /<h1 id="eye-catching-title">Eye-catching Title<\/h1>/)
})

test('frontmatter detection stays conservative — hr-like documents render untouched', () => {
  // no closing delimiter → ordinary hr, not frontmatter
  const unclosed = renderMarkdownToHtml('---\ntitle: maybe\n\nBody here.')
  assert.match(unclosed, /<hr\/>/)
  assert.match(unclosed, /<p>title: maybe<br\/>Body here\.<\/p>|title: maybe/)
  // blank line inside the block → body content, not metadata
  const blankInside = renderMarkdownToHtml('---\n\nSome prose.\n\n---\n\nAfter.')
  assert.doesNotMatch(blankInside, /pm-frontmatter/)
  // frontmatter must sit at line 1 of the document
  const notFirst = renderMarkdownToHtml('Intro line.\n\n---\ntitle: x\n---')
  assert.doesNotMatch(notFirst, /pm-frontmatter/)
  // hostile values are escaped
  const hostile = renderMarkdownToHtml('---\ntitle: <script>alert(1)</script>\n---\n\nBody.')
  assert.doesNotMatch(hostile, /<script>/)
  assert.match(hostile, /&lt;script&gt;/)
})

test('cheat sheet features render as promised: refs, autolinks, spoilers, escapes, HTML', () => {
  const html = renderMarkdownToHtml([
    '[Reference Link][ref]',
    '',
    '[ref]: https://example.com',
    '',
    '<https://example.com>',
    '<user@example.com>',
    '',
    '||Hidden spoiler text||',
    '',
    '\\* Not italic \\*',
    '',
    '<mark>Highlighted</mark> <kbd>Ctrl</kbd> H<sub>2</sub>O x<sup>2</sup>',
  ].join('\n'))
  assert.match(html, /<a href="https:\/\/example\.com"[^>]*>Reference Link<\/a>/)
  assert.doesNotMatch(html, /\[ref\]/)
  assert.match(html, /<a href="https:\/\/example\.com"[^>]*>https:\/\/example\.com<\/a>/)
  assert.match(html, /<a href="mailto:user@example\.com"[^>]*>user@example\.com<\/a>/)
  assert.match(html, /<span class="pm-spoiler">Hidden spoiler text<\/span>/)
  assert.match(html, /\* Not italic \*/)
  assert.doesNotMatch(html, /\\Not/)
  assert.match(html, /<mark>Highlighted<\/mark>/)
  assert.match(html, /<kbd>Ctrl<\/kbd>/)
  assert.match(html, /<sub>2<\/sub>/)
  assert.match(html, /<sup>2<\/sup>/)
})

test('inline images: titled images get a title attribute, clickable images stay wrapped', () => {
  const html = renderMarkdownToHtml([
    '![Alt text](image.png)',
    '![Alt with title](image.png "Image title")',
    '',
    '[![Clickable image](thumbnail.png)](https://example.com)',
  ].join('\n'))
  assert.match(html, /<img alt="Alt text" src="image\.png"\/>/)
  // Title must become a title attribute, never leak into src (regression fix)
  assert.match(html, /<img alt="Alt with title" src="image\.png" title="Image title"\/>/)
  assert.doesNotMatch(html, /src="image\.png &quot;/)
  // Clickable image: link wraps the image
  assert.match(html, /<a href="https:\/\/example\.com"[^>]*><img alt="Clickable image" src="thumbnail\.png"\/><\/a>/)
})

test('cheat sheet Links & Media entries render each variant on its own line', () => {
  const links = CHEATSHEET_ITEMS.find((i) => i.id === 'links')!
  const linksHtml = renderMarkdownToHtml(links.syntax)
  assert.equal((linksHtml.match(/<a /g) || []).length, 5)
  assert.match(linksHtml, /Basic Link<\/a><br\/>/)
  assert.match(linksHtml, /title="Website Title"/)
  assert.match(linksHtml, /Reference Link<\/a>/)
  assert.match(linksHtml, /user@example\.com<\/a>/)
  const images = CHEATSHEET_ITEMS.find((i) => i.id === 'images')!
  const imagesHtml = renderMarkdownToHtml(images.syntax)
  // 3 markdown images + 1 whitelisted raw-HTML sized image
  assert.equal((imagesHtml.match(/<img /g) || []).length, 4)
  assert.match(imagesHtml, /Alt text" src="image\.png"\/><br\/>/)
  assert.match(imagesHtml, /title="Image title"/)
  assert.match(imagesHtml, /<img src="image\.png" width="200" height="100" alt="Sized image"\/>/)
  assert.doesNotMatch(imagesHtml, /&lt;img/)
})

test('inline links: titled links get a title attribute, malformed titles stay literal', () => {
  const html = renderMarkdownToHtml([
    '[Basic Link](https://example.com)',
    '[Link with Title](https://example.com "Website Title")',
    '',
    '[ref]: https://ref-source.example',
    '',
    '[Reference Link][ref]',
  ].join('\n'))
  assert.match(html, /<a href="https:\/\/example\.com" target="_blank" rel="noopener noreferrer">Basic Link<\/a>/)
  assert.match(
    html,
    /<a href="https:\/\/example\.com" title="Website Title" target="_blank" rel="noopener noreferrer">Link with Title<\/a>/,
  )
  // Title must not leak into the href (regression: href once swallowed the title text)
  assert.doesNotMatch(html, /href="https:\/\/example\.com &quot;/)
  // Reference-style link still resolves alongside inline ones
  assert.match(html, /<a href="https:\/\/ref-source\.example"[^>]*>Reference Link<\/a>/)
})


test('cheat sheet features render as promised: hard breaks, defs, containers, nesting, comments', () => {
  const html = renderMarkdownToHtml([
    'Line with two trailing spaces  ',
    'Next line starts here.',
    '',
    'Term 1',
    ': First definition',
    ': Another definition',
    '',
    'Term 2',
    ': Single definition',
    '',
    ':::warning',
    'Warning container',
    ':::',
    '',
    '> First level',
    '> > Nested level',
    '',
    'Before <!-- hidden comment --> After',
  ].join('\n'))
  assert.match(html, /spaces<br\/>\s*Next line/)
  assert.match(html, /<dt>Term 1<\/dt>/)
  assert.match(html, /<dd>First definition<\/dd>/)
  assert.match(html, /<dd>Another definition<\/dd>/)
  assert.match(html, /<dt>Term 2<\/dt>/)
  assert.match(html, /<dd>Single definition<\/dd>/)
  assert.match(html, /<\/dl>/)
  assert.match(html, /<div class="pm-container pm-container-warning"><div class="pm-container-head">WARNING<\/div><p>Warning container<\/p><\/div>/)
  assert.match(html, /<blockquote>[\s\S]*<blockquote>Nested level<\/blockquote>[\s\S]*<\/blockquote>/)
  assert.match(html, /Before\s*After/)
  assert.doesNotMatch(html, /<!--|hidden comment/)
})

test('renders nested unordered and ordered lists with proper depth', () => {
  const html = renderMarkdownToHtml([
    '* First level item',
    '* Another item',
    '  * Second level item',
    '  * Another nested item',
    '    * Third level item',
    '* Back to first level',
  ].join('\n'))
  assert.match(html, /<li>Another item\s*<ul>\s*<li>Second level item\s*<\/li>\s*<li>Another nested item\s*<ul>\s*<li>Third level item\s*<\/li>\s*<\/ul>\s*<\/li>\s*<\/ul>\s*<\/li>/)
  assert.match(html, /<li>Back to first level\s*<\/li>\s*<\/ul>/)
  assert.equal((html.match(/<ul>/g) || []).length, 3)
  assert.equal((html.match(/<\/ul>/g) || []).length, 3)
  assert.equal((html.match(/<li>/g) || []).length, 6)
  assert.equal((html.match(/<\/li>/g) || []).length, 6)

  const ol = renderMarkdownToHtml('1. First item\n2. Second item\n   1. Nested item one\n   2. Nested item two\n3. Third item')
  assert.match(ol, /<li>Second item\s*<ol>\s*<li>Nested item one\s*<\/li>\s*<li>Nested item two\s*<\/li>\s*<\/ol>\s*<\/li>/)
  assert.match(ol, /<li>Third item\s*<\/li>\s*<\/ol>/)
})

test('ordered list renumbering: all-1 sources render 1, 2, 3 across a blank line', () => {
  const html = renderMarkdownToHtml([
    '1. First item',
    '2. Second item',
    '   1. Nested item one',
    '   2. Nested item two',
    '3. Third item',
    '',
    '1. Numbers can be',
    '1. Any number and still',
    '1. Display correctly',
  ].join('\n'))
  // two independent <ol> roots; the blank line closes the first list
  assert.equal((html.match(/<ol>/g) || []).length, 3)
  assert.equal((html.match(/<\/ol>/g) || []).length, 3)
  assert.match(html, /<\/ol>\s*<\/li>\s*<li>Third item\s*<\/li>\s*<\/ol>\s*<ol>\s*<li>Numbers can be/)
  assert.match(html, /<li>Any number and still\s*<\/li>\s*<li>Display correctly\s*<\/li>\s*<\/ol>/)
  assert.doesNotMatch(html, /\b1\.\s|\b2\.\s|\b3\.\s/)
})

test('paragraph breaks render exactly as the cheat sheet promises', () => {
  const html = renderMarkdownToHtml([
    'First paragraph text.',
    '',
    'Second paragraph text.',
    'Every line break renders visibly.',
    '',
    'Explicit break with two trailing spaces  ',
    'Next line starts here.',
    '',
    'Explicit break with backslash\\',
    'Next line starts here.',
  ].join('\n'))
  const ps = html.match(/<p>[\s\S]*?<\/p>/g) ?? []
  assert.equal(ps.length, 4)
  assert.match(ps[0], /^<p>First paragraph text\.<\/p>$/)
  // breaks mode: single newlines render as visible <br/> (GitHub/Obsidian style)
  assert.match(ps[1], /Second paragraph text\.<br\/>\s*Every line break renders visibly\./)
  // blank lines still split paragraphs
  assert.doesNotMatch(ps[1], /First paragraph/)
  // classic hard-break forms keep working
  assert.match(ps[2], /spaces<br\/>\s*Next line starts here\./)
  assert.match(ps[3], /backslash<br\/>\s*Next line starts here\./)
})

test('pasted links render on separate lines without trailing-space tricks', () => {
  // The exact block from the cheat sheet's Links entry, pasted raw (single newlines)
  const html = renderMarkdownToHtml([
    '[Basic Link](https://example.com)',
    '[Link with Title](https://example.com "Website Title")',
    '[Reference Link][ref]',
    '',
    '[ref]: https://example.com',
    '',
    '<https://example.com>',
    '<user@example.com>',
  ].join('\n'))
  const ps = html.match(/<p>[\s\S]*?<\/p>/g) ?? []
  assert.equal(ps.length, 2)
  // every variant on its own visible line
  assert.match(ps[0], /^<p><a href="https:\/\/example\.com"[^>]*>Basic Link<\/a><br\/>\s*<a [^>]*title="Website Title"[^>]*>Link with Title<\/a><br\/>\s*<a [^>]*>Reference Link<\/a><\/p>$/)
  assert.match(ps[1], /^<p><a href="https:\/\/example\.com"[^>]*>https:\/\/example\.com<\/a><br\/>\s*<a href="mailto:user@example\.com"[^>]*>user@example\.com<\/a><\/p>$/)
})

test('escaped characters render literally — brackets never become math or links', () => {
  const html = renderMarkdownToHtml([
    '\\* Not italic \\*',
    '',
    '\\# Not a heading',
    '',
    '\\[Not a link\\]',
    '',
    '\\> Not a quote',
    '',
    'Escapable: \\ ` * _ {} [] () # + - . ! |',
    '',
    'Symbols: © ® €',
  ].join('\n'))
  assert.doesNotMatch(html, /katex|pm-math/)
  assert.match(html, /\* Not italic \*/)
  assert.match(html, /# Not a heading/)
  assert.match(html, /\[Not a link\]/)
  assert.match(html, /&gt; Not a quote/)
  assert.match(html, /Escapable: \\ ` \* _ \{\} \[\] \(\) # \+ - \. ! \|/)
  assert.match(html, /Symbols: © ® €/)
})

test('syntax quick reference renders every section without loss', () => {
  const html = renderMarkdownToHtml([
    '## Text Formatting',
    '**bold**  ·  *italic*  ·  ~~strike~~  ·  `code`',
    '',
    '## Headers',
    '# H1  ·  ## H2  ·  ### H3',
    '',
    '## Lists',
    '- item  ·  1. item  ·  - [ ] task',
    '',
    '## Links & Images',
    '[text](url)  ·  ![alt](img.jpg)',
  ].join('\n'))
  assert.match(html, /<h2 id="text-formatting">Text Formatting<\/h2>/)
  assert.match(html, /<strong>bold<\/strong>\s+·\s+<em>italic<\/em>\s+·\s+<s>strike<\/s>\s+·\s+<code>code<\/code>/)
  assert.match(html, /<h2 id="headers">Headers<\/h2>/)
  assert.match(html, /<h1 id="h1-h2-h3">H1\s+·\s+## H2\s+·\s+### H3<\/h1>/)
  assert.match(html, /<h2 id="lists">Lists<\/h2>/)
  assert.match(html, /<li>item\s+·\s+1\. item\s+·\s+- \[ \] task\s*<\/li>/)
  assert.match(html, /<h2 id="links-images">Links &amp; Images<\/h2>/)
  assert.match(html, /<a href="url"[^>]*>text<\/a>/)
  assert.match(html, /<img alt="alt" src="img\.jpg"\/>/)
})

test('basic tables render with proper structure, alignment, and content', () => {
  const html = renderMarkdownToHtml([
    '| Header 1 | Header 2 | Header 3 |',
    '|----------|-----------|-----------|',
    '| Cell 1   | Cell 2    | Cell 3    |',
    '| Row 2    | Data      | Data      |',
  ].join('\n'))
  assert.match(html, /<table><thead><tr><th style="text-align:left">Header 1<\/th><th style="text-align:left">Header 2<\/th><th style="text-align:left">Header 3<\/th><\/tr><\/thead>/)
  assert.match(html, /<tbody><tr><td[^>]*>Cell 1<\/td><td[^>]*>Cell 2<\/td><td[^>]*>Cell 3<\/td><\/tr><tr><td[^>]*>Row 2<\/td><td[^>]*>Data<\/td><td[^>]*>Data<\/td><\/tr><\/tbody><\/table>/)
  // pipes never leak into the rendered output
  assert.doesNotMatch(html, /\|/)
  // alignment colons still work
  const aligned = renderMarkdownToHtml('| L | C | R |\n|:--|:-:|--:|\n| a | b | c |')
  assert.match(aligned, /<th style="text-align:left">L<\/th>/)
  assert.match(aligned, /<th style="text-align:center">C<\/th>/)
  assert.match(aligned, /<th style="text-align:right">R<\/th>/)
})

test('code blocks get syntax highlighting with content fully preserved', () => {
  const html = renderMarkdownToHtml([
    '```javascript',
    'function greeting(name) {',
    '    return `Hello, ${name}!`;',
    '}',
    '```',
    '',
    '```python',
    'def fibonacci(n):',
    '    a, b = 0, 1',
    '    while a < n:',
    "        print(a, end=' ')",
    '        a, b = b, a + b',
    '```',
    '',
    '```css',
    '.container {',
    '    display: flex;',
    '    justify-content: center;',
    '}',
    '```',
  ].join('\n'))
  assert.match(html, /<pre class="hl-code" data-lang="javascript"><code class="language-javascript lang-javascript">/)
  // javascript: keyword + function + template string highlighted
  assert.match(html, /<span class="hljs-keyword">function<\/span>/)
  assert.match(html, /<span class="hljs-title function_">greeting<\/span>/)
  assert.match(html, /Hello, <span class="hljs-subst">\$\{name\}<\/span>!/)
  // python: def + while keywords highlighted
  assert.match(html, /<span class="hljs-keyword">def<\/span>/)
  assert.match(html, /<span class="hljs-keyword">while<\/span>/)
  assert.match(html, /fibonacci/)
  // css: selector + properties highlighted
  assert.match(html, /<span class="hljs-selector-class">\.container<\/span>/)
  assert.match(html, /<span class="hljs-attribute">display<\/span>/)
  assert.match(html, /flex/)
  // full source text remains present in every block (no loss); arithmetic
  // operators (=, <, +) are wrapped as hljs-operator spans
  assert.match(html, /a, b <span class="hljs-operator">=<\/span> b, a <span class="hljs-operator">\+<\/span> b/)
  assert.match(html, /<span class="hljs-operator">&lt;<\/span> n/)
  // unknown language still falls back to escaped plain code
  const plain = renderMarkdownToHtml('```\njust <plain> code\n```')
  assert.match(plain, /just &lt;plain&gt; code/)
  assert.doesNotMatch(plain, /hljs-/)
  // additional languages highlight correctly language-wise
  const more = renderMarkdownToHtml([
    '```typescript',
    'const n: number = 42;',
    '```',
    '',
    '```json',
    '{"ok": true}',
    '```',
    '',
    '```bash',
    'echo "hello"',
    '```',
    '',
    '```html',
    '<div class="x">hi</div>',
    '```',
  ].join('\n'))
  assert.match(more, /data-lang="typescript"/)
  assert.match(more, /<span class="hljs-keyword">const<\/span>/)
  assert.match(more, /data-lang="json"/)
  assert.match(more, /<span class="hljs-attr">&quot;ok&quot;<\/span>/)
  assert.match(more, /<span class="hljs-literal"><span class="hljs-keyword">true<\/span><\/span>/)
  assert.match(more, /data-lang="bash"/)
  assert.match(more, /<span class="hljs-built_in">echo<\/span>/)
  assert.match(more, /data-lang="html"/)
  assert.match(more, /<span class="hljs-tag">&lt;<span class="hljs-name">div<\/span>/)
  // SQL: LIMIT gets the keyword color like ORDER BY; true is a distinct literal
  const sql = renderMarkdownToHtml([
    '```sql',
    'SELECT first_name, last_name, email',
    'FROM users',
    'WHERE active = true',
    'ORDER BY last_name ASC',
    'LIMIT 10;',
    '```',
  ].join('\n'))
  assert.match(sql, /<span class="hljs-keyword">ORDER<\/span> <span class="hljs-keyword">BY<\/span>/)
  assert.match(sql, /<span class="hljs-keyword">LIMIT<\/span>/)
  assert.match(sql, /<span class="hljs-literal">true<\/span>/)
  // the = operator is wrapped exactly once (no double-nested spans)
  assert.match(sql, /<span class="hljs-operator">=<\/span>/)
  assert.doesNotMatch(sql, /<span class="hljs-operator"><span class="hljs-operator">/)
})

test('html code block renders professionally: uniform tags, muted doctype, blue attrs', () => {
  const html = renderMarkdownToHtml([
    '```html',
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '    <meta charset="UTF-8">',
    '    <title>My Page</title>',
    '</head>',
    '<body>',
    '    <h1>Welcome</h1>',
    '</body>',
    '</html>',
    '```',
  ].join('\n'))
  // DOCTYPE is uniformly muted — no operator spans inside the meta line
  assert.match(html, /<span class="hljs-meta">&lt;!DOCTYPE <span class="hljs-keyword">html<\/span>&gt;<\/span>/)
  assert.match(html, /<span class="hljs-meta">[^]*?<\/span>/)
  // tags are uniform green units (bracket + name), attr names blue, values green
  assert.match(html, /<span class="hljs-tag">&lt;<span class="hljs-name">html<\/span> <span class="hljs-attr">lang<\/span>=<span class="hljs-string">&quot;en&quot;<\/span>&gt;<\/span>/)
  assert.match(html, /<span class="hljs-tag">&lt;<span class="hljs-name">meta<\/span> <span class="hljs-attr">charset<\/span>=<span class="hljs-string">&quot;UTF-8&quot;<\/span>&gt;<\/span>/)
  assert.match(html, /<span class="hljs-name">title<\/span>/)
  assert.match(html, /Welcome/)
  // closing tags keep the same uniform structure
  assert.match(html, /<span class="hljs-tag">&lt;\/<span class="hljs-name">body<\/span>&gt;<\/span>/)
})

test('arbitrary HTML still stays escaped (no script execution)', () => {
  const html = renderMarkdownToHtml('<script>alert(1)</script>\n\n<div onclick="x()">bad</div>')
  assert.doesNotMatch(html, /<script>|<div /)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;div onclick/)
})

/*
  A handed-over document's identity. The rule these pin: opening the same source
  twice must resolve to the document already open, never to a second copy.
*/
test('a source already open resolves to its existing document', () => {
  const jobs = [
    { id: 'a', sourceId: undefined },
    { id: 'b', sourceId: 'github:me/repo@main:README.md' },
  ]
  assert.equal(resolveSourcedDocumentId(jobs, 'github:me/repo@main:README.md'), 'b')
})

test('an unknown source asks for a new document', () => {
  const jobs = [{ id: 'b', sourceId: 'github:me/repo@main:README.md' }]
  assert.equal(resolveSourcedDocumentId(jobs, 'github:me/repo@main:docs/x.md'), null)
})

test('a document with no source never matches, so plain opens still create', () => {
  const jobs = [
    { id: 'a', sourceId: undefined },
    { id: 'b', sourceId: 'github:me/repo@main:README.md' },
  ]
  assert.equal(resolveSourcedDocumentId(jobs, undefined), null)
  assert.equal(resolveSourcedDocumentId(jobs, ''), null)
})

test('the same path on another branch is a different document', () => {
  const jobs = [{ id: 'b', sourceId: 'github:me/repo@main:README.md' }]
  assert.equal(resolveSourcedDocumentId(jobs, 'github:me/repo@release/1.0:README.md'), null)
})

