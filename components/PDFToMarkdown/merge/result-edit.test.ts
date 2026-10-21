import assert from 'node:assert/strict'
import test from 'node:test'

import { resolveResultOutput } from './result-edit.ts'

test('no manual edit passes the generated result straight through', () => {
  const out = resolveResultOutput({ generated: '# A', edited: null, base: null })
  assert.equal(out.output, '# A')
  assert.equal(out.edited, false)
  assert.equal(out.stale, false)
})

test('a manual edit wins while the inputs are unchanged', () => {
  const out = resolveResultOutput({ generated: '# A', edited: '# A edited', base: '# A' })
  assert.equal(out.output, '# A edited')
  assert.equal(out.edited, true)
  assert.equal(out.stale, false)
})

test('an edit is flagged stale once the generated text moves on', () => {
  const out = resolveResultOutput({ generated: '# A v2', edited: '# A edited', base: '# A' })
  assert.equal(out.output, '# A edited')
  assert.equal(out.edited, true)
  assert.equal(out.stale, true)
})

test('an edited-empty result is still an overlay, not the generated text', () => {
  const out = resolveResultOutput({ generated: '# A', edited: '', base: '# A' })
  assert.equal(out.output, '')
  assert.equal(out.edited, true)
  assert.equal(out.stale, false)
})
