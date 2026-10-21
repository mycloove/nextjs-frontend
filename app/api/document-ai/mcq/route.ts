import { NextResponse } from "next/server";
import { beginToolQuota } from "@/lib/usage/quota";
import { brokerAiCall } from "@/lib/ai/broker.ts";

export async function POST(req: Request) {
  const quota = await beginToolQuota(req, "document-ai");
  if (!quota.ok) return quota.response;

  try {
    const { documentId, sessionId, text } = await req.json();
    const result = await brokerAiCall("document_ai_chat", "/api/document-ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: `Generate 5 multiple-choice questions based STRICTLY on the following document content. Each question must have 4 options (A, B, C, D) and a correct answer. Format as JSON array with fields: question, options (array), answer, explanation:\n\n${text || "Please analyze the uploaded document and generate MCQs from its content."}`,
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

    const answer = (typeof data?.answer === "string" && data.answer) || "No MCQs generated.";
    return quota.apply(NextResponse.json({
      type: "mcq",
      answer,
      data: data?.answer ? [{ question: "Generated from document", options: ["A", "B", "C", "D"], answer }] : [],
    }));
  } catch {
    return quota.apply(NextResponse.json(
      { error: "MCQ generation failed." },
      { status: 503 }
    ));
  }
}
