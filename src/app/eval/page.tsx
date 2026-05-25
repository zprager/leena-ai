/**
 * Eval page — runs the 50-ticket harness from the browser.
 *
 * Flow:
 *  1. On mount, GET /api/eval to hydrate the last cached run (if any) so a
 *     refresh doesn't lose state.
 *  2. Hit "Run eval" → POST /api/eval, then read the NDJSON stream and update
 *     state per event. The 5×10 ticket grid fills in live, which makes the
 *     30-60s wait feel like progress instead of a hang.
 *  3. After `complete`, swap to the full ResultsView (headline cards, bucket
 *     breakdown, per-reason-code P/R table, failures-of-note).
 *
 * Stays a single-file page on purpose — every sub-component below reads from
 * the same EvalReport / ScoredResult types and there's no reuse elsewhere.
 */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { REASON_CODE_META } from "@/lib/agent";
import type {
  EvalReport,
  ScoredResult,
  ScoringBucket,
} from "@/lib/eval";

// Shape mirrors src/lib/eval-store.ts — kept inline so this client file
// doesn't need to import from a server-only module.
interface StoredEvalRun {
  runAt: string;
  options: { multiQuery: boolean; concurrency: number };
  report: EvalReport;
}

// Stream event union — matches the emit() shapes in /api/eval/route.ts.
type StreamEvent =
  | { type: "start"; total: number; ticketIds: string[]; options: { multiQuery: boolean; concurrency: number } }
  | { type: "progress"; completed: number; total: number; result: ScoredResult }
  | { type: "complete"; run: StoredEvalRun }
  | { type: "error"; message: string };

type Phase = "idle" | "running" | "complete" | "error";

// Per-bucket display config. Keeping this in one table means the grid, the
// breakdown chips, and the failure rows all stay color-coordinated.
const BUCKET_CONFIG: Record<
  ScoringBucket,
  { label: string; tile: string; chip: string; weight: number }
> = {
  correct_resolve: {
    label: "Correct RESOLVE",
    tile: "bg-emerald-500 ring-emerald-700",
    chip: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    weight: 0,
  },
  correct_defer: {
    label: "Correct DEFER",
    tile: "bg-teal-500 ring-teal-700",
    chip: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-200",
    weight: 0,
  },
  wrong_citation_resolve: {
    label: "RESOLVE, wrong citation",
    tile: "bg-amber-400 ring-amber-600",
    chip: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    weight: 0.5,
  },
  wrong_reason_defer: {
    label: "DEFER, wrong reason",
    tile: "bg-yellow-400 ring-yellow-600",
    chip: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200",
    weight: 0.5,
  },
  missed_resolve: {
    label: "Missed RESOLVE (over-cautious)",
    tile: "bg-orange-500 ring-orange-700",
    chip: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
    weight: 1.0,
  },
  false_resolve: {
    label: "FALSE RESOLVE (3× penalty)",
    tile: "bg-red-600 ring-red-800",
    chip: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200",
    weight: 3.0,
  },
};

const BUCKET_ORDER: ScoringBucket[] = [
  "correct_resolve",
  "correct_defer",
  "wrong_citation_resolve",
  "wrong_reason_defer",
  "missed_resolve",
  "false_resolve",
];

export default function EvalPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [multiQuery, setMultiQuery] = useState(false);
  const [concurrency, setConcurrency] = useState(5);

  // Streaming state — populated incrementally while a run is in flight.
  const [ticketIds, setTicketIds] = useState<string[]>([]);
  const [byId, setById] = useState<Map<string, ScoredResult>>(new Map());
  const [completed, setCompleted] = useState(0);
  const [total, setTotal] = useState(50);

  // Final / cached run, plus any error from the last POST.
  const [run, setRun] = useState<StoredEvalRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Hydrate the cached run on mount so refreshes don't lose it.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/eval")
      .then((r) => r.json())
      .then((data: { lastRun: StoredEvalRun | null }) => {
        if (cancelled) return;
        if (data.lastRun) {
          setRun(data.lastRun);
          setPhase("complete");
          // Seed the grid from the cached results so the visualization renders
          // immediately on refresh.
          const map = new Map<string, ScoredResult>();
          for (const r of data.lastRun.report.results) map.set(r.ticket.id, r);
          setById(map);
          setTicketIds(data.lastRun.report.results.map((r) => r.ticket.id));
          setCompleted(data.lastRun.report.results.length);
          setTotal(data.lastRun.report.results.length);
        }
      })
      .catch(() => {
        // Silent — first-load failure shouldn't block manual runs.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEvent = useCallback((event: StreamEvent) => {
    if (event.type === "start") {
      setTicketIds(event.ticketIds);
      setById(new Map());
      setCompleted(0);
      setTotal(event.total);
    } else if (event.type === "progress") {
      setCompleted(event.completed);
      setTotal(event.total);
      setById((prev) => {
        const next = new Map(prev);
        next.set(event.result.ticket.id, event.result);
        return next;
      });
    } else if (event.type === "complete") {
      setRun(event.run);
      setPhase("complete");
    } else if (event.type === "error") {
      setError(event.message);
      setPhase("error");
    }
  }, []);

  const runEval = useCallback(async () => {
    setPhase("running");
    setError(null);
    setRun(null);
    setById(new Map());
    setCompleted(0);

    try {
      const res = await fetch("/api/eval", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ multiQuery, concurrency }),
      });
      if (!res.ok || !res.body) {
        const fallback = await res.json().catch(() => ({}));
        throw new Error(fallback?.error ?? `eval failed (${res.status})`);
      }

      // NDJSON reader: accumulate text, split on newlines, parse each complete
      // line as a JSON event. The final partial line stays in the buffer for
      // the next chunk.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handleEvent(JSON.parse(line) as StreamEvent);
          } catch {
            // Malformed line — skip; the next event will resync us.
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }, [multiQuery, concurrency, handleEvent]);

  // The grid uses the live `byId` map during a run and the same map after
  // completion — no branching needed.
  const grid = useMemo(
    () => ticketIds.map((id) => ({ id, result: byId.get(id) ?? null })),
    [ticketIds, byId],
  );

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Eval — 50-ticket sample set</h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Runs <code className="font-mono text-xs">fixtures/eval-50.json</code> through{" "}
            <code className="font-mono text-xs">triage()</code> and scores per the rubric — false-positive RESOLVE weighted 3×.
          </p>
        </div>
        {run && (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Last run {new Date(run.runAt).toLocaleString()}
          </p>
        )}
      </header>

      <ControlsBar
        multiQuery={multiQuery}
        setMultiQuery={setMultiQuery}
        concurrency={concurrency}
        setConcurrency={setConcurrency}
        phase={phase}
        onRun={runEval}
      />

      {phase === "running" && (
        <ProgressBar completed={completed} total={total} />
      )}

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          <span className="font-medium">Error:</span> {error}
        </div>
      )}

      {grid.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Tickets {phase === "running" && `(${completed}/${total})`}
          </h2>
          <TicketGrid grid={grid} />
          <BucketLegend />
        </section>
      )}

      {run && phase === "complete" && <ResultsView run={run} />}
    </div>
  );
}

// --------- Sub-components ---------

function ControlsBar({
  multiQuery,
  setMultiQuery,
  concurrency,
  setConcurrency,
  phase,
  onRun,
}: {
  multiQuery: boolean;
  setMultiQuery: (b: boolean) => void;
  concurrency: number;
  setConcurrency: (n: number) => void;
  phase: Phase;
  onRun: () => void;
}) {
  const running = phase === "running";
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={multiQuery}
          onChange={(e) => setMultiQuery(e.target.checked)}
          disabled={running}
          className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900 dark:border-zinc-700"
        />
        <span className="text-zinc-700 dark:text-zinc-300">Multi-query retrieval</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="text-zinc-700 dark:text-zinc-300">Concurrency</span>
        <input
          type="number"
          min={1}
          max={20}
          value={concurrency}
          onChange={(e) => setConcurrency(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          disabled={running}
          className="w-16 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm focus:border-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900 dark:border-zinc-700 dark:bg-zinc-950"
        />
      </label>
      <div className="ml-auto">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex items-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-zinc-800 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {running ? "Running…" : "Run eval"}
        </button>
      </div>
    </div>
  );
}

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          {completed}/{total} tickets
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
        <div
          className="h-full bg-zinc-900 transition-all duration-150 dark:bg-zinc-100"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function TicketGrid({ grid }: { grid: Array<{ id: string; result: ScoredResult | null }> }) {
  return (
    <div className="grid grid-cols-10 gap-1.5">
      {grid.map(({ id, result }) => (
        <TicketTile key={id} id={id} result={result} />
      ))}
    </div>
  );
}

function TicketTile({ id, result }: { id: string; result: ScoredResult | null }) {
  if (!result) {
    return (
      <div
        title={`${id} — pending`}
        className="flex aspect-square items-center justify-center rounded-md bg-zinc-100 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
      >
        <span className="font-mono text-[10px] text-zinc-400">{id}</span>
      </div>
    );
  }

  const cfg = BUCKET_CONFIG[result.bucket];
  const pred =
    result.result.decision.action === "RESOLVE"
      ? result.result.decision.citation
      : result.result.decision.reasonCode;
  const gt =
    result.ticket.groundTruth.action === "RESOLVE"
      ? result.ticket.groundTruth.citations.join(" / ")
      : result.ticket.groundTruth.reasonCode;
  const tooltip = `${id} · ${cfg.label}\nGround truth: ${gt}\nPredicted: ${result.result.decision.action} ${pred}`;

  return (
    <div
      title={tooltip}
      className={`flex aspect-square cursor-default items-center justify-center rounded-md ring-1 ${cfg.tile}`}
    >
      <span className="font-mono text-[10px] font-semibold text-white">{id.replace("T-", "")}</span>
    </div>
  );
}

function BucketLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs">
      {BUCKET_ORDER.map((b) => {
        const cfg = BUCKET_CONFIG[b];
        return (
          <span key={b} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-3 w-3 rounded-sm ring-1 ${cfg.tile}`} />
            <span className="text-zinc-600 dark:text-zinc-400">{cfg.label}</span>
          </span>
        );
      })}
    </div>
  );
}

function ResultsView({ run }: { run: StoredEvalRun }) {
  const { report } = run;
  const t = report.totals;
  const acc = t.n > 0 ? ((t.correct / t.n) * 100).toFixed(1) : "0.0";
  const score = (report.normalizedScore * 100).toFixed(1);

  return (
    <div className="mt-10 space-y-10">
      {/* Headline cards */}
      <section>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard label="Strict accuracy" value={`${t.correct}/${t.n}`} sub={`${acc}%`} />
          <StatCard
            label="Weighted score"
            value={`${score}%`}
            sub={`error ${report.weightedError.toFixed(1)} / ${(t.n * 3).toFixed(0)}`}
            accent={report.normalizedScore >= 0.85 ? "emerald" : report.normalizedScore >= 0.7 ? "amber" : "red"}
          />
          <StatCard label="Mean latency" value={`${t.durationMsAvg} ms`} sub={`total ${t.durationMsTotal} ms`} />
          <StatCard
            label="Grounding downgrades"
            value={report.downgradedCount}
            sub="RESOLVE → LOW_CONFIDENCE"
            accent={report.downgradedCount > 0 ? "amber" : undefined}
          />
        </div>
      </section>

      {/* Bucket breakdown */}
      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Scoring buckets</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {BUCKET_ORDER.map((b) => {
            const cfg = BUCKET_CONFIG[b];
            const count = report.buckets[b];
            return (
              <div
                key={b}
                className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2.5 w-2.5 rounded-sm ring-1 ${cfg.tile}`} />
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                    {cfg.label}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between">
                  <span className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{count}</span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    weight {cfg.weight}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Per-reason-code precision / recall */}
      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Per-reason-code precision / recall</h2>
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-800">
            <thead className="bg-zinc-50 dark:bg-zinc-900">
              <tr>
                <Th>Reason code</Th>
                <Th className="text-right">Support</Th>
                <Th className="text-right">Predicted</Th>
                <Th className="text-right">TP</Th>
                <Th className="text-right">Precision</Th>
                <Th className="text-right">Recall</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {report.reasonCodeStats
                .filter((s) => s.support > 0 || s.predicted > 0)
                .map((s) => (
                  <tr key={s.code} className="hover:bg-zinc-50 dark:hover:bg-zinc-900/40">
                    <Td>
                      <span
                        className="font-mono text-xs font-medium text-zinc-800 dark:text-zinc-200"
                        title={REASON_CODE_META[s.code].description}
                      >
                        {s.code}
                      </span>
                    </Td>
                    <NumTd>{s.support}</NumTd>
                    <NumTd>{s.predicted}</NumTd>
                    <NumTd>{s.truePositives}</NumTd>
                    <NumTd>
                      <Score value={s.precision} />
                    </NumTd>
                    <NumTd>
                      <Score value={s.recall} />
                    </NumTd>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Failures of note */}
      <FailuresTable results={report.results} />
    </div>
  );
}

function FailuresTable({ results }: { results: ScoredResult[] }) {
  const failures = results.filter(
    (r) => r.bucket !== "correct_resolve" && r.bucket !== "correct_defer",
  );
  if (failures.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Failures of note</h2>
        <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50 p-6 text-center text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          No failures — the agent matched ground truth on every ticket.
        </div>
      </section>
    );
  }

  // Sort by error weight DESC then by id so the worst sins are at the top.
  const sorted = [...failures].sort(
    (a, b) =>
      b.errorWeight - a.errorWeight ||
      a.ticket.id.localeCompare(b.ticket.id, "en", { numeric: true }),
  );

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold tracking-tight">
        Failures of note <span className="text-sm font-normal text-zinc-500">({failures.length})</span>
      </h2>
      <div className="space-y-2">
        {sorted.map((r) => (
          <FailureRow key={r.ticket.id} result={r} />
        ))}
      </div>
    </section>
  );
}

function FailureRow({ result }: { result: ScoredResult }) {
  const [open, setOpen] = useState(false);
  const cfg = BUCKET_CONFIG[result.bucket];
  const gt =
    result.ticket.groundTruth.action === "RESOLVE"
      ? `RESOLVE · ${result.ticket.groundTruth.citations.join(" / ")}`
      : `DEFER · ${result.ticket.groundTruth.reasonCode}`;
  const pred =
    result.result.decision.action === "RESOLVE"
      ? `RESOLVE · ${result.result.decision.citation}`
      : `DEFER · ${result.result.decision.reasonCode}`;
  const trace = result.result.trace;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900/40"
      >
        <span className="font-mono text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          {result.ticket.id}
        </span>
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.chip}`}
        >
          {result.bucket.replace(/_/g, " ")}
        </span>
        <div className="flex-1 truncate text-sm text-zinc-600 dark:text-zinc-400">
          GT: <span className="font-mono text-xs">{gt}</span> &nbsp;→&nbsp; Pred:{" "}
          <span className="font-mono text-xs">{pred}</span>
        </div>
        <span className="text-xs text-zinc-400">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Ticket body
            </div>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
              {result.ticket.body}
            </p>
          </div>

          {result.ticket.groundTruth.note && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Assignment note (expected outcome)
              </div>
              <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
                {result.ticket.groundTruth.note}
              </p>
            </div>
          )}

          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Agent reasoning
            </div>
            <p className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
              {result.result.decision.reasoning}
            </p>
          </div>

          {/* For DEFER: surface the note too — it carries the real error
              message when triage() throws and the harness synthesizes a row. */}
          {result.result.decision.action === "DEFER" && result.result.decision.note && (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Agent note
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                {result.result.decision.note}
              </p>
            </div>
          )}

          {trace.downgraded && (
            <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-sm text-orange-800 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-200">
              <span className="font-medium">Post-validation downgrade:</span>{" "}
              {trace.downgraded.reason}
            </div>
          )}

          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
              Top retrieved policies (top score {trace.retrieval.topScore.toFixed(3)})
            </div>
            <ol className="mt-1 space-y-1.5">
              {trace.retrieval.hits.slice(0, 3).map((hit, i) => (
                <li
                  key={`${hit.citation}-${i}`}
                  className="rounded-md bg-zinc-50 p-2.5 ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs font-semibold text-zinc-800 dark:text-zinc-200">
                      {hit.citation}
                    </span>
                    <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {hit.score.toFixed(3)}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-600 dark:text-zinc-400">
                    {hit.text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}

// --------- Tiny presentational helpers ---------

function StatCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: number | string;
  sub?: string;
  accent?: "emerald" | "amber" | "red";
}) {
  const accentClass =
    accent === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : accent === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : accent === "red"
          ? "text-red-700 dark:text-red-400"
          : "text-zinc-900 dark:text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div className={`mt-2 text-3xl font-semibold ${accentClass}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
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

function NumTd({ children }: { children: React.ReactNode }) {
  return <td className="px-4 py-3 text-right align-middle font-mono text-xs">{children}</td>;
}

function Score({ value }: { value: number }) {
  // Colorize: ≥0.8 green, 0.5–0.8 amber, <0.5 red. Zero shown as dim.
  const cls =
    value === 0
      ? "text-zinc-400 dark:text-zinc-600"
      : value >= 0.8
        ? "text-emerald-700 dark:text-emerald-400"
        : value >= 0.5
          ? "text-amber-700 dark:text-amber-400"
          : "text-red-700 dark:text-red-400";
  return <span className={cls}>{value.toFixed(2)}</span>;
}
