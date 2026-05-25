/**
 * Ticket detail — full ticket plus the most recent triage result.
 *
 * Server component: fetches the ticket (mock or JIRA) and reads the stored
 * triage from the in-process store. The "Re-triage" button is delegated to a
 * client component so the rest of the page stays static.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildClientFromEnv, getTicket as getJiraTicket } from "@/lib/jira";
import type { JiraTicket } from "@/lib/jira";
import { getMockTicket } from "@/lib/jira/mock-tickets";
import { getTriage, type StoredTriage } from "@/lib/triage-store";
import { TriageResultView } from "@/app/components/TriageResultView";
import { RetriageButton } from "./RetriageButton";

export const dynamic = "force-dynamic";

interface Loaded {
  ticket: JiraTicket;
  source: "mock" | "jira";
  triage: StoredTriage | null;
}

async function load(key: string): Promise<Loaded | { error: string } | null> {
  const mock = getMockTicket(key);
  if (mock) {
    return { ticket: mock, source: "mock", triage: getTriage(key) ?? null };
  }
  const client = buildClientFromEnv();
  if (!client) return null;
  try {
    const ticket = await getJiraTicket(client, key);
    return { ticket, source: "jira", triage: getTriage(key) ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ key: string }>;
}) {
  const { key } = await params;
  const loaded = await load(key);

  if (loaded === null) notFound();

  if ("error" in loaded) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <BackLink />
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <span className="font-medium">Failed to load {key}:</span> {loaded.error}
        </div>
      </div>
    );
  }

  const { ticket, source, triage } = loaded;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <BackLink />

      <header className="mt-4 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {ticket.key}
            </span>
            <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              {source}
            </span>
            <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {ticket.status.name || "—"}
            </span>
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{ticket.summary}</h1>
          {ticket.reporter && (
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Reported by {ticket.reporter.displayName}
              {ticket.reporter.emailAddress ? ` (${ticket.reporter.emailAddress})` : ""}
            </p>
          )}
        </div>
        <RetriageButton ticketKey={ticket.key} hasPrior={triage !== null} />
      </header>

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Description</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
          {ticket.description || <em className="text-zinc-400">(no description)</em>}
        </p>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Triage result</h2>
        {triage ? (
          <>
            <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">
              Last triaged {new Date(triage.triagedAt).toLocaleString()}
            </p>
            <TriageResultView result={triage.result} />
          </>
        ) : (
          <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-950">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              This ticket hasn&apos;t been triaged yet. Click <span className="font-medium">Run triage</span> above
              to send it through the agent.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/tickets"
      className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
    >
      ← Back to tickets
    </Link>
  );
}
