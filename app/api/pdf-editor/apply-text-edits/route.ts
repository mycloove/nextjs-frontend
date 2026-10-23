/**
 * Proxy to the structural text-edit engine in the Python microservice.
 *
 * This route deliberately forwards the engine's atomic JSON report instead of
 * streaming back a PDF. The report carries commit evidence, per-edit proof, and
 * output integrity metadata; the client gates download on all of it. If we
 * returned `application/pdf` here, a refusal would be
 * indistinguishable from a success and the UI would happily hand the user a
 * document whose original text was never actually removed - the exact failure
 * mode this whole path exists to eliminate.
 */

import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { beginToolQuota } from "@/lib/usage/quota";
import { microserviceFetch, microserviceUrl } from "@/lib/usage/internal";

export const runtime = "nodejs";

/** Vercel Hobby caps Serverless Functions at 300 seconds. */
export const maxDuration = 300;

/**
 * Stop 15 seconds before the platform limit so this route can return a mapped
 * 504 response instead of being terminated before it can answer the client.
 */
const UPSTREAM_TIMEOUT_MS = 285_000;

/** The capabilities probe is a liveness check - it must never hang the UI. */
const CAPABILITIES_TIMEOUT_MS = 5_000;

/**
 * Error contract per `CLAUDE.md` §5: `{ error, code, request_id }` plus the
 * `X-Request-Id` header, so a failed export can be correlated with the server
 * log line. `parseServerTextEditReport` keys off `error` and ignores the extra
 * fields, so this stays compatible with the existing client.
 */
function jsonError(
  error: string,
  code: string,
  requestId: string,
  status: number,
): NextResponse {
  return NextResponse.json(
    { error, code, request_id: requestId },
    { status, headers: { "X-Request-Id": requestId } },
  );
}

/**
 * The transport-level reason, in one token the user can act on.
 *
 * `fetch` reports every connection problem as the same opaque "fetch failed";
 * the useful part is undici's nested `cause.code`. Discarding it - which this
 * route used to do with a bare `catch {}` - turned "the microservice is not
 * running" (`ECONNREFUSED`, the overwhelmingly common case in local dev) into
 * an unexplained dead end. A code, not a stack trace: this string is shown to
 * the user.
 */
function describeTransportCause(error: unknown): string {
  const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code
    ?? (error as { code?: unknown } | null)?.code;
  return typeof cause === "string" && cause.length > 0 ? cause : "no response";
}

export async function POST(request: Request) {
  const requestId = request.headers.get("x-request-id")?.trim() || randomUUID();

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return jsonError("Expected multipart/form-data.", "invalid_request", requestId, 400);
  }

  const file = incoming.get("file");
  if (!file || typeof file === "string") {
    return jsonError("No PDF file provided.", "invalid_request", requestId, 400);
  }

  const edits = incoming.get("edits");
  if (typeof edits !== "string" || edits.trim().length === 0) {
    return jsonError(
      "An 'edits' field containing a JSON array is required.",
      "invalid_request",
      requestId,
      400,
    );
  }

  const quota = await beginToolQuota(request, "pdf-editor", incoming);
  if (!quota.ok) return quota.response;

  const forwarded = new FormData();
  forwarded.append("file", file, file.name || "document.pdf");
  forwarded.append("edits", edits);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  let response: Response;
  try {
    response = await microserviceFetch("/pdf-editor/apply-text-edits", {
      method: "POST",
      body: forwarded,
      headers: { "X-Request-Id": requestId },
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (error) {
    // Fail loudly, both ways. A silent fallback to the overlay path would
    // reintroduce the "looks edited but isn't" bug behind the user's back, and
    // a silent *cause* leaves nobody able to tell a stopped service apart from
    // a timeout - so log the real error and name the reason in the message.
    if (error instanceof Error && error.name === "AbortError") {
      console.error("PDF editor text-edit upstream timed out", { requestId, error });
      return quota.apply(jsonError(
        `The text-edit service did not answer within ${Math.round(UPSTREAM_TIMEOUT_MS / 1000)}s. ` +
          "No changes were applied. Retry, or split the edit into fewer pages.",
        "upstream_timeout",
        requestId,
        504,
      ));
    }

    console.error("PDF editor text-edit upstream request failed", { requestId, error });
    return quota.apply(jsonError(
      `The text-edit service is unreachable (${describeTransportCause(error)}). ` +
        `No changes were applied. Confirm the PDF microservice is running at ${microserviceUrl()}, ` +
        "then export again.",
      "upstream_unavailable",
      requestId,
      502,
    ));
  } finally {
    clearTimeout(timeout);
  }

  // The engine's report is the answer, whatever the status: a refusal is a 200
  // with `pdf: null`, and a 4xx/5xx still carries a JSON body the client parses.
  // Pass it through untouched so no evidence is lost in translation.
  const body = await response.text();
  let successful = false;
  if (response.ok) {
    try {
      successful = (JSON.parse(body) as { status?: unknown }).status === "verified";
    } catch {
      successful = false;
    }
  }
  return quota.apply(new NextResponse(body, {
    status: response.status,
    headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
  }), { successful, fileName: file.name });
}

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CAPABILITIES_TIMEOUT_MS);

  try {
    const response = await microserviceFetch("/pdf-editor/text-engine/capabilities", {
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // Report the engine as unavailable rather than pretending it can be used.
    // The reason travels with it so a caller can say *why* editing is off.
    return NextResponse.json(
      { available: false, reason: `service unreachable (${describeTransportCause(error)})` },
      { status: 200 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
