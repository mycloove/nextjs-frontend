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

test('a late older artifact cannot replace a newer last-good proof', () => {
  const good = { projectId: 'project', revision: 5 } as LatexProof, late = { projectId: 'project', revision: 3 } as LatexProof
  assert.equal(newerProof(good, late), false)
  assert.equal(newerProof(good, { ...good, revision: 6 }), true)
  assert.equal(newerProof(undefined, late), true)
})

test('disconnect/abort/deadline require explicit operation recovery; deterministic TeX errors do not auto-retry', () => {
  for (const code of ['transport_unavailable', 'upstream_timeout', 'request_aborted', 'operation_running']) assert.equal(recoverableCompileFailure(code), true)
  assert.equal(recoverableCompileFailure('upstream_protocol_error', 502), true)
  for (const code of ['tex_error', 'invalid_manifest', 'missing_font', 'unsupported_package', 'fair_use_limit', 'compiler_disabled']) assert.equal(recoverableCompileFailure(code, 422), false)
})
