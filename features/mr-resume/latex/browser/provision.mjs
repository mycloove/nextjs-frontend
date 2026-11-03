import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { createGunzip, gunzipSync, gzipSync } from 'node:zlib'

// Build-time only. The worker never imports this module or contacts these hosts.
export const release = 'build_wasm_4499aa69fd3cf77ad86a47287d9a5193cf5ad993_7936974349_1'
export const commit = '4499aa69fd3cf77ad86a47287d9a5193cf5ad993'
const base = `https://github.com/busytex/busytex/releases/download/${release}`
export const downloads = [
  { name: 'busytex.js', bytes: 295606, sha256: 'f381d9ba816d9a4389d429f54fe85f13396aa2f822973d9b66e1f527ced3434b' },
  { name: 'busytex.wasm', bytes: 30363063, sha256: 'a7785b59bfddb8667e7738443f111430e3ee2bd3ec0c1c26629267849e091415' },
  { name: 'texlive-basic.tar.gz', bytes: 70838141, sha256: 'a2d753d927b97b1bd45424366ff86f5a4d60ea61c4e421cb093d9a6533ecbfd1' },
  { name: 'ubuntu-texlive-latex-extra.js', bytes: 1398581, sha256: 'a99a68b79e6a93f3ca9d94f46afe8a62e7e06b6d4c5e90a705ec15fc42d8ecda' },
  { name: 'ubuntu-texlive-latex-extra.data', bytes: 49513577, sha256: 'fb4dc0440f4b2bd2d5138dbb5689e6a33cd20c9704934422436cb97af5d623c4' },
  { name: 'versions.txt', bytes: 473, sha256: 'bb4c0babeb41ae2e5bff11b476fb0dacbadd2a616dbde4de4bf3dd0e6859d299' },
  { name: 'ubuntu-texlive-latex-recommended.js', bytes: 337892, sha256: 'bbd975921a74adae9119988ae8a740ca9f4837db772061d313c67729fba1d9ee' },
  { name: 'ubuntu-texlive-latex-recommended.data', bytes: 9058527, sha256: 'fa9a03f928a0af0e9c5a24e2ce2956e64db9d580dd2c3a7517176aac16dc9006' },
  { name: 'busytex-source.tar.gz', bytes: 45424, sha256: 'b39ad7f7b176a834fd5f17b0136cccde68b7da6ec21f33dd9f0ce74b17e4f844', url: `https://codeload.github.com/busytex/busytex/tar.gz/${commit}` },
  { name: 'texlive-source.tar.gz', bytes: 107734199, sha256: 'aa53f7069627a20acfaa38b0104aee3ac3e23c5e220a9950e701405497cd00e1', url: 'https://codeload.github.com/TeX-Live/texlive-source/tar.gz/0d0bb3a2401e8825b4987eee51e8ef469eb8c3fc' },
  { name: 'expat-source.tar.gz', bytes: 719235, sha256: '6b902ab103843592be5e99504f846ec109c1abb692e85347587f237a4ffa1033', url: 'https://github.com/libexpat/libexpat/releases/download/R_2_5_0/expat-2.5.0.tar.gz' },
  { name: 'fontconfig-source.tar.gz', bytes: 2133746, sha256: 'dbabc038d41cfc3f14da1b173ae103ba7cc678efb17e091b9e801c6286b3f684', url: 'https://www.freedesktop.org/software/fontconfig/release/fontconfig-2.13.96.tar.gz' },
  { name: 'NotoSansBengali.ttf', bytes: 463668, sha256: 'dcd42978094e584a849c84a51450eeac40c8826057d566ea6d4b9627a403a05a', url: 'https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/notosansbengali/NotoSansBengali%5Bwdth%2Cwght%5D.ttf' },
  { name: 'NotoSansBengali-OFL.txt', bytes: 4383, sha256: '754f0e221aa7d5a915489f3bf1f20fe53ddc35ab2834a4d91656d78f9622de70', url: 'https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl/notosansbengali/OFL.txt' },
]
export const sha256 = (data) => createHash('sha256').update(data).digest('hex')
export const staticDirectory = fileURLToPath(new URL('../../../../public/mr-resume/latex/busytex-v1/', import.meta.url))
export const profileVersion = 'browser-busytex-v1-tl2023-4499aa69-r5'
export const formatPin = { bytes: 11870231, sha256: '8189d4954446de324cfb3182f0c276fa8b4d6a213aef98b53192eea78b08630d' }
const runtimeAssetPaths = ['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm', 'snapshot-index.json', 'texlive.snapshot.tar.gz']
const commonPackages = ['article', 'geometry', 'enumitem', 'titlesec', 'hyperref', 'graphicx', 'classic-bibtex']
const profiles = [
  { id: 'pdflatex', name: 'pdfLaTeX (browser)', version: 'pdfTeX 1.40.25 / TeX Live 2023.0', fonts: ['Computer Modern', 'Latin Modern Roman'], packages: [...commonPackages, 'lmodern'] },
  { id: 'xelatex', name: 'XeLaTeX (browser)', version: 'XeTeX 0.999995 / TeX Live 2023.0', fonts: ['Latin Modern Roman'], packages: [...commonPackages, 'fontspec'] },
  { id: 'lualatex', name: 'LuaLaTeX / LuaHBTeX (browser)', version: 'LuaHBTeX 1.16.0 / TeX Live 2023.0', fonts: ['Latin Modern Roman', 'Noto Sans Bengali'], packages: [...commonPackages, 'fontspec', 'polyglossia'] },
]
const limitations = [
  'Fixed, pruned TeX Live 2023 package snapshot. No remote package resolution, native filesystem, or network is available to TeX.',
  'Grouped loading installs core and every profile group for the selected engine. Optional AMS math packages require explicit same-origin download consent; no missing package is fetched automatically.',
  'At most three TeX passes and one classic BibTeX8 pass. Biber and biblatex are unsupported; the native Academic CV template is refused without substitution.',
  'LuaLaTeX explicitly runs the bundled LuaHBTeX luahblatex format. Only the listed fonts and smoke-tested profiles are advertised.',
  'One compile per worker; cancellation/deadline requires the parent to terminate the worker. The binary reserves 512 MiB of WASM memory.',
  'The unmodified binary uses a guarded, malloc-owned 8 MiB WASM stack. The LuaHB format is built with the actual WASM engine to avoid incompatible native Lua bytecode; runtime init never generates formats.',
  'Shell escape and Lua sockets are disabled. External tools, EPS conversion, makeindex, dynamic fonts/packages, and SyncTeX are unsupported.',
  'Bengali glyph coverage with Noto Sans Bengali/HarfBuzz is supported, but complex Bangla Unicode text extraction/search/ATS fidelity is not guaranteed. No Bengali hyphenation patterns are bundled.',
  'pdfLaTeX Computer Modern covers the basic text/math profile, not the extra TC/EC outlines. Use explicit \\usepackage{lmodern} for extended symbols/T1; missing font data is refused, never substituted.',
  'Source is limited to 1 MiB, source plus assets to 3 MiB, 32 files, logs to 128 KiB and final PDF to 3 MiB. Parent validates PDF structure, pages and hash.',
]

const latexPackages = new Set(['base', 'l3kernel', 'l3packages', 'l3backend', 'latexconfig', 'firstaid', 'tools', 'graphics', 'graphics-cfg', 'graphics-def', 'geometry', 'hyperref', 'etoolbox', 'oberdiek', 'kvoptions', 'kvsetkeys', 'auxhook', 'atveryend', 'refcount', 'gettitlestring', 'url', 'rerunfilecheck', 'hycolor', 'letltxmacro', 'hopatch', 'lm', 'amsmath', 'amsfonts', 'amscls', 'natbib', 'filehook'])
const luaPackages = new Set(['luaotfload', 'lualibs', 'luatexbase', 'hyph-utf8', 'ctablestack', 'lua-uni-algos'])
const supplemental = /\/(?:fontspec|polyglossia|makecmds|xkeyval|xunicode|xltxtra|enumitem|titlesec)\//

function keepRuntime(relative) {
  const segments = relative.split('/')
  if (relative === 'texmf.cnf' || relative === 'texmfcnf.lua' || /^LICENSE\./.test(relative)) return true
  if (segments[0] !== 'texmf-dist') return false
  if (segments[1] === 'tex') {
    if (segments[2] === 'generic') return true
    if (segments[2] === 'latex') return latexPackages.has(segments[3])
    if (segments[2] === 'luatex') return luaPackages.has(segments[3])
    return segments[2] === 'lualatex' && ['lualatex-math', 'luacode'].includes(segments[3])
  }
  if (segments[1] === 'texmf-var') return /\/(?:pdflatex|xelatex|luahblatex)\.fmt$/.test(relative) || relative.includes('/fonts/map/')
  if (segments[1] === 'fonts') {
    if (['map', 'enc', 'cmap', 'vf', 'misc'].includes(segments[2])) return true
    if (segments[2] === 'opentype') return /^lmroman10-(?:regular|bold|italic|bolditalic)\.otf$/.test(segments.at(-1))
    if (['tfm', 'type1'].includes(segments[2])) return segments.some((part) => ['cm', 'amsfonts', 'lm'].includes(part)) || ['adobe', 'urw', 'monotype', 'urw35vf'].includes(segments[3])
    return false
  }
  return (segments[1] === 'bibtex' && segments[2] === 'bst' && ['base', 'natbib'].includes(segments[3]))
    || (segments[1] === 'dvipdfmx' && segments[2] === 'dvipdfmx.cfg')
    || (segments[1] === 'web2c' && ['texmf.cnf', 'texmfcnf.lua', 'cp8bit.tcx'].includes(segments[2]))
}

// Decode only selected blocks from Emscripten's LZ4 metadata. Vendor loaders and
// their IndexedDB/network fallback code are never executed or shipped.
function lz4Block(input) {
  const output = Buffer.alloc(2048)
  let at = 0, written = 0
  const length = (initial) => {
    let result = initial
    if (initial === 15) { let byte; do { if (at >= input.length) throw new Error('Truncated LZ4 length'); byte = input[at++]; result += byte } while (byte === 255) }
    return result
  }
  while (at < input.length) {
    const token = input[at++]
    const literal = length(token >>> 4)
    if (at + literal > input.length || written + literal > output.length) throw new Error('Invalid LZ4 literal')
    input.copy(output, written, at, at + literal); at += literal; written += literal
    if (at === input.length) break
    if (at + 2 > input.length) throw new Error('Truncated LZ4 offset')
    const offset = input[at++] | input[at++] << 8
    const match = length(token & 15) + 4
    if (!offset || offset > written || written + match > output.length) throw new Error('Invalid LZ4 match')
    for (let end = written + match; written < end; written++) output[written] = output[written - offset]
  }
  return output.subarray(0, written)
}

async function packageEntries(cache, name) {
  const script = await readFile(path.join(cache, `${name}.js`), 'utf8')
  const metadata = JSON.parse(script.match(/loadPackage\((\{"files"[^\r\n]+\})\);/)[1])
  const compressed = JSON.parse(script.match(/var compressedData = (\{[^\r\n]+\})/)[1])
  const data = await readFile(path.join(cache, `${name}.data`))
  if (metadata.package_uuid !== `sha256-${sha256(data)}`) throw new Error('Package data/metadata mismatch')
  const blocks = new Map()
  return metadata.files.filter((file) => supplemental.test(file.filename)).map((file) => {
    const content = Buffer.alloc(file.end - file.start)
    for (let at = file.start; at < file.end;) {
      const index = Math.floor(at / 2048)
      if (!blocks.has(index)) {
        const block = data.subarray(compressed.offsets[index], compressed.offsets[index] + compressed.sizes[index])
        blocks.set(index, compressed.successes[index] ? lz4Block(block) : block)
      }
      const block = blocks.get(index)
      const start = at % 2048, count = Math.min(file.end - at, block.length - start)
      if (count <= 0) throw new Error('Invalid package file range')
      block.copy(content, at - file.start, start, start + count); at += count
    }
    return { path: file.filename.replace(/^\/texmf\//, 'texlive/'), content, source: `${name}.data`, upstreamPath: file.filename }
  })
}

function createTar(entries) {
  const parts = []
  for (const entry of entries) {
    const header = Buffer.alloc(512)
    const segments = entry.path.split('/')
    let name = entry.path, prefix = ''
    if (Buffer.byteLength(name) > 100) { name = segments.pop(); prefix = segments.join('/') }
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error('Snapshot path is too long')
    header.write(name, 0, 100, 'utf8'); header.write(prefix, 345, 155, 'utf8')
    const octal = (value, at, bytes) => header.write(value.toString(8).padStart(bytes - 1, '0') + '\0', at, bytes, 'ascii')
    octal(0o444, 100, 8); octal(0, 108, 8); octal(0, 116, 8); octal(entry.content.length, 124, 12); octal(0, 136, 12)
    header.fill(32, 148, 156); header.write('0', 156); header.write('ustar\0', 257, 6); header.write('00', 263, 2)
    const checksum = header.reduce((sum, byte) => sum + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
    parts.push(header, entry.content, Buffer.alloc((512 - entry.content.length % 512) % 512))
  }
  return Buffer.concat([...parts, Buffer.alloc(1024)])
}

function filenameDatabase(files) {
  const directories = new Map([['', new Set(['ls-R'])]])
  for (const file of files.filter((item) => item.path.startsWith('texlive/texmf-dist/'))) {
    const parts = file.path.slice('texlive/texmf-dist/'.length).split('/')
    for (let index = 0; index < parts.length; index++) {
      const directory = parts.slice(0, index).join('/')
      if (!directories.has(directory)) directories.set(directory, new Set())
      directories.get(directory).add(parts[index])
    }
  }
  const text = '% ls-R -- filename database for kpathsea; do not change this line.\n' + [...directories].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([directory, names]) => `\n./${directory}:\n${[...names].sort().join('\n')}\n`).join('')
  return { path: 'texlive/texmf-dist/ls-R', content: Buffer.from(text), source: 'generated-from-fixed-snapshot' }
}

async function sourceNotices(archive) {
  let pending = Buffer.alloc(0), remaining = 0, padding = 0, name = '', capture = false, parts = []
  const notices = []
  for await (const chunk of (typeof archive === 'string' ? createReadStream(archive) : archive).pipe(createGunzip())) {
    pending = Buffer.concat([pending, chunk])
    while (pending.length) {
      if (remaining) {
        const count = Math.min(remaining, pending.length)
        if (capture) parts.push(pending.subarray(0, count))
        remaining -= count; pending = pending.subarray(count)
        if (!remaining && capture) notices.push(`${name}\n${Buffer.concat(parts).toString('utf8')}\n`)
      } else if (padding) { const count = Math.min(padding, pending.length); padding -= count; pending = pending.subarray(count) }
      else {
        if (pending.length < 512) break
        const header = pending.subarray(0, 512); pending = pending.subarray(512)
        if (header.every((byte) => byte === 0)) continue
        const text = (start, bytes) => header.subarray(start, start + bytes).toString('utf8').replace(/\0.*$/s, '')
        name = [text(345, 155), text(0, 100)].filter(Boolean).join('/')
        remaining = Number.parseInt(text(124, 12).trim() || '0', 8)
        if (!Number.isSafeInteger(remaining) || remaining < 0) throw new Error('Invalid source archive')
        padding = (512 - remaining % 512) % 512
        capture = ['0', ''].includes(text(156, 1)) && /(?:^|\/)(?:COPYING(?:\.[^/]*)?|LICEN[CS]E(?:[._-][^/]*)?|Copyright(?:\.[^/]*)?)$/i.test(name) && remaining <= 1024 * 1024
        parts = []
      }
    }
  }
  if (remaining || padding) throw new Error('Truncated source archive')
  return notices.join('\n------------------------------------------------------------\n\n')
}

export function tarEntries(data) {
  const result = []
  const links = []
  let pendingName = ''
  for (let at = 0; at + 512 <= data.length;) {
    const header = data.subarray(at, at + 512)
    if (header.every((byte) => byte === 0)) break
    const text = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '')
    const prefix = text(345, 155)
    const name = pendingName || [prefix, text(0, 100)].filter(Boolean).join('/')
    const bytes = Number.parseInt(text(124, 12).trim() || '0', 8)
    const type = text(156, 1)
    if (!Number.isSafeInteger(bytes) || bytes < 0 || at + 512 + bytes > data.length) throw new Error('Invalid upstream tar entry')
    const content = data.subarray(at + 512, at + 512 + bytes)
    pendingName = ''
    if (type === 'L') pendingName = content.toString('utf8').replace(/\0.*$/s, '')
    else if (type === '0' || type === '') result.push({ path: name, content })
    else if (type === '1' || type === '2') links.push({ path: name, target: type === '1' ? text(157, 100) : path.posix.join(path.posix.dirname(name), text(157, 100)) })
    at += 512 + Math.ceil(bytes / 512) * 512
  }
  // Flatten archive-internal map/font aliases at build time. The shipped worker
  // accepts regular files only, so a tar symlink can never become a host path.
  const byPath = new Map(result.map((entry) => [entry.path, entry.content]))
  for (let pass = 0; pass < links.length; pass++) {
    let resolved = 0
    for (const link of links) {
      if (byPath.has(link.path)) continue
      const content = byPath.get(path.posix.normalize(link.target))
      if (content) { byPath.set(link.path, content); result.push({ path: link.path, content }); resolved++ }
    }
    if (!resolved) break
  }
  return result
}

async function acquire(cache) {
  await mkdir(cache, { recursive: true })
  for (const item of downloads) {
    const target = path.join(cache, item.name)
    let data
    try { data = await readFile(target) } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (!data) {
      const response = await fetch(item.url || `${base}/${item.name}`, { signal: AbortSignal.timeout(300000) })
      if (!response.ok) throw new Error(`Pinned asset ${item.name}: HTTP ${response.status}`)
      data = Buffer.from(await response.arrayBuffer())
      if (item.bytes && data.length !== item.bytes) throw new Error(`Incorrect upstream size: ${item.name}`)
      if (item.sha256 && sha256(data) !== item.sha256) throw new Error(`Incorrect upstream hash: ${item.name}`)
      await writeFile(target, data)
    }
    if (item.bytes && data.length !== item.bytes) throw new Error(`Incorrect cached size: ${item.name}`)
    if (item.sha256 && sha256(data) !== item.sha256) throw new Error(`Incorrect cached hash: ${item.name}`)
    console.log(JSON.stringify({ name: item.name, bytes: data.length, sha256: sha256(data) }))
  }
}

async function saveAsset(relative, content) {
  const target = path.join(staticDirectory, relative)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content)
}

async function staticAssets(directory = staticDirectory, prefix = '') {
  const result = []
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const relative = `${prefix}${entry.name}`
    if (entry.isDirectory()) result.push(...await staticAssets(path.join(directory, entry.name), `${relative}/`))
    else if (relative !== 'manifest.json') { const content = await readFile(path.join(directory, entry.name)); result.push({ path: relative, bytes: content.length, sha256: sha256(content) }) }
  }
  return result
}

async function saveProvisioningSources() {
  const sources = []
  for (const name of ['provision.mjs', 'build-format.mjs', 'smoke.mjs', 'smoke-worker.mjs']) sources.push({ path: `nextjs-frontend/features/mr-resume/latex/browser/${name}`, content: Buffer.from((await readFile(new URL(name, import.meta.url), 'utf8')).replace(/\r\n/g, '\n')) })
  sources.push({ path: 'nextjs-frontend/public/mr-resume/latex/busytex-v1/compiler-worker.js', content: await readFile(path.join(staticDirectory, 'compiler-worker.js')) })
  sources.push({ path: 'nextjs-frontend/features/mr-resume/components/fonts/latin-modern/LICENSE.txt', content: await readFile(new URL('../../components/fonts/latin-modern/LICENSE.txt', import.meta.url)) })
  const content = gzipSync(createTar(sources), { level: 9 }), relative = 'sources/browser-provisioning-source.tar.gz'
  await saveAsset(relative, content)
  return { archive: { path: relative, bytes: content.length, sha256: sha256(content) }, files: sources.map((entry) => ({ path: entry.path, bytes: entry.content.length, sha256: sha256(entry.content) })) }
}

async function saveManifestPin() {
  const content = await readFile(path.join(staticDirectory, 'manifest.json'))
  if (content.includes(Buffer.from('\r\n')) || content.at(-1) !== 10) throw new Error('The public manifest must have exact LF bytes before pin generation')
  const pin = { path: 'manifest.json', bytes: content.length, sha256: sha256(content) }
  // This output is not a provisioning input, manifest asset or worker constant:
  // including it in those hashed inputs would create a self-reference or stale pin.
  await writeFile(new URL('../browserManifestPin.ts', import.meta.url), `/** Generated by browser/provision.mjs after writing the immutable public manifest. */\nexport const BROWSER_LATEX_MANIFEST_PIN = { path: '${pin.path}', bytes: ${pin.bytes}, sha256: '${pin.sha256}' } as const\n`)
  return pin
}

async function refreshSourceOffer(manifest, files, originals) {
  const provenance = JSON.parse(await readFile(path.join(staticDirectory, 'provenance.json'), 'utf8'))
  const offer = JSON.parse(await readFile(path.join(staticDirectory, 'source-offer.json'), 'utf8'))
  const verifiedPin = async (relative) => {
    const recorded = provenance.distributionAssets.find((pin) => pin.path === relative), content = await readFile(path.join(staticDirectory, relative))
    if (!recorded || recorded.bytes !== content.length || recorded.sha256 !== sha256(content)) throw new Error(`Source or license pin mismatch: ${relative}`)
    return recorded
  }
  const packageSources = await verifiedPin('sources/tex-packages-source.tar.gz')
  const generatedFormatProvenance = await verifiedPin('format-provenance.json')
  const recipePin = await verifiedPin('sources/busytex-source.tar.gz')
  const recipe = tarEntries(gunzipSync(await readFile(path.join(staticDirectory, recipePin.path)), { maxOutputLength: 4 * 1024 * 1024 }))
  const recipeFiles = ['Makefile', 'ubuntu_package_preload.py', '.github/workflows/build-wasm.yml'].map((name) => {
    const entry = recipe.find((file) => file.path === `busytex-${commit}/${name}`)
    if (!entry) throw new Error(`Missing pinned upstream recipe: ${name}`)
    return { ...entry, name }
  })
  const makefile = recipeFiles[0].content.toString('utf8'), selector = recipeFiles[1].content.toString('utf8'), workflow = recipeFiles[2].content.toString('utf8')
  // The upstream "ubuntu" packages use Ubuntu file lists to select directories
  // from full TeX Live, not .deb payloads. Do not invent Debian source lineage.
  if (!selector.includes('path.replace(texmf_ubuntu, texmf_src)') || !workflow.includes('TEXMFFULL=build/texlive-full')) throw new Error('Reevaluate the changed upstream supplemental package recipe')
  const isoURL = makefile.match(/^URL_texlive_full_iso\s*=\s*(\S+)$/m)?.[1], ubuntuURL = makefile.match(/^URL_ubuntu_release\s*=\s*(\S+)$/m)?.[1]
  if (!isoURL?.startsWith('https://') || !ubuntuURL?.startsWith('https://')) throw new Error('Missing upstream package source-input URLs')
  const licensePaths = ['licenses/LICENSE.TL', 'licenses/LICENSE.CTAN', 'licenses/LatinModern-GUST.txt', 'licenses/NotoSansBengali-OFL.txt']
  const licenses = new Map(await Promise.all(licensePaths.map(async (relative) => [relative, await verifiedPin(relative)])))
  const inputs = (names) => names.map((name) => {
    const input = provenance.downloads.find((item) => item.name === name), pinned = downloads.find((item) => item.name === name)
    if (!input || !pinned || input.bytes !== pinned.bytes || input.sha256 !== pinned.sha256 || input.url !== (pinned.url || `${base}/${name}`)) throw new Error(`Source input pin mismatch: ${name}`)
    return input
  })
  const supplementalEntries = [...files.values()].flat().filter((entry) => /^ubuntu-texlive-latex-(?:recommended|extra)\.data$/.test(originals.get(entry.path).source)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  if (supplementalEntries.some((entry) => entry.path.endsWith('.tec') && !supplementalEntries.some((source) => source.path === entry.path.replace(/\.tec$/, '.map')))) throw new Error('A compiled supplemental map lacks its shipped source input')
  const supplementalArchive = 'sources/tex-supplemental-runtime-source.tar.gz', supplementalIndex = 'sources/tex-supplemental-runtime-index.json'
  const supplementalContent = gzipSync(createTar(supplementalEntries), { level: 9 })
  await saveAsset(supplementalArchive, supplementalContent)
  const supplementalPin = { path: supplementalArchive, bytes: supplementalContent.length, sha256: sha256(supplementalContent) }
  const packageNames = [...new Set(supplementalEntries.map((entry) => /\/(fontspec|polyglossia|makecmds|xkeyval|xunicode|xltxtra|enumitem|titlesec)\//.exec(entry.path)?.[1]))].sort()
  if (packageNames.length !== 8 || packageNames.includes(undefined)) throw new Error('Reevaluate the supplemental package inventory')
  const packages = packageNames.map((name) => {
    const entries = supplementalEntries.filter((entry) => entry.path.includes(`/${name}/`))
    const sourceNames = [...new Set(entries.map((entry) => originals.get(entry.path).source))].sort()
    const embeddedNotices = entries.filter((entry) => /\.(?:sty|tex|lua|ldf|def|cfg|map)$/.test(entry.path)).flatMap((entry) => {
      const lines = entry.content.toString('utf8').split(/\r\n|\n|\r/).flatMap((text, at) => /copyright|license|licence|\bLPPL\b/i.test(text) ? [{ line: at + 1, text }] : [])
      return lines.length ? [{ file: originals.get(entry.path), lines }] : []
    })
    if (!embeddedNotices.length) throw new Error(`Missing original embedded license evidence: ${name}`)
    return { name, inputs: inputs(sourceNames.flatMap((source) => [source.replace(/\.data$/, '.js'), source])), groups: manifest.groups.filter((group) => files.get(group.id).some((entry) => entries.includes(entry))).map((group) => group.id), files: entries.map((entry) => ({ ...originals.get(entry.path), kind: entry.path.endsWith('.tec') ? 'compiled-map-with-shipped-map-source' : 'raw-shipped-runtime-file' })), embeddedNotices }
  })
  const sourceIndex = {
    version: 1, profileVersion, archive: supplementalPin, packages,
    coverage: 'Exact unmodified supplemental runtime files, including source-format TeX/Lua/config/map files and original embedded license lines. These copies are NOT a complete upstream generated-source (.dtx/.ins), documentation or font-development archive. Compiled .tec files retain their shipped .map inputs. The basic package source subtree remains separately offered; file provenance is recorded in each group index.',
    originalInputs: {
      recipeArchive: recipePin, recipeFiles: recipeFiles.map((entry) => ({ path: entry.path, bytes: entry.content.length, sha256: sha256(entry.content) })),
      texliveDistribution: { url: isoURL, sha256: null, status: 'Original full TeX Live distribution URL recorded by the pinned recipe; ISO bytes and its whole-archive hash are not available in this local source offer.' },
      ubuntuSelectors: ['texlive-latex-extra', 'texlive-latex-recommended'].map((name) => ({ package: name, url: `${ubuntuURL}all/${name}/filelist`, sha256: null, status: 'Historical Ubuntu Lunar file-list selector, not a pinned .deb or source archive; the exact distributed inputs are the release JS/data hashes above.' })),
      debianUbuntuSourceInputs: { urls: [], status: 'No exact .deb/.dsc/orig/debian source-input URLs or hashes are established by the pinned BusyTeX recipe or locally available payloads. They are not fabricated or claimed offered. A future source-completeness review must obtain and verify matching original inputs rather than assuming Ubuntu package naming proves byte provenance.' },
    },
  }
  const indexContent = Buffer.from(JSON.stringify(sourceIndex, null, 2) + '\n')
  await saveAsset(supplementalIndex, indexContent)
  const indexPin = { path: supplementalIndex, bytes: indexContent.length, sha256: sha256(indexContent) }
  const provisioning = await saveProvisioningSources()
  const groupSources = manifest.groups.map((group) => {
    const entries = files.get(group.id), sourceNames = [...new Set(entries.map((entry) => originals.get(entry.path).source))].sort()
    const suppliers = sourceNames.map((source) => {
      const members = entries.filter((entry) => originals.get(entry.path).source === source)
      let upstreamInputs = [], preservedSources = [], notices = []
      if (source === 'texlive-basic.tar.gz') { upstreamInputs = inputs([source]); preservedSources = [packageSources]; notices = [licenses.get('licenses/LICENSE.TL'), licenses.get('licenses/LICENSE.CTAN')] }
      else if (source.startsWith('ubuntu-texlive-latex-')) { upstreamInputs = inputs([source.replace(/\.data$/, '.js'), source]); preservedSources = [supplementalPin, indexPin]; notices = [licenses.get('licenses/LICENSE.TL'), licenses.get('licenses/LICENSE.CTAN')] }
      else if (source === 'NotoSansBengali.ttf') { upstreamInputs = inputs([source]); notices = [licenses.get('licenses/NotoSansBengali-OFL.txt')] }
      else if (source === 'generated-wasm32-lualatex-format') { upstreamInputs = inputs(['busytex.wasm', 'texlive-basic.tar.gz']); preservedSources = [packageSources, provisioning.archive, generatedFormatProvenance]; notices = [licenses.get('licenses/LICENSE.TL'), licenses.get('licenses/LICENSE.CTAN')] }
      else if (source === 'generated-from-fixed-snapshot') preservedSources = [provisioning.archive]
      else throw new Error(`Unrecorded grouped file source: ${source}`)
      if (members.some((entry) => /\/fonts\/(?:opentype|tfm|type1|vf)\//.test(entry.path))) notices.push(licenses.get('licenses/LatinModern-GUST.txt'))
      return { source, files: members.length, fileBytes: members.reduce((sum, entry) => sum + entry.content.length, 0), upstreamInputs, preservedSources, notices }
    })
    return { id: group.id, kind: group.kind, profiles: group.profiles, archive: group.assets.find((pin) => pin.path === group.archive), index: group.assets.find((pin) => pin.path === group.index), files: entries.length, fileBytes: entries.reduce((sum, entry) => sum + entry.content.length, 0), suppliers, licenseScope: 'Notices are references, not a blanket license for this group. Original per-file/package notices remain in the indexed runtime files and offered package sources; engine GPL/LGPL terms and font/package-specific terms remain applicable.' }
  })
  offer.access = 'BusyTeX, TeX Live engine/library, Expat and Fontconfig upstream source archives and the application-owned wrapper source/build recipe are offered by equivalent same-origin download access, without login or charge. Concatenate split archive parts in their listed order and verify the whole SHA-256 before extracting. Package source coverage and unavailable original inputs are qualified separately below; raw shipped TeX files are not misrepresented as complete upstream generated-source archives. Keep this offer, all component licenses and source assets alongside every redistribution of the binary.'
  Object.assign(offer.build, {
    provisioningArchive: provisioning.archive, provisioningFiles: provisioning.files,
    generatedManifestPin: 'nextjs-frontend/features/mr-resume/latex/browserManifestPin.ts is generated from final LF manifest bytes; deliberately excluded from provisioning sources and runtime asset lists to avoid a hash cycle.',
    provision: 'Extract provisioningSources into the project root, including the exact Latin Modern license input. From nextjs-frontend, --acquire <absolute-temp-cache> downloads/verifies the pinned inputs; build-format.mjs --generate <cache> executes the pinned WASM engine only to rebuild LuaHB format; provision.mjs --build <cache> repackages them. provision.mjs --manifest or --groups only reads existing local pinned assets and regenerates groups, source coverage, provisioning source archive, notices and final manifest/TS pin; neither mode downloads assets, imports a smoke harness, instantiates WASM or runs TeX. Upstream binary rebuilding separately requires the archived BusyTeX recipe, native generator prerequisites and Emscripten 3.1.43.',
    smokeHarness: 'Archived smoke.mjs/smoke-worker.mjs are not a standalone regression harness. They require the matching application TypeScript modules (templates/project/archive/AltaCV/PDF verification and their dependencies), Mr.Resume/AltaCV_Template.zip, Node type stripping and the frontend npm dependencies pdf-lib, sharp, jszip and pdfjs-dist. Those application/dependency/template inputs are not included in this provisioning archive. Smoke executes real TeX and must be separately authorized; manifest/group finalization does not run it.',
  })
  offer.packageCoverage = { basicSourceSubtree: packageSources, supplementalRuntimeSources: supplementalPin, supplementalInventory: indexPin, groups: groupSources, limits: sourceIndex.coverage }
  await saveAsset('source-offer.json', JSON.stringify(offer, null, 2) + '\n')
  await saveAsset('THIRD-PARTY-NOTICES.txt', `Mr. Resume browser TeX vendor component\n\nBusyTeX: https://github.com/busytex/busytex/tree/${commit}\nPinned release: ${base}\nThe BusyTeX wrapper is MIT-licensed (licenses/busytex-notices.txt). The statically linked TeX engine binary includes GPL/LGPL and other separately licensed components; it is NOT an MIT-only binary. The binary's archived upstream engine/library sources and build recipe are offered by equivalent same-origin access in source-offer.json and sources/. Original component notices extracted from those archives remain in licenses/. This separate vendor distribution does not change the surrounding application's licensing. No AGPL wrapper or BusytexPipeline is included.\n\nThe six real groups are core, pdflatex, xelatex, lualatex, unicode and math. Only math is an optional package group; tcolorbox/mdframed are test fixtures, not deployed packages. All groups are a disjoint partition of the unchanged legacy snapshot; per-file source paths, sizes and hashes remain in snapshot-index.json and each group index. TeX package source files from the basic archive remain in sources/tex-packages-source.tar.gz. Exact supplemental runtime TeX/Lua/config/map files and original embedded license evidence are in sources/tex-supplemental-runtime-source.tar.gz and its index. These raw shipped files are not a complete upstream .dtx/.ins/documentation archive. The pinned BusyTeX recipe selects full TeX Live files using historical Ubuntu Lunar file lists; package naming is not proof of .deb byte provenance. Original input URLs, known hashes and unavailable source-input limits are recorded honestly in the supplemental index.\n\nOriginal package copyright/license headers remain unmodified; no group receives a blanket MIT/LPPL label. LICENSE.TL and LICENSE.CTAN explain per-component licensing. Latin Modern uses the GUST Font License; Computer Modern/AMS retain their own original notices. Noto Sans Bengali is unmodified, Copyright 2022 The Noto Project Authors, SIL OFL 1.1, pinned google/fonts commit e7db6ca603fd4862010383ff17ffd6cc4ffac1c0. Full upstream generated-package/font-development source completeness is not claimed by the raw runtime source offer.\n\nProvisioning source includes the exact Latin Modern license input and deployed worker. Its archived smoke scripts depend on application TS/npm/template inputs and are not standalone. --manifest/--groups regenerate local assets without downloading or running TeX; real-engine smoke/corpus verification is a separate future release prerequisite. Runtime asset GETs are same-origin and selected from exact pins; worker network APIs are shut down before TeX execution. The shared global CSP has no connect-src endpoint hard-list and is not changed by this module. Source, filenames and PDFs are never uploaded by local compilation; source/license archives are not loaded by the compiler. Shell escape, sockets, remote package loading and native filesystems are disabled.\n`)
  provenance.groupSources = groupSources
  const refreshedPaths = ['source-offer.json', 'THIRD-PARTY-NOTICES.txt', provisioning.archive.path, supplementalPin.path, indexPin.path]
  const refreshed = await Promise.all(refreshedPaths.map(async (relative) => {
    const content = await readFile(path.join(staticDirectory, relative))
    return { path: relative, bytes: content.length, sha256: sha256(content) }
  }))
  provenance.distributionAssets = [...provenance.distributionAssets.filter((pin) => !refreshedPaths.includes(pin.path)), ...refreshed]
  await saveAsset('provenance.json', JSON.stringify(provenance, null, 2) + '\n')
}

export async function refreshGroups() {
  const previous = JSON.parse(await readFile(path.join(staticDirectory, 'manifest.json'), 'utf8'))
  const provenance = JSON.parse(await readFile(path.join(staticDirectory, 'provenance.json'), 'utf8'))
  const originalFiveAssetBytes = previous.assets.reduce((sum, asset) => sum + asset.bytes, 0)
  const assets = []
  const contents = new Map()
  for (const relative of runtimeAssetPaths) {
    const content = await readFile(path.join(staticDirectory, relative))
    const asset = { path: relative, bytes: content.length, sha256: sha256(content) }
    const pin = previous.assets.find((item) => item.path === relative)
    // Only the application-owned worker may have changed since the last source
    // refresh. A modified binary or legacy snapshot is never silently repinned.
    if (!pin || (relative !== 'compiler-worker.js' && (asset.bytes !== pin.bytes || asset.sha256 !== pin.sha256))) throw new Error(`Runtime pin mismatch: ${relative}`)
    assets.push(asset)
    if (relative === 'snapshot-index.json' || relative === 'texlive.snapshot.tar.gz') contents.set(relative, content)
  }
  for (const [relative, name] of [['busytex.js.bin', 'busytex.js'], ['busytex.wasm', 'busytex.wasm']]) {
    const asset = assets.find((item) => item.path === relative), pin = downloads.find((item) => item.name === name)
    if (asset.bytes !== pin.bytes || asset.sha256 !== pin.sha256) throw new Error(`Upstream binary pin mismatch: ${relative}`)
  }
  const legacyIndex = JSON.parse(contents.get('snapshot-index.json'))
  const expanded = gunzipSync(contents.get('texlive.snapshot.tar.gz'), { maxOutputLength: 96 * 1024 * 1024 })
  if (legacyIndex.version !== 1 || expanded.length !== legacyIndex.unpackedBytes || !Array.isArray(legacyIndex.files) || legacyIndex.files.length > 6000) throw new Error('Invalid legacy snapshot inventory')
  const originals = new Map(legacyIndex.files.map((file) => [file.path, file]))
  const runtime = tarEntries(expanded).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  if (originals.size !== legacyIndex.files.length || runtime.length !== originals.size) throw new Error('Duplicate or incomplete legacy snapshot')
  const paths = new Map()
  for (const entry of runtime) {
    const file = originals.get(entry.path), parts = entry.path.split('/')
    // Indexed vendor filenames may start with a dot (tools/.tex). This does not
    // change public URL or project-path permissions, and traversal remains banned.
    if (!file || !entry.path.startsWith('texlive/') || !/^[A-Za-z0-9_./-]+$/.test(entry.path) || parts.some((part) => !part || part === '.' || part === '..' || part.endsWith('.'))
      || file.bytes !== entry.content.length || file.sha256 !== sha256(entry.content)) throw new Error(`Legacy file pin mismatch: ${entry.path}`)
    for (let at = 1; at <= parts.length; at++) {
      const name = parts.slice(0, at).join('/'), kind = at === parts.length ? 'file' : 'directory', alias = paths.get(name.toLowerCase())
      if (alias && (alias.path !== name || alias.kind !== kind || kind === 'file')) throw new Error(`Legacy file alias: ${entry.path}`)
      paths.set(name.toLowerCase(), { path: name, kind })
    }
  }
  const engineIDs = profiles.map((profile) => profile.id)
  const definitions = [
    { id: 'core', kind: 'core', profiles: engineIDs, packages: [...commonPackages, 'lmodern', 'color', 'multicol', 'etoolbox', 'xparse', 'fontenc', 'iftex'] },
    ...engineIDs.map((id) => ({ id, kind: 'profile', profiles: [id], packages: [] })),
    { id: 'unicode', kind: 'profile', profiles: ['xelatex', 'lualatex'], packages: ['fontspec', 'polyglossia', 'xunicode', 'xltxtra', 'luaotfload', 'luatexbase', 'lualibs', 'luacode', 'lualatex-math', 'ctablestack', 'makecmds'] },
    { id: 'math', kind: 'package', profiles: engineIDs, packages: [] },
  ]
  const files = new Map(definitions.map((group) => [group.id, []]))
  const formats = new Map([
    ['texlive/texmf-dist/texmf-var/web2c/pdftex/pdflatex.fmt', 'pdflatex'],
    ['texlive/texmf-dist/texmf-var/web2c/xetex/xelatex.fmt', 'xelatex'],
    ['texlive/texmf-dist/texmf-var/web2c/luahbtex/luahblatex.fmt', 'lualatex'],
  ])
  for (const entry of runtime) {
    let id = formats.get(entry.path)
    if (!id) {
      if (/\/tex\/latex\/(?:amsmath|amsfonts|amscls)\//.test(entry.path)) id = 'math'
      else if (/\/tex\/(?:luatex|lualatex|xelatex)\//.test(entry.path)
        || /\/tex\/latex\/(?:fontspec|polyglossia|makecmds)\//.test(entry.path)
        || /\/tex\/generic\/(?:unicode-data|lt3luabridge|luatex85)\//.test(entry.path)
        || /\/fonts\/(?:opentype|truetype|misc|cmap)\//.test(entry.path)
        || entry.path === 'texlive/texmf-dist/dvipdfmx/dvipdfmx.cfg') id = 'unicode'
      else id = 'core'
    }
    // CM/Latin Modern metrics, outlines and maps remain in core: AMS's cm
    // outlines are also ordinary CV dependencies, not optional math-only fonts.
    files.get(id).push(entry)
  }
  if (engineIDs.some((id) => files.get(id).length !== 1) || !files.get('math').some((file) => file.path.endsWith('/amsmath.sty')) || !files.get('math').some((file) => file.path.endsWith('/amsfonts.sty'))) throw new Error('The fixed snapshot lacks a required engine format or genuine AMS package')
  definitions.find((group) => group.id === 'math').packages = files.get('math').filter((file) => /\.(?:sty|cls)$/.test(file.path)).map((file) => path.posix.basename(file.path).replace(/\.(?:sty|cls)$/, '')).sort()
  const groups = [], generated = [], summaries = []
  for (const definition of definitions) {
    const entries = files.get(definition.id), tar = createTar(entries)
    const archive = `groups/${definition.id}/texlive.tar.gz`, index = `groups/${definition.id}/snapshot-index.json`
    const archiveContent = gzipSync(tar, { level: 9 })
    const indexContent = Buffer.from(JSON.stringify({ version: 1, unpackedBytes: tar.length, files: entries.map((entry) => originals.get(entry.path)) }, null, 2) + '\n')
    if (!entries.length || (definition.kind === 'package' && archiveContent.length > 12 * 1024 * 1024)) throw new Error(`Empty or oversized group: ${definition.id}`)
    const groupAssets = [[archive, archiveContent], [index, indexContent]].map(([relative, content]) => {
      generated.push({ path: relative, content })
      return { path: relative, bytes: content.length, sha256: sha256(content) }
    })
    groups.push({ ...definition, archive, index, assets: groupAssets })
    summaries.push({ id: definition.id, files: entries.length, fileBytes: entries.reduce((sum, file) => sum + file.content.length, 0), unpackedBytes: tar.length, archiveBytes: archiveContent.length, indexBytes: indexContent.length })
  }
  const groupAssets = groups.flatMap((group) => group.assets)
  const totalAssetBytes = [...assets, ...groupAssets].reduce((sum, asset) => sum + asset.bytes, 0)
  const totalUnpackedBytes = summaries.reduce((sum, group) => sum + group.unpackedBytes, 0)
  if (new Set([...assets, ...groupAssets].map((asset) => asset.path)).size !== assets.length + groupAssets.length || assets.length + groupAssets.length > 64 || totalAssetBytes > 256 * 1024 * 1024 || totalUnpackedBytes > 96 * 1024 * 1024) throw new Error('The grouped asset or expanded snapshot budget is exceeded')
  const baselineBytes = assets.filter((asset) => ['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm'].includes(asset.path)).reduce((sum, asset) => sum + asset.bytes, 0)
  const selectedBytes = Object.fromEntries(engineIDs.map((id) => [id, baselineBytes + groups.filter((group) => group.kind === 'core' || (group.kind === 'profile' && group.profiles.includes(id))).flatMap((group) => group.assets).reduce((sum, asset) => sum + asset.bytes, 0)]))
  const selectedCounts = Object.fromEntries(engineIDs.map((id) => [id, 3 + groups.filter((group) => group.kind === 'core' || (group.kind === 'profile' && group.profiles.includes(id))).flatMap((group) => group.assets).length]))
  const legacyFiveAssetBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0)
  if (selectedBytes.pdflatex >= originalFiveAssetBytes || selectedBytes.pdflatex >= legacyFiveAssetBytes) throw new Error('The first pdfLaTeX download is not smaller than the original five assets')
  for (const asset of generated) await saveAsset(asset.path, asset.content)
  previous.profileVersion = profileVersion
  previous.engines = profiles; previous.limitations = limitations
  previous.assets = assets.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  previous.groups = groups
  provenance.profileVersion = profileVersion
  // Retain unrelated source/license/input pins; finalization refreshes only the
  // generated group/source metadata, never a changed vendor input silently.
  provenance.distributionAssets = [...provenance.distributionAssets.filter((asset) => !asset.path.startsWith('groups/')), ...groupAssets]
  await saveAsset('provenance.json', JSON.stringify(provenance, null, 2) + '\n')
  await saveAsset('manifest.json', JSON.stringify(previous, null, 2) + '\n')
  await refreshSourceOffer(previous, files, originals)
  const manifestPin = await saveManifestPin()
  console.log(JSON.stringify({ profileVersion, manifestPin, groups: summaries, originalFiveAssetBytes, legacyFiveAssetBytes, selectedRequiredAssets: selectedCounts, selectedRequiredBytes: selectedBytes, totalUniqueAssetBytes: totalAssetBytes, totalUniqueAssets: assets.length + groupAssets.length, totalGroupedUnpackedBytes: totalUnpackedBytes, totalGroupedFiles: runtime.length }, null, 2))
  return previous
}

export async function refreshManifest() {
  return refreshGroups()
}

export async function normalizeCheckout() {
  const manifestText = await readFile(path.join(staticDirectory, 'manifest.json'), 'utf8')
  const provenanceText = await readFile(path.join(staticDirectory, 'provenance.json'), 'utf8')
  const manifest = JSON.parse(manifestText), provenance = JSON.parse(provenanceText)
  const updates = []
  for (const asset of [...manifest.assets, ...provenance.distributionAssets]) {
    const target = path.join(staticDirectory, asset.path), content = await readFile(target)
    if (content.length === asset.bytes && sha256(content) === asset.sha256) continue
    // Reverse Git's Windows text checkout only if it restores the exact recorded bytes.
    // Never repin or overwrite a modified compiler binary, source archive, or notice.
    let normalized = Buffer.from(content.toString('utf8').replace(/\r\n/g, '\n'))
    const notice = /^licenses\/(busytex|texlive|expat|fontconfig)-notices\.txt$/.exec(asset.path)
    if (notice && (normalized.length !== asset.bytes || sha256(normalized) !== asset.sha256)) {
      // Some upstream notices genuinely use CRLF. Recover those original bytes
      // from the corresponding source, rather than guessing or changing the pin.
      const offer = JSON.parse(await readFile(path.join(staticDirectory, 'source-offer.json'), 'utf8'))
      const archive = offer.archives.find((item) => item.name === `${notice[1]}-source.tar.gz`)
      if (!archive) throw new Error(`The corresponding source for ${asset.path} is missing. No assets were changed.`)
      const stream = Readable.from((async function* () {
        for (const part of archive.parts) for await (const chunk of createReadStream(path.join(staticDirectory, part.path))) yield chunk
      })())
      normalized = Buffer.from(await sourceNotices(stream))
    }
    if (normalized.length !== asset.bytes || sha256(normalized) !== asset.sha256) throw new Error(`${asset.path} differs from its pin beyond checkout line endings. No assets were changed.`)
    updates.push({ target, content: normalized })
  }
  for (const [name, content] of [['manifest.json', manifestText], ['provenance.json', provenanceText]]) {
    if (content.includes('\r\n')) updates.push({ target: path.join(staticDirectory, name), content: Buffer.from(content.replace(/\r\n/g, '\n')) })
  }
  for (const update of updates) await writeFile(update.target, update.content)
  console.log(`Verified compiler checkout: ${updates.length} assets restored to their recorded original bytes.`)
}

async function build(cache) {
  for (const item of downloads) {
    const data = await readFile(path.join(cache, item.name))
    if (data.length !== item.bytes || sha256(data) !== item.sha256) throw new Error(`Pin mismatch: ${item.name}`)
  }
  const basic = tarEntries(gunzipSync(await readFile(path.join(cache, 'texlive-basic.tar.gz'))))
  const runtime = basic.filter((entry) => entry.path.startsWith('build/texlive-basic/') && keepRuntime(entry.path.slice('build/texlive-basic/'.length)))
    .map((entry) => ({ path: entry.path.replace(/^build\/texlive-basic\//, 'texlive/'), content: entry.content, source: 'texlive-basic.tar.gz', upstreamPath: entry.path }))
  const format = await readFile(path.join(cache, 'luahblatex-wasm32.fmt'))
  if (format.length !== formatPin.bytes || sha256(format) !== formatPin.sha256) throw new Error('The WASM-native LuaHB format does not match its pin. Run build-format.mjs --generate with the pinned cache first.')
  const luaFormat = runtime.find((entry) => entry.path.endsWith('/luahbtex/luahblatex.fmt'))
  if (!luaFormat) throw new Error('Missing LuaHB format location in the upstream snapshot')
  luaFormat.content = format; luaFormat.source = 'generated-wasm32-lualatex-format'; luaFormat.upstreamPath = 'texlive/texmf-dist/tex/generic/tex-ini-files/lualatex.ini'
  for (const entry of [...await packageEntries(cache, 'ubuntu-texlive-latex-recommended'), ...await packageEntries(cache, 'ubuntu-texlive-latex-extra')]) {
    const existing = runtime.find((file) => file.path === entry.path)
    if (existing && !existing.content.equals(entry.content)) throw new Error(`Conflicting pinned package versions: ${entry.path}`)
    if (!existing) runtime.push(entry)
  }
  runtime.push({ path: 'texlive/texmf-dist/fonts/truetype/mr-resume/NotoSansBengali.ttf', content: await readFile(path.join(cache, 'NotoSansBengali.ttf')), source: 'NotoSansBengali.ttf' })
  runtime.push(filenameDatabase(runtime))
  runtime.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  if (new Set(runtime.map((item) => item.path)).size !== runtime.length) throw new Error('Duplicate snapshot path')
  const index = runtime.map(({ path: filePath, content, source, upstreamPath }) => ({ path: filePath, bytes: content.length, sha256: sha256(content), source, ...(upstreamPath ? { upstreamPath } : {}) }))
  const tar = createTar(runtime), snapshot = gzipSync(tar, { level: 9 })
  await saveAsset('texlive.snapshot.tar.gz', snapshot)
  await saveAsset('snapshot-index.json', JSON.stringify({ version: 1, unpackedBytes: tar.length, files: index }, null, 2) + '\n')
  const sources = basic.filter((item) => item.path.includes('/source/') || /\/(?:LICENSE\.TL|LICENSE\.CTAN)$/.test(item.path))
  await saveAsset('sources/tex-packages-source.tar.gz', gzipSync(createTar(sources), { level: 9 }))
  await saveProvisioningSources()
  await saveAsset('format-provenance.json', await readFile(path.join(cache, 'luahblatex-wasm32.provenance.json')))
  const sourceArchives = []
  for (const item of downloads.filter((entry) => entry.name.endsWith('-source.tar.gz'))) {
    const data = await readFile(path.join(cache, item.name)), parts = []
    const size = 32 * 1024 * 1024
    for (let at = 0, index = 0; at < data.length; at += size, index++) {
      const relative = `sources/${item.name}${data.length > size ? `.part-${String(index).padStart(2, '0')}` : ''}`
      const part = data.subarray(at, at + size)
      await saveAsset(relative, part); parts.push({ path: relative, bytes: part.length, sha256: sha256(part) })
    }
    sourceArchives.push({ name: item.name, url: item.url, bytes: data.length, sha256: sha256(data), parts })
    await saveAsset(`licenses/${item.name.replace('-source.tar.gz', '')}-notices.txt`, await sourceNotices(path.join(cache, item.name)))
  }
  for (const name of ['busytex.js', 'busytex.wasm', 'versions.txt']) await saveAsset(name === 'busytex.js' ? 'busytex.js.bin' : name, await readFile(path.join(cache, name)))
  for (const name of ['LICENSE.TL', 'LICENSE.CTAN']) await saveAsset(`licenses/${name}`, basic.find((entry) => entry.path === `build/texlive-basic/${name}`).content)
  await saveAsset('licenses/NotoSansBengali-OFL.txt', await readFile(path.join(cache, 'NotoSansBengali-OFL.txt')))
  const latinLicense = fileURLToPath(new URL('../../components/fonts/latin-modern/LICENSE.txt', import.meta.url))
  await saveAsset('licenses/LatinModern-GUST.txt', await readFile(latinLicense))
  const sourceOffer = {
    version: 1, binary: { path: 'busytex.wasm', sha256: downloads.find((item) => item.name === 'busytex.wasm').sha256 },
    access: 'Complete corresponding source is offered here by equivalent same-origin download access, without login or charge. Concatenate split archive parts in their listed order and verify the whole SHA-256 before extracting. Keep this source offer and the source assets available alongside every redistribution of the binary.',
    archives: sourceArchives,
    build: { busytexCommit: commit, texliveCommit: '0d0bb3a2401e8825b4987eee51e8ef469eb8c3fc', emscriptenVersion: '3.1.43', recipe: 'The complete BusyTeX archive includes Makefile, busytex.c, emcc_wrapper.py, cosmo_getpass.h and .github/workflows/build-wasm.yml. Use the archived dependency sources in source/{texlive,expat,fontconfig}; apply the Makefile source/texlive.patched target; build native generator prerequisites, then make wasm with Emscripten 3.1.43. The release binary and pdfTeX/XeTeX formats are unmodified; the LuaHB format is rebuilt only at provisioning time with the actual pinned 32-bit WASM engine.', formatOrigin: `${base}/texlive-basic.tar.gz`, browserFormat: { ...formatPin, provenance: 'format-provenance.json', sourceEpoch: 1708041600 }, packageSources: 'sources/tex-packages-source.tar.gz', provisioningSources: 'sources/browser-provisioning-source.tar.gz', provision: 'Extract provisioningSources into the project root. Run node features/mr-resume/latex/browser/provision.mjs --acquire <absolute-temp-cache>; node features/mr-resume/latex/browser/build-format.mjs --generate <cache>; node features/mr-resume/latex/browser/provision.mjs --build <cache> from nextjs-frontend. Only asset acquisition uses upstream networking; no native TeX program or package install is used.' },
  }
  await saveAsset('source-offer.json', JSON.stringify(sourceOffer, null, 2) + '\n')
  await saveAsset('THIRD-PARTY-NOTICES.txt', `Mr. Resume browser TeX vendor component\n\nBusyTeX: https://github.com/busytex/busytex/tree/${commit}\nPinned release: ${base}\nThe BusyTeX wrapper is MIT-licensed (complete notice in licenses/busytex-notices.txt). The statically linked TeX engine binary includes GPL/LGPL and other separately licensed components; it is NOT described as an MIT-only binary. Complete corresponding source and the build recipe are offered by equivalent same-origin access in source-offer.json and sources/. All original component notices extracted from the complete source archives are in licenses/. This separate vendor distribution does not change the surrounding application's licensing. No AGPL wrapper or BusytexPipeline is included.\n\nTeX Live 2023 packages and generated formats are from the pinned BusyTeX release. The pruned, unmodified file inventory and hashes are in snapshot-index.json; TeX package sources from the basic archive are preserved in sources/tex-packages-source.tar.gz. Original package copyright/license headers remain in the runtime files. The small enumitem, titlesec, fontspec and polyglossia additions are selected from the pinned Emscripten package data, not downloaded at compile time. See LICENSE.TL and LICENSE.CTAN. Latin Modern: GUST Font License; Computer Modern: Knuth/AMS original font notices. Noto Sans Bengali: Copyright 2022 The Noto Project Authors, SIL OFL 1.1, pinned google/fonts commit e7db6ca603fd4862010383ff17ffd6cc4ffac1c0, unmodified.\n\nRuntime assets are always fetched from this directory on the application's own origin. No source, filename or PDF is uploaded. Source/license archives are not loaded by the compiler. Shell escape, sockets, remote package loading and native filesystems are disabled. The application-owned worker is not upstream BusytexPipeline and never masks a nonzero compiler exit.\n`)
  const provenance = { version: 1, profileVersion, release, commit, downloads: downloads.map((item) => ({ ...item, url: item.url || `${base}/${item.name}` })), snapshot: { path: 'texlive.snapshot.tar.gz', compressedBytes: snapshot.length, unpackedBytes: tar.length, fileBytes: runtime.reduce((sum, item) => sum + item.content.length, 0), files: runtime.length, pruning: 'Only the three LaTeX formats, required core/style/font-loader packages, four Latin Modern Roman 10 OTF cuts, CM/AMS/LM legacy metrics/outlines, maps, classic .bst files and pinned supplemental packages. No native executables, installers, remote resolver or upstream pipeline.' }, runtimeAssets: runtimeAssetPaths, sourceOffer: 'source-offer.json', distributionAssets: (await staticAssets()).filter((asset) => !runtimeAssetPaths.includes(asset.path) && asset.path !== 'provenance.json') }
  await saveAsset('provenance.json', JSON.stringify(provenance, null, 2) + '\n')
  await saveAsset('manifest.json', JSON.stringify({ version: 1, profileVersion, engines: profiles, assets: (await staticAssets()).filter((asset) => runtimeAssetPaths.includes(asset.path)), limitations }, null, 2) + '\n')
  await refreshGroups()
  console.log(JSON.stringify({ snapshotFiles: runtime.length, snapshotDownloadBytes: snapshot.length, snapshotUnpackedBytes: tar.length, runtimeDownloadBytes: downloads[0].bytes + downloads[1].bytes + snapshot.length, totalVendoredBytes: (await staticAssets()).reduce((sum, item) => sum + item.bytes, 0) }, null, 2))
}

async function inventory(cache) {
  const entries = tarEntries(gunzipSync(await readFile(path.join(cache, 'texlive-basic.tar.gz'))))
  const groups = new Map()
  for (const entry of entries) {
    const group = entry.path.split('/').slice(0, 6).join('/')
    const value = groups.get(group) || { files: 0, bytes: 0 }
    value.files++; value.bytes += entry.content.length; groups.set(group, value)
  }
  console.log(JSON.stringify({ files: entries.length, bytes: entries.reduce((sum, item) => sum + item.content.length, 0), groups: Object.fromEntries(groups) }, null, 2))
  console.log('formats', entries.filter((entry) => entry.path.endsWith('.fmt')).map((entry) => ({ path: entry.path, bytes: entry.content.length })))
  for (const name of ['ubuntu-texlive-latex-extra.js', 'ubuntu-texlive-latex-recommended.js']) {
    const script = await readFile(path.join(cache, name), 'utf8')
    const metadata = JSON.parse(script.match(/loadPackage\((\{"files"[^\r\n]+\})\);/)[1])
    console.log(name, metadata.files.filter((entry) => /\/(?:fontspec|polyglossia|xunicode|xltxtra|enumitem|titlesec)\//.test(entry.filename)).map((entry) => ({ path: entry.filename, bytes: entry.end - entry.start })))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, cache] = process.argv.slice(2)
  if (!['--normalize-checkout', '--groups', '--manifest'].includes(command) && (!cache || !path.isAbsolute(cache))) throw new Error('Supply an absolute temporary cache directory')
  if (command === '--normalize-checkout') await normalizeCheckout()
  else if (command === '--groups') await refreshGroups()
  else if (command === '--acquire') await acquire(cache)
  else if (command === '--inventory') await inventory(cache)
  else if (command === '--build') await build(cache)
  else if (command === '--manifest') await refreshManifest()
  else if (command === '--wasm-info') {
    const compiled = await WebAssembly.compile(await readFile(path.join(cache, 'busytex.wasm')))
    console.log('exports', WebAssembly.Module.exports(compiled))
    console.log('imports', WebAssembly.Module.imports(compiled).map((item) => `${item.module}.${item.name}`))
  }
  else if (command === '--font-info') {
    const entries = tarEntries(gunzipSync(await readFile(path.join(cache, 'texlive-basic.tar.gz'))))
    for (const entry of entries.filter((item) => item.path.includes('/luaotfload/') && /harf.*\.lua$/.test(item.path))) {
      const lines = entry.content.toString('utf8').split('\n')
      for (let index = 0; index < lines.length; index++) if (/actual.?text|ToUnicode|unicode.*cluster/i.test(lines[index])) console.log(`${entry.path}:${index + 1}\n${lines.slice(Math.max(0, index - 4), index + 6).join('\n')}`)
    }
  }
  else throw new Error('Use --acquire, --inventory, --build, --groups, --manifest, --normalize-checkout, --wasm-info or --font-info')
}
