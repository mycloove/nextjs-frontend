import assert from 'node:assert/strict'
import test from 'node:test'
import { mayAutoCompile, newerProof, recoverableCompileFailure } from './compilePolicy.ts'
import type { LatexProof } from './types.ts'

test('Auto Compile requires explicit opt-in, active workspace, network, readiness and expired fair-use cooldown', () => {
  const policy = { enabled: true, active: true, online: true, ready: true, retryAt: 100 }
  assert.equal(mayAutoCompile(policy, 100), true)
  for (const field of ['enabled', 'active', 'online', 'ready']) assert.equal(mayAutoCompile({ ...policy, [field]: false }, 100), false)
  assert.equal(mayAutoCompile(policy, 99), false)
})

test('local Auto Compile is opt-in and ready-gated, but offline cached assets do not require a server connection', () => {
  const policy = { enabled: true, active: true, online: false, ready: true, retryAt: 0, runtime: 'browser' as const }
  assert.equal(mayAutoCompile(policy, 1), true)
  assert.equal(mayAutoCompile({ ...policy, enabled: false }, 1), false)
  assert.equal(mayAutoCompile({ ...policy, active: false }, 1), false)
  assert.equal(mayAutoCompile({ ...policy, ready: false }, 1), false)
  assert.equal(mayAutoCompile({ ...policy, runtime: 'native' }, 1), false)
})

test('a late older artifact cannot replace a newer last-good proof', () => {
  const good = { projectId: 'project', revision: 5 } as LatexProof, late = { projectId: 'project', revision: 3 } as LatexProof
  assert.equal(newerProof(good, late), false)
  assert.equal(newerProof(good, { ...good, revision: 6 }), true)
  assert.equal(newerProof(undefined, late), true)
})

test('disconnect/abort/deadline require explicit operation recovery; deterministic TeX errors do not auto-retry', () => {
  for (const code of ['transport_unavailable', 'upstream_unavailable', 'upstream_timeout', 'request_aborted', 'operation_running']) assert.equal(recoverableCompileFailure(code), true)
  assert.equal(recoverableCompileFailure('upstream_protocol_error', 502), true)
  for (const code of ['tex_error', 'invalid_manifest', 'missing_font', 'unsupported_package', 'fair_use_limit', 'compiler_disabled', 'browser_compile_cancelled', 'browser_loading_timeout', 'browser_compiling_timeout', 'browser_worker_failed', 'browser_pdf_invalid']) assert.equal(recoverableCompileFailure(code, 422), false)
})

test('known cancelled/failed/missing recovery outcomes are terminal, while a running 409 remains recoverable', () => {
  assert.equal(recoverableCompileFailure('operation_running', 409), true)
  for (const [code, status] of [['operation_cancelled', 409], ['operation_failed', 422], ['operation_not_found', 404], ['operation_not_found', 410]] as const) {
    assert.equal(recoverableCompileFailure(code, status), false)
  }
  assert.equal(recoverableCompileFailure('upstream_protocol_error', 502), true, 'Unknown network/protocol outcomes cannot claim server cancellation')
  assert.equal(mayAutoCompile({ enabled: false, active: true, online: true, ready: true, retryAt: 0 }, Number.MAX_SAFE_INTEGER), false, 'Restoration/recovery cannot opt into Auto Compile')
})
