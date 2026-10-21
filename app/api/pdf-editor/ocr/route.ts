import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { beginToolQuota } from "@/lib/usage/quota";
import { microserviceFetch } from "@/lib/usage/internal";

export const runtime = "nodejs";

const OCR_TIMEOUT_MS = 300_000;

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
  const quota = await beginToolQuota(request, "pdf-editor");
  if (!quota.ok) return quota.response;
  const forwarded = new FormData();
  forwarded.append("file", file, file.name || "document.pdf");
  forwarded.append("language", incoming.get("language")?.toString() || "eng");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);
  try {
    const response = await microserviceFetch("/pdf-editor/ocr", {
      method: "POST",
      body: forwarded,
      headers: { "X-Request-Id": requestId },
      cache: "no-store",
      signal: controller.signal,
    });
    const body = await response.text();
    return quota.apply(new NextResponse(body, {
      status: response.status,
      headers: { "Content-Type": "application/json", "X-Request-Id": requestId },
    }), { fileName: file.name });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "OCR timed out"
      : "OCR service is unavailable";
    return quota.apply(jsonError(`${message}. No changes were made to the original PDF.`, "upstream_unavailable", requestId, 502));
  } finally {
    clearTimeout(timeout);
  }
}
