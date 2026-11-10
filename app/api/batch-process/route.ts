import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { beginToolQuota } from '@/lib/usage/quota'
import { microserviceFetch, microserviceUrl } from '@/lib/usage/internal'

/**
 * POST /api/batch-process — thin validating proxy (CLAUDE.md §5) to the Flask
 * engine at /batch-process (pdf-microservice/features/batch_processing.py).
 *
 * The previous handler charged before validating anything, had no timeout,
 * turned every failure into a 500 carrying the raw upstream body, and charged
 * a credit for an archive that held nothing but error notes. The engine now
 * answers a batch where nothing converted with 422 `batch_failed` and a
 * per-file `failures` list; that is passed through as-is and never charged.
 */

export const runtime = 'nodejs'

/** The Flask app's MAX_CONTENT_LENGTH. */
const DEFAULT_MAX_TOTAL_BYTES = 100 * 1024 * 1024
/** Mirrors BATCH_MAX_FILES in utils/task_executor.py. */
const DEFAULT_MAX_FILES = 30
// gunicorn ends a request at 300 s and the engine stops starting new files at
// 240 s; stop just short of gunicorn so the user hears from us.
const DEFAULT_TIMEOUT_MS = 290_000

/** Engine facts the UI reports. */
const PASS_THROUGH_HEADERS = ['X-Batch-Total', 'X-Batch-Succeeded', 'X-Batch-Failed']

class RequestValidationError extends Error {
  constructor(message: string, readonly code: string, readonly status = 400) {
    super(message)
    this.name = 'RequestValidationError'
  }
}

function positiveEnv(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function errorResponse(error: string, code: string, status: number, requestId: string) {
  return NextResponse.json(
    { error, code, request_id: requestId },
    { status, headers: { 'X-Request-Id': requestId } },
  )
}

export async function POST(request: NextRequest) {
  const requestId = request.headers.get('x-request-id')?.trim() || randomUUID()
  let quota: Awaited<ReturnType<typeof beginToolQuota>> | undefined
  try {
    let formData: FormData
    try {
      formData = await request.formData()
    } catch {
      throw new RequestValidationError('The upload could not be read. Please try again.', 'invalid_form')
    }

    const tasksJson = formData.get('tasks')
    if (typeof tasksJson !== 'string' || !tasksJson.trim()) {
      throw new RequestValidationError('Add at least one file to the batch.', 'no_tasks')
    }
    let tasks: unknown
    try {
      tasks = JSON.parse(tasksJson)
    } catch {
      throw new RequestValidationError('The batch description could not be read.', 'invalid_tasks')
    }
    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new RequestValidationError('Add at least one file to the batch.', 'no_tasks')
    }
    const maxFiles = positiveEnv('BATCH_MAX_FILES', DEFAULT_MAX_FILES)
    if (tasks.length > maxFiles) {
      throw new RequestValidationError(
        `A batch can hold up to ${maxFiles} files — this one has ${tasks.length}. Split it into smaller batches.`,
        'too_many_files',
        413,
      )
    }

    const files = new Map<string, File>()
    for (const [key, value] of formData.entries()) {
      if (key.startsWith('file_') && value instanceof File) files.set(key, value)
    }
    const matched = tasks.every(task =>
      task && typeof task === 'object' && files.has(String((task as { fileId?: unknown }).fileId)))
    if (!matched || files.size !== tasks.length) {
      throw new RequestValidationError(
        'The files and the batch description do not match. Please add the files again.',
        'task_file_mismatch',
      )
    }
    const maxTotalBytes = positiveEnv('BATCH_MAX_TOTAL_BYTES', DEFAULT_MAX_TOTAL_BYTES)
    const totalBytes = [...files.values()].reduce((sum, file) => sum + file.size, 0)
    if (totalBytes > maxTotalBytes) {
      throw new RequestValidationError(
        `This batch is larger than ${Math.round(maxTotalBytes / 1024 / 1024)} MB in total. Remove some files and try again.`,
        'file_too_large',
        413,
      )
    }

    quota = await beginToolQuota(request, 'batch-process', formData)
    if (!quota.ok) return quota.response

    const forward = new FormData()
    forward.append('tasks', tasksJson)
    for (const [key, file] of files) forward.append(key, file, file.name)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), positiveEnv('BATCH_TIMEOUT_MS', DEFAULT_TIMEOUT_MS))
    let upstream: Response
    try {
      upstream = await microserviceFetch('/batch-process', {
        method: 'POST',
        body: forward,
        cache: 'no-store',
        signal: controller.signal,
        headers: { 'X-Request-Id': requestId },
      })
    } catch (error) {
      const timedOut = controller.signal.aborted
      // The backend address is for the log, never for the user.
      if (!timedOut) console.error('Batch upstream unavailable', { requestId, url: microserviceUrl(), error })
      return quota.apply(timedOut
        ? errorResponse('This batch took too long. Send fewer or smaller files at a time.', 'upstream_timeout', 504, requestId)
        : errorResponse('The processing service is unavailable right now. Please try again shortly.', 'upstream_unavailable', 502, requestId))
    } finally {
      clearTimeout(timer)
    }

    if (!upstream.ok) {
      let body: Record<string, unknown> = {}
      try {
        body = await upstream.json()
      } catch {
        // non-JSON upstream body: fall through to the generic message
      }
      if (upstream.status === 422 && body.code === 'batch_failed') {
        // Nothing converted: hand the per-file reasons to the UI. Not ok, so
        // the quota reservation is released — no credit for no result.
        const headers = new Headers({ 'X-Request-Id': requestId })
        for (const name of PASS_THROUGH_HEADERS) {
          const value = upstream.headers.get(name)
          if (value) headers.set(name, value)
        }
        return quota.apply(NextResponse.json({ ...body, request_id: requestId }, { status: 422, headers }))
      }
      const status = upstream.status >= 500 ? 502 : upstream.status
      return quota.apply(errorResponse(
        typeof body.error === 'string' && body.error ? body.error : 'This batch could not be processed. Please try again.',
        typeof body.code === 'string' && body.code ? body.code : 'operation_failed',
        status,
        requestId,
      ))
    }

    const headers = new Headers({
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="mycloove_batch.zip"',
      'X-Request-Id': requestId,
    })
    for (const name of PASS_THROUGH_HEADERS) {
      const value = upstream.headers.get(name)
      if (value) headers.set(name, value)
    }
    const bytes = new Uint8Array(await upstream.arrayBuffer())
    const first = files.values().next().value
    return quota.apply(new NextResponse(bytes, { status: 200, headers }), {
      successful: true,
      fileName: first?.name ?? null,
    })
  } catch (error) {
    let failure: NextResponse
    if (error instanceof RequestValidationError) {
      failure = errorResponse(error.message, error.code, error.status, requestId)
    } else {
      console.error('Batch failed', { requestId, error })
      failure = errorResponse('This batch could not be processed. Please try again.', 'operation_failed', 500, requestId)
    }
    return quota?.ok ? quota.apply(failure) : failure
  }
}
