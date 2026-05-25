/**
 * Client table for the ticket queue. Each row has its own busy state so
 * clicking Triage on one ticket doesn't disable the others. On success we
 * push the user to the ticket detail page, where the stored decision is
 * already waiting.
 */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { JiraTicket } from "@/lib/jira";

export function TicketsTable({ tickets }: { tickets: JiraTicket[] }) {
  if (tickets.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No tickets match the configured queue.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
        <thead className="bg-zinc-50 dark:bg-zinc-900">
          <tr>
            <Th>Key</Th>
            <Th>Summary</Th>
            <Th>Description</Th>
            <Th>Status</Th>
            <Th className="text-right">Action</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {tickets.map((t) => (
            <TicketRow key={t.key} ticket={t} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketRow({ ticket }: { ticket: JiraTicket }) {
  const router = useRouter();
  const [, startNav] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runTriage() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketKey: ticket.key }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? `triage failed (${res.status})`);
      }
      // Navigate to the detail page — the stored decision will be picked up
      // server-side on the next render.
      startNav(() => {
        router.push(`/tickets/${ticket.key}`);
        router.refresh();
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setBusy(false);
    }
  }

  return (
    <tr className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
      <Td>
        <Link
          href={`/tickets/${ticket.key}`}
          className="font-mono text-xs font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
        >
          {ticket.key}
        </Link>
      </Td>
      <Td>
        <span className="line-clamp-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {ticket.summary || <em className="text-zinc-400">(no summary)</em>}
        </span>
      </Td>
      <Td>
        <span className="line-clamp-2 text-sm text-zinc-600 dark:text-zinc-400">
          {ticket.description || <em className="text-zinc-400">(no description)</em>}
        </span>
      </Td>
      <Td>
        <span className="inline-flex items-center rounded-md border border-zinc-200 bg-zinc-50 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {ticket.status.name || "—"}
        </span>
      </Td>
      <Td className="text-right">
        <div className="flex flex-col items-end gap-1">
          <button
            onClick={runTriage}
            disabled={busy}
            className="inline-flex items-center rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {busy ? "Triaging…" : "Triage"}
          </button>
          {error && (
            <span className="text-[10px] text-red-600 dark:text-red-400">{error}</span>
          )}
        </div>
      </Td>
    </tr>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400 ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className ?? ""}`}>{children}</td>;
}
