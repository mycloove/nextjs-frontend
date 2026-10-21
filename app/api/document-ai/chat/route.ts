import { NextResponse } from "next/server";
import { beginToolQuota } from "@/lib/usage/quota";
import { brokerAiCall } from "@/lib/ai/broker.ts";

/**
 * UI → Next.js API → Flask. The browser never talks to :5001.
 *
 * The broker resolves the admin-managed provider chain, forwards one decrypted
 * key server-to-server, and falls back to the env path when nothing is
 * configured or every provider refuses.
 */
export async function POST(req: Request) {
  const quota = await beginToolQuota(req, "document-ai");
  if (!quota.ok) return quota.response;

  try {
    const body = await req.json() as Record<string, unknown>;
    const result = await brokerAiCall("document_ai_chat", "/api/document-ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: body.message,
        doc_id: body.doc_id ?? body.documentId,
        session_id: body.session_id ?? body.sessionId ?? "",
        ...(typeof body.type === "string" ? { type: body.type } : {}),
      }),
    });

    const data = result.data as Record<string, unknown> | null;
    if (!result.ok) {
      return quota.apply(NextResponse.json(
        { error: (data && typeof data.error === "string" && data.error) || `Backend returned ${result.status}` },
        { status: result.status || 503 },
      ));
    }

    return quota.apply(NextResponse.json(data));
  } catch {
    return quota.apply(NextResponse.json(
      { error: "Failed to connect to the document AI service." },
      { status: 503 },
    ));
  }
}
