/**
 * JIRA webhook receiver.
 *
 * Alternative to the polling loop: configure JIRA to POST here on ticket
 * create/update events and the triage runs immediately. The payload shape
 * JIRA sends is documented at
 *   https://developer.atlassian.com/cloud/jira/platform/webhooks/
 *
 * We accept any payload that yields an issue key (top-level `issue.key` or
 * `key`). The handler then re-fetches the ticket via the REST API rather than
 * trusting the webhook body — keeps the trust surface narrow and means we get
 * the same shaped {@link JiraTicket} as the poller.
 */
import { NextResponse, type NextRequest } from "next/server";
import {
  buildClientFromEnv,
  buildQueueFromEnv,
  getTicket,
  triageHandler,
} from "@/lib/jira";
import { env } from "@/lib/env";

// Webhooks are dynamic by nature — never prerender.
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const client = buildClientFromEnv();
  if (!client) {
    return NextResponse.json(
      { error: "JIRA is not configured on this server." },
      { status: 503 },
    );
  }

  // Optional shared-secret check. JIRA Cloud doesn't sign webhooks natively;
  // the usual pattern is a query-string secret or a proxy-injected header.
  if (env.JIRA_WEBHOOK_SECRET) {
    const provided =
      request.headers.get("x-webhook-secret") ??
      new URL(request.url).searchParams.get("secret");
    if (provided !== env.JIRA_WEBHOOK_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const key = extractIssueKey(payload);
  if (!key) {
    return NextResponse.json(
      { error: "Could not extract issue key from webhook payload." },
      { status: 400 },
    );
  }

  // Re-fetch via the API rather than trusting the webhook payload — webhooks
  // can carry stale or partial data, and we want the same shape the poller
  // produces so the handler stays single-path.
  const ticket = await getTicket(client, key);

  const queue = buildQueueFromEnv();
  const handle = triageHandler();

  try {
    await handle(ticket, { client, queue, iteration: 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Log and return 500 — JIRA will retry per its webhook retry policy.
    console.error(`[jira-webhook] handler failed for ${key}: ${message}`);
    return NextResponse.json({ error: message, key }, { status: 500 });
  }

  return NextResponse.json({ ok: true, key });
}

/** Health check — handy for the JIRA admin "test this webhook" button. */
export async function GET() {
  const client = buildClientFromEnv();
  return NextResponse.json({
    ok: true,
    configured: client !== null,
  });
}

/**
 * Pull the issue key out of whatever shape the webhook sent. JIRA Cloud sends
 * `{ issue: { key: "HELPDESK-123", ... }, ... }` for issue events; some
 * automation rules forward simpler shapes like `{ key: "HELPDESK-123" }`.
 */
function extractIssueKey(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;

  const fromIssue =
    p.issue && typeof p.issue === "object"
      ? (p.issue as Record<string, unknown>).key
      : undefined;
  if (typeof fromIssue === "string") return fromIssue;

  if (typeof p.key === "string") return p.key;
  if (typeof p.issueKey === "string") return p.issueKey;

  return null;
}
