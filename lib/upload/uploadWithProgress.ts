'use client'

import { ApiClientError, getApiErrorMessage } from '@/lib/api/client'
import { creditRequestHeaders, notifyCreditChange } from '@/lib/usage/credit-client'

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

// Statuses the Fetch spec forbids a body on; `new Response(body, { status })` throws for them.
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304])

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
    creditRequestHeaders(url).forEach((value, name) => xhr.setRequestHeader(name, value))

    const onAbort = () => xhr.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    xhr.upload.onprogress = (event) => {
      if (onProgress && event.lengthComputable && event.total > 0) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)))
      }
    }

    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort)
      notifyCreditChange()
    }

    xhr.onload = () => {
      cleanup()
      // Every caller uploads a document and expects a file back, so a "success"
      // with no body is never a real result. It happens when a download-manager
      // extension (seen: IDM) grabs the attachment and hands the page a 204 —
      // which also made `new Response(blob, { status: 204 })` throw here and
      // left the tool spinning forever. Reject honestly instead.
      const body = xhr.response as Blob | null
      if (xhr.status >= 200 && xhr.status < 300 && (NULL_BODY_STATUSES.has(xhr.status) || !body || body.size === 0)) {
        reject(new ApiClientError(
          'The result never reached this page — a download-manager browser extension may have intercepted it. Pause it for this site and try again.',
        ))
        return
      }
      try {
        const headers = new Headers()
        for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
          const separator = line.indexOf(':')
          if (separator > 0) headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim())
        }
        resolve(new Response(NULL_BODY_STATUSES.has(xhr.status) ? null : body, {
          status: xhr.status,
          statusText: xhr.statusText,
          headers,
        }))
      } catch {
        // Any throw inside an XHR handler would otherwise never settle the promise.
        reject(new ApiClientError('The server reply could not be read. Please try again.'))
      }
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
