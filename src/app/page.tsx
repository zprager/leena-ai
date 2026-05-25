/**
 * Dashboard — summary cards + recent triage history.
 *
 * Reads directly from the in-process `triage-store` since we're on the same
 * Node runtime. Marked dynamic so React doesn't try to prerender stale counts
 * at build (the store is request-time state).
 */
import Link from "next/link";
import { REASON_CODE_META } from "@/lib/agent";
import { getStats, listTriages } from "@/lib/triage-store";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  const stats = getStats();
  const recent = listTriages(20);

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          Live counts for triages this process has handled, plus the most recent runs.
        </p>
      </header>

      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total processed" value={stats.total} />
        <StatCard label="Resolved" value={stats.resolved} accent="emerald" />
        <StatCard label="Deferred" value={stats.deferred} accent="amber" />
        <StatCard
          label="Avg duration"
          value={stats.avgDurationMs > 0 ? `${stats.avgDurationMs} ms` : "—"}
        />
      </section>

      {stats.downgraded > 0 && (
        <p className="mt-3 text-xs text-orange-700 dark:text-orange-400">
          {stats.downgraded} run{stats.downgraded === 1 ? "" : "s"} were downgraded by
          post-validation (RESOLVE → DEFER · LOW_CONFIDENCE).
        </p>
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Recent triages</h2>

        {recent.length === 0 ? (
          <EmptyRecent />
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
            <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
              <thead className="bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <Th>Ticket</Th>
                  <Th>Summary</Th>
                  <Th>Decision</Th>
                  <Th>Reason / Citation</Th>
                  <Th>Confidence</Th>
                  <Th>Triaged</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {recent.map((entry) => {
                  const { decision, trace } = entry.result;
                  const isResolve = decision.action === "RESOLVE";
                  const isManual = entry.source === "manual";
                  return (
                    <tr key={entry.key} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                      <Td>
                        {isManual ? (
                          <span className="font-mono text-xs text-zinc-500">manual</span>
                        ) : (
                          <Link
                            href={`/tickets/${entry.key}`}
                            className="font-mono text-xs font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
                          >
                            {entry.key}
                          </Link>
                        )}
                      </Td>
                      <Td>
                        <span className="line-clamp-1 text-sm text-zinc-700 dark:text-zinc-300">
                          {entry.summary}
                        </span>
                      </Td>
                      <Td>
                        <span
                          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${
                            isResolve
                              ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
                              : "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                          }`}
                        >
                          {decision.action}
                        </span>
                      </Td>
                      <Td>
                        {isResolve ? (
                          <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                            {decision.citation}
                          </span>
                        ) : (
                          <span
                            className="font-mono text-xs text-zinc-700 dark:text-zinc-300"
                            title={REASON_CODE_META[decision.reasonCode].description}
                          >
                            {decision.reasonCode}
                          </span>
                        )}
                      </Td>
                      <Td>
                        <span
                          className={`font-mono text-xs ${
                            trace.retrieval.belowThreshold
                              ? "text-amber-700 dark:text-amber-400"
                              : "text-zinc-600 dark:text-zinc-400"
                          }`}
                        >
                          {trace.retrieval.topScore.toFixed(3)}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-xs text-zinc-500 dark:text-zinc-400">
                          {formatRelative(entry.triagedAt)}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "emerald" | "amber";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : accent === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : "text-zinc-900 dark:text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className={`mt-2 text-3xl font-semibold ${accentClass}`}>{value}</div>
    </div>
  );
}

function EmptyRecent() {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        No triages yet. Head to{" "}
        <Link href="/tickets" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Tickets
        </Link>{" "}
        and click <span className="font-medium">Triage</span> on a row, or paste a ticket into{" "}
        <Link href="/triage" className="font-medium text-zinc-900 underline dark:text-zinc-100">
          Manual triage
        </Link>
        .
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 align-middle">{children}</td>;
}

/** Human-friendly "5m ago" style. Falls back to ISO date for old entries. */
function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const seconds = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(then).toLocaleString();
}
