import { creditRequestHeaders, notifyCreditChange } from '@/lib/usage/credit-client'

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

type ApiRequestInit = Omit<RequestInit, 'headers'> & {
  headers?: HeadersInit
}

/**
 * Single browser-side gateway for mycloove API calls.
 * It intentionally returns the raw Response so legacy tools can preserve their
 * existing download and JSON handling while receiving normalized network errors.
 */
export async function toolRequest(input: string, init: ApiRequestInit = {}): Promise<Response> {
  const headers = creditRequestHeaders(input, init.headers)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json, application/octet-stream, application/pdf, application/zip, */*')
  try {
    return await fetch(input, {
      ...init,
      headers,
    })
  } catch (cause) {
    throw new ApiClientError('Unable to reach the processing service. Check your connection and try again.', undefined, cause)
  } finally {
    if (init.method?.toUpperCase() !== 'GET') notifyCreditChange()
  }
}

export async function getApiErrorMessage(response: Response, fallback = 'The request could not be completed.'): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? ''
    if (contentType.includes('application/json')) {
      const body = await response.json() as { error?: unknown; message?: unknown }
      if (typeof body.error === 'string' && body.error.trim()) return body.error
      if (typeof body.message === 'string' && body.message.trim()) return body.message
    }
    const text = await response.text()
    if (text.trim()) return text
  } catch {
    // A fallback message is safer than exposing a parsing failure to the user.
  }

  if (response.status === 429) {
    return 'The available allowance is not enough for this action. Check your account credits or try again after the next return.'
  }

  return response.status === 503
    ? 'The processing service is temporarily unavailable. Please try again shortly.'
    : fallback
}

export async function requireSuccessfulResponse(response: Response, fallback?: string): Promise<Response> {
  if (response.ok) return response
  throw new ApiClientError(await getApiErrorMessage(response, fallback), response.status)
}
