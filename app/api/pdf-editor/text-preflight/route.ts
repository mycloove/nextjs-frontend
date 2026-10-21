import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { microserviceFetch } from "@/lib/usage/internal";

export const runtime = "nodejs";

const PREFLIGHT_TIMEOUT_MS = 15_000;

function jsonError(error: string, code: string, requestId: string, status: number) {
  return NextResponse.json(
    { error, code, request_id: requestId },
    { status, headers: { "X-Request-Id": requestId } },
  );
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

  const forwarded = new FormData();
  forwarded.append("file", file, file.name || "document.pdf");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);

  try {
    const response = await microserviceFetch("/pdf-editor/text-engine/preflight", {
      method: "POST",
      body: forwarded,
      headers: { "X-Request-Id": requestId },
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.text();
    return new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    });
  } catch (error) {
    const cause = (error as { cause?: { code?: unknown } } | null)?.cause?.code;
    const detail = error instanceof Error && error.name === "AbortError"
      ? "preflight timed out"
      : `service unreachable (${typeof cause === "string" ? cause : "no response"})`;
    return jsonError(`PDF text preflight unavailable: ${detail}.`, "upstream_unavailable", requestId, 502);
  } finally {
    clearTimeout(timeout);
  }
}
