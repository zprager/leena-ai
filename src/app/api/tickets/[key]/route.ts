/**
 * GET /api/tickets/[key] — one ticket plus its most recent triage (if any).
 *
 * Same source-prefers-mock pattern as the list route: mock tickets are
 * checked first so they always resolve. If not in the mock set, fall back to
 * the JIRA API (and 404 cleanly if JIRA isn't configured either).
 */
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { buildClientFromEnv, getTicket as getJiraTicket } from "@/lib/jira";
import { getMockTicket } from "@/lib/jira/mock-tickets";
import { getTriage } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ key: string }> },
) {
  const { key } = await ctx.params;

  const mock = getMockTicket(key);
  if (mock) {
    return NextResponse.json({
      source: "mock",
      ticket: mock,
      triage: getTriage(key) ?? null,
    });
  }

  const client = buildClientFromEnv();
  if (!client) {
    return NextResponse.json(
      { error: `Ticket ${key} not in mock data and JIRA is not configured.` },
      { status: 404 },
    );
  }

  try {
    const ticket = await getJiraTicket(client, key);
    return NextResponse.json({
      source: "jira",
      ticket,
      triage: getTriage(key) ?? null,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `JIRA fetch failed for ${key}: ${message}` },
      { status: 502 },
    );
  }
}
