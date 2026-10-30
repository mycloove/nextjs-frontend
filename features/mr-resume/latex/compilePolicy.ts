import type { LatexProof } from './types.ts'

export function mayAutoCompile(policy: { enabled: boolean; active: boolean; online: boolean; ready: boolean; retryAt: number }, now = Date.now()) {
  return policy.enabled && policy.active && policy.online && policy.ready && now >= policy.retryAt
}

export function recoverableCompileFailure(code: string, status?: number) {
  return ['transport_unavailable', 'upstream_timeout', 'request_aborted', 'operation_running'].includes(code)
    || (status === 502 && code === 'upstream_protocol_error')
}

export function newerProof(previous: LatexProof | undefined, result: LatexProof) {
  return !previous || previous.projectId !== result.projectId || result.revision >= previous.revision
}
