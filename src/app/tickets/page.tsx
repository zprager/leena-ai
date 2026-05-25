/**
 * Ticket queue — server-renders the ticket list from the same source the API
 * route would use (JIRA if configured, mocks otherwise). Per-row interaction
 * (the Triage button) is delegated to a small client component so this stays
 * a server component for fast initial paint.
 */
import { buildClientFromEnv, buildQueueFromEnv, listTickets } from "@/lib/jira";
import { MOCK_TICKETS } from "@/lib/jira/mock-tickets";
import type { JiraTicket } from "@/lib/jira";
import { TicketsTable } from "./TicketsTable";

export const dynamic = "force-dynamic";

interface LoadResult {
  source: "jira" | "mock";
  tickets: JiraTicket[];
  error?: string;
}

async function loadTickets(): Promise<LoadResult> {
  const client = buildClientFromEnv();
  if (!client) return { source: "mock", tickets: MOCK_TICKETS };

  try {
    const queue = buildQueueFromEnv();
    const page = await listTickets(client, { jql: queue.jql, pageSize: 50 });
    return { source: "jira", tickets: page.tickets };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Fall back to mocks so the UI is still demoable, but surface the JIRA
    // error inline so the operator notices the connector is broken.
    return { source: "mock", tickets: MOCK_TICKETS, error: message };
  }
}

export default async function TicketsPage() {
  const { source, tickets, error } = await loadTickets();

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            {source === "jira"
              ? "Live from JIRA — matching the configured queue JQL."
              : "Mock tickets — JIRA isn't configured, so the demo set is shown."}
          </p>
        </div>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
        </span>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <span className="font-medium">JIRA fetch failed:</span> {error}
        </div>
      )}

      <TicketsTable tickets={tickets} />
    </div>
  );
}
