import { NextResponse } from "next/server";
import { beginToolQuota } from "@/lib/usage/quota";
import { documentCreditSucceeded } from "@/lib/usage/credit-success";
import { brokerAiCall } from "@/lib/ai/broker.ts";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "A valid JSON request is required.", code: "invalid_request" }, { status: 400 });
  }
  if (typeof body.text === "string" && body.text.length > 400_000) return NextResponse.json({ error: "Text is too large.", code: "text_too_large" }, { status: 413 });
  const quota = await beginToolQuota(req, "document-ai", body);
  if (!quota.ok) return quota.response;

  try {
    const { documentId, sessionId, text } = body;
    const result = await brokerAiCall("document_ai_chat", "/api/document-ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Extract the key bullet points from the following document content. Present them as a clean, organized list of bullet points covering the main topics and important details:\n\n${text || "Please analyze the uploaded document and extract key bullet points from its actual content."}`,
        doc_id: documentId,
        session_id: sessionId || "",
      }),
    });

    const data = result.data as Record<string, unknown> | null;
    if (!result.ok) {
      return quota.apply(NextResponse.json(
        { error: (data && typeof data.error === "string" && data.error) || `Backend returned ${result.status}` },
        { status: result.status || 503 }
      ));
    }

    return quota.apply(NextResponse.json({
      type: "bullet",
      answer: (typeof data?.answer === "string" && data.answer) || "No bullet points could be generated from the document content.",
    }), { successful: documentCreditSucceeded(data) });
  } catch {
    return quota.apply(NextResponse.json(
      { error: "Bullet point generation failed." },
      { status: 503 }
    ));
  }
}
