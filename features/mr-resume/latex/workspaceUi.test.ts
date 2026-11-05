import assert from 'node:assert/strict'
import test from 'node:test'
import { atOutputEnd, consoleHeight, DEFAULT_WORKSPACE_UI, LATEX_WORKSPACE_UI_KEY, readWorkspaceUi, visibleBuildLog, writeWorkspaceUi } from './workspaceUi.ts'

test('workspace preferences default closed and cannot break editing when storage is blocked', () => {
  for (const value of [null, '{', '{}', '{"version":2}', '[]']) assert.deepEqual(readWorkspaceUi({ getItem: () => value }), DEFAULT_WORKSPACE_UI)
  assert.deepEqual(readWorkspaceUi({ getItem: () => { throw new Error('blocked') } }), DEFAULT_WORKSPACE_UI)
  assert.doesNotThrow(() => writeWorkspaceUi({ setItem: () => { throw new Error('full') } }, DEFAULT_WORKSPACE_UI))
  let key = '', stored = ''
  writeWorkspaceUi({ setItem: (name, value) => { key = name; stored = value } }, { ...DEFAULT_WORKSPACE_UI, detailsOpen: true, drawer: 'output' })
  assert.equal(key, LATEX_WORKSPACE_UI_KEY)
  assert.equal(readWorkspaceUi({ getItem: () => stored }).drawer, 'output')
  assert.equal(readWorkspaceUi({ getItem: () => '{"version":1,"consoleHeight":9999,"drawer":"terminal"}' }).consoleHeight, 480)
})

test('build console is bounded below half the viewport and only follows users at the end', () => {
  assert.equal(consoleHeight(1000, 800), 360)
  assert.equal(consoleHeight(224, 240), 80)
  assert.equal(consoleHeight(-10, 800), 120)
  assert.equal(atOutputEnd(780, 1000, 200), true)
  assert.equal(atOutputEnd(500, 1000, 200), false)
})

test('output display filtering and clearing never mutate the canonical build log', () => {
  const log = Array.from({ length: 1000 }, (_, index) => `line ${index + 1}${index % 100 === 0 ? ' ERROR' : ''}`).join('\r\n')
  assert.equal(visibleBuildLog(log, '').lines.length, 600)
  assert.equal(visibleBuildLog(log, '').truncated, true)
  assert.equal(visibleBuildLog(log, 'error').total, 10)
  assert.equal(visibleBuildLog(log, '', 1000).total, 0)
  assert.equal(log.split('\r\n').length, 1000)
})
