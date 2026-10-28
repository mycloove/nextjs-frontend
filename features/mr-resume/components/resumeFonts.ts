const googleFontsRoot = 'https://raw.githubusercontent.com/google/fonts/e7db6ca603fd4862010383ff17ffd6cc4ffac1c0/ofl'
const sample = '\u09b6\u09bf\u0995\u09cd\u09b7\u09be \u0993 \u0995\u09b0\u09cd\u09ae-\u0985\u09ad\u09bf\u099c\u09cd\u099e\u09a4\u09be / Aa 0123'

// Each complete TTF includes its own Latin companion. The aliases are CSS-only;
// unmodified font binaries retain their public family names for local TeX use.
export const bengaliTypefaces = [
  {
    name: 'Hind Siliguri',
    family: '"Mr Resume Hind Siliguri", "Noto Sans Bengali", sans-serif',
    texFamily: 'Hind Siliguri',
    sample,
    scripts: 'bengali-latin',
  },
  {
    name: 'Noto Serif Bengali',
    family: '"Mr Resume Noto Serif Bengali", "Noto Sans Bengali", Georgia, serif',
    texFamily: 'Noto Serif Bengali',
    sample,
    scripts: 'bengali-latin',
  },
  {
    name: 'Tiro Bangla',
    family: '"Mr Resume Tiro Bangla", "Noto Sans Bengali", Georgia, serif',
    texFamily: 'Tiro Bangla',
    sample,
    scripts: 'bengali-latin',
  },
  {
    name: 'Baloo Da 2',
    family: '"Mr Resume Baloo Da 2", "Noto Sans Bengali", sans-serif',
    texFamily: 'Baloo Da 2',
    sample,
    scripts: 'bengali-latin',
  },
  {
    name: 'Anek Bangla',
    family: '"Mr Resume Anek Bangla", "Noto Sans Bengali", sans-serif',
    texFamily: 'Anek Bangla',
    sample,
    scripts: 'bengali-latin',
  },
] as const

// Paths are relative to this module, not /public; resumeFonts.css lets webpack
// bundle them. Weight strings match real OS/2 or fvar metadata, not synthetic cuts.
// `kind` splits the two packs the tests verify side by side: the Bengali web
// pack (SIL OFL, google/fonts pins) and the Latin Modern cuts (GUST font license,
// latin-modern-web pins) behind the LaTeX-look template.
export const resumeFontAssets = [
  {
    family: 'Hind Siliguri',
    kind: 'bengali',
    path: './fonts/hind-siliguri/HindSiliguri-Regular.ttf',
    weight: '400',
    style: 'normal',
    source: `${googleFontsRoot}/hindsiliguri/HindSiliguri-Regular.ttf`,
    licensePath: './fonts/hind-siliguri/OFL.txt',
  },
  {
    family: 'Hind Siliguri',
    kind: 'bengali',
    path: './fonts/hind-siliguri/HindSiliguri-Bold.ttf',
    weight: '700',
    style: 'normal',
    source: `${googleFontsRoot}/hindsiliguri/HindSiliguri-Bold.ttf`,
    licensePath: './fonts/hind-siliguri/OFL.txt',
  },
  {
    family: 'Noto Serif Bengali',
    kind: 'bengali',
    path: './fonts/noto-serif-bengali/NotoSerifBengali-Variable.ttf',
    weight: '100 900',
    style: 'normal',
    source: `${googleFontsRoot}/notoserifbengali/NotoSerifBengali%5Bwdth%2Cwght%5D.ttf`,
    licensePath: './fonts/noto-serif-bengali/OFL.txt',
  },
  {
    family: 'Tiro Bangla',
    kind: 'bengali',
    path: './fonts/tiro-bangla/TiroBangla-Regular.ttf',
    weight: '400',
    style: 'normal',
    source: `${googleFontsRoot}/tirobangla/TiroBangla-Regular.ttf`,
    licensePath: './fonts/tiro-bangla/OFL.txt',
  },
  {
    family: 'Tiro Bangla',
    kind: 'bengali',
    path: './fonts/tiro-bangla/TiroBangla-Italic.ttf',
    weight: '400',
    style: 'italic',
    source: `${googleFontsRoot}/tirobangla/TiroBangla-Italic.ttf`,
    licensePath: './fonts/tiro-bangla/OFL.txt',
  },
  {
    family: 'Baloo Da 2',
    kind: 'bengali',
    path: './fonts/baloo-da-2/BalooDa2-Variable.ttf',
    weight: '400 800',
    style: 'normal',
    source: `${googleFontsRoot}/balooda2/BalooDa2%5Bwght%5D.ttf`,
    licensePath: './fonts/baloo-da-2/OFL.txt',
  },
  {
    family: 'Anek Bangla',
    kind: 'bengali',
    path: './fonts/anek-bangla/AnekBangla-Variable.ttf',
    weight: '100 800',
    style: 'normal',
    source: `${googleFontsRoot}/anekbangla/AnekBangla%5Bwdth%2Cwght%5D.ttf`,
    licensePath: './fonts/anek-bangla/OFL.txt',
  },
  // The four Latin Modern text cuts behind the LaTeX-look template: the exact
  // family TeX sets by default, rebuilt for the web by the lmweb project.
  {
    family: 'Latin Modern',
    kind: 'latin',
    path: './fonts/latin-modern/LatinModern-Regular.ttf',
    weight: '400',
    style: 'normal',
    source: 'https://raw.githubusercontent.com/sugina-dev/latin-modern-web/master/font/lmroman-regular-webfont.ttf',
    licensePath: './fonts/latin-modern/LICENSE.txt',
  },
  {
    family: 'Latin Modern',
    kind: 'latin',
    path: './fonts/latin-modern/LatinModern-Bold.ttf',
    weight: '700',
    style: 'normal',
    source: 'https://raw.githubusercontent.com/sugina-dev/latin-modern-web/master/font/lmroman-bold-webfont.ttf',
    licensePath: './fonts/latin-modern/LICENSE.txt',
  },
  {
    family: 'Latin Modern',
    kind: 'latin',
    path: './fonts/latin-modern/LatinModern-Italic.ttf',
    weight: '400',
    style: 'italic',
    source: 'https://raw.githubusercontent.com/sugina-dev/latin-modern-web/master/font/lmroman-italic-webfont.ttf',
    licensePath: './fonts/latin-modern/LICENSE.txt',
  },
  {
    family: 'Latin Modern',
    kind: 'latin',
    path: './fonts/latin-modern/LatinModern-BoldItalic.ttf',
    weight: '700',
    style: 'italic',
    source: 'https://raw.githubusercontent.com/sugina-dev/latin-modern-web/master/font/lmroman-bolditalic-webfont.ttf',
    licensePath: './fonts/latin-modern/LICENSE.txt',
  },
] as const

// Upstream METADATA.pb supplies designer/font notices. Each adjacent OFL.txt is
// the complete upstream license, including its original copyright notice.
export const resumeFontAttributions = [
  {
    family: 'Hind Siliguri',
    designer: 'Indian Type Foundry',
    copyright: 'Copyright (c) 2015 Indian Type Foundry (info@indiantypefoundry.com)',
    licenseCopyright: 'Copyright (c) 2015 Indian Type Foundry (info@indiantypefoundry.com)',
    license: 'OFL-1.1',
    source: 'https://github.com/itfoundry/hind-siliguri',
    metadataSource: `${googleFontsRoot}/hindsiliguri/METADATA.pb`,
    licenseSource: `${googleFontsRoot}/hindsiliguri/OFL.txt`,
    licensePath: './fonts/hind-siliguri/OFL.txt',
  },
  {
    family: 'Noto Serif Bengali',
    designer: 'Google',
    copyright: 'Copyright 2025 The Noto Project Authors (https://github.com/notofonts/bengali)',
    licenseCopyright: 'Copyright 2022 The Noto Project Authors (https://github.com/notofonts/bengali)',
    license: 'OFL-1.1',
    source: 'https://github.com/notofonts/bengali',
    metadataSource: `${googleFontsRoot}/notoserifbengali/METADATA.pb`,
    licenseSource: `${googleFontsRoot}/notoserifbengali/OFL.txt`,
    licensePath: './fonts/noto-serif-bengali/OFL.txt',
  },
  {
    family: 'Tiro Bangla',
    designer: 'Tiro Typeworks, John Hudson, Fiona Ross, Neelakash Kshetrimayum',
    copyright: 'Copyright 2020 The Indigo Project Authors (https://github.com/TiroTypeworks/Indigo)',
    licenseCopyright: 'Copyright 2020 The Indigo Project Authors (https://github.com/TiroTypeworks/Indigo)',
    license: 'OFL-1.1',
    source: 'https://github.com/TiroTypeworks/Indigo',
    metadataSource: `${googleFontsRoot}/tirobangla/METADATA.pb`,
    licenseSource: `${googleFontsRoot}/tirobangla/OFL.txt`,
    licensePath: './fonts/tiro-bangla/OFL.txt',
  },
  {
    family: 'Baloo Da 2',
    designer: 'Ek Type',
    copyright: 'Copyright 2019 The Baloo 2 Project Authors (https://github.com/EkType/Baloo2)',
    licenseCopyright: 'Copyright 2019 The Baloo 2 Project Authors (https://github.com/EkType/Baloo2)',
    license: 'OFL-1.1',
    source: 'https://github.com/yanone/Baloo2-Variable',
    metadataSource: `${googleFontsRoot}/balooda2/METADATA.pb`,
    licenseSource: `${googleFontsRoot}/balooda2/OFL.txt`,
    licensePath: './fonts/baloo-da-2/OFL.txt',
  },
  {
    family: 'Anek Bangla',
    designer: 'Ek Type',
    copyright: 'Copyright 2021 The Anek Project Authors (https://github.com/EkType/Anek)',
    licenseCopyright: 'Copyright 2021 The Anek Project Authors (https://github.com/EkType/Anek)',
    license: 'OFL-1.1',
    source: 'https://github.com/EkType/Anek',
    metadataSource: `${googleFontsRoot}/anekbangla/METADATA.pb`,
    licenseSource: `${googleFontsRoot}/anekbangla/OFL.txt`,
    licensePath: './fonts/anek-bangla/OFL.txt',
  },
  // Latin Modern: by GUST's e-foundry on behalf of the TeX users groups, under
  // the GUST Font License. Carried through the lmweb web builds (no OFL/META
  // sidecar exists upstream, so the license pointer carries the pin).
  {
    family: 'Latin Modern',
    designer: 'Bogus\u0142aw Jackowski, Janusz M. Nowacki (GUST e-foundry)',
    copyright: 'Copyright 2003, 2008 B. Jackowski and J. M. Nowacki (on behalf of TeX users groups)',
    licenseCopyright: '% This is version 1.0, dated 22 June 2009, of the GUST Font License.',
    license: 'GFL',
    source: 'https://github.com/sugina-dev/latin-modern-web',
    licenseSource: 'https://raw.githubusercontent.com/sugina-dev/latin-modern-web/master/licenses/GUST-FONT-LICENSE.txt',
    metadataSource: '',
    licensePath: './fonts/latin-modern/LICENSE.txt',
  },
] as const

// A Latin-only serif for the LaTeX-look template: Latin Modern, the family TeX
// itself sets. The web builds report the internal family "LM Roman 10"; the
// public LaTeX family remains "Latin Modern Roman" (see texFamily), so compiled
// output on any TeX install with lmodern baked in agrees with the paper. The
// specimen line stays Latin — Bengali writing falls through to the fallback
// face without swapping the chosen one.
const latinSample = 'Curriculum vitae / Aa 0123'

export const latinTypefaces = [
  {
    name: 'Latin Modern',
    family: '"Mr Resume Latin Modern", "Noto Sans Bengali", Georgia, serif',
    texFamily: 'Latin Modern Roman',
    sample: latinSample,
    scripts: 'latin-bengali-fallback',
  },
] as const

export function getBengaliTexFamily(font: string): string {
  return bengaliTypefaces.find((typeface) => typeface.name === font)?.texFamily ?? 'Noto Sans Bengali'
}
