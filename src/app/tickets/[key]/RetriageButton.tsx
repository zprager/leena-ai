/**
 * Re-triage button on the ticket detail page. Posts to /api/triage with the
 * ticket key, then `router.refresh()` so the server component re-reads the
 * store and renders the new decision.
 */
"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

export function RetriageButton({
  ticketKey,
  hasPrior,
}: {
  ticketKey: string;
  hasPrior: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/triage", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ticketKey }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload?.error ?? `triage failed (${res.status})`);
      }
      // router.refresh() re-runs the server component; the new triage is then
      // picked up from the store on the next render.
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const label = busy || pending
    ? "Triaging…"
    : hasPrior
      ? "Re-triage"
      : "Run triage";

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={busy || pending}
        className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        {label}
      </button>
      {error && (
        <span className="text-xs text-red-600 dark:text-red-400">{error}</span>
      )}
    </div>
  );
}
