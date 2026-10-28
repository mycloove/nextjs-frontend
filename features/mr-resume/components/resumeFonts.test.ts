import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import type { Font } from '@pdf-lib/fontkit'
import { bengaliTypefaces, getBengaliTexFamily, latinTypefaces, resumeFontAssets, resumeFontAttributions } from './resumeFonts.ts'

const { create } = createRequire(import.meta.url)('@pdf-lib/fontkit') as typeof import('@pdf-lib/fontkit')

// fontkit exposes these decoded tables/axes at runtime but omits them from its
// declarations. No dependency on another feature's font helpers is needed.
type LayoutTable = {
  scriptList: { tag: string; script: { defaultLangSys: { featureIndexes: number[] } } }[]
  featureList: { tag: string; feature: { lookupListIndexes: number[] } }[]
  lookupList: { length: number }
}
type InspectedFont = Font & {
  directory: { tables: Record<string, { offset: number; length: number }> }
  name: { records: { preferredFamily?: { en: string }; license: { en: string } } }
  'OS/2': { usWeightClass: number; fsSelection: { italic: boolean; bold: boolean } }
  variationAxes: Record<string, { min: number; max: number; default: number }>
  GSUB: LayoutTable
  GPOS: LayoutTable
}

// Blob IDs and sizes were checked against the pinned google/fonts Contents API.
// Tests are entirely offline; replacement/subset/HTML bodies cannot pass a pin.
const fontFixtures = {
  './fonts/hind-siliguri/HindSiliguri-Regular.ttf': { size: 250052, blob: '21f6ec51cace61d40644d275e66b6a82f57906a3' },
  './fonts/hind-siliguri/HindSiliguri-Bold.ttf': { size: 287660, blob: '47992e9ff250f13d36f29746e350af28118e39b7' },
  './fonts/noto-serif-bengali/NotoSerifBengali-Variable.ttf': { size: 981812, blob: '1a9275d5aa3edff2070a333a033041ae4eaa26df' },
  './fonts/tiro-bangla/TiroBangla-Regular.ttf': { size: 323776, blob: '9434b8102c5b1c8ecc6569c757ad56baddcaa552' },
  './fonts/tiro-bangla/TiroBangla-Italic.ttf': { size: 329576, blob: 'c2466570970f965d48e8b182515a0df4ceeaa975' },
  './fonts/baloo-da-2/BalooDa2-Variable.ttf': { size: 451504, blob: '2a4e952b1c9d98dd814f22b919f36742df446ce8' },
  './fonts/anek-bangla/AnekBangla-Variable.ttf': { size: 1344456, blob: '224259ac45975122d77ecc5f8d0d59f6c3479c78' },
  // The Latin Modern web cuts are pinned to the lmweb upstream commit, not the
  // google/fonts pack; the git blob scheme works identically on those raw bytes.
  './fonts/latin-modern/LatinModern-Regular.ttf': { size: 67252, blob: '34290f884065731299d5bea722d6f71570ab5dac' },
  './fonts/latin-modern/LatinModern-Bold.ttf': { size: 53120, blob: '5966e9d92805171dd896475c4a8cee1245f7681f' },
  './fonts/latin-modern/LatinModern-Italic.ttf': { size: 81320, blob: '58f9e2aa09c6f05d0c34655d7341128885c20620' },
  './fonts/latin-modern/LatinModern-BoldItalic.ttf': { size: 73664, blob: 'a5f2f3baedf54c0d1cc08e86a423a94b9ee42d88' },
} satisfies Record<(typeof resumeFontAssets)[number]['path'], { size: number; blob: string }>

const licenseBlobs = {
  'Hind Siliguri': 'ccd22d7afee4a45d0007489e9232ed51fb3c3f4a',
  'Noto Serif Bengali': 'd11cac69316ec3d80e5aff86e4a2dba4114cca2b',
  'Tiro Bangla': '9acb0fd8b8e54a98007113da015d33419180ca05',
  'Baloo Da 2': '72adb492d4f0ede2a9dbdefed607f33ad3a6fc68',
  'Anek Bangla': '6e46064f855d1d252f1f7d61e7dd1d5a07d409bf',
  // GUST Font License 1.0 as carried beside the Latin Modern cuts.
  'Latin Modern': '604bf7597db741c93073e937ceb2afd18458201d',
} as const

const ascii = Array.from({ length: 95 }, (_, index) => String.fromCodePoint(0x20 + index)).join('')
const bengali = '\u0981\u0982\u0983\u0985\u0986\u0987\u0988\u0989\u098a\u098b\u098f\u0990\u0993\u0994'
  + '\u0995\u0996\u0997\u0998\u0999\u099a\u099b\u099c\u099d\u099e\u099f\u09a0\u09a1\u09a2\u09a3\u09a4\u09a5\u09a6\u09a7\u09a8\u09aa\u09ab\u09ac\u09ad\u09ae\u09af\u09b0\u09b2\u09b6\u09b7\u09b8\u09b9'
  + '\u09bc\u09be\u09bf\u09c0\u09c1\u09c2\u09c3\u09c7\u09c8\u09cb\u09cc\u09cd\u09ce\u09dc\u09dd\u09df'
  + '\u09e6\u09e7\u09e8\u09e9\u09ea\u09eb\u09ec\u09ed\u09ee\u09ef\u09f3\u0964\u0965'
const conjuncts = '\u0995\u09cd\u09b7 \u099c\u09cd\u099e \u09b6\u09cd\u09b0 \u09b8\u09cd\u09a4\u09cd\u09b0 \u09b0\u09cd\u0995 \u0995\u09bf \u0995\u09c1 \u0995\u09c3 \u0995\u09cb \u0995\u09cc'
const punctuation = '\u00b7\u2013\u2014\u2018\u2019\u201c\u201d\u2022\u2026'

function gitBlobSha(bytes: Uint8Array): string {
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

test('registry exposes five public Bengali/Latin families with private CSS aliases', () => {
  assert.deepEqual(bengaliTypefaces.map((typeface) => typeface.name), [
    'Hind Siliguri', 'Noto Serif Bengali', 'Tiro Bangla', 'Baloo Da 2', 'Anek Bangla',
  ])
  for (const typeface of bengaliTypefaces) {
    assert.equal(typeface.scripts, 'bengali-latin')
    assert.equal(typeface.texFamily, typeface.name)
    assert.ok(typeface.family.startsWith(`"Mr Resume ${typeface.name}", "Noto Sans Bengali", `))
    assert.match(typeface.family, /(?:sans-serif|serif)$/)
    assert.match(typeface.sample, /[\u0980-\u09ff]/u)
    assert.match(typeface.sample, /Aa 0123/)
    assert.ok(resumeFontAssets.some((asset) => asset.family === typeface.name))
    assert.ok(resumeFontAttributions.some((attribution) => attribution.family === typeface.name))
  }
})

test('Latin Modern rides alongside as a complete Latin serif with the Bengali fallback', () => {
  assert.deepEqual(latinTypefaces.map((typeface) => typeface.name), ['Latin Modern'])
  for (const typeface of latinTypefaces) {
    assert.equal(typeface.texFamily, 'Latin Modern Roman')
    assert.ok(typeface.family.includes('"Mr Resume Latin Modern"'))
    assert.ok(typeface.family.includes('"Noto Sans Bengali"'), 'Bengali writing falls through, never painted from two systems')
    assert.match(typeface.family, /serif$/)
    assert.match(typeface.sample, /Aa 0123/)
    assert.doesNotMatch(typeface.sample, /[\u0980-\u09ff]/u, 'The Latin specimen speaks Latin; Bengali falls through the stack')
    assert.ok(resumeFontAssets.some((asset) => asset.family === typeface.name))
    assert.ok(resumeFontAttributions.some((attribution) => attribution.family === typeface.name))
  }
})

test('pack contains only module-local font binaries without duplicate cuts', () => {
  assert.equal(resumeFontAssets.length, 11)
  assert.equal(new Set(resumeFontAssets.map((asset) => asset.path)).size, 11)
  const installed = readdirSync(new URL('./fonts/', import.meta.url), { recursive: true, encoding: 'utf8' })
    .filter((path) => /\.(?:ttf|otf|woff2?)$/i.test(path))
    .map((path) => `./fonts/${path.replaceAll('\\', '/')}`)
    .sort()
  assert.deepEqual(installed, resumeFontAssets.map((asset) => asset.path).sort())
  assert.deepEqual(resumeFontAssets.filter((asset) => asset.family === 'Tiro Bangla').map((asset) => [asset.weight, asset.style]), [
    ['400', 'normal'], ['400', 'italic'],
  ])
})

for (const asset of resumeFontAssets.filter((entry) => entry.kind === 'bengali')) {
  test(`${asset.family} ${asset.weight} ${asset.style}: authentic TTF, glyphs, shaping tables and metadata`, () => {
    assert.match(asset.path, /^\.\/fonts\/[a-z0-9-]+\/[A-Za-z0-9-]+\.ttf$/)
    assert.match(asset.source, /^https:\/\/raw\.githubusercontent\.com\/google\/fonts\/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0\/ofl\/.+\.ttf$/)
    const bytes = readFileSync(new URL(asset.path, import.meta.url))
    assert.ok(bytes.length > 100000, 'Not a complete font binary')
    assert.equal(bytes.length, fontFixtures[asset.path].size)
    assert.equal(bytes.readUInt32BE(0), 0x00010000, 'Expected TrueType SFNT header, not an HTML response')
    assert.equal(gitBlobSha(bytes), fontFixtures[asset.path].blob, 'Font differs from the pinned upstream binary')

    const font = create(bytes) as InspectedFont
    const typeface = bengaliTypefaces.find((entry) => entry.name === asset.family)!
    const attribution = resumeFontAttributions.find((entry) => entry.family === asset.family)!
    assert.equal(font.name.records.preferredFamily?.en ?? font.familyName, typeface.texFamily)
    assert.equal(font.copyright, attribution.copyright)
    assert.equal(asset.licensePath, attribution.licensePath)
    assert.match(font.name.records.license.en, /SIL Open Font License, Version 1\.1/)
    assert.ok(font.numGlyphs > 500 && font.characterSet.length > 300)

    const cmap = new Set(font.characterSet)
    for (const character of new Set(ascii + bengali + conjuncts + punctuation + typeface.sample)) {
      const codePoint = character.codePointAt(0)!
      const label = `Missing glyph U+${codePoint.toString(16).toUpperCase()}`
      assert.ok(cmap.has(codePoint), label)
      assert.ok(font.hasGlyphForCodePoint(codePoint), label)
      assert.notEqual(font.glyphForCodePoint(codePoint).id, 0, label)
    }
    for (const codePoint of [0x0995, 0x0041, 0x0030]) {
      assert.ok(font.glyphForCodePoint(codePoint).path.toSVG().length > 20, 'Expected real Bengali/Latin outlines')
    }

    const headerSize = 12 + bytes.readUInt16BE(4) * 16
    for (const tag of ['head', 'OS/2', 'name', 'cmap', 'glyf', 'GDEF', 'GSUB', 'GPOS']) {
      const table = font.directory.tables[tag]
      assert.ok(table?.length > 0, `Missing ${tag} table`)
      assert.ok(table.offset >= headerSize && table.offset + table.length <= bytes.length, `Invalid ${tag} table bounds`)
    }
    // fontkit 1.1.1 layout() can loop on Tiro lookups. This browser font pack
    // verifies real shaping tables, not compatibility with that PDF shaper.
    for (const [table, requiredFeatures] of [[font.GSUB, ['akhn', 'rphf', 'blwf', 'nukt', 'pstf']], [font.GPOS, ['abvm', 'blwm']]] as const) {
      const script = table.scriptList.find((entry) => entry.tag === 'bng2')
      assert.ok(script, 'Missing Bengali shaping script')
      const features = script.script.defaultLangSys.featureIndexes.map((index) => table.featureList[index])
      for (const tag of requiredFeatures) {
        const feature = features.find((entry) => entry?.tag === tag)
        assert.ok(feature, `Missing Bengali shaping feature ${tag}`)
        assert.ok(feature.feature.lookupListIndexes.length > 0)
        assert.ok(feature.feature.lookupListIndexes.every((index) => index >= 0 && index < table.lookupList.length))
      }
    }

    assert.equal(font['OS/2'].fsSelection.italic, asset.style === 'italic')
    assert.equal(font.italicAngle !== 0, asset.style === 'italic')
    const weights = asset.weight.split(' ').map(Number)
    if (weights.length === 2) {
      assert.ok(font.directory.tables.fvar && font.directory.tables.gvar, 'Expected genuine variable font tables')
      assert.deepEqual([font.variationAxes.wght.min, font.variationAxes.wght.max], weights)
      assert.equal(font['OS/2'].usWeightClass, font.variationAxes.wght.default)
      if (asset.family === 'Noto Serif Bengali') assert.deepEqual(font.variationAxes.wdth, { name: 'Width', min: 62.5, default: 100, max: 100 })
      if (asset.family === 'Anek Bangla') assert.deepEqual(font.variationAxes.wdth, { name: 'Width', min: 75, default: 100, max: 125 })
    } else {
      assert.deepEqual(font.variationAxes, {})
      assert.equal(font['OS/2'].usWeightClass, weights[0])
      assert.equal(font['OS/2'].fsSelection.bold, weights[0] === 700)
    }
  })
}

// The Latin Modern pack: same honesty, a different upstream. Only the
// claims each web cut actually carries — full table set, pinned bytes,
// genuine weight/style axes and Latin+punctuation coverage — are on record.
for (const asset of resumeFontAssets.filter((entry) => entry.kind === 'latin')) {
  test(`${asset.family} ${asset.weight} ${asset.style}: authentic Latin Modern cut with pinned lmweb bytes`, () => {
    assert.match(asset.path, /^\.\/fonts\/latin-modern\/[A-Za-z0-9-]+\.ttf$/)
    assert.match(asset.source, /^https:\/\/raw\.githubusercontent\.com\/sugina-dev\/latin-modern-web\/master\/font\/.+\.ttf$/)
    const bytes = readFileSync(new URL(asset.path, import.meta.url))
    assert.ok(bytes.length > 10000, 'Not a complete font binary')
    assert.equal(bytes.length, fontFixtures[asset.path].size)
    assert.equal(bytes.readUInt32BE(0), 0x00010000, 'Expected TrueType SFNT header, not an HTML response')
    assert.equal(gitBlobSha(bytes), fontFixtures[asset.path].blob, 'Font differs from the pinned upstream binary')

    const font = create(bytes) as InspectedFont
    const attribution = resumeFontAttributions.find((entry) => entry.family === asset.family)!
    const typeface = latinTypefaces.find((entry) => entry.name === asset.family)!
    assert.equal(font.name.records.preferredFamily?.en, 'Latin Modern Roman')
    assert.ok((font.copyright ?? '').startsWith(attribution.copyright))
    assert.equal(asset.licensePath, attribution.licensePath)
    assert.ok(font.numGlyphs > 200 && font.characterSet.length > 200)

    const cmap = new Set(font.characterSet)
    for (const character of new Set(ascii + punctuation + typeface.sample)) {
      const codePoint = character.codePointAt(0)!
      const label = `Missing glyph U+${codePoint.toString(16).toUpperCase()}`
      assert.ok(cmap.has(codePoint), label)
      assert.ok(font.hasGlyphForCodePoint(codePoint), label)
      assert.notEqual(font.glyphForCodePoint(codePoint).id, 0, label)
    }
    for (const codePoint of [0x0041, 0x0030]) {
      assert.ok(font.glyphForCodePoint(codePoint).path.toSVG().length > 20, 'Expected real Latin outlines')
    }

    const headerSize = 12 + bytes.readUInt16BE(4) * 16
    for (const tag of ['head', 'OS/2', 'name', 'cmap', 'glyf', 'GDEF', 'GSUB', 'GPOS']) {
      const table = font.directory.tables[tag]
      assert.ok(table?.length > 0, `Missing ${tag} table`)
      assert.ok(table.offset >= headerSize && table.offset + table.length <= bytes.length, `Invalid ${tag} table bounds`)
    }

    assert.equal(font['OS/2'].fsSelection.italic, asset.style === 'italic')
    assert.equal(font.italicAngle !== 0, asset.style === 'italic')
    assert.deepEqual(font.variationAxes, {})
    assert.equal(font['OS/2'].usWeightClass, Number(asset.weight))
    assert.equal(font['OS/2'].fsSelection.bold, asset.weight === '700')
  })
}

for (const attribution of resumeFontAttributions.filter((entry) => entry.license === 'OFL-1.1')) {
  test(`${attribution.family}: complete upstream OFL notice and attribution`, () => {
    const text = readFileSync(new URL(attribution.licensePath, import.meta.url), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    const bytes = Buffer.from(text)
    // Windows checkouts can change line endings; Baloo/Anek upstream add a BOM.
    // Only those encodings vary: the entire license text must match upstream.
    assert.ok([bytes, Buffer.concat([Buffer.from('\uFEFF'), bytes])].some((candidate) => gitBlobSha(candidate) === licenseBlobs[attribution.family]), 'OFL text differs from the pinned upstream license')
    assert.ok(text.startsWith(`${attribution.licenseCopyright}\n`))
    assert.match(text, /SIL OPEN FONT LICENSE Version 1\.1 - 26 February 2007/)
    for (const section of ['PREAMBLE', 'DEFINITIONS', 'PERMISSION & CONDITIONS', 'TERMINATION', 'DISCLAIMER']) assert.ok(text.includes(section))
    assert.equal(attribution.license, 'OFL-1.1')
    assert.ok(attribution.designer.length > 0)
    assert.match(attribution.source, /^https:\/\/github\.com\//)
    assert.ok(attribution.metadataSource.length > 0, 'OFL packs pin an upstream METADATA.pb')
    assert.equal(attribution.licenseSource.replace(/OFL\.txt$/, 'METADATA.pb'), attribution.metadataSource)
  })
}

// The GUST carry: distributed under the GUST Font License (LPPL-based), so the
// notice records that license verbatim beside the cuts instead of forcing it
// through OFL wording.
for (const attribution of resumeFontAttributions.filter((entry) => entry.license === 'GFL')) {
  test(`${attribution.family}: complete GUST Font License carry`, () => {
    assert.equal(attribution.license, 'GFL')
    const text = readFileSync(new URL(attribution.licensePath, import.meta.url), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
    const bytes = Buffer.from(text)
    assert.ok([bytes, Buffer.concat([Buffer.from('\uFEFF'), bytes])].some((candidate) => gitBlobSha(candidate) === licenseBlobs[attribution.family]), 'License text differs from the pinned upstream license')
    assert.ok(text.startsWith(`${attribution.licenseCopyright}\n`))
    assert.match(text, /of the GUST Font License/)
    assert.match(text, /LaTeX Project Public License/)
  })
}

test('CSS contains only isolated self-hosted font faces with genuine weight/style ranges', () => {
  const css = readFileSync(new URL('./resumeFonts.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const faces: Record<string, string>[] = [...css.matchAll(/@font-face\s*\{([^}]+)\}/g)].map((match) => Object.fromEntries(
    match[1].split(';').filter((declaration) => declaration.trim()).map((declaration) => {
      const colon = declaration.indexOf(':')
      return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()]
    }),
  ))
  assert.equal(css.replace(/@font-face\s*\{[^}]+\}/g, '').trim(), '', 'No non-font selectors or imports allowed')
  assert.equal(faces.length, resumeFontAssets.length)
  for (const asset of resumeFontAssets) {
    const face = faces.find((entry) => entry.src === `url('${asset.path}') format('truetype')`)
    assert.ok(face, `Missing self-hosted CSS face for ${asset.path}`)
    assert.equal(face['font-family'], `'Mr Resume ${asset.family}'`)
    assert.equal(face['font-weight'], asset.weight)
    assert.equal(face['font-style'], asset.style)
    assert.equal(face['font-display'], 'swap')
    assert.equal(face['font-stretch'], asset.family === 'Noto Serif Bengali' ? '62.5% 100%' : asset.family === 'Anek Bangla' ? '75% 125%' : undefined)
  }
})

test('TeX selection uses installed public families, never private CSS aliases or unknown input', () => {
  for (const typeface of bengaliTypefaces) assert.equal(getBengaliTexFamily(typeface.name), typeface.texFamily)
  for (const font of ['Noto Sans Bengali', 'Inter', 'Latin Modern', 'Georgia', '', 'Unknown font', 'Tiro Bangla}\\input{bad}', 'Mr Resume Anek Bangla']) {
    assert.equal(getBengaliTexFamily(font), 'Noto Sans Bengali')
  }
})
