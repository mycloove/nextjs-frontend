import { NextResponse } from "next/server";
import { beginToolQuota } from "@/lib/usage/quota";
import { brokerAiCall } from "@/lib/ai/broker.ts";

/**
 * UI → Next.js API → Flask. The browser never talks to the microservice port.
 * Supports two payload shapes:
 *  1. { text, instruction?, mode? }      — used by Mr.Markdown AI tools
 *  2. { documentId, sessionId, text }    — legacy/Document AI shape
 */

export async function POST(req: Request) {
  const quota = await beginToolQuota(req, "document-ai");
  if (!quota.ok) return quota.response;

  try {
    const body = await req.json();

    const text: string = typeof body?.text === "string" ? body.text : "";
    const mode: string = typeof body?.mode === "string" ? body.mode : "summary";
    const instruction: string | undefined =
      typeof body?.instruction === "string" && body.instruction.trim()
        ? body.instruction.trim()
        : undefined;
    const documentId: string | undefined = body?.documentId;
    const sessionId: string | undefined = body?.sessionId;

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
    }));
  } catch {
    return quota.apply(NextResponse.json(
      { error: "Summary generation failed." },
      { status: 503 },
    ));
  }
}
