import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

const CHUNK = 64 * 1024
const DISPLAY = 128 * 1024
const JOB = 24 * 1024 * 1024
const worker = await readFile(new URL('../../../public/mr-resume/latex/busytex-v2/compiler-worker.js', import.meta.url), 'utf8')
const encode = (text: string) => new TextEncoder().encode(text)
const iconSpace = 'Missing character: There is no   (U+0020) in font [SimpleIcons.otf]/OT:language\n=dflt;!\n'
const original = '\\documentclass{article}\n\\begin{document}Original source stays unchanged.\\end{document}'

function memoryFS() {
  const files = new Map<string, Uint8Array>()
  const directories = new Set(['/', '/job', '/tmp'])
  const reads: { position: number; length: number }[] = []
  let closed = 0
  const FS = {
    analyzePath: (path: string) => ({ exists: files.has(path) || directories.has(path) }),
    mkdir: (path: string) => { directories.add(path) },
    chmod() {},
    stat: (path: string) => ({ size: files.get(path)!.length }),
    open: (path: string) => ({ path }),
    close: () => { closed++ },
    read(stream: { path: string }, buffer: Uint8Array, offset: number, length: number, position: number) {
      reads.push({ position, length })
      const part = files.get(stream.path)!.subarray(position, position + length)
      buffer.set(part, offset)
      return part.length
    },
    write(stream: { path: string }, bytes: Uint8Array, offset: number, length: number, position = 0) {
      const prior = files.get(stream.path) ?? new Uint8Array()
      const next = new Uint8Array(Math.max(prior.length, position + length))
      next.set(prior); next.set(bytes.subarray(offset, offset + length), position)
      files.set(stream.path, next)
      return length
    },
    writeFile(path: string, value: string | Uint8Array) {
      const bytes = typeof value === 'string' ? encode(value) : value
      files.delete(path)
      FS.write({ path }, bytes, 0, bytes.length, 0)
    },
    readFile: (path: string) => files.get(path)!.slice(),
    unlink: (path: string) => { files.delete(path) },
  }
  return { FS, files, reads, get closed() { return closed } }
}

type Request = { operationKey: string; engine: string; mainFile: string; files: { path: string; content: string }[] }
type CatalogGroup = { id: string; kind: string; profiles: string[]; packages: string[]; files?: string[]; requires?: string[]; assets: { bytes: number }[] }
type Hooks = {
  fullFileLog: (FS: ReturnType<typeof memoryFS>['FS'], path: string) => string
  fileLog: (FS: ReturnType<typeof memoryFS>['FS'], path: string) => string
  rerunReason: (text: string) => string | null
  checkFinalLog: (text: string) => void
  runBiber: (request: Request, FS: ReturnType<typeof memoryFS>['FS']) => Promise<void>
  compile: (request: Request) => Promise<{ pdf: ArrayBuffer; synctex?: ArrayBuffer; synctexPdfSha256?: string }>
  logs: () => string
  configure: (FS: ReturnType<typeof memoryFS>['FS'], engine: string, call: (args: string[]) => void, biber: () => Promise<void>) => void
  configureBiber: (FS: ReturnType<typeof memoryFS>['FS'], call: (args: string[]) => number) => void
  packageGroupRequirement: (text: string, request?: { files: { path: string }[] }) => { code: string; details: { groupIDs: string[]; downloadBytes: number } } | null
  configureCatalog: (groups: CatalogGroup[], approvals?: string[], engine?: string) => void
  validateManifest: (value: unknown) => unknown
  selectGroups: (value: { groups: CatalogGroup[] }, engine: string, approvals: string[]) => CatalogGroup[]
  snapshotFilenameDatabase: (files: { path: string }[]) => string
}

function harness() {
  const scope: { fetch: () => never; postMessage: (value: unknown) => void; crypto: Crypto; test?: Hooks } = {
    fetch: () => assert.fail('Injected quality tests never fetch dependencies'), crypto: globalThis.crypto, postMessage() {},
  }
  // Test-only exposure inside the actual worker closure. No shipped test API,
  // WASM initialization, fake browser proof, native process or network access.
  const instrumented = worker.replace('})(self);', `scope.test = {
    fullFileLog, fileLog, rerunReason, checkFinalLog, compile, runBiber, packageGroupRequirement, validateManifest, selectGroups, snapshotFilenameDatabase,
    logs: () => new TextDecoder().decode(log),
    configure(FS, engine, invoke, biber) {
      entryPoint = 'main.tex'; initializedEngine = engine;
      manifest = { engines: [{ id: engine }], groups: [], biber: { group: 'bibliography' } };
      snapshotIndex = { files: [] }; texRuntime = { FS };
      call = invoke; runBiber = biber;
    },
    configureBiber(FS, invoke) {
      entryPoint = 'main.tex'; biberRuntime = { FS, callMain: invoke };
    },
    configureCatalog(groups, approvals = [], engine = 'xelatex') {
      manifest = { groups, biber: { group: 'bibliography', assets: [{ bytes: 70 }] } };
      snapshotIndex = { files: [] }; initializedEngine = engine; approvedGroups = approvals;
    }
  }; })(self);`)
  assert.notEqual(instrumented, worker)
  runInNewContext(instrumented, { self: scope, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, URL, crypto: globalThis.crypto }, { timeout: 2000 })
  assert.ok(scope.test)
  return scope.test
}

function compileFixture() {
  const hooks = harness(), fs = memoryFS()
  const state = {
    logs: ['Clean first pass.\n', 'Clean second pass.\n', 'Clean final pass.\n'] as (string | null)[],
    bibliography: null as null | 'biber' | 'bibtex8', bibLog: 'Bibliography completed.\n',
    calls: [] as string[][], passes: 0, biber: 0, failPass: 0, noPdfPass: 0,
    maps: [null, null, null] as (Uint8Array | null)[],
  }
  const request = { operationKey: 'injected-quality-test', engine: 'pdflatex', mainFile: 'main.tex', files: [{ path: 'main.tex', content: original }] }
  hooks.configure(fs.FS, request.engine, (args) => {
    state.calls.push([...args])
    if (args[0] === 'bibtex8') {
      assert.equal(fs.files.has('/job/output.bbl'), false, 'Fresh classic bibliography required')
      fs.FS.writeFile('/job/output.bbl', 'Fresh classic bibliography.\n')
      fs.FS.writeFile('/job/output.blg', state.bibLog)
      return
    }
    state.passes++
    assert.equal(fs.files.has('/job/output.log'), false, 'Previous pass log removed')
    assert.equal(fs.files.has('/job/output.pdf'), false, 'Previous pass PDF removed')
    assert.equal(fs.files.has('/job/output.synctex.gz'), false, 'Previous pass source map removed')
    assert.equal(new TextDecoder().decode(fs.files.get('/job/main.tex')), original)
    const text = state.logs[state.passes - 1]
    if (text !== null) fs.FS.writeFile('/job/output.log', text)
    if (state.noPdfPass !== state.passes) fs.FS.writeFile('/job/output.pdf', '%PDF-1.7\nINJECTED protocol bytes, not a verified/rendered PDF\n%%EOF\n')
    if (state.maps[state.passes - 1]) fs.FS.writeFile('/job/output.synctex.gz', state.maps[state.passes - 1]!)
    if (state.passes === 1 && state.bibliography) {
      fs.FS.writeFile('/job/output.aux', '\\bibdata{original}')
      fs.FS.writeFile('/job/output.bbl', 'Stale first-pass bibliography')
      if (state.bibliography === 'biber') fs.FS.writeFile('/job/output.bcf', 'Injected control-file selection fixture')
    }
    if (state.failPass === state.passes) throw Object.assign(new Error('Injected unsuccessful TeX exit'), { code: 'compile_failed' })
  }, async () => {
    state.biber++
    fs.FS.writeFile('/job/output.bbl', 'Injected actual-Biber-call result')
  })
  return { hooks, fs, state, request, run: () => hooks.compile(request) }
}

function catalog() {
  const group = (id: string, packages: string[], files: string[], requires: string[] = []): CatalogGroup => ({ id, kind: 'package', profiles: ['pdflatex', 'xelatex', 'lualatex'], packages, files, requires, assets: [{ bytes: 10 }, { bytes: 20 }] })
  return [
    { ...group('core', ['article'], ['article.cls']), kind: 'core' },
    group('math', ['amsmath'], ['amsmath.sty']),
    group('cv-layout', ['paracol', 'extarticle'], ['paracol.sty', 'extarticle.cls', 'pgfkeys.code.tex', 'library.def'], ['math']),
    group('cv-fonts', ['fontawesome5'], ['fontawesome5.sty', 'FontAwesome5Free-Regular-400.otf', 'Lato-Regular.ttf', 'T1font.fd', 'roboto.sty']),
    group('bibliography', ['biblatex'], ['biblatex.sty', 'ieee.bbx', 'ieee.cbx']),
  ]
}

test('runtime filename database indexes selected optical fonts without stale or project paths', () => {
  const hooks = harness(), files = ['texlive/texmf-dist/ls-R', 'texlive/texmf-dist/fonts/opentype/public/lm/lmroman12-regular.otf', 'texlive/texmf-dist/fonts/opentype/public/lm/lmmono8-regular.otf', 'texlive/texmf-dist/fonts/opentype/public/lm/lmsans17-oblique.otf', 'texlive/texmf-dist/tex/latex/base/article.cls', 'texlive/texmf-var/web2c/xetex/xelatex.fmt'].map((path) => ({ path }))
  const database = hooks.snapshotFilenameDatabase(files)
  assert.match(database, /^% ls-R -- filename database for kpathsea/)
  assert.match(database, /\.\/fonts\/opentype\/public\/lm:\nlmmono8-regular\.otf\nlmroman12-regular\.otf\nlmsans17-oblique\.otf\n/)
  assert.equal(database, hooks.snapshotFilenameDatabase([...files].reverse()))
  assert.equal(database.includes('xelatex.fmt'), false)
  assert.equal(database.includes('/job'), false)
})

for (const [message, expected] of [
  ["! LaTeX Error: File `paracol.sty' not found.", ['math', 'cv-layout']],
  ["classes/local.cls:9: LaTeX Error: File `extarticle.cls' not found.", ['math', 'cv-layout']],
  ["! I can't find file `pgfkeys.code.tex'.", ['math', 'cv-layout']],
  ["! LaTeX Error: File `library.def' not found.", ['math', 'cv-layout']],
  ["! Package biblatex Error: Style 'ieee' not found.", ['bibliography']],
  ["! Package biblatex Error: Citation style 'ieee' not found.", ['bibliography']],
  ['! Package fontspec Error: The font "Lato-Regular.ttf" cannot be found.', ['cv-fonts']],
  ['! Package fontspec Error: The font\n(fontspec) "FontAwesome5Free-Regular-400.otf" cannot be found.', ['cv-fonts']],
  ['xdvipdfmx:fatal: Could not find font "Lato-Regular.ttf".', ['cv-fonts']],
  ["! LaTeX Error: File `T1font.fd' not found.", ['cv-fonts']],
] as const) test(`actual worker maps authoritative exact runtime export + dependency closure: ${message}`, () => {
  const hooks = harness(); hooks.configureCatalog(catalog())
  const result = hooks.packageGroupRequirement(message)!
  assert.equal(result.code, 'package_group_required')
  assert.deepEqual([...result.details.groupIDs].sort(), [...expected].sort())
  assert.equal(result.details.downloadBytes, expected.length * 30 + (expected.some((id) => id === 'bibliography') ? 70 : 0))
})

test('wrapped compiler filenames remain exact and dependency lists omit groups already mounted', () => {
  const hooks = harness(); hooks.configureCatalog(catalog(), ['math'])
  const line = `${'a'.repeat(50)}.tex:2: LaTeX Error: File \`paracol.sty' not found.`
  const result = hooks.packageGroupRequirement(line.slice(0, 79) + '\n' + line.slice(79))!
  assert.deepEqual([...result.details.groupIDs], ['cv-layout']); assert.equal(result.details.downloadBytes, 30)
})

for (const message of [
  "Package probe Info: File `paracol.sty' not found.\n! Undefined control sequence.",
  "source.tex:3: Package probe Info: File `paracol.sty' not found.\n! Undefined control sequence.",
  "Package biblatex Info: Style 'ieee' not found.\n! Undefined control sequence.",
  "Package biblatex Info: ... file 'biblatex-dm.cfg' not found.\n! Undefined control sequence.",
  "l.9 \\message{File `paracol.sty' not found.}\n! Undefined control sequence.",
  "! LaTeX Error: File `missing.bib' not found.",
  "! LaTeX Error: File `photo.png' not found.",
  "! LaTeX Error: File `components/paracol.sty' not found.",
  "! LaTeX Error: File `../paracol.sty' not found.",
  "! LaTeX Error: File `https://example.org/paracol.sty' not found.",
  "! LaTeX Error: File `Paracol.sty' not found.",
  "! LaTeX Error: File `moderncv.cls' not found.",
  "! LaTeX Error: File `roboto.sty' not found.",
  "! Package fontspec Error: The font 'Lato' cannot be found.",
  "! Package biblatex Error: Style 'not-shipped' not found.",
]) test(`actual worker never invents a downloadable package: ${message}`, () => {
  const hooks = harness(); hooks.configureCatalog(catalog())
  assert.equal(hooks.packageGroupRequirement(message), null)
})

test('source-owned exports, compatible core files and installed package files never prompt again', () => {
  const hooks = harness(); hooks.configureCatalog(catalog(), ['cv-layout', 'math'])
  assert.equal(hooks.packageGroupRequirement("! LaTeX Error: File `paracol.sty' not found."), null)
  assert.equal(hooks.packageGroupRequirement("! LaTeX Error: File `article.cls' not found."), null)
  hooks.configureCatalog(catalog())
  assert.equal(hooks.packageGroupRequirement("! I can't find file `pgfkeys.code.tex'.", { files: [{ path: 'private/pgfkeys.code.tex' }] }), null)
  const incompatible = catalog(); incompatible.find((group) => group.id === 'cv-fonts')!.profiles = ['pdflatex']
  hooks.configureCatalog(incompatible)
  assert.equal(hooks.packageGroupRequirement("! LaTeX Error: File `fontawesome5.sty' not found."), null)
})

test('worker mounts exactly the compatible explicitly consented closed set, never all historical consent or missing dependencies', () => {
  const hooks = harness(), groups = catalog()
  groups.push({ id: 'other-core', kind: 'core', profiles: ['pdflatex'], packages: [], files: [], assets: [] })
  assert.throws(() => hooks.selectGroups({ groups }, 'xelatex', ['cv-layout']), { code: 'invalid_request' })
  const chosen = hooks.selectGroups({ groups }, 'xelatex', ['cv-layout', 'math'])
  assert.deepEqual(chosen.map((group) => group.id), ['core', 'math', 'cv-layout'])
  assert.equal(chosen.some((group) => group.id === 'cv-fonts' || group.id === 'bibliography' || group.id === 'other-core'), false)
})

test('worker independently bounds exact catalogs and rejects invalid dependency graphs', async () => {
  const deployed = JSON.parse(await readFile(new URL('../../../public/mr-resume/latex/busytex-v2/manifest.json', import.meta.url), 'utf8'))
  const hooks = harness()
  assert.doesNotThrow(() => hooks.validateManifest(deployed))
  for (const files of [['../foo.sty'], ['a/b.tex'], ['file://foo.sty'], ['a\n.tex'], ['.hidden.tex'], ['foo.lua'], ['x.sty', 'x.sty'], Array.from({ length: 8193 }, (_, index) => `f${index}.tex`)]) {
    const value = structuredClone(deployed); value.groups.find((group: CatalogGroup) => group.id === 'math').files = files
    assert.throws(() => hooks.validateManifest(value), { code: 'asset_integrity' })
  }
  for (const requires of [['unknown'], ['core'], ['math', 'math']]) {
    const value = structuredClone(deployed); value.groups.find((group: CatalogGroup) => group.id === 'cv-layout').requires = requires
    assert.throws(() => hooks.validateManifest(value), { code: 'asset_integrity' })
  }
  const cycle = structuredClone(deployed)
  cycle.groups.find((group: CatalogGroup) => group.id === 'cv-layout').requires = ['math']
  cycle.groups.find((group: CatalogGroup) => group.id === 'math').requires = ['cv-layout']
  assert.throws(() => hooks.validateManifest(cycle), { code: 'asset_integrity' })
  const incompatible = structuredClone(deployed)
  incompatible.groups.find((group: CatalogGroup) => group.id === 'cv-layout').requires = ['math']
  incompatible.groups.find((group: CatalogGroup) => group.id === 'math').profiles = ['pdflatex']
  assert.throws(() => hooks.validateManifest(incompatible), { code: 'asset_integrity' })
  const oversized = structuredClone(deployed); oversized.limitations = ['x'.repeat(1024 * 1024)]
  assert.throws(() => hooks.validateManifest(oversized), { code: 'asset_integrity' })
})

test('only the final-pass sidecar is copied and bound to the final PDF; absent final maps never reuse earlier bytes', async () => {
  for (const finalMap of [encode('final sidecar'), null]) {
    const f = compileFixture()
    f.state.logs[0] = 'LaTeX Warning: Label(s) may have changed.\n'
    f.state.maps = [encode('obsolete sidecar'), finalMap, null]
    const output = await f.run()
    assert.equal(f.state.passes, 2)
    if (finalMap) {
      assert.deepEqual(new Uint8Array(output.synctex!), finalMap)
      assert.equal(output.synctexPdfSha256, createHash('sha256').update(new Uint8Array(output.pdf)).digest('hex'))
      f.fs.files.get('/job/output.synctex.gz')!.fill(0)
      assert.deepEqual(new Uint8Array(output.synctex!), finalMap, 'Teardown/FS mutation cannot change the transferred map')
    } else assert.equal(output.synctex, undefined)
  }
})

test('generated sidecars larger than 8 MiB cannot be captured as navigation artifacts', async () => {
  const f = compileFixture(); f.state.maps[0] = new Uint8Array(8 * 1024 * 1024 + 1)
  await assert.rejects(f.run(), { code: 'output_limit' })
})

test('full bounded decoder keeps UTF-8 and records spanning every 64KiB chunk boundary', () => {
  for (const offset of [1, 8, 30, iconSpace.indexOf('[SimpleIcons'), iconSpace.length - 2]) {
    const hooks = harness(), f = memoryFS()
    const text = 'x'.repeat(CHUNK - offset - 1) + '\n' + iconSpace + '\u0995\ud83d\ude00\n'
    f.files.set('/job/output.log', encode(text))
    const complete = hooks.fullFileLog(f.FS, '/job/output.log')
    assert.equal(complete, text)
    assert.doesNotThrow(() => hooks.checkFinalLog(complete), `Pinned exception crossing byte ${CHUNK}, offset ${offset}`)
    assert.ok(f.reads.every((read) => read.length <= CHUNK))
    assert.equal(f.closed, 1)
  }
})

test('UTF-8 decoder flushes complete multibyte characters across chunk boundaries', () => {
  const hooks = harness(), f = memoryFS()
  const text = 'x'.repeat(CHUNK - 1) + '\u0995\ud83d\ude00'
  f.files.set('/job/output.log', encode(text))
  assert.equal(hooks.fullFileLog(f.FS, '/job/output.log'), text)
  assert.equal(f.closed, 1)
})

test('full-log reader refuses oversized, incomplete and impossible reads without relaxing budgets', () => {
  const hooks = harness(), f = memoryFS()
  f.files.set('/job/output.log', encode('Log data'))
  f.FS.stat = () => ({ size: JOB + 1 })
  assert.throws(() => hooks.fullFileLog(f.FS, '/job/output.log'), { code: 'output_limit' })
  assert.equal(f.closed, 0)
  f.FS.stat = () => ({ size: 8 })
  for (const count of [0, -1, Number.NaN, 9]) {
    f.FS.read = () => count
    assert.throws(() => hooks.fullFileLog(f.FS, '/job/output.log'), { code: 'compile_failed' })
  }
  assert.equal(f.closed, 4)
})

for (const message of [
  'Missing character: There is no X (U+F59F) in font [SimpleIcons.otf]!\n',
  'Missing character: There is no   (U+0020) in font [Lato-Regular.ttf]!\n',
  'Missing character: There is no   (U+0020) in font [FontAwesome.otf]!\n',
  'Missing character: There is no   (U+0020) in font [SimpleIcons.otf]\n',
  'Missing character: There is no   (U+0020) in font [SimpleIcons.otf]\n  ! Fatal error occurred.\n',
]) test(`only the exact complete icon-space record is ignored: ${message.trim()}`, () => {
  const hooks = harness(), f = memoryFS()
  f.files.set('/job/output.log', encode('x'.repeat(CHUNK - 12) + '\n' + message))
  assert.throws(() => hooks.checkFinalLog(hooks.fullFileLog(f.FS, '/job/output.log')), { code: 'missing_glyph' })
})

test('ignored record cannot swallow a later actual missing glyph or an indented fatal across chunks', () => {
  const hooks = harness(), f = memoryFS()
  for (const fatal of ['Missing character: There is no \u0995 in font Lato!\n', '  ! Fatal error occurred.\n']) {
    f.files.set('/job/output.log', encode('x'.repeat(CHUNK - 30) + '\n' + iconSpace + fatal))
    assert.throws(() => hooks.checkFinalLog(hooks.fullFileLog(f.FS, '/job/output.log')))
  }
})

for (const warning of [
  'LaTeX Warning: There were undefined references.\n',
  "LaTeX Warning: Citation `missing' on page 1 undefined.\n",
  "LaTeX Warning: Reference `missing' on page 1 undefined.\n",
  'Package natbib Warning: Citation `missing\'\n(natbib) on page 1 undefined.\n',
  'Package biblatex Warning: Please (re)run Biber on the file:\n',
  'Package rerunfilecheck Warning: File `output.out\'\n(rerunfilecheck) has changed.\n',
]) test(`final convergence warning before display tail cannot publish PDF: ${warning.trim()}`, async () => {
  const f = compileFixture()
  f.state.logs = Array(3).fill(warning + 'LaTeX Warning: An authored layout warning.\n'.repeat(5000))
  await assert.rejects(f.run(), { code: 'pass_limit' })
  assert.equal(f.state.passes, 3)
  assert.equal(f.state.biber, 0)
  assert.ok(encode(f.hooks.logs()).length <= DISPLAY)
  assert.match(f.hooks.logs(), /Final TeX pass still requires convergence/)
  assert.equal(f.hooks.fileLog(f.fs.FS, '/job/output.log').includes(warning.trim()), false)
})

for (const bibliography of [null, 'biber', 'bibtex8'] as const) test(`converged final pass discards earlier transient signals; bibliography=${bibliography}`, async () => {
  const f = compileFixture()
  f.state.bibliography = bibliography
  f.state.logs[0] = 'LaTeX Warning: Citation `publication\' on page 1 undefined.\n'
  f.state.logs[1] = 'LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.\n'
  f.state.logs[2] = iconSpace + 'main.tex:2: Overfull \\hbox (1pt too wide)\n'
  const output = await f.run()
  assert.ok(new TextDecoder().decode(output.pdf).startsWith('%PDF-'))
  assert.equal(f.state.passes, 3)
  assert.equal(f.state.biber, bibliography === 'biber' ? 1 : 0)
  assert.equal(f.state.calls.filter((args) => args[0] === 'bibtex8').length, bibliography === 'bibtex8' ? 1 : 0)
  const tex = f.state.calls.filter((args) => args[0] !== 'bibtex8')
  assert.ok(tex.every((args) => args.includes('--no-shell-escape') && args.includes('--halt-on-error') && args.includes('--file-line-error') && args.includes('--synctex=1')))
  assert.ok(tex.every((args) => JSON.stringify(args) === JSON.stringify(tex[0])))
  assert.equal(f.request.files[0].content, original)
})

test('ordinary file:line/package/font/box warnings remain nonfatal without forcing three passes', async () => {
  const f = compileFixture()
  f.state.logs[0] = "main.tex:3: Package hyperref Warning: Token not allowed in a PDF string.\n"
    + 'Package fontspec Info: Adjusting the math setup for XeTeX.\n'
    + 'LaTeX Font Warning: Some font shapes were not available, defaults substituted.\n'
    + 'Underfull \\vbox (badness 10000)\nNo file output.aux.\n'
  assert.equal(f.hooks.rerunReason(f.state.logs[0]), null)
  await f.run()
  assert.equal(f.state.passes, 1)
})

test('only final-pass content warnings gate the final proof when an earlier rerun resolves them', async () => {
  const f = compileFixture()
  f.state.logs[0] = 'LaTeX Warning: Label(s) may have changed.\n'
    + 'Missing character: There is no X in font FirstPassFont!\n'
    + "LaTeX Warning: File `generated.png' not found on input line 2.\n"
  await f.run()
  assert.equal(f.state.passes, 2)
})

for (const diagnostic of [
  "LaTeX Warning: File `photo.png' not found on input line 2.\n",
  'No file section.tex.\n',
  'main.tex:2: Undefined control sequence.\n',
  '! Fatal error occurred.\n',
]) test(`full final content/fatal gate refuses before display tail: ${diagnostic.trim()}`, async () => {
  const f = compileFixture()
  f.state.logs[0] = diagnostic + 'LaTeX Warning: Authored warning.\n'.repeat(6000)
  await assert.rejects(f.run(), { code: 'compile_failed' })
  assert.equal(f.state.passes, 1)
  assert.ok(encode(f.hooks.logs()).length <= DISPLAY)
})

test('classic bibliography missing-entry warning uses the full BLG and never returns a PDF', async () => {
  const f = compileFixture()
  f.state.bibliography = 'bibtex8'
  f.state.bibLog = 'Warning--I didn\'t find a database entry for "missing"\n' + 'Harmless bibliography output.\n'.repeat(6000)
  await assert.rejects(f.run(), { code: 'bibliography_failed' })
  assert.equal(f.state.passes, 1)
})

for (const status of ['warning', 'missing-entry', 'fatal', 'nonzero'] as const) test(`real Biber driver contract checks complete BLG; ${status}`, async () => {
  const hooks = harness(), tex = memoryFS(), biber = memoryFS(), calls: string[][] = []
  const request = { operationKey: 'injected-biber-quality', engine: 'pdflatex', mainFile: 'main.tex', files: [
    { path: 'main.tex', content: original }, { path: 'refs.bib', content: '@book{work,title={Original Bibliography}}' },
  ] }
  tex.FS.writeFile('/job/output.bcf', '<bcf:controlfile version="3.11"><bcf:datasource type="file" datatype="bibtex">refs.bib</bcf:datasource></bcf:controlfile>')
  hooks.configureBiber(biber.FS, (args) => {
    calls.push(args)
    assert.equal(new TextDecoder().decode(biber.files.get('/job/refs.bib')), request.files[1].content)
    const diagnostic = status === 'missing-entry' ? "WARN - I didn't find a database entry for 'missing'\n"
      : status === 'fatal' ? 'ERROR - Cannot find a required bibliography file\n' : 'WARN - Overwriting year with date field value\n'
    biber.FS.writeFile('/job/output.blg', 'x'.repeat(CHUNK - 8) + '\n' + diagnostic + 'Harmless bibliography detail.\n'.repeat(6000))
    biber.FS.writeFile('/job/output.bbl', '% $ biblatex bbl format version 3.3 $\n\\endinput\n')
    return status === 'nonzero' ? 1 : 0
  })
  if (status === 'warning') {
    await hooks.runBiber(request, tex.FS)
    assert.deepEqual(tex.files.get('/job/output.bbl'), biber.files.get('/job/output.bbl'))
  } else {
    await assert.rejects(hooks.runBiber(request, tex.FS), { code: 'bibliography_failed' })
    assert.equal(tex.files.has('/job/output.bbl'), false)
  }
  assert.equal(calls.length, 1)
  assert.equal(JSON.stringify(calls[0]), JSON.stringify(['/opt/perl-wasm/bin/biber', '--noconf', 'output.bcf']))
})

test('failed engine exit, missing final log and missing final PDF cannot reuse earlier success', async () => {
  for (const missing of ['exit', 'log', 'pdf']) {
    const f = compileFixture()
    f.state.logs[0] = 'LaTeX Warning: Label(s) may have changed.\n'
    if (missing === 'exit') f.state.failPass = 2
    if (missing === 'log') f.state.logs[1] = null
    if (missing === 'pdf') f.state.noPdfPass = 2
    await assert.rejects(f.run(), { code: missing === 'pdf' ? 'missing_pdf' : 'compile_failed' })
    assert.equal(f.state.passes, 2)
  }
})

test('long harmless repeated reference words do not become an all-warnings error', () => {
  const hooks = harness()
  const text = 'LaTeX Warning: ' + 'Citation Reference rerunfilecheck File '.repeat(10000)
  assert.equal(hooks.rerunReason(text), null)
  assert.doesNotThrow(() => hooks.checkFinalLog(text))
})
