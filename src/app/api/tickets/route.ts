/**
 * GET /api/tickets — list tickets for the UI.
 *
 * Strategy: if the JIRA env is configured, pull from the queue's JQL. If not,
 * fall back to the mock set so the dashboard is usable out-of-the-box.
 * Either way the response shape is identical — `source` lets the UI label
 * the table accordingly.
 */
import { NextResponse } from "next/server";
import { buildClientFromEnv, buildQueueFromEnv, listTickets } from "@/lib/jira";
import { MOCK_TICKETS } from "@/lib/jira/mock-tickets";

// Always run at request time — JIRA results are live and the mock set is
// trivial to render; no benefit to caching.
export const dynamic = "force-dynamic";

export async function GET() {
  const client = buildClientFromEnv();
  if (!client) {
    return NextResponse.json({ source: "mock", tickets: MOCK_TICKETS });
  }

  try {
    const queue = buildQueueFromEnv();
    const page = await listTickets(client, { jql: queue.jql, pageSize: 50 });
    return NextResponse.json({
      source: "jira",
      tickets: page.tickets,
      nextPageToken: page.nextPageToken ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Surface JIRA failures to the UI rather than silently masking with mocks —
    // confusing-but-working would be worse than a clear "JIRA fetch failed".
    return NextResponse.json(
      { error: `JIRA list failed: ${message}` },
      { status: 502 },
    );
  }
}
