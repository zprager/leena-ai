/**
 * GET /api/prompt — return the agent's prompt strategy for inspection.
 *
 * Used by the in-Nav "View prompt" dialog so anyone reviewing the agent can
 * see exactly what gets sent to the LLM. We pass placeholder strings into
 * userPrompt() so the response shows the TEMPLATE shape (with markers for
 * where retrieved context and ticket body get interpolated) rather than
 * synthesizing a fake ticket.
 *
 * Cheap to compute (no IO), so no caching needed. Always reflects whatever's
 * currently in src/lib/agent/prompts.ts.
 */
import { NextResponse } from "next/server";
import { systemPrompt, userPrompt } from "@/lib/agent/prompts";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    system: systemPrompt(),
    userTemplate: userPrompt(
      "{{TICKET_BODY — the ticket's summary + description}}",
      "{{POLICY_CONTEXT — RAG-retrieved policy sections, formatted as [POL-XX §X.X] markers}}",
    ),
    source: {
      file: "src/lib/agent/prompts.ts",
      systemFn: "systemPrompt()",
      userFn: "userPrompt(ticketBody, contextBlock)",
    },
  });
}
