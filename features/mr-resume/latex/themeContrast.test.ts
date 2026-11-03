import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function luminance(hex: string) {
  const channels = [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722
}
function ratio(a: string, b: string) { const light = luminance(a), dark = luminance(b); return (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05) }
const css = readFileSync(new URL('../components/MrResumeTheme.module.css', import.meta.url), 'utf8')
const blocks = [...css.matchAll(/\.theme\s*\{([^}]+)\}/gu)].map((match) => Object.fromEntries([...match[1].matchAll(/(--rs-[a-z-]+):\s*(#[0-9a-f]{6})/gu)].map((item) => [item[1], item[2]])))

test('existing exact MR palette provides accessible LaTeX text, syntax/status and focus roles in both themes', () => {
  assert.equal(blocks.length, 2)
  const light = blocks[0], themes = [light, { ...light, ...blocks[1] }]
  for (const [index, tokens] of themes.entries()) {
    for (const text of ['--rs-ink', '--rs-accent']) for (const background of ['--rs-panel', '--rs-soft', '--rs-accent-soft']) {
      const contrast = ratio(tokens[text], tokens[background])
      assert.ok(contrast >= 4.5, `${index ? 'dark' : 'light'} ${text} on ${background}: ${contrast.toFixed(2)}:1`)
    }
    assert.ok(ratio(tokens['--rs-muted'], tokens['--rs-panel']) >= 4.5)
    for (const status of ['--rs-gold', '--rs-danger', '--rs-success']) assert.ok(ratio(tokens[status], tokens['--rs-panel']) >= 4.5)
    assert.ok(ratio(tokens['--rs-on-primary'], tokens['--rs-primary']) >= 4.5)
    assert.ok(ratio(tokens['--rs-focus'], tokens['--rs-panel']) >= 3)
    assert.ok(ratio(tokens['--rs-control-line'], tokens['--rs-raised']) >= 3)
    assert.ok(ratio(tokens['--rs-accent'], tokens['--rs-line']) >= 3, 'Engine-byte progress remains distinguishable from its track')
  }
  const applicationCss = readFileSync(new URL('./LatexResumeStudio.module.css', import.meta.url), 'utf8')
  // The current compact header uses a semantic muted role, not a fixed ink color.
  // Verify its actual role against both header themes instead of pinning a stale CSS spelling.
  const saveColor = /\.saveState\s*\{[^}]*color: var\((--rs-[a-z-]+)\)/u.exec(applicationCss)?.[1]
  assert.ok(saveColor)
  for (const tokens of themes) assert.ok(ratio(tokens[saveColor], tokens['--rs-panel']) >= 4.5)
  assert.match(applicationCss, /\.cm-activeLine\)\s*\{[^}]*background: var\(--rs-raised\)/u)
  assert.match(applicationCss, /\.sourceRegistration\s*\{[^}]*background: var\(--rs-raised\)/u)
  assert.match(applicationCss, /\.engineBytes\s*\{[^}]*color: var\(--rs-muted\)/u)
  assert.match(applicationCss, /\.localWorkspaceBody:focus-visible\s*\{[^}]*outline-offset: -2px/u)
})
