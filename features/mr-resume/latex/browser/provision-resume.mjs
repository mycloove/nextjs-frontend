import { execFileSync } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, gunzipSync } from 'node:zlib'
import { createTar, filenameDatabase, sha256, tarEntries, downloads as engineDownloads, release as engineRelease } from './provision.mjs'

// v1 remains an immutable historical release. Extend its actual TeX engines
// with real packages/fonts/Biber, never with an adapted or flattened CV source.
export const staticDirectory = fileURLToPath(new URL('../../../../public/mr-resume/latex/busytex-v2/', import.meta.url))
export const profileVersion = 'browser-busytex-v2-tl2023-4499aa69-altacv-synctex-r2'
const frontend = fileURLToPath(new URL('../../../../', import.meta.url))
const previous = path.join(frontend, 'public/mr-resume/latex/busytex-v1')
const root = staticDirectory
const mirror = 'https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2023/tlnet-final/archive/'
export const packagePins = {
  extsizes: [11704, '77bde71a40f924c517dc5a7c201f8205d1e0d0cf511f80e86e7931a89aa60808'],
  ec: [263716, 'bb85425c214b1056b5f0b8f3bf1478b81e89bd7d290d61c7c73289b534786897'],
  xcolor: [18236, '1a50aaa6a606809b557069d24673dd77619f4442a8476edac29c57ab53e51611'],
  pdfx: [89260, '3fe43275f0bedaceedcff6af1798d52c63c8d2fee6480b90960d8ed958a043a1'],
  pdftex: [39548, 'ae0c4c831a7906dce04f8635c8bfcf342e826a3ecd4006b11b1a1ee1a7bbaf67'],
  colorprofiles: [87972, '4451bd870e03212ea3c531156371d6cdab3a2b81e80aea7c40f8c076824740a0'],
  accsupp: [3304, '6adf314dbd8c9e67fd430b32b31de52736f14f63f90c69783281f0fac59a9ad6'],
  fontawesome5: [866312, '4d85aab86f679d360e7c7c812a055d9c03dd658e31bccfca4a97604497b0cc1c'],
  simpleicons: [3429140, '849cc3dd14f7970608adb55023294067d809be4894e9bc7bc8554f84c12fbaa5'],
  pgf: [717460, 'a0cfff9dcfebfda3de9847021d21dfce9a3dfe2a8185dff32d9d2049896dcecd'],
  tikzfill: [4652, '8f929cf4ce2804443622c217375f359cef794d463cf149aee383dd85bc521a53'],
  environ: [1884, 'ab7c1c662b1425691b468a30e894a30d9a2898f470b2a7f4dd340aeb4ef21db7'],
  trimspaces: [936, '059743d20e15093217e4e4085fecb22f16cf259ae9e2b5d394a070f72b001452'],
  adjustbox: [13608, '56c8cbdaf7c2d3fd2b43878e8661d8b6f4c1c0dfb051fe3d3425a30621783a83'],
  collectbox: [2872, '9eeeac557b2587fabfeb2dc08ccff38874bb0ace450a44654c479f31e77c8c81'],
  dashrule: [1488, '5c987fd22aaee69342a1030feebe2612c9748a56f938609600ac5bb6e6e77f05'],
  multirow: [2796, 'bd57d25797ece570fe0e4c92094bca2b135fda0f1dd934fba9761e6722efce62'],
  changepage: [2612, 'ab93ccf442841a811a312b6cfed99c0ad5c5710f966ddada0526e902a0f42078'],
  paracol: [18856, 'b29c3ab4a8abf7f8dc729df59f69f6bd8a460cd408a03ead22c2b13a6e9939ea'],
  ragged2e: [3048, '2e8a52f6c1f70ab891bb19d83d6b47ad2cf5c82be8c8d314c67087f80767ec37'],
  roboto: [25354284, '547d80306d8847e352d39397bae1d51d867d9054018b2f6f8d6c4b4adbd47756'],
  lato: [12721308, '7a7b7e4182342140a8febd05ee327a9a2af7e24af671a271c0635dbabe62a357'],
  'biblatex-ieee': [5564, '6d42e09c1c5eb92b8a727b630327a786b46d4c058cddf4a3cca5ae25eca1ce1b'],
  'biblatex-apa6': [21184, 'cf23355c69e2124c68b9c8260e9f56495511b3b7236d9147ab349dafdb79d18f'],
  csquotes: [18088, '920f21b57f4997f93eca04f414400d394d5f5fa6835ab9bf97ee9d00b944f032'],
  logreq: [3212, 'c59a8bcd1e2cd79da0b0e37a96b1b3cc92ac4bef71ca8e3ca452c677b0987d0e'],
  xpatch: [1924, 'eb826088c8db96a4b4afbc91906790c03caf85a5f2ddec198aba9fb66b4a10b8'],
  xstring: [11536, '855a0283c99ca80da89cfeb2ea7467f9746f6c8ed135d9d6e516973ff6a42ed6'],
  cmap: [5728, 'f466a409f749994137c99843dd20c1b79a45c51c2ad5f75b5378bab963ad477b'],
  xkeyval: [8996, '3dc950df9b224cfb6138f753d7c172867cf1b288fccb48b2e3ea3f324dbde62d'],
  fontaxes: [3344, '5358b11be7a9814f55d4e7fccd886820e861f5f7ca9b899094c09bd0a6c558d8'],
  mweights: [1236, '532c2904fca77f8001f10ad7484bc4b09693d19912febc3faa8d201afcafe47e'],
  everyshi: [2000, '0f9a838aa6cd365d88b1ee8059a935045a821c9040c27cc5de54054f8e9cff13'],
  luatex85: [1740, 'd937d50a854f6277847d237ccdb8482122c979a0b216b4b1d41e13d2a079d009'],
  xmpincl: [1792, '8056d1482697fc8d1468ec5d5bed685a89bd301927c9cb2f1a166507d7d2d5f1'],
  ifoddpage: [1440, '7c658419f941d53af0ba5996949dc8645486720994b91892a8166e4534f6f232'],
  ifmtarg: [664, 'd1677c5c676a5c798d0340aa6113aad1afce6d0f6cec968a4663f79de03e1487'],
  fp: [19252, '9eb4cc9ae96b893b064a472ce55ff58c65df3a433f303fd6d018737ae4d8a24e'],
}
const biblatexCommit = '7f0435bfcff2da18b820ab1adf39a2950fa2e692'
const biblatexInput = { name: 'biblatex-3.22-source.tar.gz', bytes: 18887393, sha256: '9ace84eade5f89b82d21344bd591f58d0a42bedbb67674cc2ac3181ee1d6f7bf', url: `https://codeload.github.com/plk/biblatex/tar.gz/${biblatexCommit}` }
const tcolorboxCommit = '67963e25ceb3a685c5521413eea52cb5128ddc1a'
const tcolorboxInput = { name: 'tcolorbox-6.0.3-source.tar.gz', bytes: 6357228, sha256: '533b606a71845ebf56c2f8bb9bb2ffadc62a02071dcc5a5a2d2db9a4294388bf', url: `https://codeload.github.com/T-F-S/tcolorbox/tar.gz/${tcolorboxCommit}` }
export const biberPins = {
  'runtime.mjs': [107459, '356aad1719c586afea9412f0b6d7744b7c5f0e1a1402d4959801741d3d70a32b'],
  'biber.wasm': [9227241, 'f4f291d94e03813318da36b7090d3bf5a05f199a21a8c5ba72e24f0881a48285'],
  'biber.data': [34746422, 'b68fe6131c8a4061fc8e2355de54ec0ad9ff383867678b157b05ed06bfaf82a4'],
  'filesystem.json': [296786, 'c131980c5717217b29cd9c1594028f7d1e7bf00fe18775af70824c0d3d0e9b93'],
}
const biberSourcePin = { bytes: 56332727, sha256: 'def0b629d93e41910f385e287fba5fa3f742aa9e243ce6eeded97ae9488d6230' }
const encode = (value) => Buffer.from(JSON.stringify(value, null, 2) + '\n')
const checked = (bytes, pin, name) => { if (bytes.length !== pin.bytes || sha256(bytes) !== pin.sha256) throw new Error(`Pinned input mismatch: ${name}`); return bytes }
const inputFor = (name) => ({ name: `${name}.tar.xz`, url: `${mirror}${name}.tar.xz`, bytes: packagePins[name][0], sha256: packagePins[name][1] })
async function optionalRead(filename) { try { return await readFile(filename) } catch (error) { if (error.code !== 'ENOENT') throw error; return null } }
async function paths(directory, prefix = '') {
  const output = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) output.push(...await paths(path.join(directory, entry.name), relative))
    else if (entry.isFile()) output.push(relative)
    else throw new Error(`Non-regular build input: ${relative}`)
  }
  return output.sort()
}
function includeFont(name, relative) {
  if (name === 'ec') return /^fonts\/tfm\/.*\/ecrm1000\.tfm$/.test(relative)
  if (name === 'pdftex') return /^fonts\/(?:type1|tfm|map)\/.*\/(?:dummy-space|pdftexspace)\.(?:pfb|tfm|map)$/.test(relative)
  if (name === 'roboto' && relative.endsWith('.fd')) return /\/(?:T1|TS1|OT1)RobotoSlab-TLF\.fd$/i.test(relative)
  if (name === 'roboto' && relative.endsWith('.sty')) return relative.endsWith('/roboto.sty')
  if (!relative.startsWith('fonts/')) return true
  const base = path.posix.basename(relative)
  if (name === 'roboto') {
    if (/\.(otf|pfb)$/i.test(base)) return /^RobotoSlab-(?:Regular|Bold)\./.test(base)
    if (/\.(tfm|vf)$/i.test(base)) return /^RobotoSlab-(?:Regular|Bold)-tlf-(?:t1|ts1)(?:--base)?\.(?:tfm|vf)$/i.test(base)
  }
  if (name === 'lato') {
    if (/\.(ttf|pfb)$/i.test(base)) return /^Lato-(?:Regular|Italic|Bold|BoldItalic)\./.test(base)
    if (/\.(tfm|vf)$/i.test(base)) return /^Lato-(?:Regular|Italic|Bold|BoldItalic)-(?:T1|TS1)-TLF(?:--base)?\.(?:tfm|vf)$/i.test(base)
  }
  return true
}
async function acquire(cache) {
  await mkdir(cache, { recursive: true })
  for (const input of [...Object.keys(packagePins).map(inputFor), biblatexInput, tcolorboxInput]) {
    const filename = path.join(cache, input.name)
    let bytes = await optionalRead(filename)
    if (!bytes) {
      const response = await fetch(input.url, { redirect: 'error', signal: AbortSignal.timeout(120000) })
      if (!response.ok) throw new Error(`Unable to acquire ${input.name}: ${response.status}`)
      bytes = checked(Buffer.from(await response.arrayBuffer()), input, input.name)
      await writeFile(filename, bytes)
    }
    checked(bytes, input, input.name)
    console.log(`Verified ${input.name}: ${input.bytes} bytes`)
  }
}
async function seed() {
  await mkdir(root, { recursive: true })
  for (const relative of await paths(previous)) {
    const filename = path.join(root, relative)
    try { await readdir(path.dirname(filename)); if (await optionalRead(filename)) continue } catch (error) { if (error.code !== 'ENOENT') throw error }
    await mkdir(path.dirname(filename), { recursive: true })
    await copyFile(path.join(previous, relative), filename)
  }
}
async function assetPin(relative) {
  const bytes = await readFile(path.join(root, relative))
  return { path: relative, bytes: bytes.length, sha256: sha256(bytes) }
}
async function saveParts(name, bytes) {
  const parts = []
  for (let at = 0; at < bytes.length; at += 32 * 1024 * 1024) {
    const content = bytes.subarray(at, at + 32 * 1024 * 1024)
    const relative = `sources/${name}${bytes.length > 32 * 1024 * 1024 ? `.part-${String(parts.length).padStart(2, '0')}` : ''}`
    await writeFile(path.join(root, relative), content)
    parts.push({ path: relative, bytes: content.length, sha256: sha256(content) })
  }
  return { name, bytes: bytes.length, sha256: sha256(bytes), parts }
}
async function installSourceNotices(directory) {
  const metadata = await readFile(path.join(directory, 'manifest.json'))
  if (metadata.length > 128 * 1024 || sha256(metadata) !== '7942c853b00ae7a3fe806cd2a99269a175878156d6c8b5569972d8912fa3aebb') throw new Error('Pinned source/doc metadata mismatch')
  const licenseBytes = await readFile(path.join(directory, 'license-inputs.json'))
  if (sha256(licenseBytes) !== '2070031469aaf90695e572675d0e7fa4b4f7d3e771de2a2e4f027df24a5c224c') throw new Error('Pinned source/license metadata mismatch')
  const inputs = JSON.parse(metadata), licenses = JSON.parse(licenseBytes), entries = [], normalizedInputs = [], normalizedLicenses = []
  for (const input of inputs) {
    if (!/^[a-z0-9-]+\.(?:source|doc)\.tar\.xz$/.test(input.name) || !Object.hasOwn(packagePins, input.package)) throw new Error('Unknown source/doc input')
    const content = checked(await readFile(path.join(directory, input.name)), input, input.name)
    entries.push({ path: `archives/${input.name}`, content })
    normalizedInputs.push(Object.fromEntries(Object.entries(input).filter(([key]) => !['path', 'extractedPath', 'memberMetadata'].includes(key))))
  }
  for (const input of licenses) {
    if (!/^[A-Za-z0-9_.-]+\.(?:txt|json)$/.test(input.name)) throw new Error('Unsafe license name')
    const content = checked(await readFile(path.join(directory, 'licenses', input.name)), input, input.name)
    entries.push({ path: `licenses/${input.name}`, content })
    await writeFile(path.join(root, 'licenses', input.name), content)
    const record = Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'path'))
    normalizedLicenses.push({ ...record, path: `licenses/${input.name}` })
  }
  entries.push({ path: 'source-inputs.json', content: encode(normalizedInputs) }, { path: 'license-inputs.json', content: encode(normalizedLicenses) })
  const archive = await saveParts('altacv-package-sources-and-notices.tar.gz', gzipSync(createTar(entries.sort((a, b) => a.path < b.path ? -1 : 1)), { level: 9, mtime: 0 }))
  const provenance = JSON.parse(await readFile(path.join(root, 'provenance.json'), 'utf8'))
  provenance.packageSources = { archive, inputs: normalizedInputs, licenses: normalizedLicenses, scope: 'Exact matching frozen source/doc archives, per-font copyright/license notices and brand disclaimers. Missing separate source archives are not described as rebuilt font designs or complete preferred source for every bundled historical font.' }
  await writeFile(path.join(root, 'provenance.json'), encode(provenance))
  await refreshManifest()
}
async function build(cache, biberRoot) {
  await seed()
  const original = JSON.parse(await readFile(path.join(previous, 'manifest.json'), 'utf8'))
  const oldIndex = JSON.parse(await readFile(path.join(previous, 'snapshot-index.json'), 'utf8'))
  const oldArchivePin = original.assets.find((asset) => asset.path === 'texlive.snapshot.tar.gz')
  const oldArchive = checked(await readFile(path.join(previous, oldArchivePin.path)), oldArchivePin, oldArchivePin.path)
  const metadata = new Map(oldIndex.files.map((entry) => [entry.path, entry]))
  const entries = new Map(tarEntries(gunzipSync(oldArchive, { maxOutputLength: 96 * 1024 * 1024 })).map((entry) => {
    checked(entry.content, metadata.get(entry.path), entry.path)
    return [entry.path, { ...entry, source: metadata.get(entry.path).source, upstreamPath: metadata.get(entry.path).upstreamPath }]
  }))
  const definitions = [...original.groups.map(({ id, kind, profiles, packages }) => ({ id, kind, profiles, packages })),
    { id: 'cv-layout', kind: 'package', profiles: ['pdflatex', 'xelatex', 'lualatex'], packages: [] },
    { id: 'cv-fonts', kind: 'package', profiles: ['pdflatex', 'xelatex', 'lualatex'], packages: [] },
    { id: 'bibliography', kind: 'package', profiles: ['pdflatex', 'xelatex', 'lualatex'], packages: [] }]
  const owners = new Map()
  for (const group of original.groups) {
    const index = JSON.parse(await readFile(path.join(previous, group.index), 'utf8'))
    for (const file of index.files) owners.set(file.path, group.id)
  }
  const fontPackages = new Set(['fontawesome5', 'simpleicons', 'roboto', 'lato', 'fontaxes', 'mweights', 'ec'])
  const bibliographyPackages = new Set(['biblatex', 'biblatex-ieee', 'biblatex-apa6', 'csquotes', 'logreq', 'xpatch', 'xstring'])
  const supplemental = [], mapLines = []
  const inputs = [...Object.keys(packagePins).map(inputFor), biblatexInput, tcolorboxInput]
  for (const input of inputs) {
    const name = input === biblatexInput ? 'biblatex' : input === tcolorboxInput ? 'tcolorbox' : input.name.replace(/\.tar\.xz$/, '')
    const filename = path.join(cache, input.name)
    checked(await readFile(filename), input, input.name)
    const extract = path.join(cache, `verified-${name}`)
    await mkdir(extract, { recursive: true })
    const members = execFileSync('tar', ['-tf', filename], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).split(/\r?\n/).filter(Boolean)
    if (members.some((member) => member.startsWith('/') || member.includes('\\') || member.split('/').includes('..'))) throw new Error(`Unsafe package archive: ${name}`)
    execFileSync('tar', ['-xf', filename, '-C', extract])
    const packageRoot = name === 'biblatex' ? path.join(extract, `biblatex-${biblatexCommit}`) : name === 'tcolorbox' ? path.join(extract, `tcolorbox-${tcolorboxCommit}`) : extract
    for (const relative of await paths(packageRoot)) {
      if (!/^(?:tex|fonts|dvips|dvipdfmx)\//.test(relative) || !includeFont(name, relative)) continue
      let content = await readFile(path.join(packageRoot, relative))
      if (name === 'biblatex' && relative === 'tex/latex/biblatex/biblatex.sty') {
        // Exactly the release substitution specified by upstream build.lua,
        // using the date/version of the signed v3.22 release commit.
        const source = content.toString('utf8')
        if (!source.includes('\\def\\blx@bcfversion{3.11}') || !source.includes('\\def\\blx@bblversion{3.3}')) throw new Error('Mismatched Biber/biblatex formats')
        content = Buffer.from(source.replaceAll('{DATE}', '{2026/08/13}').replaceAll('VERSION', '3.22'))
      }
      const virtual = `texlive/texmf-dist/${relative}`
      const entry = { path: virtual, content, source: input.name, upstreamPath: relative }
      entries.set(virtual, entry)
      if (!owners.has(virtual)) owners.set(virtual, bibliographyPackages.has(name) ? 'bibliography' : fontPackages.has(name) ? 'cv-fonts' : 'cv-layout')
      supplemental.push({ path: `${name}/${relative}`, content })
      if (/^fonts\/map\/.*\.map$/.test(relative)) mapLines.push(...content.toString('utf8').split(/\r?\n/).filter((line) => line.trim() && !line.startsWith('%')))
    }
    await copyFile(filename, path.join(root, 'sources', input.name))
  }
  for (const entry of entries.values()) if (/\/texmf-var\/fonts\/map\/(?:pdftex\/updmap\/pdftex|dvipdfmx\/updmap\/kanjix)\.map$/.test(entry.path)) {
    entry.content = Buffer.from(entry.content.toString('utf8').replace(/\s*$/u, '') + '\n' + [...new Set(mapLines)].sort().join('\n') + '\n')
    entry.source = 'generated-v2-font-map'
  }
  const lsR = filenameDatabase([...entries.values()])
  lsR.source = 'generated-v2-filename-database'
  entries.set(lsR.path, lsR); owners.set(lsR.path, 'core')
  const combined = [...entries.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  const combinedTar = createTar(combined)
  if (combinedTar.length > 96 * 1024 * 1024) throw new Error(`TeX snapshot exceeds the unchanged bound: ${combinedTar.length}`)
  const indexFor = (selected, tar) => ({ version: 1, unpackedBytes: tar.length, files: selected.map(({ path, content, source, upstreamPath }) => ({ path, bytes: content.length, sha256: sha256(content), source, ...(upstreamPath ? { upstreamPath } : {}) })) })
  await writeFile(path.join(root, 'texlive.snapshot.tar.gz'), gzipSync(combinedTar, { level: 9, mtime: 0 }))
  await writeFile(path.join(root, 'snapshot-index.json'), encode(indexFor(combined, combinedTar)))
  const groups = [], summaries = []
  for (const group of definitions) {
    const selected = combined.filter((entry) => owners.get(entry.path) === group.id), tar = createTar(selected)
    const archive = `groups/${group.id}/texlive.tar.gz`, index = `groups/${group.id}/snapshot-index.json`
    await mkdir(path.join(root, 'groups', group.id), { recursive: true })
    await writeFile(path.join(root, archive), gzipSync(tar, { level: 9, mtime: 0 }))
    await writeFile(path.join(root, index), encode(indexFor(selected, tar)))
    const packages = group.packages.length ? group.packages : group.kind === 'package' ? [...new Set(selected.filter((file) => /\.(?:sty|cls)$/.test(file.path)).map((file) => path.posix.basename(file.path).replace(/\.(?:sty|cls)$/, '')))].sort() : []
    const assets = await Promise.all([archive, index].map(assetPin))
    if (!selected.length || packages.length > 128 || (group.kind === 'package' && assets[0].bytes > 12 * 1024 * 1024)) throw new Error(`Invalid group bounds: ${group.id}`)
    groups.push({ ...group, packages, archive, index, assets })
    summaries.push({ id: group.id, kind: group.kind, profiles: group.profiles, archive: assets[0], index: assets[1], files: selected.length, fileBytes: selected.reduce((sum, file) => sum + file.content.length, 0), unpackedBytes: tar.length })
  }
  if (summaries.reduce((sum, group) => sum + group.unpackedBytes, 0) > 96 * 1024 * 1024) throw new Error('Expanded groups exceed the unchanged snapshot bound')
  await mkdir(path.join(root, 'tools/biber'), { recursive: true })
  for (const [name, [bytes, sha256]] of Object.entries(biberPins)) {
    const output = name === 'runtime.mjs' ? 'biber.js.bin' : name === 'filesystem.json' ? 'biber-index.json' : name
    // A checkout already contains these exact original vendor bytes. Permit a
    // reproducible rebuild after the external acquisition cache has expired.
    const content = checked(await optionalRead(path.join(biberRoot, name)) || await readFile(path.join(root, 'tools/biber', output)), { bytes, sha256 }, name)
    await writeFile(path.join(root, 'tools/biber', output), content)
  }
  const priorProvenance = JSON.parse(await readFile(path.join(root, 'provenance.json'), 'utf8'))
  const cachedSource = await optionalRead(path.join(biberRoot, 'wasmbiber-corresponding-source.tar.gz'))
  const completeSource = cachedSource || Buffer.concat(await Promise.all(priorProvenance.biber.sourceArchive.parts.map((part) => readFile(path.join(root, part.path)))))
  const biberSource = await saveParts('wasmbiber-corresponding-source.tar.gz', checked(completeSource, biberSourcePin, 'Biber corresponding source'))
  try { for (const relative of await paths(path.join(biberRoot, 'licenses'))) await copyFile(path.join(biberRoot, 'licenses', relative), path.join(root, 'licenses', relative)) }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  await writeFile(path.join(root, 'sources/altacv-runtime-source.tar.gz'), gzipSync(createTar(supplemental), { level: 9, mtime: 0 }))
  const provenance = JSON.parse(await readFile(path.join(previous, 'provenance.json'), 'utf8'))
  const current = await optionalRead(path.join(root, 'provenance.json'))
  if (current) provenance.packageSources = JSON.parse(current).packageSources
  Object.assign(provenance, { profileVersion, packageDownloads: inputs, groups: summaries,
    snapshot: { path: 'texlive.snapshot.tar.gz', compressedBytes: (await assetPin('texlive.snapshot.tar.gz')).bytes, unpackedBytes: combinedTar.length, fileBytes: combined.reduce((sum, file) => sum + file.content.length, 0), files: combined.length, pruning: 'Existing bounded core plus actual AltaCV layout/metadata and IEEE+APA6 packages; Roboto Slab regular/bold and Lato regular/bold/italic/bold-italic with the original default T1/TS1 tabular-lining metrics/maps/outlines; full Font Awesome 5/Simple Icons. No CV source rewrite, chart/icon/font substitutions or native executables.' },
    biber: { version: '2.22', biblatex: '3.22', controlFileVersion: '3.11', bblVersion: '3.3', release: 'snapshot-10dbd6269c42bd57', releaseURL: 'https://github.com/corca-ai/wasmbiber/releases/download/snapshot-10dbd6269c42bd57/wasmbiber-0.1.0-f7e76a9.tgz', sdkCommit: 'f7e76a9155164e757ec72be1dcec99e0e29b17bd', sourceArchive: biberSource, inputs: Object.entries(biberPins).map(([name, [bytes, sha256]]) => ({ name, bytes, sha256 })), modification: 'WASM, Perl/Biber data and ESM factory remain unmodified. The application worker supplies pinned bytes, a separate bounded MEMFS and denied network/JS-eval imports.', rebuildLimit: 'Corresponding source is offered; the matching exported upstream Docker toolchain image is not available. A deterministic clean runtime rebuild is not claimed.' } })
  await writeFile(path.join(root, 'provenance.json'), encode(provenance))
  await refreshManifest(groups)
}
export async function completeLatinModern(cache) {
  const input = engineDownloads.find((input) => input.name === 'texlive-basic.tar.gz')
  if (!path.isAbsolute(cache) || input?.bytes !== 70838141 || input.sha256 !== 'a2d753d927b97b1bd45424366ff86f5a4d60ea61c4e421cb093d9a6533ecbfd1') throw new Error('The original Latin Modern input pin is invalid')
  const original = checked(await readFile(path.join(cache, input.name)), input, input.name)
  const prefix = 'build/texlive-basic/texmf-dist/fonts/opentype/public/lm/'
  const fonts = tarEntries(gunzipSync(original, { maxOutputLength: 512 * 1024 * 1024 })).filter((entry) => entry.path.startsWith(prefix) && /^lm[A-Za-z0-9-]+\.otf$/.test(path.posix.basename(entry.path))).map((entry) => ({
    path: entry.path.replace(/^build\/texlive-basic\//, 'texlive/'), content: entry.content, source: input.name, upstreamPath: entry.path,
  }))
  if (fonts.length !== 72 || new Set(fonts.map((entry) => entry.path)).size !== fonts.length) throw new Error('Reevaluate the original complete Latin Modern OTF inventory')
  const current = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')), provenance = JSON.parse(await readFile(path.join(root, 'provenance.json'), 'utf8'))
  const group = current.groups.find((group) => group.id === 'unicode' && group.kind === 'profile')
  if (!group || !group.profiles.includes('xelatex') || !group.profiles.includes('lualatex')) throw new Error('The existing Unicode profile is unavailable')
  const oldIndex = JSON.parse(checked(await readFile(path.join(root, group.index)), group.assets.find((pin) => pin.path === group.index), group.index).toString('utf8'))
  const oldMetadata = new Map(oldIndex.files.map((file) => [file.path, file]))
  const oldArchive = checked(await readFile(path.join(root, group.archive)), group.assets.find((pin) => pin.path === group.archive), group.archive)
  const entries = new Map(tarEntries(gunzipSync(oldArchive, { maxOutputLength: 96 * 1024 * 1024 })).map((entry) => {
    const pin = oldMetadata.get(entry.path)
    checked(entry.content, pin, entry.path)
    return [entry.path, { ...entry, source: pin.source, upstreamPath: pin.upstreamPath }]
  }))
  if (entries.size !== oldMetadata.size) throw new Error('The existing Unicode index/archive do not match')
  const added = []
  for (const font of fonts) {
    const existing = entries.get(font.path)
    if (existing && !existing.content.equals(font.content)) throw new Error(`The original font bytes changed: ${font.path}`)
    if (!existing) { entries.set(font.path, font); added.push(font) }
  }
  const selected = [...entries.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0), tar = createTar(selected)
  const describe = ({ path, content, source, upstreamPath }) => ({ path, bytes: content.length, sha256: sha256(content), source, ...(upstreamPath ? { upstreamPath } : {}) })
  const index = encode({ version: 1, unpackedBytes: tar.length, files: selected.map(describe) }), archive = gzipSync(tar, { level: 9, mtime: 0 })
  const newPins = [{ path: group.archive, bytes: archive.length, sha256: sha256(archive) }, { path: group.index, bytes: index.length, sha256: sha256(index) }]
  const groups = current.groups.map((item) => item.id === group.id ? { ...item, assets: newPins } : item)
  const indices = new Map(await Promise.all(groups.map(async (item) => [item.id, item.id === group.id ? JSON.parse(index) : JSON.parse(checked(await readFile(path.join(root, item.index)), item.assets.find((pin) => pin.path === item.index), item.index).toString('utf8'))])))
  const selectedBounds = Object.fromEntries(current.engines.map((engine) => {
    const active = groups.filter((item) => item.profiles.includes(engine.id)).map((item) => indices.get(item.id))
    const unpackedBytes = active.reduce((sum, item) => sum + item.unpackedBytes, 0), files = active.reduce((sum, item) => sum + item.files.length, 0)
    if (unpackedBytes > 96 * 1024 * 1024 || files > 6000) throw new Error(`Completed Latin Modern exceeds the unchanged selected ${engine.id} snapshot bound`)
    return [engine.id, { unpackedBytes, files }]
  }))
  const unique = new Map([...current.assets, ...groups.flatMap((item) => item.assets), ...(current.biber?.assets || []), ...(current.synctex ? [current.synctex] : [])].map((pin) => [pin.path, pin]))
  if (unique.size > 64 || [...unique.values()].reduce((sum, pin) => sum + pin.bytes, 0) > 256 * 1024 * 1024 || archive.length > 96 * 1024 * 1024 || index.length > 3 * 1024 * 1024) throw new Error('Completed Latin Modern exceeds existing distribution bounds')
  const prior = provenance.latinModernCompletion
  provenance.latinModernCompletion = {
    version: 1, group: 'unicode', input: { ...input, url: input.url || `https://github.com/busytex/busytex/releases/download/${engineRelease}/${input.name}` },
    policy: 'Complete unchanged OpenType files from the pinned original public/lm directory, including roman/sans/mono optical sizes and styles. No other fonts, engine formats, binaries or optional packages change. The historical monolithic snapshot is retained; this exact additive extension belongs to the selected Unicode profile. Runtime builds ls-R from verified selected index paths.',
    qualification: 'Existing profile and engine version strings are retained. The exact manifest/archive/index digests identify this additive completeness change; historical starter qualifications are not relabeled.',
    files: fonts.map(describe).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    addedFiles: prior?.addedFiles || added.map(describe).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    originalArchive: prior?.originalArchive || group.assets.find((pin) => pin.path === group.archive), originalIndex: prior?.originalIndex || group.assets.find((pin) => pin.path === group.index),
    archive: newPins[0], index: newPins[1], addedFontBytes: prior?.addedFontBytes ?? added.reduce((sum, entry) => sum + entry.content.length, 0),
    archiveDeltaBytes: archive.length - (prior?.originalArchive.bytes ?? oldArchive.length), indexDeltaBytes: index.length - (prior?.originalIndex.bytes ?? (await readFile(path.join(root, group.index))).length),
    selectedBounds, license: await assetPin('licenses/LatinModern-GUST.txt'),
    sourceCoverage: 'Unmodified font binaries and their original embedded notices are retained byte-for-byte. Input URL/full hash and per-font member hashes are recorded. No new preferred font-development source or font rebuild is claimed.',
  }
  const summary = provenance.groups.find((item) => item.id === group.id)
  Object.assign(summary, { archive: newPins[0], index: newPins[1], files: selected.length, fileBytes: selected.reduce((sum, entry) => sum + entry.content.length, 0), unpackedBytes: tar.length })
  // Only these two runtime asset files are rebuilt. Legacy/core/other groups stay
  // byte-identical; input/budget checks above happen before publication.
  await writeFile(path.join(root, group.archive), archive)
  await writeFile(path.join(root, group.index), index)
  await writeFile(path.join(root, 'provenance.json'), encode(provenance))
  await refreshManifest(groups)
  console.log(JSON.stringify({ latinModern: { files: fonts.length, addedFiles: provenance.latinModernCompletion.addedFiles.length, addedFontBytes: provenance.latinModernCompletion.addedFontBytes, archiveDeltaBytes: provenance.latinModernCompletion.archiveDeltaBytes, indexDeltaBytes: provenance.latinModernCompletion.indexDeltaBytes, selectedBounds } }, null, 2))
}

export async function refreshManifest(groups) {
  const original = JSON.parse(await readFile(path.join(previous, 'manifest.json'), 'utf8'))
  const provenance = JSON.parse(await readFile(path.join(root, 'provenance.json'), 'utf8'))
  if (!groups) {
    const current = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8'))
    groups = await Promise.all(current.groups.map(async (group) => ({ ...group, assets: await Promise.all(group.assets.map((pin) => assetPin(pin.path))) })))
  }
  const exportName = (name) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/.test(name) && /\.(?:sty|cls|tex|def|cfg|bbx|cbx|dbx|bst|fd|tfm|vf|map|enc|otf|ttf)$/i.test(name)
  const catalogs = [], dependencyEvidence = []
  let catalogEntries = 0
  groups = await Promise.all(groups.map(async (group) => {
    const indexPin = group.assets.find((pin) => pin.path === group.index)
    const index = JSON.parse(checked(await readFile(path.join(root, group.index)), indexPin, group.index).toString('utf8'))
    const files = [...new Set(index.files.map((file) => path.posix.basename(file.path)).filter(exportName))].sort()
    catalogEntries += files.length
    if (files.length > 8192 || catalogEntries > 32768) throw new Error('The exact runtime-export catalog exceeds its declared bounds')
    // This is an intentional, small coarse dependency: the shipped theorem
    // library requires amsmath. Verify the directive in the pinned member.
    const requires = group.id === 'cv-layout' ? ['math'] : []
    if (requires.length) {
      const memberPath = 'texlive/texmf-dist/tex/latex/tcolorbox/tcbtheorems.code.tex'
      const memberPin = index.files.find((file) => file.path === memberPath)
      const archivePin = group.assets.find((pin) => pin.path === group.archive)
      const archive = checked(await readFile(path.join(root, group.archive)), archivePin, group.archive)
      const member = tarEntries(gunzipSync(archive, { maxOutputLength: 96 * 1024 * 1024 })).find((entry) => entry.path === memberPath)
      if (!member || !memberPin || !/\\RequirePackage\s*\{amsmath\}/.test(checked(member.content, memberPin, memberPath).toString('utf8')) || !groups.some((item) => item.id === 'math' && item.kind === 'package' && group.profiles.every((engine) => item.profiles.includes(engine)))) throw new Error('The package dependency is not proven by the pinned runtime')
      dependencyEvidence.push({ group: group.id, requires: 'math', source: memberPin, directive: '\\RequirePackage{amsmath}' })
    }
    // The stored roboto.sty is an upstream source fragment, not a qualified
    // package: only Slab faces are shipped. Do not advertise a false remedy.
    const packages = group.id === 'cv-fonts' ? group.packages.filter((name) => name !== 'roboto') : group.packages
    catalogs.push({ group: group.id, index: indexPin, entries: files.length, sha256: sha256(encode({ files, requires })) })
    return { ...group, packages, files, requires }
  }))
  provenance.exportCatalog = { version: 1, scope: 'Exact case-sensitive runtime-export basenames from verified existing indices; no inferred CTAN/package/font-family names. Optional .sty/.cls exports are offered only when also advertised in group.packages.', entries: catalogEntries,
    groups: catalogs.sort((a, b) => a.group < b.group ? -1 : a.group > b.group ? 1 : 0), dependencyEvidence,
    unqualifiedPackages: [{ name: 'roboto', file: 'roboto.sty', reason: 'The original package initializes Roboto/RobotoCondensed faces that are not in the bounded bundle. Only direct Roboto Slab Regular/Bold usage is qualified. No source/font substitution.' }] }
  const manifest = { version: 1, profileVersion,
    engines: original.engines.map((engine) => ({ ...engine, version: `${engine.version}; biblatex 3.22 / Biber 2.22`, packages: [...new Set([...engine.packages, ...groups.filter((group) => group.kind === 'package' && group.profiles.includes(engine.id)).flatMap((group) => group.packages), 'biber'])].sort(), fonts: [...new Set([...engine.fonts, 'Roboto Slab', 'Lato'])] })),
    assets: await Promise.all(['compiler-worker.js', 'busytex.js.bin', 'busytex.wasm', 'snapshot-index.json', 'texlive.snapshot.tar.gz'].map(assetPin)), groups,
    biber: { group: 'bibliography', version: '2.22', assets: await Promise.all(['biber.js.bin', 'biber.wasm', 'biber.data', 'biber-index.json'].map((name) => assetPin(`tools/biber/${name}`))) },
    synctex: await assetPin('tools/synctex/synctex-parser.wasm'),
    limitations: [
      'Actual TeX engines run in a disposable browser worker. Shell execution, network access and unbounded package installation remain disabled.',
      'BusyTeX has a fixed 512 MiB heap. Lua fontspec defaults to the real HarfBuzz shaper to avoid node-renderer font-table exhaustion; explicit source features still override this default. Biber has a separate bounded heap. Compile/verification has a 180-second external deadline with cancellation.',
      'AltaCV uses the unchanged imported sources, actual Roboto Slab/Lato fonts, Font Awesome 5/Simple Icons, paracol, PGF/TikZ, tcolorbox and PDF metadata packages.',
      'The real Perl Biber 2.22 / biblatex 3.22 BCF 3.11 / BBL 3.3 workflow keeps source/BIB/build/log/PDF bytes on device. Runtime source and individual licenses are offered separately.',
      'Optional pinned package/font/bibliography assets require download permission and can be cached. Unlisted packages/fonts fail explicitly, without template adaptation or native upload fallback.',
      'The exact runtime-export catalog is not universal package compatibility. Generic usepackage{roboto}, Roboto/RobotoCondensed, Font Awesome Pro/4/6, ModernCV and Awesome-CV are not supported by this bounded bundle. Direct Roboto Slab Regular/Bold remains available. The cv-layout group declares its existing amsmath/theorem-library dependency.',
      'Original PDF bytes are verified, not reconstructed. This is not universal TeX compatibility or PDF/A certification; source warnings and layout overflow remain visible.',
      ...(provenance.latinModernCompletion ? ['The selected Unicode profile contains all 72 unchanged original Latin Modern OTF files for roman/sans/mono defaults, optical sizes and styles. Historical monolithic assets remain unchanged; complete Unicode defaults require the current grouped profile. Every selected engine plus all compatible package groups remains within the existing 96 MiB expanded bound.'] : []),
      'Actual pdfTeX/XeTeX/LuaHBTeX SyncTeX sidecars stay session-only. The upstream parser runs in a bounded disposable worker; unsupported PDF transforms, unmapped paths/lines, whitespace and stale proofs are refused. No source-upload fallback.',
      'LuaHBTeX maps containing zero-Y glyph boundaries are refused: actual fixtures show unreliable upstream inverse-query ranking. Lua compilation/PDF output still works; this release does not promise browser source navigation for those maps.',
    ] }
  const bytes = encode(manifest)
  if (bytes.length > 1024 * 1024) throw new Error('The compiler manifest exceeds its 1 MiB metadata limit')
  await writeFile(path.join(root, 'manifest.json'), bytes)
  await writeFile(path.join(frontend, 'features/mr-resume/latex/browserManifestPin.ts'), `/** Generated by browser/provision-resume.mjs from final LF manifest bytes; outside its source archive to avoid a hash cycle. */\nexport const BROWSER_LATEX_MANIFEST_PIN = { path: 'manifest.json', bytes: ${bytes.length}, sha256: '${sha256(bytes)}' } as const\n`)
  const offer = JSON.parse(await readFile(path.join(previous, 'source-offer.json'), 'utf8'))
  const sources = []
  for (const relative of ['features/mr-resume/latex/browser/provision.mjs', 'features/mr-resume/latex/browser/provision-resume.mjs', 'features/mr-resume/latex/browser/build-format.mjs', 'features/mr-resume/latex/browser/build-synctex.mjs', 'features/mr-resume/latex/browser/synctex-adapter.c', 'features/mr-resume/latex/browser/synctex-memory.h', 'features/mr-resume/latex/browser/synctex-smoke.mjs', 'features/mr-resume/latex/browser/synctex-query-worker.mjs', 'features/mr-resume/latex/browser/smoke.mjs', 'features/mr-resume/latex/browser/smoke-worker.mjs', 'public/mr-resume/latex/busytex-v2/compiler-worker.js', 'features/mr-resume/components/fonts/latin-modern/LICENSE.txt']) {
    const bytes = await readFile(path.join(frontend, relative))
    sources.push({ path: `nextjs-frontend/${relative}`, content: relative.endsWith('LICENSE.txt') ? bytes : Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) })
  }
  const source = await saveParts('browser-provisioning-source-v2.tar.gz', gzipSync(createTar(sources), { level: 9, mtime: 0 }))
  Object.assign(offer.build, { provisioningSources: source.parts[0].path, provisioningArchive: source.parts[0], provisioningFiles: sources.map((file) => ({ path: file.path, bytes: file.content.length, sha256: sha256(file.content) })), provision: 'v1 engine inputs and formats are retained. provision-resume.mjs --acquire <cache> verifies fixed TeX package inputs; --build <cache> <Biber-assets-directory> creates v2 groups from v1 and those inputs. --finalize refreshes source/asset pins only, never downloads or runs TeX. Biber inputs/source are separately pinned. biblatex uses only the release substitutions in upstream build.lua. Source archive needs the historical v1 assets; it is not a stand-alone runtime rebuild kit.' })
  if (provenance.latinModernCompletion) offer.build.provision += ' Then provision.mjs --acquire-one <cache> texlive-basic.tar.gz obtains only that existing exact pinned input when needed, and provision-resume.mjs --complete-lm <cache> reads/verifies it to complete only the Unicode group. The latter performs no network request, font transformation or engine build and preserves the historical monolith and other groups.'
  const previousSuppliers = new Map(JSON.parse(await readFile(path.join(previous, 'provenance.json'), 'utf8')).groupSources.flatMap((group) => group.suppliers.map((supplier) => [supplier.source, supplier])))
  provenance.groupSources = []
  for (const group of groups) {
    const summary = provenance.groups.find((item) => item.id === group.id)
    summary.packages = group.packages
    const index = JSON.parse(await readFile(path.join(root, group.index), 'utf8'))
    const suppliers = []
    for (const name of [...new Set(index.files.map((file) => file.source))].sort()) {
      const prior = previousSuppliers.get(name), input = provenance.packageDownloads.find((input) => input.name === name)
      const preservedSources = prior ? await Promise.all(prior.preservedSources.map((pin) => assetPin(pin.path)))
        : input ? [await assetPin(`sources/${input.name}`), ...(provenance.packageSources?.archive.parts || [])] : source.parts
      const members = index.files.filter((file) => file.source === name)
      const notices = prior ? await Promise.all(prior.notices.map((pin) => assetPin(pin.path))) : await Promise.all(['licenses/LICENSE.TL', 'licenses/LICENSE.CTAN', ...(provenance.packageSources?.licenses || []).filter((notice) => notice.packages?.includes(input?.name.replace(/\.tar\.(?:xz|gz)$/, ''))).map((notice) => notice.path)].map(assetPin))
      suppliers.push({ source: name, files: members.length, fileBytes: members.reduce((sum, file) => sum + file.bytes, 0),
        upstreamInputs: prior?.upstreamInputs || (input ? [input] : []), preservedSources,
        notices,
        scope: prior?.scope || (input ? 'Unmodified selected upstream runtime members, with exact matching package source/doc/font notices where available; biblatex release substitution is documented in the pinned recipe.' : 'Generated from pinned v1 runtime members and listed package inputs by the supplied v2 recipe; not claimed as unmodified upstream font or generated source.') })
    }
    provenance.groupSources.push({ id: group.id, kind: group.kind, profiles: group.profiles, packages: group.packages, archive: summary.archive, index: summary.index,
      files: summary.files, fileBytes: summary.fileBytes, unpackedBytes: summary.unpackedBytes,
      licenseScope: 'Per-member source/license attribution is preserved; not a blanket license. Original GPL/LGPL engine/core obligations and individual LPPL/OFL/Apache/icon terms remain applicable.',
      notices: await Promise.all(['licenses/texlive-notices.txt', 'licenses/LatinModern-GUST.txt', 'licenses/NotoSansBengali-OFL.txt', ...(provenance.packageSources?.licenses || []).filter((notice) => /LATO|ROBOTO|FONT-AWESOME|SIMPLE-ICONS.*(?:CC0|DISCLAIMER)|LPPL/.test(notice.name)).map((notice) => notice.path)].map(assetPin)), suppliers })
  }
  offer.packageCoverage.groups = provenance.groupSources
  offer.packageCoverage.exportCatalog = provenance.exportCatalog
  if (provenance.latinModernCompletion) offer.packageCoverage.latinModernCompletion = provenance.latinModernCompletion
  offer.packageCoverage.altacv = { inputs: provenance.packageDownloads, runtimeSource: await assetPin('sources/altacv-runtime-source.tar.gz'), ...(provenance.packageSources ? { matchingSources: provenance.packageSources } : {}), coverage: 'Exact immutable runtime archives and biblatex release source are offered with matching frozen source/doc archives and concrete font/license notices. Raw generated runtime files are not described as complete preferred font-design source or a deterministic runtime rebuild.' }
  offer.biber = provenance.biber
  offer.synctex = JSON.parse(await readFile(path.join(root, 'tools/synctex/provenance.json'), 'utf8'))
  offer.synctex.adapter.provisioningArchive = source.parts[0]
  provenance.synctex = offer.synctex
  provenance.profileVersion = profileVersion
  provenance.downloads = [...provenance.downloads, ...provenance.packageDownloads.filter((input) => !provenance.downloads.some((item) => item.name === input.name))]
  offer.archives.push(provenance.biber.sourceArchive, ...provenance.packageDownloads.map((input) => ({ ...input, parts: [{ path: `sources/${input.name}`, bytes: input.bytes, sha256: input.sha256 }] })))
  if (provenance.packageSources) offer.archives.push(provenance.packageSources.archive)
  await writeFile(path.join(root, 'source-offer.json'), encode(offer))
  await writeFile(path.join(root, 'THIRD-PARTY-NOTICES.txt'), 'Mr. Resume browser TeX and Biber distribution\n\nThe BusyTeX/TeX Live engine remains the separately licensed unmodified v1 binary, with its upstream sources and original notices. v2 adds original TeX package/font files and authentic Perl Biber 2.22. Individual package/font license headers remain in source/runtime archives; no blanket MIT-only license applies.\n\nBiber: Artistic-2.0. Corca SDK: MIT. Perl/CPAN/Unicode: individual terms in the corresponding-source archive. TeXlyre-derived bootstrap: AGPL-3.0, explicitly identified in licenses/TEXLYRE-AGPL-3.0.txt and the complete corresponding-source archive. Runtime assets, sources and notices are a separate vendor distribution; the surrounding application is not relicensed by this notice. Host distribution obligations require review. No deterministic clean Biber toolchain rebuild is claimed.\n\nThe pinned ESM factory, WASM and Perl/Biber data are unmodified. Our worker supplies only local in-memory job files, denies network and JS eval imports, and returns the real BBL/BLG. It never substitutes BibTeX, fonts, icons or the imported CV source. Source archives are offered by equivalent same-origin access in source-offer.json and are not downloaded during compilation.\n')
  provenance.runtimeAssets = [...manifest.assets, manifest.synctex].map((pin) => pin.path)
  provenance.distributionAssets = []
  for (const relative of await paths(root)) if (/^(?:licenses\/|sources\/|versions\.txt$|format-provenance\.json$|source-offer\.json$|THIRD-PARTY-NOTICES\.txt$|groups\/|tools\/synctex\/)/.test(relative)) provenance.distributionAssets.push(await assetPin(relative))
  await writeFile(path.join(root, 'provenance.json'), encode(provenance))
  console.log(`Finalized ${profileVersion}: ${provenance.groups.reduce((sum, group) => sum + group.files, 0)} grouped TeX files (${provenance.snapshot.files} historical monolithic files), ${groups.length} groups, authentic local Biber. No compilation performed.`)
  return manifest
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, cache, biberRoot] = process.argv.slice(2)
  if (operation === '--acquire' && cache && path.isAbsolute(cache)) await acquire(cache)
  else if (operation === '--build' && cache && biberRoot && path.isAbsolute(cache) && path.isAbsolute(biberRoot)) await build(cache, biberRoot)
  else if (operation === '--finalize') await refreshManifest()
  else if (operation === '--complete-lm' && cache && path.isAbsolute(cache)) await completeLatinModern(cache)
  else if (operation === '--sources' && cache && path.isAbsolute(cache)) await installSourceNotices(cache)
  else throw new Error('Use --acquire <absolute-cache>, --build <absolute-cache> <absolute-Biber-assets>, --complete-lm <absolute-original-input-cache> or --finalize.')
}
