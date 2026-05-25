/**
 * POST /api/triage — run the triage agent on a ticket or on free-form text.
 *
 * Body shape (one of):
 *   { ticketKey: string }   — look up the ticket (mock or JIRA), feed
 *                              `summary + description` to triage().
 *   { text: string }         — pass the text straight to triage() and store it
 *                              under a synthetic `manual-<ts>` key so it shows
 *                              up in the dashboard history.
 *
 * The full {@link TriageResult} (decision + trace + downgrade) is returned
 * verbatim — the UI uses the trace block for the retrieval visualization.
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { triage } from "@/lib/agent";
import { buildClientFromEnv, getTicket as getJiraTicket } from "@/lib/jira";
import { getMockTicket } from "@/lib/jira/mock-tickets";
import { recordTriage, type TriageSource } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

interface TriageBody {
  ticketKey?: string;
  text?: string;
}

export async function POST(request: NextRequest) {
  let body: TriageBody;
  try {
    body = (await request.json()) as TriageBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { ticketKey, text } = body;
  if (!ticketKey && !text) {
    return NextResponse.json(
      { error: "Provide either `ticketKey` or `text`." },
      { status: 400 },
    );
  }

  // Resolve the ticket body and bookkeeping fields up front, then run triage
  // once. Keeping the resolution branch separate from the triage call makes the
  // error surface (missing ticket vs. retrieval failure) obvious in logs.
  let key: string;
  let source: TriageSource;
  let summary: string;
  let bodyText: string;

  if (ticketKey) {
    const mock = getMockTicket(ticketKey);
    if (mock) {
      key = ticketKey;
      source = "mock";
      summary = mock.summary;
      bodyText = joinBody(mock.summary, mock.description);
    } else {
      const client = buildClientFromEnv();
      if (!client) {
        return NextResponse.json(
          { error: `Ticket ${ticketKey} not in mock data and JIRA is not configured.` },
          { status: 404 },
        );
      }
      try {
        const ticket = await getJiraTicket(client, ticketKey);
        key = ticket.key;
        source = "jira";
        summary = ticket.summary;
        bodyText = joinBody(ticket.summary, ticket.description);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json(
          { error: `JIRA fetch failed for ${ticketKey}: ${message}` },
          { status: 502 },
        );
      }
    }
  } else {
    // Manual run — give it a unique synthetic key so re-running doesn't
    // overwrite earlier rows in the dashboard history.
    key = `manual-${Date.now()}`;
    source = "manual";
    bodyText = text!;
    summary = excerpt(text!, 80);
  }

  try {
    const result = await triage(bodyText);
    const triagedAt = new Date().toISOString();
    recordTriage({ key, source, summary, body: bodyText, result, triagedAt });
    return NextResponse.json({ key, source, summary, body: bodyText, result, triagedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Retrieval failures (Qdrant down, embedding API key missing) end up here.
    // Bubble them up with a 500 + the message so the UI can show what broke.
    return NextResponse.json(
      { error: `triage() failed: ${message}` },
      { status: 500 },
    );
  }
}

function joinBody(summary: string, description: string): string {
  return [summary, description].filter(Boolean).join("\n\n");
}

function excerpt(s: string, max: number): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
