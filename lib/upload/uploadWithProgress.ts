'use client'

import { ApiClientError, getApiErrorMessage } from '@/lib/api/client'

/**
 * XHR-based form upload with real progress and cancellation.
 *
 * `fetch` cannot observe upload progress and cannot be aborted in every
 * runtime, and tools that move tens of megabytes need both: a honest
 * percentage bar and a working cancel button. This wrapper uses XHR for the
 * one job fetch is bad at, and normalizes every failure into `ApiClientError`
 * so callers keep the same error surface as `toolRequest`.
 */
export interface UploadWithProgressOptions {
  method?: 'POST' | 'PUT'
  /** Called as the upload advances: 0–100, monotonic per attempt. */
  onProgress?: (percent: number) => void
  /** Wire an AbortController here to let the user cancel mid-upload. */
  signal?: AbortSignal
}

export function uploadWithProgress(
  url: string,
  body: FormData,
  options: UploadWithProgressOptions = {},
): Promise<Response> {
  const { method = 'POST', onProgress, signal } = options

  return new Promise<Response>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new ApiClientError('The upload was cancelled.'))
      return
    }

    const xhr = new XMLHttpRequest()
    xhr.open(method, url)
    xhr.responseType = 'blob'
    xhr.setRequestHeader('Accept', 'application/json, application/octet-stream, */*')

    const onAbort = () => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
      }
    }

    const cleanup = () => signal?.removeEventListener('abort', onAbort)

    xhr.onload = () => {
      cleanup()
      resolve(new Response(xhr.response as Blob, {
        status: xhr.status,
        statusText: xhr.statusText,
      }))
    }

    xhr.onerror = () => {
      cleanup()
      reject(new ApiClientError(
        'Unable to reach the processing service. Check your connection and try again.',
      ))
    }

    xhr.onabort = () => {
      cleanup()
      reject(new ApiClientError('The upload was cancelled.'))
    }

    xhr.ontimeout = () => {
      cleanup()
      reject(new ApiClientError('The upload timed out. Try a smaller file or retry.'))
    }

    xhr.send(body)
  })
}

export { getApiErrorMessage }
