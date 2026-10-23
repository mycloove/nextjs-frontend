import { NextResponse } from "next/server";
import { beginToolQuota } from "@/lib/usage/quota";
import { documentCreditSucceeded } from "@/lib/usage/credit-success";
import { brokerAiCall } from "@/lib/ai/broker.ts";

/**
 * UI → Next.js API → Flask. The browser never talks to the microservice port.
 * Supports two payload shapes:
 *  1. { text, instruction?, mode? }      — used by Mr.Markdown AI tools
 *  2. { documentId, sessionId, text }    — legacy/Document AI shape
 */

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "A valid JSON request is required.", code: "invalid_request" }, { status: 400 });
  }
  if (typeof body.text === "string" && body.text.length > 400_000) {
    return NextResponse.json({ error: "Text exceeds the 400,000-character limit.", code: "text_too_large" }, { status: 413 });
  }
  const quota = await beginToolQuota(req, "document-ai", body);
  if (!quota.ok) return quota.response;

  try {

    const text: string = typeof body?.text === "string" ? body.text : "";
    const mode: string = typeof body?.mode === "string" ? body.mode : "summary";
    const instruction: string | undefined =
      typeof body?.instruction === "string" && body.instruction.trim()
        ? body.instruction.trim()
        : undefined;
    const documentId = typeof body.documentId === "string" ? body.documentId : undefined;
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;

    let message: string;
    if (instruction) {
      // mode === 'rewrite': perform the requested transformation on the text
      message = `${instruction}\n\n---\n\n${text}`;
    } else if (mode === "rewrite") {
      message = `Rewrite the following markdown so it is clean and well-structured. Return only the improved markdown:\n\n${text || "Please analyze the uploaded document."}`;
    } else {
      message = `Please provide a comprehensive summary of the following document content. Focus on key points, main arguments, and important details. Keep the summary well-structured:\n\n${text || "Please analyze the uploaded document and provide a summary based on its actual content."}`;
    }

    const result = await brokerAiCall("document_ai_chat", "/api/document-ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message,
        doc_id: documentId,
        session_id: sessionId || "",
      }),
    });

    const data = result.data as Record<string, unknown> | null;
    if (!result.ok) {
      return quota.apply(NextResponse.json(
        { error: (data && typeof data.error === "string" && data.error) || `Backend returned ${result.status}` },
        { status: result.status || 503 },
      ));
    }

    const summary: string = (typeof data?.answer === "string" && data.answer) || "No result could be generated from the document content.";
    return quota.apply(NextResponse.json({
      type: mode === "rewrite" ? "rewrite" : "summary",
      result: summary,
      answer: summary,
    }), { successful: documentCreditSucceeded(data) });
  } catch {
    return quota.apply(NextResponse.json(
      { error: "Summary generation failed." },
      { status: 503 },
    ));
  }
}
