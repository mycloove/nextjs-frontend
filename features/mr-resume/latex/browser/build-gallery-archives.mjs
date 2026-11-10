// Builds the AltaCV gallery archive from the repository's pinned upstream ZIP.
// Run: node features/mr-resume/latex/browser/build-gallery-archives.mjs
//
// Every AltaCV source/config file (LPPL 1.3c) is copied byte-for-byte. The three
// sample icons in upstream (Smashing Magazine "Nice Things" set) may not be
// re-offered for download from other sites, so they are replaced by original
// placeholder images of the same names and sizes class, and a NOTICE says so.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import JSZip from 'jszip'
import sharp from 'sharp'

const here = path.dirname(fileURLToPath(import.meta.url))
const upstream = path.resolve(here, '../../../../../Mr.Resume/AltaCV_Template.zip')
const output = path.resolve(here, '../../../../public/mr-resume/templates/latex/altacv-v1.7.4-smilepdf.zip')
const UPSTREAM_SHA256 = 'a4cfbd5be6521ee6a6854bc4dd702e70951bb2529f18ead4d24406454f02a1c3'
const replacedIcons = ['Globe_High.png', 'Suitcase_High.png', 'Yacht_High.png']
const fixedDate = new Date('2026-11-06T00:00:00Z')

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function placeholder(label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#e3e7df"/>
  <circle cx="256" cy="200" r="86" fill="#aab3a3"/>
  <path d="M96 450c18-92 86-142 160-142s142 50 160 142z" fill="#aab3a3"/>
  <text x="256" y="490" font-family="sans-serif" font-size="30" text-anchor="middle" fill="#56604f">${label}</text>
</svg>`
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
}

const archive = await readFile(upstream)
if (sha(archive) !== UPSTREAM_SHA256) throw new Error('The pinned upstream AltaCV archive changed; review it before rebuilding.')
const source = await JSZip.loadAsync(archive)
const zip = new JSZip()
for (const entry of Object.values(source.files).sort((a, b) => a.name.localeCompare(b.name))) {
  if (entry.dir) continue
  const bytes = replacedIcons.includes(entry.name) ? await placeholder('Replace with your image') : await entry.async('uint8array')
  zip.file(entry.name, bytes, { date: fixedDate, createFolders: false })
}
zip.file('NOTICE-SmilePDF.txt', [
  'AltaCV v1.7.4 by LianTze Lim, distributed under the LaTeX Project Public License 1.3c (see LICENSE.md).',
  'altacv.cls, sample.tex, sample.bib, pubs-*.tex, latexmkrc, README.md and CHANGELOG.md are unchanged upstream files.',
  `The sample images ${replacedIcons.join(', ')} were replaced by SmilePDF placeholder images,`,
  'because the original "Nice Things" icons may not be offered for download outside SmashingMagazine.com.',
  'Upstream: https://github.com/liantze/AltaCV',
  '',
].join('\n'), { date: fixedDate })
const bytes = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 9 }, platform: 'UNIX' })
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, bytes)
console.log(`${path.basename(output)} ${bytes.length} bytes sha256 ${sha(bytes)}`)
