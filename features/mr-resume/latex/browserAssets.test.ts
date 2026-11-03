import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import test from 'node:test'
import { gunzipSync } from 'node:zlib'
import { BROWSER_LATEX_PROFILE_VERSION, browserEngineAssetPins, readBrowserCompilerManifest } from './browserCompiler.ts'
import { BROWSER_LATEX_MANIFEST_PIN } from './browserManifestPin.ts'
import { commit, downloads, tarEntries } from './browser/provision.mjs'
import { isRecord } from './project.ts'

const root = new URL('../../../public/mr-resume/latex/busytex-v1/', import.meta.url)
const frontend = new URL('../../../', import.meta.url)
const safe = (path: string) => /^[a-zA-Z0-9_./-]+$/.test(path) && !path.split('/').some((part) => !part || part === '.' || part === '..')
const digest = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
type Pin = { path: string; bytes: number; sha256: string }
type FilePin = Pin & { source: string; upstreamPath?: string }
type SnapshotIndex = { version: 1; unpackedBytes: number; files: FilePin[] }

async function json(path: string): Promise<Record<string, unknown>> {
  assert.ok(safe(path))
  const value: unknown = JSON.parse(await readFile(new URL(path, root), 'utf8'))
  assert.ok(isRecord(value), path)
  return value
}

function pin(value: unknown): Pin {
  assert.ok(isRecord(value) && typeof value.path === 'string' && safe(value.path) && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes >= 0 && typeof value.sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.sha256))
  return { path: value.path, bytes: value.bytes, sha256: value.sha256 }
}

function snapshotIndex(value: unknown): SnapshotIndex {
  assert.ok(isRecord(value) && value.version === 1 && Number.isSafeInteger(value.unpackedBytes) && typeof value.unpackedBytes === 'number' && value.unpackedBytes >= 1024 && value.unpackedBytes <= 96 * 1024 * 1024 && value.unpackedBytes % 512 === 0 && Array.isArray(value.files) && value.files.length > 0 && value.files.length <= 6000)
  assert.ok(Object.keys(value).every((key) => ['version', 'root', 'unpackedBytes', 'files'].includes(key)))
  if (Object.hasOwn(value, 'root')) assert.equal(value.root, 'texlive')
  const files = value.files.map((file: unknown): FilePin => {
    const checked = pin(file)
    assert.ok(isRecord(file) && typeof file.source === 'string' && checked.path.startsWith('texlive/') && !checked.path.split('/').some((part) => part.endsWith('.')))
    assert.ok(Object.keys(file).every((key) => ['path', 'bytes', 'sha256', 'source', 'upstreamPath'].includes(key)))
    assert.ok(!Object.hasOwn(file, 'upstreamPath') || typeof file.upstreamPath === 'string')
    return { ...checked, source: file.source, ...(typeof file.upstreamPath === 'string' ? { upstreamPath: file.upstreamPath } : {}) }
  })
  assertDisjointPaths(files.map((file) => file.path))
  assert.ok(1024 + files.reduce((sum, file) => sum + 512 + Math.ceil(file.bytes / 512) * 512, 0) <= value.unpackedBytes)
  return { version: 1, unpackedBytes: value.unpackedBytes, files }
}

function assertDisjointPaths(paths: string[]) {
  const aliases = new Map<string, { name: string; kind: string }>()
  for (const path of paths) {
    assert.ok(safe(path) && !path.split('/').some((part) => part.endsWith('.')), path)
    const parts = path.split('/')
    for (let at = 1; at <= parts.length; at++) {
      const name = parts.slice(0, at).join('/'), kind = at === parts.length ? 'file' : 'directory', previous = aliases.get(name.toLowerCase())
      assert.ok(!previous || (previous.name === name && previous.kind === kind && kind === 'directory'), `Duplicate or aliased file/directory: ${path}`)
      aliases.set(name.toLowerCase(), { name, kind })
    }
  }
}

// Pure archive inspection only. Do not import the smoke harness or execute a
// worker/WASM engine to prove static deployment and corresponding-source pins.
function ustarFiles(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  assert.equal(tar.length % 512, 0)
  for (let at = 0; at + 512 <= tar.length;) {
    const header = tar.subarray(at, at + 512)
    if (header.every((byte) => byte === 0)) {
      assert.ok(at + 1024 <= tar.length && tar.subarray(at).every((byte) => byte === 0), 'Canonical two-block archive terminator')
      assertDisjointPaths([...files.keys()])
      return files
    }
    const text = (start: number, bytes: number) => {
      const field = header.subarray(start, start + bytes)
      assert.ok(field.every((byte) => byte <= 127), 'ASCII archive headers only')
      return field.toString('ascii').replace(/\0[\s\S]*$/, '')
    }
    const pathField = (start: number, bytes: number) => {
      const field = header.subarray(start, start + bytes), end = field.indexOf(0)
      assert.ok(end < 0 || field.subarray(end).every((byte) => byte === 0), 'Canonical path field')
      return text(start, bytes)
    }
    const octal = (start: number, bytes: number) => {
      const value = header.subarray(start, start + bytes).toString('ascii')
      assert.match(value, /^ *[0-7]+[\0 ]*$/)
      return Number.parseInt(value.trim(), 8)
    }
    const name = [pathField(345, 155), pathField(0, 100)].filter(Boolean).join('/'), bytes = octal(124, 12), end = at + 512 + Math.ceil(bytes / 512) * 512
    const checksum = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    assert.equal(text(156, 1), '0', 'Only regular files are shipped')
    assert.equal(text(257, 6), 'ustar'); assert.equal(text(263, 2), '00')
    assert.ok(header.subarray(157, 257).every((byte) => byte === 0), 'No link target or alias')
    assert.equal(checksum, octal(148, 8), 'Archive header checksum')
    assert.ok(Number.isSafeInteger(bytes) && bytes >= 0 && end <= tar.length && safe(name) && !files.has(name), name)
    assert.ok(tar.subarray(at + 512 + bytes, end).every((byte) => byte === 0), 'Zero member padding')
    files.set(name, tar.subarray(at + 512, at + 512 + bytes))
    at = end
  }
  assert.fail('Missing archive terminator')
}

function inspectSnapshot(tar: Buffer, index: SnapshotIndex) {
  assert.equal(tar.length, index.unpackedBytes)
  const files = ustarFiles(tar)
  assert.equal(files.size, index.files.length)
  for (const file of index.files) {
    const content = files.get(file.path)
    assert.ok(content, `Missing indexed member: ${file.path}`)
    assert.equal(content.length, file.bytes, file.path)
    assert.equal(digest(content), file.sha256, file.path)
    assert.ok(!file.path.includes('/bin/') && !/\.exe$/i.test(file.path), 'No native executable in runtime data')
  }
  return files
}

async function hash(path: string) {
  assert.ok(safe(path))
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(new URL(path, root))) digest.update(chunk)
  return digest.digest('hex')
}

test('deployed compiler manifest references real byte-pinned module-owned assets and unchanged upstream binaries', async () => {
  const content = await readFile(new URL('manifest.json', root))
  assert.equal(BROWSER_LATEX_MANIFEST_PIN.path, 'manifest.json')
  assert.equal(content.length, BROWSER_LATEX_MANIFEST_PIN.bytes)
  assert.equal(digest(content), BROWSER_LATEX_MANIFEST_PIN.sha256, 'Source-side pin must match the exact final deployed metadata')
  assert.equal(content.includes(Buffer.from('\r\n')), false); assert.equal(content.at(-1), 10)
  const manifest = readBrowserCompilerManifest(JSON.parse(content.toString('utf8')))
  assert.equal(manifest.profileVersion, BROWSER_LATEX_PROFILE_VERSION)
  const assets = [...manifest.assets, ...manifest.groups!.flatMap((group) => group.assets)]
  assert.equal(assets.some((asset) => asset.path === 'manifest.json' || asset.path.includes('browserManifestPin')), false, 'The manifest must not hash itself')
  for (const asset of assets) {
    assert.equal((await stat(new URL(asset.path, root))).size, asset.bytes, asset.path)
    assert.equal(await hash(asset.path), asset.sha256, asset.path)
  }
  assert.equal(manifest.assets.find((asset) => asset.path === 'busytex.js.bin')!.sha256, 'f381d9ba816d9a4389d429f54fe85f13396aa2f822973d9b66e1f527ced3434b')
  assert.equal(manifest.assets.find((asset) => asset.path === 'busytex.wasm')!.sha256, 'a7785b59bfddb8667e7738443f111430e3ee2bd3ec0c1c26629267849e091415')
  await assert.rejects(stat(new URL('busytex.js', root)), /ENOENT/)
  assert.ok(manifest.limitations.some((item) => item.includes('512 MiB')))
  assert.ok(manifest.limitations.some((item) => item.includes('Biber') && item.includes('unsupported')))
})

test('compiler checkout preserves pinned source and license bytes rather than applying newline conversion', async () => {
  assert.match(await readFile(new URL('../.gitattributes', root), 'utf8'), /busytex-v1\/\*\* -text/)
  const provenance: unknown = JSON.parse(await readFile(new URL('provenance.json', root), 'utf8'))
  assert.ok(isRecord(provenance) && Array.isArray(provenance.distributionAssets))
  const manifest = readBrowserCompilerManifest(await json('manifest.json'))
  const distribution = provenance.distributionAssets.map(pin)
  assert.equal(new Set(distribution.map((asset) => asset.path)).size, distribution.length)
  for (const asset of manifest.groups!.flatMap((group) => group.assets)) assert.deepEqual(distribution.find((recorded) => recorded.path === asset.path), asset, 'Runtime and provenance group pins must agree')
  for (const asset of provenance.distributionAssets) {
    assert.ok(isRecord(asset) && typeof asset.path === 'string' && safe(asset.path))
    assert.equal((await stat(new URL(asset.path, root))).size, asset.bytes, asset.path)
    assert.equal(await hash(asset.path), asset.sha256, asset.path)
  }
})

test('same-origin corresponding-source offer includes complete ordered pinned archives matching the redistributed binary', async () => {
  const offer: unknown = JSON.parse(await readFile(new URL('source-offer.json', root), 'utf8'))
  assert.ok(isRecord(offer) && isRecord(offer.binary) && Array.isArray(offer.archives) && isRecord(offer.build))
  assert.equal(offer.binary.sha256, await hash('busytex.wasm'))
  assert.deepEqual(offer.archives.map((archive) => isRecord(archive) && archive.name), ['busytex-source.tar.gz', 'texlive-source.tar.gz', 'expat-source.tar.gz', 'fontconfig-source.tar.gz'])
  assert.equal(offer.build.busytexCommit, commit)
  assert.equal(offer.build.emscriptenVersion, '3.1.43')
  for (const archive of offer.archives) {
    assert.ok(isRecord(archive) && Array.isArray(archive.parts) && typeof archive.sha256 === 'string' && Number.isSafeInteger(archive.bytes))
    const upstream = downloads.find((item) => item.name === archive.name)
    assert.ok(upstream)
    assert.equal(archive.bytes, upstream.bytes); assert.equal(archive.sha256, upstream.sha256); assert.equal(archive.url, upstream.url)
    const digest = createHash('sha256')
    let bytes = 0
    for (const part of archive.parts) {
      assert.ok(isRecord(part) && typeof part.path === 'string' && part.path.startsWith('sources/') && safe(part.path) && typeof part.sha256 === 'string')
      const metadata = await stat(new URL(part.path, root))
      assert.equal(metadata.size, part.bytes)
      assert.equal(await hash(part.path), part.sha256)
      bytes += metadata.size
      for await (const chunk of createReadStream(new URL(part.path, root))) digest.update(chunk)
    }
    assert.equal(bytes, archive.bytes)
    assert.equal(digest.digest('hex'), archive.sha256)
  }
  assert.match(await readFile(new URL('licenses/texlive-notices.txt', root), 'utf8'), /GNU GENERAL PUBLIC LICENSE/)
  assert.match(await readFile(new URL('licenses/busytex-notices.txt', root), 'utf8'), /Permission is hereby granted/)
  assert.match(await readFile(new URL('licenses/NotoSansBengali-OFL.txt', root), 'utf8'), /SIL OPEN FONT LICENSE/)
  assert.match(await readFile(new URL('licenses/LatinModern-GUST.txt', root), 'utf8'), /GUST Font License/)
  assert.match(await readFile(new URL('THIRD-PARTY-NOTICES.txt', root), 'utf8'), /GPL\/LGPL.*NOT an MIT-only binary/)
  for (const key of ['packageSources', 'provisioningSources']) {
    const path = offer.build[key]
    assert.ok(typeof path === 'string' && path.startsWith('sources/') && safe(path))
    assert.ok((await stat(new URL(path, root))).size > 0)
  }
})

test('six deployed ustar groups preserve all original member pins as a bounded disjoint legacy partition', async () => {
  const manifest = readBrowserCompilerManifest(await json('manifest.json')), legacy = snapshotIndex(await json('snapshot-index.json'))
  const legacyFiles = inspectSnapshot(gunzipSync(await readFile(new URL('texlive.snapshot.tar.gz', root)), { maxOutputLength: 96 * 1024 * 1024 }), legacy)
  assert.deepEqual(manifest.groups!.map((group) => group.id), ['core', 'pdflatex', 'xelatex', 'lualatex', 'unicode', 'math'])
  const originals = new Map(legacy.files.map((file) => [file.path, file])), installed: string[] = []
  let expandedBytes = 0
  for (const group of manifest.groups!) {
    const index = snapshotIndex(await json(group.index)), archive = gunzipSync(await readFile(new URL(group.archive, root)), { maxOutputLength: 96 * 1024 * 1024 })
    const members = inspectSnapshot(archive, index)
    expandedBytes += archive.length
    for (const file of index.files) {
      assert.deepEqual(file, originals.get(file.path), 'Partitioning may not change original bytes or supplier provenance')
      assert.ok(members.get(file.path)!.equals(legacyFiles.get(file.path)!))
      installed.push(file.path)
    }
    if (['pdflatex', 'xelatex', 'lualatex'].includes(group.id)) {
      assert.equal(members.size, 1)
      const format = group.id === 'pdflatex' ? 'pdftex/pdflatex.fmt' : group.id === 'xelatex' ? 'xetex/xelatex.fmt' : 'luahbtex/luahblatex.fmt'
      assert.ok(index.files[0].path.endsWith(`/web2c/${format}`))
    }
    if (group.kind === 'package') {
      const basenames = index.files.filter((file) => /\.(?:sty|cls)$/.test(file.path)).map((file) => file.path.slice(file.path.lastIndexOf('/') + 1).replace(/\.(?:sty|cls)$/, '')).sort()
      assert.deepEqual(group.packages, basenames, 'Optional package names must be actual shipped sty/cls basenames')
      assert.ok(group.assets.find((asset) => asset.path === group.archive)!.bytes <= 12 * 1024 * 1024)
    }
  }
  assertDisjointPaths(installed)
  assert.deepEqual([...installed].sort(), [...originals.keys()].sort())
  assert.equal(installed.length, 3454); assert.ok(installed.length <= 6000)
  assert.equal(expandedBytes, 76_025_856); assert.ok(expandedBytes <= 96 * 1024 * 1024)
  assert.equal(legacy.unpackedBytes, 76_020_736)
  const actualDatabase = legacyFiles.get('texlive/texmf-dist/ls-R')!.toString('utf8')
  const directories = new Map<string, Set<string>>([['', new Set(['ls-R'])]])
  for (const file of legacy.files.filter((file) => file.path.startsWith('texlive/texmf-dist/'))) {
    const parts = file.path.slice('texlive/texmf-dist/'.length).split('/')
    for (let at = 0; at < parts.length; at++) {
      const directory = parts.slice(0, at).join('/')
      if (!directories.has(directory)) directories.set(directory, new Set())
      directories.get(directory)!.add(parts[at])
    }
  }
  const expectedDatabase = '% ls-R -- filename database for kpathsea; do not change this line.\n' + [...directories].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([directory, names]) => `\n./${directory}:\n${[...names].sort().join('\n')}\n`).join('')
  assert.equal(actualDatabase, expectedDatabase, 'The fixed ls-R must index the entire partition without rewriting runtime files')
})

test('selected engine counts and byte totals are exact manifest arithmetic, not measured download performance', async (context) => {
  const manifest = readBrowserCompilerManifest(await json('manifest.json'))
  const all = [...manifest.assets, ...manifest.groups!.flatMap((group) => group.assets)], sum = (pins: Pin[]) => pins.reduce((total, pin) => total + pin.bytes, 0)
  assert.equal(manifest.assets.length, 5); assert.equal(sum(manifest.assets), 71_506_455)
  assert.equal(all.length, 17); assert.equal(new Set(all.map((pin) => pin.path)).size, 17); assert.equal(sum(all), 112_307_514)
  assert.ok(all.length <= 64 && sum(all) <= 256 * 1024 * 1024)
  assert.deepEqual(manifest.groups!.filter((group) => group.kind === 'package').map((group) => group.id), ['math'])
  const math = manifest.groups!.find((group) => group.id === 'math')!
  assert.equal(math.assets.length, 2); assert.equal(sum(math.assets), 133_631)
  for (const [engine, count, bytes] of [['pdflatex', 7, 53_373_036], ['xelatex', 9, 56_747_387], ['lualatex', 9, 59_068_079]] as const) {
    const selected = browserEngineAssetPins(manifest, engine), approved = browserEngineAssetPins(manifest, engine, ['math'])
    assert.equal(selected.length, count); assert.equal(sum(selected), bytes)
    assert.equal(approved.length, count + 2); assert.equal(sum(approved), bytes + 133_631)
    assert.equal(selected.some((asset) => asset.path.startsWith('groups/math/') || ['snapshot-index.json', 'texlive.snapshot.tar.gz'].includes(asset.path)), false)
    context.diagnostic(`${engine}: ${count} required pins / ${bytes} bytes; math adds 2 pins / 133631 bytes; manifest metadata (${BROWSER_LATEX_MANIFEST_PIN.bytes} bytes) is separate.`)
  }
  assert.equal(manifest.groups!.some((group) => group.packages.some((name) => ['tcolorbox', 'mdframed'].includes(name))), false)
})

test('provisioning source archive is fresh, includes the exact required license input, and excludes the generated manifest pin', async () => {
  const offer = await json('source-offer.json')
  assert.ok(isRecord(offer.build) && Array.isArray(offer.build.provisioningFiles) && typeof offer.build.provisioningSources === 'string')
  const archive = pin(offer.build.provisioningArchive)
  assert.equal(archive.path, offer.build.provisioningSources)
  assert.equal((await stat(new URL(archive.path, root))).size, archive.bytes); assert.equal(await hash(archive.path), archive.sha256)
  const files = ustarFiles(gunzipSync(await readFile(new URL(archive.path, root)), { maxOutputLength: 4 * 1024 * 1024 }))
  const expected = ['provision.mjs', 'build-format.mjs', 'smoke.mjs', 'smoke-worker.mjs'].map((name) => `nextjs-frontend/features/mr-resume/latex/browser/${name}`)
  expected.push('nextjs-frontend/public/mr-resume/latex/busytex-v1/compiler-worker.js', 'nextjs-frontend/features/mr-resume/components/fonts/latin-modern/LICENSE.txt')
  assert.deepEqual([...files.keys()].sort(), [...expected].sort())
  const recorded = offer.build.provisioningFiles.map(pin)
  assert.deepEqual(recorded.map((file) => file.path).sort(), [...expected].sort())
  for (const file of recorded) {
    const content = files.get(file.path)!, current = await readFile(new URL(file.path.slice('nextjs-frontend/'.length), frontend))
    assert.equal(content.length, file.bytes); assert.equal(digest(content), file.sha256)
    const expectedBytes = file.path.endsWith('.mjs') ? Buffer.from(current.toString('utf8').replace(/\r\n/g, '\n')) : current
    assert.ok(content.equals(expectedBytes), `Stale corresponding provisioning input: ${file.path}`)
  }
  const worker = files.get('nextjs-frontend/public/mr-resume/latex/busytex-v1/compiler-worker.js')!
  assert.equal(digest(worker), await hash('compiler-worker.js'))
  assert.equal(worker.includes(Buffer.from('BROWSER_LATEX_MANIFEST_PIN')), false)
  assert.match(String(offer.build.generatedManifestPin), /excluded.*avoid a hash cycle/)
  assert.match(String(offer.build.smokeHarness), /not a standalone regression harness/)
  for (const dependency of ['TypeScript', 'pdf-lib', 'sharp', 'jszip', 'pdfjs-dist', 'Mr.Resume/AltaCV_Template.zip']) assert.ok(String(offer.build.smokeHarness).includes(dependency), dependency)
  assert.match(String(offer.build.provision), /neither mode downloads assets.*runs TeX/)
})

test('supplemental raw shipped source copies and embedded licenses match every actual supplier member without inventing full generated sources', async (context) => {
  const offer = await json('source-offer.json'), index = await json('sources/tex-supplemental-runtime-index.json'), legacy = snapshotIndex(await json('snapshot-index.json')), provenance = await json('provenance.json')
  assert.ok(isRecord(offer.packageCoverage) && Array.isArray(index.packages) && isRecord(index.originalInputs) && Array.isArray(provenance.downloads))
  const sourceDownloads = provenance.downloads
  assert.equal(index.profileVersion, BROWSER_LATEX_PROFILE_VERSION)
  const archive = pin(index.archive)
  assert.deepEqual(archive, offer.packageCoverage.supplementalRuntimeSources)
  const files = ustarFiles(gunzipSync(await readFile(new URL(archive.path, root)), { maxOutputLength: 16 * 1024 * 1024 }))
  const expected = new Map(legacy.files.filter((file) => /^ubuntu-texlive-latex-(?:extra|recommended)\.data$/.test(file.source)).map((file) => [file.path, file]))
  assert.deepEqual([...files.keys()].sort(), [...expected.keys()].sort())
  assert.deepEqual(index.packages.map((entry) => isRecord(entry) && entry.name), ['enumitem', 'fontspec', 'makecmds', 'polyglossia', 'titlesec', 'xkeyval', 'xltxtra', 'xunicode'])
  const recorded: string[] = []
  for (const entry of index.packages) {
    assert.ok(isRecord(entry) && typeof entry.name === 'string' && Array.isArray(entry.files) && Array.isArray(entry.inputs) && Array.isArray(entry.groups) && Array.isArray(entry.embeddedNotices) && entry.embeddedNotices.length > 0)
    const supplied: FilePin[] = []
    for (const file of entry.files) {
      const checked = pin(file), original = expected.get(checked.path), content = files.get(checked.path)
      assert.ok(isRecord(file) && original && content && checked.path.includes(`/${entry.name}/`))
      const { kind, ...originalPin } = file
      assert.deepEqual(originalPin, original)
      assert.equal(content.length, checked.bytes); assert.equal(digest(content), checked.sha256)
      assert.equal(kind, checked.path.endsWith('.tec') ? 'compiled-map-with-shipped-map-source' : 'raw-shipped-runtime-file')
      if (checked.path.endsWith('.tec')) assert.ok(files.has(checked.path.replace(/\.tec$/, '.map')), 'Compiled map source is actually present')
      supplied.push(original); recorded.push(checked.path)
    }
    const sources = [...new Set(supplied.map((file) => file.source))].sort().flatMap((source) => [source.replace(/\.data$/, '.js'), source])
    assert.deepEqual(entry.inputs, sources.map((name) => sourceDownloads.find((input: unknown) => isRecord(input) && input.name === name)))
    const manifest = readBrowserCompilerManifest(await json('manifest.json'))
    const groups: string[] = []
    for (const group of manifest.groups!) if (snapshotIndex(await json(group.index)).files.some((file) => supplied.some((source) => source.path === file.path))) groups.push(group.id)
    assert.deepEqual(entry.groups, groups)
    for (const evidence of entry.embeddedNotices) {
      assert.ok(isRecord(evidence) && Array.isArray(evidence.lines) && evidence.lines.length > 0)
      const file = pin(evidence.file), original = expected.get(file.path)
      assert.ok(original); assert.deepEqual(evidence.file, original)
      const lines = files.get(file.path)!.toString('utf8').split(/\r\n|\n|\r/)
      for (const line of evidence.lines) {
        assert.ok(isRecord(line) && typeof line.line === 'number' && Number.isSafeInteger(line.line) && line.line > 0 && typeof line.text === 'string')
        assert.equal(line.text, lines[line.line - 1], 'Embedded license evidence is an exact original line, not an invented summary')
        assert.match(line.text, /copyright|license|licence|\bLPPL\b/i)
      }
    }
  }
  assertDisjointPaths(recorded); assert.deepEqual(recorded.sort(), [...expected.keys()].sort())
  assert.equal(expected.size, 293)
  assert.match(String(index.coverage), /NOT a complete upstream generated-source/)
  const originalInputs = index.originalInputs
  assert.ok(isRecord(originalInputs.texliveDistribution) && Array.isArray(originalInputs.ubuntuSelectors) && isRecord(originalInputs.debianUbuntuSourceInputs) && Array.isArray(originalInputs.recipeFiles))
  assert.equal(originalInputs.texliveDistribution.url, 'https://tug.ctan.org/systems/texlive/Images/texlive2023-20230313.iso')
  assert.equal(originalInputs.texliveDistribution.sha256, null, 'Unavailable original input hashes must not be invented')
  assert.deepEqual(originalInputs.debianUbuntuSourceInputs.urls, [])
  const recipePin = pin(originalInputs.recipeArchive)
  assert.ok(Array.isArray(offer.archives))
  const offeredRecipe = offer.archives.find((entry: unknown) => isRecord(entry) && entry.name === 'busytex-source.tar.gz')
  assert.ok(isRecord(offeredRecipe) && Array.isArray(offeredRecipe.parts))
  assert.deepEqual(recipePin, offeredRecipe.parts[0])
  const recipe = new Map(tarEntries(gunzipSync(await readFile(new URL(recipePin.path, root)), { maxOutputLength: 4 * 1024 * 1024 })).map((entry) => [entry.path, entry.content]))
  assert.deepEqual(originalInputs.recipeFiles.map((file) => pin(file).path), ['Makefile', 'ubuntu_package_preload.py', '.github/workflows/build-wasm.yml'].map((name) => `busytex-${commit}/${name}`))
  for (const value of originalInputs.recipeFiles) {
    const file = pin(value), content = recipe.get(file.path)
    assert.ok(content); assert.equal(content.length, file.bytes); assert.equal(digest(content), file.sha256)
  }
  assert.match(recipe.get(`busytex-${commit}/ubuntu_package_preload.py`)!.toString('utf8'), /path\.replace\(texmf_ubuntu, texmf_src\)/)
  assert.match(recipe.get(`busytex-${commit}/.github/workflows/build-wasm.yml`)!.toString('utf8'), /TEXMFFULL=build\/texlive-full/)
  assert.deepEqual(originalInputs.ubuntuSelectors.map((value) => isRecord(value) && value.package), ['texlive-latex-extra', 'texlive-latex-recommended'])
  for (const value of originalInputs.ubuntuSelectors) {
    assert.ok(isRecord(value) && typeof value.package === 'string')
    assert.equal(value.url, `https://packages.ubuntu.com/lunar/all/${value.package}/filelist`)
    assert.equal(value.sha256, null)
    assert.match(String(value.status), /not a pinned \.deb or source archive/)
  }
  context.diagnostic(`Supplemental source coverage: ${expected.size} exact runtime members in ${index.packages.length} packages; ${archive.bytes} compressed bytes; complete upstream generated-source inputs remain explicitly unclaimed.`)
})

test('every deployed group records coherent supplier, preserved-source and separate license pins', async () => {
  const manifest = readBrowserCompilerManifest(await json('manifest.json')), provenance = await json('provenance.json'), offer = await json('source-offer.json')
  assert.ok(Array.isArray(provenance.distributionAssets) && Array.isArray(provenance.downloads) && Array.isArray(provenance.groupSources) && isRecord(offer.packageCoverage))
  assert.deepEqual(provenance.groupSources, offer.packageCoverage.groups)
  const distribution = new Map(provenance.distributionAssets.map((asset) => { const checked = pin(asset); return [checked.path, checked] }))
  assert.deepEqual(provenance.groupSources.map((group) => isRecord(group) && group.id), manifest.groups!.map((group) => group.id))
  for (const recorded of provenance.groupSources) {
    assert.ok(isRecord(recorded) && Array.isArray(recorded.suppliers))
    const group = manifest.groups!.find((group) => group.id === recorded.id)!
    assert.ok(group); assert.equal(recorded.kind, group.kind); assert.deepEqual(recorded.profiles, group.profiles)
    assert.deepEqual(recorded.archive, group.assets.find((asset) => asset.path === group.archive)); assert.deepEqual(recorded.index, group.assets.find((asset) => asset.path === group.index))
    const index = snapshotIndex(await json(group.index)), sourceNames = [...new Set(index.files.map((file) => file.source))].sort()
    assert.equal(recorded.files, index.files.length); assert.equal(recorded.fileBytes, index.files.reduce((sum, file) => sum + file.bytes, 0))
    assert.deepEqual(recorded.suppliers.map((supplier) => isRecord(supplier) && supplier.source), sourceNames)
    assert.match(String(recorded.licenseScope), /not a blanket license.*GPL\/LGPL/)
    for (const supplier of recorded.suppliers) {
      assert.ok(isRecord(supplier) && typeof supplier.source === 'string' && Array.isArray(supplier.upstreamInputs) && Array.isArray(supplier.preservedSources) && Array.isArray(supplier.notices))
      const members = index.files.filter((file) => file.source === supplier.source)
      assert.equal(supplier.files, members.length); assert.equal(supplier.fileBytes, members.reduce((sum, file) => sum + file.bytes, 0))
      const names = supplier.source === 'generated-from-fixed-snapshot' ? [] : supplier.source === 'generated-wasm32-lualatex-format' ? ['busytex.wasm', 'texlive-basic.tar.gz'] : supplier.source.startsWith('ubuntu-') ? [supplier.source.replace(/\.data$/, '.js'), supplier.source] : [supplier.source]
      assert.deepEqual(supplier.upstreamInputs.map((source) => isRecord(source) && source.name), names)
      for (const source of supplier.upstreamInputs) {
        assert.ok(isRecord(source) && typeof source.name === 'string')
        assert.deepEqual(source, provenance.downloads.find((input: unknown) => isRecord(input) && input.name === source.name))
      }
      for (const asset of [...supplier.preservedSources, ...supplier.notices]) { const checked = pin(asset); assert.deepEqual(checked, distribution.get(checked.path)) }
      const notices = supplier.notices.map((asset) => pin(asset).path), preserved = supplier.preservedSources.map((asset) => pin(asset).path)
      if (supplier.source === 'generated-from-fixed-snapshot') assert.ok(preserved.includes('sources/browser-provisioning-source.tar.gz'))
      else if (supplier.source === 'NotoSansBengali.ttf') assert.ok(notices.includes('licenses/NotoSansBengali-OFL.txt'))
      else {
        assert.ok(notices.includes('licenses/LICENSE.TL') && notices.includes('licenses/LICENSE.CTAN'))
        assert.ok(supplier.upstreamInputs.length > 0 && preserved.length > 0)
        if (supplier.source.startsWith('ubuntu-')) assert.ok(preserved.includes('sources/tex-supplemental-runtime-source.tar.gz') && preserved.includes('sources/tex-supplemental-runtime-index.json'))
        if (supplier.source === 'generated-wasm32-lualatex-format') assert.ok(preserved.includes('format-provenance.json') && preserved.includes('sources/browser-provisioning-source.tar.gz'))
      }
    }
  }
})

test('pure asset inspection rejects altered member hashes, links, aliases, traversal and bad tar termination without executing TeX', async () => {
  const tar = gunzipSync(await readFile(new URL('groups/pdflatex/texlive.tar.gz', root)), { maxOutputLength: 96 * 1024 * 1024 }), index = snapshotIndex(await json('groups/pdflatex/snapshot-index.json'))
  const corrupt = Buffer.from(tar); corrupt[512] ^= 1
  assert.throws(() => inspectSnapshot(corrupt, index))
  const link = Buffer.from(tar); link[156] = 50
  assert.throws(() => ustarFiles(link), /Only regular files are shipped/)
  const unterminated = Buffer.from(tar); unterminated[unterminated.length - 1] = 1
  assert.throws(() => ustarFiles(unterminated), /Canonical two-block archive terminator/)
  assert.throws(() => assertDisjointPaths(['texlive/A.tex', 'texlive/a.tex']), /aliased/)
  assert.throws(() => assertDisjointPaths(['texlive/a', 'texlive/a/b.tex']), /aliased/)
  assert.throws(() => assertDisjointPaths(['texlive/../private.tex']))
})
